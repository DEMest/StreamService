import { Test } from '@nestjs/testing';
import { SeoPingService } from './seo-ping.service';
import { IndexNowService } from './indexnow.service';
import { GoogleIndexingService } from './google-indexing.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = { stream: { findUnique: jest.fn() } };
const mockIndexNow = { submit: jest.fn().mockResolvedValue(true) };
const mockGoogle = { enabled: true, publish: jest.fn().mockResolvedValue(true) };

const publicStream = {
  slug: 'main',
  isPublic: true,
  org: { slug: 'liga', isActive: true },
};

describe('SeoPingService', () => {
  let service: SeoPingService;
  const originalSiteUrl = process.env.SITE_URL;

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.SITE_URL = 'https://liga-live.ru';
    const module = await Test.createTestingModule({
      providers: [
        SeoPingService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: IndexNowService, useValue: mockIndexNow },
        { provide: GoogleIndexingService, useValue: mockGoogle },
      ],
    }).compile();
    service = module.get(SeoPingService);
  });

  afterAll(() => {
    if (originalSiteUrl === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = originalSiteUrl;
  });

  it('шлёт в IndexNow страницу трансляции и списки, где она видна', async () => {
    mockPrisma.stream.findUnique.mockResolvedValueOnce(publicStream);

    await service.notify('s1');

    expect(mockIndexNow.submit).toHaveBeenCalledWith([
      'https://liga-live.ru/watch/liga/main',
      'https://liga-live.ru/watch/liga',
      'https://liga-live.ru/streams',
      'https://liga-live.ru/',
    ]);
  });

  it('в Google уходит только страница трансляции — она единственная с BroadcastEvent', async () => {
    mockPrisma.stream.findUnique.mockResolvedValueOnce(publicStream);

    await service.notify('s1');

    expect(mockGoogle.publish).toHaveBeenCalledTimes(1);
    expect(mockGoogle.publish).toHaveBeenCalledWith('https://liga-live.ru/watch/liga/main', 'URL_UPDATED');
  });

  it('приватный стрим не пингуется вовсе', async () => {
    mockPrisma.stream.findUnique.mockResolvedValueOnce({ ...publicStream, isPublic: false });

    await service.notify('s1');

    expect(mockIndexNow.submit).not.toHaveBeenCalled();
    expect(mockGoogle.publish).not.toHaveBeenCalled();
  });

  it('отключённая организация не пингуется', async () => {
    mockPrisma.stream.findUnique.mockResolvedValueOnce({
      ...publicStream,
      org: { slug: 'liga', isActive: false },
    });

    await service.notify('s1');

    expect(mockIndexNow.submit).not.toHaveBeenCalled();
  });

  it('повторный пинг того же URL глушится троттлингом — защита от мигающего ингеста', async () => {
    mockPrisma.stream.findUnique.mockResolvedValue(publicStream);

    await service.notify('s1');
    await service.notify('s1');

    expect(mockIndexNow.submit).toHaveBeenCalledTimes(1);
    expect(mockGoogle.publish).toHaveBeenCalledTimes(1);
  });

  it('без SITE_URL молчит — на dev-стенде уведомлять поисковики не о чем', async () => {
    process.env.SITE_URL = '';

    await service.notify('s1');

    expect(mockPrisma.stream.findUnique).not.toHaveBeenCalled();
    expect(mockIndexNow.submit).not.toHaveBeenCalled();
  });

  it('localhost тоже считается выключенным', async () => {
    process.env.SITE_URL = 'http://localhost:3000';

    await service.notify('s1');

    expect(mockIndexNow.submit).not.toHaveBeenCalled();
  });
});
