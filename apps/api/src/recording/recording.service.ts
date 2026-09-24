import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../storage/s3.service';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { buildHlsVodPlaylist, buildMasterPlaylist, FmpSegment } from './hls-vod';

const execFileAsync = promisify(execFile);
export const RECORDINGS_ROOT = '/recordings';
const ARCHIVE_ROOT = '/recordings/archive';
/**
 * Срок жизни записи (`Recording.expiresAt`), после которого cleanupExpired
 * (крон 03:00) сносит её префикс из S3. Экспортируется, потому что метрика
 * хранилища в дашборде орги показывает то же число — дублировать «7» в двух
 * местах нельзя, иначе они разъедутся.
 */
export const RECORDING_RETENTION_DAYS = 7;
const FFPROBE_TIMEOUT_MS = 30_000;
const FFMPEG_CONCAT_TIMEOUT_MS = 120_000;
const FFMPEG_FRAME_TIMEOUT_MS = 30_000;
const GLUE_TIMEOUT_MINUTES = parseInt(process.env.RECORDING_GLUE_TIMEOUT_MINUTES ?? '60', 10);

@Injectable()
export class RecordingService {
  private readonly logger = new Logger(RecordingService.name);

  constructor(
    private prisma: PrismaService,
    private s3: S3Service,
  ) {}

  async onStreamEnded(
    broadcastId: string,
    basePath: string,
  ): Promise<void> {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + RECORDING_RETENTION_DAYS);

    // Segments lie directly in /recordings/live/<basePath>/.
    const segmentsDir = path.join(RECORDINGS_ROOT, 'live', basePath);

    if (!fs.existsSync(segmentsDir)) {
      this.logger.warn(`No recordings directory for ${basePath}`);
      return;
    }

    const files = fs.readdirSync(segmentsDir)
      .filter((f: string) => f.endsWith('.mp4'))
      .sort();

    if (files.length === 0) {
      this.logger.warn(`No recording segments found for ${basePath}`);
      return;
    }

    const recording = await this.prisma.recording.create({
      data: { broadcastId, slotIndex: 1, status: 'processing', expiresAt },
    });

    this.convertRecording(recording.id, basePath, broadcastId, 1, files, segmentsDir).catch(err => {
      this.logger.error(`Conversion failed for recording ${recording.id}: ${err.message}`);
    });
  }

  /**
   * Конвертация: перемещает fmp4-сегменты в архив, генерирует HLS-VOD
   * manifest + единый MP4 для скачивания, заливает готовый архив в S3.
   * Финализация Recording (status='ready') происходит ТОЛЬКО после успешной
   * заливки — иначе запись пометится «готовой», хотя объекта в S3 нет.
   */
  private async convertRecording(
    recordingId: string,
    mediamtxPath: string,
    broadcastId: string,
    slotIndex: number,
    files: string[],
    segmentsDir: string,
  ): Promise<void> {
    const broadcastDir = path.join(ARCHIVE_ROOT, mediamtxPath, broadcastId);
    const slotDir = path.join(broadcastDir, `slot-${slotIndex}`);
    fs.mkdirSync(slotDir, { recursive: true });

    try {
      // Step 1: переместить сегменты в slot-N/, переименовать в стабильный формат
      const segments: FmpSegment[] = [];
      let totalDuration = 0;
      let firstWidth = 0;
      let firstHeight = 0;

      for (let i = 0; i < files.length; i++) {
        const src = path.join(segmentsDir, files[i]);
        const stableName = `seg-${String(i + 1).padStart(4, '0')}.mp4`;
        const dst = path.join(slotDir, stableName);

        fs.renameSync(src, dst);

        const probe = await this.probeMp4(dst);
        segments.push({ filename: stableName, duration: probe.duration });
        totalDuration += probe.duration;
        if (i === 0) {
          firstWidth = probe.width;
          firstHeight = probe.height;
        }
      }

      // Step 2: написать slot-N/index.m3u8
      const slotPlaylist = buildHlsVodPlaylist(segments);
      fs.writeFileSync(path.join(slotDir, 'index.m3u8'), slotPlaylist);

      // Step 3: написать master.m3u8 в broadcast-dir (variant ровно один).
      // slotIndex — тот же, что у slotDir выше: master обязан ссылаться на
      // каталог, в который реально легли сегменты.
      const resolution = firstWidth && firstHeight ? `${firstWidth}x${firstHeight}` : '1920x1080';
      const masterPlaylist = buildMasterPlaylist({
        slotIndex,
        bandwidth: 5_000_000,  // approximation; real value не критичен для variant-выбора плеера
        resolution,
      });
      const masterPath = path.join(broadcastDir, 'master.m3u8');
      fs.writeFileSync(masterPath, masterPlaylist);

      // Step 4: собрать единый скачиваемый MP4 (один раз, пока сегменты локальные).
      await this.buildDownloadMp4(slotDir, broadcastDir);

      // Step 4.5: превью записи — кадр из середины первого сегмента, кладётся
      // в broadcastDir и уезжает в S3 общей заливкой ниже. НЕ-фатально:
      // запись важнее картинки (превью можно потом загрузить вручную).
      await this.buildPreviewJpeg(
        path.join(slotDir, segments[0].filename),
        segments[0].duration,
        broadcastDir,
      ).catch((err: any) =>
        this.logger.warn(`Preview frame failed for ${broadcastId}: ${err?.message ?? err}`),
      );

      // fileSize считаем только по slot-N/ (до заливки/удаления) — «честный»
      // расход данного Recording'а, не всего broadcastDir.
      const totalSize = this.getDirSize(slotDir);

      // Step 5-6: заливка в S3 + финализация (общий код с retry-путём).
      const keyPrefix = `archive/${mediamtxPath}/${broadcastId}`;
      await this.uploadAndFinalize(recordingId, broadcastId, broadcastDir, keyPrefix, totalSize, Math.round(totalDuration));
    } catch (err: any) {
      this.logger.error(`Conversion/upload failed for ${recordingId}: ${err.message}`);
      // Локальный broadcastDir НЕ удаляем при ошибке (ни конверсии, ни заливки) —
      // оставляем retryFailed (крон 03:30) возможность пересобрать и перезалить заново.
      await this.prisma.recording.update({
        where: { id: recordingId },
        data: { status: 'failed' },
      });
    }
  }

  /**
   * Заливка готового broadcastDir в S3 + финализация Recording (status='ready',
   * manifestPath=S3-ключ, локальный scratch удаляется ТОЛЬКО после успешной
   * заливки). Вынесено из convertRecording, чтобы retryFailed мог возобновить
   * упавшую ЗАЛИВКУ без повторной конверсии — после первой попытки сегменты
   * уже перемещены из live/ в archive-scratch, и полный пайплайн их не найдёт.
   */
  private async uploadAndFinalize(
    recordingId: string,
    broadcastId: string,
    broadcastDir: string,
    keyPrefix: string,
    fileSize: number,
    duration: number,
  ): Promise<void> {
    // Проверить ДО rmSync: после заливки scratch удаляется.
    const hasPreview = fs.existsSync(path.join(broadcastDir, 'preview.jpg'));
    await this.s3.uploadDirectory(broadcastDir, keyPrefix);
    fs.rmSync(broadcastDir, { recursive: true, force: true });
    await this.prisma.recording.update({
      where: { id: recordingId },
      data: {
        status: 'ready',
        manifestPath: `${keyPrefix}/master.m3u8`,
        fileSize,
        duration,
      },
    });
    if (hasPreview) {
      await this.prisma.broadcast.update({
        where: { id: broadcastId },
        data: { previewImagePath: `${keyPrefix}/preview.jpg` },
      }).catch((err: any) =>
        this.logger.warn(`Preview key update failed for ${broadcastId}: ${err?.message ?? err}`));
    }
    this.logger.log(`Recording ${recordingId} ready (S3): ${keyPrefix}`);
  }

  /**
   * Кадр из середины сегмента → broadcastDir/preview.jpg (1280×720 cover, JPEG).
   * Размер совпадает с ручной загрузкой (ImageService), иначе в архиве рядом
   * оказывались бы превью разной чёткости.
   * Ресайз делает сам ffmpeg (scale+crop) — sharp здесь не нужен. Ключ в
   * Broadcast.previewImagePath ставит uploadAndFinalize ПОСЛЕ успешной заливки.
   */
  private async buildPreviewJpeg(segmentPath: string, segmentDuration: number, broadcastDir: string): Promise<void> {
    if (!fs.existsSync(segmentPath)) return;
    const seek = Math.max(0, segmentDuration / 2).toFixed(2);
    await execFileAsync('ffmpeg', [
      '-ss', seek,
      '-i', segmentPath,
      '-frames:v', '1',
      '-vf', 'scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720',
      '-q:v', '5',
      '-y', path.join(broadcastDir, 'preview.jpg'),
    ], { timeout: FFMPEG_FRAME_TIMEOUT_MS });
  }

  /** Суммарная длительность из #EXTINF-строк нашего же slot-плейлиста (без повторного ffprobe). */
  private parsePlaylistDuration(indexPath: string): number {
    try {
      const text = fs.readFileSync(indexPath, 'utf8');
      let total = 0;
      for (const m of text.matchAll(/#EXTINF:([\d.]+)/g)) total += parseFloat(m[1]);
      return Math.round(total);
    } catch {
      return 0;
    }
  }

  private async probeMp4(filePath: string): Promise<{ duration: number; width: number; height: number }> {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'quiet',
      '-show_entries', 'format=duration:stream=width,height',
      '-select_streams', 'v:0',
      '-of', 'json',
      filePath,
    ], { timeout: FFPROBE_TIMEOUT_MS });
    const probe = JSON.parse(stdout);
    return {
      duration: parseFloat(probe.format?.duration ?? '0'),
      width: probe.streams?.[0]?.width ?? 0,
      height: probe.streams?.[0]?.height ?? 0,
    };
  }

  /**
   * Собирает единый скачиваемый MP4 один раз, сразу после эфира — вместо
   * прежней ленивой сборки на каждый запрос скачивания. Складывается в корень
   * broadcastDir рядом с master.m3u8, заливается в S3 вместе с HLS-VOD.
   */
  private async buildDownloadMp4(slotDir: string, broadcastDir: string): Promise<void> {
    const segments = fs.readdirSync(slotDir)
      .filter((f: string) => f.startsWith('seg-') && f.endsWith('.mp4'))
      .sort();
    if (segments.length === 0) return;

    const listFile = path.join(os.tmpdir(), `_archive_${randomBytes(8).toString('hex')}.txt`);
    const listContent = segments
      .map((f) => `file '${path.join(slotDir, f).replace(/'/g, "'\\''")}'`)
      .join('\n');
    fs.writeFileSync(listFile, listContent);

    const outputPath = path.join(broadcastDir, 'download.mp4');
    try {
      await execFileAsync('ffmpeg', [
        '-f', 'concat', '-safe', '0',
        '-i', listFile,
        '-c', 'copy',
        '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
        '-y', outputPath,
      ], { timeout: FFMPEG_CONCAT_TIMEOUT_MS });
    } finally {
      fs.unlink(listFile, () => { /* ignore */ });
    }
  }

  private getDirSize(dirPath: string): number {
    let total = 0;
    if (!fs.existsSync(dirPath)) return 0;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) total += this.getDirSize(fullPath);
      else total += fs.statSync(fullPath).size;
    }
    return total;
  }

  /**
   * Возвращает S3 key-префикс broadcast'а (где лежит master.m3u8 и download.mp4).
   * Используется RecordingController для генерации presigned-ссылок.
   *
   * `manifestPath` теперь хранит S3-ключ (напр. `archive/org/stream/b1/master.m3u8`),
   * не локальный путь — используем path.posix.dirname (S3-ключи всегда через `/`,
   * независимо от ОС, на которой запущен сервис).
   */
  async getRecordingKeyPrefix(broadcastId: string, slotIndex = 1): Promise<string> {
    const recording = await this.prisma.recording.findUnique({
      where: { broadcastId_slotIndex: { broadcastId, slotIndex } },
    });
    if (!recording || recording.status !== 'ready' || !recording.manifestPath) {
      throw new NotFoundException('Recording not found or not ready');
    }
    return path.posix.dirname(recording.manifestPath);
  }

  async deleteRecordingByBroadcastId(broadcastId: string): Promise<void> {
    const recordings = await this.prisma.recording.findMany({ where: { broadcastId } });
    for (const rec of recordings) {
      if (rec.manifestPath) {
        const keyPrefix = path.posix.dirname(rec.manifestPath);
        await this.s3.deleteByPrefix(keyPrefix);
      }
    }
  }

  @Cron('0 3 * * *')
  async cleanupExpired(): Promise<void> {
    const expired = await this.prisma.recording.findMany({
      where: { expiresAt: { lt: new Date() } },
    });

    // Group by key prefix to avoid double-deleting the same prefix (e.g.
    // broadcastDir with multiple slots sharing one master.m3u8 directory).
    const prefixes = new Set<string>();
    for (const rec of expired) {
      if (rec.manifestPath) prefixes.add(path.posix.dirname(rec.manifestPath));
    }
    for (const prefix of prefixes) {
      await this.s3.deleteByPrefix(prefix);
    }

    // Превью записи лежит под тем же префиксом (deleteByPrefix его уже удалил) —
    // обнуляем ключ, чтобы в БД не оставались висячие ссылки.
    const broadcastIds = [...new Set(expired.map((rec) => rec.broadcastId))];
    if (broadcastIds.length > 0) {
      await this.prisma.broadcast.updateMany({
        where: { id: { in: broadcastIds } },
        data: { previewImagePath: null },
      });
    }

    for (const rec of expired) {
      await this.prisma.recording.delete({ where: { id: rec.id } });
      this.logger.log(`Deleted expired recording ${rec.id}`);
    }
  }

  @Cron('30 3 * * *')
  async retryFailed(): Promise<void> {
    const failed = await this.prisma.recording.findMany({
      where: { status: 'failed' },
      include: { broadcast: { include: { stream: { include: { org: { select: { slug: true } } } } } } },
    });

    for (const rec of failed) {
      if (!rec.broadcast.stream) continue;
      const { stream } = rec.broadcast;
      const basePath = stream.slug === '' ? stream.org.slug : `${stream.org.slug}/${stream.slug}`;

      // Возобновление упавшей ЗАЛИВКИ: если конверсия первой попытки уже прошла
      // (master.m3u8 собран, сегменты перемещены из live/ в archive-scratch),
      // повторять нужно только upload+finalize — в live/ уже пусто, и падение
      // в старую ветку ниже переместило бы сегменты СЛЕДУЮЩЕЙ трансляции этого
      // стрима в чужой broadcastDir (cross-contamination).
      const broadcastDir = path.join(ARCHIVE_ROOT, basePath, rec.broadcastId);
      const slotDir = path.join(broadcastDir, `slot-${rec.slotIndex}`);
      if (fs.existsSync(path.join(broadcastDir, 'master.m3u8'))) {
        await this.prisma.recording.update({
          where: { id: rec.id },
          data: { status: 'processing' },
        });
        const keyPrefix = `archive/${basePath}/${rec.broadcastId}`;
        const fileSize = this.getDirSize(slotDir);
        const duration = this.parsePlaylistDuration(path.join(slotDir, 'index.m3u8'));
        this.uploadAndFinalize(rec.id, rec.broadcastId, broadcastDir, keyPrefix, fileSize, duration).catch(async (err) => {
          this.logger.error(`Retry upload failed for ${rec.id}: ${err.message}`);
          // Возвращаем в 'failed', иначе запись навсегда зависнет в 'processing'
          // и следующий прогон крона её не увидит.
          await this.prisma.recording.update({
            where: { id: rec.id },
            data: { status: 'failed' },
          }).catch(() => { /* ignore */ });
        });
        continue;
      }

      // Конверсия первой попытки не дошла до конца — полный пайплайн из live/.
      const segmentsDir = path.join(RECORDINGS_ROOT, 'live', basePath);

      if (!fs.existsSync(segmentsDir)) continue;
      const files = fs.readdirSync(segmentsDir).filter((f: string) => f.endsWith('.mp4')).sort();
      if (files.length === 0) continue;

      await this.prisma.recording.update({
        where: { id: rec.id },
        data: { status: 'processing' },
      });

      this.convertRecording(rec.id, basePath, rec.broadcastId, rec.slotIndex, files, segmentsDir).catch(err => {
        this.logger.error(`Retry conversion failed for ${rec.id}: ${err.message}`);
      });
    }
  }

  /**
   * Страховка склеиваемых пауз (manual-запись): если стрим не вернулся за
   * GLUE_TIMEOUT_MINUTES, открытый Broadcast закрывается (endedAt = момент
   * обрыва, не текущее время) и финализируется. Дублирует DB-часть
   * StreamService.finalizeGluedBroadcast сознательно: обратная инъекция
   * StreamService сюда создала бы цикл модулей (Stream → Recording → Stream).
   */
  @Cron('*/5 * * * *')
  async finalizeStaleGlue(): Promise<void> {
    const cutoff = new Date(Date.now() - GLUE_TIMEOUT_MINUTES * 60_000);
    const stale = await this.prisma.broadcast.findMany({
      where: { endedAt: null, pausedAt: { not: null, lt: cutoff } },
      select: {
        id: true, pausedAt: true,
        stream: {
          select: {
            id: true, slug: true, currentBroadcastId: true,
            org: { select: { slug: true } },
          },
        },
      },
    });

    for (const b of stale) {
      if (!b.stream) continue;
      await this.prisma.broadcast.update({
        where: { id: b.id },
        data: { endedAt: b.pausedAt ?? new Date(), pausedAt: null },
      });
      if (b.stream.currentBroadcastId === b.id) {
        await this.prisma.stream.update({
          where: { id: b.stream.id },
          data: { currentBroadcastId: null },
        });
      }
      const basePath = b.stream.slug === '' ? b.stream.org.slug : `${b.stream.org.slug}/${b.stream.slug}`;
      this.logger.log(`Glue timeout: finalizing broadcast ${b.id} (paused since ${b.pausedAt?.toISOString()})`);
      this.onStreamEnded(b.id, basePath).catch((err) =>
        this.logger.error(`glue-timeout onStreamEnded failed for ${b.id}: ${err?.message ?? err}`),
      );
    }
  }

  async onModuleInit(): Promise<void> {
    if (!fs.existsSync(ARCHIVE_ROOT)) return;

    // Структура для default Stream: ARCHIVE_ROOT/<orgSlug>/<broadcastId>/(master.m3u8 + slot-N/).
    // Broadcast-папки лежат на depth=2 от ARCHIVE_ROOT (orgSlug — depth 1).
    // Multi-stream (Step 3+) сменит структуру на depth=3; до этого момента сюда не лезем.
    const broadcastDirs: string[] = [];
    for (const orgEntry of fs.readdirSync(ARCHIVE_ROOT, { withFileTypes: true })) {
      if (!orgEntry.isDirectory()) continue;
      const orgDir = path.join(ARCHIVE_ROOT, orgEntry.name);
      for (const bEntry of fs.readdirSync(orgDir, { withFileTypes: true })) {
        if (bEntry.isDirectory()) broadcastDirs.push(path.join(orgDir, bEntry.name));
      }
    }

    for (const dir of broadcastDirs) {
      const broadcastId = path.basename(dir);
      const recording = await this.prisma.recording.findFirst({
        where: { broadcastId },
      });
      if (recording) continue;
      try {
        fs.rmSync(dir, { recursive: true, force: true });
        this.logger.log(`Removed orphaned directory: ${dir}`);
      } catch { /* ignore */ }
    }
  }
}
