import { Prisma } from '@prisma/client';
import { decodeCursor } from '../common/api/cursor';
import { EVENT_ID_PATTERN } from './event-feed.dto';

const RECENT_BOUT_MS = 15 * 60 * 1000;

export interface BoutFeedPosition {
  id: string;
  group: number;
  timeKey: number;
  sequenceKey: number;
  venueNumber: number;
}

interface BoutCursor extends BoutFeedPosition {
  eventId: string;
  asOf: number;
}

function isEventId(value: unknown): value is string {
  return typeof value === 'string' && EVENT_ID_PATTERN.test(value);
}

function isInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

export function readBoutCursor(raw: string, eventId: string): BoutCursor {
  return decodeCursor(raw, (value): value is BoutCursor => {
    if (!value || typeof value !== 'object') return false;
    const cursor = value as Partial<BoutCursor>;
    return cursor.eventId === eventId && isEventId(cursor.id)
      && isInteger(cursor.group, 0, 2)
      && isInteger(cursor.timeKey, -8640000000000000, Number.MAX_SAFE_INTEGER)
      && isInteger(cursor.sequenceKey, -2147483648, 2147483648)
      && isInteger(cursor.venueNumber, -2147483648, 2147483647)
      && isInteger(cursor.asOf, 0, Date.parse('9999-12-31T23:59:59.999Z'));
  });
}

/**
 * Keyset по вычисляемым ключам. Час начала листания фиксирует окно «недавно»
 * и порядок при обычном переходе статуса; данные самой карточки остаются свежими.
 */
export function boutFeedPageSql(
  eventId: string,
  asOf: number,
  limit: number,
  cursor?: BoutFeedPosition,
): Prisma.Sql {
  const before = new Date(asOf).toISOString().slice(0, -1);
  const since = new Date(asOf - RECENT_BOUT_MS).toISOString().slice(0, -1);
  const afterCursor = cursor ? Prisma.sql`
    WHERE ("group", "timeKey", "sequenceKey", "venueNumber", id)
        > (${cursor.group}, ${cursor.timeKey}, ${cursor.sequenceKey}, ${cursor.venueNumber}, ${cursor.id})
  ` : Prisma.empty;

  return Prisma.sql`
    WITH classified AS (
      SELECT b.id, b."scheduledAt", b."endedAt", b.sequence, v.number AS "venueNumber",
        CASE
          WHEN b."endedAt" BETWEEN ${since}::timestamp AND ${before}::timestamp THEN 1
          WHEN b."startedAt" <= ${before}::timestamp AND (b."endedAt" IS NULL OR b."endedAt" > ${before}::timestamp) THEN 0
          ELSE 2
        END AS "group"
      FROM "Bout" b
      JOIN "Venue" v ON v.id = b."venueId" AND v."eventId" = b."eventId"
      WHERE b."eventId" = ${eventId}
    ), ranked AS (
      SELECT id, "group", "venueNumber",
        COALESCE(
          CASE WHEN "group" = 1 THEN -EXTRACT(EPOCH FROM "endedAt")
               ELSE EXTRACT(EPOCH FROM "scheduledAt") END * 1000,
          9007199254740991
        )::double precision AS "timeKey",
        COALESCE(sequence::bigint, 2147483648)::double precision AS "sequenceKey"
      FROM classified
    )
    SELECT id, "group", "timeKey", "sequenceKey", "venueNumber" FROM ranked
    ${afterCursor}
    ORDER BY "group", "timeKey", "sequenceKey", "venueNumber", id
    LIMIT ${limit}
  `;
}
