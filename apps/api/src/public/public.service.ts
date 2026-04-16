import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PublicService {
  constructor(private prisma: PrismaService) {}

  async getCatalog() {
    return this.prisma.organization.findMany({
      where: { isActive: true },
      select: {
        slug: true,
        name: true,
        isLive: true,
        streamTitle: true,
      },
      orderBy: { createdAt: 'desc' },
    });
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
