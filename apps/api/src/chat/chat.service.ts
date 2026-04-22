import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

const MESSAGE_TTL_MS = 5 * 60 * 1000; // 5 minutes

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(private prisma: PrismaService) {}

  async saveMessage(orgSlug: string, nickname: string, content: string) {
    const org = await this.prisma.organization.findUnique({
      where: { slug: orgSlug },
      select: { id: true },
    });
    if (!org) return null;
    return this.prisma.chatMessage.create({
      data: { orgId: org.id, nickname, content: content.slice(0, 500) },
      select: { id: true, nickname: true, content: true, createdAt: true },
    });
  }

  async getRecentMessages(orgSlug: string, limit = 50) {
    const org = await this.prisma.organization.findUnique({
      where: { slug: orgSlug },
      select: { id: true },
    });
    if (!org) return [];
    const cutoff = new Date(Date.now() - MESSAGE_TTL_MS);
    const messages = await this.prisma.chatMessage.findMany({
      where: { orgId: org.id, createdAt: { gte: cutoff } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, nickname: true, content: true, createdAt: true },
    });
    return messages.reverse();
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async cleanupOldMessages() {
    const cutoff = new Date(Date.now() - MESSAGE_TTL_MS);
    const { count } = await this.prisma.chatMessage.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    if (count > 0) {
      this.logger.log(`Удалено ${count} старых сообщений чата`);
    }
  }
}
