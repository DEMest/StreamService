import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ThumbnailService } from '../thumbnail/thumbnail.service';
import { ImageService } from '../storage/image.service';
import { toRecordingSummary } from '../recording/recording-summary';

/**
 * DTO `/v1/public/orgs/:orgSlug/streams/:streamSlug/stream` для viewer'а.
 */
export interface PublicStreamDto {
  hlsUrl: string;
  feedMode: 'single' | 'composite';
}

/**
 * Карточка каталога — одна на орг (`GET /v1/public/orgs`). Превью карточки —
 * ТОЛЬКО картинка орги (`/orgs/:orgSlug/image`); стримовые thumbnail'ы на
 * карточках больше не используются (решение пользователя).
 */
export interface CatalogOrgCard {
  orgSlug: string;
  orgName: string;
  liveCount: number;
  hasImage: boolean;
}

/**
 * Обзор орги (`GET /v1/public/orgs/:orgSlug`) — список её публичных Stream'ов.
 */
export interface OrgOverviewDto {
  orgSlug: string;
  orgName: string;
  orgDescription: string | null;
  hasImage: boolean;
  streams: Array<{
    streamSlug: string;
    streamName: string;
    isLive: boolean;
    previewMode: string;
    hasCustomPreview: boolean;
  }>;
}

/**
 * Элемент плоского глобального архива (`GET /v1/public/broadcasts`) —
 * запись помечена orgSlug/orgName/streamSlug/streamName, чтобы карточка на
 * `/archive` показывала, чья это запись, без перехода на обзор орги.
 */
export interface PublicArchiveItem {
  id: string;
  title: string;
  description: string | null;
  startedAt: Date;
  endedAt: Date | null;
  hasPreview: boolean;
  recording: ReturnType<typeof toRecordingSummary>;
  orgSlug: string;
  orgName: string;
  streamSlug: string;
  streamName: string;
}

function publicUrlPrefix(orgSlug: string, streamSlug: string): string {
  return `/api/v1/public/orgs/${orgSlug}/streams/${streamSlug}`;
}

@Injectable()
export class PublicService {
  constructor(
    private prisma: PrismaService,
    private thumbnail: ThumbnailService,
    private images: ImageService,
  ) {}

  /**
   * Каталог — одна карточка на орг. `liveCount` — число текущих live
   * публичных Stream'ов. `hasImage` — есть ли у орги картинка
   * (`/orgs/:orgSlug/image`) для превью карточки.
   */
  async getCatalog(): Promise<CatalogOrgCard[]> {
    const orgs = await this.prisma.organization.findMany({
      where: { isActive: true },
      select: {
        slug: true,
        name: true,
        createdAt: true,
        imagePath: true,
        streams: {
          where: { isPublic: true },
          select: { isLive: true },
        },
      },
    });

    const cards = orgs.map((org) => ({
      orgSlug: org.slug,
      orgName: org.name,
      liveCount: org.streams.filter((s) => s.isLive).length,
      hasImage: !!org.imagePath,
      _createdAt: org.createdAt,
    }));

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
        imagePath: true,
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
      hasImage: !!org.imagePath,
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
   * Картинка орги для карточек каталога/архива.
   * 404 — орги нет / неактивна / картинка не загружена / объект недоступен.
   */
  async getOrgImage(orgSlug: string): Promise<Buffer> {
    const org = await this.prisma.organization.findFirst({
      where: { slug: orgSlug, isActive: true },
      select: { imagePath: true },
    });
    if (!org?.imagePath) throw new NotFoundException('Organization image not found');
    const buf = await this.images.serve(org.imagePath);
    if (!buf) throw new NotFoundException('Organization image not found');
    return buf;
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
      const buf = await this.images.serve(stream.previewImagePath);
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
        org: { select: { slug: true, name: true, description: true, imagePath: true } },
      },
    });
    if (!stream) throw new NotFoundException('Stream not found');

    if (!stream.isPublic && stream.previewKey !== key) {
      return {
        slug: stream.org.slug,
        name: stream.org.name,
        hasImage: !!stream.org.imagePath,
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
      hasImage: !!stream.org.imagePath,
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
        previewImagePath: true,
      },
    });
    return broadcasts.map(({ recordings, previewImagePath, ...rest }) => ({
      ...rest,
      hasPreview: !!previewImagePath,
      recording: toRecordingSummary(recordings[0]),
    }));
  }

  /**
   * GET /v1/public/broadcasts — плоский список всех записей по всем публичным
   * Stream'ам активных орг, отсортированный по startedAt DESC. Питает
   * `/archive` (глубина 1: все видео сразу, без выбора орги/Stream'а).
   * Приватные Stream'ы сюда не попадают — глобально нет previewKey-контекста.
   */
  async getGlobalArchive(): Promise<PublicArchiveItem[]> {
    const broadcasts = await this.prisma.broadcast.findMany({
      where: {
        endedAt: { not: null },
        stream: { isPublic: true, org: { isActive: true } },
      },
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        title: true,
        description: true,
        startedAt: true,
        endedAt: true,
        previewImagePath: true,
        stream: {
          select: {
            slug: true,
            name: true,
            org: { select: { slug: true, name: true } },
          },
        },
        recordings: {
          where: { slotIndex: 1 },
          select: { id: true, status: true, fileSize: true, duration: true },
          take: 1,
        },
      },
    });

    return broadcasts.map(({ recordings, previewImagePath, stream, ...rest }) => ({
      ...rest,
      hasPreview: !!previewImagePath,
      recording: toRecordingSummary(recordings[0]),
      orgSlug: stream.org.slug,
      orgName: stream.org.name,
      streamSlug: stream.slug,
      streamName: stream.name,
    }));
  }

  /**
   * Превью записи (S3-прокси). Гейт как у списка broadcasts: приватный Stream
   * без правильного key → 404 (существование не палим).
   */
  async getBroadcastPreview(orgSlug: string, streamSlug: string, broadcastId: string, key?: string): Promise<Buffer> {
    const stream = await this.prisma.stream.findFirst({
      where: { slug: streamSlug, org: { slug: orgSlug, isActive: true } },
      select: { id: true, isPublic: true, previewKey: true },
    });
    if (!stream) throw new NotFoundException('Stream not found');
    if (!stream.isPublic && stream.previewKey !== key) throw new NotFoundException('Stream not found');

    const broadcast = await this.prisma.broadcast.findFirst({
      where: { id: broadcastId, streamId: stream.id },
      select: { previewImagePath: true },
    });
    if (!broadcast?.previewImagePath) throw new NotFoundException('Broadcast preview not found');
    const buf = await this.images.serve(broadcast.previewImagePath);
    if (!buf) throw new NotFoundException('Broadcast preview not found');
    return buf;
  }
}
