import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ThumbnailService } from '../thumbnail/thumbnail.service';
import { promises as fs } from 'fs';
import { join } from 'path';

/**
 * DTO `/v1/public/orgs/:orgSlug/streams/:streamSlug/stream` для viewer'а.
 */
export interface PublicStreamDto {
  hlsUrl: string;
  feedMode: 'single' | 'composite';
}

/**
 * Карточка каталога — одна на орг (`GET /v1/public/orgs`).
 */
export interface CatalogOrgCard {
  orgSlug: string;
  orgName: string;
  liveCount: number;
  previewMode: string;
  hasCustomPreview: boolean;
  /**
   * slug репрезентативного Stream'а (см. `getCatalog`) — нужен фронту, чтобы
   * построить per-stream thumbnail URL (`/orgs/:orgSlug/streams/:streamSlug/thumbnail`);
   * org-level thumbnail route не существует. `null` — у орги нет ни одного
   * публичного Stream'а (карточка без превью).
   */
  representativeStreamSlug: string | null;
}

/**
 * Обзор орги (`GET /v1/public/orgs/:orgSlug`) — список её публичных Stream'ов.
 */
export interface OrgOverviewDto {
  orgSlug: string;
  orgName: string;
  orgDescription: string | null;
  streams: Array<{
    streamSlug: string;
    streamName: string;
    isLive: boolean;
    previewMode: string;
    hasCustomPreview: boolean;
  }>;
}

function publicUrlPrefix(orgSlug: string, streamSlug: string): string {
  return `/api/v1/public/orgs/${orgSlug}/streams/${streamSlug}`;
}

@Injectable()
export class PublicService {
  constructor(
    private prisma: PrismaService,
    private thumbnail: ThumbnailService,
  ) {}

  /**
   * Каталог — одна карточка на орг. `liveCount` — число текущих live
   * публичных Stream'ов. `previewMode`/`hasCustomPreview` берутся с первого
   * live Stream'а (или первого по порядку, если live нет — карточка офлайн-орги
   * на `/organizations`).
   */
  async getCatalog(): Promise<CatalogOrgCard[]> {
    const orgs = await this.prisma.organization.findMany({
      where: { isActive: true },
      select: {
        slug: true,
        name: true,
        createdAt: true,
        streams: {
          where: { isPublic: true },
          select: {
            slug: true,
            isLive: true,
            previewMode: true,
            previewImagePath: true,
            createdAt: true,
          },
        },
      },
    });

    const cards = orgs.map((org) => {
      const streamsByCreatedAtAsc = [...org.streams].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      const liveStreams = streamsByCreatedAtAsc.filter((s) => s.isLive);
      const liveCount = liveStreams.length;
      const representative = liveStreams[0] ?? streamsByCreatedAtAsc[0];
      return {
        orgSlug: org.slug,
        orgName: org.name,
        liveCount,
        previewMode: representative?.previewMode ?? 'multicam',
        hasCustomPreview: !!representative?.previewImagePath,
        representativeStreamSlug: representative?.slug ?? null,
        _createdAt: org.createdAt,
      };
    });

    // Сначала орги с liveCount > 0 (сами между собой — по createdAt DESC,
    // НЕ по величине liveCount), потом офлайн-орги (тоже по createdAt DESC).
    cards.sort((a, b) => {
      const aLive = a.liveCount > 0;
      const bLive = b.liveCount > 0;
      if (aLive !== bLive) return aLive ? -1 : 1;
      return b._createdAt.getTime() - a._createdAt.getTime();
    });

    return cards.map(({ _createdAt, ...rest }) => rest);
  }

  /**
   * GET /v1/public/orgs/:orgSlug — обзор орги: список публичных Stream'ов.
   * Пустой список `streams: []` — валидный ответ (не 404), фронт показывает
   * пустое состояние. 404 — только если орги нет / неактивна.
   */
  async getOrgOverview(orgSlug: string): Promise<OrgOverviewDto> {
    const org = await this.prisma.organization.findFirst({
      where: { slug: orgSlug, isActive: true },
      select: {
        slug: true,
        name: true,
        description: true,
        streams: {
          where: { isPublic: true },
          orderBy: [{ isLive: 'desc' }, { createdAt: 'asc' }],
          select: {
            slug: true,
            name: true,
            isLive: true,
            previewMode: true,
            previewImagePath: true,
          },
        },
      },
    });
    if (!org) throw new NotFoundException('Organization not found');

    return {
      orgSlug: org.slug,
      orgName: org.name,
      orgDescription: org.description,
      streams: org.streams.map((s) => ({
        streamSlug: s.slug,
        streamName: s.name,
        isLive: s.isLive,
        previewMode: s.previewMode,
        hasCustomPreview: !!s.previewImagePath,
      })),
    };
  }

  /**
   * Thumbnail для Stream'а. streamSlug ОБЯЗАТЕЛЕН — каждый Stream самостоятелен.
   */
  async getThumbnail(orgSlug: string, streamSlug: string): Promise<{ buffer: Buffer; maxAge: number }> {
    const stream = await this.prisma.stream.findFirst({
      where: { slug: streamSlug, org: { slug: orgSlug, isActive: true } },
      select: { isLive: true, previewMode: true, previewImagePath: true },
    });
    if (!stream) throw new NotFoundException('Stream not found');

    if (stream.isLive) {
      const snapshotKey = `${orgSlug}/${streamSlug}`;
      const buf = await this.thumbnail.getSnapshot(snapshotKey, stream.previewMode);
      if (!buf) throw new NotFoundException('Snapshot not available');
      return { buffer: buf, maxAge: 30 };
    }

    if (stream.previewImagePath) {
      const filePath = join(process.cwd(), 'uploads', stream.previewImagePath);
      const buf = await fs.readFile(filePath).catch(() => null);
      if (!buf) throw new NotFoundException('Preview image not found');
      return { buffer: buf, maxAge: 300 };
    }

    throw new NotFoundException('No preview available');
  }

  /**
   * Метаданные Stream'а для watch-страницы. streamSlug обязателен.
   * 404 — если орги нет / неактивна / Stream'а с таким streamSlug нет.
   * Приватный Stream без правильного key → «заглушка» с accessDenied=true.
   */
  async getOrgWatch(orgSlug: string, streamSlug: string, key?: string) {
    const stream = await this.prisma.stream.findFirst({
      where: { slug: streamSlug, org: { slug: orgSlug, isActive: true } },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        isLive: true,
        isPublic: true,
        previewKey: true,
        feedMode: true,
        org: { select: { slug: true, name: true, description: true } },
      },
    });
    if (!stream) throw new NotFoundException('Stream not found');

    if (!stream.isPublic && stream.previewKey !== key) {
      return {
        slug: stream.org.slug,
        name: stream.org.name,
        streamSlug: stream.slug,
        isLive: false,
        streamTitle: '',
        streamDescription: null,
        streamIsPublic: false,
        feedMode: stream.feedMode,
        accessDenied: true,
      };
    }

    return {
      slug: stream.org.slug,
      name: stream.org.name,
      description: stream.org.description,
      streamSlug: stream.slug,
      isLive: stream.isLive,
      streamTitle: stream.name,
      streamDescription: stream.description,
      streamIsPublic: stream.isPublic,
      feedMode: stream.feedMode,
    };
  }

  /**
   * GET /v1/public/orgs/:orgSlug/streams/:streamSlug/stream — конфиг живого
   * стрима. Возвращает {@link PublicStreamDto}. 404 — если Stream'а нет, не
   * активна орга, не live, или приватный + key не совпадает.
   */
  async getStreamUrl(orgSlug: string, streamSlug: string, key?: string): Promise<PublicStreamDto> {
    const stream = await this.prisma.stream.findFirst({
      where: { slug: streamSlug, org: { slug: orgSlug, isActive: true } },
      select: {
        isLive: true,
        isPublic: true,
        previewKey: true,
        feedMode: true,
      },
    });
    if (!stream || !stream.isLive) throw new NotFoundException('No live stream');
    if (!stream.isPublic && stream.previewKey !== key) {
      throw new NotFoundException('No live stream');
    }

    const prefix = publicUrlPrefix(orgSlug, streamSlug);
    return { hlsUrl: `${prefix}/live/hls/master.m3u8`, feedMode: stream.feedMode as 'single' | 'composite' };
  }

  /**
   * Список broadcast'ов конкретного Stream'а. streamSlug обязателен.
   */
  async getOrgBroadcasts(orgSlug: string, streamSlug: string, key?: string) {
    const stream = await this.prisma.stream.findFirst({
      where: { slug: streamSlug, org: { slug: orgSlug, isActive: true } },
      select: { id: true, isPublic: true, previewKey: true },
    });
    if (!stream) throw new NotFoundException('Stream not found');
    if (!stream.isPublic && stream.previewKey !== key) return [];

    const broadcasts = await this.prisma.broadcast.findMany({
      where: { streamId: stream.id, endedAt: { not: null } },
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        title: true,
        description: true,
        startedAt: true,
        endedAt: true,
        recordings: {
          where: { slotIndex: 1 },
          select: { id: true, status: true, fileSize: true, duration: true },
          take: 1,
        },
      },
    });
    return broadcasts.map(({ recordings, ...rest }) => ({
      ...rest,
      recording: recordings[0] ?? null,
    }));
  }
}
