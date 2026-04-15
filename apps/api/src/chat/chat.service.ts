import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ChatService {
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
    const messages = await this.prisma.chatMessage.findMany({
      where: { orgId: org.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, nickname: true, content: true, createdAt: true },
    });
    return messages.reverse();
  }
}
