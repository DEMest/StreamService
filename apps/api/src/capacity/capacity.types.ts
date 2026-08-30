/**
 * Типы экрана «Ёмкость сервера» (`/admin/capacity`).
 *
 * Одна мысль пронизывает всё: потолок по зрителям — не константа, а частное
 * от деления свободного канала на вес одного зрителя. Вес зависит от того,
 * какое качество зрители фактически выбрали, поэтому `renditions` здесь не
 * украшение, а множитель в главной формуле.
 */

import { HostMetrics } from './host-metrics';

/** Одна точка графика. Поля короткие — их уезжают сотни в JSON. */
export interface CapacityPoint {
  /** unix ms */
  t: number;
  /** Одновременные зрители (плееры, а не открытые вкладки). */
  viewers: number;
  /** Отдача наружу, Мбит/с — сумма тел ответов, отданных зрителям. */
  egressMbps: number;
  /** Доля запросов, закрытых кэшем nginx, 0..1. */
  cacheHitRatio: number;
  /** Доля ответов 4xx/5xx, 0..1. */
  errorRate: number;
  /** Доля зрителей, у которых за интервал было подвисание, 0..1. */
  stallRatio: number;
}

/** Сколько зрителей сидит на каждой ступени лесенки качеств. */
export interface RenditionShare {
  /** Каталог FFmpeg-рендишена: 'hd' | '720' | '480' | '240'. */
  key: string;
  /** Человеческое имя из master.m3u8 («Оригинал», «720p», …). */
  label: string;
  /** Заявленный битрейт ступени, Мбит/с — вес одного такого зрителя. */
  bitrateMbps: number;
  viewers: number;
  /** Доля от всех зрителей, 0..1. */
  share: number;
}

/** Отрезок времени, когда что-то шло не так. Открывается и закрывается детектором. */
export interface CapacityIncident {
  id: string;
  /**
   * uplink — канал занят выше порога; encode — FFmpeg не успевает;
   * errors — всплеск 4xx/5xx; stalls — зрителям плохо; offline — эфир оборвался.
   */
  kind: 'uplink' | 'encode' | 'errors' | 'stalls' | 'offline';
  severity: 'warn' | 'crit';
  title: string;
  startedAt: number;
  /** null — инцидент ещё длится. */
  endedAt: number | null;
  /** Человекочитаемый пик: «91% канала», «speed 0.78». */
  peak: string;
}

export interface CapacitySnapshot {
  /** Ширина канала сервера, Мбит/с (переменная окружения UPLINK_MBPS). */
  uplinkMbps: number;
  /** Какую долю канала держим в резерве под ингест, чат и страницы. */
  headroomRatio: number;

  viewers: number;
  egressMbps: number;
  /** Занятая доля канала, 0..1. */
  utilization: number;

  /**
   * Сколько Мбит/с весит средний зритель прямо сейчас. null — зрителей нет,
   * делить не на что.
   */
  avgPerViewerMbps: number | null;
  /**
   * Главное число экрана: сколько зрителей влезет в свободный канал при
   * нынешнем миксе качеств. null — пока не из чего считать.
   */
  ceilingViewers: number | null;
  /**
   * measured — вес зрителя посчитан по фактической отдаче;
   * assumed — зрителей слишком мало для статистики, взят вес по лесенке.
   */
  ceilingBasis: 'measured' | 'assumed';

  renditions: RenditionShare[];

  health: {
    cacheHitRatio: number;
    errorRate: number;
    /** speed FFmpeg: 1.0 = реальное время. null — эфира нет. */
    encodeSpeed: number | null;
    stallRatio: number;
  };

  /**
   * Железо сервера. Читается напрямую из счётчиков хоста, поэтому остаётся
   * настоящим даже когда остальные цифры на экране синтетические.
   */
  host: HostMetrics;

  /** Точки за последний час, старые первыми. */
  history: CapacityPoint[];
  /** Последние инциденты, свежие первыми. */
  incidents: CapacityIncident[];

  /**
   * true — данные синтетические (стенд без реального трафика). Экран обязан
   * это показывать: цифра потолка, снятая с выдумки, опаснее её отсутствия.
   */
  demo: boolean;
}
