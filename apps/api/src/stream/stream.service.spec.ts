import { Test } from '@nestjs/testing';
import { StreamService } from './stream.service';
import { PrismaService } from '../prisma/prisma.service';
import { MediamtxService } from '../mediamtx/mediamtx.service';
import { RecordingService } from '../recording/recording.service';
import { ChatService } from '../chat/chat.service';
import { ImageService } from '../storage/image.service';
import { StatsService } from '../stats/stats.service';
import { ChatGateway } from '../chat/chat.gateway';
import { SeoPingService } from '../seo/seo-ping.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

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
    findFirst: jest.fn(),
  },
  organization: {
    findUniqueOrThrow: jest.fn(),
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
const mockChatService = { clearMessagesByStream: jest.fn() };
const mockImages = { upload: jest.fn(), delete: jest.fn(), serve: jest.fn() };
const mockStats = { getSnapshot: jest.fn() };
const mockChatGateway = { getViewers: jest.fn().mockReturnValue(0) };
const mockSeoPing = { streamStateChanged: jest.fn() };

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
        { provide: ChatService, useValue: mockChatService },
        { provide: ImageService, useValue: mockImages },
        { provide: StatsService, useValue: mockStats },
        { provide: ChatGateway, useValue: mockChatGateway },
        { provide: SeoPingService, useValue: mockSeoPing },
      ],
    }).compile();
    service = module.get(StreamService);
  });

  describe('rotateKey', () => {
    it('regenerates ingestKey and calls mediamtx.replaceStreamPaths (4 args, record from DB)', async () => {
      mockPrisma.stream.findUnique.mockResolvedValue({
        id: 's1', orgId: 'o1', slug: '', recordingEnabled: true,
        org: { slug: 'club' },
      });
      mockPrisma.stream.update.mockResolvedValue({
        id: 's1', orgId: 'o1', slug: '', ingestKey: 'newkey', ingestKeyCreatedAt: new Date(),
      });
      const result = await service.rotateKey('s1');
      expect(mockMediamtx.replaceStreamPaths).toHaveBeenCalledWith(
        'club', '', expect.any(String), true,
      );
      expect(result.ingestKey).toBeDefined();
    });

    it('replaces passphrase for named Stream, passing recordingEnabled=false through', async () => {
      mockPrisma.stream.findUnique.mockResolvedValue({
        id: 's2', orgId: 'o1', slug: 'tournament', recordingEnabled: false,
        org: { slug: 'club' },
      });
      mockPrisma.stream.update.mockResolvedValue({
        id: 's2', orgId: 'o1', slug: 'tournament', ingestKey: 'newkey2', ingestKeyCreatedAt: new Date(),
      });
      await service.rotateKey('s2');
      expect(mockMediamtx.replaceStreamPaths).toHaveBeenCalledWith(
        'club', 'tournament', expect.any(String), false,
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
        id: 's1', name: 'My Stream', description: null, isLive: false, currentBroadcastId: null,
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
        id: 's1', name: 'Mat A', description: null, isLive: false, currentBroadcastId: null,
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
        recordingEnabled: false, recordingMode: 'manual',
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

  describe('endBroadcast — режимы записи', () => {
    const baseStream = {
      id: 's1', slug: 'court-a', isLive: true, currentBroadcastId: 'b1',
      org: { slug: 'club' },
    };

    it('auto: закрывает Broadcast, финализирует и ВЫКЛЮЧАЕТ запись', async () => {
      mockPrisma.stream.findUnique.mockResolvedValue({
        ...baseStream, recordingMode: 'auto', recordingEnabled: true,
      });
      mockPrisma.broadcast.update.mockResolvedValue({});
      mockPrisma.stream.update.mockResolvedValue({});

      const r = await service.endBroadcast('s1');

      expect(r).toEqual({ ok: true });
      expect(mockPrisma.broadcast.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'b1' },
        data: expect.objectContaining({ endedAt: expect.any(Date) }),
      }));
      expect(mockMediamtx.setStreamRecording).toHaveBeenCalledWith('club', 'court-a', false);
      expect(mockPrisma.stream.update).toHaveBeenCalledWith(expect.objectContaining({
        data: { recordingEnabled: false },
      }));
      expect(mockRecording.onStreamEnded).toHaveBeenCalledWith('b1', 'club/court-a');
    });

    it('manual + запись включена: ПАУЗА — Broadcast открыт, isLive=false, финализации нет', async () => {
      mockPrisma.stream.findUnique.mockResolvedValue({
        ...baseStream, recordingMode: 'manual', recordingEnabled: true,
      });
      mockPrisma.broadcast.update.mockResolvedValue({});
      mockPrisma.stream.update.mockResolvedValue({});

      const r = await service.endBroadcast('s1');

      expect(r).toEqual({ paused: true });
      expect(mockPrisma.broadcast.update).toHaveBeenCalledWith({
        where: { id: 'b1' },
        data: { pausedAt: expect.any(Date) },
      });
      expect(mockPrisma.stream.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { isLive: false },
      });
      expect(mockRecording.onStreamEnded).not.toHaveBeenCalled();
      expect(mockMediamtx.setStreamRecording).not.toHaveBeenCalled();
    });

    it('manual + запись выключена: закрывает и финализирует (сегменты могли быть записаны ранее)', async () => {
      mockPrisma.stream.findUnique.mockResolvedValue({
        ...baseStream, recordingMode: 'manual', recordingEnabled: false,
      });
      mockPrisma.broadcast.update.mockResolvedValue({});
      mockPrisma.stream.update.mockResolvedValue({});

      const r = await service.endBroadcast('s1');

      expect(r).toEqual({ ok: true });
      expect(mockRecording.onStreamEnded).toHaveBeenCalledWith('b1', 'club/court-a');
      expect(mockMediamtx.setStreamRecording).not.toHaveBeenCalled();
    });
  });

  describe('startBroadcast — resume склейки', () => {
    it('открытый currentBroadcastId → resume: pausedAt=null, isLive=true, новый Broadcast не создаётся', async () => {
      mockPrisma.stream.findUnique.mockResolvedValue({
        id: 's1', name: 'X', description: null, isLive: false, currentBroadcastId: 'b1',
      });
      mockPrisma.broadcast.findFirst.mockResolvedValue({ id: 'b1' });
      mockPrisma.broadcast.update.mockResolvedValue({});
      mockPrisma.stream.update.mockResolvedValue({});

      const r = await service.startBroadcast('s1');

      expect(r).toEqual({ ok: true, broadcastId: 'b1', resumed: true });
      expect(mockPrisma.broadcast.create).not.toHaveBeenCalled();
      expect(mockPrisma.broadcast.update).toHaveBeenCalledWith({
        where: { id: 'b1' },
        data: { pausedAt: null },
      });
    });

    it('протухший указатель (Broadcast уже закрыт кроном) → чистит и создаёт новый', async () => {
      mockPrisma.stream.findUnique.mockResolvedValue({
        id: 's1', name: 'X', description: null, isLive: false, currentBroadcastId: 'b-stale',
      });
      mockPrisma.broadcast.findFirst.mockResolvedValue(null);
      mockPrisma.broadcast.create.mockResolvedValue({ id: 'b2' });
      mockPrisma.stream.update.mockResolvedValue({});

      const r = await service.startBroadcast('s1');

      expect(r).toEqual({ ok: true, broadcastId: 'b2' });
      expect(mockPrisma.broadcast.create).toHaveBeenCalled();
    });
  });

  describe('setRecording — финализация склейки', () => {
    it('REC off при открытой паузе (не в эфире) → Broadcast закрывается endedAt=pausedAt и финализируется', async () => {
      // loadForOrg → findFirst; далее setRecording делает findUniqueOrThrow(org), update, findUnique(fresh)
      mockPrisma.stream.findFirst.mockResolvedValue({
        id: 's1', orgId: 'o1', slug: 'court-a', org: { slug: 'club' },
      });
      mockPrisma.organization.findUniqueOrThrow = jest.fn().mockResolvedValue({ slug: 'club' });
      mockPrisma.stream.update.mockResolvedValue({ id: 's1', slug: 'court-a' });
      const pausedAt = new Date('2026-07-03T10:00:00Z');
      mockPrisma.stream.findUnique.mockResolvedValue({
        id: 's1', slug: 'court-a', isLive: false, currentBroadcastId: 'b1',
        org: { slug: 'club' },
      });
      mockPrisma.broadcast.findFirst.mockResolvedValue({ id: 'b1', pausedAt });
      mockPrisma.broadcast.update.mockResolvedValue({});

      await service.setRecording('o1', 's1', { enabled: false });

      expect(mockPrisma.broadcast.update).toHaveBeenCalledWith({
        where: { id: 'b1' },
        data: { endedAt: pausedAt, pausedAt: null },
      });
      expect(mockRecording.onStreamEnded).toHaveBeenCalledWith('b1', 'club/court-a');
    });

    it('REC off когда стрим В ЭФИРЕ → только флаги, финализации нет', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({
        id: 's1', orgId: 'o1', slug: 'court-a', org: { slug: 'club' },
      });
      mockPrisma.organization.findUniqueOrThrow = jest.fn().mockResolvedValue({ slug: 'club' });
      mockPrisma.stream.update.mockResolvedValue({ id: 's1', slug: 'court-a' });
      mockPrisma.stream.findUnique.mockResolvedValue({
        id: 's1', slug: 'court-a', isLive: true, currentBroadcastId: 'b1',
        org: { slug: 'club' },
      });

      await service.setRecording('o1', 's1', { enabled: false });

      expect(mockRecording.onStreamEnded).not.toHaveBeenCalled();
      expect(mockMediamtx.setStreamRecording).toHaveBeenCalledWith('club', 'court-a', false);
    });

    it('смена режима на auto при открытой паузе → финализация', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({
        id: 's1', orgId: 'o1', slug: 'court-a', org: { slug: 'club' },
      });
      mockPrisma.stream.update.mockResolvedValue({ id: 's1', slug: 'court-a' });
      mockPrisma.stream.findUnique.mockResolvedValue({
        id: 's1', slug: 'court-a', isLive: false, currentBroadcastId: 'b1',
        org: { slug: 'club' },
      });
      mockPrisma.broadcast.findFirst.mockResolvedValue({ id: 'b1', pausedAt: new Date() });
      mockPrisma.broadcast.update.mockResolvedValue({});

      await service.setRecording('o1', 's1', { mode: 'auto' });

      expect(mockRecording.onStreamEnded).toHaveBeenCalledWith('b1', 'club/court-a');
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
        id: 's1', name: 'Stream', description: null, isLive: false, currentBroadcastId: null,
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
        id: 's1', name: 'Stream', description: null, isLive: true, currentBroadcastId: null,
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
        recordingEnabled: false, recordingMode: 'manual',
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
        .mockResolvedValueOnce({ id: 's-race', name: 'Stream', description: null, isLive: false, currentBroadcastId: null })
        .mockResolvedValueOnce({ id: 's-race', slug: '', recordingEnabled: false, recordingMode: 'manual', org: { slug: 'a' } })
        .mockResolvedValueOnce({ id: 's-race', name: 'Stream', description: null, isLive: true, currentBroadcastId: null });
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

    it('updates feedMode', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue(baseRow);
      mockPrisma.stream.update.mockResolvedValue({ ...baseRow, feedMode: 'single' });

      const r = await service.updateConfig('org-1', 'st-1', { feedMode: 'single' });
      expect((r as any).feedMode).toBe('single');
      expect(mockPrisma.stream.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ feedMode: 'single' }),
      }));
    });

    it('rejects invalid feedMode', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue(baseRow);
      await expect(service.updateConfig('org-1', 'st-1', { feedMode: 'foo' as any }))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(mockPrisma.stream.update).not.toHaveBeenCalled();
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
          // fileSize приходит из Prisma как BigInt (колонка bigint) —
          // наружу обязан уехать number, иначе ответ не сериализуется.
          recordings: [{ id: 'r1', status: 'ready', fileSize: 1024n, duration: 3600 }],
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

    it('hasPreview: true когда есть previewImagePath, false когда нет; сырой ключ наружу не отдаётся', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({
        id: 'st-1', orgId: 'org-1', slug: '',
        org: { slug: 'club' },
      });
      mockPrisma.broadcast.findMany.mockResolvedValue([
        {
          id: 'b1', title: null, description: null,
          startedAt: new Date(), endedAt: new Date(),
          previewImagePath: 'archive/club/b1/preview.jpg',
          recordings: [],
        },
        {
          id: 'b2', title: null, description: null,
          startedAt: new Date(), endedAt: new Date(),
          previewImagePath: null,
          recordings: [],
        },
      ]);

      const result = await service.listBroadcastsForOrg('org-1', 'st-1');

      expect(result[0].hasPreview).toBe(true);
      expect(result[1].hasPreview).toBe(false);
      expect((result[0] as any).previewImagePath).toBeUndefined();
    });
  });

  describe('uploadPreviewForOrg', () => {
    it('throws NotFoundException (404) for cross-tenant stream, upload not called', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue(null);
      await expect(service.uploadPreviewForOrg('org-2', 'st-1', Buffer.from('x')))
        .rejects.toBeInstanceOf(NotFoundException);
      expect(mockImages.upload).not.toHaveBeenCalled();
    });

    it('uploads to S3 key images/stream/<id>.jpg and stores it as previewImagePath', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({ id: 'st-1', orgId: 'org-1' });
      mockPrisma.stream.update.mockResolvedValue({});
      const r = await service.uploadPreviewForOrg('org-1', 'st-1', Buffer.from('img'));
      expect(mockImages.upload).toHaveBeenCalledWith('images/stream/st-1.jpg', Buffer.from('img'));
      expect(mockPrisma.stream.update).toHaveBeenCalledWith({
        where: { id: 'st-1' },
        data: { previewImagePath: 'images/stream/st-1.jpg' },
      });
      expect(r).toEqual({ ok: true, previewImagePath: 'images/stream/st-1.jpg' });
    });
  });

  describe('deletePreviewForOrg', () => {
    it('throws NotFoundException (404) for cross-tenant stream', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue(null);
      await expect(service.deletePreviewForOrg('org-1', 'st-foreign'))
        .rejects.toBeInstanceOf(NotFoundException);
      expect(mockPrisma.stream.update).not.toHaveBeenCalled();
    });

    it('deletes S3 object and clears previewImagePath', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({ id: 'st-1', orgId: 'org-1' });
      mockPrisma.stream.update.mockResolvedValue({});
      const r = await service.deletePreviewForOrg('org-1', 'st-1');
      expect(mockImages.delete).toHaveBeenCalledWith('images/stream/st-1.jpg');
      expect(mockPrisma.stream.update).toHaveBeenCalledWith({
        where: { id: 'st-1' },
        data: { previewImagePath: null },
      });
      expect(r).toEqual({ ok: true });
    });
  });

  describe('clearChatForOrg', () => {
    it('throws NotFoundException (404) for cross-tenant stream', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue(null);
      await expect(service.clearChatForOrg('org-1', 'st-foreign'))
        .rejects.toBeInstanceOf(NotFoundException);
      expect(mockChatService.clearMessagesByStream).not.toHaveBeenCalled();
    });

    it('delegates to chatService.clearMessagesByStream(streamId)', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({
        id: 'st-1', orgId: 'org-1', slug: '',
        org: { slug: 'club' },
      });
      mockChatService.clearMessagesByStream.mockResolvedValue({ deleted: 3 });

      const r = await service.clearChatForOrg('org-1', 'st-1');

      expect(mockChatService.clearMessagesByStream).toHaveBeenCalledWith('st-1');
      expect(r).toEqual({ deleted: 3 });
    });
  });
});
