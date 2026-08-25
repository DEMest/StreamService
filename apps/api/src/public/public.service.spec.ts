import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PublicService } from './public.service';
import { PrismaService } from '../prisma/prisma.service';
import { ThumbnailService } from '../thumbnail/thumbnail.service';
import { ImageService } from '../storage/image.service';

const mockPrisma = {
  stream: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  broadcast: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
  },
  organization: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
  },
};

const mockThumbnail = {
  getSnapshot: jest.fn(),
};

const mockImages = { upload: jest.fn(), delete: jest.fn(), serve: jest.fn() };

describe('PublicService', () => {
  let service: PublicService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        PublicService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ThumbnailService, useValue: mockThumbnail },
        { provide: ImageService, useValue: mockImages },
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

  // ───────────── catalog aggregates by Org (one card per org) ─────────────

  describe('getCatalog — one card per Org', () => {
    it('aggregates public Streams into a single card per org, with correct liveCount and hasImage', async () => {
      mockPrisma.organization.findMany.mockResolvedValueOnce([
        {
          slug: 'club1',
          name: 'Клуб 1',
          createdAt: new Date('2026-05-01T12:00:00Z'),
          imagePath: 'images/org/o1.jpg',
          streams: [
            { isLive: true },
            { isLive: false },
          ],
        },
      ]);

      const cards = await service.getCatalog();

      expect(cards[0]).toEqual({
        orgSlug: 'club1', orgName: 'Клуб 1', liveCount: 1, hasImage: true,
      });

      const callArgs = mockPrisma.organization.findMany.mock.calls[0][0];
      expect(callArgs.where).toEqual({ isActive: true });
      expect(callArgs.select.streams.where).toEqual({ isPublic: true });
    });

    it('org without image and zero public Streams → hasImage false, liveCount 0', async () => {
      mockPrisma.organization.findMany.mockResolvedValueOnce([
        {
          slug: 'club3',
          name: 'Club Three',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          imagePath: null,
          streams: [],
        },
      ]);

      const result = await service.getCatalog();

      expect(result).toEqual([
        {
          orgSlug: 'club3',
          orgName: 'Club Three',
          liveCount: 0,
          hasImage: false,
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
          imagePath: null,
          streams: [{ isLive: false }],
        },
        // live org, created earlier than the other live org
        {
          slug: 'live-older',
          name: 'Live Older',
          createdAt: t1,
          imagePath: null,
          streams: [{ isLive: true }],
        },
        // offline org, created earliest
        {
          slug: 'offline-older',
          name: 'Offline Older',
          createdAt: t2,
          imagePath: null,
          streams: [{ isLive: false }],
        },
        // live org, created latest
        {
          slug: 'live-newer',
          name: 'Live Newer',
          createdAt: t4,
          imagePath: null,
          streams: [{ isLive: true }],
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
          imagePath: null,
          streams: [
            { isLive: true },
            { isLive: true },
            { isLive: true },
          ],
        },
        // Более новая орга, но с МЕНЬШИМ liveCount (1). По правильному
        // правилу (createdAt DESC внутри live-группы) она должна быть первой.
        {
          slug: 'one-live-newer',
          name: 'One Live Newer',
          createdAt: newer,
          imagePath: null,
          streams: [
            { isLive: true },
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

  describe('getOrgImage', () => {
    it('returns buffer for active org with image', async () => {
      mockPrisma.organization.findFirst.mockResolvedValue({ imagePath: 'images/org/o1.jpg' });
      mockImages.serve.mockResolvedValue(Buffer.from('jpeg'));
      await expect(service.getOrgImage('club1')).resolves.toEqual(Buffer.from('jpeg'));
      expect(mockPrisma.organization.findFirst).toHaveBeenCalledWith({
        where: { slug: 'club1', isActive: true },
        select: { imagePath: true },
      });
    });

    it('404 when org has no image', async () => {
      mockPrisma.organization.findFirst.mockResolvedValue({ imagePath: null });
      await expect(service.getOrgImage('club1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('404 when org is missing/inactive', async () => {
      mockPrisma.organization.findFirst.mockResolvedValue(null);
      await expect(service.getOrgImage('ghost')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('404 when S3 object is gone', async () => {
      mockPrisma.organization.findFirst.mockResolvedValue({ imagePath: 'images/org/o1.jpg' });
      mockImages.serve.mockResolvedValue(null);
      await expect(service.getOrgImage('club1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ───────────── Task 5: getOrgOverview ─────────────

  describe('getOrgOverview', () => {
    it('returns org info + streams for an org with public Streams', async () => {
      mockPrisma.organization.findFirst.mockResolvedValueOnce({
        slug: 'club1',
        name: 'Club One',
        description: 'A club',
        imagePath: 'images/org/club1.jpg',
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
        hasImage: true,
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
        imagePath: null,
        streams: [],
      });

      const result = await service.getOrgOverview('club-empty');

      expect(result).toEqual({
        orgSlug: 'club-empty',
        orgName: 'Empty Club',
        orgDescription: null,
        hasImage: false,
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
        org: { slug: 'org1', name: 'Org One', description: null, imagePath: 'images/org/org1.jpg' },
      });

      const result = await service.getOrgWatch('org1', 'foo');

      expect(result).toEqual({
        slug: 'org1',
        name: 'Org One',
        description: null,
        hasImage: true,
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
        org: { slug: 'org1', name: 'Org One', description: null, imagePath: null },
      });

      const result = await service.getOrgWatch('org1', 'foo', 'wrong-key');

      expect(result).toEqual({
        slug: 'org1',
        name: 'Org One',
        hasImage: false,
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

    it('hasPreview: true когда есть previewImagePath, false когда нет', async () => {
      mockPrisma.stream.findFirst.mockResolvedValueOnce({
        id: 's-foo',
        isPublic: true,
        previewKey: null,
      });
      mockPrisma.broadcast.findMany.mockResolvedValueOnce([
        {
          id: 'b1', title: null, description: null,
          startedAt: new Date(), endedAt: new Date(),
          previewImagePath: 'archive/org1/foo/b1/preview.jpg',
          recordings: [],
        },
        {
          id: 'b2', title: null, description: null,
          startedAt: new Date(), endedAt: new Date(),
          previewImagePath: null,
          recordings: [],
        },
      ]);

      const result = await service.getOrgBroadcasts('org1', 'foo');

      expect(result[0].hasPreview).toBe(true);
      expect(result[1].hasPreview).toBe(false);
      expect((result[0] as any).previewImagePath).toBeUndefined();
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

  describe('getGlobalArchive', () => {
    it('returns broadcasts across orgs/streams, labeled with org and stream identity', async () => {
      mockPrisma.broadcast.findMany.mockResolvedValueOnce([
        {
          id: 'b1', title: 'Матч 1', description: null,
          startedAt: new Date('2026-08-20T10:00:00Z'), endedAt: new Date('2026-08-20T12:00:00Z'),
          previewImagePath: 'archive/club1/main/b1/preview.jpg',
          stream: { slug: '', name: '', org: { slug: 'club1', name: 'Клуб 1' } },
          recordings: [{ id: 'r1', status: 'ready', fileSize: BigInt(123), duration: 60 }],
        },
        {
          id: 'b2', title: 'Матч 2', description: null,
          startedAt: new Date('2026-08-19T10:00:00Z'), endedAt: new Date('2026-08-19T12:00:00Z'),
          previewImagePath: null,
          stream: { slug: 'mat-b', name: 'Mat B', org: { slug: 'club1', name: 'Клуб 1' } },
          recordings: [],
        },
      ]);

      const result = await service.getGlobalArchive();

      expect(result).toEqual([
        {
          id: 'b1', title: 'Матч 1', description: null,
          startedAt: new Date('2026-08-20T10:00:00Z'), endedAt: new Date('2026-08-20T12:00:00Z'),
          hasPreview: true,
          recording: { id: 'r1', status: 'ready', fileSize: 123, duration: 60 },
          orgSlug: 'club1', orgName: 'Клуб 1',
          streamSlug: '', streamName: '',
        },
        {
          id: 'b2', title: 'Матч 2', description: null,
          startedAt: new Date('2026-08-19T10:00:00Z'), endedAt: new Date('2026-08-19T12:00:00Z'),
          hasPreview: false,
          recording: null,
          orgSlug: 'club1', orgName: 'Клуб 1',
          streamSlug: 'mat-b', streamName: 'Mat B',
        },
      ]);
    });

    it('queries only ended broadcasts of public Streams of active orgs, sorted by startedAt DESC', async () => {
      mockPrisma.broadcast.findMany.mockResolvedValueOnce([]);
      await service.getGlobalArchive();

      const callArgs = mockPrisma.broadcast.findMany.mock.calls[0][0];
      expect(callArgs.where).toEqual({
        endedAt: { not: null },
        stream: { isPublic: true, org: { isActive: true } },
      });
      expect(callArgs.orderBy).toEqual({ startedAt: 'desc' });
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

    it('serves offline preview from S3 by stored key', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({
        isLive: false, previewMode: 'multicam', previewImagePath: 'images/stream/st-1.jpg',
      });
      mockImages.serve.mockResolvedValue(Buffer.from('jpeg'));
      const r = await service.getThumbnail('club1', 'main');
      expect(mockImages.serve).toHaveBeenCalledWith('images/stream/st-1.jpg');
      expect(r).toEqual({ buffer: Buffer.from('jpeg'), maxAge: 300 });
    });

    it('404 when S3 object is missing', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({
        isLive: false, previewMode: 'multicam', previewImagePath: 'images/stream/st-1.jpg',
      });
      mockImages.serve.mockResolvedValue(null);
      await expect(service.getThumbnail('club1', 'main')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getBroadcastPreview', () => {
    const streamRow = { id: 'st-1', isPublic: true, previewKey: null };

    it('отдаёт JPEG публичного стрима', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue(streamRow);
      mockPrisma.broadcast.findFirst.mockResolvedValue({ previewImagePath: 'archive/club1/main/b1/preview.jpg' });
      mockImages.serve.mockResolvedValue(Buffer.from('jpeg'));
      await expect(service.getBroadcastPreview('club1', 'main', 'b1')).resolves.toEqual(Buffer.from('jpeg'));
    });

    it('404 для приватного стрима без ключа (существование не палим)', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({ id: 'st-1', isPublic: false, previewKey: 'sec' });
      await expect(service.getBroadcastPreview('club1', 'main', 'b1'))
        .rejects.toBeInstanceOf(NotFoundException);
      expect(mockPrisma.broadcast.findFirst).not.toHaveBeenCalled();
    });

    it('отдаёт приватному стриму по правильному key', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue({ id: 'st-1', isPublic: false, previewKey: 'sec' });
      mockPrisma.broadcast.findFirst.mockResolvedValue({ previewImagePath: 'k' });
      mockImages.serve.mockResolvedValue(Buffer.from('jpeg'));
      await expect(service.getBroadcastPreview('club1', 'main', 'b1', 'sec')).resolves.toEqual(Buffer.from('jpeg'));
    });

    it('404 когда превью не сгенерировано', async () => {
      mockPrisma.stream.findFirst.mockResolvedValue(streamRow);
      mockPrisma.broadcast.findFirst.mockResolvedValue({ previewImagePath: null });
      await expect(service.getBroadcastPreview('club1', 'main', 'b1'))
        .rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
