import { Injectable, Logger } from '@nestjs/common';
import { CapacityPoint, CapacitySnapshot, RenditionShare } from './capacity.types';
import { LADDER, demoHistory, demoIncidents, egressOf, mixAt } from './demo-source';
import { HostMetricsReader } from './host-metrics';

/** Ширина канала сервера. Единственное число, которое неоткуда измерить — его задаёт человек. */
const DEFAULT_UPLINK_MBPS = 750;
/** Доля канала под ингест, чат, страницы и всплески. Потолок считаем от остатка. */
const DEFAULT_HEADROOM = 0.2;
/**
 * Ниже этого числа зрителей делить отдачу на их количество бессмысленно:
 * один человек, перематывающий буфер, перекосит среднее вдвое.
 */
const MEASURED_MIN_VIEWERS = 5;

/**
 * Расчёт потолка — чистая функция, намеренно оторванная от источника данных.
 *
 * Это ядро всей задачи, и оно должно проверяться тестами без поднятия nginx,
 * MediaMTX и вообще чего-либо. Источники будут меняться (сейчас стенд, потом
 * лог nginx), формула — нет.
 */
export function computeCeiling(input: {
  uplinkMbps: number;
  headroomRatio: number;
  viewers: number;
  egressMbps: number;
  renditions: RenditionShare[];
}): Pick<CapacitySnapshot, 'utilization' | 'avgPerViewerMbps' | 'ceilingViewers' | 'ceilingBasis'> {
  const { uplinkMbps, headroomRatio, viewers, egressMbps, renditions } = input;
  const usable = uplinkMbps * (1 - headroomRatio);

  // Вес зрителя по факту — честнее всего, но требует статистики.
  const measured = viewers >= MEASURED_MIN_VIEWERS && egressMbps > 0 ? egressMbps / viewers : null;

  // Запасной путь: средневзвешенный битрейт лесенки по нынешнему миксу.
  // Он игнорирует кэш и паузы, поэтому даёт оценку сверху — то есть
  // осторожную, а не оптимистичную.
  const totalInMix = renditions.reduce((a, r) => a + r.viewers, 0);
  const assumed = totalInMix > 0
    ? renditions.reduce((a, r) => a + r.bitrateMbps * r.viewers, 0) / totalInMix
    : null;

  const perViewer = measured ?? assumed;

  return {
    utilization: uplinkMbps > 0 ? +(egressMbps / uplinkMbps).toFixed(4) : 0,
    avgPerViewerMbps: perViewer != null ? +perViewer.toFixed(2) : null,
    ceilingViewers: perViewer && perViewer > 0 ? Math.floor(usable / perViewer) : null,
    ceilingBasis: measured != null ? 'measured' : 'assumed',
  };
}

/**
 * Сбор данных для экрана ёмкости.
 *
 * Прототип: источники ещё не подключены, поэтому под флагом `CAPACITY_DEMO`
 * сервис отдаёт синтетическую нагрузку, а без флага — честные нули. Реальные
 * источники (лог nginx, телеметрия плеера, `StatsService`) встанут на место
 * `collect()`, а `computeCeiling` и весь фронтенд останутся как есть.
 */
@Injectable()
export class CapacityService {
  private readonly logger = new Logger(CapacityService.name);

  private readonly uplinkMbps = Number(process.env.UPLINK_MBPS) || DEFAULT_UPLINK_MBPS;
  private readonly headroomRatio = Number(process.env.CAPACITY_HEADROOM) || DEFAULT_HEADROOM;
  private readonly demo = process.env.CAPACITY_DEMO === 'true';

  /**
   * Читатель железа держит предыдущий замер ради дельты, поэтому живёт вместе
   * с сервисом, а не создаётся на каждый запрос.
   */
  private readonly host = new HostMetricsReader();

  constructor() {
    // Первый замер сразу: он задаёт базу для дельты, иначе самый первый
    // открытый экран показал бы «загрузка неизвестна».
    this.host.read();
  }

  getSnapshot(): CapacitySnapshot {
    const now = Date.now();
    const { history, renditions, incidents } = this.collect(now);
    const last = history[history.length - 1];

    const viewers = last?.viewers ?? 0;
    const egressMbps = last?.egressMbps ?? 0;

    return {
      uplinkMbps: this.uplinkMbps,
      headroomRatio: this.headroomRatio,
      viewers,
      egressMbps,
      ...computeCeiling({
        uplinkMbps: this.uplinkMbps,
        headroomRatio: this.headroomRatio,
        viewers,
        egressMbps,
        renditions,
      }),
      renditions,
      health: {
        cacheHitRatio: last?.cacheHitRatio ?? 0,
        errorRate: last?.errorRate ?? 0,
        encodeSpeed: this.demo ? 0.99 : null,
        stallRatio: last?.stallRatio ?? 0,
      },
      host: this.host.read(),
      history,
      incidents,
      demo: this.demo,
    };
  }

  /** Точка, куда встанут реальные источники. Сейчас — стенд либо нули. */
  private collect(now: number) {
    if (this.demo) {
      const history = demoHistory(now);
      const viewers = history[history.length - 1].viewers;
      return { history, renditions: mixAt(viewers), incidents: demoIncidents(now) };
    }

    const empty: CapacityPoint = {
      t: now,
      viewers: 0,
      egressMbps: 0,
      cacheHitRatio: 0,
      errorRate: 0,
      stallRatio: 0,
    };
    return {
      history: [empty],
      renditions: LADDER.map((r) => ({ ...r, viewers: 0, share: 0 })),
      incidents: [],
    };
  }

  /** Экспортируется ради тестов и будущего сбора: вес микса → отдача. */
  static egressOf = egressOf;
}
