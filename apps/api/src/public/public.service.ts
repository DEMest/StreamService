import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ThumbnailService } from '../thumbnail/thumbnail.service';
import { promises as fs } from 'fs';
import { join } from 'path';

@Injectable()
export class PublicService {
  constructor(
    private prisma: PrismaService,
    private thumbnail: ThumbnailService,
  ) {}

  async getCatalog() {
    const streams = await this.prisma.stream.findMany({
      where: { slug: '', org: { isActive: true } },
      select: {
        slug: true,
        name: true,
        isLive: true,
        previewMode: true,
        previewImagePath: true,
        org: { select: { slug: true, name: true, createdAt: true } },
      },
      orderBy: { org: { createdAt: 'desc' } },
    });
    return streams.map((s) => ({
      slug: s.org.slug,
      name: s.org.name,
      isLive: s.isLive,
      streamTitle: s.name,
      previewMode: s.previewMode,
      hasCustomPreview: !!s.previewImagePath,
    }));
  }

  async getThumbnail(orgSlug: string): Promise<{ buffer: Buffer; maxAge: number }> {
    const stream = await this.prisma.stream.findFirst({
      where: { slug: '', org: { slug: orgSlug, isActive: true } },
      select: { isLive: true, previewMode: true, previewImagePath: true },
    });
    if (!stream) throw new NotFoundException('Organization not found');

    if (stream.isLive) {
      const buf = await this.thumbnail.getSnapshot(orgSlug, stream.previewMode);
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

  async getOrgWatch(orgSlug: string, key?: string) {
    const stream = await this.prisma.stream.findFirst({
      where: { slug: '', org: { slug: orgSlug, isActive: true } },
      select: {
        name: true,
        description: true,
        isLive: true,
        isPublic: true,
        previewKey: true,
        org: { select: { slug: true, name: true, description: true } },
      },
    });
    if (!stream) throw new NotFoundException('Organization not found');

    if (!stream.isPublic && stream.previewKey !== key) {
      return {
        slug: stream.org.slug,
        name: stream.org.name,
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
      isLive: stream.isLive,
      streamTitle: stream.name,
      streamDescription: stream.description,
      streamIsPublic: stream.isPublic,
    };
  }

  async getStreamUrl(orgSlug: string, key?: string) {
    const stream = await this.prisma.stream.findFirst({
      where: { slug: '', org: { slug: orgSlug, isActive: true } },
      select: { isLive: true, isPublic: true, previewKey: true },
    });
    if (!stream || !stream.isLive) throw new NotFoundException('No live stream');
    if (!stream.isPublic && stream.previewKey !== key) {
      throw new NotFoundException('No live stream');
    }
    return { hlsUrl: `/api/v1/public/orgs/${orgSlug}/live/hls/master.m3u8` };
  }

  async getOrgBroadcasts(orgSlug: string, key?: string) {
    const stream = await this.prisma.stream.findFirst({
      where: { slug: '', org: { slug: orgSlug, isActive: true } },
      select: { id: true, isPublic: true, previewKey: true },
    });
    if (!stream) throw new NotFoundException('Organization not found');
    if (!stream.isPublic && stream.previewKey !== key) return [];

    return this.prisma.broadcast.findMany({
      where: { streamId: stream.id, endedAt: { not: null } },
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        title: true,
        description: true,
        startedAt: true,
        endedAt: true,
        recording: {
          select: { id: true, status: true, fileSize: true, duration: true },
        },
      },
    });
  }
}
