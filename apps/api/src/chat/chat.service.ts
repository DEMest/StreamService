import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ChatService {
  constructor(private prisma: PrismaService) {}

  async saveMessage(eventId: string, nickname: string, content: string) {
    return this.prisma.chatMessage.create({
      data: { eventId, nickname, content: content.slice(0, 500) },
      select: { id: true, nickname: true, content: true, createdAt: true },
    });
  }

  async getRecentMessages(eventId: string, limit = 50) {
    const messages = await this.prisma.chatMessage.findMany({
      where: { eventId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, nickname: true, content: true, createdAt: true },
    });
    return messages.reverse();
  }
}
