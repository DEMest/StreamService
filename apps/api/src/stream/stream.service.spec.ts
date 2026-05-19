import { Test } from '@nestjs/testing';
import { StreamService } from './stream.service';
import { PrismaService } from '../prisma/prisma.service';
import { MediamtxService } from '../mediamtx/mediamtx.service';
import { RecordingService } from '../recording/recording.service';
import { NotFoundException } from '@nestjs/common';

const mockPrisma = {
  stream: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
  broadcast: {
    create: jest.fn(),
    update: jest.fn(),
  },
};
const mockMediamtx = { patchPath: jest.fn(), addPath: jest.fn() };
const mockRecording = { onStreamEnded: jest.fn() };

describe('StreamService', () => {
  let service: StreamService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        StreamService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MediamtxService, useValue: mockMediamtx },
        { provide: RecordingService, useValue: mockRecording },
      ],
    }).compile();
    service = module.get(StreamService);
  });

  describe('getDefaultStream', () => {
    it('returns default Stream of org', async () => {
      mockPrisma.stream.findUnique.mockResolvedValue({ id: 's1', orgId: 'o1', slug: '' });
      const r = await service.getDefaultStream('o1');
      expect(r.id).toBe('s1');
      expect(mockPrisma.stream.findUnique).toHaveBeenCalledWith({
        where: { orgId_slug: { orgId: 'o1', slug: '' } },
      });
    });

    it('throws NotFoundException if no default Stream', async () => {
      mockPrisma.stream.findUnique.mockResolvedValue(null);
      await expect(service.getDefaultStream('o1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('rotateKey', () => {
    it('regenerates ingestKey and calls mediamtx.patchPath with stream path', async () => {
      // getStreamWithOrg uses findUnique with include: { org } — mock must return org relation
      mockPrisma.stream.findUnique.mockResolvedValue({
        id: 's1', orgId: 'o1', slug: '', org: { slug: 'club' },
      });
      mockPrisma.stream.update.mockResolvedValue({
        id: 's1', orgId: 'o1', slug: '', ingestKey: 'newkey', ingestKeyCreatedAt: new Date(),
      });
      const result = await service.rotateKey('s1');
      expect(mockMediamtx.patchPath).toHaveBeenCalledWith(expect.any(String), expect.any(String));
      const [pathArg] = mockMediamtx.patchPath.mock.calls[0];
      // для default stream (slug='') путь = '<orgSlug>'; но getStream не знает orgSlug — резолвим через org-relation
      expect(typeof pathArg).toBe('string');
      expect(result.ingestKey).toBeDefined();
    });
  });

  describe('updateSettings', () => {
    it('updates editable fields and generates previewKey when isPublic=false', async () => {
      mockPrisma.stream.findUnique.mockResolvedValue({ id: 's1', previewKey: null });
      mockPrisma.stream.update.mockResolvedValue({
        id: 's1', isPublic: false, previewKey: 'genkey', previewMode: 'cam1',
      });
      const r = await service.updateSettings('s1', { isPublic: false, previewMode: 'cam1' });
      expect(mockPrisma.stream.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 's1' },
        data: expect.objectContaining({
          isPublic: false,
          previewMode: 'cam1',
          previewKey: expect.any(String),
        }),
      }));
      expect(r.previewKey).toBeDefined();
    });

    it('clears previewKey when isPublic=true', async () => {
      mockPrisma.stream.update.mockResolvedValue({ id: 's1', isPublic: true, previewKey: null });
      await service.updateSettings('s1', { isPublic: true });
      expect(mockPrisma.stream.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ isPublic: true, previewKey: null }),
      }));
    });
  });

  describe('startBroadcast', () => {
    it('creates Broadcast and sets stream.isLive=true', async () => {
      mockPrisma.stream.findUnique.mockResolvedValue({
        id: 's1', name: 'My Stream', description: null, isLive: false,
      });
      mockPrisma.broadcast.create.mockResolvedValue({ id: 'b1' });
      mockPrisma.stream.update.mockResolvedValue({});

      const r = await service.startBroadcast('s1');
      expect(mockPrisma.broadcast.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ streamId: 's1', title: 'My Stream' }),
      }));
      expect(mockPrisma.stream.update).toHaveBeenCalledWith(expect.objectContaining({
        data: { isLive: true, currentBroadcastId: 'b1' },
      }));
      expect(r).toEqual({ ok: true, broadcastId: 'b1' });
    });

    it('returns alreadyLive when stream is already live', async () => {
      mockPrisma.stream.findUnique.mockResolvedValue({ id: 's1', isLive: true });
      const r = await service.startBroadcast('s1');
      expect(r).toEqual({ alreadyLive: true });
      expect(mockPrisma.broadcast.create).not.toHaveBeenCalled();
    });
  });

  describe('endBroadcast', () => {
    it('closes broadcast and triggers recording', async () => {
      mockPrisma.stream.findUnique.mockResolvedValue({
        id: 's1', orgId: 'o1', slug: '', isLive: true, currentBroadcastId: 'b1',
        org: { slug: 'myorg' },
      });
      mockPrisma.broadcast.update.mockResolvedValue({});
      mockPrisma.stream.update.mockResolvedValue({});

      const r = await service.endBroadcast('s1');
      expect(mockPrisma.broadcast.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'b1' },
        data: expect.objectContaining({ endedAt: expect.any(Date) }),
      }));
      expect(mockPrisma.stream.update).toHaveBeenCalledWith(expect.objectContaining({
        data: { isLive: false, currentBroadcastId: null },
      }));
      expect(mockRecording.onStreamEnded).toHaveBeenCalled();
      expect(r).toEqual({ ok: true });
    });

    it('returns alreadyOff when stream not live', async () => {
      mockPrisma.stream.findUnique.mockResolvedValue({
        id: 's1', isLive: false, currentBroadcastId: null,
      });
      const r = await service.endBroadcast('s1');
      expect(r).toEqual({ alreadyOff: true });
    });
  });

  describe('resolvePathToStream', () => {
    it('resolves "live/<orgSlug>" to default Stream', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({ id: 's1', slug: '' });
      const r = await service.resolvePathToStream('live/myorg');
      expect(r?.id).toBe('s1');
      expect(mockPrisma.stream.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          slug: '',
          org: { slug: 'myorg' },
        }),
      }));
    });

    it('returns null for invalid path', async () => {
      const r = await service.resolvePathToStream('garbage');
      expect(r).toBeNull();
    });
  });
});
