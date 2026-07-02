import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PublicService } from './public.service';
import { PrismaService } from '../prisma/prisma.service';
import { ThumbnailService } from '../thumbnail/thumbnail.service';

const mockPrisma = {
  stream: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  broadcast: {
    findMany: jest.fn(),
  },
  organization: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
  },
};

const mockThumbnail = {
  getSnapshot: jest.fn(),
};

describe('PublicService', () => {
  let service: PublicService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        PublicService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ThumbnailService, useValue: mockThumbnail },
      ],
    }).compile();
    service = module.get(PublicService);
  });

  describe('getStreamUrl', () => {
    it('returns { hlsUrl, feedMode } for a live public Stream', async () => {
      mockPrisma.stream.findFirst.mockResolvedValueOnce({
        isLive: true,
        isPublic: true,
        previewKey: null,
        feedMode: 'composite',
      });

      const result = await service.getStreamUrl('myorg', 'main');

      expect(result).toEqual({
        hlsUrl: '/api/v1/public/orgs/myorg/streams/main/live/hls/master.m3u8',
        feedMode: 'composite',
      });
    });

    it('throws 404 when stream is not found', async () => {
      mockPrisma.stream.findFirst.mockResolvedValueOnce(null);
      await expect(service.getStreamUrl('ghost', 'main')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws 404 when stream is not live', async () => {
      mockPrisma.stream.findFirst.mockResolvedValueOnce({
        isLive: false,
        isPublic: true,
        previewKey: null,
        feedMode: 'single',
      });
      await expect(service.getStreamUrl('myorg', 'main')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws 404 when stream is private and key does not match', async () => {
      mockPrisma.stream.findFirst.mockResolvedValueOnce({
        isLive: true,
        isPublic: false,
        previewKey: 'expected-key',
        feedMode: 'single',
      });
      await expect(
        service.getStreamUrl('myorg', 'main', 'wrong-key'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns { hlsUrl, feedMode } for a private stream when key matches', async () => {
      mockPrisma.stream.findFirst.mockResolvedValueOnce({
        isLive: true,
        isPublic: false,
        previewKey: 'secret-key',
        feedMode: 'single',
      });
      const result = await service.getStreamUrl('myorg', 'main', 'secret-key');
      expect(result).toEqual({
        hlsUrl: '/api/v1/public/orgs/myorg/streams/main/live/hls/master.m3u8',
        feedMode: 'single',
      });
    });

    it("named Stream → hlsUrl contains /streams/<streamSlug>/live/hls/master.m3u8", async () => {
      mockPrisma.stream.findFirst.mockResolvedValueOnce({
        isLive: true,
        isPublic: true,
        previewKey: null,
        feedMode: 'composite',
      });

      const result = await service.getStreamUrl('club1', 'foo');

      expect(result).toEqual({
        hlsUrl: '/api/v1/public/orgs/club1/streams/foo/live/hls/master.m3u8',
        feedMode: 'composite',
      });
    });

    it('named Stream private + correct key → returns correct hlsUrl', async () => {
      mockPrisma.stream.findFirst.mockResolvedValueOnce({
        isLive: true,
        isPublic: false,
        previewKey: 'secret',
        feedMode: 'single',
      });

      const result = await service.getStreamUrl('club1', 'foo', 'secret');
      expect(result).toEqual({
        hlsUrl: '/api/v1/public/orgs/club1/streams/foo/live/hls/master.m3u8',
        feedMode: 'single',
      });
    });
  });

  // ───────────── Task 5: catalog aggregates by Org (one card per org) ─────────────

  describe('getCatalog — one card per Org', () => {
    it('aggregates public Streams into a single card per org, with correct liveCount and representative fields', async () => {
      const now = new Date('2026-05-01T12:00:00Z');
      const later = new Date('2026-05-10T12:00:00Z');
      mockPrisma.organization.findMany.mockResolvedValueOnce([
        {
          slug: 'club1',
          name: 'Club One',
          createdAt: now,
          streams: [
            {
              slug: 'main',
              isLive: true,
              previewMode: 'multicam',
              previewImagePath: null,
              createdAt: now,
            },
            {
              slug: 'mat-a',
              isLive: true,
              previewMode: 'cam1',
              previewImagePath: 'club1/mat-a.jpg',
              createdAt: later,
            },
            {
              slug: 'mat-b',
              isLive: false,
              previewMode: 'cam2',
              previewImagePath: null,
              createdAt: later,
            },
          ],
        },
      ]);

      const result = await service.getCatalog();

      // liveCount = 2 (два live Stream'а); representative — первый LIVE
      // (первый в массиве live-стримов, previewMode='multicam', без кастомного превью, slug='main').
      expect(result).toEqual([
        {
          orgSlug: 'club1',
          orgName: 'Club One',
          liveCount: 2,
          previewMode: 'multicam',
          hasCustomPreview: false,
          representativeStreamSlug: 'main',
        },
      ]);

      const callArgs = mockPrisma.organization.findMany.mock.calls[0][0];
      expect(callArgs.where).toEqual({ isActive: true });
      expect(callArgs.select.streams.where).toEqual({ isPublic: true });
    });

    it('when no Stream is live, representative is the earliest by createdAt', async () => {
      const earlier = new Date('2026-01-01T00:00:00Z');
      const later = new Date('2026-02-01T00:00:00Z');
      mockPrisma.organization.findMany.mockResolvedValueOnce([
        {
          slug: 'club2',
          name: 'Club Two',
          createdAt: earlier,
          streams: [
            {
              slug: 'newer-cam',
              isLive: false,
              previewMode: 'cam1',
              previewImagePath: null,
              createdAt: later,
            },
            {
              slug: 'archive-cam',
              isLive: false,
              previewMode: 'multicam',
              previewImagePath: 'club2/preview.jpg',
              createdAt: earlier,
            },
          ],
        },
      ]);

      const result = await service.getCatalog();

      expect(result).toEqual([
        {
          orgSlug: 'club2',
          orgName: 'Club Two',
          liveCount: 0,
          previewMode: 'multicam',
          hasCustomPreview: true,
          representativeStreamSlug: 'archive-cam',
        },
      ]);
    });

    it('org with zero public Streams → previewMode falls back to "multicam", hasCustomPreview false', async () => {
      mockPrisma.organization.findMany.mockResolvedValueOnce([
        {
          slug: 'club3',
          name: 'Club Three',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          streams: [],
        },
      ]);

      const result = await service.getCatalog();

      expect(result).toEqual([
        {
          orgSlug: 'club3',
          orgName: 'Club Three',
          liveCount: 0,
          previewMode: 'multicam',
          hasCustomPreview: false,
          representativeStreamSlug: null,
        },
      ]);
    });

    it('sorts orgs with liveCount > 0 first, then by createdAt DESC within each group', async () => {
      const t1 = new Date('2026-01-01T00:00:00Z');
      const t2 = new Date('2026-02-01T00:00:00Z');
      const t3 = new Date('2026-03-01T00:00:00Z');
      const t4 = new Date('2026-04-01T00:00:00Z');
      mockPrisma.organization.findMany.mockResolvedValueOnce([
        // offline org, created later than the other offline org
        {
          slug: 'offline-newer',
          name: 'Offline Newer',
          createdAt: t3,
          streams: [{ isLive: false, previewMode: 'multicam', previewImagePath: null, createdAt: t3 }],
        },
        // live org, created earlier than the other live org
        {
          slug: 'live-older',
          name: 'Live Older',
          createdAt: t1,
          streams: [{ isLive: true, previewMode: 'multicam', previewImagePath: null, createdAt: t1 }],
        },
        // offline org, created earliest
        {
          slug: 'offline-older',
          name: 'Offline Older',
          createdAt: t2,
          streams: [{ isLive: false, previewMode: 'multicam', previewImagePath: null, createdAt: t2 }],
        },
        // live org, created latest
        {
          slug: 'live-newer',
          name: 'Live Newer',
          createdAt: t4,
          streams: [{ isLive: true, previewMode: 'multicam', previewImagePath: null, createdAt: t4 }],
        },
      ]);

      const result = await service.getCatalog();

      expect(result.map((c) => c.orgSlug)).toEqual([
        'live-newer',
        'live-older',
        'offline-newer',
        'offline-older',
      ]);
    });

    it('sorts live orgs by createdAt DESC, NOT by liveCount magnitude — regression', async () => {
      const older = new Date('2026-01-01T00:00:00Z');
      const newer = new Date('2026-02-01T00:00:00Z');
      mockPrisma.organization.findMany.mockResolvedValueOnce([
        // Более старая орга, но с БОЛЬШИМ liveCount (3). Компаратор,
        // сортирующий по величине liveCount, ошибочно поставил бы её первой.
        {
          slug: 'many-live-older',
          name: 'Many Live Older',
          createdAt: older,
          streams: [
            { isLive: true, previewMode: 'multicam', previewImagePath: null, createdAt: older },
            { isLive: true, previewMode: 'multicam', previewImagePath: null, createdAt: older },
            { isLive: true, previewMode: 'multicam', previewImagePath: null, createdAt: older },
          ],
        },
        // Более новая орга, но с МЕНЬШИМ liveCount (1). По правильному
        // правилу (createdAt DESC внутри live-группы) она должна быть первой.
        {
          slug: 'one-live-newer',
          name: 'One Live Newer',
          createdAt: newer,
          streams: [
            { isLive: true, previewMode: 'multicam', previewImagePath: null, createdAt: newer },
          ],
        },
      ]);

      const result = await service.getCatalog();

      expect(result.map((c) => c.orgSlug)).toEqual(['one-live-newer', 'many-live-older']);
      expect(result.map((c) => c.liveCount)).toEqual([1, 3]);
    });

    // Karen C3: catalog не должен показывать приватные Stream'ы. Приватный
    // Stream доступен исключительно через ?key=<previewKey> URL.
    it('filters out private Streams (isPublic=false) via nested where — regression', async () => {
      mockPrisma.organization.findMany.mockResolvedValueOnce([]);
      await service.getCatalog();
      const callArgs = mockPrisma.organization.findMany.mock.calls[0][0];
      expect(callArgs.select.streams.where).toEqual({ isPublic: true });
    });
  });

  // ───────────── Task 5: getOrgOverview ─────────────

  describe('getOrgOverview', () => {
    it('returns org info + streams for an org with public Streams', async () => {
      mockPrisma.organization.findFirst.mockResolvedValueOnce({
        slug: 'club1',
        name: 'Club One',
        description: 'A club',
        streams: [
          {
            slug: 'main',
            name: 'Main Mat',
            isLive: true,
            previewMode: 'multicam',
            previewImagePath: null,
          },
          {
            slug: 'mat-b',
            name: 'Mat B',
            isLive: false,
            previewMode: 'cam1',
            previewImagePath: 'club1/mat-b.jpg',
          },
        ],
      });

      const result = await service.getOrgOverview('club1');

      expect(result).toEqual({
        orgSlug: 'club1',
        orgName: 'Club One',
        orgDescription: 'A club',
        streams: [
          {
            streamSlug: 'main',
            streamName: 'Main Mat',
            isLive: true,
            previewMode: 'multicam',
            hasCustomPreview: false,
          },
          {
            streamSlug: 'mat-b',
            streamName: 'Mat B',
            isLive: false,
            previewMode: 'cam1',
            hasCustomPreview: true,
          },
        ],
      });

      const callArgs = mockPrisma.organization.findFirst.mock.calls[0][0];
      expect(callArgs.where).toEqual({ slug: 'club1', isActive: true });
      expect(callArgs.select.streams.where).toEqual({ isPublic: true });
    });

    it('org with no public Streams → streams: [] (not 404)', async () => {
      mockPrisma.organization.findFirst.mockResolvedValueOnce({
        slug: 'club-empty',
        name: 'Empty Club',
        description: null,
        streams: [],
      });

      const result = await service.getOrgOverview('club-empty');

      expect(result).toEqual({
        orgSlug: 'club-empty',
        orgName: 'Empty Club',
        orgDescription: null,
        streams: [],
      });
    });

    it('throws 404 when org does not exist or is inactive', async () => {
      mockPrisma.organization.findFirst.mockResolvedValueOnce(null);
      await expect(service.getOrgOverview('ghost')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getOrgWatch', () => {
    it('returns watch DTO (including feedMode) for a public live Stream', async () => {
      mockPrisma.stream.findFirst.mockResolvedValueOnce({
        slug: 'foo',
        name: 'Foo Stream',
        description: 'desc',
        isLive: true,
        isPublic: true,
        previewKey: null,
        feedMode: 'composite',
        org: { slug: 'org1', name: 'Org One', description: null },
      });

      const result = await service.getOrgWatch('org1', 'foo');

      expect(result).toEqual({
        slug: 'org1',
        name: 'Org One',
        description: null,
        streamSlug: 'foo',
        isLive: true,
        streamTitle: 'Foo Stream',
        streamDescription: 'desc',
        streamIsPublic: true,
        feedMode: 'composite',
      });
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

    it('private Stream + wrong/no key → accessDenied stub (includes feedMode)', async () => {
      mockPrisma.stream.findFirst.mockResolvedValueOnce({
        slug: 'foo',
        name: 'Foo Stream',
        description: 'desc',
        isLive: true,
        isPublic: false,
        previewKey: 'secret',
        feedMode: 'single',
        org: { slug: 'org1', name: 'Org One', description: null },
      });

      const result = await service.getOrgWatch('org1', 'foo', 'wrong-key');

      expect(result).toEqual({
        slug: 'org1',
        name: 'Org One',
        streamSlug: 'foo',
        isLive: false,
        streamTitle: '',
        streamDescription: null,
        streamIsPublic: false,
        feedMode: 'single',
        accessDenied: true,
      });
    });
  });

  describe('getOrgBroadcasts', () => {
    it('returns broadcasts for the named Stream', async () => {
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
      expect(mockPrisma.broadcast.findMany.mock.calls[0][0].where.streamId).toBe('s-foo');
    });

    it('throws 404 when Stream not found', async () => {
      mockPrisma.stream.findFirst.mockResolvedValueOnce(null);
      await expect(service.getOrgBroadcasts('org1', 'ghost')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('private Stream + wrong key → empty array', async () => {
      mockPrisma.stream.findFirst.mockResolvedValueOnce({
        id: 's-foo',
        isPublic: false,
        previewKey: 'secret',
      });

      const result = await service.getOrgBroadcasts('org1', 'foo', 'wrong-key');
      expect(result).toEqual([]);
      expect(mockPrisma.broadcast.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getThumbnail', () => {
    it("live Stream → snapshot key '<orgSlug>/<streamSlug>'", async () => {
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
