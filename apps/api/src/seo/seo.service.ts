import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Activity, ChangeFrequency, PageRank, rankByActivity, rankStream } from './popularity';

/** Одна строка будущего sitemap.xml. `path` — всегда относительный от корня сайта. */
export interface SitemapUrl {
  path: string;
  lastModified: string;
  changeFrequency: ChangeFrequency;
  priority: number;
}

/**
 * Всё, что нужно фронту, чтобы отрисовать `<head>` и JSON-LD одной публичной
 * страницы. Собирается на бэкенде, потому что решение «индексировать или нет»
 * зависит от истории вещания, а она живёт в БД.
 */
export interface SeoPageMeta {
  found: boolean;
  indexable: boolean;
  org: {
    slug: string;
    name: string;
    description: string | null;
    hasImage: boolean;
  } | null;
  stream: {
    slug: string;
    name: string;
    description: string | null;
    isLive: boolean;
    /** Начало текущего эфира — для BroadcastEvent в JSON-LD. */
    startedAt: string | null;
  } | null;
  /**
   * Путь к картинке, которая ТОЧНО отдаётся (200), или null.
   *
   * Считается на бэкенде, потому что только он знает, есть ли кадр эфира,
   * загруженное превью или картинка организации. Раньше фронт всегда ставил
   * `…/streams/<slug>/thumbnail`, а тот отдаёт 404, когда эфир не идёт и
   * превью не загружали, — Google на это отвечал «не указан URL значка видео»
   * и не индексировал ролик.
   */
  thumbnailPath: string | null;
  stats: {
    liveCount: number;
    finishedBroadcasts: number;
    lastBroadcastAt: string | null;
  };
}

/**
 * Статические публичные страницы. Логин здесь намеренно: по нему ищут вход в
 * личный кабинет («лига лайв вход»), и отдать поисковику собственную страницу
 * входа лучше, чем отдать её случайному агрегатору. Вес низкий — она не должна
 * перебивать лендинг в выдаче.
 */
const STATIC_URLS: Array<Omit<SitemapUrl, 'lastModified'>> = [
  { path: '/', changeFrequency: 'daily', priority: 1.0 },
  { path: '/streams', changeFrequency: 'hourly', priority: 0.9 },
  { path: '/organizations', changeFrequency: 'daily', priority: 0.7 },
  { path: '/archive', changeFrequency: 'daily', priority: 0.7 },
  { path: '/login', changeFrequency: 'monthly', priority: 0.3 },
  // FAQ отвечает ровно на то, что зритель гуглит во время эфира («трансляция
  // тормозит», «где посмотреть запись матча»), — страница поисковая по сути.
  { path: '/faq', changeFrequency: 'monthly', priority: 0.5 },
  // Правовые документы в индексе нужны не ради трафика: по ним проверяют, что
  // у сайта вообще есть политика и реквизиты. Вес минимальный, меняются редко.
  { path: '/legal/privacy', changeFrequency: 'yearly', priority: 0.2 },
  { path: '/legal/terms', changeFrequency: 'yearly', priority: 0.2 },
  { path: '/legal/copyright', changeFrequency: 'yearly', priority: 0.2 },
];

/** Активность по одному Stream'у, собранная из трёх запросов в БД. */
interface StreamActivity extends Activity {
  orgSlug: string;
  streamSlug: string;
  createdAt: Date;
  /** Есть ли у стрима хотя бы одна готовая запись — от этого зависит /archive-страница. */
  hasArchive: boolean;
}

@Injectable()
export class SeoService {
  constructor(private prisma: PrismaService) {}

  /**
   * Список URL для sitemap.xml: статические страницы + страницы организаций и
   * стримов, прошедших фильтр активности (см. `popularity.ts`).
   *
   * Организации без единого эфира не попадают сюда вообще и получают `noindex`
   * в `getPageMeta` — это одно и то же решение, принятое в одном месте.
   */
  async getSitemapUrls(now: Date = new Date()): Promise<SitemapUrl[]> {
    const activities = await this.collectActivity();
    const nowIso = now.toISOString();

    const urls: SitemapUrl[] = STATIC_URLS.map((u) => ({ ...u, lastModified: nowIso }));

    // Активность стримов сворачиваем до организации: организация «живая», если
    // живёт хоть один её стрим, и её lastmod — самый свежий эфир из всех.
    const byOrg = new Map<string, StreamActivity[]>();
    for (const a of activities) {
      const list = byOrg.get(a.orgSlug);
      if (list) list.push(a);
      else byOrg.set(a.orgSlug, [a]);
    }

    for (const [orgSlug, streams] of byOrg) {
      const orgActivity: Activity = {
        isLive: streams.some((s) => s.isLive),
        finishedBroadcasts: streams.reduce((sum, s) => sum + s.finishedBroadcasts, 0),
        lastBroadcastAt: latest(streams.map((s) => s.lastBroadcastAt)),
      };
      const orgRank = rankByActivity(orgActivity, now);
      if (!orgRank.indexable) continue;

      const orgFallback = latest(streams.map((s) => s.createdAt)) ?? now;
      urls.push(toUrl(`/watch/${orgSlug}`, orgRank, orgFallback));

      for (const s of streams) {
        const rank = rankStream(s, now);
        if (!rank.indexable) continue;
        urls.push(toUrl(`/watch/${orgSlug}/${s.streamSlug}`, rank, s.createdAt));
      }

      // Архив организации — только если там реально есть что смотреть.
      if (streams.some((s) => s.hasArchive)) {
        urls.push(
          toUrl(
            `/watch/${orgSlug}/archive`,
            { ...orgRank, priority: 0.4, changeFrequency: 'weekly' },
            orgFallback,
          ),
        );
      }
    }

    return urls;
  }

  /**
   * Метаданные страницы `/watch/<org>` или `/watch/<org>/<stream>`.
   *
   * Приватный Stream (isPublic=false, доступен только по previewKey) отдаётся
   * как `found: false`: этот endpoint публичный, и раскрывать через него имя
   * закрытой трансляции нельзя. Фронт в таком случае ставит нейтральный
   * заголовок и `noindex`.
   */
  async getPageMeta(orgSlug: string, streamSlug?: string): Promise<SeoPageMeta> {
    const org = await this.prisma.organization.findFirst({
      where: { slug: orgSlug, isActive: true },
      select: { id: true, slug: true, name: true, description: true, imagePath: true },
    });
    if (!org) return notFound();

    const streams = await this.prisma.stream.findMany({
      where: { orgId: org.id, isPublic: true },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        isLive: true,
        currentBroadcastId: true,
        previewImagePath: true,
      },
    });

    const orgCard = {
      slug: org.slug,
      name: org.name,
      description: org.description,
      hasImage: !!org.imagePath,
    };

    // Страница конкретного стрима: он должен существовать и быть публичным.
    const target = streamSlug ? streams.find((s) => s.slug === streamSlug) : undefined;
    if (streamSlug && !target) return notFound();

    const scope = target ? [target] : streams;
    const finished = await this.countFinished(scope.map((s) => s.id));

    const activity: Activity = {
      isLive: scope.some((s) => s.isLive),
      finishedBroadcasts: finished.count,
      lastBroadcastAt: finished.lastAt,
    };
    const rank = target ? rankStream(activity, new Date()) : rankByActivity(activity, new Date());

    let startedAt: string | null = null;
    if (target?.isLive && target.currentBroadcastId) {
      const broadcast = await this.prisma.broadcast.findUnique({
        where: { id: target.currentBroadcastId },
        select: { startedAt: true },
      });
      startedAt = broadcast?.startedAt.toISOString() ?? null;
    }

    return {
      found: true,
      indexable: rank.indexable,
      org: orgCard,
      stream: target
        ? {
            slug: target.slug,
            name: target.name || org.name,
            description: target.description,
            isLive: target.isLive,
            startedAt,
          }
        : null,
      thumbnailPath: await this.resolveThumbnail(org.slug, org.imagePath, target),
      stats: {
        liveCount: streams.filter((s) => s.isLive).length,
        finishedBroadcasts: finished.count,
        lastBroadcastAt: finished.lastAt?.toISOString() ?? null,
      },
    };
  }

  /**
   * Ищет картинку, которую точно отдаст сервер, в порядке убывания полезности:
   * кадр идущего эфира → загруженное превью стрима → превью последней записи →
   * картинка организации. Ничего нет — null, и тогда фронт не выдаёт ни
   * `og:image`, ни VideoObject: разметка с недоступным значком хуже, чем её
   * отсутствие, — Google из-за неё отказывается индексировать видео.
   *
   * Порядок именно такой: кадр эфира актуальнее статичного превью, а превью
   * стрима относится к нему целиком, тогда как превью записи — к одному матчу.
   */
  private async resolveThumbnail(
    orgSlug: string,
    orgImagePath: string | null,
    stream?: { id: string; slug: string; isLive: boolean; previewImagePath: string | null },
  ): Promise<string | null> {
    if (stream) {
      const base = `/api/v1/public/orgs/${orgSlug}/streams/${stream.slug}`;
      // Оба случая обслуживает один endpoint: в эфире он отдаёт кадр, вне —
      // загруженное превью.
      if (stream.isLive || stream.previewImagePath) return `${base}/thumbnail`;

      const withPreview = await this.prisma.broadcast.findFirst({
        where: { streamId: stream.id, previewImagePath: { not: null } },
        orderBy: { startedAt: 'desc' },
        select: { id: true },
      });
      if (withPreview) return `${base}/broadcasts/${withPreview.id}/preview`;
    }

    return orgImagePath ? `/api/v1/public/orgs/${orgSlug}/image` : null;
  }

  /**
   * Активность всех публичных стримов: три запроса вместо N+1.
   *  1) сами стримы активных организаций,
   *  2) счётчик и дата последнего завершённого эфира по каждому,
   *  3) у кого из них есть готовая (status='ready') запись в архиве.
   */
  private async collectActivity(): Promise<StreamActivity[]> {
    const streams = await this.prisma.stream.findMany({
      where: { isPublic: true, org: { isActive: true } },
      select: {
        id: true,
        slug: true,
        isLive: true,
        createdAt: true,
        org: { select: { slug: true } },
      },
    });
    if (streams.length === 0) return [];

    const ids = streams.map((s) => s.id);

    const finished = await this.prisma.broadcast.groupBy({
      by: ['streamId'],
      where: { streamId: { in: ids }, endedAt: { not: null } },
      _count: { _all: true },
      _max: { endedAt: true },
    });
    const finishedBy = new Map(finished.map((f) => [f.streamId, f]));

    const archived = await this.prisma.broadcast.groupBy({
      by: ['streamId'],
      where: {
        streamId: { in: ids },
        endedAt: { not: null },
        recordings: { some: { status: 'ready' } },
      },
      _count: { _all: true },
    });
    const archivedIds = new Set(archived.map((a) => a.streamId));

    return streams.map((s) => {
      const f = finishedBy.get(s.id);
      return {
        orgSlug: s.org.slug,
        streamSlug: s.slug,
        createdAt: s.createdAt,
        isLive: s.isLive,
        finishedBroadcasts: f?._count._all ?? 0,
        lastBroadcastAt: f?._max.endedAt ?? null,
        hasArchive: archivedIds.has(s.id),
      };
    });
  }

  private async countFinished(streamIds: string[]): Promise<{ count: number; lastAt: Date | null }> {
    if (streamIds.length === 0) return { count: 0, lastAt: null };
    const agg = await this.prisma.broadcast.aggregate({
      where: { streamId: { in: streamIds }, endedAt: { not: null } },
      _count: { _all: true },
      _max: { endedAt: true },
    });
    return { count: agg._count._all ?? 0, lastAt: agg._max.endedAt ?? null };
  }
}

function toUrl(path: string, rank: PageRank, fallback: Date): SitemapUrl {
  return {
    path,
    lastModified: (rank.lastModified ?? fallback).toISOString(),
    changeFrequency: rank.changeFrequency,
    priority: rank.priority,
  };
}

function latest(dates: Array<Date | null>): Date | null {
  let max: Date | null = null;
  for (const d of dates) {
    if (d && (!max || d > max)) max = d;
  }
  return max;
}

function notFound(): SeoPageMeta {
  return {
    found: false,
    indexable: false,
    org: null,
    stream: null,
    thumbnailPath: null,
    stats: { liveCount: 0, finishedBroadcasts: 0, lastBroadcastAt: null },
  };
}
