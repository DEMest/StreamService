import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MediamtxService } from '../mediamtx/mediamtx.service';
import { RecordingService } from '../recording/recording.service';
import { SlotStateService } from './slot-state.service';
import { LAYOUT_PRESETS, isLayoutValidForSlotCount } from './layout-presets';
import { randomBytes } from 'crypto';

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
 *   - пустой slug запрещён (зарезервирован под default Stream орги, создаваемый
 *     админом через admin.createOrg).
 *   - slug не из {@link RESERVED_STREAM_SLUGS} — иначе frontend/backend
 *     не сможет резолвить путь до dynamic-роута Stream'а.
 *   - чисто-числовой slug запрещён: в {@link StreamService.resolvePathToStream}
 *     `live/<org>/<n>` сначала пытается интерпретировать `<n>` как slot, что
 *     перехватит обращение к Stream'у с числовым slug'ом.
 *
 * Кидает BadRequestException при невалидном вводе; иначе возвращает trimmed slug.
 */
export function validateStreamSlug(input: unknown): string {
  if (typeof input !== 'string') {
    throw new BadRequestException('slug is required and must be a string');
  }
  const slug = input.trim();
  if (slug === '') {
    throw new BadRequestException(
      'slug must not be empty (empty slug is reserved for the default Stream)',
    );
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
    throw new BadRequestException(
      'slug must not be purely numeric (conflicts with slot path segments)',
    );
  }
  return slug;
}

export type StreamModeValue = 'composite' | 'multistream';

export interface CreateStreamInput {
  slug: string;
  name?: string;
  description?: string;
  mode?: StreamModeValue;
  slotCount?: number;
}

export interface StreamSlotInput {
  index: number;
  name?: string;
  isAudioSource?: boolean;
}

export interface UpdateStreamConfigInput {
  name?: string;
  description?: string;
  mode?: StreamModeValue;
  slotCount?: number;
  slots?: StreamSlotInput[];
  slotOrder?: number[];
  layoutPreset?: string;
  fallbackLayouts?: Record<number, string> | null;
  isPublic?: boolean;
  previewMode?: string;
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
  mode: true,
  slotCount: true,
  slots: true,
  slotOrder: true,
  layoutPreset: true,
  fallbackLayouts: true,
  isPublic: true,
  previewKey: true,
  previewMode: true,
  previewImagePath: true,
  isLive: true,
  autoStartMode: true,
  ingestKeyCreatedAt: true,
  currentBroadcastId: true,
  createdAt: true,
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
 * Результат парсинга MediaMTX-path в Stream + (опциональный) slot.
 * Возвращается из {@link StreamService.resolvePathToStream}.
 */
export interface ResolvedPath {
  /** Stream из базы (полный row из `prisma.stream.findFirst`). */
  stream: {
    id: string;
    orgId: string;
    slug: string;
    mode: string;
    slotCount: number;
    [k: string]: unknown;
  };
  /**
   * 1..slotCount для multistream Stream'а, когда последний сегмент пути — slot.
   * null для composite Stream'а или multistream Stream'а без slot-сегмента в пути.
   */
  slotIndex: number | null;
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
    @Inject(forwardRef(() => SlotStateService))
    private slotState: SlotStateService,
  ) {}

  async getDefaultStream(orgId: string) {
    const stream = await this.prisma.stream.findUnique({
      where: { orgId_slug: { orgId, slug: '' } },
    });
    if (!stream) throw new NotFoundException('Default Stream not found for org');
    return stream;
  }

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
    // Заменяем passphrase на всех путях Stream'а (для multistream — на каждом из N путей).
    await this.mediamtx.replaceStreamPaths(
      stream.org.slug,
      stream.slug,
      stream.mode as 'composite' | 'multistream',
      stream.slotCount,
      ingestKey,
    );
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

    // Step 5: автоматически привязываем Broadcast к активному Event'у Stream'а,
    // если такой есть. Inline-запрос (а не EventService.findActiveEventForStream)
    // — чтобы избежать circular dep StreamModule ↔ EventModule.
    //
    // Активный = startedAt != null && endedAt == null,
    // и Stream должен быть в EventStream этого Event'а.
    //
    // Без BD-level partial unique на «один активный Event per Stream» возможен
    // edge-case множественных активных — берём первый по startedAt DESC
    // (свежее старее, владелец явно стартанул свежий — он и приоритетный).
    const activeEvent = await this.prisma.event.findFirst({
      where: {
        startedAt: { not: null },
        endedAt: null,
        eventStreams: { some: { streamId } },
      },
      orderBy: { startedAt: 'desc' },
      select: { id: true },
    });

    const broadcast = await this.prisma.broadcast.create({
      data: {
        streamId,
        eventId: activeEvent?.id ?? null,
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
        id: true, slug: true, mode: true, slotCount: true,
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
    const mode = (stream.mode === 'multistream' ? 'multistream' : 'composite') as 'composite' | 'multistream';
    this.recording.onStreamEnded(broadcastId, basePath, mode, stream.slotCount).catch((err) =>
      this.logger.error(`recording onStreamEnded failed for broadcast ${broadcastId}: ${err?.message ?? err}`),
    );

    return { ok: true };
  }

  /**
   * Проверка ingestKey для RTMP publish-auth (SRT идёт через passphrase в самом транспорте).
   *
   * Ключ общий на весь Stream (см. spec §5 «Passphrase / key»);
   * `slotIndex` принимается для логирования и валидации структуры пути:
   *   - slotIndex=null валидно для любого Stream (composite или multistream без слот-сегмента).
   *   - slotIndex≥1 валидно только если Stream — multistream и slotIndex ≤ slotCount.
   *
   * Per-slot ключи — за рамками v1 (см. §15 «Открытые вопросы»),
   * но сигнатура заложена под будущее.
   */
  async verifyIngestKey(
    orgSlug: string,
    streamSlug: string,
    slotIndex: number | null,
    key: string,
  ): Promise<boolean> {
    const stream = await this.prisma.stream.findFirst({
      where: { slug: streamSlug, org: { slug: orgSlug } },
      select: {
        ingestKey: true,
        mode: true,
        slotCount: true,
        org: { select: { isActive: true } },
      },
    });
    if (!stream || !stream.org.isActive) return false;

    if (slotIndex !== null) {
      if (stream.mode !== 'multistream') return false;
      if (slotIndex < 1 || slotIndex > stream.slotCount) return false;
    }

    return stream.ingestKey === key;
  }

  /**
   * Парсит MediaMTX-path и возвращает Stream + slotIndex.
   *
   * Поддерживаемые форматы (spec §5):
   * ```
   *   live/<orgSlug>                          → default Stream, slotIndex=null
   *   live/<orgSlug>/<n>                      → default multistream Stream, slotIndex=N
   *   live/<orgSlug>/<streamSlug>             → named Stream, slotIndex=null
   *   live/<orgSlug>/<streamSlug>/<n>         → named multistream Stream, slotIndex=N
   * ```
   *
   * Логика разрешения неоднозначности «последний сегмент — slot или streamSlug»:
   *   1. Если последний сегмент числовой — сперва пробуем интерпретировать его
   *      как slot поверх предыдущего префикса. Если найден Stream с
   *      mode='multistream' и slotCount ≥ N — возвращаем его + slotIndex=N.
   *   2. Иначе fallback: весь хвост после orgSlug это streamSlug. Это покрывает
   *      экзотический случай Stream'а с числовым slug'ом (`live/<org>/3` где
   *      `slug='3'` и mode='composite').
   *
   * Возвращает `null` если путь не валиден или Stream не найден.
   */
  async resolvePathToStream(path: string): Promise<ResolvedPath | null> {
    const m = path.match(/^live\/(.+)$/);
    if (!m) return null;

    const segments = m[1].split('/').filter((s) => s.length > 0);
    if (segments.length === 0) return null;

    const orgSlug = segments[0];
    const rest = segments.slice(1);

    // Попытка 1: последний сегмент — slot.
    if (rest.length >= 1) {
      const lastSegment = rest[rest.length - 1];
      if (/^\d+$/.test(lastSegment)) {
        const slotCandidate = parseInt(lastSegment, 10);
        const streamSlugCandidate = rest.slice(0, -1).join('/'); // '' для default
        const candidate = await this.findStream(orgSlug, streamSlugCandidate);
        if (
          candidate &&
          candidate.mode === 'multistream' &&
          slotCandidate >= 1 &&
          slotCandidate <= candidate.slotCount
        ) {
          return { stream: candidate, slotIndex: slotCandidate };
        }
        // иначе — fall through к попытке 2
      }
    }

    // Попытка 2: весь rest — streamSlug (пустой → default Stream).
    const streamSlug = rest.join('/');
    const stream = await this.findStream(orgSlug, streamSlug);
    if (!stream) return null;
    return { stream, slotIndex: null };
  }

  /**
   * MediaMTX webhook `publish` / `unpublish` per slot (spec §7 «Lifecycle»).
   *
   * Stream.isLive — агрегат: true если есть хоть один publishing slot.
   * Broadcast создаётся при ПЕРВОМ publishing slot'е и закрывается при ПОСЛЕДНЕМ
   * unpublish. Промежуточные publish/unpublish не трогают Broadcast, только
   * обновляют SlotState — плеер на клиенте получает обновления через WS и
   * адаптирует layout под фактическое число активных slot'ов.
   *
   * Для composite Stream'а (slotIndex=null в path) считаем что это slot 1 —
   * совпадает с инвариантом «composite Stream имеет slotCount=1, slots=[{index:1,...}]».
   */
  async handleWebhook(path: string, action: 'publish' | 'unpublish') {
    const resolved = await this.resolvePathToStream(path);
    if (!resolved) {
      this.logger.warn(`Webhook ${action}: unable to resolve path "${path}"`);
      return;
    }
    const { stream, slotIndex } = resolved;
    const effectiveSlot = slotIndex ?? 1;

    // Per-stream mutex: цепочка Promise'ов гарантирует что одновременные
    // publish/unpublish webhook'и одного Stream'а обрабатываются строго
    // последовательно. Без этого две одновременные publish-нотификации
    // могли читать `wasActive=0` до взаимных setPublishing и создавать
    // двойной Broadcast.
    const previous = this.webhookLocks.get(stream.id) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined) // ошибка предыдущей итерации не должна валить следующую
      .then(() => this.handleWebhookInternal(stream.id, effectiveSlot, action))
      .catch((e) =>
        this.logger.error(
          `webhook handler ${stream.id} (${action}, slot=${effectiveSlot}): ${e?.message ?? e}`,
        ),
      );
    this.webhookLocks.set(stream.id, next);
    try {
      await next;
    } finally {
      if (this.webhookLocks.get(stream.id) === next) {
        this.webhookLocks.delete(stream.id);
      }
    }
  }

  /**
   * Внутренняя реализация webhook handler'а — выполняется под per-stream
   * mutex'ом, см. {@link handleWebhook}.
   */
  private async handleWebhookInternal(
    streamId: string,
    effectiveSlot: number,
    action: 'publish' | 'unpublish',
  ): Promise<void> {
    if (action === 'publish') {
      const wasActive = this.slotState.getActiveSlotIndexes(streamId).length;
      this.slotState.setPublishing(streamId, effectiveSlot, true);
      if (wasActive === 0) {
        await this.startBroadcast(streamId);
      }
    } else {
      this.slotState.setPublishing(streamId, effectiveSlot, false);
      const stillActive = this.slotState.getActiveSlotIndexes(streamId).length;
      if (stillActive === 0) {
        await this.endBroadcast(streamId);
      }
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
   * POST /v1/org/streams — создать новый Stream внутри орги.
   *
   * Slug должен быть непустым и уникальным per orgId (БД-ограничение
   * `@@unique([orgId, slug])`). Default Stream (slug='') создаётся только через
   * admin.createOrg при заведении орги — здесь явно блокируется
   * {@link validateStreamSlug}.
   *
   * Атомарность:
   *   1. Prisma create — генерируется ingestKey, сохраняется row.
   *   2. MediaMTX addStreamPaths.
   *   3. Если шаг 2 упал — Prisma row удаляется, чтобы не оставлять Stream без
   *      MediaMTX-путей (vMix не сможет паблишить и пользователь застрянет).
   *
   * Возможные ошибки:
   *   - BadRequestException — невалидный slug/mode/slotCount.
   *   - ConflictException (409) — slug уже занят в пределах орги (Prisma P2002).
   *   - InternalServerErrorException — MediaMTX упал; Prisma откатилась.
   */
  async createForOrg(orgId: string, input: CreateStreamInput) {
    // 1) Валидация slug.
    const slug = validateStreamSlug(input.slug);

    // 2) mode + slotCount — те же правила что в updateConfig.
    const mode: StreamModeValue = input.mode ?? 'composite';
    if (mode !== 'composite' && mode !== 'multistream') {
      throw new BadRequestException(`Invalid mode "${input.mode}". Allowed: composite, multistream`);
    }

    let slotCount: number;
    if (input.slotCount !== undefined) {
      if (!Number.isInteger(input.slotCount) || input.slotCount < 1 || input.slotCount > 4) {
        throw new BadRequestException('slotCount must be integer in [1, 4]');
      }
      slotCount = input.slotCount;
    } else {
      // composite по умолчанию — 1; multistream без явного slotCount — тоже 1
      // (пользователь должен явно поставить ≥2, чтобы получить multistream).
      slotCount = 1;
    }
    if (mode === 'composite' && slotCount !== 1) {
      throw new BadRequestException('composite mode requires slotCount=1');
    }

    // 3) Резолвим название орги для последующего MediaMTX-вызова до Prisma write,
    //    чтобы избежать orphan row если орга вдруг не существует.
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { slug: true },
    });
    if (!org) throw new NotFoundException('Organization not found');

    const ingestKey = randomBytes(18).toString('base64url');
    const name = input.name ?? slug;
    const slots = Array.from({ length: slotCount }, (_, i) => ({ index: i + 1, name: '' }));
    const slotOrder = Array.from({ length: slotCount }, (_, i) => i + 1);
    const layoutPreset = slotCount === 1 ? 'solo' : 'grid-2x2';

    // 4) Prisma create.
    let created: any;
    try {
      created = await this.prisma.stream.create({
        data: {
          orgId,
          slug,
          name,
          description: input.description,
          mode,
          slotCount,
          slots,
          slotOrder,
          layoutPreset,
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

    // 5) MediaMTX add. При падении — откатываем Prisma (orphan row хуже чем 500).
    try {
      await this.mediamtx.addStreamPaths(org.slug, slug, mode, slotCount, ingestKey);
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
   *   - default Stream (slug='') → 400. Default-стрим удаляется только каскадом
   *     через admin.deleteOrg вместе с орги — это инвариант данных.
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
    if (stream.slug === '') {
      throw new BadRequestException(
        'Default Stream cannot be deleted; it is removed when the organization is deleted',
      );
    }

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
      await this.mediamtx.deleteStreamPaths(
        stream.org.slug,
        stream.slug,
        stream.mode as StreamModeValue,
        stream.slotCount,
      );
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
   * PATCH /v1/org/streams/:id — полная конфигурация Stream'а с валидацией и
   * side-effect'ами в MediaMTX при изменении mode/slotCount.
   *
   * Валидация:
   *   - mode='composite' → slotCount=1
   *   - mode='multistream' → slotCount ∈ [1..4]
   *   - layoutPreset существует и соответствует slotCount
   *   - fallbackLayouts[N] — preset с slotCount=N
   *   - slots[].length === slotCount, indices = 1..slotCount без дубликатов
   *   - slotOrder — перестановка 1..slotCount
   *   - не более одного isAudioSource=true в slots
   *   - previewMode ∈ {multicam, cam1..cam4}
   *   - autoStartMode ∈ {public, test}
   */
  async updateConfig(orgId: string, streamId: string, body: UpdateStreamConfigInput) {
    const current = await this.loadForOrg(orgId, streamId);

    // 1) mode + slotCount — резолвим итоговые значения и валидируем combo.
    const nextMode: StreamModeValue =
      body.mode ?? (current.mode === 'multistream' ? 'multistream' : 'composite');
    if (body.mode !== undefined && body.mode !== 'composite' && body.mode !== 'multistream') {
      throw new BadRequestException(`Invalid mode "${body.mode}". Allowed: composite, multistream`);
    }

    let nextSlotCount: number;
    if (body.slotCount !== undefined) {
      if (!Number.isInteger(body.slotCount) || body.slotCount < 1 || body.slotCount > 4) {
        throw new BadRequestException('slotCount must be integer in [1, 4]');
      }
      nextSlotCount = body.slotCount;
    } else if (body.mode !== undefined && body.mode === 'composite') {
      // Переключение composite без явного slotCount → форсим 1.
      nextSlotCount = 1;
    } else {
      nextSlotCount = current.slotCount;
    }

    if (nextMode === 'composite' && nextSlotCount !== 1) {
      throw new BadRequestException('composite mode requires slotCount=1');
    }
    if (nextMode === 'multistream' && (nextSlotCount < 1 || nextSlotCount > 4)) {
      throw new BadRequestException('multistream mode requires slotCount in [1, 4]');
    }

    // 2) layoutPreset — если задан, должен существовать и соответствовать slotCount.
    if (body.layoutPreset !== undefined) {
      if (!LAYOUT_PRESETS[body.layoutPreset]) {
        throw new BadRequestException(`Unknown layoutPreset "${body.layoutPreset}"`);
      }
      if (!isLayoutValidForSlotCount(body.layoutPreset, nextSlotCount)) {
        throw new BadRequestException(
          `layoutPreset "${body.layoutPreset}" requires slotCount=${LAYOUT_PRESETS[body.layoutPreset].slotCount}, got ${nextSlotCount}`,
        );
      }
    }

    // 3) fallbackLayouts — каждый key=N должен указывать на preset с slotCount=N.
    if (body.fallbackLayouts !== undefined && body.fallbackLayouts !== null) {
      for (const [k, presetId] of Object.entries(body.fallbackLayouts)) {
        const n = Number(k);
        if (!Number.isInteger(n) || n < 1 || n > 4) {
          throw new BadRequestException(`fallbackLayouts key must be integer in [1, 4], got "${k}"`);
        }
        if (typeof presetId !== 'string' || !LAYOUT_PRESETS[presetId]) {
          throw new BadRequestException(`fallbackLayouts[${n}]: unknown preset "${presetId}"`);
        }
        if (!isLayoutValidForSlotCount(presetId, n)) {
          throw new BadRequestException(
            `fallbackLayouts[${n}]: preset "${presetId}" has slotCount=${LAYOUT_PRESETS[presetId].slotCount}`,
          );
        }
      }
    }

    // 4) slots — длина = slotCount, индексы 1..slotCount без дубликатов,
    //    не более одного isAudioSource=true.
    if (body.slots !== undefined) {
      if (!Array.isArray(body.slots) || body.slots.length !== nextSlotCount) {
        throw new BadRequestException(`slots must be array of length ${nextSlotCount}`);
      }
      const seen = new Set<number>();
      let audioCount = 0;
      for (const slot of body.slots) {
        if (!slot || typeof slot !== 'object') {
          throw new BadRequestException('slots[] entries must be objects');
        }
        if (!Number.isInteger(slot.index) || slot.index < 1 || slot.index > nextSlotCount) {
          throw new BadRequestException(`slots[].index must be integer in [1, ${nextSlotCount}]`);
        }
        if (seen.has(slot.index)) {
          throw new BadRequestException(`duplicate slot index ${slot.index}`);
        }
        seen.add(slot.index);
        if (slot.isAudioSource === true) audioCount++;
      }
      if (audioCount > 1) {
        throw new BadRequestException('At most one slot can have isAudioSource=true');
      }
    }

    // 5) slotOrder — перестановка 1..slotCount.
    if (body.slotOrder !== undefined) {
      if (!Array.isArray(body.slotOrder) || body.slotOrder.length !== nextSlotCount) {
        throw new BadRequestException(`slotOrder must be array of length ${nextSlotCount}`);
      }
      const seen = new Set<number>();
      for (const n of body.slotOrder) {
        if (!Number.isInteger(n) || n < 1 || n > nextSlotCount) {
          throw new BadRequestException(`slotOrder values must be integers in [1, ${nextSlotCount}]`);
        }
        if (seen.has(n)) throw new BadRequestException(`duplicate slotOrder value ${n}`);
        seen.add(n);
      }
    }

    if (body.previewMode !== undefined && !VALID_PREVIEW_MODES.includes(body.previewMode)) {
      throw new BadRequestException(
        `Invalid previewMode. Allowed: ${VALID_PREVIEW_MODES.join(', ')}`,
      );
    }
    if (body.autoStartMode !== undefined && body.autoStartMode !== 'public' && body.autoStartMode !== 'test') {
      throw new BadRequestException('autoStartMode must be "public" or "test"');
    }

    // 6) Сборка patch для Prisma.
    const updateData: Record<string, any> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.mode !== undefined) updateData.mode = nextMode;
    if (body.slotCount !== undefined || body.mode !== undefined) updateData.slotCount = nextSlotCount;
    if (body.slots !== undefined) updateData.slots = body.slots as any;
    if (body.slotOrder !== undefined) updateData.slotOrder = body.slotOrder as any;
    if (body.layoutPreset !== undefined) updateData.layoutPreset = body.layoutPreset;
    if (body.fallbackLayouts !== undefined) updateData.fallbackLayouts = body.fallbackLayouts as any;
    if (body.previewMode !== undefined) updateData.previewMode = body.previewMode;
    if (body.autoStartMode !== undefined) updateData.autoStartMode = body.autoStartMode;

    // isPublic c учётом previewKey — переиспользуем логику из updateSettings.
    if (body.isPublic === false) {
      if (!current.previewKey) {
        updateData.previewKey = randomBytes(32).toString('hex');
      }
      updateData.isPublic = false;
    } else if (body.isPublic === true) {
      updateData.previewKey = null;
      updateData.isPublic = true;
    }

    // 7) Применяем patch в БД ПЕРЕД походом в MediaMTX. Если MediaMTX упадёт,
    //    откатим Prisma — БД должна оставаться источником истины.
    //    Иначе сценарий «MediaMTX уже на новой конфигурации, БД нет» приведёт
    //    к тому, что Studio показывает старое состояние, а passphrase/paths —
    //    новые, и vMix не сможет паблишить.
    const oldMode = (current.mode === 'multistream' ? 'multistream' : 'composite') as StreamModeValue;
    const modeOrCountChanged = oldMode !== nextMode || current.slotCount !== nextSlotCount;

    const updated = await this.prisma.stream.update({
      where: { id: streamId },
      data: updateData,
      select: { ...STREAM_DTO_FIELDS, ingestKey: true },
    });

    if (modeOrCountChanged) {
      try {
        await this.mediamtx.updateStreamPaths(
          current.org.slug,
          current.slug,
          oldMode,
          nextMode,
          current.slotCount,
          nextSlotCount,
          current.ingestKey,
        );
      } catch (err: any) {
        // Rollback Prisma — возвращаем mode/slotCount к прежним значениям.
        try {
          await this.prisma.stream.update({
            where: { id: streamId },
            data: { mode: current.mode, slotCount: current.slotCount },
          });
        } catch (rollbackErr: any) {
          this.logger.error(
            `Rollback Prisma after MediaMTX failure FAILED for stream ${streamId}: ${rollbackErr?.message ?? rollbackErr}`,
          );
        }
        this.logger.error(
          `MediaMTX updateStreamPaths failed for stream ${streamId}; Prisma reverted: ${err?.message ?? err}`,
        );
        throw new InternalServerErrorException('Failed to update MediaMTX paths; configuration reverted');
      }
    }

    return this.toDto(updated);
  }

  /**
   * Нормализация row в DTO. ingestKey пропускается, если reveal=false.
   * slots/slotOrder/fallbackLayouts парсятся из Json (Prisma уже даёт JS-объект,
   * но на всякий случай нормализуем тип для фронта).
   */
  private toDto(row: any, reveal = false) {
    const dto: any = {
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      mode: row.mode,
      slotCount: row.slotCount,
      slots: row.slots,
      slotOrder: row.slotOrder,
      layoutPreset: row.layoutPreset,
      fallbackLayouts: row.fallbackLayouts ?? null,
      isPublic: row.isPublic,
      previewKey: row.previewKey,
      previewMode: row.previewMode,
      previewImagePath: row.previewImagePath ?? null,
      isLive: row.isLive,
      autoStartMode: row.autoStartMode,
      ingestKeyCreatedAt: row.ingestKeyCreatedAt,
      currentBroadcastId: row.currentBroadcastId ?? null,
      createdAt: row.createdAt,
    };
    if (reveal && row.ingestKey !== undefined) dto.ingestKey = row.ingestKey;
    return dto;
  }
}
