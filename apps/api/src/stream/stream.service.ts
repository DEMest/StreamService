import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MediamtxService } from '../mediamtx/mediamtx.service';
import { RecordingService } from '../recording/recording.service';
import { ChatService } from '../chat/chat.service';
import { randomBytes } from 'crypto';
import * as sharp from 'sharp';
import { promises as fsPromises } from 'fs';
import { join } from 'path';

const VALID_PREVIEW_MODES = ['multicam', 'cam1', 'cam2', 'cam3', 'cam4'];

const STREAM_SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STREAM_SLUG_MAX_LEN = 32;

/**
 * Слаги, которые конфликтуют с frontend-маршрутами Next.js
 * (`/watch/<orgSlug>/<streamSlug>` vs static `/watch/<orgSlug>/archive`),
 * либо c backend-namespacing'ом (`/api`, `/hls/live/...`). Создание Stream'а
 * с таким slug запретило бы Next.js разрешить путь до dynamic-роута.
 */
const RESERVED_STREAM_SLUGS = new Set([
  'archive',
  'streams',
  'admin',
  'api',
  'hls',
  'live',
  'login',
  'dashboard',
  'organizations',
  'event',
  'events',
  '_next',
  'public',
  'static',
]);

/**
 * Валидация slug для Stream'а (POST /v1/org/streams).
 *
 * Правила:
 *   - длина 1..32
 *   - lowercase letters/digits, разделитель `-` (но не в начале/конце и без двойных)
 *   - пустой slug запрещён.
 *   - slug не из {@link RESERVED_STREAM_SLUGS} — иначе frontend/backend
 *     не сможет резолвить путь до dynamic-роута Stream'а.
 *   - чисто-числовой slug запрещён — во избежание неоднозначных числовых
 *     сегментов в путях (`live/<org>/<n>`) и URL'ах.
 *
 * Кидает BadRequestException при невалидном вводе; иначе возвращает trimmed slug.
 */
export function validateStreamSlug(input: unknown): string {
  if (typeof input !== 'string') {
    throw new BadRequestException('slug is required and must be a string');
  }
  const slug = input.trim();
  if (slug === '') {
    throw new BadRequestException('slug must not be empty');
  }
  if (slug.length > STREAM_SLUG_MAX_LEN) {
    throw new BadRequestException(`slug too long (max ${STREAM_SLUG_MAX_LEN} chars)`);
  }
  if (!STREAM_SLUG_REGEX.test(slug)) {
    throw new BadRequestException(
      'slug must be lowercase alphanumeric with single dashes (e.g. "main", "cam-2")',
    );
  }
  if (RESERVED_STREAM_SLUGS.has(slug)) {
    throw new BadRequestException(
      `slug '${slug}' is reserved (conflicts with frontend/backend routes)`,
    );
  }
  if (/^\d+$/.test(slug)) {
    throw new BadRequestException('slug must not be purely numeric');
  }
  return slug;
}

export interface CreateStreamInput {
  slug: string;
  name?: string;
  description?: string;
}

export interface UpdateStreamConfigInput {
  name?: string;
  description?: string;
  isPublic?: boolean;
  previewMode?: string;
  feedMode?: 'single' | 'composite';
  autoStartMode?: 'public' | 'test';
}

/**
 * Поля, возвращаемые в DTO Stream'а. ingestKey — только при reveal=true.
 */
const STREAM_DTO_FIELDS = {
  id: true,
  slug: true,
  name: true,
  description: true,
  isPublic: true,
  previewKey: true,
  previewMode: true,
  feedMode: true,
  previewImagePath: true,
  isLive: true,
  autoStartMode: true,
  ingestKeyCreatedAt: true,
  currentBroadcastId: true,
  createdAt: true,
  recordingEnabled: true,
  recordingMode: true,
} as const;

/**
 * Путь MediaMTX для Stream'а.
 * Default Stream (slug='') → 'live/<orgSlug>' — сохраняет совместимость с существующими vMix-конфигами.
 * Non-default → 'live/<orgSlug>/<streamSlug>'.
 */
function mediamtxPathForStream(orgSlug: string, streamSlug: string): string {
  return streamSlug === '' ? orgSlug : `${orgSlug}/${streamSlug}`;
}

/**
 * Результат парсинга MediaMTX-path в Stream.
 * Возвращается из {@link StreamService.resolvePathToStream}.
 */
export interface ResolvedPath {
  /** Stream из базы (полный row из `prisma.stream.findFirst`). */
  stream: {
    id: string;
    orgId: string;
    slug: string;
    [k: string]: unknown;
  };
}

@Injectable()
export class StreamService {
  private readonly logger = new Logger(StreamService.name);

  /**
   * Per-streamId mutex для handleWebhook (см. spec §7).
   * Гарантирует последовательную обработку publish/unpublish одного Stream'а —
   * исключает race, когда два webhook'а одновременно читают wasActive=0 и
   * создают двойной Broadcast.
   */
  private readonly webhookLocks = new Map<string, Promise<void>>();

  constructor(
    private prisma: PrismaService,
    private mediamtx: MediamtxService,
    private recording: RecordingService,
    private chatService: ChatService,
  ) {}

  async getStreamWithOrg(streamId: string) {
    const stream = await this.prisma.stream.findUnique({
      where: { id: streamId },
      include: { org: { select: { slug: true } } },
    });
    if (!stream) throw new NotFoundException('Stream not found');
    return stream;
  }

  async rotateKey(streamId: string) {
    const stream = await this.getStreamWithOrg(streamId);
    const ingestKey = randomBytes(18).toString('base64url');
    const updated = await this.prisma.stream.update({
      where: { id: streamId },
      data: { ingestKey, ingestKeyCreatedAt: new Date() },
      select: { id: true, slug: true, ingestKey: true, ingestKeyCreatedAt: true },
    });
    await this.mediamtx.replaceStreamPaths(stream.org.slug, stream.slug, ingestKey);
    return updated;
  }

  async updateSettings(
    streamId: string,
    data: {
      name?: string;
      description?: string;
      isPublic?: boolean;
      autoStartMode?: 'public' | 'test';
      previewMode?: string;
    },
  ) {
    const updateData: Record<string, any> = { ...data };

    if (data.isPublic === false) {
      const cur = await this.prisma.stream.findUnique({
        where: { id: streamId },
        select: { previewKey: true },
      });
      if (!cur?.previewKey) {
        updateData.previewKey = randomBytes(32).toString('hex');
      }
    } else if (data.isPublic === true) {
      updateData.previewKey = null;
    }

    return this.prisma.stream.update({
      where: { id: streamId },
      data: updateData,
      select: {
        id: true, name: true, description: true, isPublic: true, previewKey: true,
        autoStartMode: true, isLive: true, previewMode: true,
      },
    });
  }

  async startBroadcast(streamId: string) {
    const stream = await this.prisma.stream.findUnique({
      where: { id: streamId },
      select: { id: true, name: true, description: true, isLive: true },
    });
    if (!stream) throw new NotFoundException('Stream not found');
    if (stream.isLive) return { alreadyLive: true };

    const broadcast = await this.prisma.broadcast.create({
      data: {
        streamId,
        title: stream.name || 'Трансляция',
        description: stream.description ?? undefined,
        startedAt: new Date(),
      },
    });

    await this.prisma.stream.update({
      where: { id: streamId },
      data: { isLive: true, currentBroadcastId: broadcast.id },
    });

    return { ok: true, broadcastId: broadcast.id };
  }

  async endBroadcast(streamId: string) {
    const stream = await this.prisma.stream.findUnique({
      where: { id: streamId },
      select: {
        id: true, slug: true,
        isLive: true, currentBroadcastId: true,
        org: { select: { slug: true } },
      },
    });
    if (!stream || !stream.isLive || !stream.currentBroadcastId) return { alreadyOff: true };

    const broadcastId = stream.currentBroadcastId;
    await this.prisma.broadcast.update({ where: { id: broadcastId }, data: { endedAt: new Date() } });
    await this.prisma.stream.update({
      where: { id: streamId },
      data: { isLive: false, currentBroadcastId: null },
    });

    const basePath = mediamtxPathForStream(stream.org.slug, stream.slug);
    this.recording.onStreamEnded(broadcastId, basePath).catch((err) =>
      this.logger.error(`recording onStreamEnded failed for broadcast ${broadcastId}: ${err?.message ?? err}`),
    );

    return { ok: true };
  }

  /**
   * Проверка ingestKey для RTMP publish-auth (SRT идёт через passphrase в самом транспорте).
   */
  async verifyIngestKey(orgSlug: string, streamSlug: string, key: string): Promise<boolean> {
    const stream = await this.prisma.stream.findFirst({
      where: { slug: streamSlug, org: { slug: orgSlug } },
      select: { ingestKey: true, org: { select: { isActive: true } } },
    });
    if (!stream || !stream.org.isActive) return false;
    return stream.ingestKey === key;
  }

  /**
   * Парсит MediaMTX-path и возвращает Stream.
   *
   * Поддерживаемые форматы:
   * ```
   *   live/<orgSlug>                → default Stream
   *   live/<orgSlug>/<streamSlug>   → named Stream
   * ```
   *
   * Возвращает `null` если путь не валиден или Stream не найден.
   */
  async resolvePathToStream(path: string): Promise<ResolvedPath | null> {
    const m = path.match(/^live\/(.+)$/);
    if (!m) return null;
    const segments = m[1].split('/').filter((s) => s.length > 0);
    if (segments.length === 0) return null;
    const orgSlug = segments[0];
    const streamSlug = segments.slice(1).join('/'); // '' = default
    const stream = await this.findStream(orgSlug, streamSlug);
    return stream ? { stream } : null;
  }

  /**
   * MediaMTX webhook `publish` / `unpublish`.
   *
   * publish → ensureAutoRecording + startBroadcast (идемпотентен через isLive guard).
   * unpublish → endBroadcast (идемпотентен через alreadyOff guard).
   *
   * Per-stream mutex гарантирует последовательную обработку concurrent webhook'ов.
   */
  async handleWebhook(path: string, action: 'publish' | 'unpublish') {
    const resolved = await this.resolvePathToStream(path);
    if (!resolved) { this.logger.warn(`Webhook ${action}: unable to resolve path "${path}"`); return; }
    const streamId = resolved.stream.id;
    const previous = this.webhookLocks.get(streamId) ?? Promise.resolve();
    const next = previous.catch(() => undefined)
      .then(() => this.handleWebhookInternal(streamId, action))
      .catch((e) => this.logger.error(`webhook handler ${streamId} (${action}): ${e?.message ?? e}`));
    this.webhookLocks.set(streamId, next);
    try { await next; } finally { if (this.webhookLocks.get(streamId) === next) this.webhookLocks.delete(streamId); }
  }

  /**
   * Внутренняя реализация webhook handler'а — выполняется под per-stream mutex'ом.
   */
  private async handleWebhookInternal(streamId: string, action: 'publish' | 'unpublish'): Promise<void> {
    if (action === 'publish') {
      await this.ensureAutoRecording(streamId);
      await this.startBroadcast(streamId); // идемпотентен (isLive guard)
    } else {
      await this.endBroadcast(streamId);   // идемпотентен (alreadyOff guard)
    }
  }

  /**
   * Если у Stream'а recordingMode='auto' и запись сейчас выключена — включить
   * (patch MediaMTX + update БД). Вызывается из handleWebhookInternal при
   * первом publishing slot'е, до startBroadcast. На manual — no-op.
   *
   * Любые ошибки на этом шаге логируются, но не прерывают цепочку — broadcast
   * должен открыться даже если MediaMTX не ответил на patch.
   */
  private async ensureAutoRecording(streamId: string): Promise<void> {
    try {
      const s = await this.prisma.stream.findUnique({
        where: { id: streamId },
        select: {
          slug: true,
          recordingEnabled: true,
          recordingMode: true,
          org: { select: { slug: true } },
        },
      });
      if (!s) return;
      if (s.recordingMode !== 'auto') return;
      if (s.recordingEnabled) return;
      await this.mediamtx.setStreamRecording(s.org.slug, s.slug, true);
      await this.prisma.stream.update({
        where: { id: streamId },
        data: { recordingEnabled: true },
      });
    } catch (e: any) {
      this.logger.warn(
        `ensureAutoRecording failed for ${streamId}: ${e?.message ?? e}`,
      );
    }
  }

  private async findStream(orgSlug: string, streamSlug: string) {
    return this.prisma.stream.findFirst({
      where: { slug: streamSlug, org: { slug: orgSlug } },
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Per-Stream API helpers (Step 3) — tenant-scoped lookups + DTO + config PATCH.
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Список Stream'ов орги в форме DTO. Step 3 — возвращает все Stream'ы орги
   * (на практике пока только default; Step 4 разрешит создание дополнительных).
   * ingestKey не включается в листинг — только в GET /:id?reveal=true.
   */
  async listForOrg(orgId: string) {
    const rows = await this.prisma.stream.findMany({
      where: { orgId },
      orderBy: [{ slug: 'asc' }, { createdAt: 'asc' }],
      select: STREAM_DTO_FIELDS,
    });
    return rows.map((r) => this.toDto(r));
  }

  /**
   * Получить Stream по id с проверкой принадлежности орге.
   * Cross-tenant → 404 (не палим существование).
   * reveal=true — возвращает ingestKey в DTO.
   */
  async getByIdForOrg(orgId: string, streamId: string, reveal = false) {
    const stream = await this.prisma.stream.findFirst({
      where: { id: streamId, orgId },
      select: { ...STREAM_DTO_FIELDS, ingestKey: true },
    });
    if (!stream) throw new NotFoundException('Stream not found');
    return this.toDto(stream, reveal);
  }

  /**
   * Список завершённых Broadcast'ов Stream'а (tenant-scoped). Cross-tenant → 404.
   * Shape совпадает с PublicService.getOrgBroadcasts: recording (singular) вместо recordings[].
   */
  async listBroadcastsForOrg(orgId: string, streamId: string) {
    await this.loadForOrg(orgId, streamId); // 404 если чужой/не существует
    const broadcasts = await this.prisma.broadcast.findMany({
      where: { streamId, endedAt: { not: null } },
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        title: true,
        description: true,
        startedAt: true,
        endedAt: true,
        recordings: {
          where: { slotIndex: 1 },
          select: { id: true, status: true, fileSize: true, duration: true },
          take: 1,
        },
      },
    });
    return broadcasts.map(({ recordings, ...rest }) => ({
      ...rest,
      recording: recordings[0] ?? null,
    }));
  }

  /**
   * Загружает Stream и проверяет принадлежность орге.
   * Возвращает row или бросает 404. Используется side-effect методами.
   */
  private async loadForOrg(orgId: string, streamId: string) {
    const stream = await this.prisma.stream.findFirst({
      where: { id: streamId, orgId },
      include: { org: { select: { slug: true } } },
    });
    if (!stream) throw new NotFoundException('Stream not found');
    return stream;
  }

  /**
   * Rotate-key с проверкой tenant. Cross-tenant → 404.
   */
  async rotateKeyForOrg(orgId: string, streamId: string) {
    await this.loadForOrg(orgId, streamId);
    return this.rotateKey(streamId);
  }

  /**
   * Принудительно завершить активный Broadcast Stream'а. MediaMTX push не останавливаем —
   * только закрываем Broadcast и сбрасываем isLive. Если Stream не live → {alreadyOff:true}.
   * Cross-tenant → 404.
   */
  async forceStop(orgId: string, streamId: string) {
    await this.loadForOrg(orgId, streamId);
    return this.endBroadcast(streamId);
  }

  /**
   * Управление записью Stream'а. Опции независимы:
   *   - enabled: переключает текущее состояние записи (patches MediaMTX paths)
   *   - mode: 'auto' | 'manual' — политика автостарта при publish (см. handleWebhook)
   *
   * Source of truth — БД (recordingEnabled, recordingMode). MediaMTX `record`
   * патчится только когда передан enabled. Cross-tenant → 404.
   */
  async setRecording(
    orgId: string,
    streamId: string,
    body: { enabled?: boolean; mode?: 'auto' | 'manual' },
  ) {
    const stream = await this.loadForOrg(orgId, streamId);
    if (body.mode && body.mode !== 'auto' && body.mode !== 'manual') {
      throw new BadRequestException(`Invalid recordingMode: ${body.mode}`);
    }
    if (typeof body.enabled === 'boolean') {
      const org = await this.prisma.organization.findUniqueOrThrow({
        where: { id: stream.orgId },
        select: { slug: true },
      });
      await this.mediamtx.setStreamRecording(org.slug, stream.slug, body.enabled);
    }
    const patch: Record<string, unknown> = {};
    if (typeof body.enabled === 'boolean') patch.recordingEnabled = body.enabled;
    if (body.mode) patch.recordingMode = body.mode;
    const updated = Object.keys(patch).length
      ? await this.prisma.stream.update({ where: { id: streamId }, data: patch })
      : stream;
    return this.toDto(updated);
  }

  /**
   * POST /v1/org/streams — создать новый Stream внутри орги.
   *
   * Slug должен быть непустым и уникальным per orgId (БД-ограничение
   * `@@unique([orgId, slug])`) — пустой slug блокируется
   * {@link validateStreamSlug}.
   *
   * Атомарность:
   *   1. Prisma create — генерируется ingestKey, сохраняется row.
   *   2. MediaMTX addStreamPaths.
   *   3. Если шаг 2 упал — Prisma row удаляется, чтобы не оставлять Stream без
   *      MediaMTX-путей (vMix не сможет паблишить и пользователь застрянет).
   *
   * Возможные ошибки:
   *   - BadRequestException — невалидный slug.
   *   - ConflictException (409) — slug уже занят в пределах орги (Prisma P2002).
   *   - InternalServerErrorException — MediaMTX упал; Prisma откатилась.
   */
  async createForOrg(orgId: string, input: CreateStreamInput) {
    // 1) Валидация slug.
    const slug = validateStreamSlug(input.slug);

    // 2) Резолвим название орги для последующего MediaMTX-вызова до Prisma write,
    //    чтобы избежать orphan row если орга вдруг не существует.
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { slug: true },
    });
    if (!org) throw new NotFoundException('Organization not found');

    const ingestKey = randomBytes(18).toString('base64url');
    const name = input.name ?? slug;

    // 3) Prisma create.
    let created: any;
    try {
      created = await this.prisma.stream.create({
        data: {
          orgId,
          slug,
          name,
          description: input.description,
          ingestKey,
          isPublic: true,
          previewMode: 'multicam',
          autoStartMode: 'public',
        },
        select: { ...STREAM_DTO_FIELDS, ingestKey: true },
      });
    } catch (e: any) {
      if (e.code === 'P2002') {
        throw new ConflictException(`Stream slug '${slug}' already taken in this organization`);
      }
      throw e;
    }

    // 4) MediaMTX add. При падении — откатываем Prisma (orphan row хуже чем 500).
    try {
      await this.mediamtx.addStreamPaths(org.slug, slug, ingestKey);
    } catch (err: any) {
      try {
        await this.prisma.stream.delete({ where: { id: created.id } });
      } catch (rollbackErr: any) {
        this.logger.error(
          `Rollback Prisma after MediaMTX addStreamPaths failure FAILED for stream ${created.id}: ${rollbackErr?.message ?? rollbackErr}`,
        );
      }
      this.logger.error(
        `MediaMTX addStreamPaths failed for new stream ${created.id} (${org.slug}/${slug}); Prisma reverted: ${err?.message ?? err}`,
      );
      throw new InternalServerErrorException('Failed to register MediaMTX paths; stream creation reverted');
    }

    // Без reveal — DTO без ingestKey (как list).
    return this.toDto(created);
  }

  /**
   * DELETE /v1/org/streams/:id — удалить Stream орги.
   *
   * Защиты:
   *   - cross-tenant → 404 ({@link loadForOrg}).
   *
   * Атомарность:
   *   1. MediaMTX deleteStreamPaths (best-effort, идемпотентно).
   *      Если упал — log warn, но продолжаем. Оставлять Prisma row при удалённых
   *      MediaMTX-путях гораздо хуже: vMix не сможет паблишить, а Studio будет
   *      показывать «живой» Stream.
   *   2. Prisma delete (каскад на Broadcast → Recording через onDelete:Cascade).
   *
   * Возвращает `{ ok: true }`.
   */
  async deleteForOrg(orgId: string, streamId: string) {
    const stream = await this.loadForOrg(orgId, streamId);

    // Не удаляем Stream пока он в live-режиме: иначе на лету пропадут
    // MediaMTX-пути под активным publish'ем (vMix получит ошибку), а зрители
    // увидят чёрный экран без feedback'а. Owner должен явно остановить
    // Broadcast (`POST /v1/org/streams/:id/stop`) — это закроет recording'и
    // и SlotState, и только после этого DELETE безопасен.
    if (stream.isLive || stream.currentBroadcastId) {
      throw new ConflictException(
        'Stream is currently live. Stop the broadcast first before deleting.',
      );
    }

    // 1) MediaMTX delete — best-effort.
    try {
      await this.mediamtx.deleteStreamPaths(stream.org.slug, stream.slug);
    } catch (err: any) {
      this.logger.warn(
        `MediaMTX deleteStreamPaths failed for stream ${streamId} (${stream.org.slug}/${stream.slug}); continuing with Prisma delete: ${err?.message ?? err}`,
      );
    }

    // 2) Prisma delete. Broadcast'ы Stream'а удалятся через onDelete:Cascade,
    //    Recording'и — через каскад от Broadcast.
    await this.prisma.stream.delete({ where: { id: streamId } });
    return { ok: true };
  }

  /**
   * PATCH /v1/org/streams/:id — обновление конфигурации Stream'а.
   *
   * Поддерживает: name, description, previewMode, autoStartMode, isPublic.
   * При isPublic=false генерирует previewKey если его ещё нет.
   * При isPublic=true обнуляет previewKey.
   */
  async updateConfig(orgId: string, streamId: string, body: UpdateStreamConfigInput) {
    const current = await this.loadForOrg(orgId, streamId);

    if (body.previewMode !== undefined && !VALID_PREVIEW_MODES.includes(body.previewMode)) {
      throw new BadRequestException(
        `Invalid previewMode. Allowed: ${VALID_PREVIEW_MODES.join(', ')}`,
      );
    }
    if (body.feedMode !== undefined && body.feedMode !== 'single' && body.feedMode !== 'composite') {
      throw new BadRequestException('feedMode must be "single" or "composite"');
    }
    if (body.autoStartMode !== undefined && body.autoStartMode !== 'public' && body.autoStartMode !== 'test') {
      throw new BadRequestException('autoStartMode must be "public" or "test"');
    }

    const updateData: Record<string, any> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.previewMode !== undefined) updateData.previewMode = body.previewMode;
    if (body.feedMode !== undefined) updateData.feedMode = body.feedMode;
    if (body.autoStartMode !== undefined) updateData.autoStartMode = body.autoStartMode;

    if (body.isPublic === false) {
      if (!current.previewKey) {
        updateData.previewKey = randomBytes(32).toString('hex');
      }
      updateData.isPublic = false;
    } else if (body.isPublic === true) {
      updateData.previewKey = null;
      updateData.isPublic = true;
    }

    const updated = await this.prisma.stream.update({
      where: { id: streamId },
      data: updateData,
      select: { ...STREAM_DTO_FIELDS, ingestKey: true },
    });

    return this.toDto(updated);
  }

  private getPreviewUploadsDir(): string {
    return join(process.cwd(), 'uploads', 'previews');
  }

  /**
   * Загрузка статичного превью Stream'а (показывается когда Stream offline).
   * Файл именуется по Stream.id (не по slug — slug можно поменять переименованием,
   * id стабилен). Cross-tenant → 404.
   */
  async uploadPreviewForOrg(orgId: string, streamId: string, fileBuffer: Buffer): Promise<{ ok: true; previewImagePath: string }> {
    await this.loadForOrg(orgId, streamId);
    const dir = this.getPreviewUploadsDir();
    await fsPromises.mkdir(dir, { recursive: true });

    const filename = `${streamId}.jpg`;
    const filePath = join(dir, filename);

    await sharp(fileBuffer)
      .resize(640, 360, { fit: 'cover' })
      .jpeg({ quality: 80 })
      .toFile(filePath);

    const relativePath = `previews/${filename}`;
    await this.prisma.stream.update({
      where: { id: streamId },
      data: { previewImagePath: relativePath },
    });

    return { ok: true, previewImagePath: relativePath };
  }

  async deletePreviewForOrg(orgId: string, streamId: string): Promise<{ ok: true }> {
    await this.loadForOrg(orgId, streamId);
    const filePath = join(this.getPreviewUploadsDir(), `${streamId}.jpg`);
    await fsPromises.unlink(filePath).catch(() => {});
    await this.prisma.stream.update({
      where: { id: streamId },
      data: { previewImagePath: null },
    });
    return { ok: true };
  }

  /**
   * Очистить чат конкретного Stream'а. Cross-tenant → 404.
   */
  async clearChatForOrg(orgId: string, streamId: string) {
    await this.loadForOrg(orgId, streamId);
    return this.chatService.clearMessagesByStream(streamId);
  }

  /**
   * Нормализация row в DTO. ingestKey пропускается, если reveal=false.
   */
  private toDto(row: any, reveal = false) {
    const dto: any = {
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      isPublic: row.isPublic,
      previewKey: row.previewKey,
      previewMode: row.previewMode,
      feedMode: row.feedMode,
      previewImagePath: row.previewImagePath ?? null,
      isLive: row.isLive,
      recordingEnabled: row.recordingEnabled,
      recordingMode: row.recordingMode,
      autoStartMode: row.autoStartMode,
      ingestKeyCreatedAt: row.ingestKeyCreatedAt,
      currentBroadcastId: row.currentBroadcastId ?? null,
      createdAt: row.createdAt,
    };
    if (reveal && row.ingestKey !== undefined) dto.ingestKey = row.ingestKey;
    return dto;
  }
}
