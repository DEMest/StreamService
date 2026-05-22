import { Test } from '@nestjs/testing';
import { RecordingService } from './recording.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

// We mock child_process with actual module spread to avoid breaking Prisma's node:child_process.
// The execFile mock here is not used directly — instead we spy on service.probeMp4 below.
jest.mock('child_process', () => {
  const actual = jest.requireActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    default: actual,
  };
});

const mockPrisma = {
  recording: {
    create: jest.fn(),
    update: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    delete: jest.fn(),
  },
};

describe('RecordingService', () => {
  let service: RecordingService;

  // fs spies per-test
  let spyExistsSync: jest.SpyInstance;
  let spyReaddirSync: jest.SpyInstance;
  let spyMkdirSync: jest.SpyInstance;
  let spyRenameSync: jest.SpyInstance;
  let spyWriteFileSync: jest.SpyInstance;
  let spyStatSync: jest.SpyInstance;
  let spyRmSync: jest.SpyInstance;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Spy on individual fs methods — avoids breaking Prisma platform detection
    spyExistsSync = jest.spyOn(fs, 'existsSync').mockReturnValue(false as any);
    spyReaddirSync = jest.spyOn(fs, 'readdirSync').mockReturnValue([] as any);
    spyMkdirSync = jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined as any);
    spyRenameSync = jest.spyOn(fs, 'renameSync').mockImplementation(() => undefined);
    spyWriteFileSync = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
    spyStatSync = jest.spyOn(fs, 'statSync').mockReturnValue({ size: 0, isDirectory: () => false } as any);
    spyRmSync = jest.spyOn(fs, 'rmSync').mockImplementation(() => undefined);

    const module = await Test.createTestingModule({
      providers: [
        RecordingService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(RecordingService);

    // Spy on private probeMp4 to avoid needing a real ffprobe binary
    jest.spyOn(service as any, 'probeMp4').mockResolvedValue({
      duration: 10.5,
      width: 1920,
      height: 1080,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('onStreamEnded', () => {
    it('creates Recording with slotIndex:1 when segments exist', async () => {
      spyExistsSync.mockReturnValue(true);
      spyReaddirSync.mockImplementation((_p: any, opts?: any) => {
        if (opts && (opts as any).withFileTypes) return [];
        return ['seg-001.mp4', 'seg-002.mp4'] as any;
      });

      mockPrisma.recording.create.mockResolvedValue({ id: 'r1', slotIndex: 1 });
      mockPrisma.recording.update.mockResolvedValue({});

      await service.onStreamEnded('bcast1', 'org1');
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setImmediate(r));
      }

      expect(mockPrisma.recording.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            broadcastId: 'bcast1',
            slotIndex: 1,
            status: 'processing',
          }),
        }),
      );
    });

    it('skips when segments directory does not exist', async () => {
      spyExistsSync.mockReturnValue(false);
      await service.onStreamEnded('bcast1', 'org1');
      expect(mockPrisma.recording.create).not.toHaveBeenCalled();
    });

    it('skips when segments directory is empty (no mp4 files)', async () => {
      spyExistsSync.mockReturnValue(true);
      spyReaddirSync.mockReturnValue([] as any);
      await service.onStreamEnded('bcast1', 'org1');
      expect(mockPrisma.recording.create).not.toHaveBeenCalled();
    });

    it('updates Recording with status ready and manifestPath ending in master.m3u8 after conversion', async () => {
      spyExistsSync.mockReturnValue(true);
      spyReaddirSync.mockImplementation((_p: any, opts?: any) => {
        if (opts && (opts as any).withFileTypes) return [];
        return ['seg-001.mp4'] as any;
      });

      mockPrisma.recording.create.mockResolvedValue({ id: 'r2', slotIndex: 1 });
      mockPrisma.recording.update.mockResolvedValue({});

      await service.onStreamEnded('bcast2', 'orgA');
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setImmediate(r));
      }

      expect(mockPrisma.recording.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'r2' },
          data: expect.objectContaining({
            status: 'ready',
            manifestPath: expect.stringContaining('master.m3u8'),
          }),
        }),
      );
    });

    it('composite mode (slotCount=1) creates exactly one Recording with slotIndex=1', async () => {
      spyExistsSync.mockReturnValue(true);
      spyReaddirSync.mockImplementation((_p: any, opts?: any) => {
        if (opts && (opts as any).withFileTypes) return [];
        return ['seg-001.mp4'] as any;
      });

      let nextId = 1;
      mockPrisma.recording.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: `r${nextId++}`, slotIndex: data.slotIndex }),
      );
      mockPrisma.recording.update.mockResolvedValue({});

      await service.onStreamEnded('bcast-comp', 'org1', 'composite', 1);
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setImmediate(r));
      }

      expect(mockPrisma.recording.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.recording.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            broadcastId: 'bcast-comp',
            slotIndex: 1,
            status: 'processing',
          }),
        }),
      );
    });

    it('multistream mode skips empty/missing slot dirs and creates Recording only for publishing slots', async () => {
      // slotCount=4. Только slot-1 и slot-3 имеют сегменты; slot-2 missing, slot-4 пустая.
      const slotDir = (n: number) => path.join('/recordings', 'live', 'org1', String(n));
      const presentDirs = new Set<string>([slotDir(1), slotDir(3)]);
      const emptyDirs = new Set<string>([slotDir(4)]);
      const missingDirs = new Set<string>([slotDir(2)]);

      spyExistsSync.mockImplementation((p: any) => {
        const s = String(p);
        if (missingDirs.has(s)) return false;
        return true;
      });
      spyReaddirSync.mockImplementation((p: any, opts?: any) => {
        if (opts && (opts as any).withFileTypes) return [];
        const s = String(p);
        if (presentDirs.has(s)) return ['seg-001.mp4'] as any;
        if (emptyDirs.has(s)) return [] as any;
        return [] as any;
      });

      let nextId = 1;
      const createCalls: any[] = [];
      mockPrisma.recording.create.mockImplementation(({ data }: any) => {
        createCalls.push(data);
        return Promise.resolve({ id: `r${nextId++}`, slotIndex: data.slotIndex });
      });
      mockPrisma.recording.update.mockResolvedValue({});

      await service.onStreamEnded('bcast-multi', 'org1', 'multistream', 4);
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setImmediate(r));
      }

      // Exactly two Recording'а — для slot 1 и slot 3
      expect(createCalls).toHaveLength(2);
      expect(createCalls.map((c) => c.slotIndex).sort()).toEqual([1, 3]);
      expect(createCalls.every((c) => c.broadcastId === 'bcast-multi' && c.status === 'processing')).toBe(true);
    });

    it('multistream master.m3u8 contains one EXT-X-STREAM-INF per publishing slot', async () => {
      // Same setup: slot 1 and 3 publishing
      const slotDir = (n: number) => path.join('/recordings', 'live', 'org1', String(n));
      const presentDirs = new Set<string>([slotDir(1), slotDir(3)]);
      const missingDirs = new Set<string>([slotDir(2), slotDir(4)]);

      spyExistsSync.mockImplementation((p: any) => {
        const s = String(p);
        if (missingDirs.has(s)) return false;
        return true;
      });
      spyReaddirSync.mockImplementation((p: any, opts?: any) => {
        if (opts && (opts as any).withFileTypes) return [];
        const s = String(p);
        if (presentDirs.has(s)) return ['seg-001.mp4'] as any;
        return [] as any;
      });

      let nextId = 1;
      mockPrisma.recording.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: `r${nextId++}`, slotIndex: data.slotIndex }),
      );
      mockPrisma.recording.update.mockResolvedValue({});

      const masterWrites: string[] = [];
      spyWriteFileSync.mockImplementation((p: any, content: any) => {
        if (String(p).endsWith('master.m3u8')) {
          masterWrites.push(String(content));
        }
      });

      await service.onStreamEnded('bcast-multi-master', 'org1', 'multistream', 4);
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setImmediate(r));
      }

      expect(masterWrites.length).toBeGreaterThan(0);
      const lastMaster = masterWrites[masterWrites.length - 1];
      const streamInfMatches = lastMaster.match(/#EXT-X-STREAM-INF/g) || [];
      expect(streamInfMatches.length).toBe(2);
      expect(lastMaster).toContain('slot-1/index.m3u8');
      expect(lastMaster).toContain('slot-3/index.m3u8');
      expect(lastMaster).not.toContain('slot-2/index.m3u8');
      expect(lastMaster).not.toContain('slot-4/index.m3u8');
    });

    it('multistream returns without creating Recording when all slot dirs are empty/missing', async () => {
      const liveRoot = path.join('/recordings', 'live', 'org1');
      spyExistsSync.mockImplementation((p: any) => {
        const s = String(p);
        // Все slot-dirs под /recordings/live/org1 отсутствуют.
        if (s.startsWith(liveRoot + path.sep) || s === liveRoot) return false;
        return true;
      });
      spyReaddirSync.mockReturnValue([] as any);

      await service.onStreamEnded('bcast-empty', 'org1', 'multistream', 4);
      expect(mockPrisma.recording.create).not.toHaveBeenCalled();
    });

    it('multistream fileSize counts only slot-N dir contents (not whole broadcastDir)', async () => {
      // Один publishing slot — slot 1. Проверим что getDirSize вызывается на slot-1 dir,
      // не на broadcastDir; иначе при множественных slot'ах получили бы over-counting.
      const liveSlotDir = path.join('/recordings', 'live', 'org1', '1');
      const presentDirs = new Set<string>([liveSlotDir]);

      spyExistsSync.mockReturnValue(true);

      const sizedPaths: string[] = [];
      spyReaddirSync.mockImplementation((p: any, opts?: any) => {
        const s = String(p);
        if (opts && (opts as any).withFileTypes) {
          // getDirSize: запоминаем путь, по которому рекурсивный обход
          sizedPaths.push(s);
          return [{ name: 'seg-0001.mp4', isDirectory: () => false } as any];
        }
        if (presentDirs.has(s)) return ['seg-001.mp4'] as any;
        return [] as any;
      });
      spyStatSync.mockReturnValue({ size: 1024, isDirectory: () => false } as any);

      mockPrisma.recording.create.mockResolvedValue({ id: 'rsize', slotIndex: 1 });
      mockPrisma.recording.update.mockResolvedValue({});

      await service.onStreamEnded('bcast-size', 'org1', 'multistream', 1);
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setImmediate(r));
      }

      // getDirSize должен пройти по slot-1 dir, не по broadcastDir.
      const broadcastDirArch = path.join('/recordings', 'archive', 'org1', 'bcast-size');
      const slotDirArch = path.join(broadcastDirArch, 'slot-1');
      expect(sizedPaths).toContain(slotDirArch);
      expect(sizedPaths).not.toContain(broadcastDirArch);
    });
  });

  describe('getRecordingDir', () => {
    it('uses compound unique key broadcastId_slotIndex', async () => {
      mockPrisma.recording.findUnique.mockResolvedValue(null);
      await expect(service.getRecordingDir('bcast1', 1)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.recording.findUnique).toHaveBeenCalledWith({
        where: { broadcastId_slotIndex: { broadcastId: 'bcast1', slotIndex: 1 } },
      });
    });

    it('defaults slotIndex to 1 when not provided', async () => {
      mockPrisma.recording.findUnique.mockResolvedValue(null);
      await expect(service.getRecordingDir('bcast1')).rejects.toThrow(NotFoundException);
      expect(mockPrisma.recording.findUnique).toHaveBeenCalledWith({
        where: { broadcastId_slotIndex: { broadcastId: 'bcast1', slotIndex: 1 } },
      });
    });

    it('throws NotFoundException when recording is not ready', async () => {
      mockPrisma.recording.findUnique.mockResolvedValue({
        id: '1', broadcastId: 'b1', slotIndex: 1, status: 'processing', manifestPath: null,
      });
      await expect(service.getRecordingDir('b1', 1)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when recording directory missing from disk', async () => {
      mockPrisma.recording.findUnique.mockResolvedValue({
        id: '1', broadcastId: 'b1', slotIndex: 1, status: 'ready',
        manifestPath: '/recordings/archive/org/b1/master.m3u8',
      });
      spyExistsSync.mockReturnValue(false);
      await expect(service.getRecordingDir('b1', 1)).rejects.toThrow(NotFoundException);
    });

    it('returns broadcast directory when recording is ready and dir exists', async () => {
      mockPrisma.recording.findUnique.mockResolvedValue({
        id: '1', broadcastId: 'b1', slotIndex: 1, status: 'ready',
        manifestPath: '/recordings/archive/org/b1/master.m3u8',
      });
      spyExistsSync.mockReturnValue(true);
      const dir = await service.getRecordingDir('b1', 1);
      expect(dir).toBe('/recordings/archive/org/b1');
    });
  });

  describe('deleteRecordingByBroadcastId', () => {
    it('uses findMany since broadcastId is no longer unique', async () => {
      mockPrisma.recording.findMany.mockResolvedValue([]);
      await service.deleteRecordingByBroadcastId('bcast1');
      expect(mockPrisma.recording.findMany).toHaveBeenCalledWith({ where: { broadcastId: 'bcast1' } });
    });

    it('does nothing when no recordings exist', async () => {
      mockPrisma.recording.findMany.mockResolvedValue([]);
      await expect(service.deleteRecordingByBroadcastId('none')).resolves.not.toThrow();
    });

    it('calls rmSync for recordings with a manifestPath', async () => {
      mockPrisma.recording.findMany.mockResolvedValue([
        { id: 'r1', manifestPath: '/recordings/archive/org/bcast1/master.m3u8' },
        { id: 'r2', manifestPath: null },
      ]);
      await service.deleteRecordingByBroadcastId('bcast1');
      expect(spyRmSync).toHaveBeenCalledWith(
        '/recordings/archive/org/bcast1',
        { recursive: true, force: true },
      );
      expect(spyRmSync).toHaveBeenCalledTimes(1);
    });
  });

  describe('retryFailed', () => {
    it('skips recordings where broadcast.stream is null', async () => {
      mockPrisma.recording.findMany.mockResolvedValue([
        {
          id: 'rec1',
          broadcastId: 'b1',
          slotIndex: 1,
          status: 'failed',
          broadcast: { stream: null },
        },
      ]);
      await expect(service.retryFailed()).resolves.not.toThrow();
      expect(mockPrisma.recording.update).not.toHaveBeenCalled();
    });
  });

  describe('onModuleInit', () => {
    it('does not delete broadcast directory when a recording row exists in processing status', async () => {
      // ARCHIVE_ROOT exists, contains one org dir with one broadcast dir
      spyExistsSync.mockReturnValue(true);
      let call = 0;
      spyReaddirSync.mockImplementation((_p: any, _opts?: any) => {
        call++;
        if (call === 1) {
          // ARCHIVE_ROOT readdir — return org dirent
          return [{ name: 'org1', isDirectory: () => true } as any];
        }
        // org dir readdir — return broadcast dirent
        return [{ name: 'bcast-processing', isDirectory: () => true } as any];
      });

      // Recording exists in processing status (no ready filter required)
      mockPrisma.recording.findFirst.mockResolvedValue({
        id: 'r1',
        broadcastId: 'bcast-processing',
        status: 'processing',
      });

      await service.onModuleInit();

      // findFirst must be called WITHOUT a status filter — Karen's fix #1
      expect(mockPrisma.recording.findFirst).toHaveBeenCalledWith({
        where: { broadcastId: 'bcast-processing' },
      });
      // No directory removal must happen
      expect(spyRmSync).not.toHaveBeenCalled();
    });

    it('removes orphan broadcast directory when no recording row exists in DB', async () => {
      spyExistsSync.mockReturnValue(true);
      let call = 0;
      spyReaddirSync.mockImplementation((_p: any, _opts?: any) => {
        call++;
        if (call === 1) {
          return [{ name: 'org1', isDirectory: () => true } as any];
        }
        return [{ name: 'bcast-orphan', isDirectory: () => true } as any];
      });

      mockPrisma.recording.findFirst.mockResolvedValue(null);

      await service.onModuleInit();

      expect(spyRmSync).toHaveBeenCalledWith(
        expect.stringContaining('bcast-orphan'),
        { recursive: true, force: true },
      );
    });
  });
});
