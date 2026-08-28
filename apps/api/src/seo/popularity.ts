/**
 * Правила «умной» индексации: какие публичные страницы стоит отдавать
 * поисковику, а какие — прятать под `noindex`.
 *
 * Зачем вообще фильтр. У сервиса на каждую организацию есть страница
 * `/watch/<org>`, но заведённая вчера организация без единого эфира — это
 * пустая карточка. Пачка таких страниц в индексе не приносит трафика и при
 * этом тянет вниз оценку сайта целиком («тонкие» страницы). Поэтому в
 * sitemap попадают только те, у кого есть что показать: идёт эфир прямо
 * сейчас или уже прошла хотя бы одна завершённая трансляция.
 *
 * Метрик просмотров в БД нет (ни у Organization, ни у Stream, ни у
 * Broadcast), поэтому «популярность» здесь = активность вещания. Свежесть
 * последнего эфира определяет priority/changefreq: живой эфир краулеру
 * интереснее, чем организация, молчащая полгода.
 *
 * Чистые функции без Prisma — вся арифметика тестируется без БД.
 */

export type ChangeFrequency =
  | 'always'
  | 'hourly'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'yearly'
  | 'never';

/** Эфир свежее этого срока считается актуальным — страница обновляется часто. */
export const FRESH_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Наблюдаемая активность вещания — то, из чего считается ранг страницы. */
export interface Activity {
  /** Идёт ли эфир прямо сейчас (по публичным Stream'ам). */
  isLive: boolean;
  /** Сколько завершённых трансляций уже было. */
  finishedBroadcasts: number;
  /** Когда закончилась последняя. */
  lastBroadcastAt: Date | null;
}

/** Решение по одной странице: пускать ли в индекс и с каким весом. */
export interface PageRank {
  indexable: boolean;
  priority: number;
  changeFrequency: ChangeFrequency;
  /** Что отдать в `<lastmod>`; null — брать дату создания сущности. */
  lastModified: Date | null;
}

/**
 * Ранг страницы организации/стрима.
 *
 * - нет эфиров вообще (ни живого, ни завершённых) → `indexable: false`;
 * - идёт эфир → 0.9 / hourly (страница меняется на глазах);
 * - эфир за последние 30 дней → 0.7 / daily;
 * - эфиры были, но давно → 0.5 / weekly.
 */
export function rankByActivity(activity: Activity, now: Date = new Date()): PageRank {
  const { isLive, finishedBroadcasts, lastBroadcastAt } = activity;

  if (!isLive && finishedBroadcasts === 0) {
    return { indexable: false, priority: 0, changeFrequency: 'monthly', lastModified: lastBroadcastAt };
  }

  if (isLive) {
    return { indexable: true, priority: 0.9, changeFrequency: 'hourly', lastModified: now };
  }

  const fresh =
    lastBroadcastAt !== null &&
    now.getTime() - lastBroadcastAt.getTime() <= FRESH_WINDOW_DAYS * DAY_MS;

  return {
    indexable: true,
    priority: fresh ? 0.7 : 0.5,
    changeFrequency: fresh ? 'daily' : 'weekly',
    lastModified: lastBroadcastAt,
  };
}

/**
 * Страница конкретного Stream'а внутри организации. Вес на 0.1 ниже страницы
 * организации: обзор организации — точка входа, отдельный стрим — её лист.
 */
export function rankStream(activity: Activity, now: Date = new Date()): PageRank {
  const rank = rankByActivity(activity, now);
  if (!rank.indexable) return rank;
  return { ...rank, priority: Math.round((rank.priority - 0.1) * 10) / 10 };
}
