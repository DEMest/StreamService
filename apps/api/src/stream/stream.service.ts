import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MediamtxService } from '../mediamtx/mediamtx.service';
import { RecordingService } from '../recording/recording.service';
import { randomBytes } from 'crypto';

/**
 * Путь MediaMTX для Stream'а.
 * Default Stream (slug='') → 'live/<orgSlug>' — сохраняет совместимость с существующими vMix-конфигами.
 * Non-default → 'live/<orgSlug>/<streamSlug>'.
 */
function mediamtxPathForStream(orgSlug: string, streamSlug: string): string {
  return streamSlug === '' ? orgSlug : `${orgSlug}/${streamSlug}`;
}

@Injectable()
export class StreamService {
  private readonly logger = new Logger(StreamService.name);

  constructor(
    private prisma: PrismaService,
    private mediamtx: MediamtxService,
    private recording: RecordingService,
  ) {}

  async getDefaultStream(orgId: string) {
    const stream = await this.prisma.stream.findUnique({
      where: { orgId_slug: { orgId, slug: '' } },
    });
    if (!stream) throw new NotFoundException('Default Stream not found for org');
    return stream;
  }

  async getStreamWithOrg(streamId: string) {
    const stream = await this.prisma.stream.findUnique({
      where: { id: streamId },
      include: { org: { select: { slug: true } } },
    });
    if (!stream) throw new NotFoundException('Stream not found');
    return stream;
  }

  async rotateKey(streamId: string) {
    const stream = await this.getStreamWithOrg(streamId);
    const ingestKey = randomBytes(18).toString('base64url');
    const updated = await this.prisma.stream.update({
      where: { id: streamId },
      data: { ingestKey, ingestKeyCreatedAt: new Date() },
      select: { id: true, slug: true, ingestKey: true, ingestKeyCreatedAt: true },
    });
    await this.mediamtx.patchPath(mediamtxPathForStream(stream.org.slug, stream.slug), ingestKey);
    return updated;
  }

  async updateSettings(
    streamId: string,
    data: {
      name?: string;
      description?: string;
      isPublic?: boolean;
      autoStartMode?: 'public' | 'test';
      previewMode?: string;
    },
  ) {
    const updateData: Record<string, any> = { ...data };

    if (data.isPublic === false) {
      const cur = await this.prisma.stream.findUnique({
        where: { id: streamId },
        select: { previewKey: true },
      });
      if (!cur?.previewKey) {
        updateData.previewKey = randomBytes(32).toString('hex');
      }
    } else if (data.isPublic === true) {
      updateData.previewKey = null;
    }

    return this.prisma.stream.update({
      where: { id: streamId },
      data: updateData,
      select: {
        id: true, name: true, description: true, isPublic: true, previewKey: true,
        autoStartMode: true, isLive: true, previewMode: true,
      },
    });
  }

  async startBroadcast(streamId: string) {
    const stream = await this.prisma.stream.findUnique({
      where: { id: streamId },
      select: { id: true, name: true, description: true, isLive: true },
    });
    if (!stream) throw new NotFoundException('Stream not found');
    if (stream.isLive) return { alreadyLive: true };

    const broadcast = await this.prisma.broadcast.create({
      data: {
        streamId,
        title: stream.name || 'Трансляция',
        description: stream.description ?? undefined,
        startedAt: new Date(),
      },
    });

    await this.prisma.stream.update({
      where: { id: streamId },
      data: { isLive: true, currentBroadcastId: broadcast.id },
    });

    return { ok: true, broadcastId: broadcast.id };
  }

  async endBroadcast(streamId: string) {
    const stream = await this.prisma.stream.findUnique({
      where: { id: streamId },
      select: {
        id: true, slug: true, isLive: true, currentBroadcastId: true,
        org: { select: { slug: true } },
      },
    });
    if (!stream || !stream.isLive || !stream.currentBroadcastId) return { alreadyOff: true };

    const broadcastId = stream.currentBroadcastId;
    await this.prisma.broadcast.update({ where: { id: broadcastId }, data: { endedAt: new Date() } });
    await this.prisma.stream.update({
      where: { id: streamId },
      data: { isLive: false, currentBroadcastId: null },
    });

    Promise.resolve(
      this.recording.onStreamEnded(broadcastId, mediamtxPathForStream(stream.org.slug, stream.slug)),
    ).catch((err) => this.logger.error(`recording onStreamEnded failed for broadcast ${broadcastId}: ${err?.message ?? err}`));

    return { ok: true };
  }

  async verifyIngestKey(orgSlug: string, streamSlug: string, key: string): Promise<boolean> {
    const stream = await this.prisma.stream.findFirst({
      where: { slug: streamSlug, org: { slug: orgSlug } },
      select: { ingestKey: true, org: { select: { isActive: true } } },
    });
    return !!stream && stream.org.isActive && stream.ingestKey === key;
  }

  /**
   * Парсит MediaMTX-path вида 'live/<orgSlug>' или 'live/<orgSlug>/<streamSlug>'
   * и возвращает соответствующий Stream. В Step 3 расширится под slot'ы.
   */
  async resolvePathToStream(path: string) {
    const m = path.match(/^live\/([^/]+)(?:\/(.+))?$/);
    if (!m) return null;
    const orgSlug = m[1];
    const streamSlug = m[2] ?? '';

    return this.prisma.stream.findFirst({
      where: { slug: streamSlug, org: { slug: orgSlug } },
    });
  }

  async handleWebhook(path: string, action: 'publish' | 'unpublish') {
    const stream = await this.resolvePathToStream(path);
    if (!stream) return;
    if (action === 'publish') await this.startBroadcast(stream.id);
    else if (action === 'unpublish') await this.endBroadcast(stream.id);
  }
}
