import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { buildHlsVodPlaylist, buildMasterPlaylist, FmpSegment } from './hls-vod';

const execFileAsync = promisify(execFile);
const RECORDINGS_ROOT = '/recordings';
const ARCHIVE_ROOT = '/recordings/archive';
const FFPROBE_TIMEOUT_MS = 30_000;

@Injectable()
export class RecordingService {
  private readonly logger = new Logger(RecordingService.name);

  constructor(private prisma: PrismaService) {}

  async onStreamEnded(
    broadcastId: string,
    basePath: string,
  ): Promise<void> {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

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
   * Конвертация: перемещает fmp4-сегменты в архив, генерирует HLS-VOD manifest.
   * Никаких FFmpeg-вызовов кроме ffprobe (только для чтения длительности).
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

      // Step 3: написать master.m3u8 в broadcast-dir (одна variant — composite, slot 1).
      const resolution = firstWidth && firstHeight ? `${firstWidth}x${firstHeight}` : '1920x1080';
      const masterPlaylist = buildMasterPlaylist([{
        slotIndex: 1,
        bandwidth: 5_000_000,  // approximation; real value не критичен для variant-выбора плеера
        resolution,
      }]);
      const masterPath = path.join(broadcastDir, 'master.m3u8');
      fs.writeFileSync(masterPath, masterPlaylist);

      // Step 4: финализировать Recording.
      // fileSize считаем только по slot-N/ — это «честный» расход данного Recording'а
      // и избегаем гонок с другими slot-job'ами, пишущими в общий broadcastDir.
      const totalSize = this.getDirSize(slotDir);
      await this.prisma.recording.update({
        where: { id: recordingId },
        data: {
          status: 'ready',
          manifestPath: masterPath,
          fileSize: totalSize,
          duration: Math.round(totalDuration),
        },
      });

      this.logger.log(`Recording ${recordingId} ready (HLS-VOD): ${broadcastDir}`);
    } catch (err: any) {
      this.logger.error(`HLS-VOD conversion failed for ${recordingId}: ${err.message}`);
      // Чистим только свою slot-папку — другие slot'ы того же Broadcast'а могли успешно конвертнуться.
      try { fs.rmSync(slotDir, { recursive: true, force: true }); } catch { /* ignore */ }
      await this.prisma.recording.update({
        where: { id: recordingId },
        data: { status: 'failed' },
      });
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
   * Возвращает корневую директорию broadcast'а (где лежит master.m3u8).
   * Используется RecordingController.serveHls и downloadRecording.
   *
   * Для НОВЫХ recordings (Step 2+): broadcastDir содержит master.m3u8 и slot-N/index.m3u8.
   * Для СТАРЫХ recordings (pre Step 2): broadcastDir содержит master.m3u8 + hd/index.m3u8 + lq/index.m3u8.
   * Оба формата играются через тот же serveHls (статика по recording-dir).
   */
  async getRecordingDir(broadcastId: string, slotIndex = 1): Promise<string> {
    const recording = await this.prisma.recording.findUnique({
      where: { broadcastId_slotIndex: { broadcastId, slotIndex } },
    });
    if (!recording || recording.status !== 'ready' || !recording.manifestPath) {
      throw new NotFoundException('Recording not found or not ready');
    }
    const dir = path.dirname(recording.manifestPath);
    if (!fs.existsSync(dir)) {
      throw new NotFoundException('Recording directory missing from disk');
    }
    return dir;
  }

  async deleteRecordingByBroadcastId(broadcastId: string): Promise<void> {
    const recordings = await this.prisma.recording.findMany({ where: { broadcastId } });
    for (const rec of recordings) {
      if (rec.manifestPath) {
        const dir = path.dirname(rec.manifestPath);
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    }
  }

  @Cron('0 3 * * *')
  async cleanupExpired(): Promise<void> {
    const expired = await this.prisma.recording.findMany({
      where: { expiresAt: { lt: new Date() } },
    });

    // Group by directory to avoid double-rm same directory (e.g. broadcastDir has multiple slots)
    const dirs = new Set<string>();
    for (const rec of expired) {
      if (rec.manifestPath) dirs.add(path.dirname(rec.manifestPath));
    }
    for (const dir of dirs) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
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
      // Segments always lie in /recordings/live/<basePath>/ (composite only).
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
