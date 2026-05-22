import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { EventEmitter } from 'events';
import { MediamtxService } from '../mediamtx/mediamtx.service';
import { StreamService } from './stream.service';

export type SlotState = {
  streamId: string;
  slotIndex: number;
  isPublishing: boolean;
  bitrate: number | null;
  lastPublishAt: Date | null;
  lastUnpublishAt: Date | null;
};

/**
 * In-memory хранилище состояния slot'ов Stream'ов.
 *
 * Используется Studio Gateway, чтобы транслировать UI live-статусы каждого slot'а
 * (publishing/idle, текущий bitrate) без поллинга MediaMTX-API.
 *
 * State пишется webhook handler'ом (`publish`/`unpublish`) и любым кодом,
 * который наблюдает bitrate (например, периодический MediaMTX-poll).
 * State читается Gateway при `join` (snapshot) и слушает events для live-обновлений.
 *
 * Эмитит EventEmitter-событие `'slotState'` со значением {@link SlotState}
 * при любом изменении.
 */
@Injectable()
export class SlotStateService implements OnModuleInit {
  private readonly logger = new Logger(SlotStateService.name);
  private readonly emitter = new EventEmitter();

  // Ключ: `${streamId}:${slotIndex}`. Значение: текущий SlotState.
  private readonly states = new Map<string, SlotState>();

  // Внешние зависимости опциональны — сервис создаётся в unit-тестах напрямую
  // без NestJS-контейнера (`new SlotStateService()`); production-инстанс
  // получает MediamtxService/StreamService через DI и стартует reconcile.
  constructor(
    @Optional() @Inject(MediamtxService) private readonly mediamtx?: MediamtxService,
    @Optional() @Inject(forwardRef(() => StreamService))
    private readonly streams?: StreamService,
  ) {}

  /**
   * При старте API дотягиваем состояние slot'ов из MediaMTX. Если процесс
   * упал во время живой публикации — без этого reconcile в Studio будет
   * «нет камер» пока кто-то не выполнит publish/unpublish цикл.
   *
   * Используем {@link MediamtxService.listActivePublishers} — он смотрит в
   * `paths/list` + runtime `srtconns/list` / `rtspsessions/list` /
   * `rtmpconns/list`. Это важно, потому что mediamtx хранит configured-paths
   * в RAM: после его рестарта /v3/paths/list пустой, но активные SRT/RTMP/RTSP
   * коннекшены продолжают идти и видны в *conns/list.
   *
   * Пути, которые не маппятся в Stream (legacy / чужие), игнорируем.
   * MediaMTX-недоступность на старте не валит API — логируем warn и
   * восстанавливаемся при следующих publish-webhook'ах.
   */
  async onModuleInit(): Promise<void> {
    if (!this.mediamtx || !this.streams) return; // тестовый инстанс
    try {
      const paths = await this.mediamtx.listActivePublishers();
      for (const p of paths) {
        if (!p.ready) continue;
        try {
          const resolved = await this.streams.resolvePathToStream(p.name);
          if (!resolved) continue;
          const slotIndex = resolved.slotIndex ?? 1;
          this.setPublishing(resolved.stream.id, slotIndex, true);
        } catch (e: any) {
          this.logger.warn(
            `reconcile: skip path ${p.name}: ${e?.message ?? String(e)}`,
          );
        }
      }
      this.logger.log(`SlotState reconcile complete: ${paths.length} active publishers`);
    } catch (err: any) {
      this.logger.warn(
        `SlotState reconcile skipped (MediaMTX unreachable): ${err?.message ?? err}`,
      );
    }
  }

  /**
   * Подписка на изменения. Listener получит обновлённый SlotState.
   */
  on(listener: (state: SlotState) => void): () => void {
    this.emitter.on('slotState', listener);
    return () => this.emitter.off('slotState', listener);
  }

  /**
   * Обновляет флаг публикации slot'а. Создаёт state-запись если её ещё нет.
   * Эмитит `'slotState'` event с новым значением.
   */
  setPublishing(streamId: string, slotIndex: number, isPublishing: boolean): SlotState {
    const prev = this.getOrInit(streamId, slotIndex);
    const now = new Date();
    const next: SlotState = {
      ...prev,
      isPublishing,
      lastPublishAt: isPublishing ? now : prev.lastPublishAt,
      lastUnpublishAt: !isPublishing ? now : prev.lastUnpublishAt,
      // если slot ушёл в offline — bitrate сбрасываем
      bitrate: isPublishing ? prev.bitrate : null,
    };
    this.states.set(this.key(streamId, slotIndex), next);
    this.emitter.emit('slotState', next);
    return next;
  }

  /**
   * Обновляет текущий bitrate slot'а (в bps). Эмитит `'slotState'` event.
   */
  setBitrate(streamId: string, slotIndex: number, bitrate: number | null): SlotState {
    const prev = this.getOrInit(streamId, slotIndex);
    const next: SlotState = { ...prev, bitrate };
    this.states.set(this.key(streamId, slotIndex), next);
    this.emitter.emit('slotState', next);
    return next;
  }

  /**
   * Snapshot всех slotState'ов Stream'а. Возвращает копии, упорядочены по slotIndex.
   */
  getStreamState(streamId: string): SlotState[] {
    const list: SlotState[] = [];
    for (const state of this.states.values()) {
      if (state.streamId === streamId) list.push({ ...state });
    }
    return list.sort((a, b) => a.slotIndex - b.slotIndex);
  }

  /**
   * Slot'ы Stream'а, которые сейчас publishing.
   */
  getActiveSlotIndexes(streamId: string): number[] {
    return this.getStreamState(streamId)
      .filter((s) => s.isPublishing)
      .map((s) => s.slotIndex);
  }

  /**
   * Сбрасывает state Stream'а (например, после удаления Stream'а).
   * Используется в админских/тестовых сценариях.
   */
  clearStream(streamId: string): void {
    for (const key of [...this.states.keys()]) {
      if (this.states.get(key)?.streamId === streamId) {
        this.states.delete(key);
      }
    }
  }

  private key(streamId: string, slotIndex: number): string {
    return `${streamId}:${slotIndex}`;
  }

  private getOrInit(streamId: string, slotIndex: number): SlotState {
    const existing = this.states.get(this.key(streamId, slotIndex));
    if (existing) return existing;
    return {
      streamId,
      slotIndex,
      isPublishing: false,
      bitrate: null,
      lastPublishAt: null,
      lastUnpublishAt: null,
    };
  }
}
