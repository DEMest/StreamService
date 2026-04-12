import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PublicService {
  constructor(private prisma: PrismaService) {}

  async getCatalog() {
    return this.prisma.organization.findMany({
      where: { isActive: true, events: { some: { status: 'live', isPublic: true } } },
      select: {
        slug: true,
        name: true,
        events: {
          where: { status: 'live', isPublic: true },
          take: 1,
          select: { id: true, title: true, startedAt: true },
        },
      },
    });
  }

  async getOrgWatch(orgSlug: string) {
    const org = await this.prisma.organization.findUnique({
      where: { slug: orgSlug, isActive: true },
      select: {
        slug: true,
        name: true,
        events: {
          where: { status: 'live' },
          take: 1,
          select: { id: true, title: true, description: true, isPublic: true, startedAt: true },
        },
      },
    });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  async getStreamUrl(orgSlug: string) {
    const org = await this.prisma.organization.findUnique({
      where: { slug: orgSlug, isActive: true },
      select: {
        slug: true,
        events: { where: { status: 'live' }, take: 1, select: { id: true } },
      },
    });
    if (!org || org.events.length === 0) throw new NotFoundException('No live stream');
    return { hlsUrl: `/hls/live/${orgSlug}/index.m3u8` };
  }
}
