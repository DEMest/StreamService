/**
 * Публичный адрес сайта для серверных задач SEO.
 *
 * Отличие от остального кода: обычно бэкенд не знает, на каком домене его
 * открывают (и это сознательно — см. INGEST_HOST в CLAUDE.md, дашборд берёт
 * хост из браузера). Но пинг поисковикам инициирует webhook от MediaMTX, где
 * никакого запроса от браузера нет — абсолютный URL взять неоткуда, кроме env.
 *
 * `SITE_URL` в проекте уже есть (ссылка на /admin/feedback в письме), поэтому
 * новой переменной не заводим. Пусто или localhost — пинг просто выключен:
 * на dev-стенде уведомлять Яндекс с Google не о чем.
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

/**
 * Возвращает `https://host` без завершающего слэша либо null, если адрес не
 * задан, кривой или локальный.
 */
export function publicSiteUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = (env.SITE_URL ?? '').trim();
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (LOCAL_HOSTS.has(url.hostname) || url.hostname.endsWith('.local')) return null;

  return `${url.protocol}//${url.host}`;
}
