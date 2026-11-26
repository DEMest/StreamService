import { PrismaClient } from '@prisma/client';
import { encodeCursor, toCursorPage } from '../common/api/cursor';
import { BoutFeedPosition, boutFeedPageSql, readBoutCursor } from './bout-feed-order';

const eventId = 'event1';
const asOf = Date.parse('2026-11-26T12:00:00Z');
const position = { id: 'bout1', group: 1, timeKey: -asOf, sequenceKey: 1, venueNumber: 2, asOf, eventId };

describe('курсор ленты схваток', () => {
  it('сохраняет все ключи порядка и время, зафиксированное на первой странице', () => {
    expect(readBoutCursor(encodeCursor(position), eventId)).toEqual(position);
  });

  it.each([
    { eventId: 'different-event' },
    { group: 3 },
    { timeKey: '2026-11-26' },
    { timeKey: 0.5 },
    { id: 'x/y' },
  ])('отклоняет неподходящую позицию %j', (change) => {
    expect(() => readBoutCursor(encodeCursor({ ...position, ...change }), eventId)).toThrow('Некорректный курсор');
  });
});

// Для запуска достаточно пустой локальной БД. Временные таблицы скрывают
// одноимённые таблицы этой сессии и исчезают в конце транзакции.
const describePostgres = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describePostgres('порядок ленты схваток в PostgreSQL', () => {
  let client: PrismaClient;

  beforeAll(() => {
    client = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
  });

  afterAll(() => client.$disconnect());

  it('выдаёт идущие, недавние и остальные в этом порядке на нескольких страницах', async () => {
    await client.$transaction(async (db) => {
      await db.$executeRaw`CREATE TEMP TABLE "Venue" (
        id text, "eventId" text, number int
      ) ON COMMIT DROP`;
      await db.$executeRaw`CREATE TEMP TABLE "Bout" (
        id text, "eventId" text, "venueId" text, "scheduledAt" timestamp,
        "startedAt" timestamp, "endedAt" timestamp, sequence int
      ) ON COMMIT DROP`;
      await db.$executeRaw`INSERT INTO "Venue" VALUES ('v1','event1',1), ('v2','event1',2), ('foreign','event2',3)`;
      await db.$executeRaw`INSERT INTO "Bout" VALUES
        ('active',    'event1','v2','2026-11-26 11:45','2026-11-26 11:45',NULL,1),
        ('recent1',   'event1','v1',NULL,'2026-11-26 11:40','2026-11-26 11:55',NULL),
        ('recent2',   'event1','v1',NULL,NULL,'2026-11-26 11:45',NULL),
        ('old',       'event1','v2','2026-11-26 11:00','2026-11-26 11:00','2026-11-26 11:44:59',5),
        ('dated',     'event1','v1','2026-11-26 12:10',NULL,NULL,2),
        ('queued1',   'event1','v1',NULL,NULL,NULL,1),
        ('queued2',   'event1','v1',NULL,NULL,NULL,1),
        ('queued3',   'event1','v2',NULL,NULL,NULL,1),
        ('queued4',   'event1','v1',NULL,NULL,NULL,2),
        ('unsorted',  'event1','v1',NULL,NULL,NULL,NULL),
        ('wrongMat',  'event1','foreign',NULL,NULL,NULL,1),
        ('wrongEvent','event2','foreign',NULL,NULL,NULL,1)`;

      const limit = 3;
      const first = await db.$queryRaw<BoutFeedPosition[]>(boutFeedPageSql(eventId, asOf, limit + 1));
      const firstPage = toCursorPage(first, limit, (row) => ({ ...row, eventId, asOf }));
      expect(firstPage.items.map(({ id }) => id)).toEqual(['active', 'recent1', 'recent2']);

      // К моменту следующей порции отданная схватка успела закончиться, а
      // будущая вышла в эфир. Позиции остаются привязаны к началу листания.
      await db.$executeRaw`UPDATE "Bout" SET "endedAt" = '2026-11-26 12:01' WHERE id = 'active'`;
      await db.$executeRaw`UPDATE "Bout" SET "startedAt" = '2026-11-26 12:01' WHERE id = 'queued3'`;

      let next = firstPage.nextCursor;
      const remaining = [];
      while (next) {
        const cursor = readBoutCursor(next, eventId);
        const rows = await db.$queryRaw<BoutFeedPosition[]>(boutFeedPageSql(eventId, cursor.asOf, limit + 1, cursor));
        const page = toCursorPage(rows, limit, (row) => ({ ...row, eventId, asOf }));
        remaining.push(...page.items.map(({ id }) => id));
        next = page.nextCursor;
      }
      expect(remaining).toEqual(['old', 'dated', 'queued1', 'queued2', 'queued3', 'queued4', 'unsorted']);
    });
  });
});
