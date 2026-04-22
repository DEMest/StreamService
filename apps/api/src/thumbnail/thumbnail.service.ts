import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { existsSync } from 'fs';

const CROP_FILTERS: Record<string, string> = {
  cam1: 'crop=iw/2:ih/2:0:0',
  cam2: 'crop=iw/2:ih/2:iw/2:0',
  cam3: 'crop=iw/2:ih/2:0:ih/2',
  cam4: 'crop=iw/2:ih/2:iw/2:ih/2',
};

const CACHE_TTL_MS = 30_000;

interface CacheEntry {
  buffer: Buffer;
  timestamp: number;
}

@Injectable()
export class ThumbnailService {
  private readonly logger = new Logger(ThumbnailService.name);
  private cache = new Map<string, CacheEntry>();

  buildFfmpegArgs(hlsPath: string, mode: string): string[] {
    const args = ['-y', '-i', hlsPath];
    const crop = CROP_FILTERS[mode];
    if (crop) {
      args.push('-vf', crop);
    }
    args.push('-vframes', '1', '-q:v', '5', '-f', 'image2', 'pipe:1');
    return args;
  }

  getCached(slug: string): Buffer | null {
    const entry = this.cache.get(slug);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
      this.cache.delete(slug);
      return null;
    }
    return entry.buffer;
  }

  setCache(slug: string, buffer: Buffer, timestamp?: number): void {
    this.cache.set(slug, { buffer, timestamp: timestamp ?? Date.now() });
  }

  async captureFrame(hlsPath: string, mode: string): Promise<Buffer> {
    const args = this.buildFfmpegArgs(hlsPath, mode);
    return new Promise((resolve, reject) => {
      execFile('ffmpeg', args, { encoding: 'buffer', maxBuffer: 5 * 1024 * 1024, timeout: 10_000 }, (err, stdout) => {
        if (err) return reject(err);
        resolve(stdout as unknown as Buffer);
      });
    });
  }

  async getSnapshot(slug: string, mode: string): Promise<Buffer | null> {
    const cached = this.getCached(slug);
    if (cached) return cached;

    const hlsPath = `/hls/live/${slug}/hd/index.m3u8`;
    if (!existsSync(hlsPath)) {
      this.logger.warn(`HLS playlist not found: ${hlsPath}`);
      return null;
    }

    try {
      const buf = await this.captureFrame(hlsPath, mode);
      this.setCache(slug, buf);
      return buf;
    } catch (err) {
      this.logger.warn(`Frame capture failed for ${slug} (${mode}): ${err}`);
      return null;
    }
  }
}
