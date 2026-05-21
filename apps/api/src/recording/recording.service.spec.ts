import { Test } from '@nestjs/testing';
import { RecordingService } from './recording.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';
import * as fs from 'fs';

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
});
