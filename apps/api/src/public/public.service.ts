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
    const orgs = await this.prisma.organization.findMany({
      where: { isActive: true },
      select: {
        slug: true,
        name: true,
        isLive: true,
        streamTitle: true,
        previewMode: true,
        previewImagePath: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return orgs.map(({ previewImagePath, ...rest }) => ({
      ...rest,
      hasCustomPreview: !!previewImagePath,
    }));
  }

  async getThumbnail(orgSlug: string): Promise<{ buffer: Buffer; maxAge: number }> {
    const org = await this.prisma.organization.findUnique({
      where: { slug: orgSlug, isActive: true },
      select: { isLive: true, previewMode: true, previewImagePath: true },
    });
    if (!org) throw new NotFoundException('Organization not found');

    if (org.isLive) {
      const buf = await this.thumbnail.getSnapshot(orgSlug, org.previewMode);
      if (!buf) throw new NotFoundException('Snapshot not available');
      return { buffer: buf, maxAge: 30 };
    }

    if (org.previewImagePath) {
      const filePath = join(process.cwd(), 'uploads', org.previewImagePath);
      const buf = await fs.readFile(filePath).catch(() => null);
      if (!buf) throw new NotFoundException('Preview image not found');
      return { buffer: buf, maxAge: 300 };
    }

    throw new NotFoundException('No preview available');
  }

  async getOrgWatch(orgSlug: string, key?: string) {
    const org = await this.prisma.organization.findUnique({
      where: { slug: orgSlug, isActive: true },
      select: {
        slug: true,
        name: true,
        description: true,
        isLive: true,
        streamTitle: true,
        streamDescription: true,
        streamIsPublic: true,
        streamPreviewKey: true,
      },
    });
    if (!org) throw new NotFoundException('Organization not found');

    if (!org.streamIsPublic && org.streamPreviewKey !== key) {
      return {
        slug: org.slug,
        name: org.name,
        isLive: false,
        streamTitle: '',
        streamDescription: null,
        streamIsPublic: false,
        accessDenied: true,
      };
    }

    const { streamPreviewKey: _, ...safe } = org;
    return safe;
  }

  async getStreamUrl(orgSlug: string, key?: string) {
    const org = await this.prisma.organization.findUnique({
      where: { slug: orgSlug, isActive: true },
      select: { slug: true, isLive: true, streamIsPublic: true, streamPreviewKey: true },
    });
    if (!org || !org.isLive) throw new NotFoundException('No live stream');
    if (!org.streamIsPublic && org.streamPreviewKey !== key) {
      throw new NotFoundException('No live stream');
    }
    return { hlsUrl: `/hls/live/${orgSlug}/index.m3u8` };
  }

  async getOrgBroadcasts(orgSlug: string, key?: string) {
    const org = await this.prisma.organization.findUnique({
      where: { slug: orgSlug, isActive: true },
      select: { id: true, streamIsPublic: true, streamPreviewKey: true },
    });
    if (!org) throw new NotFoundException('Organization not found');
    if (!org.streamIsPublic && org.streamPreviewKey !== key) return [];

    return this.prisma.broadcast.findMany({
      where: { orgId: org.id, endedAt: { not: null } },
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
