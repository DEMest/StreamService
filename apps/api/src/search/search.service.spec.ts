import { Test } from '@nestjs/testing';
import { SearchService } from './search.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  organization: { findMany: jest.fn() },
  stream: { findMany: jest.fn() },
  broadcast: { findMany: jest.fn() },
};

function emptyDb() {
  mockPrisma.organization.findMany.mockResolvedValue([]);
  mockPrisma.stream.findMany.mockResolvedValue([]);
  mockPrisma.broadcast.findMany.mockResolvedValue([]);
}

describe('SearchService', () => {
  let service: SearchService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [SearchService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(SearchService);
  });

  it('запрос короче двух символов до базы не доходит', async () => {
    const res = await service.search('в');

    expect(res).toEqual({ query: 'в', organizations: [], streams: [], broadcasts: [] });
    expect(mockPrisma.organization.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.stream.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.broadcast.findMany).not.toHaveBeenCalled();
  });

  it('пробелы по краям не считаются за длину запроса', async () => {
    await service.search('   в   ');

    expect(mockPrisma.organization.findMany).not.toHaveBeenCalled();
  });

  it('ищет без учёта регистра и только по публичному', async () => {
    emptyDb();

    await service.search('Вега');

    const orgWhere = mockPrisma.organization.findMany.mock.calls[0][0].where;
    const streamWhere = mockPrisma.stream.findMany.mock.calls[0][0].where;
    const broadcastWhere = mockPrisma.broadcast.findMany.mock.calls[0][0].where;

    expect(orgWhere).toEqual({ isActive: true, name: { contains: 'Вега', mode: 'insensitive' } });
    expect(streamWhere).toMatchObject({ isPublic: true, org: { isActive: true } });
    // Приватная трансляция не должна находиться по названию — она открывается
    // только по ссылке с previewKey.
    expect(streamWhere.name).toEqual({ contains: 'Вега', mode: 'insensitive' });
    expect(broadcastWhere).toMatchObject({
      endedAt: { not: null },
      stream: { isPublic: true, org: { isActive: true } },
    });
  });

  it('слишком длинный запрос обрезается, а не уходит в базу целиком', async () => {
    emptyDb();
    const long = 'а'.repeat(500);

    const res = await service.search(long);

    expect(res.query).toHaveLength(100);
    expect(mockPrisma.organization.findMany.mock.calls[0][0].where.name.contains).toHaveLength(100);
  });

  it('собирает результаты трёх категорий в плоские карточки', async () => {
    mockPrisma.organization.findMany.mockResolvedValueOnce([
      { slug: 'vegasport', name: 'Вега Спорт', imagePath: 'images/org/o1.jpg', streams: [{ isLive: true }, { isLive: false }] },
    ]);
    mockPrisma.stream.findMany.mockResolvedValueOnce([
      { slug: 'arena', name: 'Арена', isLive: true, org: { slug: 'vegasport', name: 'Вега Спорт' } },
    ]);
    mockPrisma.broadcast.findMany.mockResolvedValueOnce([
      {
        id: 'b1',
        title: 'Вега — Динамо',
        startedAt: new Date('2026-08-20T10:00:00.000Z'),
        endedAt: new Date('2026-08-20T12:00:00.000Z'),
        previewImagePath: 'archive/b1/preview.jpg',
        stream: { slug: 'arena', name: 'Арена', org: { slug: 'vegasport', name: 'Вега Спорт' } },
        recordings: [{ id: 'r1', status: 'ready', fileSize: BigInt(1024), duration: 7200 }],
      },
    ]);

    const res = await service.search('вега');

    expect(res.organizations[0]).toEqual({
      orgSlug: 'vegasport', orgName: 'Вега Спорт', hasImage: true, liveCount: 1,
    });
    expect(res.streams[0]).toMatchObject({ orgSlug: 'vegasport', streamSlug: 'arena', isLive: true });
    expect(res.broadcasts[0]).toMatchObject({
      id: 'b1', title: 'Вега — Динамо', hasPreview: true,
      orgSlug: 'vegasport', streamSlug: 'arena',
    });
    // fileSize приходит из БД как BigInt и обязан уехать наружу числом,
    // иначе Nest падает на сериализации ответа.
    expect(res.broadcasts[0].recording).toEqual({ id: 'r1', status: 'ready', fileSize: 1024, duration: 7200 });
  });

  it('безымянный стрим подписывается названием организации', async () => {
    mockPrisma.organization.findMany.mockResolvedValueOnce([]);
    mockPrisma.stream.findMany.mockResolvedValueOnce([
      { slug: 'main', name: '', isLive: false, org: { slug: 'liga', name: 'Лига' } },
    ]);
    mockPrisma.broadcast.findMany.mockResolvedValueOnce([]);

    const res = await service.search('лига');

    expect(res.streams[0].streamName).toBe('Лига');
  });
});
