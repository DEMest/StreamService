import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StreamService } from '../stream/stream.service';
import { RecordingService } from '../recording/recording.service';
import { ChatGateway } from '../chat/chat.gateway';
import { ChatService, ALLOWED_CHAT_TTL_MINUTES } from '../chat/chat.service';
import * as sharp from 'sharp';
import { promises as fs } from 'fs';
import { join } from 'path';

/**
 * OrgService теперь работает только с org-уровневыми операциями.
 * Все stream-уровневые (ingestKey, isLive, broadcasts, settings) делегируются в StreamService
 * через default Stream орга (slug=''). DTO-форма ответов сохраняется для backwards-compat.
 * Чат-настройки (chatTtlMinutes, chatEnabled) живут на Organization.
 */
@Injectable()
export class OrgService {
  constructor(
    private prisma: PrismaService,
    private stream: StreamService,
    private recording: RecordingService,
    private chatGateway: ChatGateway,
    private chatService: ChatService,
  ) {}

  async getProfile(orgId: string, revealKey = false) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        id: true,
        slug: true,
        name: true,
        isActive: true,
        createdAt: true,
        chatTtlMinutes: true,
        chatEnabled: true,
      },
    });
    if (!org) throw new NotFoundException('Organization not found');
    const stream = await this.stream.getDefaultStream(orgId);

    // Legacy DTO для совместимости с фронтом (Step 1 — фронт не меняется)
    return {
      id: org.id,
      slug: org.slug,
      name: org.name,
      isActive: org.isActive,
      createdAt: org.createdAt,
      chatTtlMinutes: org.chatTtlMinutes,
      chatEnabled: org.chatEnabled,
      isLive: stream.isLive,
      autoStream: stream.autoStartMode === 'public',
      streamTitle: stream.name,
      streamDescription: stream.description,
      streamIsPublic: stream.isPublic,
      streamPreviewKey: stream.previewKey,
      previewMode: stream.previewMode,
      previewImagePath: stream.previewImagePath,
      ingestKey: revealKey ? stream.ingestKey : undefined,
      ingestKeyCreatedAt: stream.ingestKeyCreatedAt,
    };
  }

  async rotateKey(orgId: string, _slug: string) {
    const defaultStream = await this.stream.getDefaultStream(orgId);
    const updated = await this.stream.rotateKey(defaultStream.id);
    return {
      id: defaultStream.id,
      slug: _slug,
      ingestKey: updated.ingestKey,
      ingestKeyCreatedAt: updated.ingestKeyCreatedAt,
    };
  }

  async clearChat(orgId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { slug: true },
    });
    if (!org) throw new NotFoundException('Organization not found');
    const result = await this.chatService.clearMessages(orgId);
    this.chatGateway.broadcastChatCleared(org.slug);
    return { ok: true, ...result };
  }

  async updateStreamSettings(
    orgId: string,
    data: {
      streamTitle?: string;
      streamDescription?: string;
      streamIsPublic?: boolean;
      autoStream?: boolean;
      previewMode?: string;
      chatTtlMinutes?: number;
      chatEnabled?: boolean;
    },
  ) {
    // Chat fields go to Organization
    const orgData: Record<string, any> = {};
    if (data.chatTtlMinutes !== undefined) {
      if (!ALLOWED_CHAT_TTL_MINUTES.includes(data.chatTtlMinutes as any)) {
        throw new BadRequestException(`Invalid chatTtlMinutes. Allowed: ${ALLOWED_CHAT_TTL_MINUTES.join(', ')}`);
      }
      orgData.chatTtlMinutes = data.chatTtlMinutes;
    }
    if (data.chatEnabled !== undefined) {
      orgData.chatEnabled = data.chatEnabled;
    }

    let updatedOrg: { slug: string; chatTtlMinutes: number; chatEnabled: boolean } | null = null;
    if (Object.keys(orgData).length > 0) {
      updatedOrg = await this.prisma.organization.update({
        where: { id: orgId },
        data: orgData,
        select: { slug: true, chatTtlMinutes: true, chatEnabled: true },
      });
      if (data.chatEnabled !== undefined && updatedOrg) {
        this.chatGateway.broadcastChatEnabled(updatedOrg.slug, updatedOrg.chatEnabled);
      }
    }

    // Stream-level fields delegated to StreamService
    const defaultStream = await this.stream.getDefaultStream(orgId);
    const mapped: Parameters<StreamService['updateSettings']>[1] = {};
    if (data.streamTitle !== undefined) mapped.name = data.streamTitle;
    if (data.streamDescription !== undefined) mapped.description = data.streamDescription;
    if (data.streamIsPublic !== undefined) mapped.isPublic = data.streamIsPublic;
    if (data.autoStream !== undefined) mapped.autoStartMode = data.autoStream ? 'public' : 'test';
    if (data.previewMode !== undefined) mapped.previewMode = data.previewMode;

    const updated = await this.stream.updateSettings(defaultStream.id, mapped);
    const orgChat = updatedOrg ?? await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { chatTtlMinutes: true, chatEnabled: true },
    });

    return {
      id: updated.id,
      streamTitle: updated.name,
      streamDescription: updated.description,
      streamIsPublic: updated.isPublic,
      streamPreviewKey: updated.previewKey,
      autoStream: updated.autoStartMode === 'public',
      isLive: updated.isLive,
      previewMode: updated.previewMode,
      chatTtlMinutes: orgChat?.chatTtlMinutes,
      chatEnabled: orgChat?.chatEnabled,
    };
  }

  async listBroadcasts(orgId: string) {
    const defaultStream = await this.stream.getDefaultStream(orgId);
    return this.prisma.broadcast.findMany({
      where: { streamId: defaultStream.id, endedAt: { not: null } },
      orderBy: { startedAt: 'desc' },
      select: {
        id: true, title: true, description: true,
        startedAt: true, endedAt: true, createdAt: true,
        recording: { select: { id: true, status: true, fileSize: true, duration: true } },
      },
    });
  }

  async updateBroadcast(
    orgId: string,
    broadcastId: string,
    data: { title?: string; description?: string },
  ) {
    const defaultStream = await this.stream.getDefaultStream(orgId);
    const broadcast = await this.prisma.broadcast.findFirst({
      where: { id: broadcastId, streamId: defaultStream.id },
    });
    if (!broadcast) throw new NotFoundException('Broadcast not found');
    return this.prisma.broadcast.update({
      where: { id: broadcastId },
      data,
      select: { id: true, title: true, description: true },
    });
  }

  async deleteBroadcast(orgId: string, broadcastId: string) {
    const defaultStream = await this.stream.getDefaultStream(orgId);
    const broadcast = await this.prisma.broadcast.findFirst({
      where: { id: broadcastId, streamId: defaultStream.id },
    });
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
    const defaultStream = await this.stream.getDefaultStream(orgId);
    await this.prisma.stream.update({
      where: { id: defaultStream.id },
      data: { previewImagePath: relativePath },
    });

    return { ok: true, previewImagePath: relativePath };
  }

  async deletePreview(orgId: string, orgSlug: string): Promise<{ ok: true }> {
    const filePath = join(this.getUploadsDir(), `${orgSlug}.jpg`);
    await fs.unlink(filePath).catch(() => {});
    const defaultStream = await this.stream.getDefaultStream(orgId);
    await this.prisma.stream.update({
      where: { id: defaultStream.id },
      data: { previewImagePath: null },
    });
    return { ok: true };
  }
}
