import { RecordingController } from './recording.controller';
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
  res.end = jest.fn();
  return res;
}

describe('RecordingController', () => {
  let controller: RecordingController;
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

    controller = new RecordingController(
      mockRecordingService as any,
      mockS3 as any,
      mockPrisma as any,
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
      await controller.serveLiveHlsNamed('org1', 'foo', 'master.m3u8', undefined, res);

      const whereArg = mockPrisma.stream.findFirst.mock.calls[0][0].where;
      expect(whereArg.slug).toBe('foo');
      expect(whereArg.org).toEqual({ slug: 'org1', isActive: true });
    });

    it('returns 404 when named Stream is not found', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue(null);

      const res = makeRes();
      await controller.serveLiveHlsNamed('org1', 'nonexistent', 'master.m3u8', undefined, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns 404 when private named Stream + wrong key', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({ isPublic: false, previewKey: 'secret' });

      const res = makeRes();
      await controller.serveLiveHlsNamed('org1', 'foo', 'master.m3u8', 'wrong', res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('allows access to private named Stream with correct key', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({ isPublic: false, previewKey: 'secret' });
      spyExistsSync.mockReturnValue(true);

      const res = makeRes();
      await controller.serveLiveHlsNamed('org1', 'foo', 'master.m3u8', 'secret', res);

      const notFoundCalls = (res.status as jest.Mock).mock.calls.filter(c => c[0] === 404);
      expect(notFoundCalls.length).toBe(0);
      expect(spyCreateReadStream).toHaveBeenCalled();
    });

    it('rejects path traversal for named Stream (liveDir = /hls/live/<org>/<stream>)', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({ isPublic: true, previewKey: null });
      const liveDirResolved = path.resolve(path.join('/hls/live', 'org1', 'foo'));
      const traversalRel = `../${path.basename(liveDirResolved)}evil/master.m3u8`;

      const res = makeRes();
      await controller.serveLiveHlsNamed('org1', 'foo', traversalRel, undefined, res);

      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe('serveHlsNamed — archive HLS presigned redirect', () => {
    it('looks up broadcast with named streamSlug filter', async () => {
      mockPrisma.broadcast.findFirst.mockResolvedValue({ id: 'b1' });
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

    it('redirects to a presigned S3 URL built from key prefix + relative path', async () => {
      mockPrisma.broadcast.findFirst.mockResolvedValue({ id: 'b1' });
      mockRecordingService.getRecordingKeyPrefix.mockResolvedValue('archive/org1/foo/b1');
      const res = makeRes();

      await controller.serveHlsNamed('org1', 'foo', 'b1', 'master.m3u8', res);

      expect(mockS3.getPresignedUrl).toHaveBeenCalledWith('archive/org1/foo/b1/master.m3u8');
      expect(res.redirect).toHaveBeenCalledWith(302, 'https://s3.example.com/signed-url');
    });

    it('rejects disallowed file extensions with 403', async () => {
      mockPrisma.broadcast.findFirst.mockResolvedValue({ id: 'b1' });
      const res = makeRes();

      await controller.serveHlsNamed('org1', 'foo', 'b1', 'evil.exe', res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.redirect).not.toHaveBeenCalled();
    });

    it('rejects paths containing ".." with 403', async () => {
      mockPrisma.broadcast.findFirst.mockResolvedValue({ id: 'b1' });
      const res = makeRes();

      await controller.serveHlsNamed('org1', 'foo', 'b1', '../../etc/passwd.mp4', res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.redirect).not.toHaveBeenCalled();
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
