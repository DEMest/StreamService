import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ThumbnailService } from '../thumbnail/thumbnail.service';
import { promises as fs } from 'fs';
import { join } from 'path';

/**
 * DTO `/v1/public/orgs/:orgSlug/stream` для viewer'а.
 *
 * Composite-стрим играется целиком одним HLS master.m3u8;
 * viewer кропает квадранты на канвасе сам.
 */
export interface PublicStreamDto {
  hlsUrl: string;
}

/**
 * Нормализация streamSlug: undefined/null/'' → '' (= default Stream орги).
 * Используется на каждой точке входа в Service-методы, которые принимают
 * опциональный streamSlug. Гарантирует backward-compat: все «классические»
 * вызовы без streamSlug продолжают резолвиться на default Stream.
 */
function normalizeStreamSlug(streamSlug?: string | null): string {
  return streamSlug ?? '';
}

/**
 * Префикс URL для public-endpoint'ов, зависящий от streamSlug:
 *   default ('') → '/api/v1/public/orgs/<orgSlug>'
 *   named (foo)  → '/api/v1/public/orgs/<orgSlug>/streams/<streamSlug>'
 *
 * Этот префикс используется как для HLS-URL'ов, так и в RecordingController:
 * URL'ы, которые формирует Service, ОБЯЗАНЫ совпадать с теми маршрутами,
 * которые регистрирует Recording/Public controller под named Stream.
 */
function publicUrlPrefix(orgSlug: string, streamSlug: string): string {
  return streamSlug === ''
    ? `/api/v1/public/orgs/${orgSlug}`
    : `/api/v1/public/orgs/${orgSlug}/streams/${streamSlug}`;
}

@Injectable()
export class PublicService {
  constructor(
    private prisma: PrismaService,
    private thumbnail: ThumbnailService,
  ) {}

  /**
   * Каталог публичных Stream'ов (`GET /v1/public/orgs`).
   * Сначала live (по createdAt DESC), затем offline (по createdAt DESC).
   * Приватные Stream'ы (isPublic=false) не показываются — доступны только по previewKey.
   */
  async getCatalog() {
    const streams = await this.prisma.stream.findMany({
      where: { org: { isActive: true }, isPublic: true },
      select: {
        slug: true,
        name: true,
        isLive: true,
        previewMode: true,
        previewImagePath: true,
        createdAt: true,
        org: { select: { slug: true, name: true } },
      },
    });

    const cards = streams.map((s) => ({
      orgSlug: s.org.slug,
      orgName: s.org.name,
      streamSlug: s.slug,
      streamName: s.name,
      isLive: s.isLive,
      previewMode: s.previewMode,
      hasCustomPreview: !!s.previewImagePath,
      createdAt: s.createdAt,
    }));

    cards.sort((a, b) => {
      if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    return cards.map(({ createdAt, ...rest }) => rest);
  }

  /**
   * Thumbnail для Stream'а. Для default Stream'а — backward-compat
   * (streamSlug опционален, поведение идентично).
   *
   * Для named Stream'а HLS path — `/hls/live/<orgSlug>/<streamSlug>/hd/...`.
   * ThumbnailService построит правильный путь по композитному ключу `<orgSlug>[/<streamSlug>]`.
   */
  async getThumbnail(
    orgSlug: string,
    streamSlug?: string,
  ): Promise<{ buffer: Buffer; maxAge: number }> {
    const sSlug = normalizeStreamSlug(streamSlug);
    const stream = await this.prisma.stream.findFirst({
      where: { slug: sSlug, org: { slug: orgSlug, isActive: true } },
      select: { isLive: true, previewMode: true, previewImagePath: true },
    });
    if (!stream) throw new NotFoundException('Stream not found');

    if (stream.isLive) {
      // Для default Stream'а — ключ '<orgSlug>' (backward-compat с ThumbnailService).
      // Для named — '<orgSlug>/<streamSlug>' (формирует /hls/live/<orgSlug>/<streamSlug>/hd/...).
      const snapshotKey = sSlug === '' ? orgSlug : `${orgSlug}/${sSlug}`;
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
   * Метаданные Stream'а для watch-страницы. streamSlug опционален:
   *   undefined / '' → default Stream орги (backward-compat);
   *   иначе          → named Stream.
   *
   * 404 — если orgi нет / неактивна / Stream'а с таким streamSlug нет.
   * Приватный Stream без правильного key → возвращается «заглушка» с
   * accessDenied=true (НЕ 404, чтобы фронт мог показать UX «введите ключ»).
   */
  async getOrgWatch(orgSlug: string, streamSlug?: string, key?: string) {
    const sSlug = normalizeStreamSlug(streamSlug);
    const stream = await this.prisma.stream.findFirst({
      where: { slug: sSlug, org: { slug: orgSlug, isActive: true } },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        isLive: true,
        isPublic: true,
        previewKey: true,
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
    };
  }

  /**
   * GET /v1/public/orgs/:orgSlug/stream (default) или
   *     /v1/public/orgs/:orgSlug/streams/:streamSlug/stream (named) — конфиг
   * живого стрима для viewer'а.
   *
   * Возвращает {@link PublicStreamDto} — один `hlsUrl` (master.m3u8).
   * Viewer кропает квадранты на канвасе самостоятельно.
   *
   * URL формируется с правильным префиксом:
   *   default → /api/v1/public/orgs/<orgSlug>/live/hls/master.m3u8
   *   named   → /api/v1/public/orgs/<orgSlug>/streams/<streamSlug>/live/hls/master.m3u8
   *
   * 404 — если Stream'а нет, не активна orga, не live, или приватный +
   * `key` не совпадает с `previewKey` Stream'а.
   */
  async getStreamUrl(
    orgSlug: string,
    streamSlug?: string,
    key?: string,
  ): Promise<PublicStreamDto> {
    const sSlug = normalizeStreamSlug(streamSlug);
    const stream = await this.prisma.stream.findFirst({
      where: { slug: sSlug, org: { slug: orgSlug, isActive: true } },
      select: {
        id: true,
        isLive: true,
        isPublic: true,
        previewKey: true,
      },
    });
    if (!stream || !stream.isLive) throw new NotFoundException('No live stream');
    if (!stream.isPublic && stream.previewKey !== key) {
      throw new NotFoundException('No live stream');
    }

    const prefix = publicUrlPrefix(orgSlug, sSlug);

    return { hlsUrl: `${prefix}/live/hls/master.m3u8` };
  }

  /**
   * Список broadcast'ов конкретного Stream'а. streamSlug опционален:
   *   undefined / '' → default Stream орги (backward-compat);
   *   иначе          → named Stream.
   *
   * Приватный Stream без правильного key → пустой массив (тот же контракт,
   * что и в default-варианте до рефакторинга).
   */
  async getOrgBroadcasts(orgSlug: string, streamSlug?: string, key?: string) {
    const sSlug = normalizeStreamSlug(streamSlug);
    const stream = await this.prisma.stream.findFirst({
      where: { slug: sSlug, org: { slug: orgSlug, isActive: true } },
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
    // Preserve legacy DTO shape: recording (singular) instead of recordings (array)
    return broadcasts.map(({ recordings, ...rest }) => ({
      ...rest,
      recording: recordings[0] ?? null,
    }));
  }
}
