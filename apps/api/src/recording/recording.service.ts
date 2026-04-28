import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execFileAsync = promisify(execFile);
const RECORDINGS_ROOT = '/recordings';
const ARCHIVE_ROOT = '/recordings/archive';

@Injectable()
export class RecordingService {
  private readonly logger = new Logger(RecordingService.name);

  constructor(private prisma: PrismaService) {}

  async onStreamEnded(broadcastId: string, orgSlug: string): Promise<void> {
    const segmentsDir = path.join(RECORDINGS_ROOT, 'live', orgSlug);

    if (!fs.existsSync(segmentsDir)) {
      this.logger.warn(`No recordings directory for ${orgSlug}`);
      return;
    }

    const files = fs.readdirSync(segmentsDir)
      .filter(f => f.endsWith('.mp4'))
      .sort();

    if (files.length === 0) {
      this.logger.warn(`No recording segments found for ${orgSlug}`);
      return;
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const recording = await this.prisma.recording.create({
      data: { broadcastId, status: 'processing', expiresAt },
    });

    this.convertRecording(recording.id, orgSlug, broadcastId, files, segmentsDir).catch(err => {
      this.logger.error(`Conversion failed for recording ${recording.id}: ${err.message}`);
    });
  }

  private async convertRecording(
    recordingId: string,
    orgSlug: string,
    broadcastId: string,
    files: string[],
    segmentsDir: string,
  ): Promise<void> {
    const archiveDir = path.join(ARCHIVE_ROOT, orgSlug);
    const outputDir = path.join(archiveDir, broadcastId);
    fs.mkdirSync(outputDir, { recursive: true });

    const tempMp4 = path.join(archiveDir, `${broadcastId}_temp.mp4`);

    try {
      // Step 1: Concatenate segments into single MP4
      if (files.length === 1) {
        fs.copyFileSync(path.join(segmentsDir, files[0]), tempMp4);
      } else {
        const listFile = path.join(segmentsDir, `concat_${broadcastId}.txt`);
        const listContent = files.map(f => `file '${path.join(segmentsDir, f)}'`).join('\n');
        fs.writeFileSync(listFile, listContent);

        await execFileAsync('ffmpeg', [
          '-f', 'concat', '-safe', '0',
          '-i', listFile,
          '-c', 'copy',
          '-movflags', '+faststart',
          tempMp4,
        ], { timeout: 4 * 60 * 60 * 1000 });

        fs.unlinkSync(listFile);
      }

      // Step 2: Move to original.mp4 for download
      const originalMp4 = path.join(outputDir, 'original.mp4');
      fs.renameSync(tempMp4, originalMp4);

      // Step 3: Create HD variant (codec copy, just segment into .ts)
      const hdDir = path.join(outputDir, 'hd');
      fs.mkdirSync(hdDir, { recursive: true });

      await execFileAsync('ffmpeg', [
        '-i', originalMp4,
        '-c:v', 'copy', '-c:a', 'copy',
        '-hls_time', '6',
        '-hls_segment_type', 'mpegts',
        '-hls_playlist_type', 'vod',
        '-hls_segment_filename', path.join(hdDir, 'seg%03d.ts'),
        path.join(hdDir, 'index.m3u8'),
      ], { timeout: 4 * 60 * 60 * 1000 });

      // Step 4: Read resolution & bandwidth for master playlist
      let hdBandwidth = 5000000;
      let hdResolution = '1920x1080';
      try {
        const { stdout } = await execFileAsync('ffprobe', [
          '-v', 'quiet',
          '-show_entries', 'stream=width,height,bit_rate',
          '-select_streams', 'v:0',
          '-of', 'json',
          originalMp4,
        ]);
        const probe = JSON.parse(stdout);
        const stream = probe.streams?.[0];
        if (stream) {
          hdResolution = `${stream.width}x${stream.height}`;
          if (stream.bit_rate) hdBandwidth = parseInt(stream.bit_rate, 10);
        }
      } catch { /* use defaults */ }

      // Step 5: Write master.m3u8
      const masterContent = [
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        '',
        `#EXT-X-STREAM-INF:BANDWIDTH=${hdBandwidth},RESOLUTION=${hdResolution},NAME="HD"`,
        'hd/index.m3u8',
      ].join('\n');
      fs.writeFileSync(path.join(outputDir, 'master.m3u8'), masterContent);

      // Step 6: Get duration and total file size
      let duration: number | null = null;
      try {
        const { stdout } = await execFileAsync('ffprobe', [
          '-v', 'quiet',
          '-show_entries', 'format=duration',
          '-of', 'default=noprint_wrappers=1:nokey=1',
          originalMp4,
        ]);
        duration = Math.round(parseFloat(stdout.trim()));
      } catch { /* duration remains null */ }

      const totalSize = this.getDirSize(outputDir);

      await this.prisma.recording.update({
        where: { id: recordingId },
        data: {
          status: 'ready',
          filePath: path.join(outputDir, 'master.m3u8'),
          fileSize: totalSize,
          duration,
        },
      });

      // Cleanup source segments
      for (const f of files) {
        try { fs.unlinkSync(path.join(segmentsDir, f)); } catch { /* ignore */ }
      }

      this.logger.log(`Recording ${recordingId} ready (HLS): ${outputDir}`);
    } catch (err: any) {
      this.logger.error(`HLS conversion failed: ${err.message}`);
      // Cleanup partial output
      try { fs.rmSync(outputDir, { recursive: true, force: true }); } catch { /* ignore */ }
      try { fs.unlinkSync(tempMp4); } catch { /* ignore */ }
      await this.prisma.recording.update({
        where: { id: recordingId },
        data: { status: 'failed' },
      });
    }
  }

  private getDirSize(dirPath: string): number {
    let total = 0;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += this.getDirSize(fullPath);
      } else {
        total += fs.statSync(fullPath).size;
      }
    }
    return total;
  }

  async getRecordingDir(broadcastId: string): Promise<string> {
    const recording = await this.prisma.recording.findUnique({ where: { broadcastId } });
    if (!recording || recording.status !== 'ready' || !recording.filePath) {
      throw new NotFoundException('Recording not found or not ready');
    }
    const dir = path.dirname(recording.filePath);
    if (!fs.existsSync(dir)) {
      throw new NotFoundException('Recording directory missing from disk');
    }
    return dir;
  }

  async deleteRecordingByBroadcastId(broadcastId: string): Promise<void> {
    const recording = await this.prisma.recording.findUnique({ where: { broadcastId } });
    if (recording?.filePath) {
      const dir = path.dirname(recording.filePath);
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }

  @Cron('0 3 * * *')
  async cleanupExpired(): Promise<void> {
    const expired = await this.prisma.recording.findMany({
      where: { expiresAt: { lt: new Date() } },
    });

    for (const rec of expired) {
      if (rec.filePath) {
        const dir = path.dirname(rec.filePath);
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
      }
      await this.prisma.recording.delete({ where: { id: rec.id } });
      this.logger.log(`Deleted expired recording ${rec.id}`);
    }
  }

  @Cron('30 3 * * *')
  async retryFailed(): Promise<void> {
    // Retry both failed and stuck processing (older than 12 hours)
    const stuckCutoff = new Date(Date.now() - 12 * 60 * 60 * 1000);
    const toRetry = await this.prisma.recording.findMany({
      where: {
        OR: [
          { status: 'failed' },
          { status: 'processing', createdAt: { lt: stuckCutoff } },
        ],
      },
      include: { broadcast: { include: { org: true } } },
    });

    for (const rec of toRetry) {
      const orgSlug = rec.broadcast.org.slug;
      const segmentsDir = path.join(RECORDINGS_ROOT, 'live', orgSlug);

      if (!fs.existsSync(segmentsDir)) {
        this.logger.warn(`No source segments for ${rec.id}, marking failed`);
        await this.prisma.recording.update({
          where: { id: rec.id },
          data: { status: 'failed' },
        });
        continue;
      }

      const files = fs.readdirSync(segmentsDir)
        .filter(f => f.endsWith('.mp4'))
        .sort();

      if (files.length === 0) {
        this.logger.warn(`Empty segments dir for ${rec.id}, marking failed`);
        await this.prisma.recording.update({
          where: { id: rec.id },
          data: { status: 'failed' },
        });
        continue;
      }

      // Clean up partial archive output before retry
      const outputDir = path.join(ARCHIVE_ROOT, orgSlug, rec.broadcastId);
      try { fs.rmSync(outputDir, { recursive: true, force: true }); } catch { /* ignore */ }
      const tempMp4 = path.join(ARCHIVE_ROOT, orgSlug, `${rec.broadcastId}_temp.mp4`);
      try { fs.unlinkSync(tempMp4); } catch { /* ignore */ }

      await this.prisma.recording.update({
        where: { id: rec.id },
        data: { status: 'processing' },
      });

      this.logger.log(`Retrying conversion for recording ${rec.id} (was ${rec.status})`);

      this.convertRecording(rec.id, orgSlug, rec.broadcastId, files, segmentsDir).catch(err => {
        this.logger.error(`Retry conversion failed for ${rec.id}: ${err.message}`);
      });
    }
  }

  async onModuleInit(): Promise<void> {
    if (!fs.existsSync(ARCHIVE_ROOT)) return;

    const orgDirs = fs.readdirSync(ARCHIVE_ROOT);
    for (const orgDir of orgDirs) {
      const dirPath = path.join(ARCHIVE_ROOT, orgDir);
      if (!fs.statSync(dirPath).isDirectory()) continue;

      const entries = fs.readdirSync(dirPath);
      for (const entry of entries) {
        const entryPath = path.join(dirPath, entry);
        if (!fs.statSync(entryPath).isDirectory()) continue;

        const broadcastId = entry;
        const recording = await this.prisma.recording.findFirst({
          where: { broadcastId, status: 'ready' },
        });
        if (!recording) {
          try {
            fs.rmSync(entryPath, { recursive: true, force: true });
            this.logger.log(`Removed orphaned directory: ${entryPath}`);
          } catch { /* ignore */ }
        }
      }
    }
  }
}
