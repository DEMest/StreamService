import { RecordingController } from './recording.controller';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import * as childProcess from 'child_process';

jest.mock('child_process', () => {
  const actual = jest.requireActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    default: actual,
    spawn: jest.fn(),
  };
});

const mockPrisma = {
  broadcast: { findFirst: jest.fn() },
  organization: { findFirst: jest.fn() },
  stream: { findFirst: jest.fn() },
};

const mockRecordingService = {
  getRecordingDir: jest.fn(),
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
  res.end = jest.fn();
  return res;
}

describe('RecordingController', () => {
  let controller: RecordingController;
  let spyExistsSync: jest.SpyInstance;
  let spyStatSync: jest.SpyInstance;
  let spyCreateReadStream: jest.SpyInstance;
  let spyReaddirSync: jest.SpyInstance;
  let spyWriteFileSync: jest.SpyInstance;

  beforeEach(async () => {
    jest.clearAllMocks();

    spyExistsSync = jest.spyOn(fs, 'existsSync').mockReturnValue(true as any);
    spyStatSync = jest.spyOn(fs, 'statSync').mockReturnValue({ size: 100, isDirectory: () => false } as any);
    spyCreateReadStream = jest.spyOn(fs, 'createReadStream').mockImplementation(() => {
      const stream: any = new EventEmitter();
      stream.pipe = jest.fn();
      return stream;
    });
    spyReaddirSync = jest.spyOn(fs, 'readdirSync').mockReturnValue([] as any);
    spyWriteFileSync = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);

    controller = new RecordingController(
      mockRecordingService as any,
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

  describe('serveHlsNamed (Step 4: B2 — archive HLS for named Stream)', () => {
    it('looks up broadcast with named streamSlug filter', async () => {
      const recordingDir = path.resolve('/recordings/archive/org/b1');
      mockPrisma.broadcast.findFirst.mockResolvedValue({ id: 'b1' });
      mockRecordingService.getRecordingDir.mockResolvedValue(recordingDir);

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
    });
  });

  describe('downloadRecording (fix #2: ffmpeg killed on res close)', () => {
    it('kills ffmpeg with SIGKILL when response is closed by the client', async () => {
      // Set up a fake ffmpeg child process
      const ff: any = new EventEmitter();
      ff.stdout = new EventEmitter();
      (ff.stdout as any).pipe = jest.fn();
      ff.stderr = new EventEmitter();
      ff.killed = false;
      ff.kill = jest.fn((_sig?: string) => { ff.killed = true; return true; });

      (childProcess.spawn as jest.Mock).mockReturnValue(ff);

      mockPrisma.broadcast.findFirst.mockResolvedValue({ id: 'b1', title: 'My Stream' });
      mockRecordingService.getRecordingDir.mockResolvedValue('/recordings/archive/org/b1');
      // slotDir exists and contains segments
      spyExistsSync.mockImplementation((p: any) => {
        const s = String(p);
        return s.endsWith('slot-1') || s.endsWith('original.mp4') === false;
      });
      spyReaddirSync.mockReturnValue(['seg-0001.mp4', 'seg-0002.mp4'] as any);

      const res = makeRes();
      const user = { sub: 'u1', role: 'org_admin', orgId: 'o1' } as any;

      await controller.downloadRecording(user, 'b1', res);

      // Now simulate client disconnect — emit 'close' on the response
      res.emit('close');

      expect(ff.kill).toHaveBeenCalledWith('SIGKILL');
    });
  });
});
