import type { Metadata } from 'next';
import { WatchView } from '@/components/WatchView';
import { JsonLd } from '@/components/JsonLd';
import { streamPageJsonLd } from '@/lib/json-ld';
import { fetchPageMeta, siteUrlForPage } from '@/lib/seo';

/**
 * Watch-страница конкретного Stream'а орги.
 *
 * URL `/watch/<orgSlug>/<streamSlug>` — единственный способ посмотреть
 * конкретный Stream орги (орги может иметь несколько Stream'ов).
 *
 * Backend endpoint'ы: `/v1/public/orgs/:orgSlug/streams/:streamSlug/...`.
 * Логика плеера/чата живёт в `WatchView`.
 *
 * Здесь же — самая важная для поиска разметка: VideoObject с BroadcastEvent.
 * По ней Google показывает бейдж LIVE в выдаче, и только страницы с этой
 * разметкой разрешено пинговать через Indexing API (см. seo/ в apps/api).
 */
export async function generateMetadata({
  params,
}: {
  params: { orgSlug: string; streamSlug: string };
}): Promise<Metadata> {
  const site = siteUrlForPage();
  const meta = await fetchPageMeta(params.orgSlug, params.streamSlug);

  // Приватный стрим (доступ по ?key=) сюда попадает как found: false —
  // название закрытой трансляции не должно светиться ни в title, ни в поиске.
  if (!meta?.found || !meta.org || !meta.stream) {
    return { title: 'Трансляция', robots: { index: false, follow: false } };
  }

  const { org, stream } = meta;
  const title = stream.name || org.name;
  const description =
    stream.description ??
    (stream.isLive
      ? `«${title}» — прямая трансляция ${org.name} прямо сейчас. Смотреть онлайн на Liga Live.`
      : `«${title}» — трансляции и записи ${org.name} на Liga Live.`);

  return {
    // metadataBase не наследуем из корневого layout: он вычисляется на
    // сборке, а адрес сайта может быть известен только из запроса.
    ...(site ? { metadataBase: new URL(site) } : {}),
    title: stream.isLive ? `${title} — прямой эфир` : title,
    description,
    alternates: { canonical: `/watch/${org.slug}/${stream.slug}` },
    openGraph: {
      type: 'video.other',
      title: stream.isLive ? `${title} — прямой эфир` : title,
      description,
      url: `/watch/${org.slug}/${stream.slug}`,
      // Только реальная картинка: путь к несуществующему превью в og:image
      // даёт пустую карточку при шаринге и «значок недоступен» у Google.
      ...(meta.thumbnailPath ? { images: [meta.thumbnailPath] } : {}),
    },
    // Только для noindex: явный undefined затёр бы унаследованные
    // max-image-preview/max-video-preview, а на них держится видео-сниппет.
    ...(meta.indexable ? {} : { robots: { index: false, follow: true } }),
  };
}

export default async function WatchStreamPage({
  params,
}: {
  params: { orgSlug: string; streamSlug: string };
}) {
  const site = siteUrlForPage();
  const meta = site ? await fetchPageMeta(params.orgSlug, params.streamSlug) : null;
  const jsonLd = site && meta?.found && meta.indexable ? streamPageJsonLd(site, meta) : null;

  return (
    <>
      {jsonLd && <JsonLd data={jsonLd} />}
      <WatchView orgSlug={params.orgSlug} streamSlug={params.streamSlug} />
    </>
  );
}
