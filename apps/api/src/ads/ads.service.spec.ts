import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdsService } from './ads.service';
import { PrismaService } from '../prisma/prisma.service';
import { ImageService } from '../storage/image.service';

const mockPrisma = {
  ad: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  adEvent: {
    groupBy: jest.fn(),
    create: jest.fn(),
  },
};

const mockImages = {
  upload: jest.fn(),
  serve: jest.fn(),
  delete: jest.fn(),
};

const AD = {
  id: 'ad1',
  title: 'КредитБанк',
  subtitle: null,
  targetUrl: 'https://example.com',
  isActive: true,
  sortOrder: 0,
  imagePathWatch: null,
  imagePathCatalog: null,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
};

describe('AdsService', () => {
  let service: AdsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.ad.findUnique.mockResolvedValue(AD);
    mockPrisma.ad.create.mockImplementation(({ data }: any) => Promise.resolve({ ...AD, ...data }));
    mockPrisma.ad.update.mockImplementation(({ data }: any) => Promise.resolve({ ...AD, ...data }));

    const module = await Test.createTestingModule({
      providers: [
        AdsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ImageService, useValue: mockImages },
      ],
    }).compile();
    service = module.get(AdsService);
  });

  describe('create', () => {
    it('отвергает пустой заголовок', async () => {
      await expect(service.create({ title: '  ', targetUrl: 'https://x.com' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('отвергает отсутствующую ссылку', async () => {
      await expect(service.create({ title: 'Реклама' } as any)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('отвергает ссылку без http/https схемы — иначе хранимая XSS через javascript:', async () => {
      await expect(
        service.create({ title: 'Реклама', targetUrl: 'javascript:alert(1)' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('обрезает пробелы в заголовке и ссылке', async () => {
      await service.create({ title: '  Реклама  ', targetUrl: '  https://x.com  ' });
      expect(mockPrisma.ad.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ title: 'Реклама', targetUrl: 'https://x.com' }) }),
      );
    });

    it('создаёт объявление с валидными полями', async () => {
      await expect(
        service.create({ title: 'Реклама', targetUrl: 'https://example.com', subtitle: 'Подзаголовок' }),
      ).resolves.toMatchObject({ title: 'Реклама' });
    });
  });

  describe('update', () => {
    it('404, если объявления нет', async () => {
      mockPrisma.ad.findUnique.mockResolvedValue(null);
      await expect(service.update('нет', { title: 'X' })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('позволяет частичное обновление без остальных полей', async () => {
      await service.update('ad1', { isActive: false });
      expect(mockPrisma.ad.update).toHaveBeenCalledWith({ where: { id: 'ad1' }, data: { isActive: false } });
    });

    it('отвергает подмену ссылки на javascript: так же, как create', async () => {
      await expect(service.update('ad1', { targetUrl: 'javascript:alert(1)' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mockPrisma.ad.update).not.toHaveBeenCalled();
    });

    it('P2025 из Prisma превращается в 404', async () => {
      mockPrisma.ad.update.mockRejectedValue({ code: 'P2025' });
      await expect(service.update('ad1', { title: 'X' })).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('remove', () => {
    it('удаляет обе картинки, если они были', async () => {
      mockPrisma.ad.findUnique.mockResolvedValue({
        ...AD,
        imagePathWatch: 'images/ad/ad1-watch.jpg',
        imagePathCatalog: 'images/ad/ad1-catalog.jpg',
      });

      await service.remove('ad1');

      expect(mockImages.delete).toHaveBeenCalledWith('images/ad/ad1-watch.jpg');
      expect(mockImages.delete).toHaveBeenCalledWith('images/ad/ad1-catalog.jpg');
      expect(mockPrisma.ad.delete).toHaveBeenCalledWith({ where: { id: 'ad1' } });
    });

    it('не трогает ImageService, если картинок не было', async () => {
      await service.remove('ad1');
      expect(mockImages.delete).not.toHaveBeenCalled();
    });
  });

  describe('изображения по плейсментам', () => {
    it('загрузка watch-картинки пишет в imagePathWatch как Medium Rectangle 300×250 без обрезки (contain), не задевая imagePathCatalog', async () => {
      await service.uploadImage('ad1', 'watch', Buffer.from('img'));
      expect(mockImages.upload).toHaveBeenCalledWith('images/ad/ad1-watch.jpg', expect.any(Buffer), 300, 250, 'contain');
      expect(mockPrisma.ad.update).toHaveBeenCalledWith({
        where: { id: 'ad1' },
        data: { imagePathWatch: 'images/ad/ad1-watch.jpg' },
      });
    });

    it('загрузка catalog-картинки пишет в imagePathCatalog как Leaderboard 728×90 без обрезки (contain)', async () => {
      await service.uploadImage('ad1', 'catalog', Buffer.from('img'));
      expect(mockImages.upload).toHaveBeenCalledWith('images/ad/ad1-catalog.jpg', expect.any(Buffer), 728, 90, 'contain');
      expect(mockPrisma.ad.update).toHaveBeenCalledWith({
        where: { id: 'ad1' },
        data: { imagePathCatalog: 'images/ad/ad1-catalog.jpg' },
      });
    });

    it('удаление картинки чистит S3-объект и обнуляет колонку', async () => {
      mockPrisma.ad.findUnique.mockResolvedValue({ ...AD, imagePathWatch: 'images/ad/ad1-watch.jpg' });
      await service.deleteImage('ad1', 'watch');
      expect(mockImages.delete).toHaveBeenCalledWith('images/ad/ad1-watch.jpg');
      expect(mockPrisma.ad.update).toHaveBeenCalledWith({ where: { id: 'ad1' }, data: { imagePathWatch: null } });
    });
  });

  describe('listActive', () => {
    it('отдаёт URL картинки только для тех плейсментов, где она есть', async () => {
      mockPrisma.ad.findMany.mockResolvedValue([
        { ...AD, id: 'ad1', imagePathWatch: 'images/ad/ad1-watch.jpg', imagePathCatalog: null },
      ]);

      const [ad] = await service.listActive();

      expect(ad.watchImageUrl).toBe('/v1/public/ads/ad1/image/watch');
      expect(ad.catalogImageUrl).toBeNull();
    });

    it('фильтрует по isActive на уровне запроса', async () => {
      mockPrisma.ad.findMany.mockResolvedValue([]);
      await service.listActive();
      expect(mockPrisma.ad.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } }),
      );
    });
  });

  describe('serveImage', () => {
    it('null, если для плейсмента нет картинки — без похода в ImageService', async () => {
      mockPrisma.ad.findUnique.mockResolvedValue({ imagePathWatch: null, imagePathCatalog: null });
      await expect(service.serveImage('ad1', 'watch')).resolves.toBeNull();
      expect(mockImages.serve).not.toHaveBeenCalled();
    });

    it('отдаёт буфер из ImageService по ключу нужного плейсмента', async () => {
      mockPrisma.ad.findUnique.mockResolvedValue({
        imagePathWatch: 'images/ad/ad1-watch.jpg',
        imagePathCatalog: 'images/ad/ad1-catalog.jpg',
      });
      mockImages.serve.mockResolvedValue(Buffer.from('jpeg'));

      await service.serveImage('ad1', 'catalog');
      expect(mockImages.serve).toHaveBeenCalledWith('images/ad/ad1-catalog.jpg');
    });
  });

  describe('recordEvent', () => {
    it('не роняется на ошибке Prisma (например, FK на удалённое объявление)', async () => {
      mockPrisma.adEvent.create.mockRejectedValue({ code: 'P2003' });
      await expect(service.recordEvent('нет-такого', 'watch', 'impression', null)).resolves.toBeUndefined();
    });

    it('пишет reason только при kind=dismiss_reason', async () => {
      await service.recordEvent('ad1', 'watch', 'dismiss_timeout', 'Неинтересно');
      expect(mockPrisma.adEvent.create).toHaveBeenCalledWith({
        data: { adId: 'ad1', placement: 'watch', kind: 'dismiss_timeout', reason: null },
      });
    });
  });

  describe('stats', () => {
    it('404, если объявления нет', async () => {
      mockPrisma.ad.findUnique.mockResolvedValue(null);
      await expect(service.stats('нет')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('агрегирует показы, тайм-ауты и причины закрытия по отдельности', async () => {
      mockPrisma.adEvent.groupBy.mockResolvedValue([
        { kind: 'impression', reason: null, _count: 10 },
        { kind: 'dismiss_timeout', reason: null, _count: 4 },
        { kind: 'dismiss_no_reason', reason: null, _count: 1 },
        { kind: 'dismiss_reason', reason: 'Неинтересно', _count: 2 },
        { kind: 'dismiss_reason', reason: 'Слишком часто', _count: 1 },
      ]);

      const stats = await service.stats('ad1');

      expect(stats).toMatchObject({
        impressions: 10,
        dismissTimeout: 4,
        dismissNoReason: 1,
        reasons: { 'Неинтересно': 2, 'Слишком часто': 1 },
        dismissed: 8,
      });
      expect(stats.dismissRate).toBeCloseTo(0.8);
    });

    it('dismissRate = 0, если показов ещё не было', async () => {
      mockPrisma.adEvent.groupBy.mockResolvedValue([]);
      const stats = await service.stats('ad1');
      expect(stats.dismissRate).toBe(0);
    });
  });
});
