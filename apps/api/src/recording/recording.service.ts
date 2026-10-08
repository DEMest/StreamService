import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, Timeout } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../storage/s3.service';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomBytes } from 'crypto';
import {
  buildByteRangeVodPlaylist,
  buildMasterPlaylist,
  DOWNLOAD_FILE,
  groupFragments,
  legacySlotDir,
  VOD_PLAYLIST,
} from './hls-vod';
import { ByteSource, fileByteSource, indexFmp4 } from './fmp4-index';

const execFileAsync = promisify(execFile);
export const RECORDINGS_ROOT = '/recordings';
const ARCHIVE_ROOT = '/recordings/archive';
const FFPROBE_TIMEOUT_MS = 30_000;
/**
 * Склейка многочасовой записи — это copy десятков гигабайт. Таймаут страхует
 * только от зависшего процесса; оборванная по нему склейка в S3 не уедет —
 * её отвергнет сверка длительности в vodFromSource.
 */
const FFMPEG_CONCAT_TIMEOUT_MS = 60 * 60_000;
const FFMPEG_FRAME_TIMEOUT_MS = 30_000;
const GLUE_TIMEOUT_MINUTES = parseInt(process.env.RECORDING_GLUE_TIMEOUT_MINUTES ?? '60', 10);
/**
 * Пауза между стартом API и пересборкой записей, прерванных рестартом:
 * рестарт — это деплой, и склейка десятков ГБ не должна ложиться на диск,
 * пока deploy.sh ещё проверяет, что эфиры и раздача пережили выкатку.
 */
const RESUME_INTERRUPTED_DELAY_MS = 2 * 60_000;
const MASTER_PLAYLIST = 'master.m3u8';
const PREVIEW_FILE = 'preview.jpg';
/** Файлы, по которым onModuleInit узнаёт broadcastDir (вместе с каталогом slot-N/). */
const BROADCAST_DIR_FILES = new Set([MASTER_PLAYLIST, DOWNLOAD_FILE]);
/** Приближение; плееру с единственным variant'ом выбирать не из чего. */
const MASTER_BANDWIDTH = 5_000_000;
/** Если ffprobe не отдал размер кадра (или в старом master его нет). */
const DEFAULT_RESOLUTION = '1920x1080';
/**
 * Допуск сверки длительности склейки с исходниками: доли секунды на стыках
 * сегментов и разница длин аудио/видео — норма, минуты — недописанный файл.
 */
const DURATION_TOLERANCE_SECONDS = 10;
const DURATION_TOLERANCE_RATIO = 0.002;

@Injectable()
export class RecordingService {
  private readonly logger = new Logger(RecordingService.name);
  /** Записи, которые прервал рестарт: их сбрасывает старт, пересобирает resumeInterrupted. */
  private interruptedRecordingIds: string[] = [];

  constructor(
    private prisma: PrismaService,
    private s3: S3Service,
  ) {}

  async onStreamEnded(
    broadcastId: string,
    basePath: string,
  ): Promise<void> {
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
      data: { broadcastId, slotIndex: 1, status: 'processing' },
    });

    this.convertRecording(recording.id, basePath, broadcastId, 1, files, segmentsDir).catch(err => {
      this.logger.error(`Conversion failed for recording ${recording.id}: ${err.message}`);
    });
  }

  /**
   * Конвертация: перемещает fmp4-сегменты MediaMTX в scratch архива и
   * собирает из них архив (buildAndUpload).
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
      // Step 1: переместить сегменты в slot-N/, переименовать в стабильный формат.
      // slot-N/ — только исходники склейки: в S3 они не уезжают.
      for (let i = 0; i < files.length; i++) {
        const stableName = `seg-${String(i + 1).padStart(4, '0')}.mp4`;
        fs.renameSync(path.join(segmentsDir, files[i]), path.join(slotDir, stableName));
      }
      await this.buildAndUpload(recordingId, broadcastId, mediamtxPath, broadcastDir, slotDir);
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
   * Сборка архива из исходников slot-N/: склейка download.mp4, плейлисты
   * поверх неё, превью, заливка в S3 и финализация. Целиком повторяема — ей же
   * пользуется retryFailed: всё, что лежит в broadcastDir помимо slot-N/,
   * пересобирается заново.
   */
  private async buildAndUpload(
    recordingId: string,
    broadcastId: string,
    mediamtxPath: string,
    broadcastDir: string,
    slotDir: string,
  ): Promise<void> {
    const sources = this.listSourceSegments(slotDir);
    if (sources.length === 0) throw new Error(`no source segments in ${slotDir}`);

    // Step 2: длительности исходников — эталон для сверки склейки; первый
    // сегмент даёт разрешение для master и кадр для превью.
    let expectedDuration = 0;
    let first = { duration: 0, width: 0, height: 0 };
    for (let i = 0; i < sources.length; i++) {
      const probe = await this.probeMp4(path.join(slotDir, sources[i]));
      expectedDuration += probe.duration;
      if (i === 0) first = probe;
    }

    // Step 3: склейка — единственная копия видео в архиве. Повтор после
    // упавшей заливки берёт уже готовую, если она проходит сверку: склеивать
    // заново десятки ГБ на диске, общем с эфиром, незачем.
    // Step 4: vod.m3u8 — байтовые диапазоны download.mp4 по ключевым кадрам.
    const downloadPath = path.join(broadcastDir, DOWNLOAD_FILE);
    let vod = fs.existsSync(downloadPath)
      ? await this.vodFromFile(downloadPath, expectedDuration).catch(() => null)
      : null;
    if (!vod) {
      await this.buildDownloadMp4(slotDir, broadcastDir);
      vod = await this.vodFromFile(downloadPath, expectedDuration);
    }
    // master.m3u8 — единственный variant, указывающий на vod.m3u8.
    fs.writeFileSync(path.join(broadcastDir, VOD_PLAYLIST), vod.playlist);
    const resolution = first.width && first.height ? `${first.width}x${first.height}` : DEFAULT_RESOLUTION;
    fs.writeFileSync(
      path.join(broadcastDir, MASTER_PLAYLIST),
      buildMasterPlaylist({ uri: VOD_PLAYLIST, bandwidth: MASTER_BANDWIDTH, resolution }),
    );

    // Step 5: превью записи — кадр из середины первого сегмента. НЕ-фатально:
    // запись важнее картинки (превью можно потом загрузить вручную).
    await this.buildPreviewJpeg(path.join(slotDir, sources[0]), first.duration, broadcastDir).catch((err: any) =>
      this.logger.warn(`Preview frame failed for ${broadcastId}: ${err?.message ?? err}`),
    );

    // Step 6: заливка + финализация. fileSize — то, что запись реально
    // занимает в хранилище, то есть download.mp4.
    const fileSize = fs.statSync(downloadPath).size;
    const keyPrefix = `archive/${mediamtxPath}/${broadcastId}`;
    await this.uploadAndFinalize(recordingId, broadcastId, broadcastDir, keyPrefix, fileSize, Math.round(vod.duration));
  }

  /**
   * vod.m3u8 по оглавлению fMP4 плюс сверка его длительности с ожидаемой.
   * Склейка, покрывающая заметно меньше исходников, — недописанный файл: в
   * архив он уйти не должен, потому что после заливки исходники удаляются.
   */
  private async vodFromSource(
    source: ByteSource,
    expectedDuration: number,
  ): Promise<{ playlist: string; duration: number }> {
    const index = await indexFmp4(source);
    const chunks = groupFragments(index.fragments);
    const duration = chunks.reduce((sum, c) => sum + c.duration, 0);
    const tolerance = Math.max(DURATION_TOLERANCE_SECONDS, expectedDuration * DURATION_TOLERANCE_RATIO);
    if (expectedDuration > 0 && Math.abs(duration - expectedDuration) > tolerance) {
      throw new Error(
        `${DOWNLOAD_FILE} covers ${duration.toFixed(1)}s, expected ${expectedDuration.toFixed(1)}s`,
      );
    }
    return { playlist: buildByteRangeVodPlaylist(DOWNLOAD_FILE, index.initLength, chunks), duration };
  }

  private async vodFromFile(
    filePath: string,
    expectedDuration: number,
  ): Promise<{ playlist: string; duration: number }> {
    const source = await fileByteSource(filePath);
    try {
      return await this.vodFromSource(source, expectedDuration);
    } finally {
      await source.close();
    }
  }

  private listSourceSegments(slotDir: string): string[] {
    if (!fs.existsSync(slotDir)) return [];
    return fs.readdirSync(slotDir)
      .filter((f: string) => f.startsWith('seg-') && f.endsWith('.mp4'))
      .sort();
  }

  /**
   * Заливка готового архива в S3 + финализация Recording (status='ready',
   * manifestPath=S3-ключ). Локальный scratch вместе с исходниками удаляется
   * ТОЛЬКО после успешной заливки — иначе запись пометится «готовой», хотя
   * объекта в S3 нет, а retryFailed будет не из чего пересобрать.
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
    const hasPreview = fs.existsSync(path.join(broadcastDir, PREVIEW_FILE));
    // Видео первым, плейлисты после: master не должен оказаться в S3 раньше
    // того, на что он ссылается.
    const files = [DOWNLOAD_FILE, VOD_PLAYLIST, MASTER_PLAYLIST, ...(hasPreview ? [PREVIEW_FILE] : [])];
    await this.s3.uploadFiles(broadcastDir, files, keyPrefix);
    fs.rmSync(broadcastDir, { recursive: true, force: true });
    await this.prisma.recording.update({
      where: { id: recordingId },
      data: {
        status: 'ready',
        manifestPath: `${keyPrefix}/${MASTER_PLAYLIST}`,
        fileSize,
        duration,
        // Запись, созданная до отключения автоудаления и пересобранная
        // retryFailed, тоже переходит на «без срока».
        expiresAt: null,
      },
    });
    if (hasPreview) {
      await this.prisma.broadcast.update({
        where: { id: broadcastId },
        data: { previewImagePath: `${keyPrefix}/${PREVIEW_FILE}` },
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
      '-y', path.join(broadcastDir, PREVIEW_FILE),
    ], { timeout: FFMPEG_FRAME_TIMEOUT_MS });
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
   * Склеивает исходники slot-N/ в один фрагментированный MP4 (`-c copy`, без
   * перекодирования). `frag_keyframe` начинает фрагмент на каждом ключевом
   * кадре, `default_base_moof` делает фрагменты самодостаточными — на этом
   * держится vod.m3u8, отдающий их плееру байтовыми диапазонами.
   */
  private async buildDownloadMp4(slotDir: string, broadcastDir: string): Promise<void> {
    const segments = this.listSourceSegments(slotDir);
    if (segments.length === 0) return;

    const listFile = path.join(os.tmpdir(), `_archive_${randomBytes(8).toString('hex')}.txt`);
    const listContent = segments
      .map((f) => `file '${path.join(slotDir, f).replace(/'/g, "'\\''")}'`)
      .join('\n');
    fs.writeFileSync(listFile, listContent);

    const outputPath = path.join(broadcastDir, DOWNLOAD_FILE);
    try {
      await execFileAsync('ffmpeg', [
        // Без прогресса и предупреждений: на многочасовой склейке они могут
        // переполнить maxBuffer execFile (1 МБ) — и процесс будет убит.
        '-nostats', '-loglevel', 'error',
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

  /**
   * Архивы всех записей Stream'ов — ДО каскадного удаления строк: после него
   * S3-префиксы не найти, и видео осталось бы в хранилище навсегда, хотя
   * орге обещано, что записи удалены. Автоудаления нет, так что подобрать
   * такой хвост больше некому.
   */
  async deleteRecordingsForStreams(streamIds: string[]): Promise<void> {
    if (streamIds.length === 0) return;
    const recordings = await this.prisma.recording.findMany({
      where: { broadcast: { streamId: { in: streamIds } } },
      select: { manifestPath: true },
    });
    for (const rec of recordings) {
      if (rec.manifestPath) await this.s3.deleteByPrefix(path.posix.dirname(rec.manifestPath));
    }
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

  @Cron('30 3 * * *')
  async retryFailed(): Promise<void> {
    // Без аргументов намеренно: cron передаёт в onTick свой onComplete.
    await this.retryRecordings();
  }

  /**
   * Повтор failed-записей. Крон берёт все; resumeInterrupted передаёт
   * onlyIds — записи, прерванные рестартом, — и такой прогон собирает только
   * из scratch: в live/ он не заглядывает никогда (см. ниже).
   *
   * Записи идут по одной: склейка — это copy десятков ГБ по диску, общему с
   * эфиром, и несколько склеек разом мешали бы ингесту.
   */
  private async retryRecordings(onlyIds?: string[]): Promise<void> {
    const failed = await this.prisma.recording.findMany({
      where: { status: 'failed', ...(onlyIds ? { id: { in: onlyIds } } : {}) },
      include: { broadcast: { include: { stream: { include: { org: { select: { slug: true } } } } } } },
    });

    for (const rec of failed) {
      if (!rec.broadcast.stream) continue;
      const { stream } = rec.broadcast;
      const basePath = stream.slug === '' ? stream.org.slug : `${stream.org.slug}/${stream.slug}`;

      // Первая попытка уже перенесла сегменты из live/ в scratch — архив
      // пересобирается из них целиком (склейка, плейлисты, заливка). В live/
      // при этом не смотрим: там может лежать СЛЕДУЮЩАЯ трансляция этого
      // стрима, и её сегменты уехали бы в чужой broadcastDir (cross-contamination).
      const broadcastDir = path.join(ARCHIVE_ROOT, basePath, rec.broadcastId);
      const slotDir = path.join(broadcastDir, `slot-${rec.slotIndex}`);
      if (this.listSourceSegments(slotDir).length > 0) {
        if (!(await this.claimForRetry(rec.id))) continue;
        try {
          await this.buildAndUpload(rec.id, rec.broadcastId, basePath, broadcastDir, slotDir);
        } catch (err: any) {
          this.logger.error(`Retry build/upload failed for ${rec.id}: ${err.message}`);
          // Возвращаем в 'failed', иначе запись навсегда зависнет в 'processing'
          // и следующий прогон крона её не увидит.
          await this.prisma.recording.update({
            where: { id: rec.id },
            data: { status: 'failed' },
          }).catch(() => { /* ignore */ });
        }
        continue;
      }

      // Прогон после рестарта live/ не трогает: рестарт — это деплой, деплой
      // обычно идёт посреди эфира, и в live/ лежит сегмент, который MediaMTX
      // пишет прямо сейчас. Такие записи ждут крона.
      if (onlyIds) continue;

      // Конверсия первой попытки не дошла до переноса сегментов — полный пайплайн из live/.
      const segmentsDir = path.join(RECORDINGS_ROOT, 'live', basePath);

      if (!fs.existsSync(segmentsDir)) continue;
      const files = fs.readdirSync(segmentsDir).filter((f: string) => f.endsWith('.mp4')).sort();
      if (files.length === 0) continue;

      // Сегменты в live/ — этой записи, только если стрим после неё в эфир не
      // выходил. Иначе там следующая трансляция (идущая или в паузе), а свои
      // сегменты этой записи забрал её onStreamEnded.
      const later = await this.prisma.broadcast.findFirst({
        where: { streamId: rec.broadcast.streamId, startedAt: { gt: rec.broadcast.startedAt } },
        select: { id: true },
      });
      if (later) {
        this.logger.warn(`Retry of ${rec.id} skipped: ${segmentsDir} belongs to later broadcast ${later.id}`);
        continue;
      }

      if (!(await this.claimForRetry(rec.id))) continue;
      try {
        await this.convertRecording(rec.id, basePath, rec.broadcastId, rec.slotIndex, files, segmentsDir);
      } catch (err: any) {
        this.logger.error(`Retry conversion failed for ${rec.id}: ${err.message}`);
        await this.prisma.recording.update({
          where: { id: rec.id },
          data: { status: 'failed' },
        }).catch(() => { /* ignore */ });
      }
    }
  }

  /**
   * failed → processing, только если запись всё ещё failed. Крон и
   * resumeInterrupted могут выбрать одну запись одновременно — пересобрать
   * её должен кто-то один.
   */
  private async claimForRetry(recordingId: string): Promise<boolean> {
    const { count } = await this.prisma.recording.updateMany({
      where: { id: recordingId, status: 'failed' },
      data: { status: 'processing' },
    });
    return count === 1;
  }

  /**
   * Пересборка записей, прерванных рестартом, — без ожидания крона в 03:30.
   * Только из scratch: на него приходится почти всё окно конверсии (склейка
   * и заливка). Записи без scratch остаются failed до крона.
   */
  @Timeout(RESUME_INTERRUPTED_DELAY_MS)
  async resumeInterrupted(): Promise<void> {
    const ids = this.interruptedRecordingIds;
    this.interruptedRecordingIds = [];
    if (ids.length === 0) return;
    await this.retryRecordings(ids);
  }

  /**
   * Конверсия идёт внутри процесса API, поэтому всё, что на старте числится
   * processing, прервал прошлый процесс — рестарт (каждый мерж в main
   * перезапускает api) или падение. retryFailed выбирает только failed, и без
   * сброса такая запись висела бы в processing вечно, хотя её scratch с
   * исходниками рестарт пережил.
   */
  private async failInterruptedRecordings(): Promise<void> {
    try {
      const stale = await this.prisma.recording.findMany({
        where: { status: 'processing' },
        select: { id: true },
      });
      if (stale.length === 0) return;
      const ids = stale.map((r) => r.id);
      await this.prisma.recording.updateMany({
        where: { id: { in: ids }, status: 'processing' },
        data: { status: 'failed' },
      });
      this.interruptedRecordingIds = ids;
      this.logger.warn(`Recordings interrupted by restart marked failed: ${ids.join(', ')}`);
    } catch (err: any) {
      // Не повод не поднимать API (и с ним раздачу эфира): записи дождутся
      // следующего старта.
      this.logger.error(`Interrupted recordings not reset: ${err?.message ?? err}`);
    }
  }

  /**
   * Перевод архивов, залитых до байтовых плейлистов. Их master.m3u8 ссылается
   * на slot-N/index.m3u8 поверх сырых сегментов MediaMTX по 3 часа, которые
   * браузер не в состоянии загрузить. download.mp4 у них уже лежит в S3 — по
   * нему строится vod.m3u8, master переключается на него, а slot-N/ (полный
   * дубль тех же байт) удаляется.
   *
   * Признак «ещё не переведена» — заполненный expiresAt: до этой версии он
   * был обязательным, теперь не ставится. Перевод его обнуляет — запись
   * переходит на новую политику «без срока», и следующий старт её уже не
   * выбирает. Когда в Recording не останется строк с expiresAt, эту миграцию
   * и legacySlotDir можно удалить.
   *
   * Фоном при старте: API не ждёт, ошибка одной записи не останавливает
   * остальные и повторится на следующем старте.
   */
  onApplicationBootstrap(): void {
    this.migrateLegacyArchives().catch((err: any) =>
      this.logger.error(`Legacy archive migration failed: ${err?.message ?? err}`));
  }

  async migrateLegacyArchives(): Promise<void> {
    const legacy = await this.prisma.recording.findMany({
      where: { status: 'ready', manifestPath: { not: null }, expiresAt: { not: null } },
      select: { id: true, manifestPath: true, duration: true },
    });
    for (const rec of legacy) {
      try {
        await this.migrateLegacyArchive(rec.id, rec.manifestPath!, rec.duration ?? 0);
      } catch (err: any) {
        this.logger.warn(`Legacy archive ${rec.id} not migrated: ${err?.message ?? err}`);
      }
    }
  }

  private async migrateLegacyArchive(recordingId: string, manifestPath: string, expectedDuration: number): Promise<void> {
    const keyPrefix = path.posix.dirname(manifestPath);
    const downloadKey = `${keyPrefix}/${DOWNLOAD_FILE}`;
    const master = await this.s3.getObjectText(manifestPath);
    const size = await this.s3.getObjectSize(downloadKey);

    // master ещё старый — сверить download.mp4 и переключить master. Если он
    // уже новый, это сделал прошлый старт, не дойдя до удаления дубля и
    // обнуления expiresAt, — тогда доделываем только их.
    if (legacySlotDir(master)) {
      // Без эталона сверить download.mp4 не с чем — а дубль удаляется только
      // после сверки.
      if (!expectedDuration) throw new Error('recording has no duration to verify download.mp4 against');
      // Сверка с длительностью записи: дубль удаляется ниже, и недописанный
      // download.mp4 остался бы единственной копией.
      const vod = await this.vodFromSource(
        { size, read: (offset, length) => this.s3.getObjectRange(downloadKey, offset, length) },
        expectedDuration,
      );
      const resolution = master.match(/RESOLUTION=(\d+x\d+)/)?.[1] ?? DEFAULT_RESOLUTION;

      // Порядок: vod.m3u8 → master → удаление дубля. Плеер ни в какой момент
      // не видит master, указывающий в пустоту, а дубль уходит, только когда
      // новый master уже на месте.
      const m3u8 = 'application/vnd.apple.mpegurl';
      await this.s3.putObject(`${keyPrefix}/${VOD_PLAYLIST}`, Buffer.from(vod.playlist), m3u8);
      await this.s3.putObject(
        manifestPath,
        Buffer.from(buildMasterPlaylist({ uri: VOD_PLAYLIST, bandwidth: MASTER_BANDWIDTH, resolution })),
        m3u8,
      );
    }

    await this.s3.deleteByPrefix(`${keyPrefix}/slot-`);
    // fileSize старых записей считался по slot-N/ — теперь след записи в
    // хранилище один download.mp4.
    await this.prisma.recording.update({
      where: { id: recordingId },
      data: { fileSize: size, expiresAt: null },
    });
    this.logger.log(`Legacy archive ${recordingId} migrated to byte-range VOD (${keyPrefix})`);
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

  /**
   * Чистка осиротевшего archive-scratch на старте API. broadcastDir лежит в
   * ARCHIVE_ROOT/<mediamtxPath>/<broadcastId>, а mediamtxPath бывает разной
   * глубины: `<orgSlug>` у legacy default Stream (slug='') и
   * `<orgSlug>/<streamSlug>` у именованного. Поэтому broadcastDir узнаётся по
   * содержимому, а не по глубине: каталог стрима, принятый за broadcastDir без
   * Recording, сносился целиком на каждом деплое — вместе с прерванной
   * конверсией и со scratch failed-записей, из которого их пересобирает retryFailed.
   * Удаляется только broadcastDir без строки Recording; каталоги org и
   * стримов не удаляются никогда.
   *
   * До чистки — сброс записей, прерванных рестартом. Именно здесь: Nest
   * открывает порт и запускает кроны (finalizeStaleGlue тоже создаёт записи)
   * только после onModuleInit всех модулей, так что новая processing-запись
   * этого процесса появиться ещё не может, и сброс её не заденет.
   */
  async onModuleInit(): Promise<void> {
    await this.failInterruptedRecordings();
    if (!fs.existsSync(ARCHIVE_ROOT)) return;

    const broadcastDirs: string[] = [];
    for (const orgDir of this.listSubdirs(ARCHIVE_ROOT)) {
      for (const dir of this.listSubdirs(orgDir)) {
        if (this.isBroadcastDir(dir)) {
          broadcastDirs.push(dir);
          continue;
        }
        // Не broadcastDir — значит каталог именованного стрима, broadcastDir'ы на уровень ниже.
        for (const streamChild of this.listSubdirs(dir)) {
          if (this.isBroadcastDir(streamChild)) broadcastDirs.push(streamChild);
        }
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

  /** Подкаталоги dir. Ошибка чтения — пустой список: чистка best-effort и не должна ронять старт API. */
  private listSubdirs(dir: string): string[] {
    try {
      return fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => path.join(dir, e.name));
    } catch {
      return [];
    }
  }

  /**
   * Признаки broadcastDir: convertRecording первым же шагом создаёт slot-N/,
   * позже кладёт master.m3u8 и download.mp4. Каталог стрима под это не
   * подпадает, потому что внутри у него только broadcastDir'ы, а broadcastId
   * (cuid) с `slot-` не начинается. Каталог org сюда не передаётся никогда:
   * у стрима может быть slug `slot-1`, и тогда org с таким стримом выглядела
   * бы broadcastDir'ом — и снеслась бы целиком.
   */
  private isBroadcastDir(dir: string): boolean {
    try {
      return fs.readdirSync(dir, { withFileTypes: true }).some((e) =>
        e.isDirectory() ? e.name.startsWith('slot-') : BROADCAST_DIR_FILES.has(e.name));
    } catch {
      return false;
    }
  }
}
