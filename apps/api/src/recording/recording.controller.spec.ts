import { RecordingController } from './recording.controller';
import { LiveAccessCache } from './live-access-cache';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';

const mockPrisma = {
  broadcast: { findFirst: jest.fn() },
  organization: { findFirst: jest.fn() },
  stream: { findFirst: jest.fn() },
};

const mockRecordingService = {
  getRecordingKeyPrefix: jest.fn(),
};
const mockS3 = {
  getPresignedUrl: jest.fn().mockResolvedValue('https://s3.example.com/signed-url'),
  getObjectText: jest.fn().mockResolvedValue('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=5000000\nslot-1/index.m3u8\n'),
};

function makeRes() {
  const res: any = new EventEmitter();
  res.req = new EventEmitter();
  res.req.headers = {};
  res.req.originalUrl = '/test';
  res.statusCode = 200;
  res.headersSent = false;
  res.status = jest.fn(function (this: any, code: number) {
    this.statusCode = code;
    return this;
  });
  res.json = jest.fn(function (this: any, body: any) {
    this.jsonBody = body;
    return this;
  });
  res.setHeader = jest.fn();
  res.redirect = jest.fn();
  res.send = jest.fn();
  res.end = jest.fn();
  return res;
}

const PUBLIC_BROADCAST = { id: 'b1', stream: { isPublic: true, previewKey: null } };

describe('RecordingController', () => {
  let controller: RecordingController;
  let liveAccess: LiveAccessCache;
  let spyExistsSync: jest.SpyInstance;
  let spyStatSync: jest.SpyInstance;
  let spyCreateReadStream: jest.SpyInstance;

  beforeEach(async () => {
    jest.clearAllMocks();

    spyExistsSync = jest.spyOn(fs, 'existsSync').mockReturnValue(true as any);
    spyStatSync = jest.spyOn(fs, 'statSync').mockReturnValue({ size: 100, isDirectory: () => false } as any);
    spyCreateReadStream = jest.spyOn(fs, 'createReadStream').mockImplementation(() => {
      const stream: any = new EventEmitter();
      stream.pipe = jest.fn();
      return stream;
    });

    liveAccess = new LiveAccessCache(mockPrisma as any);
    controller = new RecordingController(
      mockRecordingService as any,
      mockS3 as any,
      mockPrisma as any,
      liveAccess,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('serveLiveHlsNamed (Step 4: B2)', () => {
    it('looks up Stream with named streamSlug filter', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({ isPublic: true, previewKey: null });
      spyExistsSync.mockReturnValue(true);

      const res = makeRes();
      await controller.serveLiveHlsNamed('org1', 'foo', 'master.m3u8', res);

      const whereArg = mockPrisma.stream.findFirst.mock.calls[0][0].where;
      expect(whereArg.slug).toBe('foo');
      expect(whereArg.org).toEqual({ slug: 'org1', isActive: true });
    });

    it('returns 404 when named Stream is not found', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue(null);

      const res = makeRes();
      await controller.serveLiveHlsNamed('org1', 'nonexistent', 'master.m3u8', res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('rejects path traversal for named Stream (liveDir = /hls/live/<org>/<stream>)', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({ isPublic: true, previewKey: null });
      const liveDirResolved = path.resolve(path.join('/hls/live', 'org1', 'foo'));
      const traversalRel = `../${path.basename(liveDirResolved)}evil/master.m3u8`;

      const res = makeRes();
      await controller.serveLiveHlsNamed('org1', 'foo', traversalRel, res);

      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe('live HLS приватного Stream\'а — ключ в пути, обычный адрес закрыт', () => {
    const KEY = 'a'.repeat(64);

    it('обычный адрес приватного Stream\'а — 404, файлы не читаются', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({ isPublic: false, previewKey: KEY });

      const res = makeRes();
      await controller.serveLiveHlsNamed('org1', 'foo', 'hd/seg00001.ts', res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(spyCreateReadStream).not.toHaveBeenCalled();
    });

    it('адрес с верным ключом отдаёт и master, и вложенные плейлисты с сегментами', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({ isPublic: false, previewKey: KEY });

      for (const file of ['master.m3u8', 'hd/index.m3u8', 'hd/seg00001.ts']) {
        const res = makeRes();
        await controller.serveLiveHlsPrivate('org1', 'foo', KEY, file, res);
        expect(res.status).not.toHaveBeenCalledWith(404);
      }
      expect(spyCreateReadStream).toHaveBeenCalledTimes(3);
    });

    it('неверный ключ — 404', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({ isPublic: false, previewKey: KEY });

      const res = makeRes();
      await controller.serveLiveHlsPrivate('org1', 'foo', 'b'.repeat(64), 'master.m3u8', res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(spyCreateReadStream).not.toHaveBeenCalled();
    });

    it('адрес с ключом у публичного Stream\'а — 404 (старая приватная ссылка гаснет)', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({ isPublic: true, previewKey: null });

      const res = makeRes();
      await controller.serveLiveHlsPrivate('org1', 'foo', KEY, 'master.m3u8', res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('после invalidate() обычный адрес закрывается сразу, без 5-секундного хвоста кэша', async () => {
      mockPrisma.stream.findFirst.mockResolvedValueOnce({ isPublic: true, previewKey: null });
      const before = makeRes();
      await controller.serveLiveHlsNamed('org1', 'foo', 'hd/seg00001.ts', before);
      expect(before.status).not.toHaveBeenCalledWith(404);

      // Организация закрыла стрим.
      mockPrisma.stream.findFirst.mockResolvedValue({ isPublic: false, previewKey: KEY });
      liveAccess.invalidate();

      const after = makeRes();
      await controller.serveLiveHlsNamed('org1', 'foo', 'hd/seg00002.ts', after);
      expect(after.status).toHaveBeenCalledWith(404);
    });
  });

  describe('serveHlsNamed — archive HLS (playlist proxy + segment presigned redirect)', () => {
    it('looks up broadcast with named streamSlug filter', async () => {
      mockPrisma.broadcast.findFirst.mockResolvedValue(PUBLIC_BROADCAST);
      mockRecordingService.getRecordingKeyPrefix.mockResolvedValue('archive/org1/foo/b1');

      const res = makeRes();
      await controller.serveHlsNamed('org1', 'foo', 'b1', 'master.m3u8', res);

      const whereArg = mockPrisma.broadcast.findFirst.mock.calls[0][0].where;
      expect(whereArg.id).toBe('b1');
      expect(whereArg.stream).toEqual({
        slug: 'foo',
        org: { slug: 'org1', isActive: true },
      });
    });

    it('returns 404 when broadcast does not exist under named Stream', async () => {
      mockPrisma.broadcast.findFirst.mockResolvedValue(null);

      const res = makeRes();
      await controller.serveHlsNamed('org1', 'foo', 'b1', 'master.m3u8', res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.redirect).not.toHaveBeenCalled();
    });

    it('PROXIES .m3u8 playlists through the API (no redirect) so relative URIs resolve against the API base', async () => {
      // Критично для играбельности: hls.js резолвит относительные URI против
      // финального URL ответа. Редирект плейлиста на S3 сломал бы подпись
      // у всех вложенных сегментов (см. serveArchiveHlsImpl JSDoc).
      mockPrisma.broadcast.findFirst.mockResolvedValue(PUBLIC_BROADCAST);
      mockRecordingService.getRecordingKeyPrefix.mockResolvedValue('archive/org1/foo/b1');
      const res = makeRes();

      await controller.serveHlsNamed('org1', 'foo', 'b1', 'master.m3u8', res);

      expect(mockS3.getObjectText).toHaveBeenCalledWith('archive/org1/foo/b1/master.m3u8');
      expect(res.send).toHaveBeenCalledWith(expect.stringContaining('#EXTM3U'));
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/vnd.apple.mpegurl');
      expect(res.redirect).not.toHaveBeenCalled();
      expect(mockS3.getPresignedUrl).not.toHaveBeenCalled();
    });

    it('returns 404 when the playlist object is missing in S3', async () => {
      mockPrisma.broadcast.findFirst.mockResolvedValue(PUBLIC_BROADCAST);
      mockRecordingService.getRecordingKeyPrefix.mockResolvedValue('archive/org1/foo/b1');
      mockS3.getObjectText.mockRejectedValueOnce(new Error('NoSuchKey'));
      const res = makeRes();

      await controller.serveHlsNamed('org1', 'foo', 'b1', 'slot-1/index.m3u8', res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.redirect).not.toHaveBeenCalled();
    });

    it('redirects SEGMENTS (.mp4) to a per-object presigned S3 URL', async () => {
      mockPrisma.broadcast.findFirst.mockResolvedValue(PUBLIC_BROADCAST);
      mockRecordingService.getRecordingKeyPrefix.mockResolvedValue('archive/org1/foo/b1');
      const res = makeRes();

      await controller.serveHlsNamed('org1', 'foo', 'b1', 'slot-1/seg-0001.mp4', res);

      expect(mockS3.getPresignedUrl).toHaveBeenCalledWith('archive/org1/foo/b1/slot-1/seg-0001.mp4');
      expect(res.redirect).toHaveBeenCalledWith(302, 'https://s3.example.com/signed-url');
      expect(mockS3.getObjectText).not.toHaveBeenCalled();
    });

    it('rejects disallowed file extensions with 403', async () => {
      mockPrisma.broadcast.findFirst.mockResolvedValue(PUBLIC_BROADCAST);
      const res = makeRes();

      await controller.serveHlsNamed('org1', 'foo', 'b1', 'evil.exe', res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.redirect).not.toHaveBeenCalled();
    });

    it('rejects paths containing ".." with 403', async () => {
      mockPrisma.broadcast.findFirst.mockResolvedValue(PUBLIC_BROADCAST);
      const res = makeRes();

      await controller.serveHlsNamed('org1', 'foo', 'b1', '../../etc/passwd.mp4', res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.redirect).not.toHaveBeenCalled();
    });
  });

  describe('serveHlsDefault — archive HLS for the org default Stream (slug=\'\')', () => {
    it('looks up broadcast with an empty streamSlug filter (default Stream)', async () => {
      mockPrisma.broadcast.findFirst.mockResolvedValue(PUBLIC_BROADCAST);
      mockRecordingService.getRecordingKeyPrefix.mockResolvedValue('archive/org1/b1');

      const res = makeRes();
      await controller.serveHlsDefault('org1', 'b1', 'master.m3u8', res);

      const whereArg = mockPrisma.broadcast.findFirst.mock.calls[0][0].where;
      expect(whereArg.id).toBe('b1');
      expect(whereArg.stream).toEqual({
        slug: '',
        org: { slug: 'org1', isActive: true },
      });
    });

    it('returns 404 when broadcast does not exist under the default Stream', async () => {
      mockPrisma.broadcast.findFirst.mockResolvedValue(null);

      const res = makeRes();
      await controller.serveHlsDefault('org1', 'b1', 'master.m3u8', res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.redirect).not.toHaveBeenCalled();
    });
  });

  describe('архив приватного Stream\'а', () => {
    const KEY = 'c'.repeat(64);
    const PRIVATE_BROADCAST = { id: 'b1', stream: { isPublic: false, previewKey: KEY } };

    it('обычный адрес — 404 и для плейлиста, и для куска download.mp4', async () => {
      mockPrisma.broadcast.findFirst.mockResolvedValue(PRIVATE_BROADCAST);

      for (const file of ['master.m3u8', 'download.mp4']) {
        const res = makeRes();
        await controller.serveHlsNamed('org1', 'foo', 'b1', file, res);
        expect(res.status).toHaveBeenCalledWith(404);
      }
      expect(mockS3.getObjectText).not.toHaveBeenCalled();
      expect(mockS3.getPresignedUrl).not.toHaveBeenCalled();
    });

    it('адрес с верным ключом отдаёт плейлист и presigned-кусок', async () => {
      mockPrisma.broadcast.findFirst.mockResolvedValue(PRIVATE_BROADCAST);
      mockRecordingService.getRecordingKeyPrefix.mockResolvedValue('archive/org1/foo/b1');

      const playlist = makeRes();
      await controller.serveHlsNamedPrivate('org1', 'foo', KEY, 'b1', 'vod.m3u8', playlist);
      expect(mockS3.getObjectText).toHaveBeenCalledWith('archive/org1/foo/b1/vod.m3u8');

      const chunk = makeRes();
      await controller.serveHlsNamedPrivate('org1', 'foo', KEY, 'b1', 'download.mp4', chunk);
      expect(chunk.redirect).toHaveBeenCalledWith(302, 'https://s3.example.com/signed-url');
    });

    it('неверный ключ — 404; дефолтный Stream орги — по тому же правилу', async () => {
      mockPrisma.broadcast.findFirst.mockResolvedValue(PRIVATE_BROADCAST);

      const named = makeRes();
      await controller.serveHlsNamedPrivate('org1', 'foo', 'd'.repeat(64), 'b1', 'master.m3u8', named);
      expect(named.status).toHaveBeenCalledWith(404);

      const defaultPublic = makeRes();
      await controller.serveHlsDefault('org1', 'b1', 'master.m3u8', defaultPublic);
      expect(defaultPublic.status).toHaveBeenCalledWith(404);

      mockRecordingService.getRecordingKeyPrefix.mockResolvedValue('archive/org1/b1');
      const defaultPrivate = makeRes();
      await controller.serveHlsDefaultPrivate('org1', KEY, 'b1', 'master.m3u8', defaultPrivate);
      expect(defaultPrivate.status).not.toHaveBeenCalledWith(404);
    });
  });

  describe('downloadRecording — presigned redirect to pre-built MP4', () => {
    it('returns 404 when broadcast does not exist for this org', async () => {
      mockPrisma.broadcast.findFirst.mockResolvedValue(null);
      const res = makeRes();

      const user = { sub: 'u1', role: 'org_admin', orgId: 'o1' } as any;
      await controller.downloadRecording(user, 'b1', res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('redirects to a presigned URL for download.mp4 with a content-disposition filename', async () => {
      mockPrisma.broadcast.findFirst.mockResolvedValue({ id: 'b1', title: 'My Stream' });
      mockRecordingService.getRecordingKeyPrefix.mockResolvedValue('archive/org/b1');
      const res = makeRes();

      const user = { sub: 'u1', role: 'org_admin', orgId: 'o1' } as any;
      await controller.downloadRecording(user, 'b1', res);

      expect(mockPrisma.broadcast.findFirst).toHaveBeenCalledWith({
        where: { id: 'b1', stream: { orgId: 'o1' } },
      });
      expect(mockS3.getPresignedUrl).toHaveBeenCalledWith('archive/org/b1/download.mp4', {
        responseContentDisposition: expect.stringContaining('attachment'),
      });
      expect(res.redirect).toHaveBeenCalledWith(302, 'https://s3.example.com/signed-url');
    });
  });
});
