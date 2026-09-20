import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';
import { Providers } from './providers';
import { JsonLd } from '@/components/JsonLd';
import { websiteJsonLd } from '@/lib/json-ld';
import { siteUrlFromEnv } from '@/lib/seo';

/**
 * Мета-данные лендинга и значения по умолчанию для всех остальных страниц.
 *
 * `title.template` — чтобы вложенные разделы задавали только своё название
 * («Трансляции»), а бренд подставлялся сам. До этого у всех страниц сайта был
 * один и тот же заголовок «Liga Live»: для поисковика это набор дубликатов, и
 * именно поэтому Google почти ничего с сайта в индекс не брал.
 *
 * `metadataBase` берётся из SITE_URL — без него Next.js не может собрать
 * абсолютные canonical и og:url.
 */
const site = siteUrlFromEnv();

export const metadata: Metadata = {
  ...(site ? { metadataBase: new URL(site) } : {}),
  manifest: '/manifest.json',
  title: {
    default: 'Liga Live — прямые трансляции матчей и мероприятий',
    // Через «|», а не тире: заголовки страниц сами содержат тире
    // («Центральный корт — прямой эфир»), и второе подряд читается как опечатка.
    template: '%s | Liga Live',
  },
  description:
    'Прямые трансляции спортивных матчей и мероприятий: живой эфир в HD, чат со зрителями и архив записей. Подключите свою организацию и ведите трансляции с камер или vMix.',
  applicationName: 'Liga Live',
  // canonical здесь НЕ задаём: он унаследовался бы страницами, которые своего
  // не выставили. Для лендинга он живёт в app/(landing)/layout.tsx.
  openGraph: {
    type: 'website',
    siteName: 'Liga Live',
    locale: 'ru_RU',
    title: 'Liga Live — прямые трансляции матчей и мероприятий',
    description:
      'Прямые трансляции спортивных матчей и мероприятий: живой эфир, чат и архив записей.',
    ...(site ? { url: site } : {}),
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Liga Live — прямые трансляции матчей и мероприятий',
    description: 'Живой эфир, чат и архив записей спортивных трансляций.',
  },
  // Коды подтверждения прав в Search Console и Яндекс.Вебмастере. Нужны
  // только тем, кто подтверждается мета-тегом; при подтверждении через DNS
  // остаются пустыми. Как и SITE_URL, читаются на сборке — их значения
  // приезжают build-аргументами (см. apps/web/Dockerfile).
  verification: {
    ...(process.env.GOOGLE_SITE_VERIFICATION ? { google: process.env.GOOGLE_SITE_VERIFICATION } : {}),
    ...(process.env.YANDEX_VERIFICATION ? { yandex: process.env.YANDEX_VERIFICATION } : {}),
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      // Разрешаем показывать превью видео и большие картинки в выдаче —
      // для трансляций это половина кликабельности сниппета.
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-[100dvh] font-sans antialiased">
        {site && <JsonLd data={websiteJsonLd(site)} />}
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
