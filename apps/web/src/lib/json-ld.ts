import type { SeoPageMeta } from './seo';

/**
 * Структурированные данные (schema.org, JSON-LD).
 *
 * Зачем они здесь помимо «поисковик лучше поймёт страницу»: Google Indexing
 * API — единственный способ попросить переобход конкретного URL — принимает
 * только страницы с разметкой `JobPosting` или `BroadcastEvent`. Именно
 * `BroadcastEvent` внутри `VideoObject` на странице идущего эфира делает
 * легальным пинг из SeoPingService.
 *
 * Чистые функции без запросов — данные приходят уже готовыми из
 * `/v1/public/seo/page-meta`.
 */

const BRAND = 'Liga Live';

/** Сайт целиком: показывается в выдаче как «сайт-бренд». */
export function websiteJsonLd(site: string) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${site}/#website`,
        url: `${site}/`,
        name: BRAND,
        inLanguage: 'ru-RU',
        description:
          'Платформа прямых трансляций спортивных матчей и мероприятий: живой эфир, чат и архив записей.',
        // Из этого Google строит строку поиска по сайту прямо в выдаче.
        // Работает, только если /search?q= реально отвечает: адрес проверяют.
        potentialAction: {
          '@type': 'SearchAction',
          target: {
            '@type': 'EntryPoint',
            urlTemplate: `${site}/search?q={search_term_string}`,
          },
          'query-input': 'required name=search_term_string',
        },
      },
      {
        '@type': 'Organization',
        '@id': `${site}/#organization`,
        name: BRAND,
        url: `${site}/`,
      },
    ],
  };
}

/** Страница организации: сама организация + хлебные крошки. */
export function orgPageJsonLd(site: string, meta: SeoPageMeta) {
  if (!meta.org) return null;
  const url = `${site}/watch/${meta.org.slug}`;

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${url}#organization`,
        name: meta.org.name,
        url,
        ...(meta.org.description ? { description: meta.org.description } : {}),
        ...(meta.thumbnailPath ? { logo: `${site}${meta.thumbnailPath}` } : {}),
      },
      breadcrumbs(site, [
        { name: 'Организации', path: '/organizations' },
        { name: meta.org.name, path: `/watch/${meta.org.slug}` },
      ]),
    ],
  };
}

/**
 * Страница трансляции: VideoObject с публикацией.
 *
 * `isLiveBroadcast: true` + `startDate` — то, по чему Google понимает, что
 * эфир идёт прямо сейчас, и показывает бейдж LIVE в выдаче. Для завершённого
 * эфира отдаём тот же объект без флага «в эфире»: страница продолжает
 * существовать и вести в архив.
 */
export function streamPageJsonLd(site: string, meta: SeoPageMeta) {
  if (!meta.org || !meta.stream) return null;

  const { org, stream } = meta;
  // Google требует у VideoObject доступный thumbnailUrl и без него отказывается
  // индексировать ролик («не указан URL значка видео»). Если картинки нет —
  // отдаём только хлебные крошки: неполная разметка честнее битой.
  const thumbnail = meta.thumbnailPath ? `${site}${meta.thumbnailPath}` : null;
  const url = `${site}/watch/${org.slug}/${stream.slug}`;
  const title = stream.name || org.name;
  const description =
    stream.description ??
    org.description ??
    `Прямая трансляция «${title}» — организация ${org.name} на ${BRAND}.`;

  const breadcrumb = breadcrumbs(site, [
    { name: 'Трансляции', path: '/streams' },
    { name: org.name, path: `/watch/${org.slug}` },
    { name: title, path: `/watch/${org.slug}/${stream.slug}` },
  ]);

  if (!thumbnail) {
    return { '@context': 'https://schema.org', '@graph': [breadcrumb] };
  }

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'VideoObject',
        '@id': `${url}#video`,
        name: title,
        description,
        url,
        thumbnailUrl: [thumbnail],
        // uploadDate обязателен для VideoObject: для живого эфира это его
        // начало, для оффлайн-страницы — дата последнего эфира.
        uploadDate: stream.startedAt ?? meta.stats.lastBroadcastAt ?? undefined,
        contentUrl: `${site}/api/v1/public/orgs/${org.slug}/streams/${stream.slug}/live/hls/master.m3u8`,
        isLiveBroadcast: stream.isLive,
        publication: {
          '@type': 'BroadcastEvent',
          name: title,
          isLiveBroadcast: stream.isLive,
          startDate: stream.startedAt ?? meta.stats.lastBroadcastAt ?? undefined,
          ...(stream.isLive ? {} : { endDate: meta.stats.lastBroadcastAt ?? undefined }),
        },
        publisher: {
          '@type': 'Organization',
          name: org.name,
          url: `${site}/watch/${org.slug}`,
        },
      },
      breadcrumb,
    ],
  };
}

function breadcrumbs(site: string, items: Array<{ name: string; path: string }>) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: `${site}${item.path}`,
    })),
  };
}
