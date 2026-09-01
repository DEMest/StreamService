import { siteUrlFromRequest } from '@/lib/seo';

/**
 * robots.txt.
 *
 * Route handler, а не статический файл в `public/`, ровно по одной причине:
 * директива `Sitemap:` требует абсолютный URL, а домен стенда известен только
 * в рантайме (тот же принцип, что у INGEST_HOST — переезд на другой домен не
 * должен требовать пересборки образа).
 *
 * Что закрыто и почему:
 *  - `/dashboard`, `/admin` — кабинеты за авторизацией, краулеру там нечего
 *    делать (и middleware всё равно отправит его на /login);
 *  - `/api/`, `/hls/`, `/static/` — не страницы: JSON, видеосегменты и медиа;
 *  - ссылки с `key=` — приватные трансляции с previewKey. Их вообще не должно
 *    быть в индексе: ключ в URL = доступ к закрытому эфиру. Правил два, потому
 *    что `/*?key=` матчит параметр только первым в строке запроса.
 */
export const dynamic = 'force-dynamic';

export function GET(req: Request) {
  const site = siteUrlFromRequest(req);

  const body = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /dashboard',
    'Disallow: /admin',
    // Картинки живут под /api/, и без этих исключений Googlebot не может
    // скачать превью: в отчёте о видео это выглядит как «не указан URL значка
    // видео», и ролик не индексируется. Allow длиннее Disallow, поэтому
    // выигрывает и у Google, и у Яндекса.
    'Allow: /api/v1/public/orgs/*/image',
    'Allow: /api/v1/public/orgs/*/streams/*/thumbnail',
    'Allow: /api/v1/public/orgs/*/streams/*/broadcasts/*/preview',
    'Allow: /api/v1/public/orgs/*/broadcasts/*/preview',
    'Disallow: /api/',
    'Disallow: /hls/',
    'Disallow: /static/',
    'Disallow: /*?key=',
    'Disallow: /*&key=',
    '',
    `Sitemap: ${site}/sitemap.xml`,
    '',
  ].join('\n');

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
