import { PrismaService } from '../prisma/prisma.service';
import { ImageService } from '../storage/image.service';
import { ThumbnailService } from '../thumbnail/thumbnail.service';
import { EventFeedService } from './event-feed.service';

const publicStream = {
  orgId: 'org', org: { slug: 'club' }, slug: 'main', isLive: true, isPublic: true,
  feedMode: 'composite', previewImagePath: null,
};

const event = {
  id: 'event', orgId: 'org', title: 'Тестовый турнир', sport: 'Борьба', level: 'local',
  birthYearFrom: null, birthYearTo: null, city: null, address: null, regionCode: null, timeZone: null,
  startsOn: new Date('2026-12-02'), endsOn: new Date('2026-12-03'),
  startedAt: new Date('2026-12-02T04:00:00Z'), endedAt: null,
  posterPath: 'private-s3-key', bouts: [],
};

const venue = { id: 'v1', number: 1, name: null, quad: 2, stream: publicStream };

describe('публичная лента турниров', () => {
  const prisma = {
    event: { findFirst: jest.fn(), findMany: jest.fn() },
    venue: { findFirst: jest.fn() },
    athlete: { findFirst: jest.fn() },
  };
  const images = { serve: jest.fn() };
  const thumbnails = { getSnapshot: jest.fn() };
  const service = new EventFeedService(
    prisma as unknown as PrismaService, images as unknown as ImageService, thumbnails as unknown as ThumbnailService,
  );

  beforeEach(() => jest.resetAllMocks());

  it('отдаёт календарные даты и продолжает ленту на той же дате по id', async () => {
    prisma.event.findMany.mockResolvedValueOnce([{ ...event, venues: [] }, { ...event, id: 'next', venues: [] }])
      .mockResolvedValueOnce([{ ...event, id: 'next', venues: [] }]);
    const page = await service.listEvents({ limit: 1 });
    expect(page.items).toMatchObject([{
      id: 'event', startsOn: '2026-12-02', endsOn: '2026-12-03',
      posterUrl: '/api/v1/public/events/event/poster', isLive: true,
    }]);
    expect(page.items[0]).not.toHaveProperty('posterPath');
    expect(page.nextCursor).toEqual(expect.any(String));
    const next = await service.listEvents({ limit: 1, cursor: page.nextCursor! });
    expect(next.items.map(({ id }) => id)).toEqual(['next']);
    expect(next.nextCursor).toBeNull();
    expect(prisma.event.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: {
        org: { isActive: true }, publishedAt: { not: null },
        OR: [{ startsOn: { lt: event.startsOn } }, { startsOn: event.startsOn, id: { gt: 'event' } }],
      },
      take: 2,
    }));
  });

  it('скрывает видео и стоп-кадр закрытого или чужого потока, сохраняя ковёр', async () => {
    prisma.event.findFirst.mockResolvedValue({
      ...event,
      venues: [
        venue,
        { ...venue, id: 'v2', number: 2, stream: { ...publicStream, isPublic: false, previewKey: 'secret' } },
        { ...venue, id: 'v3', number: 3, stream: { ...publicStream, orgId: 'other' } },
        { ...venue, id: 'v4', number: 4, stream: null },
        { ...venue, id: 'v5', number: 5, stream: { ...publicStream, feedMode: 'single', slug: '' } },
      ],
    });
    const card = await service.getEvent('event');
    expect(card.venues).toMatchObject([
      {
        number: 1, hlsUrl: expect.stringContaining('/api/v1/public/orgs/club/streams/main/live/hls/master.m3u8'),
        thumbnailUrl: '/api/v1/public/events/event/venues/v1/thumbnail', quad: 2,
      },
      { number: 2, hlsUrl: null, thumbnailUrl: null, quad: null },
      { number: 3, hlsUrl: null, thumbnailUrl: null, quad: null },
      { number: 4, hlsUrl: null, thumbnailUrl: null, quad: null },
      { number: 5, hlsUrl: '/api/v1/public/orgs/club/live/hls/master.m3u8', quad: null },
    ]);
    expect(JSON.stringify(card)).not.toContain('secret');
  });

  it('запрашивает полный кадр и подставляет загруженное превью, если кадр ещё недоступен', async () => {
    prisma.venue.findFirst.mockResolvedValue({
      ...venue, event: { orgId: 'org' }, stream: { ...publicStream, previewImagePath: 'preview' },
    });
    thumbnails.getSnapshot.mockResolvedValue(null);
    images.serve.mockResolvedValue(Buffer.from('preview'));
    await expect(service.getVenueThumbnail('event', 'v1')).resolves.toEqual(Buffer.from('preview'));
    expect(thumbnails.getSnapshot).toHaveBeenCalledWith('club/main', 'full', 'club/main:full');
    expect(images.serve).toHaveBeenCalledWith('preview');
  });

  it('при прямом запросе заново проверяет доступ к стоп-кадру', async () => {
    prisma.venue.findFirst.mockResolvedValue({
      ...venue, event: { orgId: 'org' }, stream: { ...publicStream, isPublic: false },
    });
    await expect(service.getVenueThumbnail('event', 'v1')).rejects.toMatchObject({ status: 404 });
    expect(thumbnails.getSnapshot).not.toHaveBeenCalled();
    expect(images.serve).not.toHaveBeenCalled();
  });
});
