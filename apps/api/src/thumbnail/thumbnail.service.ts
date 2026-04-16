import { Injectable } from '@nestjs/common';
import { execFile } from 'child_process';

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
  private cache = new Map<string, CacheEntry>();

  buildFfmpegArgs(hlsUrl: string, mode: string): string[] {
    const args = ['-i', hlsUrl];
    const crop = CROP_FILTERS[mode];
    if (crop) {
      args.push('-vf', crop);
    }
    args.push('-vframes', '1', '-f', 'image2', '-y', 'pipe:1');
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

  async captureFrame(hlsUrl: string, mode: string): Promise<Buffer> {
    const args = this.buildFfmpegArgs(hlsUrl, mode);
    return new Promise((resolve, reject) => {
      execFile('ffmpeg', args, { encoding: 'buffer', maxBuffer: 5 * 1024 * 1024 }, (err, stdout) => {
        if (err) return reject(err);
        resolve(stdout as unknown as Buffer);
      });
    });
  }

  async getSnapshot(slug: string, mode: string): Promise<Buffer | null> {
    const cached = this.getCached(slug);
    if (cached) return cached;

    const hlsUrl = `http://mediamtx:8888/hls/live/${slug}/index.m3u8`;
    try {
      const buf = await this.captureFrame(hlsUrl, mode);
      this.setCache(slug, buf);
      return buf;
    } catch {
      return null;
    }
  }
}
