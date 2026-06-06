import { Test } from '@nestjs/testing';
import { StreamService } from './stream.service';
import { PrismaService } from '../prisma/prisma.service';
import { MediamtxService } from '../mediamtx/mediamtx.service';
import { RecordingService } from '../recording/recording.service';
import { SlotStateService } from './slot-state.service';
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
  event: {
    findFirst: jest.fn(),
  },
};
const mockMediamtx = {
  patchPath: jest.fn(),
  addPath: jest.fn(),
  replaceStreamPaths: jest.fn(),
  addStreamPaths: jest.fn(),
  deleteStreamPaths: jest.fn(),
  updateStreamPaths: jest.fn(),
};
// onStreamEnded должен возвращать Promise — StreamService.endBroadcast вешает на него .catch.
const mockRecording = { onStreamEnded: jest.fn().mockResolvedValue(undefined) };

describe('StreamService', () => {
  let service: StreamService;
  let slotState: SlotStateService;

  beforeEach(async () => {
    // resetAllMocks вычищает не только calls/results, но и mockResolvedValueOnce-queues,
    // чтобы остатки реализаций из предыдущего теста не утекали в следующий.
    jest.resetAllMocks();
    mockRecording.onStreamEnded.mockResolvedValue(undefined);
    const module = await Test.createTestingModule({
      providers: [
        StreamService,
        SlotStateService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MediamtxService, useValue: mockMediamtx },
        { provide: RecordingService, useValue: mockRecording },
      ],
    }).compile();
    service = module.get(StreamService);
    slotState = module.get(SlotStateService);
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
    it('regenerates ingestKey and calls mediamtx.replaceStreamPaths with mode+slotCount (composite)', async () => {
      mockPrisma.stream.findUnique.mockResolvedValue({
        id: 's1', orgId: 'o1', slug: '', mode: 'composite', slotCount: 1,
        org: { slug: 'club' },
      });
      mockPrisma.stream.update.mockResolvedValue({
        id: 's1', orgId: 'o1', slug: '', ingestKey: 'newkey', ingestKeyCreatedAt: new Date(),
      });
      const result = await service.rotateKey('s1');
      expect(mockMediamtx.replaceStreamPaths).toHaveBeenCalledWith(
        'club', '', 'composite', 1, expect.any(String),
      );
      expect(result.ingestKey).toBeDefined();
    });

    it('replaces passphrase across all N paths for multistream Stream', async () => {
      mockPrisma.stream.findUnique.mockResolvedValue({
        id: 's2', orgId: 'o1', slug: 'tournament', mode: 'multistream', slotCount: 4,
        org: { slug: 'club' },
      });
      mockPrisma.stream.update.mockResolvedValue({
        id: 's2', orgId: 'o1', slug: 'tournament', ingestKey: 'newkey2', ingestKeyCreatedAt: new Date(),
      });
      await service.rotateKey('s2');
      expect(mockMediamtx.replaceStreamPaths).toHaveBeenCalledWith(
        'club', 'tournament', 'multistream', 4, expect.any(String),
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

    // ─── Step 5: auto-link Broadcast to active Event ────────────────────
    // Если у Stream'а есть активный Event (startedAt!=null, endedAt==null,
    // Stream в EventStream этого Event'а), Broadcast создаётся с eventId.

    it('links Broadcast.eventId when active Event exists for stream', async () => {
      mockPrisma.stream.findUnique.mockResolvedValue({
        id: 's1', name: 'Mat A', description: null, isLive: false,
      });
      mockPrisma.event.findFirst.mockResolvedValue({ id: 'e-active' });
      mockPrisma.broadcast.create.mockResolvedValue({ id: 'b1' });
      mockPrisma.stream.update.mockResolvedValue({});

      await service.startBroadcast('s1');
      expect(mockPrisma.event.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            startedAt: { not: null },
            endedAt: null,
            eventStreams: { some: { streamId: 's1' } },
          }),
        }),
      );
      expect(mockPrisma.broadcast.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            streamId: 's1',
            eventId: 'e-active',
          }),
        }),
      );
    });

    it('Broadcast.eventId=null when no active Event for stream', async () => {
      mockPrisma.stream.findUnique.mockResolvedValue({
        id: 's1', name: 'Mat A', description: null, isLive: false,
      });
      mockPrisma.event.findFirst.mockResolvedValue(null);
      mockPrisma.broadcast.create.mockResolvedValue({ id: 'b1' });
      mockPrisma.stream.update.mockResolvedValue({});

      await service.startBroadcast('s1');
      expect(mockPrisma.broadcast.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            streamId: 's1',
            eventId: null,
          }),
        }),
      );
    });

    it('Broadcast.eventId=null when matching Event is not yet started or already ended', async () => {
      mockPrisma.stream.findUnique.mockResolvedValue({
        id: 's1', name: 'Mat A', description: null, isLive: false,
      });
      // findFirst отфильтрует scheduled (startedAt=null) и ended (endedAt!=null)
      // на уровне WHERE — здесь мокаем возврат null, имитируя что подходящих не нашлось.
      mockPrisma.event.findFirst.mockResolvedValue(null);
      mockPrisma.broadcast.create.mockResolvedValue({ id: 'b1' });
      mockPrisma.stream.update.mockResolvedValue({});

      await service.startBroadcast('s1');
      expect(mockPrisma.broadcast.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ eventId: null }),
        }),
      );
    });
  });

  describe('endBroadcast', () => {
    it('closes broadcast and triggers recording', async () => {
      mockPrisma.stream.findUnique.mockResolvedValue({
        id: 's1', orgId: 'o1', slug: '', mode: 'composite', slotCount: 1,
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

  describe('verifyIngestKey', () => {
    it('accepts matching key for composite Stream without slotIndex', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({
        ingestKey: 'k1', mode: 'composite', slotCount: 1, org: { isActive: true },
      });
      const ok = await service.verifyIngestKey('club', '', null, 'k1');
      expect(ok).toBe(true);
    });

    it('rejects wrong key', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({
        ingestKey: 'k1', mode: 'composite', slotCount: 1, org: { isActive: true },
      });
      const ok = await service.verifyIngestKey('club', '', null, 'wrong');
      expect(ok).toBe(false);
    });

    it('rejects slotIndex for composite Stream', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({
        ingestKey: 'k1', mode: 'composite', slotCount: 1, org: { isActive: true },
      });
      const ok = await service.verifyIngestKey('club', '', 2, 'k1');
      expect(ok).toBe(false);
    });

    it('accepts slotIndex in range for multistream Stream', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({
        ingestKey: 'k1', mode: 'multistream', slotCount: 4, org: { isActive: true },
      });
      const ok = await service.verifyIngestKey('club', '', 3, 'k1');
      expect(ok).toBe(true);
    });

    it('rejects slotIndex out of range for multistream Stream', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({
        ingestKey: 'k1', mode: 'multistream', slotCount: 2, org: { isActive: true },
      });
      const ok = await service.verifyIngestKey('club', '', 3, 'k1');
      expect(ok).toBe(false);
    });

    it('rejects when org is inactive', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({
        ingestKey: 'k1', mode: 'composite', slotCount: 1, org: { isActive: false },
      });
      const ok = await service.verifyIngestKey('club', '', null, 'k1');
      expect(ok).toBe(false);
    });
  });

  describe('resolvePathToStream', () => {
    it('resolves "live/<orgSlug>" to default Stream with slotIndex=null', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({
        id: 's1', orgId: 'o1', slug: '', mode: 'composite', slotCount: 1,
      });
      const r = await service.resolvePathToStream('live/myorg');
      expect(r?.stream.id).toBe('s1');
      expect(r?.slotIndex).toBeNull();
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

    it('returns null when Stream not found', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue(null);
      const r = await service.resolvePathToStream('live/ghost');
      expect(r).toBeNull();
    });

    it('resolves "live/<org>/<n>" as slot N for default multistream Stream', async () => {
      // Попытка 1: ищем default Stream (slug=''); multistream slotCount=4 → slot=3.
      mockPrisma.stream.findFirst.mockResolvedValueOnce({
        id: 's1', orgId: 'o1', slug: '', mode: 'multistream', slotCount: 4,
      });
      const r = await service.resolvePathToStream('live/a/3');
      expect(r?.stream.id).toBe('s1');
      expect(r?.slotIndex).toBe(3);
      // Должен искать default Stream (slug='') орги 'a'.
      expect(mockPrisma.stream.findFirst).toHaveBeenCalledWith({
        where: { slug: '', org: { slug: 'a' } },
      });
    });

    it('falls back to streamSlug interpretation for "live/<org>/<n>" if default Stream is composite', async () => {
      // Попытка 1: default Stream (slug='') существует, но composite → отвергаем slot.
      mockPrisma.stream.findFirst.mockResolvedValueOnce({
        id: 's1', orgId: 'o1', slug: '', mode: 'composite', slotCount: 1,
      });
      // Попытка 2: ищем Stream с streamSlug='3' — не найден.
      mockPrisma.stream.findFirst.mockResolvedValueOnce(null);
      const r = await service.resolvePathToStream('live/a/3');
      expect(r).toBeNull();
      expect(mockPrisma.stream.findFirst).toHaveBeenNthCalledWith(2, {
        where: { slug: '3', org: { slug: 'a' } },
      });
    });

    it('resolves "live/<org>/<streamSlug>" as named Stream when last segment is non-numeric', async () => {
      // Числового хвоста нет — сразу попытка 2.
      mockPrisma.stream.findFirst.mockResolvedValueOnce({
        id: 's2', orgId: 'o1', slug: 'b', mode: 'composite', slotCount: 1,
      });
      const r = await service.resolvePathToStream('live/a/b');
      expect(r?.stream.id).toBe('s2');
      expect(r?.slotIndex).toBeNull();
      expect(mockPrisma.stream.findFirst).toHaveBeenCalledWith({
        where: { slug: 'b', org: { slug: 'a' } },
      });
    });

    it('resolves "live/<org>/<streamSlug>/<n>" as slot N for named multistream Stream', async () => {
      // Попытка 1: ищем Stream slug='b' (без хвоста '2'); multistream slotCount=4 → slot=2.
      mockPrisma.stream.findFirst.mockResolvedValueOnce({
        id: 's3', orgId: 'o1', slug: 'b', mode: 'multistream', slotCount: 4,
      });
      const r = await service.resolvePathToStream('live/a/b/2');
      expect(r?.stream.id).toBe('s3');
      expect(r?.slotIndex).toBe(2);
      expect(mockPrisma.stream.findFirst).toHaveBeenCalledWith({
        where: { slug: 'b', org: { slug: 'a' } },
      });
    });

    it('rejects slot N > slotCount, falls back to streamSlug interpretation', async () => {
      // Попытка 1: Stream multistream но slotCount=2, slot=5 — не валидно.
      mockPrisma.stream.findFirst.mockResolvedValueOnce({
        id: 's1', orgId: 'o1', slug: '', mode: 'multistream', slotCount: 2,
      });
      // Попытка 2: streamSlug='5' — не найден.
      mockPrisma.stream.findFirst.mockResolvedValueOnce(null);
      const r = await service.resolvePathToStream('live/a/5');
      expect(r).toBeNull();
    });
  });

  describe('handleWebhook (lifecycle aggregation)', () => {
    function mockResolveReturning(stream: any) {
      // resolvePathToStream использует findStream → prisma.stream.findFirst.
      // Возвращаем нужный Stream на первый вызов; на возможную попытку 2 — null.
      mockPrisma.stream.findFirst.mockResolvedValueOnce(stream).mockResolvedValueOnce(null);
    }

    it('publish первого slot → setPublishing(true) + startBroadcast', async () => {
      const stream = { id: 's1', orgId: 'o1', slug: '', mode: 'multistream', slotCount: 4 };
      mockResolveReturning(stream);
      // startBroadcast: findUnique для проверки isLive
      mockPrisma.stream.findUnique.mockResolvedValueOnce({
        id: 's1', name: 'Stream', description: null, isLive: false,
      });
      mockPrisma.broadcast.create.mockResolvedValueOnce({ id: 'b1' });
      mockPrisma.stream.update.mockResolvedValueOnce({});

      await service.handleWebhook('live/a/1', 'publish');

      expect(slotState.getActiveSlotIndexes('s1')).toEqual([1]);
      expect(mockPrisma.broadcast.create).toHaveBeenCalledTimes(1);
    });

    it('publish второго slot → setPublishing(true), Broadcast не пересоздаётся', async () => {
      const stream = { id: 's1', orgId: 'o1', slug: '', mode: 'multistream', slotCount: 4 };
      // Первый slot уже publishing
      slotState.setPublishing('s1', 1, true);

      mockResolveReturning(stream);

      await service.handleWebhook('live/a/2', 'publish');

      expect(slotState.getActiveSlotIndexes('s1')).toEqual([1, 2]);
      expect(mockPrisma.broadcast.create).not.toHaveBeenCalled();
    });

    it('unpublish последнего slot → setPublishing(false) + endBroadcast', async () => {
      const stream = { id: 's1', orgId: 'o1', slug: '', mode: 'multistream', slotCount: 4 };
      slotState.setPublishing('s1', 1, true);

      mockResolveReturning(stream);
      // endBroadcast: findUnique с org-relation
      mockPrisma.stream.findUnique.mockResolvedValueOnce({
        id: 's1', orgId: 'o1', slug: '', mode: 'multistream', slotCount: 4,
        isLive: true, currentBroadcastId: 'b1',
        org: { slug: 'a' },
      });
      mockPrisma.broadcast.update.mockResolvedValueOnce({});
      mockPrisma.stream.update.mockResolvedValueOnce({});

      await service.handleWebhook('live/a/1', 'unpublish');

      expect(slotState.getActiveSlotIndexes('s1')).toEqual([]);
      expect(mockPrisma.broadcast.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'b1' },
        data: expect.objectContaining({ endedAt: expect.any(Date) }),
      }));
    });

    it('unpublish не-последнего slot → setPublishing(false), Broadcast остаётся открытым', async () => {
      const stream = { id: 's1', orgId: 'o1', slug: '', mode: 'multistream', slotCount: 4 };
      slotState.setPublishing('s1', 1, true);
      slotState.setPublishing('s1', 2, true);

      mockResolveReturning(stream);

      await service.handleWebhook('live/a/1', 'unpublish');

      expect(slotState.getActiveSlotIndexes('s1')).toEqual([2]);
      expect(mockPrisma.broadcast.update).not.toHaveBeenCalled();
    });

    it('composite Stream без slot-сегмента → трактует как slot 1', async () => {
      const stream = { id: 's1', orgId: 'o1', slug: '', mode: 'composite', slotCount: 1 };
      mockResolveReturning(stream);
      mockPrisma.stream.findUnique.mockResolvedValueOnce({
        id: 's1', name: 'Stream', description: null, isLive: false,
      });
      mockPrisma.broadcast.create.mockResolvedValueOnce({ id: 'b1' });
      mockPrisma.stream.update.mockResolvedValueOnce({});

      await service.handleWebhook('live/a', 'publish');

      expect(slotState.getActiveSlotIndexes('s1')).toEqual([1]);
      expect(mockPrisma.broadcast.create).toHaveBeenCalledTimes(1);
    });

    it('игнорирует webhook когда путь не резолвится', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue(null);
      await service.handleWebhook('live/ghost', 'publish');
      expect(mockPrisma.broadcast.create).not.toHaveBeenCalled();
    });

    it('concurrent publish webhooks одного Stream создают РОВНО ОДИН Broadcast (mutex)', async () => {
      const stream = { id: 's-race', orgId: 'o1', slug: '', mode: 'multistream', slotCount: 4 };

      // resolvePathToStream вызовется дважды — оба раза вернём один и тот же Stream.
      // На каждый вызов findFirst делает 1-2 запроса (попытка 1: slot interpretation).
      // Используем mockImplementation чтобы возвращать stream для запроса с slug='', и null иначе.
      mockPrisma.stream.findFirst.mockImplementation(async ({ where }: any) => {
        if (where?.slug === '' && where?.org?.slug === 'a') return stream;
        return null;
      });

      // startBroadcast → findUnique возвращает isLive=false ОДИН раз;
      // если бы mutex не работал и второй publish тоже добрался до startBroadcast,
      // он попытался бы прочитать второй findUnique-mock — но мы кладём только один.
      // Между этими вызовами уже состоится prisma.stream.update({ isLive: true }),
      // и второй findUnique должен был бы вернуть {isLive: true} → alreadyLive.
      // Здесь нам нужнее проверить что broadcast.create вызван 1 раз.
      mockPrisma.stream.findUnique.mockResolvedValue({
        id: 's-race', name: 'Stream', description: null, isLive: false,
      });
      mockPrisma.broadcast.create.mockResolvedValue({ id: 'b-once' });
      mockPrisma.stream.update.mockResolvedValue({});

      // Запускаем два webhook'а строго одновременно.
      await Promise.all([
        service.handleWebhook('live/a/1', 'publish'),
        service.handleWebhook('live/a/2', 'publish'),
      ]);

      // Оба slot'а publishing, но Broadcast создан строго один раз.
      expect(slotState.getActiveSlotIndexes('s-race').sort()).toEqual([1, 2]);
      expect(mockPrisma.broadcast.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateConfig (rollback on MediaMTX failure)', () => {
    const baseRow = {
      id: 'st-1', orgId: 'org-1', slug: '', name: 'Main',
      mode: 'composite', slotCount: 1,
      slots: [{ index: 1 }], slotOrder: [1],
      layoutPreset: 'solo', fallbackLayouts: null,
      ingestKey: 'k', previewKey: null,
      isPublic: true, previewMode: 'multicam',
      isLive: false, autoStartMode: 'public',
      org: { slug: 'club' },
    };

    it('откатывает Prisma если MediaMTX.updateStreamPaths упал', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue(baseRow);
      // Первый update — основной patch (mode/slotCount меняются).
      // Второй update — rollback (возвращает mode/slotCount к baseRow).
      mockPrisma.stream.update
        .mockResolvedValueOnce({ ...baseRow, mode: 'multistream', slotCount: 4 })
        .mockResolvedValueOnce({});
      mockMediamtx.updateStreamPaths.mockRejectedValue(new Error('mediamtx 500'));

      await expect(
        service.updateConfig('org-1', 'st-1', {
          mode: 'multistream',
          slotCount: 4,
          slots: [{ index: 1 }, { index: 2 }, { index: 3 }, { index: 4 }],
          slotOrder: [1, 2, 3, 4],
          layoutPreset: 'grid-2x2',
        }),
      ).rejects.toThrow(/MediaMTX paths/i);

      // Сначала прошёл основной update с новыми mode/slotCount
      expect(mockPrisma.stream.update).toHaveBeenNthCalledWith(1, expect.objectContaining({
        where: { id: 'st-1' },
        data: expect.objectContaining({ mode: 'multistream', slotCount: 4 }),
      }));
      // Затем — rollback к исходным mode/slotCount.
      expect(mockPrisma.stream.update).toHaveBeenNthCalledWith(2, expect.objectContaining({
        where: { id: 'st-1' },
        data: { mode: 'composite', slotCount: 1 },
      }));
    });

    it('не делает rollback если меняются только косметические поля (MediaMTX не дёргался)', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue(baseRow);
      mockPrisma.stream.update.mockResolvedValue({ ...baseRow, name: 'Renamed' });

      const r = await service.updateConfig('org-1', 'st-1', { name: 'Renamed' });
      expect(r.name).toBe('Renamed');
      expect(mockMediamtx.updateStreamPaths).not.toHaveBeenCalled();
      expect(mockPrisma.stream.update).toHaveBeenCalledTimes(1);
    });
  });
});
