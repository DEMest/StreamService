import { Injectable } from '@nestjs/common';

/** Плеер шлёт отчёт раз в 15 с; 45 с без отчёта — считаем, что вкладку закрыли. */
const PLAYER_TTL_MS = 45_000;

/**
 * Предохранитель от разрастания реестра: `clientId` приходит от клиента и
 * ничем не подтверждён, так что реестр по сути — Map, растущая на любой
 * произвольный ключ снаружи. При `UPLINK_MBPS=750` (дефолт) и LQ-рендиции
 * порядка 1.5 Мбит/с потолок в районе нескольких сотен одновременных
 * зрителей на этот единственный сервер — 20 000 записей на пару порядков
 * выше любой реалистичной нагрузки, но всё ещё копейки памяти (запись —
 * несколько чисел и строк).
 */
export const MAX_PLAYERS = 20_000;

export interface QoeReport {
  /** `<orgSlug>/<streamSlug>` — тот же ключ, что даёт разбор лога nginx. */
  streamKey: string;
  /** Случайный идентификатор вкладки. Живёт в памяти страницы до перезагрузки. */
  clientId: string;
  rendition: string | null;
  stalls: number;
  fragLoadMs: number | null;
}

interface PlayerState {
  at: number;
  streamKey: string;
  rendition: string | null;
  stalls: number;
  fragLoadMs: number | null;
}

export interface QoeSnapshot {
  /** Плееры, реально тянущие сегменты прямо сейчас. */
  players: number;
  /** Доля клиентов, у которых за последний отчёт было подвисание, 0..1. */
  stallingShare: number;
  /** 95-й перцентиль времени загрузки фрагмента, мс. null — данных нет. */
  fragLoadP95: number | null;
  byRendition: Map<string, number>;
  byStream: Map<string, number>;
}

/**
 * Реестр реально играющих плееров.
 *
 * Считать зрителей по чат-сокетам недостаточно: открытая вкладка с
 * поставленным на паузу видео канал не ест, а закрытая пять секунд назад ещё
 * какое-то время висит в счётчике. Здесь учитывается тот, кто действительно
 * тянет сегменты, — а значит, тот, чей вес входит в потолок.
 *
 * Всё в памяти: это состояние «прямо сейчас», переживать перезапуск ему
 * незачем. Исторические срезы уезжают в Postgres отдельным путём.
 */
@Injectable()
export class QoeService {
  private readonly players = new Map<string, PlayerState>();

  ingest(r: QoeReport): void {
    // Новый clientId сверх потолка — молча отбрасываем: существующих клиентов
    // это не задевает (обновление их записи не создаёт новый ключ), а флуд
    // случайными id перестаёт раздувать Map дальше этой точки.
    if (!this.players.has(r.clientId) && this.players.size >= MAX_PLAYERS) return;

    this.players.set(r.clientId, {
      at: Date.now(),
      streamKey: r.streamKey,
      rendition: r.rendition,
      stalls: r.stalls,
      fragLoadMs: r.fragLoadMs,
    });
  }

  activePlayers(): number {
    return this.snapshot().players;
  }

  snapshot(): QoeSnapshot {
    const now = Date.now();
    // Чистим здесь, а не по таймеру: снимок и так берётся раз в несколько
    // секунд, а лишний таймер — лишняя вещь, которую нужно останавливать.
    for (const [id, st] of this.players) {
      if (now - st.at > PLAYER_TTL_MS) this.players.delete(id);
    }

    const alive = [...this.players.values()];
    const byRendition = new Map<string, number>();
    const byStream = new Map<string, number>();
    const loads: number[] = [];
    let stalling = 0;

    for (const p of alive) {
      if (p.rendition) byRendition.set(p.rendition, (byRendition.get(p.rendition) ?? 0) + 1);
      byStream.set(p.streamKey, (byStream.get(p.streamKey) ?? 0) + 1);
      if (p.stalls > 0) stalling += 1;
      if (p.fragLoadMs != null) loads.push(p.fragLoadMs);
    }

    return {
      players: alive.length,
      stallingShare: alive.length > 0 ? stalling / alive.length : 0,
      fragLoadP95: percentile(loads, 0.95),
      byRendition,
      byStream,
    };
  }
}

/**
 * Перцентиль методом ближайшего ранга.
 *
 * Среднее здесь врёт: оно размазывает страдания худших зрителей по всем
 * остальным, и «в среднем всё хорошо» остаётся верным ровно до момента, когда
 * четверть зала смотрит слайд-шоу. Решение о CDN принимается по худшим.
 */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(p * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}
