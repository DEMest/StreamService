import { fetchSitemapUrls, siteUrlFromRequest, type SitemapUrl } from '@/lib/seo';

/**
 * sitemap.xml — карта сайта для Google и Яндекса.
 *
 * Состав приходит с бэкенда (`/v1/public/seo/sitemap`), потому что решение
 * «пускать ли организацию в индекс» зависит от истории её эфиров, и оно
 * должно совпадать с мета-тегом robots на самой странице.
 *
 * Если API недоступен, отдаём статический минимум вместо ошибки: краулеру
 * полезнее неполная карта, чем 500 — на повторяющиеся ошибки он снижает
 * частоту обхода.
 */
export const dynamic = 'force-dynamic';

/**
 * Держать в согласии со `STATIC_URLS` в `apps/api/src/seo/seo.service.ts`.
 * Копия здесь неизбежна: список нужен ровно тогда, когда API недоступен, —
 * импортировать его оттуда некому.
 */
const FALLBACK: SitemapUrl[] = [
  { path: '/', lastModified: '', changeFrequency: 'daily', priority: 1.0 },
  { path: '/streams', lastModified: '', changeFrequency: 'hourly', priority: 0.9 },
  { path: '/organizations', lastModified: '', changeFrequency: 'daily', priority: 0.7 },
  { path: '/archive', lastModified: '', changeFrequency: 'daily', priority: 0.7 },
  { path: '/login', lastModified: '', changeFrequency: 'monthly', priority: 0.3 },
  { path: '/faq', lastModified: '', changeFrequency: 'monthly', priority: 0.5 },
  { path: '/legal/privacy', lastModified: '', changeFrequency: 'yearly', priority: 0.2 },
  { path: '/legal/terms', lastModified: '', changeFrequency: 'yearly', priority: 0.2 },
  { path: '/legal/copyright', lastModified: '', changeFrequency: 'yearly', priority: 0.2 },
];

export async function GET(req: Request) {
  const site = siteUrlFromRequest(req);
  const fetched = await fetchSitemapUrls();
  const urls = fetched.length > 0 ? fetched : FALLBACK;
  const now = new Date().toISOString();

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((u) =>
      [
        '  <url>',
        `    <loc>${escapeXml(site + u.path)}</loc>`,
        `    <lastmod>${escapeXml(u.lastModified || now)}</lastmod>`,
        `    <changefreq>${escapeXml(u.changeFrequency)}</changefreq>`,
        `    <priority>${u.priority.toFixed(1)}</priority>`,
        '  </url>',
      ].join('\n'),
    ),
    '</urlset>',
    '',
  ].join('\n');

  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=600',
    },
  });
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
