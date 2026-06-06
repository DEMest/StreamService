import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const EVENT_SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EVENT_SLUG_MAX_LEN = 32;

/**
 * Валидация slug для Event'а (POST /v1/org/events).
 *
 * Правила (синхронизированы со spec §9):
 *   - длина 1..32, не пустой
 *   - lowercase letters/digits + одиночные `-` (не в начале/конце, без двойных)
 *
 * Уникальность slug per orgId — на уровне БД (`@@unique([orgId, slug])`).
 * Здесь только формат: уникальность ловит P2002 → ConflictException.
 */
export function validateEventSlug(input: unknown): string {
  if (typeof input !== 'string') {
    throw new BadRequestException('slug is required and must be a string');
  }
  const slug = input.trim();
  if (slug === '') {
    throw new BadRequestException('slug must not be empty');
  }
  if (slug.length > EVENT_SLUG_MAX_LEN) {
    throw new BadRequestException(`slug too long (max ${EVENT_SLUG_MAX_LEN} chars)`);
  }
  if (!EVENT_SLUG_REGEX.test(slug)) {
    throw new BadRequestException(
      'slug must be lowercase alphanumeric with single dashes (e.g. "spring-cup", "open-2026")',
    );
  }
  return slug;
}

export interface CreateEventInput {
  slug: string;
  title: string;
  description?: string | null;
  scheduledAt?: string | Date | null;
}

export interface UpdateEventInput {
  title?: string;
  description?: string | null;
  scheduledAt?: string | Date | null;
}

/**
 * Базовые поля Event'а для DTO (без relations).
 */
const EVENT_DTO_FIELDS = {
  id: true,
  slug: true,
  title: true,
  description: true,
  scheduledAt: true,
  startedAt: true,
  endedAt: true,
  createdAt: true,
} as const;

@Injectable()
export class EventService {
  private readonly logger = new Logger(EventService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Список Event'ов орги. Сортировка — createdAt DESC (свежие сверху).
   * eventStreams не включены (отдельный getById для деталей).
   */
  async list(orgId: string) {
    return this.prisma.event.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      select: EVENT_DTO_FIELDS,
    });
  }

  /**
   * Детали Event'а с включением списка привязанных Stream'ов.
   * Cross-tenant → 404 (фильтр по orgId).
   */
  async get(orgId: string, eventId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, orgId },
      include: {
        eventStreams: {
          include: {
            stream: {
              select: {
                id: true,
                slug: true,
                name: true,
                isLive: true,
                isPublic: true,
                previewMode: true,
              },
            },
          },
          orderBy: { addedAt: 'asc' },
        },
      },
    });
    if (!event) throw new NotFoundException('Event not found');
    return this.toDetailDto(event);
  }

  /**
   * Создание Event'а.
   *
   * Защиты:
   *   - validateEventSlug — формат.
   *   - title — non-empty string.
   *   - scheduledAt — опционально, парсится в Date если строка.
   *   - P2002 (Prisma unique violation) → 409.
   */
  async create(orgId: string, input: CreateEventInput) {
    const slug = validateEventSlug(input.slug);

    if (typeof input.title !== 'string' || input.title.trim() === '') {
      throw new BadRequestException('title is required and must be a non-empty string');
    }
    const title = input.title.trim();

    const description =
      input.description === undefined || input.description === null
        ? null
        : String(input.description);

    const scheduledAt = this.coerceDate(input.scheduledAt, 'scheduledAt');

    // Резолвим орг для проверки существования (cleaner error чем FK violation).
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true },
    });
    if (!org) throw new NotFoundException('Organization not found');

    try {
      const created = await this.prisma.event.create({
        data: {
          orgId,
          slug,
          title,
          description,
          scheduledAt,
        },
        select: EVENT_DTO_FIELDS,
      });
      return created;
    } catch (e: any) {
      if (e.code === 'P2002') {
        throw new ConflictException(`Event slug '${slug}' already taken in this organization`);
      }
      throw e;
    }
  }

  /**
   * Update — только title/description/scheduledAt. slug менять не даём
   * (slug — стабильный публичный идентификатор Event'а в URL'ах каталога/landing).
   */
  async update(orgId: string, eventId: string, input: UpdateEventInput) {
    await this.loadForOrg(orgId, eventId);

    const data: Record<string, any> = {};
    if (input.title !== undefined) {
      if (typeof input.title !== 'string' || input.title.trim() === '') {
        throw new BadRequestException('title must be a non-empty string');
      }
      data.title = input.title.trim();
    }
    if (input.description !== undefined) {
      data.description = input.description === null ? null : String(input.description);
    }
    if (input.scheduledAt !== undefined) {
      data.scheduledAt = this.coerceDate(input.scheduledAt, 'scheduledAt');
    }

    return this.prisma.event.update({
      where: { id: eventId },
      data,
      select: EVENT_DTO_FIELDS,
    });
  }

  /**
   * Каскадно удалить Event:
   *   - EventStream → onDelete:Cascade.
   *   - ChatMessage с eventId → onDelete:Cascade.
   *   - Broadcast.eventId → SetNull (FK без onDelete, но в схеме relation
   *     `eventId String?` allows nullable; Prisma default — Restrict, поэтому
   *     явно зануляем перед удалением).
   */
  async delete(orgId: string, eventId: string) {
    await this.loadForOrg(orgId, eventId);

    // Зануляем eventId на привязанных Broadcast'ах, чтобы не получить FK-violation
    // (relation `event Event?` не указывает onDelete на Broadcast.eventId).
    await this.prisma.broadcast.updateMany({
      where: { eventId },
      data: { eventId: null },
    });

    await this.prisma.event.delete({ where: { id: eventId } });
    return { ok: true };
  }

  /**
   * Перевести Event в активное состояние: startedAt = NOW().
   * Идемпотентно — если уже стартанул, возвращаем текущее состояние.
   * После end (endedAt!=null) рестарт запрещаем — это другой Event с т.зрения
   * семантики (нужно создать новый).
   *
   * Karen C1 (Step 5): после установки startedAt ретроактивно «усыновляем»
   * активные Broadcast'ы Stream'ов этого Event'а — если кто-то начал publish
   * ДО старта Event'а, его Broadcast был создан с eventId=null и оставался
   * orphan'ом. Здесь обновляем eventId на всех таких активных Broadcast'ах,
   * чтобы релейшен Event↔Broadcast не разваливался по timing'у.
   */
  async start(orgId: string, eventId: string) {
    const event = await this.loadForOrg(orgId, eventId);
    if (event.endedAt) {
      throw new BadRequestException('Event has already ended; create a new event to start again');
    }
    if (event.startedAt) {
      // Уже стартанул — возвращаем как есть.
      return this.prisma.event.findUniqueOrThrow({
        where: { id: eventId },
        select: EVENT_DTO_FIELDS,
      });
    }
    const updated = await this.prisma.event.update({
      where: { id: eventId },
      data: { startedAt: new Date() },
      select: EVENT_DTO_FIELDS,
    });

    // Relink активных Broadcast'ов Stream'ов этого Event'а: если publish
    // начался ДО Event.start — броадкаст создан с eventId=null. Подвязываем
    // его к этому Event'у. Только activeBroadcast (endedAt=null) и только
    // те, у которых eventId ещё не проставлен (другой Event их не «украдёт»).
    const eventStreamRows = await this.prisma.eventStream.findMany({
      where: { eventId },
      select: { streamId: true },
    });
    const streamIds = eventStreamRows.map((r) => r.streamId);
    if (streamIds.length > 0) {
      await this.prisma.broadcast.updateMany({
        where: {
          streamId: { in: streamIds },
          endedAt: null,
          eventId: null,
        },
        data: { eventId },
      });
    }

    return updated;
  }

  /**
   * Завершить Event: endedAt = NOW().
   * Не стартовавший Event закрыть нельзя (нечего закрывать) — 400.
   */
  async end(orgId: string, eventId: string) {
    const event = await this.loadForOrg(orgId, eventId);
    if (!event.startedAt) {
      throw new BadRequestException('Cannot end an event that has not started');
    }
    if (event.endedAt) {
      // Уже завершён — идемпотентно возвращаем текущее.
      return this.prisma.event.findUniqueOrThrow({
        where: { id: eventId },
        select: EVENT_DTO_FIELDS,
      });
    }
    return this.prisma.event.update({
      where: { id: eventId },
      data: { endedAt: new Date() },
      select: EVENT_DTO_FIELDS,
    });
  }

  /**
   * Добавить Stream в Event. Stream обязан принадлежать той же орге что и Event
   * (защита от sneaky cross-tenant: org_admin orgA указывает streamId из orgB).
   *
   * Идемпотентно — если уже привязан, возвращаем текущий список (без P2002).
   */
  async addStream(orgId: string, eventId: string, streamId: string) {
    if (typeof streamId !== 'string' || streamId.trim() === '') {
      throw new BadRequestException('streamId is required');
    }
    await this.loadForOrg(orgId, eventId);

    // Stream должен быть из той же орги.
    const stream = await this.prisma.stream.findFirst({
      where: { id: streamId, orgId },
      select: { id: true },
    });
    if (!stream) {
      // 404 — не палим существование Stream'а из чужой орги.
      throw new NotFoundException('Stream not found');
    }

    try {
      await this.prisma.eventStream.create({
        data: { eventId, streamId },
      });
    } catch (e: any) {
      // P2002 = (eventId, streamId) уже существует — idempotent skip.
      if (e.code !== 'P2002') throw e;
    }

    return this.get(orgId, eventId);
  }

  /**
   * Убрать Stream из Event. Идемпотентно — если связи нет, не падаем.
   */
  async removeStream(orgId: string, eventId: string, streamId: string) {
    await this.loadForOrg(orgId, eventId);

    // Не проверяем cross-tenant для streamId здесь: EventStream PK = (eventId, streamId),
    // а eventId уже tenant-validated; чужой Stream просто не будет в EventStream этого Event'а.
    await this.prisma.eventStream
      .delete({
        where: { eventId_streamId: { eventId, streamId } },
      })
      .catch((e: any) => {
        if (e.code === 'P2025') return; // запись не найдена — ok, idempotent
        throw e;
      });

    return this.get(orgId, eventId);
  }

  /**
   * Активный Event для Stream'а: startedAt != null && endedAt == null,
   * Stream должен быть в EventStream этого Event'а.
   *
   * Возвращает первый подходящий (по факту инвариант — в один момент времени у
   * Stream'а может быть не более одного активного Event'а, гарантируется UX/UI
   * слоем; БД-уровневую защиту от множественных активных не вводим — это
   * было бы partial unique index, который у Postgres есть, но в Prisma пока
   * нерешаемо без raw SQL миграции).
   */
  async findActiveEventForStream(streamId: string) {
    return this.prisma.event.findFirst({
      where: {
        startedAt: { not: null },
        endedAt: null,
        eventStreams: { some: { streamId } },
      },
      // Karen H4: единый детерминированный порядок (свежее старее) — синхронизирован
      // с stream.service.startBroadcast и public.service.getOrgWatch.
      orderBy: { startedAt: 'desc' },
      select: { id: true, orgId: true, slug: true, title: true },
    });
  }

  // ───────────────────────── helpers ─────────────────────────

  private async loadForOrg(orgId: string, eventId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, orgId },
      select: {
        id: true,
        orgId: true,
        slug: true,
        startedAt: true,
        endedAt: true,
      },
    });
    if (!event) throw new NotFoundException('Event not found');
    return event;
  }

  /**
   * Принимает Date | string | null | undefined и возвращает Date | null.
   * `undefined` мапится в `null` для явного очищения поля (callers сами
   * фильтруют undefined в update-патче, см. update()).
   */
  private coerceDate(
    raw: string | Date | null | undefined,
    field: string,
  ): Date | null {
    if (raw === undefined || raw === null) return null;
    if (raw instanceof Date) {
      if (Number.isNaN(raw.getTime())) {
        throw new BadRequestException(`${field} is an invalid Date`);
      }
      return raw;
    }
    if (typeof raw === 'string') {
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) {
        throw new BadRequestException(`${field} is not a valid ISO date string`);
      }
      return d;
    }
    throw new BadRequestException(`${field} must be ISO string or Date`);
  }

  /**
   * Нормализация Event с включённым eventStreams[].stream — фронту удобнее
   * получить плоский streams[] (без вложенной EventStream-обёртки).
   */
  private toDetailDto(event: any) {
    return {
      id: event.id,
      slug: event.slug,
      title: event.title,
      description: event.description,
      scheduledAt: event.scheduledAt,
      startedAt: event.startedAt,
      endedAt: event.endedAt,
      createdAt: event.createdAt,
      streams: (event.eventStreams ?? []).map((es: any) => ({
        id: es.stream.id,
        slug: es.stream.slug,
        name: es.stream.name,
        isLive: es.stream.isLive,
        isPublic: es.stream.isPublic,
        previewMode: es.stream.previewMode,
        addedAt: es.addedAt,
      })),
    };
  }
}
