import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MediamtxService } from '../mediamtx/mediamtx.service';
import { randomBytes } from 'crypto';

@Injectable()
export class OrgService {
  constructor(
    private prisma: PrismaService,
    private mediamtx: MediamtxService,
  ) {}

  async getProfile(orgId: string, revealKey = false) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        id: true,
        slug: true,
        name: true,
        isActive: true,
        ingestKey: revealKey,
        ingestKeyCreatedAt: true,
        createdAt: true,
      },
    });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  async rotateKey(orgId: string, slug: string) {
    const ingestKey = randomBytes(18).toString('base64url');
    const org = await this.prisma.organization.update({
      where: { id: orgId },
      data: { ingestKey, ingestKeyCreatedAt: new Date() },
      select: { id: true, slug: true, ingestKey: true, ingestKeyCreatedAt: true },
    });
    await this.mediamtx.patchPath(slug, ingestKey);
    return org;
  }

  async createEvent(orgId: string, data: { title: string; description?: string; isPublic?: boolean }) {
    const previewKey = data.isPublic === false ? randomBytes(32).toString('hex') : undefined;
    return this.prisma.event.create({
      data: { orgId, previewKey, ...data },
      select: { id: true, title: true, description: true, status: true, isPublic: true, previewKey: true, createdAt: true },
    });
  }

  async updateEvent(
    orgId: string,
    eventId: string,
    data: { title?: string; description?: string; isPublic?: boolean; status?: string },
  ) {
    const event = await this.prisma.event.findFirst({ where: { id: eventId, orgId } });
    if (!event) throw new NotFoundException('Event not found');

    if (data.status === 'live') {
      const liveEvent = await this.prisma.event.findFirst({
        where: { orgId, status: 'live', id: { not: eventId } },
      });
      if (liveEvent) throw new ConflictException('Another event is already live');
    }

    const updateData: any = { ...data };
    if (data.status === 'live') updateData.startedAt = new Date();
    if (data.status === 'ended') updateData.endedAt = new Date();
    if (data.isPublic === false && !event.previewKey) {
      updateData.previewKey = randomBytes(32).toString('hex');
    }

    return this.prisma.event.update({
      where: { id: eventId },
      data: updateData,
      select: { id: true, title: true, status: true, isPublic: true, previewKey: true, startedAt: true, endedAt: true },
    });
  }

  async listEvents(orgId: string) {
    return this.prisma.event.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, status: true, isPublic: true, previewKey: true, startedAt: true, endedAt: true, createdAt: true },
    });
  }

  async deleteEvent(orgId: string, eventId: string) {
    const event = await this.prisma.event.findFirst({ where: { id: eventId, orgId } });
    if (!event) throw new NotFoundException('Event not found');
    await this.prisma.event.delete({ where: { id: eventId } });
    return { ok: true };
  }
}
