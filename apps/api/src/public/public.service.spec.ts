import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PublicService } from './public.service';
import { PrismaService } from '../prisma/prisma.service';
import { ThumbnailService } from '../thumbnail/thumbnail.service';
import { SlotStateService } from '../stream/slot-state.service';

const mockPrisma = {
  stream: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  broadcast: {
    findMany: jest.fn(),
  },
  event: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
  },
};

const mockThumbnail = {
  getSnapshot: jest.fn(),
};

describe('PublicService', () => {
  let service: PublicService;
  let slotState: SlotStateService;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Step 5: getCatalog теперь читает event.findMany() ДО stream.findMany.
    // Дефолт «нет активных Event'ов» сохраняет обратную совместимость
    // существующих stream-only тестов — Event-карточки не появляются.
    mockPrisma.event.findMany.mockResolvedValue([]);
    const module = await Test.createTestingModule({
      providers: [
        PublicService,
        SlotStateService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ThumbnailService, useValue: mockThumbnail },
      ],
    }).compile();
    service = module.get(PublicService);
    slotState = module.get(SlotStateService);
  });

  describe('getStreamUrl — composite mode', () => {
    it('returns single hlsUrl + composite mode for a live public composite Stream', async () => {
      mockPrisma.stream.findFirst.mockResolvedValueOnce({
        id: 's1',
        isLive: true,
        isPublic: true,
        previewKey: null,
        mode: 'composite',
        slotCount: 1,
        slots: [{ index: 1, name: '' }],
        slotOrder: [1],
        layoutPreset: 'solo',
        fallbackLayouts: null,
      });

      const result = await service.getStreamUrl('myorg');

      expect(result.mode).toBe('composite');
      expect(result.slotCount).toBe(1);
      expect(result.hlsUrls).toEqual([
        { slotIndex: 1, url: '/api/v1/public/orgs/myorg/live/hls/master.m3u8' },
      ]);
      expect(result.slots).toEqual([{ index: 1, name: '', isAudioSource: undefined }]);
      expect(result.slotOrder).toEqual([1]);
      expect(result.layoutPreset).toBe('solo');
      expect(result.fallbackLayouts).toBeNull();
      // composite без явного SlotState'а должен дать дефолт [1]
      expect(result.activeSlotIndexes).toEqual([1]);
    });

    it('reflects SlotState snapshot in activeSlotIndexes', async () => {
      slotState.setPublishing('s1', 1, true);
      mockPrisma.stream.findFirst.mockResolvedValueOnce({
        id: 's1',
        isLive: true,
        isPublic: true,
        previewKey: null,
        mode: 'composite',
        slotCount: 1,
        slots: [{ index: 1, name: '' }],
        slotOrder: [1],
        layoutPreset: 'solo',
        fallbackLayouts: null,
      });

      const result = await service.getStreamUrl('myorg');
      expect(result.activeSlotIndexes).toEqual([1]);
    });
  });

  describe('getStreamUrl — multistream mode', () => {
    it('returns N hlsUrls (one per slot) for a live multistream Stream', async () => {
      mockPrisma.stream.findFirst.mockResolvedValueOnce({
        id: 's2',
        isLive: true,
        isPublic: true,
        previewKey: null,
        mode: 'multistream',
        slotCount: 4,
        slots: [
          { index: 1, name: 'Ковёр A', isAudioSource: true },
          { index: 2, name: 'Ковёр B' },
          { index: 3, name: 'Ковёр C' },
          { index: 4, name: 'Ковёр D' },
        ],
        slotOrder: [1, 2, 3, 4],
        layoutPreset: 'grid-2x2',
        fallbackLayouts: { 2: 'side-by-side', 3: 'pyramid' },
      });

      // Только slot 1 и 2 публикуются прямо сейчас.
      slotState.setPublishing('s2', 1, true);
      slotState.setPublishing('s2', 2, true);

      const result = await service.getStreamUrl('club');

      expect(result.mode).toBe('multistream');
      expect(result.slotCount).toBe(4);
      expect(result.hlsUrls).toEqual([
        { slotIndex: 1, url: '/api/v1/public/orgs/club/live/hls/1/index.m3u8' },
        { slotIndex: 2, url: '/api/v1/public/orgs/club/live/hls/2/index.m3u8' },
        { slotIndex: 3, url: '/api/v1/public/orgs/club/live/hls/3/index.m3u8' },
        { slotIndex: 4, url: '/api/v1/public/orgs/club/live/hls/4/index.m3u8' },
      ]);
      expect(result.slots).toEqual([
        { index: 1, name: 'Ковёр A', isAudioSource: true },
        { index: 2, name: 'Ковёр B', isAudioSource: undefined },
        { index: 3, name: 'Ковёр C', isAudioSource: undefined },
        { index: 4, name: 'Ковёр D', isAudioSource: undefined },
      ]);
      expect(result.slotOrder).toEqual([1, 2, 3, 4]);
      expect(result.layoutPreset).toBe('grid-2x2');
      expect(result.fallbackLayouts).toEqual({ 2: 'side-by-side', 3: 'pyramid' });
      expect(result.activeSlotIndexes).toEqual([1, 2]);
    });

    it('returns empty activeSlotIndexes for multistream Stream without SlotState entries', async () => {
      mockPrisma.stream.findFirst.mockResolvedValueOnce({
        id: 's-empty',
        isLive: true,
        isPublic: true,
        previewKey: null,
        mode: 'multistream',
        slotCount: 2,
        slots: [{ index: 1, name: '' }, { index: 2, name: '' }],
        slotOrder: [1, 2],
        layoutPreset: 'side-by-side',
        fallbackLayouts: null,
      });

      const result = await service.getStreamUrl('quiet');
      // SlotState ничего не возвращает → multistream дефолт []
      // (composite дал бы [1], но multistream — нет — клиент покажет 'нет активных').
      expect(result.activeSlotIndexes).toEqual([]);
    });
  });

  describe('getStreamUrl — access control', () => {
    it('throws 404 when stream is not found', async () => {
      mockPrisma.stream.findFirst.mockResolvedValueOnce(null);
      await expect(service.getStreamUrl('ghost')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws 404 when stream is not live', async () => {
      mockPrisma.stream.findFirst.mockResolvedValueOnce({
        id: 's1',
        isLive: false,
        isPublic: true,
        previewKey: null,
        mode: 'composite',
        slotCount: 1,
        slots: [{ index: 1, name: '' }],
        slotOrder: [1],
        layoutPreset: 'solo',
        fallbackLayouts: null,
      });
      await expect(service.getStreamUrl('myorg')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws 404 when stream is private and key does not match', async () => {
      mockPrisma.stream.findFirst.mockResolvedValueOnce({
        id: 's1',
        isLive: true,
        isPublic: false,
        previewKey: 'expected-key',
        mode: 'composite',
        slotCount: 1,
        slots: [{ index: 1, name: '' }],
        slotOrder: [1],
        layoutPreset: 'solo',
        fallbackLayouts: null,
      });
      await expect(
        service.getStreamUrl('myorg', undefined, 'wrong-key'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns stream for a private stream when key matches', async () => {
      mockPrisma.stream.findFirst.mockResolvedValueOnce({
        id: 's1',
        isLive: true,
        isPublic: false,
        previewKey: 'secret-key',
        mode: 'composite',
        slotCount: 1,
        slots: [{ index: 1, name: '' }],
        slotOrder: [1],
        layoutPreset: 'solo',
        fallbackLayouts: null,
      });
      const result = await service.getStreamUrl('myorg', undefined, 'secret-key');
      expect(result.mode).toBe('composite');
      expect(result.hlsUrls).toHaveLength(1);
    });
  });

  describe('getStreamUrl — normalization', () => {
    it('fills missing slot entries with defaults when DB has partial data', async () => {
      mockPrisma.stream.findFirst.mockResolvedValueOnce({
        id: 's3',
        isLive: true,
        isPublic: true,
        previewKey: null,
        mode: 'multistream',
        slotCount: 3,
        // Только slot 1 в массиве — slot 2 и 3 должны добиться дефолтами.
        slots: [{ index: 1, name: 'Главная' }],
        slotOrder: [1, 2, 3],
        layoutPreset: 'pyramid',
        fallbackLayouts: null,
      });

      const result = await service.getStreamUrl('partial');
      expect(result.slots).toEqual([
        { index: 1, name: 'Главная', isAudioSource: undefined },
        { index: 2, name: '', isAudioSource: undefined },
        { index: 3, name: '', isAudioSource: undefined },
      ]);
    });

    it('falls back to [1..slotCount] when slotOrder is malformed', async () => {
      mockPrisma.stream.findFirst.mockResolvedValueOnce({
        id: 's4',
        isLive: true,
        isPublic: true,
        previewKey: null,
        mode: 'multistream',
        slotCount: 2,
        slots: [{ index: 1, name: '' }, { index: 2, name: '' }],
        // дублированный slotOrder — невалидно
        slotOrder: [1, 1],
        layoutPreset: 'side-by-side',
        fallbackLayouts: null,
      });
      const result = await service.getStreamUrl('bad');
      expect(result.slotOrder).toEqual([1, 2]);
    });

    it('normalizes fallbackLayouts: drops invalid keys, keeps valid ones', async () => {
      mockPrisma.stream.findFirst.mockResolvedValueOnce({
        id: 's5',
        isLive: true,
        isPublic: true,
        previewKey: null,
        mode: 'multistream',
        slotCount: 4,
        slots: [
          { index: 1, name: '' }, { index: 2, name: '' },
          { index: 3, name: '' }, { index: 4, name: '' },
        ],
        slotOrder: [1, 2, 3, 4],
        layoutPreset: 'grid-2x2',
        fallbackLayouts: { 2: 'side-by-side', 5: 'invalid', notNum: 'x', 3: 'pyramid' },
      });
      const result = await service.getStreamUrl('mixed');
      expect(result.fallbackLayouts).toEqual({ 2: 'side-by-side', 3: 'pyramid' });
    });

    it('returns null fallbackLayouts when nothing valid is present', async () => {
      mockPrisma.stream.findFirst.mockResolvedValueOnce({
        id: 's6',
        isLive: true,
        isPublic: true,
        previewKey: null,
        mode: 'composite',
        slotCount: 1,
        slots: [{ index: 1, name: '' }],
        slotOrder: [1],
        layoutPreset: 'solo',
        fallbackLayouts: null,
      });
      const result = await service.getStreamUrl('clean');
      expect(result.fallbackLayouts).toBeNull();
    });
  });

  // ───────────── Step 4 (B2): multi-Stream per Org ─────────────

  describe('getCatalog — multi-Stream per Org', () => {
    it('returns all Streams of all orgs (default + named) with correct shape', async () => {
      const now = new Date('2026-05-01T12:00:00Z');
      const later = new Date('2026-05-10T12:00:00Z');
      mockPrisma.stream.findMany.mockResolvedValueOnce([
        // org=club1: default + 2 named
        {
          slug: '',
          name: 'Main feed',
          isLive: true,
          previewMode: 'multicam',
          previewImagePath: null,
          createdAt: now,
          org: { slug: 'club1', name: 'Club One' },
        },
        {
          slug: 'mat-a',
          name: 'Mat A',
          isLive: true,
          previewMode: 'multicam',
          previewImagePath: 'club1/mat-a.jpg',
          createdAt: later,
          org: { slug: 'club1', name: 'Club One' },
        },
        {
          slug: 'mat-b',
          name: 'Mat B',
          isLive: false,
          previewMode: 'cam1',
          previewImagePath: null,
          createdAt: later,
          org: { slug: 'club1', name: 'Club One' },
        },
      ]);

      const result = await service.getCatalog();

      // Сортировка: сначала live (Main feed, Mat A), потом не-live (Mat B).
      // Среди live — по createdAt DESC (Mat A позже Main feed).
      // Step 5: каждая карточка — type='stream' (без активных Event'ов
      // Event-карточек в каталоге нет).
      expect(result).toEqual([
        {
          type: 'stream',
          orgSlug: 'club1',
          orgName: 'Club One',
          streamSlug: 'mat-a',
          streamName: 'Mat A',
          isLive: true,
          previewMode: 'multicam',
          hasCustomPreview: true,
        },
        {
          type: 'stream',
          orgSlug: 'club1',
          orgName: 'Club One',
          streamSlug: '',
          streamName: 'Main feed',
          isLive: true,
          previewMode: 'multicam',
          hasCustomPreview: false,
        },
        {
          type: 'stream',
          orgSlug: 'club1',
          orgName: 'Club One',
          streamSlug: 'mat-b',
          streamName: 'Mat B',
          isLive: false,
          previewMode: 'cam1',
          hasCustomPreview: false,
        },
      ]);

      // Регрессия: WHERE-фильтр НЕ должен ограничиваться slug='', но ОБЯЗАН
      // отсекать приватные Stream'ы (isPublic=false) — иначе они засветятся
      // в публичном каталоге (Karen C3).
      const callArgs = mockPrisma.stream.findMany.mock.calls[0][0];
      expect(callArgs.where).toEqual({ org: { isActive: true }, isPublic: true });
    });

    // Karen C3: catalog не должен показывать приватные Stream'ы. Приватный
    // Stream доступен исключительно через ?key=<previewKey> URL.
    it('filters out private Streams (isPublic=false) — regression', async () => {
      mockPrisma.stream.findMany.mockResolvedValueOnce([]);
      await service.getCatalog();
      const callArgs = mockPrisma.stream.findMany.mock.calls[0][0];
      expect(callArgs.where.isPublic).toBe(true);
    });
  });

  // ──────────── Step 5 (B1): Event-карточки в каталоге ────────────

  describe('getCatalog — Event cards', () => {
    it('emits Event-card when active Event has >=2 live+public streams; consumed streams hidden from stream-card list', async () => {
      const started = new Date('2026-05-15T12:00:00Z');
      mockPrisma.event.findMany.mockResolvedValueOnce([
        {
          slug: 'spring-cup',
          title: 'Spring Cup',
          startedAt: started,
          org: { slug: 'club1', name: 'Club One' },
          eventStreams: [
            {
              stream: {
                id: 's-a', slug: 'mat-a', name: 'Mat A',
                isLive: true, isPublic: true,
                previewMode: 'multicam', previewImagePath: null,
              },
            },
            {
              stream: {
                id: 's-b', slug: 'mat-b', name: 'Mat B',
                isLive: true, isPublic: true,
                previewMode: 'cam1', previewImagePath: null,
              },
            },
          ],
        },
      ]);
      mockPrisma.stream.findMany.mockResolvedValueOnce([
        // Те же два Stream'а, что в Event'е — должны быть «съедены»
        // и не появиться в выдаче как standalone-карточки.
        {
          id: 's-a', slug: 'mat-a', name: 'Mat A',
          isLive: true, previewMode: 'multicam',
          previewImagePath: null, createdAt: new Date(),
          org: { slug: 'club1', name: 'Club One' },
        },
        {
          id: 's-b', slug: 'mat-b', name: 'Mat B',
          isLive: true, previewMode: 'cam1',
          previewImagePath: null, createdAt: new Date(),
          org: { slug: 'club1', name: 'Club One' },
        },
        // Stream вне Event'а — должен попасть в каталог standalone.
        {
          id: 's-solo', slug: 'solo', name: 'Solo',
          isLive: false, previewMode: 'multicam',
          previewImagePath: null, createdAt: new Date(),
          org: { slug: 'club2', name: 'Club Two' },
        },
      ]);

      const result = await service.getCatalog();

      // Event-карточка первой; затем standalone Stream.
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(expect.objectContaining({
        type: 'event',
        orgSlug: 'club1',
        orgName: 'Club One',
        eventSlug: 'spring-cup',
        eventTitle: 'Spring Cup',
        streamSlugs: ['mat-a', 'mat-b'],
        previewMode: 'multicam',
      }));
      // Karen H3: Event-карточка несёт consumedStreams[] (все public Stream'ы
      // Event'а — для архива). Здесь оба live+public.
      expect((result[0] as any).consumedStreams).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'stream', streamSlug: 'mat-a' }),
          expect.objectContaining({ type: 'stream', streamSlug: 'mat-b' }),
        ]),
      );
      expect(result[1]).toEqual(expect.objectContaining({
        type: 'stream',
        streamSlug: 'solo',
      }));
    });

    // Karen H2: offline public Stream Event'а тоже скрывается из standalone-
    // карточек и попадает в consumedStreams.
    it('Event with 2 live + 1 offline public stream → offline ALSO hidden from standalone (Karen H2)', async () => {
      mockPrisma.event.findMany.mockResolvedValueOnce([
        {
          slug: 'cup', title: 'Cup',
          startedAt: new Date(),
          org: { slug: 'club1', name: 'Club One' },
          eventStreams: [
            { stream: { id: 's-a', slug: 'mat-a', name: 'Mat A', isLive: true, isPublic: true, previewMode: 'multicam', previewImagePath: null } },
            { stream: { id: 's-b', slug: 'mat-b', name: 'Mat B', isLive: true, isPublic: true, previewMode: 'multicam', previewImagePath: null } },
            // offline public Stream Event'а
            { stream: { id: 's-c', slug: 'mat-c', name: 'Mat C', isLive: false, isPublic: true, previewMode: 'multicam', previewImagePath: null } },
          ],
        },
      ]);
      mockPrisma.stream.findMany.mockResolvedValueOnce([
        { id: 's-a', slug: 'mat-a', name: 'Mat A', isLive: true, previewMode: 'multicam', previewImagePath: null, createdAt: new Date(), org: { slug: 'club1', name: 'Club One' } },
        { id: 's-b', slug: 'mat-b', name: 'Mat B', isLive: true, previewMode: 'multicam', previewImagePath: null, createdAt: new Date(), org: { slug: 'club1', name: 'Club One' } },
        { id: 's-c', slug: 'mat-c', name: 'Mat C', isLive: false, previewMode: 'multicam', previewImagePath: null, createdAt: new Date(), org: { slug: 'club1', name: 'Club One' } },
      ]);

      const result = await service.getCatalog();
      // Только Event-карточка — все три Stream'а «съедены».
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('event');
      // consumedStreams включает все три public Stream'а (live + offline).
      const consumed = (result[0] as any).consumedStreams as Array<{ streamSlug: string }>;
      expect(consumed.map((s) => s.streamSlug).sort()).toEqual(['mat-a', 'mat-b', 'mat-c']);
    });

    it('Event with only 1 live+public stream emits stream-cards (no event-card)', async () => {
      // Event активен, но в нём только 1 live-public Stream → Event-карточка
      // не появляется; этот Stream показывается как standalone.
      mockPrisma.event.findMany.mockResolvedValueOnce([
        {
          slug: 'spring',
          title: 'Spring',
          startedAt: new Date(),
          org: { slug: 'club1', name: 'Club One' },
          eventStreams: [
            {
              stream: {
                id: 's-a', slug: 'mat-a', name: 'Mat A',
                isLive: true, isPublic: true,
                previewMode: 'multicam', previewImagePath: null,
              },
            },
            // Второй Stream Event'а — offline → не считается «live+public».
            {
              stream: {
                id: 's-b', slug: 'mat-b', name: 'Mat B',
                isLive: false, isPublic: true,
                previewMode: 'cam1', previewImagePath: null,
              },
            },
          ],
        },
      ]);
      mockPrisma.stream.findMany.mockResolvedValueOnce([
        {
          id: 's-a', slug: 'mat-a', name: 'Mat A',
          isLive: true, previewMode: 'multicam',
          previewImagePath: null, createdAt: new Date(),
          org: { slug: 'club1', name: 'Club One' },
        },
        {
          id: 's-b', slug: 'mat-b', name: 'Mat B',
          isLive: false, previewMode: 'cam1',
          previewImagePath: null, createdAt: new Date(),
          org: { slug: 'club1', name: 'Club One' },
        },
      ]);

      const result = await service.getCatalog();
      // Только stream-карточки — Event-карточки нет.
      expect(result.every((c) => c.type === 'stream')).toBe(true);
      expect(result.map((c: any) => c.streamSlug).sort()).toEqual(['mat-a', 'mat-b']);
    });

    it('Event with 2 live streams but one private → only the public counts; if total <2 → no event-card', async () => {
      // Приватный Stream Event'а не считается в порог «>=2 live+public».
      mockPrisma.event.findMany.mockResolvedValueOnce([
        {
          slug: 'private-cup',
          title: 'Private Cup',
          startedAt: new Date(),
          org: { slug: 'club1', name: 'Club One' },
          eventStreams: [
            {
              stream: {
                id: 's-pub', slug: 'mat-a', name: 'Mat A',
                isLive: true, isPublic: true,
                previewMode: 'multicam', previewImagePath: null,
              },
            },
            {
              stream: {
                id: 's-priv', slug: 'mat-b', name: 'Mat B',
                isLive: true, isPublic: false, // приватный
                previewMode: 'cam1', previewImagePath: null,
              },
            },
          ],
        },
      ]);
      mockPrisma.stream.findMany.mockResolvedValueOnce([
        // Только публичный Stream возвращается из stream-каталога (приватные отсечены WHERE).
        {
          id: 's-pub', slug: 'mat-a', name: 'Mat A',
          isLive: true, previewMode: 'multicam',
          previewImagePath: null, createdAt: new Date(),
          org: { slug: 'club1', name: 'Club One' },
        },
      ]);

      const result = await service.getCatalog();
      // Event-карточки нет (только 1 live+public Stream).
      // Public Stream показан standalone.
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(expect.objectContaining({
        type: 'stream',
        streamSlug: 'mat-a',
      }));
    });

    it('Event-cards sorted by startedAt DESC, then stream-cards', async () => {
      const earlier = new Date('2026-05-10T10:00:00Z');
      const later = new Date('2026-05-15T10:00:00Z');
      mockPrisma.event.findMany.mockResolvedValueOnce([
        // Prisma вернёт уже отсортированные DESC по startedAt.
        {
          slug: 'later-cup', title: 'Later Cup',
          startedAt: later,
          org: { slug: 'org-l', name: 'Org L' },
          eventStreams: [
            { stream: { id: 'sl1', slug: 'a', name: 'A', isLive: true, isPublic: true, previewMode: 'multicam', previewImagePath: null } },
            { stream: { id: 'sl2', slug: 'b', name: 'B', isLive: true, isPublic: true, previewMode: 'multicam', previewImagePath: null } },
          ],
        },
        {
          slug: 'earlier-cup', title: 'Earlier Cup',
          startedAt: earlier,
          org: { slug: 'org-e', name: 'Org E' },
          eventStreams: [
            { stream: { id: 'se1', slug: 'a', name: 'A', isLive: true, isPublic: true, previewMode: 'multicam', previewImagePath: null } },
            { stream: { id: 'se2', slug: 'b', name: 'B', isLive: true, isPublic: true, previewMode: 'multicam', previewImagePath: null } },
          ],
        },
      ]);
      mockPrisma.stream.findMany.mockResolvedValueOnce([
        {
          id: 's-solo', slug: 'solo', name: 'Solo',
          isLive: true, previewMode: 'multicam',
          previewImagePath: null, createdAt: new Date(),
          org: { slug: 'club', name: 'Club' },
        },
      ]);

      const result = await service.getCatalog();
      expect(result.map((c: any) => c.type)).toEqual(['event', 'event', 'stream']);
      expect((result[0] as any).eventSlug).toBe('later-cup');
      expect((result[1] as any).eventSlug).toBe('earlier-cup');
    });
  });

  // ──────────── Step 5 (B1): getEventLanding ────────────

  describe('getEventLanding', () => {
    it('returns event meta + only public streams', async () => {
      mockPrisma.event.findFirst.mockResolvedValueOnce({
        slug: 'spring',
        title: 'Spring Cup',
        description: 'Open tournament',
        scheduledAt: null,
        startedAt: new Date(),
        endedAt: null,
        org: { slug: 'club1', name: 'Club One' },
        eventStreams: [
          {
            stream: {
              slug: 'mat-a', name: 'Mat A',
              isLive: true, previewMode: 'multicam', previewImagePath: 'p.jpg',
            },
          },
        ],
      });

      const r = await service.getEventLanding('club1', 'spring');
      expect(r.orgSlug).toBe('club1');
      expect(r.orgName).toBe('Club One');
      expect(r.eventSlug).toBe('spring');
      expect(r.title).toBe('Spring Cup');
      expect(r.streams).toHaveLength(1);
      expect(r.streams[0]).toEqual({
        slug: 'mat-a',
        name: 'Mat A',
        isLive: true,
        previewMode: 'multicam',
        hasCustomPreview: true,
      });

      // Регрессия: select.eventStreams применил фильтр isPublic=true,
      // чтобы приватные Stream'ы Event'а не светились на landing-странице.
      const callArgs = mockPrisma.event.findFirst.mock.calls[0][0];
      expect(callArgs.select.eventStreams.where).toEqual({
        stream: { isPublic: true },
      });
    });

    it('throws 404 when event does not exist', async () => {
      mockPrisma.event.findFirst.mockResolvedValueOnce(null);
      await expect(service.getEventLanding('club1', 'ghost')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws 404 when org is inactive (WHERE includes org.isActive=true)', async () => {
      mockPrisma.event.findFirst.mockResolvedValueOnce(null);
      await expect(service.getEventLanding('inactive', 'spring')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      const callArgs = mockPrisma.event.findFirst.mock.calls[0][0];
      expect(callArgs.where).toEqual({
        slug: 'spring',
        org: { slug: 'inactive', isActive: true },
      });
    });

    it('returns empty streams[] when event has no public streams attached', async () => {
      mockPrisma.event.findFirst.mockResolvedValueOnce({
        slug: 'no-streams',
        title: 'Empty Event',
        description: null,
        scheduledAt: null,
        startedAt: null,
        endedAt: null,
        org: { slug: 'club1', name: 'Club One' },
        eventStreams: [], // приватные Stream'ы отсечены WHERE-фильтром include
      });

      const r = await service.getEventLanding('club1', 'no-streams');
      expect(r.streams).toEqual([]);
    });
  });

  describe('getOrgWatch — default vs named Stream', () => {
    it('without streamSlug → default Stream (regression: slug="" filter applied)', async () => {
      mockPrisma.stream.findFirst.mockResolvedValueOnce({
        slug: '',
        name: 'Default',
        description: null,
        isLive: true,
        isPublic: true,
        previewKey: null,
        org: { slug: 'org1', name: 'Org One', description: null },
      });

      const result = await service.getOrgWatch('org1');

      expect(result.streamSlug).toBe('');
      expect(result.streamTitle).toBe('Default');
      // Регрессия: запрос должен идти по slug='' (default Stream орги).
      const callArgs = mockPrisma.stream.findFirst.mock.calls[0][0];
      expect(callArgs.where).toEqual({
        slug: '',
        org: { slug: 'org1', isActive: true },
      });
    });

    it("with streamSlug='foo' → named Stream lookup", async () => {
      mockPrisma.stream.findFirst.mockResolvedValueOnce({
        slug: 'foo',
        name: 'Foo Stream',
        description: 'desc',
        isLive: true,
        isPublic: true,
        previewKey: null,
        org: { slug: 'org1', name: 'Org One', description: null },
      });

      const result = await service.getOrgWatch('org1', 'foo');

      expect(result.streamSlug).toBe('foo');
      expect(result.streamTitle).toBe('Foo Stream');
      const callArgs = mockPrisma.stream.findFirst.mock.calls[0][0];
      expect(callArgs.where).toEqual({
        slug: 'foo',
        org: { slug: 'org1', isActive: true },
      });
    });

    it('throws 404 when named Stream does not exist', async () => {
      mockPrisma.stream.findFirst.mockResolvedValueOnce(null);
      await expect(service.getOrgWatch('org1', 'nonexistent')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("treats streamSlug='' identically to undefined (backward-compat)", async () => {
      mockPrisma.stream.findFirst.mockResolvedValueOnce({
        slug: '',
        name: 'Default',
        description: null,
        isLive: true,
        isPublic: true,
        previewKey: null,
        org: { slug: 'org1', name: 'Org One', description: null },
      });

      const result = await service.getOrgWatch('org1', '');
      expect(result.streamSlug).toBe('');
      const callArgs = mockPrisma.stream.findFirst.mock.calls[0][0];
      expect(callArgs.where.slug).toBe('');
    });
  });

  describe('getStreamUrl — named Stream URLs', () => {
    it("composite named Stream → URL contains /streams/<streamSlug>/live/hls/master.m3u8", async () => {
      mockPrisma.stream.findFirst.mockResolvedValueOnce({
        id: 's-named-c',
        isLive: true,
        isPublic: true,
        previewKey: null,
        mode: 'composite',
        slotCount: 1,
        slots: [{ index: 1, name: '' }],
        slotOrder: [1],
        layoutPreset: 'solo',
        fallbackLayouts: null,
      });

      const result = await service.getStreamUrl('club1', 'foo');

      expect(result.mode).toBe('composite');
      expect(result.hlsUrls).toEqual([
        {
          slotIndex: 1,
          url: '/api/v1/public/orgs/club1/streams/foo/live/hls/master.m3u8',
        },
      ]);
    });

    it("multistream named Stream → per-slot URLs contain /streams/<streamSlug>/live/hls/<n>/index.m3u8", async () => {
      mockPrisma.stream.findFirst.mockResolvedValueOnce({
        id: 's-named-m',
        isLive: true,
        isPublic: true,
        previewKey: null,
        mode: 'multistream',
        slotCount: 3,
        slots: [
          { index: 1, name: 'Cam A' },
          { index: 2, name: 'Cam B' },
          { index: 3, name: 'Cam C' },
        ],
        slotOrder: [1, 2, 3],
        layoutPreset: 'pyramid',
        fallbackLayouts: null,
      });

      const result = await service.getStreamUrl('club1', 'foo');

      expect(result.mode).toBe('multistream');
      expect(result.hlsUrls).toEqual([
        {
          slotIndex: 1,
          url: '/api/v1/public/orgs/club1/streams/foo/live/hls/1/index.m3u8',
        },
        {
          slotIndex: 2,
          url: '/api/v1/public/orgs/club1/streams/foo/live/hls/2/index.m3u8',
        },
        {
          slotIndex: 3,
          url: '/api/v1/public/orgs/club1/streams/foo/live/hls/3/index.m3u8',
        },
      ]);
    });

    it("default Stream (no streamSlug) still emits backward-compat URLs without /streams/ segment", async () => {
      mockPrisma.stream.findFirst.mockResolvedValueOnce({
        id: 's-default',
        isLive: true,
        isPublic: true,
        previewKey: null,
        mode: 'composite',
        slotCount: 1,
        slots: [{ index: 1, name: '' }],
        slotOrder: [1],
        layoutPreset: 'solo',
        fallbackLayouts: null,
      });

      const result = await service.getStreamUrl('club1');

      expect(result.hlsUrls).toEqual([
        { slotIndex: 1, url: '/api/v1/public/orgs/club1/live/hls/master.m3u8' },
      ]);
    });

    it('named Stream private + correct key → returns hlsUrls', async () => {
      mockPrisma.stream.findFirst.mockResolvedValueOnce({
        id: 's-private',
        isLive: true,
        isPublic: false,
        previewKey: 'secret',
        mode: 'composite',
        slotCount: 1,
        slots: [{ index: 1, name: '' }],
        slotOrder: [1],
        layoutPreset: 'solo',
        fallbackLayouts: null,
      });

      const result = await service.getStreamUrl('club1', 'foo', 'secret');
      expect(result.hlsUrls[0].url).toBe(
        '/api/v1/public/orgs/club1/streams/foo/live/hls/master.m3u8',
      );
    });
  });

  describe('getOrgBroadcasts — default vs named Stream', () => {
    it('without streamSlug → default Stream regression', async () => {
      mockPrisma.stream.findFirst.mockResolvedValueOnce({
        id: 's-default',
        isPublic: true,
        previewKey: null,
      });
      mockPrisma.broadcast.findMany.mockResolvedValueOnce([]);

      await service.getOrgBroadcasts('org1');

      const callArgs = mockPrisma.stream.findFirst.mock.calls[0][0];
      expect(callArgs.where).toEqual({
        slug: '',
        org: { slug: 'org1', isActive: true },
      });
    });

    it("with streamSlug='foo' → named Stream lookup", async () => {
      mockPrisma.stream.findFirst.mockResolvedValueOnce({
        id: 's-foo',
        isPublic: true,
        previewKey: null,
      });
      mockPrisma.broadcast.findMany.mockResolvedValueOnce([]);

      await service.getOrgBroadcasts('org1', 'foo');

      const callArgs = mockPrisma.stream.findFirst.mock.calls[0][0];
      expect(callArgs.where).toEqual({
        slug: 'foo',
        org: { slug: 'org1', isActive: true },
      });
      // broadcast'ы по streamId этого Stream'а
      expect(mockPrisma.broadcast.findMany.mock.calls[0][0].where.streamId).toBe(
        's-foo',
      );
    });
  });

  describe('getThumbnail — default vs named Stream', () => {
    it('without streamSlug + live → snapshot for orgSlug (backward-compat)', async () => {
      mockPrisma.stream.findFirst.mockResolvedValueOnce({
        isLive: true,
        previewMode: 'multicam',
        previewImagePath: null,
      });
      mockThumbnail.getSnapshot.mockResolvedValueOnce(Buffer.from('jpg'));

      const result = await service.getThumbnail('org1');

      expect(mockThumbnail.getSnapshot).toHaveBeenCalledWith('org1', 'multicam');
      expect(result.buffer).toEqual(Buffer.from('jpg'));
    });

    it("with streamSlug='foo' + live → snapshot key '<orgSlug>/<streamSlug>'", async () => {
      mockPrisma.stream.findFirst.mockResolvedValueOnce({
        isLive: true,
        previewMode: 'cam1',
        previewImagePath: null,
      });
      mockThumbnail.getSnapshot.mockResolvedValueOnce(Buffer.from('jpg2'));

      const result = await service.getThumbnail('org1', 'foo');

      expect(mockThumbnail.getSnapshot).toHaveBeenCalledWith('org1/foo', 'cam1');
      expect(result.buffer).toEqual(Buffer.from('jpg2'));
    });

    it('named Stream not found → 404', async () => {
      mockPrisma.stream.findFirst.mockResolvedValueOnce(null);
      await expect(service.getThumbnail('org1', 'nonexistent')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
