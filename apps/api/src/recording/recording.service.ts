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
    fs.mkdirSync(archiveDir, { recursive: true });

    const outputPath = path.join(archiveDir, `${broadcastId}.mp4`);

    try {
      if (files.length === 1) {
        fs.copyFileSync(path.join(segmentsDir, files[0]), outputPath);
      } else {
        const listFile = path.join(segmentsDir, `concat_${broadcastId}.txt`);
        const listContent = files.map(f => `file '${path.join(segmentsDir, f)}'`).join('\n');
        fs.writeFileSync(listFile, listContent);

        await execFileAsync('ffmpeg', [
          '-f', 'concat', '-safe', '0',
          '-i', listFile,
          '-c', 'copy',
          '-movflags', '+faststart',
          outputPath,
        ], { timeout: 30 * 60 * 1000 });

        fs.unlinkSync(listFile);
      }

      const stat = fs.statSync(outputPath);

      let duration: number | null = null;
      try {
        const { stdout } = await execFileAsync('ffprobe', [
          '-v', 'quiet',
          '-show_entries', 'format=duration',
          '-of', 'default=noprint_wrappers=1:nokey=1',
          outputPath,
        ]);
        duration = Math.round(parseFloat(stdout.trim()));
      } catch { /* duration remains null */ }

      await this.prisma.recording.update({
        where: { id: recordingId },
        data: {
          status: 'ready',
          filePath: outputPath,
          fileSize: stat.size,
          duration,
        },
      });

      for (const f of files) {
        try { fs.unlinkSync(path.join(segmentsDir, f)); } catch { /* ignore */ }
      }

      this.logger.log(`Recording ${recordingId} ready: ${outputPath} (${stat.size} bytes)`);
    } catch (err: any) {
      this.logger.error(`ffmpeg conversion failed: ${err.message}`);
      await this.prisma.recording.update({
        where: { id: recordingId },
        data: { status: 'failed' },
      });
    }
  }

  async getRecordingFilePath(broadcastId: string): Promise<string> {
    const recording = await this.prisma.recording.findUnique({ where: { broadcastId } });
    if (!recording || recording.status !== 'ready' || !recording.filePath) {
      throw new NotFoundException('Recording not found or not ready');
    }
    if (!fs.existsSync(recording.filePath)) {
      throw new NotFoundException('Recording file missing from disk');
    }
    return recording.filePath;
  }

  async deleteRecordingByBroadcastId(broadcastId: string): Promise<void> {
    const recording = await this.prisma.recording.findUnique({ where: { broadcastId } });
    if (recording?.filePath) {
      try { fs.unlinkSync(recording.filePath); } catch { /* ignore */ }
    }
  }

  @Cron('0 3 * * *')
  async cleanupExpired(): Promise<void> {
    const expired = await this.prisma.recording.findMany({
      where: { expiresAt: { lt: new Date() } },
    });

    for (const rec of expired) {
      if (rec.filePath && fs.existsSync(rec.filePath)) {
        try { fs.unlinkSync(rec.filePath); } catch { /* ignore */ }
      }
      await this.prisma.recording.delete({ where: { id: rec.id } });
      this.logger.log(`Deleted expired recording ${rec.id}`);
    }
  }

  @Cron('30 3 * * *')
  async retryFailed(): Promise<void> {
    const failed = await this.prisma.recording.findMany({
      where: { status: 'failed' },
      include: { broadcast: { include: { org: true } } },
    });

    for (const rec of failed) {
      const orgSlug = rec.broadcast.org.slug;
      const segmentsDir = path.join(RECORDINGS_ROOT, 'live', orgSlug);

      if (!fs.existsSync(segmentsDir)) continue;

      const files = fs.readdirSync(segmentsDir)
        .filter(f => f.endsWith('.mp4'))
        .sort();

      if (files.length === 0) continue;

      await this.prisma.recording.update({
        where: { id: rec.id },
        data: { status: 'processing' },
      });

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

      const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.mp4'));
      for (const file of files) {
        const broadcastId = file.replace('.mp4', '');
        const recording = await this.prisma.recording.findFirst({
          where: { broadcastId, status: 'ready' },
        });
        if (!recording) {
          const filePath = path.join(dirPath, file);
          try {
            fs.unlinkSync(filePath);
            this.logger.log(`Removed orphaned file: ${filePath}`);
          } catch { /* ignore */ }
        }
      }
    }
  }
}
