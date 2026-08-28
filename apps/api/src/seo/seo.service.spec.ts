import { Test } from '@nestjs/testing';
import { SeoService } from './seo.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  stream: { findMany: jest.fn() },
  organization: { findFirst: jest.fn() },
  broadcast: { groupBy: jest.fn(), aggregate: jest.fn(), findUnique: jest.fn() },
};

const NOW = new Date('2026-08-28T12:00:00.000Z');

describe('SeoService', () => {
  let service: SeoService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [SeoService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(SeoService);
  });

  describe('getSitemapUrls', () => {
    it('всегда отдаёт статические страницы, включая логин', async () => {
      mockPrisma.stream.findMany.mockResolvedValueOnce([]);

      const urls = await service.getSitemapUrls(NOW);
      const paths = urls.map((u) => u.path);

      expect(paths).toEqual(['/', '/streams', '/organizations', '/archive', '/login']);
      expect(urls.find((u) => u.path === '/login')?.priority).toBe(0.3);
    });

    it('организацию с живым эфиром отдаёт вместе со страницей стрима', async () => {
      mockPrisma.stream.findMany.mockResolvedValueOnce([
        {
          id: 's1',
          slug: 'main',
          isLive: true,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          org: { slug: 'liga' },
        },
      ]);
      mockPrisma.broadcast.groupBy
        .mockResolvedValueOnce([]) // завершённые эфиры
        .mockResolvedValueOnce([]); // эфиры с готовой записью

      const urls = await service.getSitemapUrls(NOW);
      const org = urls.find((u) => u.path === '/watch/liga');
      const stream = urls.find((u) => u.path === '/watch/liga/main');

      expect(org).toMatchObject({ priority: 0.9, changeFrequency: 'hourly' });
      expect(stream).toMatchObject({ priority: 0.8 });
      // Архива нет — страницы архива в карте быть не должно.
      expect(urls.some((u) => u.path === '/watch/liga/archive')).toBe(false);
    });

    it('организацию без единого эфира в карту не пускает', async () => {
      mockPrisma.stream.findMany.mockResolvedValueOnce([
        { id: 's1', slug: 'main', isLive: false, createdAt: NOW, org: { slug: 'empty' } },
      ]);
      mockPrisma.broadcast.groupBy.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      const urls = await service.getSitemapUrls(NOW);

      expect(urls.some((u) => u.path.startsWith('/watch/empty'))).toBe(false);
    });

    it('архив организации попадает в карту только при готовой записи', async () => {
      const endedAt = new Date('2026-08-20T10:00:00.000Z');
      mockPrisma.stream.findMany.mockResolvedValueOnce([
        { id: 's1', slug: 'main', isLive: false, createdAt: NOW, org: { slug: 'liga' } },
      ]);
      mockPrisma.broadcast.groupBy
        .mockResolvedValueOnce([{ streamId: 's1', _count: { _all: 4 }, _max: { endedAt } }])
        .mockResolvedValueOnce([{ streamId: 's1', _count: { _all: 2 } }]);

      const urls = await service.getSitemapUrls(NOW);
      const archive = urls.find((u) => u.path === '/watch/liga/archive');

      expect(archive).toMatchObject({ priority: 0.4, changeFrequency: 'weekly' });
      expect(urls.find((u) => u.path === '/watch/liga')?.lastModified).toBe(endedAt.toISOString());
    });

    it('организация живая, если жив хотя бы один её стрим; молчащий стрим при этом noindex', async () => {
      mockPrisma.stream.findMany.mockResolvedValueOnce([
        { id: 'live', slug: 'court-1', isLive: true, createdAt: NOW, org: { slug: 'liga' } },
        { id: 'idle', slug: 'court-2', isLive: false, createdAt: NOW, org: { slug: 'liga' } },
      ]);
      mockPrisma.broadcast.groupBy.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      const paths = (await service.getSitemapUrls(NOW)).map((u) => u.path);

      expect(paths).toContain('/watch/liga');
      expect(paths).toContain('/watch/liga/court-1');
      expect(paths).not.toContain('/watch/liga/court-2');
    });
  });

  describe('getPageMeta', () => {
    it('несуществующая организация — found: false', async () => {
      mockPrisma.organization.findFirst.mockResolvedValueOnce(null);

      expect(await service.getPageMeta('nope')).toMatchObject({ found: false, indexable: false });
    });

    it('приватный стрим не раскрывается: found: false, имя наружу не уходит', async () => {
      mockPrisma.organization.findFirst.mockResolvedValueOnce({
        id: 'o1', slug: 'liga', name: 'Лига', description: null, imagePath: null,
      });
      // findMany фильтрует по isPublic — приватного стрима в выдаче нет.
      mockPrisma.stream.findMany.mockResolvedValueOnce([]);

      const meta = await service.getPageMeta('liga', 'secret');

      expect(meta.found).toBe(false);
      expect(JSON.stringify(meta)).not.toContain('secret');
    });

    it('живой стрим отдаёт startedAt для BroadcastEvent', async () => {
      const startedAt = new Date('2026-08-28T11:30:00.000Z');
      mockPrisma.organization.findFirst.mockResolvedValueOnce({
        id: 'o1', slug: 'liga', name: 'Лига', description: 'Матчи', imagePath: 'images/org/o1.jpg',
      });
      mockPrisma.stream.findMany.mockResolvedValueOnce([
        { id: 's1', slug: 'main', name: 'Центральный корт', description: null, isLive: true, currentBroadcastId: 'b1' },
      ]);
      mockPrisma.broadcast.aggregate.mockResolvedValueOnce({ _count: { _all: 3 }, _max: { endedAt: null } });
      mockPrisma.broadcast.findUnique.mockResolvedValueOnce({ startedAt });

      const meta = await service.getPageMeta('liga', 'main');

      expect(meta).toMatchObject({ found: true, indexable: true });
      expect(meta.org).toMatchObject({ name: 'Лига', hasImage: true });
      expect(meta.stream).toMatchObject({ isLive: true, startedAt: startedAt.toISOString() });
    });

    it('организация без эфиров индексироваться не должна — то же решение, что и в sitemap', async () => {
      mockPrisma.organization.findFirst.mockResolvedValueOnce({
        id: 'o1', slug: 'empty', name: 'Пусто', description: null, imagePath: null,
      });
      mockPrisma.stream.findMany.mockResolvedValueOnce([
        { id: 's1', slug: 'main', name: '', description: null, isLive: false, currentBroadcastId: null },
      ]);
      mockPrisma.broadcast.aggregate.mockResolvedValueOnce({ _count: { _all: 0 }, _max: { endedAt: null } });

      const meta = await service.getPageMeta('empty');

      expect(meta).toMatchObject({ found: true, indexable: false });
    });
  });
});
