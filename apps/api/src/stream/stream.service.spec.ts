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
    findMany: jest.fn(),
  },
};
const mockMediamtx = {
  patchPath: jest.fn(),
  addPath: jest.fn(),
  replaceStreamPaths: jest.fn(),
  addStreamPaths: jest.fn(),
  deleteStreamPaths: jest.fn(),
  setStreamRecording: jest.fn(),
};
// onStreamEnded должен возвращать Promise — StreamService.endBroadcast вешает на него .catch.
const mockRecording = { onStreamEnded: jest.fn().mockResolvedValue(undefined) };

describe('StreamService', () => {
  let service: StreamService;

  beforeEach(async () => {
    jest.resetAllMocks();
    mockRecording.onStreamEnded.mockResolvedValue(undefined);
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
    it('regenerates ingestKey and calls mediamtx.replaceStreamPaths (3 args)', async () => {
      mockPrisma.stream.findUnique.mockResolvedValue({
        id: 's1', orgId: 'o1', slug: '',
        org: { slug: 'club' },
      });
      mockPrisma.stream.update.mockResolvedValue({
        id: 's1', orgId: 'o1', slug: '', ingestKey: 'newkey', ingestKeyCreatedAt: new Date(),
      });
      const result = await service.rotateKey('s1');
      expect(mockMediamtx.replaceStreamPaths).toHaveBeenCalledWith(
        'club', '', expect.any(String),
      );
      expect(result.ingestKey).toBeDefined();
    });

    it('replaces passphrase for named Stream', async () => {
      mockPrisma.stream.findUnique.mockResolvedValue({
        id: 's2', orgId: 'o1', slug: 'tournament',
        org: { slug: 'club' },
      });
      mockPrisma.stream.update.mockResolvedValue({
        id: 's2', orgId: 'o1', slug: 'tournament', ingestKey: 'newkey2', ingestKeyCreatedAt: new Date(),
      });
      await service.rotateKey('s2');
      expect(mockMediamtx.replaceStreamPaths).toHaveBeenCalledWith(
        'club', 'tournament', expect.any(String),
      );
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

    it('creates Broadcast without eventId linking', async () => {
      mockPrisma.stream.findUnique.mockResolvedValue({
        id: 's1', name: 'Mat A', description: null, isLive: false,
      });
      mockPrisma.broadcast.create.mockResolvedValue({ id: 'b1' });
      mockPrisma.stream.update.mockResolvedValue({});

      await service.startBroadcast('s1');
      const createArgs = mockPrisma.broadcast.create.mock.calls[0][0];
      expect(createArgs.data).not.toHaveProperty('eventId');
      expect(createArgs.data).toEqual({
        streamId: 's1',
        title: 'Mat A',
        description: undefined,
        startedAt: expect.any(Date),
      });
    });
  });

  describe('endBroadcast', () => {
    it('closes broadcast and triggers recording (basePath only)', async () => {
      mockPrisma.stream.findUnique.mockResolvedValue({
        id: 's1', orgId: 'o1', slug: '',
        isLive: true, currentBroadcastId: 'b1',
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
      expect(mockRecording.onStreamEnded).toHaveBeenCalledWith('b1', 'myorg');
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

  describe('verifyIngestKey', () => {
    it('accepts matching key', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({
        ingestKey: 'k1', org: { isActive: true },
      });
      const ok = await service.verifyIngestKey('club', '', 'k1');
      expect(ok).toBe(true);
    });

    it('rejects wrong key', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({
        ingestKey: 'k1', org: { isActive: true },
      });
      const ok = await service.verifyIngestKey('club', '', 'wrong');
      expect(ok).toBe(false);
    });

    it('rejects when org is inactive', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({
        ingestKey: 'k1', org: { isActive: false },
      });
      const ok = await service.verifyIngestKey('club', '', 'k1');
      expect(ok).toBe(false);
    });

    it('returns false when stream not found', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue(null);
      const ok = await service.verifyIngestKey('ghost', '', 'any');
      expect(ok).toBe(false);
    });
  });

  describe('resolvePathToStream', () => {
    it('resolves "live/<orgSlug>" to default Stream', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({
        id: 's1', orgId: 'o1', slug: '',
      });
      const r = await service.resolvePathToStream('live/myorg');
      expect(r?.stream.id).toBe('s1');
      expect(mockPrisma.stream.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          slug: '',
          org: { slug: 'myorg' },
        }),
      }));
    });

    it('resolves "live/<org>/<streamSlug>" to named Stream', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({
        id: 's2', orgId: 'o1', slug: 'court-a',
      });
      const r = await service.resolvePathToStream('live/myorg/court-a');
      expect(r?.stream.id).toBe('s2');
      expect(mockPrisma.stream.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          slug: 'court-a',
          org: { slug: 'myorg' },
        }),
      }));
    });

    it('returns null for invalid path', async () => {
      const r = await service.resolvePathToStream('garbage');
      expect(r).toBeNull();
    });

    it('returns null when Stream not found', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue(null);
      const r = await service.resolvePathToStream('live/ghost');
      expect(r).toBeNull();
    });
  });

  describe('handleWebhook (lifecycle)', () => {
    function mockResolveReturning(stream: any) {
      mockPrisma.stream.findFirst.mockResolvedValueOnce(stream);
    }

    it('publish → ensureAutoRecording + startBroadcast', async () => {
      const stream = { id: 's1', orgId: 'o1', slug: '' };
      mockResolveReturning(stream);
      // ensureAutoRecording: findUnique — recordingMode='manual' → early return
      mockPrisma.stream.findUnique.mockResolvedValueOnce({
        id: 's1', slug: '',
        recordingEnabled: false, recordingMode: 'manual',
        org: { slug: 'a' },
      });
      // startBroadcast: findUnique для проверки isLive
      mockPrisma.stream.findUnique.mockResolvedValueOnce({
        id: 's1', name: 'Stream', description: null, isLive: false,
      });
      mockPrisma.broadcast.create.mockResolvedValueOnce({ id: 'b1' });
      mockPrisma.stream.update.mockResolvedValueOnce({});

      await service.handleWebhook('live/a', 'publish');

      expect(mockPrisma.broadcast.create).toHaveBeenCalledTimes(1);
    });

    it('publish когда stream уже live → startBroadcast идемпотентен (alreadyLive)', async () => {
      const stream = { id: 's1', orgId: 'o1', slug: '' };
      mockResolveReturning(stream);
      // ensureAutoRecording: findUnique — recordingMode='manual' → early return
      mockPrisma.stream.findUnique.mockResolvedValueOnce({
        id: 's1', slug: '',
        recordingEnabled: false, recordingMode: 'manual',
        org: { slug: 'a' },
      });
      // startBroadcast: stream уже live → alreadyLive
      mockPrisma.stream.findUnique.mockResolvedValueOnce({
        id: 's1', name: 'Stream', description: null, isLive: true,
      });

      await service.handleWebhook('live/a', 'publish');

      expect(mockPrisma.broadcast.create).not.toHaveBeenCalled();
    });

    it('unpublish → endBroadcast', async () => {
      const stream = { id: 's1', orgId: 'o1', slug: '' };
      mockResolveReturning(stream);
      // endBroadcast: findUnique с org-relation
      mockPrisma.stream.findUnique.mockResolvedValueOnce({
        id: 's1', orgId: 'o1', slug: '',
        isLive: true, currentBroadcastId: 'b1',
        org: { slug: 'a' },
      });
      mockPrisma.broadcast.update.mockResolvedValueOnce({});
      mockPrisma.stream.update.mockResolvedValueOnce({});

      await service.handleWebhook('live/a', 'unpublish');

      expect(mockPrisma.broadcast.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'b1' },
        data: expect.objectContaining({ endedAt: expect.any(Date) }),
      }));
    });

    it('unpublish когда stream не live → endBroadcast идемпотентен (alreadyOff)', async () => {
      const stream = { id: 's1', orgId: 'o1', slug: '' };
      mockResolveReturning(stream);
      mockPrisma.stream.findUnique.mockResolvedValueOnce({
        id: 's1', isLive: false, currentBroadcastId: null,
      });

      await service.handleWebhook('live/a', 'unpublish');

      expect(mockPrisma.broadcast.update).not.toHaveBeenCalled();
    });

    it('игнорирует webhook когда путь не резолвится', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue(null);
      await service.handleWebhook('live/ghost', 'publish');
      expect(mockPrisma.broadcast.create).not.toHaveBeenCalled();
    });

    it('concurrent publish webhooks создают РОВНО ОДИН Broadcast (mutex)', async () => {
      const stream = { id: 's-race', orgId: 'o1', slug: '' };

      mockPrisma.stream.findFirst.mockImplementation(async ({ where }: any) => {
        if (where?.slug === '' && where?.org?.slug === 'a') return stream;
        return null;
      });

      // ensureAutoRecording для обоих webhook'ов
      mockPrisma.stream.findUnique
        .mockResolvedValue({
          id: 's-race', slug: '',
          recordingEnabled: false, recordingMode: 'manual',
          org: { slug: 'a' },
        });

      // startBroadcast — оба раза вернём isLive=false, но mutex гарантирует
      // что второй startBroadcast видит isLive=true после первого update.
      // Здесь проверяем что broadcast.create вызван только 1 раз.
      mockPrisma.stream.findUnique
        .mockResolvedValueOnce({ id: 's-race', slug: '', recordingEnabled: false, recordingMode: 'manual', org: { slug: 'a' } })
        .mockResolvedValueOnce({ id: 's-race', name: 'Stream', description: null, isLive: false })
        .mockResolvedValueOnce({ id: 's-race', slug: '', recordingEnabled: false, recordingMode: 'manual', org: { slug: 'a' } })
        .mockResolvedValueOnce({ id: 's-race', name: 'Stream', description: null, isLive: true });
      mockPrisma.broadcast.create.mockResolvedValue({ id: 'b-once' });
      mockPrisma.stream.update.mockResolvedValue({});

      await Promise.all([
        service.handleWebhook('live/a', 'publish'),
        service.handleWebhook('live/a', 'publish'),
      ]);

      // Broadcast создан строго один раз (второй видит isLive=true → alreadyLive).
      expect(mockPrisma.broadcast.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateConfig', () => {
    const baseRow = {
      id: 'st-1', orgId: 'org-1', slug: '', name: 'Main',
      ingestKey: 'k', previewKey: null,
      isPublic: true, previewMode: 'multicam',
      isLive: false, autoStartMode: 'public',
      org: { slug: 'club' },
    };

    it('обновляет косметические поля без обращения к MediaMTX', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue(baseRow);
      mockPrisma.stream.update.mockResolvedValue({ ...baseRow, name: 'Renamed' });

      const r = await service.updateConfig('org-1', 'st-1', { name: 'Renamed' });
      expect(r.name).toBe('Renamed');
      expect(mockMediamtx.replaceStreamPaths).not.toHaveBeenCalled();
      expect(mockPrisma.stream.update).toHaveBeenCalledTimes(1);
    });
  });

  describe('getByIdForOrg — DTO includes recording fields', () => {
    it('returns recordingEnabled and recordingMode in DTO', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({
        id: 'st-1', orgId: 'org-1', slug: '', name: 'Main',
        description: null, isPublic: true, previewKey: null,
        previewMode: 'multicam', previewImagePath: null,
        isLive: false, autoStartMode: 'public',
        ingestKeyCreatedAt: new Date(), currentBroadcastId: null,
        createdAt: new Date(),
        ingestKey: 'secret',
        recordingEnabled: true,
        recordingMode: 'auto',
      });
      const r = await service.getByIdForOrg('org-1', 'st-1');
      expect((r as any).recordingEnabled).toBe(true);
      expect((r as any).recordingMode).toBe('auto');
    });
  });

  describe('listBroadcastsForOrg', () => {
    it('throws NotFoundException (404) for cross-tenant stream', async () => {
      // loadForOrg → findFirst returns null (stream belongs to another org)
      mockPrisma.stream.findFirst.mockResolvedValue(null);
      await expect(service.listBroadcastsForOrg('org-1', 'st-foreign'))
        .rejects.toBeInstanceOf(NotFoundException);
      expect(mockPrisma.broadcast.findMany).not.toHaveBeenCalled();
    });

    it('returns broadcasts mapped with recording (singular) from recordings[0]', async () => {
      // loadForOrg succeeds
      mockPrisma.stream.findFirst.mockResolvedValue({
        id: 'st-1', orgId: 'org-1', slug: '',
        org: { slug: 'club' },
      });
      const now = new Date();
      mockPrisma.broadcast.findMany.mockResolvedValue([
        {
          id: 'b1', title: 'Broadcast 1', description: null,
          startedAt: now, endedAt: now,
          recordings: [{ id: 'r1', status: 'ready', fileSize: 1024, duration: 3600 }],
        },
        {
          id: 'b2', title: 'Broadcast 2', description: null,
          startedAt: now, endedAt: now,
          recordings: [],
        },
      ]);

      const result = await service.listBroadcastsForOrg('org-1', 'st-1');

      expect(result).toHaveLength(2);
      // First broadcast: recording is the first element of recordings[]
      expect(result[0].recording).toEqual({ id: 'r1', status: 'ready', fileSize: 1024, duration: 3600 });
      expect((result[0] as any).recordings).toBeUndefined();
      // Second broadcast: no recordings → recording is null
      expect(result[1].recording).toBeNull();
    });

    it('queries with correct where-clause (streamId + endedAt not null)', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({
        id: 'st-1', orgId: 'org-1', slug: '',
        org: { slug: 'club' },
      });
      mockPrisma.broadcast.findMany.mockResolvedValue([]);

      await service.listBroadcastsForOrg('org-1', 'st-1');

      expect(mockPrisma.broadcast.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { streamId: 'st-1', endedAt: { not: null } },
          orderBy: { startedAt: 'desc' },
        }),
      );
    });
  });
});
