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

  describe('getStreamUrl — default Stream', () => {
    it('returns { hlsUrl } with default-org URL for a live public Stream', async () => {
      mockPrisma.stream.findFirst.mockResolvedValueOnce({
        id: 's1',
        isLive: true,
        isPublic: true,
        previewKey: null,
      });

      const result = await service.getStreamUrl('myorg');

      expect(result).toEqual({
        hlsUrl: '/api/v1/public/orgs/myorg/live/hls/master.m3u8',
      });
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
      });
      await expect(service.getStreamUrl('myorg')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws 404 when stream is private and key does not match', async () => {
      mockPrisma.stream.findFirst.mockResolvedValueOnce({
        id: 's1',
        isLive: true,
        isPublic: false,
        previewKey: 'expected-key',
      });
      await expect(
        service.getStreamUrl('myorg', undefined, 'wrong-key'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns { hlsUrl } for a private stream when key matches', async () => {
      mockPrisma.stream.findFirst.mockResolvedValueOnce({
        id: 's1',
        isLive: true,
        isPublic: false,
        previewKey: 'secret-key',
      });
      const result = await service.getStreamUrl('myorg', undefined, 'secret-key');
      expect(result).toEqual({
        hlsUrl: '/api/v1/public/orgs/myorg/live/hls/master.m3u8',
      });
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
      // Плоский список stream-карточек, без дискриминанта `type`.
      expect(result).toEqual([
        {
          orgSlug: 'club1',
          orgName: 'Club One',
          streamSlug: 'mat-a',
          streamName: 'Mat A',
          isLive: true,
          previewMode: 'multicam',
          hasCustomPreview: true,
        },
        {
          orgSlug: 'club1',
          orgName: 'Club One',
          streamSlug: '',
          streamName: 'Main feed',
          isLive: true,
          previewMode: 'multicam',
          hasCustomPreview: false,
        },
        {
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
    it("named Stream → hlsUrl contains /streams/<streamSlug>/live/hls/master.m3u8", async () => {
      mockPrisma.stream.findFirst.mockResolvedValueOnce({
        id: 's-named',
        isLive: true,
        isPublic: true,
        previewKey: null,
      });

      const result = await service.getStreamUrl('club1', 'foo');

      expect(result).toEqual({
        hlsUrl: '/api/v1/public/orgs/club1/streams/foo/live/hls/master.m3u8',
      });
    });

    it("default Stream (no streamSlug) → hlsUrl without /streams/ segment", async () => {
      mockPrisma.stream.findFirst.mockResolvedValueOnce({
        id: 's-default',
        isLive: true,
        isPublic: true,
        previewKey: null,
      });

      const result = await service.getStreamUrl('club1');

      expect(result).toEqual({
        hlsUrl: '/api/v1/public/orgs/club1/live/hls/master.m3u8',
      });
    });

    it('named Stream private + correct key → returns correct hlsUrl', async () => {
      mockPrisma.stream.findFirst.mockResolvedValueOnce({
        id: 's-private',
        isLive: true,
        isPublic: false,
        previewKey: 'secret',
      });

      const result = await service.getStreamUrl('club1', 'foo', 'secret');
      expect(result).toEqual({
        hlsUrl: '/api/v1/public/orgs/club1/streams/foo/live/hls/master.m3u8',
      });
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
