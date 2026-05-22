import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

export const DEFAULT_CHAT_TTL_MINUTES = 180;
export const ALLOWED_CHAT_TTL_MINUTES = [5, 30, 60, 180, 300] as const;

/**
 * Step 5 B2 — chat scope refactor.
 *
 * Chat больше не привязан к Organization напрямую. Скоуп определяется так:
 *   - Если Stream открыт в контексте активного Event'а
 *     (Event.startedAt != null AND Event.endedAt == null) — chat scope = eventId.
 *     Все Stream'ы Event'а делят один чат.
 *   - Иначе — chat scope = streamId.
 *
 * Persistence:
 *   - ChatMessage сохраняется ровно с одним FK: streamId XOR eventId.
 *   - Поле orgId оставлено nullable для backward-compat: existing сообщения,
 *     созданные до Step 5 data-migration, имеют orgId != null и streamId == null.
 *     Для default Stream'а орги мы дополнительно показываем их через OR-фильтр.
 *
 * TTL/cleanup — пока остаётся org-level настройкой (Organization.chatTtlMinutes).
 * Cleanup проходит по всем сообщениям орги (включая stream- и event-scoped),
 * связь "сообщение → org" восстанавливается через Stream.orgId / Event.orgId.
 */
export type ChatScope =
  | { type: 'event'; eventId: string }
  | { type: 'stream'; streamId: string };

export function scopeRoomKey(scope: ChatScope): string {
  return scope.type === 'event' ? `event:${scope.eventId}` : `stream:${scope.streamId}`;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Резолвит scope для пары (orgSlug, streamSlug?).
   *
   * Поведение:
   *   - streamSlug undefined/null/'' → default Stream орги (slug='').
   *   - Если найденный Stream привязан к активному Event'у — возвращает event scope.
   *   - Иначе — stream scope.
   *   - Если org или stream не найден / org isActive=false — возвращает null.
   */
  async resolveScope(orgSlug: string, streamSlug?: string | null): Promise<ChatScope | null> {
    const sSlug = streamSlug && streamSlug.length > 0 ? streamSlug : '';
    const stream = await this.prisma.stream.findFirst({
      where: { slug: sSlug, org: { slug: orgSlug, isActive: true } },
      select: {
        id: true,
        eventStreams: {
          where: { event: { startedAt: { not: null }, endedAt: null } },
          // Karen H4: orderBy свежее старее — единый детерминированный порядок
          // согласован с EventService.findActiveEventForStream / startBroadcast /
          // getOrgWatch. На случай (анти-)инварианта двух активных Event'ов
          // на Stream'е chat-scope резолвится в тот же Event, что и watch.
          orderBy: { event: { startedAt: 'desc' } },
          select: { eventId: true },
          take: 1,
        },
      },
    });
    if (!stream) return null;
    const activeEs = stream.eventStreams[0];
    if (activeEs) return { type: 'event', eventId: activeEs.eventId };
    return { type: 'stream', streamId: stream.id };
  }

  /**
   * Записывает сообщение в нужный scope. Уважает org.chatEnabled (если scope
   * можно соотнести с организацией — что верно для stream- и event-scope).
   * Возвращает null если orgа найдена и chat выключен, или если scope невалиден.
   */
  async writeMessage(
    scope: ChatScope,
    nickname: string,
    content: string,
  ): Promise<{ id: string; nickname: string; content: string; createdAt: Date } | null> {
    const enabled = await this.isChatEnabledForScope(scope);
    if (!enabled) return null;
    return this.prisma.chatMessage.create({
      data: {
        ...(scope.type === 'event'
          ? { eventId: scope.eventId }
          : { streamId: scope.streamId }),
        nickname,
        content: content.slice(0, 500),
      },
      select: { id: true, nickname: true, content: true, createdAt: true },
    });
  }

  /**
   * Возвращает recent messages с учётом TTL орги.
   *
   * Backward-compat: для stream-scope, если резолвится default Stream орги
   * (Stream.slug=''), также покажем legacy ChatMessage с orgId == org.id AND
   * streamId == null (созданные до прогона data-script 002).
   */
  async listMessages(
    scope: ChatScope,
    limit = 50,
  ): Promise<{
    messages: { id: string; nickname: string; content: string; createdAt: Date }[];
    ttlMinutes: number;
    chatEnabled: boolean;
  }> {
    const orgMeta = await this.getOrgMetaForScope(scope);
    const ttlMinutes = orgMeta?.chatTtlMinutes ?? DEFAULT_CHAT_TTL_MINUTES;
    const chatEnabled = orgMeta?.chatEnabled !== false;
    const cutoff = new Date(Date.now() - ttlMinutes * 60 * 1000);

    let where: import('@prisma/client').Prisma.ChatMessageWhereInput;
    if (scope.type === 'event') {
      where = { eventId: scope.eventId, createdAt: { gte: cutoff } };
    } else {
      // Stream scope: если это default Stream орги — добавляем OR-фильтр на
      // legacy сообщения (orgId != null AND streamId IS NULL) этой же орги.
      const streamMeta = await this.prisma.stream.findUnique({
        where: { id: scope.streamId },
        select: { orgId: true, slug: true },
      });
      if (streamMeta && streamMeta.slug === '') {
        where = {
          AND: [
            { createdAt: { gte: cutoff } },
            {
              OR: [
                { streamId: scope.streamId },
                { orgId: streamMeta.orgId, streamId: null, eventId: null },
              ],
            },
          ],
        };
      } else {
        where = { streamId: scope.streamId, createdAt: { gte: cutoff } };
      }
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
   * Очищает все сообщения этого scope.
   * Для stream-scope default Stream'а — также чистит legacy orgId-сообщения.
   */
  async clearMessagesByScope(scope: ChatScope): Promise<{ deleted: number }> {
    if (scope.type === 'event') {
      const { count } = await this.prisma.chatMessage.deleteMany({
        where: { eventId: scope.eventId },
      });
      return { deleted: count };
    }
    // stream scope
    const streamMeta = await this.prisma.stream.findUnique({
      where: { id: scope.streamId },
      select: { orgId: true, slug: true },
    });
    if (streamMeta && streamMeta.slug === '') {
      const { count } = await this.prisma.chatMessage.deleteMany({
        where: {
          OR: [
            { streamId: scope.streamId },
            { orgId: streamMeta.orgId, streamId: null, eventId: null },
          ],
        },
      });
      return { deleted: count };
    }
    const { count } = await this.prisma.chatMessage.deleteMany({
      where: { streamId: scope.streamId },
    });
    return { deleted: count };
  }

  /**
   * Чат-флаг ищется через ассоциированную orgu:
   *   - event scope → event.orgId
   *   - stream scope → stream.orgId
   */
  private async isChatEnabledForScope(scope: ChatScope): Promise<boolean> {
    const meta = await this.getOrgMetaForScope(scope);
    if (!meta) return false;
    return meta.chatEnabled !== false;
  }

  private async getOrgMetaForScope(
    scope: ChatScope,
  ): Promise<{ orgId: string; chatTtlMinutes: number; chatEnabled: boolean } | null> {
    if (scope.type === 'event') {
      const event = await this.prisma.event.findUnique({
        where: { id: scope.eventId },
        select: {
          orgId: true,
          org: { select: { chatTtlMinutes: true, chatEnabled: true } },
        },
      });
      if (!event) return null;
      return {
        orgId: event.orgId,
        chatTtlMinutes: event.org.chatTtlMinutes,
        chatEnabled: event.org.chatEnabled,
      };
    }
    const stream = await this.prisma.stream.findUnique({
      where: { id: scope.streamId },
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
      return this.clearMessagesByScope({ type: 'stream', streamId: defaultStream.id });
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
   * После Step 5 сообщения хранятся со streamId или eventId. Связь
   * "сообщение → org" восстанавливается через Stream.orgId / Event.orgId.
   * Legacy сообщения (orgId != null, streamId == null) также чистим.
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
          OR: [
            { orgId: org.id },
            { stream: { orgId: org.id } },
            { event: { orgId: org.id } },
          ],
        },
      });
      total += count;
    }

    // Karen C3 (Step 5): сообщения с обнулёнными FK (orgId/streamId/eventId = null)
    // — orphan'ы, которых не подберёт ни одна org-итерация выше. Это редкость
    // (Event.delete зануляет broadcast.eventId, но ChatMessage zhanovoy.eventId
    // через onDelete:Cascade удаляется вместе с Event'ом), но защитимся.
    // Используем минимальный TTL дефолт — orphan-сообщения без org-контекста
    // живут не дольше дефолта.
    const orphanCutoff = new Date(Date.now() - DEFAULT_CHAT_TTL_MINUTES * 60 * 1000);
    const { count: orphanCount } = await this.prisma.chatMessage.deleteMany({
      where: {
        orgId: null,
        streamId: null,
        eventId: null,
        createdAt: { lt: orphanCutoff },
      },
    });
    total += orphanCount;

    if (total > 0) {
      this.logger.log(`Удалено ${total} старых сообщений чата`);
    }
  }
}
