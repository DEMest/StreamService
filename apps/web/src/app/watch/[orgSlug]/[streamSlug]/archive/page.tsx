import type { Metadata } from 'next';
import { ArchiveView } from '@/components/ArchiveView';
import { fetchPageMeta, ogImages, siteUrlForPage } from '@/lib/seo';

/**
 * Archive-страница конкретного Stream'а орги.
 *
 * URL `/watch/<orgSlug>/<streamSlug>/archive` — архив именованного Stream'а
 * (`slug != ''`). Список broadcast'ов и плеер recording'а используют
 * endpoint'ы с префиксом `/streams/<streamSlug>`. Для дефолтного Stream'а
 * орги (`slug=''`) — соседний роут `/watch/<orgSlug>/archive`
 * (см. `../archive/page.tsx`).
 */
export async function generateMetadata({
  params,
}: {
  params: { orgSlug: string; streamSlug: string };
}): Promise<Metadata> {
  const site = siteUrlForPage();
  const meta = await fetchPageMeta(params.orgSlug, params.streamSlug);

  if (!meta?.found || !meta.org || !meta.stream) {
    return { title: 'Архив трансляций', robots: { index: false, follow: false } };
  }

  const { org, stream, stats } = meta;
  const title = stream.name || org.name;
  const hasRecordings = stats.finishedBroadcasts > 0;

  return {
    // metadataBase не наследуем из корневого layout: он вычисляется на
    // сборке, а адрес сайта может быть известен только из запроса.
    ...(site ? { metadataBase: new URL(site) } : {}),
    title: `Архив — ${title}`,
    description: `Записи прошедших трансляций «${title}» (${org.name}) на Liga Live.`,
    alternates: { canonical: `/watch/${org.slug}/${stream.slug}/archive` },
    openGraph: {
      title: `Архив — ${title}`,
      description: `Записи прошедших трансляций «${title}».`,
      url: `/watch/${org.slug}/${stream.slug}/archive`,
      images: ogImages(meta.thumbnailPath),
    },
    ...(meta.indexable && hasRecordings ? {} : { robots: { index: false, follow: true } }),
  };
}

export default function ArchiveStreamPage({
  params,
}: {
  params: { orgSlug: string; streamSlug: string };
}) {
  return <ArchiveView orgSlug={params.orgSlug} streamSlug={params.streamSlug} />;
}
