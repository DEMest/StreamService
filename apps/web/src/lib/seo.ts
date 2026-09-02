/**
 * Серверная часть SEO: откуда фронт берёт свой публичный адрес и данные для
 * мета-тегов.
 *
 * Только для server-компонентов и route handler'ов: ходит на внутренний адрес
 * API (`http://api:3001`), который из браузера не резолвится, и читает
 * серверные переменные окружения. В клиентские компоненты не импортировать.
 *
 * Почему адрес сайта — переменная окружения, а не `window.location`: robots.txt
 * и sitemap.xml обязаны содержать АБСОЛЮТНЫЕ URL, а рендерятся они на сервере,
 * где браузерного хоста нет. `SITE_URL` в проекте уже есть (ссылка в письме
 * обратной связи), поэтому переиспользуем её, а не заводим ещё одну.
 *
 * Если переменная не задана, хост берётся из заголовков запроса — стенд без
 * настроек всё равно отдаст осмысленный sitemap, просто не сможет проставить
 * canonical в статических метаданных (там запроса нет).
 */

import { headers } from 'next/headers';

/** Внутренний адрес API — тот же, которым пользуется прокси Next.js. */
const API_BASE = process.env.API_UPSTREAM ?? 'http://localhost:3001';

/** Адрес сайта из env; null — не задан. */
export function siteUrlFromEnv(): string | null {
  const raw = (process.env.SITE_URL ?? '').trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, '');
}

/**
 * Адрес сайта для ответа на конкретный запрос: env приоритетнее (за nginx
 * заголовки может подменить кто угодно), иначе — по заголовкам прокси.
 */
export function siteUrlFromRequest(req: Request): string {
  const fromEnv = siteUrlFromEnv();
  if (fromEnv) return fromEnv;

  const headers = req.headers;
  const host = headers.get('x-forwarded-host') ?? headers.get('host') ?? 'localhost:3000';
  const proto = headers.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

/**
 * Адрес сайта для страницы, которая рендерится на каждый запрос: env, а если
 * её не задали — хост из заголовков.
 *
 * Нужен, чтобы забытая переменная окружения не выключала разметку целиком: без
 * абсолютного адреса не собрать ни canonical, ни JSON-LD с BroadcastEvent, а
 * это ровно то, ради чего всё затевалось. Возвращает пустую строку только при
 * статическом рендере, где запроса нет.
 */
export function siteUrlForPage(): string {
  const fromEnv = siteUrlFromEnv();
  if (fromEnv) return fromEnv;

  try {
    const h = headers();
    const host = h.get('x-forwarded-host') ?? h.get('host');
    if (!host) return '';
    const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
    return `${proto}://${host}`;
  } catch {
    // Статический рендер: заголовков нет — вызывающий обойдётся без разметки.
    return '';
  }
}

/**
 * og:image по умолчанию для страниц без своего превью — сгенерированный
 * баннер из `app/opengraph-image.tsx`. Ширина/высота проставляем явно: без
 * них VK не всегда берёт картинку в карточку.
 */
export const DEFAULT_OG_IMAGE = { url: '/opengraph-image', width: 1200, height: 630, alt: 'Liga Live' };

/** og:image для страницы: реальный кадр/превью, если есть, иначе дефолтный баннер. */
export function ogImages(thumbnailPath: string | null) {
  return [thumbnailPath ? { url: thumbnailPath } : DEFAULT_OG_IMAGE];
}

export interface SitemapUrl {
  path: string;
  lastModified: string;
  changeFrequency: string;
  priority: number;
}

export interface SeoPageMeta {
  found: boolean;
  indexable: boolean;
  org: { slug: string; name: string; description: string | null; hasImage: boolean } | null;
  stream: {
    slug: string;
    name: string;
    description: string | null;
    isLive: boolean;
    startedAt: string | null;
  } | null;
  /** Путь к картинке, которая точно отдаётся, или null (см. seo.service.ts). */
  thumbnailPath: string | null;
  stats: { liveCount: number; finishedBroadcasts: number; lastBroadcastAt: string | null };
}

/**
 * Список URL для карты сайта. При недоступном API возвращает пустой список —
 * вызывающий отдаст хотя бы статические страницы, а не 500: карта сайта с
 * ошибкой хуже неполной карты.
 */
export async function fetchSitemapUrls(): Promise<SitemapUrl[]> {
  try {
    const res = await fetch(`${API_BASE}/v1/public/seo/sitemap`, {
      next: { revalidate: 600 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.urls) ? data.urls : [];
  } catch {
    return [];
  }
}

/**
 * Мета-данные страницы просмотра. `null` — API недоступен; страница в этом
 * случае рендерит нейтральный заголовок вместо падения.
 */
export async function fetchPageMeta(orgSlug: string, streamSlug?: string): Promise<SeoPageMeta | null> {
  const params = new URLSearchParams({ org: orgSlug });
  if (streamSlug) params.set('stream', streamSlug);

  try {
    const res = await fetch(`${API_BASE}/v1/public/seo/page-meta?${params.toString()}`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    return (await res.json()) as SeoPageMeta;
  } catch {
    return null;
  }
}
