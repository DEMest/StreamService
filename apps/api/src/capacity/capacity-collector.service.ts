import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { CapacityPoint, RenditionShare } from './capacity.types';
import { LADDER } from './demo-source';
import { LogTailer } from './log-tailer';
import { parseAccessLogLine } from './nginx-log';
import { QoeService } from './qoe.service';

/** Шаг сбора. 10 с — достаточно мелко для живого графика и не сорит в память. */
export const TICK_MS = 10_000;
/** Час истории при шаге 10 секунд. */
const HISTORY_SIZE = 360;

/** Отдача и зрители одного стрима за последний тик. */
export interface StreamLoad {
  egressMbps: number;
  viewers: number;
}

/**
 * Сведение источников в поток точек.
 *
 * Разделение обязанностей здесь не случайное: отдача считается по логу nginx,
 * а зрители — по телеметрии плееров. Кэш закрывает большинство запросов
 * сегментов, поэтому по числу обращений зрителей не сосчитать; а по числу
 * открытых вкладок сосчитаешь не тех — вкладка с остановленным видео канал не
 * ест. Каждый источник отвечает за то, что видит достоверно.
 *
 * Всё живёт в памяти: это монитор реального времени. Исторические срезы
 * уезжают в Postgres отдельным путём.
 */
@Injectable()
export class CapacityCollectorService implements OnModuleInit, OnModuleDestroy {
  private readonly points: CapacityPoint[] = [];
  private streams = new Map<string, StreamLoad>();
  private lastRenditions: RenditionShare[] = LADDER.map((r) => ({ ...r, viewers: 0, share: 0 }));
  private lastTickAt = Date.now();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly tailer: LogTailer,
    private readonly qoe: QoeService,
  ) {}

  /**
   * Таймер запускается здесь, а не в конструкторе, намеренно: конструктор без
   * побочных эффектов позволяет тестам дёргать `tick()` вручную и получать
   * ровно один тик на проверку, а не гонку с настоящим интервалом.
   *
   * setInterval, а не `@Interval`: сервис должен работать без ScheduleModule —
   * тот же приём, что и в `StatsService`.
   */
  onModuleInit(): void {
    this.lastTickAt = Date.now();
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  tick(): void {
    const now = Date.now();
    // Интервал берём фактический: тик мог запоздать под нагрузкой, и деление
    // на константу завысило бы битрейт ровно тогда, когда это опаснее всего.
    const dtSec = Math.max(0.001, (now - this.lastTickAt) / 1000);
    this.lastTickAt = now;

    let bytes = 0;
    let hits = 0;
    let segments = 0;
    let errors = 0;
    let requests = 0;
    const bytesByStream = new Map<string, number>();

    for (const raw of this.tailer.read()) {
      const e = parseAccessLogLine(raw);
      if (!e) continue;

      requests += 1;
      bytes += e.bytes;
      if (e.status >= 400) errors += 1;

      // Долю попаданий считаем только по сегментам: плейлисты кэшируются на
      // секунду и промахиваются почти всегда — вместе они бы её обнулили.
      if (e.kind === 'segment') {
        segments += 1;
        if (e.cache === 'hit') hits += 1;
      }

      const key = `${e.orgSlug}/${e.streamSlug}`;
      bytesByStream.set(key, (bytesByStream.get(key) ?? 0) + e.bytes);
    }

    const q = this.qoe.snapshot();
    const toMbps = (b: number) => +((b * 8) / dtSec / 1e6).toFixed(2);

    this.streams = new Map(
      [...bytesByStream].map(([key, b]) => [
        key,
        { egressMbps: toMbps(b), viewers: q.byStream.get(key) ?? 0 },
      ]),
    );

    this.lastRenditions = LADDER.map((r) => {
      const viewers = q.byRendition.get(r.key) ?? 0;
      return { ...r, viewers, share: q.players > 0 ? viewers / q.players : 0 };
    });

    this.points.push({
      t: now,
      viewers: q.players,
      egressMbps: toMbps(bytes),
      cacheHitRatio: segments > 0 ? +(hits / segments).toFixed(3) : 0,
      errorRate: requests > 0 ? +(errors / requests).toFixed(4) : 0,
      stallRatio: +q.stallingShare.toFixed(3),
    });
    if (this.points.length > HISTORY_SIZE) this.points.shift();
  }

  history(): CapacityPoint[] {
    return this.points;
  }

  renditions(): RenditionShare[] {
    return this.lastRenditions;
  }

  byStream(): Map<string, StreamLoad> {
    return this.streams;
  }
}
