import { ThumbnailService } from './thumbnail.service';

describe('ThumbnailService', () => {
  let service: ThumbnailService;

  beforeEach(() => {
    service = new ThumbnailService();
  });

  describe('buildFfmpegArgs', () => {
    it('should return full-frame args for multicam mode', () => {
      const args = service.buildFfmpegArgs('http://mediamtx:8888/hls/live/test-org/index.m3u8', 'multicam');
      expect(args).toEqual([
        '-i', 'http://mediamtx:8888/hls/live/test-org/index.m3u8',
        '-vframes', '1',
        '-f', 'image2',
        '-y',
        'pipe:1',
      ]);
    });

    it('should add crop filter for cam1', () => {
      const args = service.buildFfmpegArgs('http://mediamtx:8888/hls/live/test-org/index.m3u8', 'cam1');
      expect(args).toContain('-vf');
      expect(args).toContain('crop=iw/2:ih/2:0:0');
    });

    it('should add crop filter for cam2', () => {
      const args = service.buildFfmpegArgs('http://mediamtx:8888/hls/live/test-org/index.m3u8', 'cam2');
      expect(args).toContain('crop=iw/2:ih/2:iw/2:0');
    });

    it('should add crop filter for cam3', () => {
      const args = service.buildFfmpegArgs('http://mediamtx:8888/hls/live/test-org/index.m3u8', 'cam3');
      expect(args).toContain('crop=iw/2:ih/2:0:ih/2');
    });

    it('should add crop filter for cam4', () => {
      const args = service.buildFfmpegArgs('http://mediamtx:8888/hls/live/test-org/index.m3u8', 'cam4');
      expect(args).toContain('crop=iw/2:ih/2:iw/2:ih/2');
    });
  });

  describe('cache', () => {
    it('should return null for cache miss', () => {
      expect(service.getCached('nonexistent')).toBeNull();
    });

    it('should return cached buffer within TTL', () => {
      const buf = Buffer.from('test');
      service.setCache('org1', buf);
      expect(service.getCached('org1')).toEqual(buf);
    });

    it('should return null for expired cache', () => {
      const buf = Buffer.from('test');
      service.setCache('org1', buf, Date.now() - 31_000);
      expect(service.getCached('org1')).toBeNull();
    });
  });
});
