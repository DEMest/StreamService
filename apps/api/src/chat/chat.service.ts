import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

export const DEFAULT_CHAT_TTL_MINUTES = 180;
export const ALLOWED_CHAT_TTL_MINUTES = [5, 30, 60, 180, 300] as const;

/**
 * Chat привязан к Stream'у: одна комната на Stream, `stream:<streamId>`.
 *
 * Persistence:
 *   - ChatMessage сохраняется со streamId.
 *   - Поле orgId оставлено nullable для backward-compat: existing сообщения,
 *     созданные до Step 5 data-migration, имеют orgId != null и streamId == null.
 *     Для default Stream'а орги мы дополнительно показываем их через OR-фильтр.
 *
 * TTL/cleanup — пока остаётся org-level настройкой (Organization.chatTtlMinutes).
 * Cleanup проходит по всем сообщениям орги (включая stream-scoped),
 * связь "сообщение → org" восстанавливается через Stream.orgId.
 */
export function chatRoomKey(streamId: string): string {
  return `stream:${streamId}`;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Резолвит streamId для пары (orgSlug, streamSlug?).
   * streamSlug undefined/null/'' → default Stream орги (slug='').
   * Возвращает null если org/stream не найдены или org.isActive=false.
   */
  async resolveStreamId(orgSlug: string, streamSlug?: string | null): Promise<string | null> {
    const sSlug = streamSlug && streamSlug.length > 0 ? streamSlug : '';
    const stream = await this.prisma.stream.findFirst({
      where: { slug: sSlug, org: { slug: orgSlug, isActive: true } },
      select: { id: true },
    });
    return stream?.id ?? null;
  }

  /**
   * Записывает сообщение в room стрима. Уважает org.chatEnabled.
   * Возвращает null если org не найдена или chat выключен.
   */
  async writeMessage(
    streamId: string,
    nickname: string,
    content: string,
  ): Promise<{ id: string; nickname: string; content: string; createdAt: Date } | null> {
    const enabled = await this.isChatEnabledForStream(streamId);
    if (!enabled) return null;
    return this.prisma.chatMessage.create({
      data: { streamId, nickname, content: content.slice(0, 500) },
      select: { id: true, nickname: true, content: true, createdAt: true },
    });
  }

  /**
   * Возвращает recent messages с учётом TTL орги.
   *
   * Backward-compat: если резолвится default Stream орги (Stream.slug=''),
   * также покажем legacy ChatMessage с orgId == org.id AND streamId == null
   * (созданные до прогона data-script 002).
   */
  async listMessages(
    streamId: string,
    limit = 50,
  ): Promise<{
    messages: { id: string; nickname: string; content: string; createdAt: Date }[];
    ttlMinutes: number;
    chatEnabled: boolean;
  }> {
    const orgMeta = await this.getOrgMetaForStream(streamId);
    const ttlMinutes = orgMeta?.chatTtlMinutes ?? DEFAULT_CHAT_TTL_MINUTES;
    const chatEnabled = orgMeta?.chatEnabled !== false;
    const cutoff = new Date(Date.now() - ttlMinutes * 60 * 1000);

    const streamMeta = await this.prisma.stream.findUnique({
      where: { id: streamId },
      select: { orgId: true, slug: true },
    });

    let where: import('@prisma/client').Prisma.ChatMessageWhereInput;
    if (streamMeta && streamMeta.slug === '') {
      where = {
        AND: [
          { createdAt: { gte: cutoff } },
          {
            OR: [
              { streamId },
              { orgId: streamMeta.orgId, streamId: null },
            ],
          },
        ],
      };
    } else {
      where = { streamId, createdAt: { gte: cutoff } };
    }

    const messages = await this.prisma.chatMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, nickname: true, content: true, createdAt: true },
    });
    return { messages: messages.reverse(), ttlMinutes, chatEnabled };
  }

  /**
   * Очищает все сообщения этого стрима.
   * Для default Stream'а — также чистит legacy orgId-сообщения.
   */
  async clearMessagesByStream(streamId: string): Promise<{ deleted: number }> {
    const streamMeta = await this.prisma.stream.findUnique({
      where: { id: streamId },
      select: { orgId: true, slug: true },
    });
    if (streamMeta && streamMeta.slug === '') {
      const { count } = await this.prisma.chatMessage.deleteMany({
        where: {
          OR: [
            { streamId },
            { orgId: streamMeta.orgId, streamId: null },
          ],
        },
      });
      return { deleted: count };
    }
    const { count } = await this.prisma.chatMessage.deleteMany({ where: { streamId } });
    return { deleted: count };
  }

  private async isChatEnabledForStream(streamId: string): Promise<boolean> {
    const meta = await this.getOrgMetaForStream(streamId);
    if (!meta) return false;
    return meta.chatEnabled !== false;
  }

  private async getOrgMetaForStream(
    streamId: string,
  ): Promise<{ orgId: string; chatTtlMinutes: number; chatEnabled: boolean } | null> {
    const stream = await this.prisma.stream.findUnique({
      where: { id: streamId },
      select: {
        orgId: true,
        org: { select: { chatTtlMinutes: true, chatEnabled: true } },
      },
    });
    if (!stream) return null;
    return {
      orgId: stream.orgId,
      chatTtlMinutes: stream.org.chatTtlMinutes,
      chatEnabled: stream.org.chatEnabled,
    };
  }

  /**
   * Backward-compat: вызывается из OrgService.clearChat(orgId).
   * Очищает сообщения default Stream'а орги (включая legacy orgId-сообщения).
   * Если default Stream не найден (org без миграции 001) — fallback на orgId.
   */
  async clearMessages(orgId: string): Promise<{ deleted: number }> {
    const defaultStream = await this.prisma.stream.findFirst({
      where: { orgId, slug: '' },
      select: { id: true },
    });
    if (defaultStream) {
      return this.clearMessagesByStream(defaultStream.id);
    }
    const { count } = await this.prisma.chatMessage.deleteMany({ where: { orgId } });
    return { deleted: count };
  }

  async isChatEnabled(orgSlug: string): Promise<boolean> {
    const org = await this.prisma.organization.findUnique({
      where: { slug: orgSlug },
      select: { chatEnabled: true },
    });
    return org?.chatEnabled !== false;
  }

  /**
   * Удаляет старые сообщения по TTL для каждой орги.
   *
   * Сообщения хранятся со streamId. Связь "сообщение → org" восстанавливается
   * через Stream.orgId. Legacy сообщения (orgId != null, streamId == null)
   * также чистим.
   */
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
        where: {
          createdAt: { lt: cutoff },
          OR: [{ orgId: org.id }, { stream: { orgId: org.id } }],
        },
      });
      total += count;
    }

    // Сообщения с обнулёнными FK (orgId/streamId = null) — orphan'ы, которых
    // не подберёт ни одна org-итерация выше (в т.ч. legacy-сообщения, оставшиеся
    // от удалённой Event-фичи). Используем минимальный TTL дефолт —
    // orphan-сообщения без org-контекста живут не дольше дефолта.
    const orphanCutoff = new Date(Date.now() - DEFAULT_CHAT_TTL_MINUTES * 60 * 1000);
    const { count: orphanCount } = await this.prisma.chatMessage.deleteMany({
      where: {
        orgId: null,
        streamId: null,
        createdAt: { lt: orphanCutoff },
      },
    });
    total += orphanCount;

    if (total > 0) {
      this.logger.log(`Удалено ${total} старых сообщений чата`);
    }
  }
}
