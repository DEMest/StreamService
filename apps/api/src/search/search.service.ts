import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { toRecordingSummary } from '../recording/recording-summary';

/**
 * Поиск по публичной части сайта: организации, их стримы и записи эфиров.
 *
 * Ищет только то, что и так видно анониму: активные организации, публичные
 * стримы, завершённые эфиры публичных стримов. Приватная трансляция не должна
 * находиться по названию — она доступна лишь по ссылке с previewKey.
 */

/** Короче двух символов запрос не имеет смысла: выдаст пол-базы. */
const MIN_QUERY_LENGTH = 2;
/** Защита от запроса-простыни, который превратится в тяжёлый LIKE. */
const MAX_QUERY_LENGTH = 100;
/** Сколько результатов отдаём в каждой из трёх категорий. */
const LIMIT_PER_GROUP = 10;

export interface SearchOrgHit {
  orgSlug: string;
  orgName: string;
  hasImage: boolean;
  liveCount: number;
}

export interface SearchStreamHit {
  orgSlug: string;
  orgName: string;
  streamSlug: string;
  streamName: string;
  isLive: boolean;
}

export interface SearchBroadcastHit {
  id: string;
  title: string;
  startedAt: Date;
  endedAt: Date | null;
  hasPreview: boolean;
  recording: ReturnType<typeof toRecordingSummary>;
  orgSlug: string;
  orgName: string;
  streamSlug: string;
  streamName: string;
}

export interface SearchResults {
  query: string;
  organizations: SearchOrgHit[];
  streams: SearchStreamHit[];
  broadcasts: SearchBroadcastHit[];
}

@Injectable()
export class SearchService {
  constructor(private prisma: PrismaService) {}

  async search(rawQuery: string): Promise<SearchResults> {
    const query = rawQuery.trim().slice(0, MAX_QUERY_LENGTH);
    if (query.length < MIN_QUERY_LENGTH) {
      return { query, organizations: [], streams: [], broadcasts: [] };
    }

    // `mode: 'insensitive'` — на Postgres это ILIKE: «ВЕГА» найдёт «Вега».
    const contains = { contains: query, mode: 'insensitive' as const };

    const [orgs, streams, broadcasts] = await Promise.all([
      this.prisma.organization.findMany({
        where: { isActive: true, name: contains },
        orderBy: { name: 'asc' },
        take: LIMIT_PER_GROUP,
        select: {
          slug: true,
          name: true,
          imagePath: true,
          streams: { where: { isPublic: true }, select: { isLive: true } },
        },
      }),
      this.prisma.stream.findMany({
        where: { isPublic: true, org: { isActive: true }, name: contains },
        orderBy: [{ isLive: 'desc' }, { name: 'asc' }],
        take: LIMIT_PER_GROUP,
        select: {
          slug: true,
          name: true,
          isLive: true,
          org: { select: { slug: true, name: true } },
        },
      }),
      this.prisma.broadcast.findMany({
        where: {
          endedAt: { not: null },
          title: contains,
          stream: { isPublic: true, org: { isActive: true } },
        },
        orderBy: { startedAt: 'desc' },
        take: LIMIT_PER_GROUP,
        select: {
          id: true,
          title: true,
          startedAt: true,
          endedAt: true,
          previewImagePath: true,
          stream: {
            select: { slug: true, name: true, org: { select: { slug: true, name: true } } },
          },
          recordings: {
            where: { slotIndex: 1 },
            select: { id: true, status: true, fileSize: true, duration: true },
            take: 1,
          },
        },
      }),
    ]);

    return {
      query,
      organizations: orgs.map((o) => ({
        orgSlug: o.slug,
        orgName: o.name,
        hasImage: !!o.imagePath,
        liveCount: o.streams.filter((s) => s.isLive).length,
      })),
      streams: streams.map((s) => ({
        orgSlug: s.org.slug,
        orgName: s.org.name,
        streamSlug: s.slug,
        streamName: s.name || s.org.name,
        isLive: s.isLive,
      })),
      broadcasts: broadcasts.map(({ recordings, previewImagePath, stream, ...rest }) => ({
        ...rest,
        hasPreview: !!previewImagePath,
        recording: toRecordingSummary(recordings[0]),
        orgSlug: stream.org.slug,
        orgName: stream.org.name,
        streamSlug: stream.slug,
        streamName: stream.name || stream.org.name,
      })),
    };
  }
}
