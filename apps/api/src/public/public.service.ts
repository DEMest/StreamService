import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ThumbnailService } from '../thumbnail/thumbnail.service';
import { SlotStateService } from '../stream/slot-state.service';
import { promises as fs } from 'fs';
import { join } from 'path';

/**
 * Один slot в DTO Stream'а для viewer'а.
 */
export interface PublicSlotDto {
  index: number;
  name: string;
  isAudioSource?: boolean;
}

/**
 * Pair {slotIndex, url} для каждого HLS feed'а.
 * composite — массив длины 1 с slotIndex=1.
 * multistream — массив длины N (по числу slot'ов в Stream'е),
 * по одному URL на каждый slot.
 */
export interface PublicHlsUrl {
  slotIndex: number;
  url: string;
}

/**
 * DTO `/v1/public/orgs/:orgSlug/stream` для viewer'а.
 *
 * Содержит достаточно конфига чтобы:
 *  - инициализировать MatPlayer (mode/slotCount/slots/layoutPreset/fallbackLayouts);
 *  - подключить HLS feed'ы (hlsUrls);
 *  - отрисовать ViewSwitcher и адаптивную раскладку (slots/slotOrder/activeSlotIndexes).
 *
 * `activeSlotIndexes` — snapshot текущих publishing slot'ов. Для live-обновлений
 * клиент должен поллить этот endpoint (refetchInterval) — отдельный WS namespace
 * не вводим в Step 3 (см. tаску C4 §2 — поллинг проще для viewers).
 */
export interface PublicStreamDto {
  mode: 'composite' | 'multistream';
  slotCount: number;
  slots: PublicSlotDto[];
  slotOrder: number[];
  layoutPreset: string;
  fallbackLayouts: Record<number, string> | null;
  hlsUrls: PublicHlsUrl[];
  activeSlotIndexes: number[];
}

/**
 * Нормализация streamSlug: undefined/null/'' → '' (= default Stream орги).
 * Используется на каждой точке входа в Service-методы, которые принимают
 * опциональный streamSlug. Гарантирует backward-compat: все «классические»
 * вызовы без streamSlug продолжают резолвиться на default Stream.
 */
function normalizeStreamSlug(streamSlug?: string | null): string {
  return streamSlug ?? '';
}

/**
 * Префикс URL для public-endpoint'ов, зависящий от streamSlug:
 *   default ('') → '/api/v1/public/orgs/<orgSlug>'
 *   named (foo)  → '/api/v1/public/orgs/<orgSlug>/streams/<streamSlug>'
 *
 * Этот префикс используется как для HLS-URL'ов, так и в RecordingController:
 * URL'ы, которые формирует Service, ОБЯЗАНЫ совпадать с теми маршрутами,
 * которые регистрирует Recording/Public controller под named Stream.
 */
function publicUrlPrefix(orgSlug: string, streamSlug: string): string {
  return streamSlug === ''
    ? `/api/v1/public/orgs/${orgSlug}`
    : `/api/v1/public/orgs/${orgSlug}/streams/${streamSlug}`;
}

@Injectable()
export class PublicService {
  constructor(
    private prisma: PrismaService,
    private thumbnail: ThumbnailService,
    private slotState: SlotStateService,
  ) {}

  /**
   * Каталог Stream'ов + Event'ов (Step 5, spec §12 «Viewer UX Catalog»).
   *
   * Логика:
   *   1. Активные Event'ы (startedAt != null && endedAt == null) активных орг.
   *      Загружаем связанные Stream'ы (через EventStream), фильтруя
   *      isPublic=true + isLive=true.
   *   2. Если Event имеет >=2 live+public Stream'ов → отдельная Event-карточка
   *      (`type: 'event'`); Stream'ы такого Event'а НЕ попадают в каталог как
   *      standalone-stream'ы.
   *   3. Все остальные публичные Stream'ы (включая Stream'ы из Event'ов с
   *      <2 live-stream'ов) — стандартные stream-карточки (`type: 'stream'`).
   *
   * Сортировка:
   *   - Event-карточки сначала, по startedAt DESC (свежие сверху).
   *   - Затем stream-карточки: сначала live, потом по createdAt DESC
   *     (как в Step 4).
   *
   * Приватные Stream'ы (isPublic=false) не появляются ни в Event-карточке,
   * ни в standalone — они доступны только по previewKey-ссылке (Karen C3
   * из Step 4 + spec §12).
   */
  async getCatalog() {
    // 1. Загружаем активные Event'ы вместе с их Stream'ами (только публичные).
    //    Используем include с фильтром на Stream — приватные Stream'ы Event'а
    //    в каталоге не должны светиться (spec §12 + Karen C3).
    const activeEvents = await this.prisma.event.findMany({
      where: {
        startedAt: { not: null },
        endedAt: null,
        org: { isActive: true },
      },
      orderBy: { startedAt: 'desc' },
      select: {
        slug: true,
        title: true,
        startedAt: true,
        org: { select: { slug: true, name: true } },
        eventStreams: {
          select: {
            stream: {
              select: {
                id: true,
                slug: true,
                name: true,
                isLive: true,
                isPublic: true,
                previewMode: true,
                previewImagePath: true,
              },
            },
          },
        },
      },
    });

    // 2. Загружаем все публичные Stream'ы активных орг (без фильтра по live —
    //    каталог показывает и offline Stream'ы).
    const streams = await this.prisma.stream.findMany({
      where: { org: { isActive: true }, isPublic: true },
      select: {
        id: true,
        slug: true,
        name: true,
        isLive: true,
        previewMode: true,
        previewImagePath: true,
        createdAt: true,
        org: { select: { slug: true, name: true } },
      },
    });

    // 3. Формируем Event-карточки и собираем set streamId, которые «съедены»
    //    Event-карточками (>=2 live-public stream'ов).
    //
    //    Karen H2 (Step 5): consumedStreamIds должен включать ВСЕ public
    //    Stream'ы Event'а (live + offline), а не только live. Иначе offline-
    //    Stream Event'а появляется в каталоге как standalone — duplicate UX.
    //
    //    Karen H3: Event-карточка несёт `consumedStreams[]` (DTO как у stream-
    //    карточек) — это нужно архиву, чтобы запросить broadcasts тех Stream'ов,
    //    которые в каталоге спрятаны Event-карточкой.
    type StreamCardDto = {
      type: 'stream';
      orgSlug: string;
      orgName: string;
      streamSlug: string;
      streamName: string;
      isLive: boolean;
      previewMode: string;
      hasCustomPreview: boolean;
    };
    const eventCards: Array<{
      type: 'event';
      orgSlug: string;
      orgName: string;
      eventSlug: string;
      eventTitle: string;
      streamSlugs: string[];
      previewMode: string;
      startedAt: Date;
      consumedStreams: StreamCardDto[];
    }> = [];
    const consumedStreamIds = new Set<string>();

    for (const ev of activeEvents) {
      const publicStreams = ev.eventStreams
        .map((es) => es.stream)
        .filter((s) => s.isPublic);
      const liveStreams = publicStreams.filter((s) => s.isLive);
      // Порог Event-карточки остаётся «>=2 live+public» — иначе картинка-карточка
      // получится пустой. Но «съедание» теперь шире (см. ниже).
      if (liveStreams.length < 2) continue;

      // Все public Stream'ы Event'а «съедаются» — и live, и offline. Так
      // offline Stream'ы Event'а не светятся standalone (Karen H2). Архив
      // получит их через consumedStreams отдельным списком.
      for (const s of publicStreams) consumedStreamIds.add(s.id);

      // consumedStreams[] для архива: тот же DTO, что у standalone stream-карточек.
      // Берём из items массива `streams` (orgName уже там), чтобы не дублировать
      // поиск; если каких-то public Stream'ов Event'а в `streams` нет (например,
      // их орга отфильтрована isActive=false — но мы УЖЕ отфильтровали event.findMany
      // по org.isActive=true, так что это не должно встречаться), пропускаем.
      const streamsById = new Map(streams.map((s) => [s.id, s]));
      const consumedStreams: StreamCardDto[] = publicStreams
        .map((es) => streamsById.get(es.id))
        .filter((s): s is NonNullable<typeof s> => !!s)
        .map((s) => ({
          type: 'stream' as const,
          orgSlug: s.org.slug,
          orgName: s.org.name,
          streamSlug: s.slug,
          streamName: s.name,
          isLive: s.isLive,
          previewMode: s.previewMode,
          hasCustomPreview: !!s.previewImagePath,
        }));

      // previewMode карточки — берём с первого Stream'а в порядке EventStream
      // (proxy для «главного» Stream'а). Альтернативой был бы поля на Event,
      // но в Step 5 их нет — это допустимое упрощение.
      eventCards.push({
        type: 'event',
        orgSlug: ev.org.slug,
        orgName: ev.org.name,
        eventSlug: ev.slug,
        eventTitle: ev.title,
        streamSlugs: liveStreams.map((s) => s.slug),
        previewMode: liveStreams[0].previewMode,
        startedAt: ev.startedAt!,
        consumedStreams,
      });
    }

    // 4. Stream-карточки: те, что не «съедены» Event'ами.
    const streamCards = streams
      .filter((s) => !consumedStreamIds.has(s.id))
      .map((s) => ({
        type: 'stream' as const,
        orgSlug: s.org.slug,
        orgName: s.org.name,
        streamSlug: s.slug,
        streamName: s.name,
        isLive: s.isLive,
        previewMode: s.previewMode,
        hasCustomPreview: !!s.previewImagePath,
        createdAt: s.createdAt,
      }));

    // 5. Стабильная сортировка stream-карточек: сначала live, потом createdAt DESC.
    streamCards.sort((a, b) => {
      if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    // 6. Объединяем: Event-карточки уже отсортированы по startedAt DESC из Prisma.
    //    DTO: убираем технические поля (createdAt, startedAt) — фронту они не нужны.
    return [
      ...eventCards.map((c) => ({
        type: c.type,
        orgSlug: c.orgSlug,
        orgName: c.orgName,
        eventSlug: c.eventSlug,
        eventTitle: c.eventTitle,
        streamSlugs: c.streamSlugs,
        previewMode: c.previewMode,
        consumedStreams: c.consumedStreams,
      })),
      ...streamCards.map((c) => ({
        type: c.type,
        orgSlug: c.orgSlug,
        orgName: c.orgName,
        streamSlug: c.streamSlug,
        streamName: c.streamName,
        isLive: c.isLive,
        previewMode: c.previewMode,
        hasCustomPreview: c.hasCustomPreview,
      })),
    ];
  }

  /**
   * GET /v1/public/orgs/:orgSlug/events/:eventSlug — landing-страница Event'а.
   *
   * Возвращает Event-метаданные + список привязанных публичных Stream'ов
   * (включая offline — viewer всё равно увидит «Stream X не в эфире»).
   * Приватные Stream'ы в landing'е не показываем (Karen C3 — приватный
   * Stream доступен только по previewKey).
   *
   * Не делаем ограничений по startedAt/endedAt — landing должен открываться
   * и для scheduled, и для ended Event'ов (в UX-flow viewer'а ссылка может
   * прийти раньше старта или быть кэширована после конца).
   *
   * 404 — если орги нет / неактивна / Event'а с таким slug в орге нет.
   */
  async getEventLanding(orgSlug: string, eventSlug: string) {
    const event = await this.prisma.event.findFirst({
      where: {
        slug: eventSlug,
        org: { slug: orgSlug, isActive: true },
      },
      select: {
        slug: true,
        title: true,
        description: true,
        scheduledAt: true,
        startedAt: true,
        endedAt: true,
        org: { select: { slug: true, name: true } },
        eventStreams: {
          // Приватные Stream'ы в landing'е не светим — относим к «нет доступа».
          where: { stream: { isPublic: true } },
          orderBy: { addedAt: 'asc' },
          select: {
            stream: {
              select: {
                slug: true,
                name: true,
                isLive: true,
                previewMode: true,
                previewImagePath: true,
              },
            },
          },
        },
      },
    });
    if (!event) throw new NotFoundException('Event not found');

    return {
      orgSlug: event.org.slug,
      orgName: event.org.name,
      eventSlug: event.slug,
      title: event.title,
      description: event.description,
      scheduledAt: event.scheduledAt,
      startedAt: event.startedAt,
      endedAt: event.endedAt,
      streams: event.eventStreams.map((es) => ({
        slug: es.stream.slug,
        name: es.stream.name,
        isLive: es.stream.isLive,
        previewMode: es.stream.previewMode,
        hasCustomPreview: !!es.stream.previewImagePath,
      })),
    };
  }

  /**
   * Thumbnail для Stream'а. Для default Stream'а — backward-compat
   * (streamSlug опционален, поведение идентично).
   *
   * Для named Stream'а HLS path — `/hls/live/<orgSlug>/<streamSlug>/hd/...`.
   * ThumbnailService построит правильный путь по композитному ключу `<orgSlug>[/<streamSlug>]`.
   */
  async getThumbnail(
    orgSlug: string,
    streamSlug?: string,
  ): Promise<{ buffer: Buffer; maxAge: number }> {
    const sSlug = normalizeStreamSlug(streamSlug);
    const stream = await this.prisma.stream.findFirst({
      where: { slug: sSlug, org: { slug: orgSlug, isActive: true } },
      select: { isLive: true, previewMode: true, previewImagePath: true },
    });
    if (!stream) throw new NotFoundException('Stream not found');

    if (stream.isLive) {
      // Для default Stream'а — ключ '<orgSlug>' (backward-compat с ThumbnailService).
      // Для named — '<orgSlug>/<streamSlug>' (формирует /hls/live/<orgSlug>/<streamSlug>/hd/...).
      const snapshotKey = sSlug === '' ? orgSlug : `${orgSlug}/${sSlug}`;
      const buf = await this.thumbnail.getSnapshot(snapshotKey, stream.previewMode);
      if (!buf) throw new NotFoundException('Snapshot not available');
      return { buffer: buf, maxAge: 30 };
    }

    if (stream.previewImagePath) {
      const filePath = join(process.cwd(), 'uploads', stream.previewImagePath);
      const buf = await fs.readFile(filePath).catch(() => null);
      if (!buf) throw new NotFoundException('Preview image not found');
      return { buffer: buf, maxAge: 300 };
    }

    throw new NotFoundException('No preview available');
  }

  /**
   * Метаданные Stream'а для watch-страницы. streamSlug опционален:
   *   undefined / '' → default Stream орги (backward-compat);
   *   иначе          → named Stream.
   *
   * 404 — если orgi нет / неактивна / Stream'а с таким streamSlug нет.
   * Приватный Stream без правильного key → возвращается «заглушка» с
   * accessDenied=true (НЕ 404, чтобы фронт мог показать UX «введите ключ»).
   *
   * Step 5: дополнительно возвращает `currentEvent` — активный Event Stream'а
   * (startedAt != null && endedAt == null), если Stream привязан. Используется
   * фронтом для отображения breadcrumb «← K событию» в WatchView. Если Stream
   * не в активном Event'е — `currentEvent: null`.
   */
  async getOrgWatch(orgSlug: string, streamSlug?: string, key?: string) {
    const sSlug = normalizeStreamSlug(streamSlug);
    const stream = await this.prisma.stream.findFirst({
      where: { slug: sSlug, org: { slug: orgSlug, isActive: true } },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        isLive: true,
        isPublic: true,
        previewKey: true,
        org: { select: { slug: true, name: true, description: true } },
      },
    });
    if (!stream) throw new NotFoundException('Stream not found');

    if (!stream.isPublic && stream.previewKey !== key) {
      return {
        slug: stream.org.slug,
        name: stream.org.name,
        streamSlug: stream.slug,
        isLive: false,
        streamTitle: '',
        streamDescription: null,
        streamIsPublic: false,
        currentEvent: null,
        accessDenied: true,
      };
    }

    // Активный Event Stream'а: startedAt != null && endedAt == null,
    // Stream в EventStream этого Event'а. Инвариант (см. EventService) — не
    // более одного активного Event'а на Stream одновременно.
    //
    // Karen H4: orderBy startedAt DESC — синхронизирован с EventService.findActiveEventForStream
    // и StreamService.startBroadcast (свежее старее = приоритетный, если по
    // факту окажется два активных Event'а на Stream одновременно).
    const activeEvent = await this.prisma.event.findFirst({
      where: {
        startedAt: { not: null },
        endedAt: null,
        eventStreams: { some: { streamId: stream.id } },
      },
      orderBy: { startedAt: 'desc' },
      select: { slug: true, title: true },
    });

    return {
      slug: stream.org.slug,
      name: stream.org.name,
      description: stream.org.description,
      streamSlug: stream.slug,
      isLive: stream.isLive,
      streamTitle: stream.name,
      streamDescription: stream.description,
      streamIsPublic: stream.isPublic,
      currentEvent: activeEvent
        ? { slug: activeEvent.slug, title: activeEvent.title }
        : null,
    };
  }

  /**
   * GET /v1/public/orgs/:orgSlug/stream (default) или
   *     /v1/public/orgs/:orgSlug/streams/:streamSlug/stream (named) — конфиг
   * живого стрима для viewer'а.
   *
   * Возвращает {@link PublicStreamDto} с минимально достаточным набором полей
   * для рендера MatPlayer / ViewSwitcher и адаптивной раскладки.
   *
   * Ответ всегда — массив `hlsUrls` (даже для composite — длины 1). Это даёт
   * фронту единообразный shape; различия mode'ов остаются в семантике
   * (`mode='composite'` → один URL на composite-stream, `mode='multistream'` →
   * по одному URL на каждый сконфигурированный slot).
   *
   * URL'ы формируются с правильным префиксом:
   *   default composite:   /api/v1/public/orgs/<orgSlug>/live/hls/master.m3u8
   *   default multistream: /api/v1/public/orgs/<orgSlug>/live/hls/<n>/index.m3u8
   *   named   composite:   /api/v1/public/orgs/<orgSlug>/streams/<streamSlug>/live/hls/master.m3u8
   *   named   multistream: /api/v1/public/orgs/<orgSlug>/streams/<streamSlug>/live/hls/<n>/index.m3u8
   *
   * 404 — если Stream'а нет, не активна orga, не live, или приватный +
   * `key` не совпадает с `previewKey` Stream'а.
   */
  async getStreamUrl(
    orgSlug: string,
    streamSlug?: string,
    key?: string,
  ): Promise<PublicStreamDto> {
    const sSlug = normalizeStreamSlug(streamSlug);
    const stream = await this.prisma.stream.findFirst({
      where: { slug: sSlug, org: { slug: orgSlug, isActive: true } },
      select: {
        id: true,
        isLive: true,
        isPublic: true,
        previewKey: true,
        mode: true,
        slotCount: true,
        slots: true,
        slotOrder: true,
        layoutPreset: true,
        fallbackLayouts: true,
      },
    });
    if (!stream || !stream.isLive) throw new NotFoundException('No live stream');
    if (!stream.isPublic && stream.previewKey !== key) {
      throw new NotFoundException('No live stream');
    }

    const mode: 'composite' | 'multistream' =
      stream.mode === 'multistream' ? 'multistream' : 'composite';

    const prefix = publicUrlPrefix(orgSlug, sSlug);

    // HLS URL'ы:
    //   composite     → один URL на master.m3u8 (composite-stream играется
    //                   целиком; viewer кропает квадранты на канвасе).
    //   multistream   → по одному URL на каждый slot 1..slotCount;
    //                   MatPlayer композирует их через canvas по layoutPreset.
    const hlsUrls: PublicHlsUrl[] =
      mode === 'composite'
        ? [{ slotIndex: 1, url: `${prefix}/live/hls/master.m3u8` }]
        : Array.from({ length: stream.slotCount }, (_v, i) => {
            const n = i + 1;
            return {
              slotIndex: n,
              url: `${prefix}/live/hls/${n}/index.m3u8`,
            };
          });

    // slots / slotOrder приходят как Json — normalize в типизированные значения.
    const slots = this.normalizeSlots(stream.slots, stream.slotCount);
    const slotOrder = this.normalizeSlotOrder(stream.slotOrder, stream.slotCount);
    const fallbackLayouts = this.normalizeFallbackLayouts(stream.fallbackLayouts);

    // Snapshot активных slot'ов из in-memory SlotStateService.
    // Для composite Stream'а с активным publish'ем в SlotStateService будет slot=1
    // (см. StreamService.handleWebhook — composite трактуется как slot 1).
    // Если SlotState ещё не успел инициализироваться — используем дефолт:
    //   composite → [1]
    //   multistream → пусто, фронт покажет «нет активных камер»
    const stateIndexes = this.slotState.getActiveSlotIndexes(stream.id);
    const activeSlotIndexes =
      stateIndexes.length > 0
        ? stateIndexes
        : mode === 'composite'
          ? [1]
          : [];

    return {
      mode,
      slotCount: stream.slotCount,
      slots,
      slotOrder,
      layoutPreset: stream.layoutPreset,
      fallbackLayouts,
      hlsUrls,
      activeSlotIndexes,
    };
  }

  /**
   * Нормализует поле `Stream.slots` (Prisma Json) в типизированный массив.
   * Гарантирует длину = slotCount; недостающие slot'ы дозаполняет дефолтами.
   */
  private normalizeSlots(raw: unknown, slotCount: number): PublicSlotDto[] {
    const arr = Array.isArray(raw) ? raw : [];
    const out: PublicSlotDto[] = [];
    for (let i = 1; i <= slotCount; i++) {
      const found = arr.find(
        (s): s is Record<string, unknown> =>
          typeof s === 'object' && s !== null && (s as any).index === i,
      );
      out.push({
        index: i,
        name: typeof found?.name === 'string' ? (found.name as string) : '',
        isAudioSource: found?.isAudioSource === true ? true : undefined,
      });
    }
    return out;
  }

  /**
   * Нормализует `Stream.slotOrder` (Prisma Json). Если значение невалидно
   * (не array, дубликаты, отсутствующие индексы) — возвращает [1..slotCount].
   */
  private normalizeSlotOrder(raw: unknown, slotCount: number): number[] {
    const def = Array.from({ length: slotCount }, (_v, i) => i + 1);
    if (!Array.isArray(raw) || raw.length !== slotCount) return def;
    const seen = new Set<number>();
    for (const v of raw) {
      if (!Number.isInteger(v) || v < 1 || v > slotCount || seen.has(v as number)) {
        return def;
      }
      seen.add(v as number);
    }
    return raw as number[];
  }

  /**
   * Нормализует `Stream.fallbackLayouts` (Prisma Json) в Record<number, string> или null.
   * Невалидные значения преобразуются в null (плеер использует встроенные дефолты).
   */
  private normalizeFallbackLayouts(raw: unknown): Record<number, string> | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const out: Record<number, string> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const n = Number(k);
      if (Number.isInteger(n) && n >= 1 && n <= 4 && typeof v === 'string' && v.length > 0) {
        out[n] = v;
      }
    }
    return Object.keys(out).length > 0 ? out : null;
  }

  /**
   * Список broadcast'ов конкретного Stream'а. streamSlug опционален:
   *   undefined / '' → default Stream орги (backward-compat);
   *   иначе          → named Stream.
   *
   * Приватный Stream без правильного key → пустой массив (тот же контракт,
   * что и в default-варианте до рефакторинга).
   */
  async getOrgBroadcasts(orgSlug: string, streamSlug?: string, key?: string) {
    const sSlug = normalizeStreamSlug(streamSlug);
    const stream = await this.prisma.stream.findFirst({
      where: { slug: sSlug, org: { slug: orgSlug, isActive: true } },
      select: { id: true, isPublic: true, previewKey: true },
    });
    if (!stream) throw new NotFoundException('Stream not found');
    if (!stream.isPublic && stream.previewKey !== key) return [];

    const broadcasts = await this.prisma.broadcast.findMany({
      where: { streamId: stream.id, endedAt: { not: null } },
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
    // Preserve legacy DTO shape: recording (singular) instead of recordings (array)
    return broadcasts.map(({ recordings, ...rest }) => ({
      ...rest,
      recording: recordings[0] ?? null,
    }));
  }
}
