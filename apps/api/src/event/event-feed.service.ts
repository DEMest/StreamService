import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ApiException } from '../common/api/api-error';
import { decodeCursor, toCursorPage } from '../common/api/cursor';
import { PrismaService } from '../prisma/prisma.service';
import { ImageService } from '../storage/image.service';
import { canView, liveHlsUrl } from '../stream/stream-access';
import { ThumbnailService } from '../thumbnail/thumbnail.service';
import { BoutFeedPosition, boutFeedPageSql, readBoutCursor } from './bout-feed-order';
import { boutStatus } from './bout-status';
import {
  BoutCardDto, BoutFeedPageDto, BoutFeedQueryDto, BoutScoreDto, EVENT_ID_PATTERN, EventAthleteDto,
  EventCardDto, EventDetailDto, EventFeedPageDto, EventFeedQueryDto, EventVenueDto, EventVenueSummaryDto,
} from './event-feed.dto';

const PUBLIC_EVENT: Prisma.EventWhereInput = { publishedAt: { not: null }, org: { isActive: true } };
const FEED_URL = '/api/v1/public/events';

const athleteSelect = {
  id: true, orgId: true, firstName: true, lastName: true, school: true, birthYear: true, photoPath: true,
} satisfies Prisma.AthleteSelect;

const scoreSelect = {
  id: true, startedAt: true, endedAt: true, redScore: true, blueScore: true,
  redAthlete: { select: athleteSelect },
  blueAthlete: { select: athleteSelect },
} satisfies Prisma.BoutSelect;

const venueSummarySelect = { id: true, number: true, name: true } satisfies Prisma.VenueSelect;

const venueSelect = {
  ...venueSummarySelect,
  quad: true,
  stream: {
    select: {
      orgId: true, slug: true, isPublic: true, isLive: true, previewImagePath: true, feedMode: true,
      org: { select: { slug: true } },
    },
  },
} satisfies Prisma.VenueSelect;

const eventCardSelect = {
  id: true, orgId: true, title: true, sport: true, birthYearFrom: true, birthYearTo: true, level: true,
  startsOn: true, endsOn: true, timeZone: true, city: true, address: true, regionCode: true, posterPath: true,
  startedAt: true, endedAt: true,
} satisfies Prisma.EventSelect;

const liveBouts = {
  where: { startedAt: { not: null }, endedAt: null },
  orderBy: [{ startedAt: 'desc' }, { id: 'asc' }],
  select: { ...scoreSelect, venueId: true },
} satisfies Prisma.Event$boutsArgs;

type EventRow = Prisma.EventGetPayload<{ select: typeof eventCardSelect }>;
type VenueRow = Prisma.VenueGetPayload<{ select: typeof venueSelect }>;
type ScoreRow = Prisma.BoutGetPayload<{ select: typeof scoreSelect }>;
type AthleteRow = Prisma.AthleteGetPayload<{ select: typeof athleteSelect }>;
type EventIdentity = Pick<EventRow, 'id' | 'orgId'>;

interface EventCursor {
  id: string;
  startsOn: string;
}

function isEventCursor(value: unknown): value is EventCursor {
  if (!value || typeof value !== 'object') return false;
  const { id, startsOn } = value as Partial<EventCursor>;
  if (typeof id !== 'string' || !EVENT_ID_PATTERN.test(id)
      || typeof startsOn !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(startsOn)) return false;
  const date = new Date(startsOn);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === startsOn;
}

function eventNotFound(): ApiException {
  return new ApiException(HttpStatus.NOT_FOUND, 'EVENT_NOT_FOUND', 'Турнир не найден');
}

function imageNotFound(): ApiException {
  return new ApiException(HttpStatus.NOT_FOUND, 'IMAGE_NOT_FOUND', 'Изображение не найдено');
}

function toEventCard(event: EventRow): EventCardDto {
  const {
    id, title, sport, birthYearFrom, birthYearTo, level, startsOn, endsOn, timeZone, city, address, regionCode,
  } = event;
  return {
    id, title, sport, birthYearFrom, birthYearTo, level, timeZone, city, address, regionCode,
    startsOn: startsOn.toISOString().slice(0, 10),
    endsOn: endsOn.toISOString().slice(0, 10),
    posterUrl: event.posterPath ? `${FEED_URL}/${id}/poster` : null,
    isLive: !!event.startedAt && !event.endedAt,
  };
}

function toAthlete(athlete: AthleteRow | null, event: EventIdentity): EventAthleteDto | null {
  if (!athlete || athlete.orgId !== event.orgId) return null;
  const { id, firstName, lastName, birthYear, school, photoPath } = athlete;
  return {
    id, firstName, lastName, birthYear, school,
    photoUrl: photoPath ? `${FEED_URL}/${event.id}/athletes/${id}/photo` : null,
  };
}

function toScore(bout: ScoreRow, event: EventIdentity): BoutScoreDto {
  const { id, startedAt, endedAt, redScore, blueScore } = bout;
  return {
    id, startedAt, endedAt, redScore, blueScore,
    status: boutStatus(bout),
    redAthlete: toAthlete(bout.redAthlete, event),
    blueAthlete: toAthlete(bout.blueAthlete, event),
  };
}

function liveScores(
  event: EventIdentity,
  bouts: Array<ScoreRow & { venueId: string }>,
): Map<string, BoutScoreDto> {
  const scores = new Map<string, BoutScoreDto>();
  for (const bout of bouts) {
    if (!scores.has(bout.venueId)) scores.set(bout.venueId, toScore(bout, event));
  }
  return scores;
}

function publicStream(venue: VenueRow, orgId: string): VenueRow['stream'] {
  const { stream } = venue;
  // FK на Stream не обеспечивает совпадение организаций.
  return stream?.orgId === orgId && canView({ isPublic: stream.isPublic, previewKey: null }) ? stream : null;
}

function venueMedia(
  venue: VenueRow, event: EventIdentity,
): Pick<EventVenueDto, 'hlsUrl' | 'thumbnailUrl' | 'quad'> {
  const stream = publicStream(venue, event.orgId);
  if (!stream) return { hlsUrl: null, thumbnailUrl: null, quad: null };
  const quad = stream.feedMode === 'composite' && venue.quad !== null && venue.quad >= 1 && venue.quad <= 4
    ? venue.quad : null;
  return {
    hlsUrl: stream.isLive ? liveHlsUrl(stream.org.slug, stream.slug, { isPublic: true, previewKey: null }) : null,
    thumbnailUrl: stream.isLive || stream.previewImagePath
      ? `${FEED_URL}/${event.id}/venues/${venue.id}/thumbnail` : null,
    quad,
  };
}

@Injectable()
export class EventFeedService {
  constructor(private prisma: PrismaService, private images: ImageService, private thumbnails: ThumbnailService) {}

  async listEvents(query: EventFeedQueryDto): Promise<EventFeedPageDto> {
    const position = query.cursor === undefined ? undefined : decodeCursor(query.cursor, isEventCursor);
    const startsOn = position ? new Date(position.startsOn) : undefined;
    const events = await this.prisma.event.findMany({
      where: {
        ...PUBLIC_EVENT,
        OR: position && [
          { startsOn: { lt: startsOn } },
          { startsOn, id: { gt: position.id } },
        ],
      },
      orderBy: [{ startsOn: 'desc' }, { id: 'asc' }],
      take: query.limit + 1,
      select: {
        ...eventCardSelect,
        venues: { orderBy: { number: 'asc' }, select: venueSummarySelect },
        bouts: liveBouts,
      },
    });
    const page = toCursorPage(events, query.limit, (event) => ({
      id: event.id, startsOn: event.startsOn.toISOString().slice(0, 10),
    }));
    return {
      nextCursor: page.nextCursor,
      items: page.items.map((event) => {
        const card = toEventCard(event);
        const scores = liveScores(event, event.bouts);
        return {
          ...card,
          venues: card.isLive ? event.venues.map((venue): EventVenueSummaryDto => ({
            ...venue, liveBout: scores.get(venue.id) ?? null,
          })) : [],
        };
      }),
    };
  }

  async getEvent(eventId: string): Promise<EventDetailDto> {
    const event = await this.prisma.event.findFirst({
      where: { ...PUBLIC_EVENT, id: eventId },
      select: {
        ...eventCardSelect,
        venues: { orderBy: { number: 'asc' }, select: venueSelect },
        bouts: liveBouts,
      },
    });
    if (!event) throw eventNotFound();
    const card = toEventCard(event);
    const scores = liveScores(event, event.bouts);
    return {
      ...card,
      venues: event.venues.map((venue) => ({
        id: venue.id, number: venue.number, name: venue.name,
        liveBout: card.isLive ? scores.get(venue.id) ?? null : null,
        ...venueMedia(venue, event),
      })),
    };
  }

  async listBouts(eventId: string, query: BoutFeedQueryDto): Promise<BoutFeedPageDto> {
    const cursor = query.cursor === undefined ? undefined : readBoutCursor(query.cursor, eventId);
    const asOf = cursor?.asOf ?? Date.now();
    return this.prisma.$transaction(async (db) => {
      const event = await db.event.findFirst({
        where: { ...PUBLIC_EVENT, id: eventId }, select: { id: true, orgId: true },
      });
      if (!event) throw eventNotFound();

      const rows = await db.$queryRaw<BoutFeedPosition[]>(boutFeedPageSql(eventId, asOf, query.limit + 1, cursor));
      const page = toCursorPage(rows, query.limit, (last) => ({ ...last, eventId, asOf }));
      if (!page.items.length) return { items: [], nextCursor: null };

      const bouts = await db.bout.findMany({
        where: { eventId, id: { in: page.items.map(({ id }) => id) } },
        select: {
          ...scoreSelect, scheduledAt: true, sequence: true, weightClass: true,
          venue: { select: venueSelect },
        },
      });
      const cards = new Map(bouts.map((bout): [string, BoutCardDto] => [bout.id, {
        ...toScore(bout, event),
        scheduledAt: bout.scheduledAt,
        sequence: bout.sequence,
        weightClass: bout.weightClass,
        venueId: bout.venue.id,
        venueNumber: bout.venue.number,
        ...venueMedia(bout.venue, event),
      }]));
      // Prisma IN не обещает порядок. На RepeatableRead обе выборки видят те же строки.
      return { items: page.items.flatMap(({ id }) => cards.get(id) ?? []), nextCursor: page.nextCursor };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async getPoster(eventId: string): Promise<Buffer> {
    const event = await this.prisma.event.findFirst({
      where: { ...PUBLIC_EVENT, id: eventId }, select: { posterPath: true },
    });
    return this.getImage(event?.posterPath);
  }

  async getAthletePhoto(eventId: string, athleteId: string): Promise<Buffer> {
    const event = await this.prisma.event.findFirst({
      where: {
        ...PUBLIC_EVENT, id: eventId,
        bouts: { some: { venue: { eventId }, OR: [{ redAthleteId: athleteId }, { blueAthleteId: athleteId }] } },
      },
      select: { orgId: true },
    });
    if (!event) throw imageNotFound();
    const athlete = await this.prisma.athlete.findFirst({
      where: { id: athleteId, orgId: event.orgId }, select: { photoPath: true },
    });
    return this.getImage(athlete?.photoPath);
  }

  async getVenueThumbnail(eventId: string, venueId: string): Promise<Buffer> {
    const venue = await this.prisma.venue.findFirst({
      where: { id: venueId, eventId, event: PUBLIC_EVENT },
      select: { ...venueSelect, event: { select: { orgId: true } } },
    });
    const stream = venue && publicStream(venue, venue.event.orgId);
    if (!stream) throw imageNotFound();
    if (stream.isLive) {
      const path = stream.slug ? `${stream.org.slug}/${stream.slug}` : stream.org.slug;
      const snapshot = await this.thumbnails.getSnapshot(path, 'full', `${path}:full`);
      if (snapshot) return snapshot;
    }
    return this.getImage(stream.previewImagePath);
  }

  private async getImage(path: string | null | undefined): Promise<Buffer> {
    const image = path && await this.images.serve(path);
    if (!image) throw imageNotFound();
    return image;
  }
}
