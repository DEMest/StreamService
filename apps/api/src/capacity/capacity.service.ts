import { Injectable, Logger } from '@nestjs/common';
import { CapacityPoint, CapacitySnapshot, RenditionShare } from './capacity.types';
import { LADDER, demoHistory, demoIncidents, egressOf, mixAt } from './demo-source';
import { HostMetricsReader } from './host-metrics';
import { CapacityCollectorService } from './capacity-collector.service';

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
 * Числа приходят от `CapacityCollectorService` — он сводит лог nginx с
 * телеметрией плееров. Под флагом `CAPACITY_DEMO` вместо них подставляется
 * синтетическая нагрузка: экран ёмкости имеет смысл только под нагрузкой, а
 * на машине разработчика зрителей нет вообще.
 */
@Injectable()
export class CapacityService {
  private readonly logger = new Logger(CapacityService.name);

  private readonly uplinkMbps = Number(process.env.UPLINK_MBPS) || DEFAULT_UPLINK_MBPS;
  private readonly headroomRatio = Number(process.env.CAPACITY_HEADROOM) || DEFAULT_HEADROOM;
  private readonly demo = process.env.CAPACITY_DEMO === 'true';

  constructor(
    private readonly collector: CapacityCollectorService,
    /**
     * Читатель железа один на приложение (см. модуль): он хранит предыдущий
     * замер ради дельты, и второй экземпляр делил бы интервал, занижая
     * загрузку процессора.
     */
    private readonly host: HostMetricsReader,
  ) {
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

  private collect(now: number) {
    if (this.demo) {
      const history = demoHistory(now);
      const viewers = history[history.length - 1].viewers;
      return { history, renditions: mixAt(viewers), incidents: demoIncidents(now) };
    }

    const history = this.collector.history();
    if (history.length === 0) {
      // Первый тик сборщика ещё не прошёл. Показать нулевую точку честнее, чем
      // пустой график: экран должен отрисоваться сразу после запуска API.
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

    // Инциденты появятся здесь, когда заработает детектор: пока лента пуста.
    return { history, renditions: this.collector.renditions(), incidents: [] };
  }

  /** Экспортируется ради тестов и будущего сбора: вес микса → отдача. */
  static egressOf = egressOf;
}
