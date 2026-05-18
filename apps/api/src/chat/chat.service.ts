import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

export const DEFAULT_CHAT_TTL_MINUTES = 180;
export const ALLOWED_CHAT_TTL_MINUTES = [5, 30, 60, 180, 300] as const;

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(private prisma: PrismaService) {}

  async saveMessage(orgSlug: string, nickname: string, content: string) {
    const org = await this.prisma.organization.findUnique({
      where: { slug: orgSlug },
      select: { id: true, chatEnabled: true },
    });
    if (!org) return null;
    if (org.chatEnabled === false) return null;
    return this.prisma.chatMessage.create({
      data: { orgId: org.id, nickname, content: content.slice(0, 500) },
      select: { id: true, nickname: true, content: true, createdAt: true },
    });
  }

  async getRecentMessages(orgSlug: string, limit = 50) {
    const org = await this.prisma.organization.findUnique({
      where: { slug: orgSlug },
      select: { id: true, chatTtlMinutes: true, chatEnabled: true },
    });
    if (!org) return { messages: [], ttlMinutes: DEFAULT_CHAT_TTL_MINUTES, chatEnabled: true };
    const ttlMinutes = org.chatTtlMinutes ?? DEFAULT_CHAT_TTL_MINUTES;
    const cutoff = new Date(Date.now() - ttlMinutes * 60 * 1000);
    const messages = await this.prisma.chatMessage.findMany({
      where: { orgId: org.id, createdAt: { gte: cutoff } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, nickname: true, content: true, createdAt: true },
    });
    return { messages: messages.reverse(), ttlMinutes, chatEnabled: org.chatEnabled !== false };
  }

  async isChatEnabled(orgSlug: string): Promise<boolean> {
    const org = await this.prisma.organization.findUnique({
      where: { slug: orgSlug },
      select: { chatEnabled: true },
    });
    return org?.chatEnabled !== false;
  }

  async clearMessages(orgId: string): Promise<{ deleted: number }> {
    const { count } = await this.prisma.chatMessage.deleteMany({ where: { orgId } });
    return { deleted: count };
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async cleanupOldMessages() {
    const orgs = await this.prisma.organization.findMany({
      select: { id: true, chatTtlMinutes: true },
    });
    let total = 0;
    for (const org of orgs) {
      const ttlMinutes = org.chatTtlMinutes ?? DEFAULT_CHAT_TTL_MINUTES;
      const cutoff = new Date(Date.now() - ttlMinutes * 60 * 1000);
      const { count } = await this.prisma.chatMessage.deleteMany({
        where: { orgId: org.id, createdAt: { lt: cutoff } },
      });
      total += count;
    }
    if (total > 0) {
      this.logger.log(`Удалено ${total} старых сообщений чата`);
    }
  }
}
