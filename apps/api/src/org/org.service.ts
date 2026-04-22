import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MediamtxService } from '../mediamtx/mediamtx.service';
import { RecordingService } from '../recording/recording.service';
import { randomBytes } from 'crypto';
import * as sharp from 'sharp';
import { promises as fs } from 'fs';
import { join } from 'path';

@Injectable()
export class OrgService {
  constructor(
    private prisma: PrismaService,
    private mediamtx: MediamtxService,
    private recording: RecordingService,
  ) {}

  async getProfile(orgId: string, revealKey = false) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        id: true,
        slug: true,
        name: true,
        isActive: true,
        isLive: true,
        autoStream: true,
        streamTitle: true,
        streamDescription: true,
        streamIsPublic: true,
        streamPreviewKey: true,
        previewMode: true,
        previewImagePath: true,
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

  async updateStreamSettings(
    orgId: string,
    data: { streamTitle?: string; streamDescription?: string; streamIsPublic?: boolean; autoStream?: boolean; previewMode?: string },
  ) {
    const updateData: Record<string, any> = { ...data };

    if (data.streamIsPublic === false) {
      const org = await this.prisma.organization.findUnique({
        where: { id: orgId },
        select: { streamPreviewKey: true },
      });
      if (!org?.streamPreviewKey) {
        updateData.streamPreviewKey = randomBytes(32).toString('hex');
      }
    } else if (data.streamIsPublic === true) {
      updateData.streamPreviewKey = null;
    }

    return this.prisma.organization.update({
      where: { id: orgId },
      data: updateData,
      select: {
        id: true, streamTitle: true, streamDescription: true,
        streamIsPublic: true, streamPreviewKey: true, autoStream: true, isLive: true,
        previewMode: true,
      },
    });
  }

  async startStream(orgId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, streamTitle: true, streamDescription: true, isLive: true },
    });
    if (!org) throw new NotFoundException('Organization not found');
    if (org.isLive) return { alreadyLive: true };

    const broadcast = await this.prisma.broadcast.create({
      data: {
        orgId,
        title: org.streamTitle || 'Трансляция',
        description: org.streamDescription ?? undefined,
        startedAt: new Date(),
      },
    });

    await this.prisma.organization.update({
      where: { id: orgId },
      data: { isLive: true, currentBroadcastId: broadcast.id },
    });

    return { ok: true, broadcastId: broadcast.id };
  }

  async endStream(orgId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, slug: true, isLive: true, currentBroadcastId: true },
    });
    if (!org || !org.isLive || !org.currentBroadcastId) return { alreadyOff: true };

    const broadcastId = org.currentBroadcastId;

    await this.prisma.broadcast.update({
      where: { id: broadcastId },
      data: { endedAt: new Date() },
    });

    await this.prisma.organization.update({
      where: { id: orgId },
      data: { isLive: false, currentBroadcastId: null },
    });

    this.recording.onStreamEnded(broadcastId, org.slug).catch(() => {});

    return { ok: true };
  }

  async verifyIngestKey(slug: string, key: string): Promise<boolean> {
    const org = await this.prisma.organization.findUnique({
      where: { slug },
      select: { ingestKey: true, isActive: true },
    });
    return !!org && org.isActive && org.ingestKey === key;
  }

  async handleWebhook(orgSlug: string, action: 'publish' | 'unpublish') {
    const org = await this.prisma.organization.findUnique({
      where: { slug: orgSlug },
      select: { id: true },
    });
    if (!org) return;
    if (action === 'publish') await this.startStream(org.id);
    else if (action === 'unpublish') await this.endStream(org.id);
  }

  async listBroadcasts(orgId: string) {
    return this.prisma.broadcast.findMany({
      where: { orgId, endedAt: { not: null } },
      orderBy: { startedAt: 'desc' },
      select: {
        id: true, title: true, description: true,
        startedAt: true, endedAt: true, createdAt: true,
        recording: {
          select: { id: true, status: true, fileSize: true, duration: true },
        },
      },
    });
  }

  async updateBroadcast(
    orgId: string,
    broadcastId: string,
    data: { title?: string; description?: string },
  ) {
    const broadcast = await this.prisma.broadcast.findFirst({ where: { id: broadcastId, orgId } });
    if (!broadcast) throw new NotFoundException('Broadcast not found');
    return this.prisma.broadcast.update({
      where: { id: broadcastId },
      data,
      select: { id: true, title: true, description: true },
    });
  }

  async deleteBroadcast(orgId: string, broadcastId: string) {
    const broadcast = await this.prisma.broadcast.findFirst({ where: { id: broadcastId, orgId } });
    if (!broadcast) throw new NotFoundException('Broadcast not found');
    await this.recording.deleteRecordingByBroadcastId(broadcastId);
    await this.prisma.broadcast.delete({ where: { id: broadcastId } });
    return { ok: true };
  }

  private getUploadsDir(): string {
    return join(process.cwd(), 'uploads', 'previews');
  }

  async uploadPreview(orgId: string, orgSlug: string, fileBuffer: Buffer): Promise<{ ok: true; previewImagePath: string }> {
    const dir = this.getUploadsDir();
    await fs.mkdir(dir, { recursive: true });

    const filename = `${orgSlug}.jpg`;
    const filePath = join(dir, filename);

    await sharp(fileBuffer)
      .resize(640, 360, { fit: 'cover' })
      .jpeg({ quality: 80 })
      .toFile(filePath);

    const relativePath = `previews/${filename}`;
    await this.prisma.organization.update({
      where: { id: orgId },
      data: { previewImagePath: relativePath },
    });

    return { ok: true, previewImagePath: relativePath };
  }

  async deletePreview(orgId: string, orgSlug: string): Promise<{ ok: true }> {
    const filePath = join(this.getUploadsDir(), `${orgSlug}.jpg`);
    await fs.unlink(filePath).catch(() => {});
    await this.prisma.organization.update({
      where: { id: orgId },
      data: { previewImagePath: null },
    });
    return { ok: true };
  }
}
