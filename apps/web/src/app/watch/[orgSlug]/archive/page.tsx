import type { Metadata } from 'next';
import { ArchiveView } from '@/components/ArchiveView';
import { fetchPageMeta } from '@/lib/seo';

/**
 * Archive-страница дефолтного Stream'а орги (`slug=''`).
 *
 * URL `/watch/<orgSlug>/archive` — архив орги без явного streamSlug'а в
 * пути (пустой URL-сегмент между двумя `/` не матчится Express'ом на
 * бэкенде, поэтому это отдельный роут-сосед `/watch/<orgSlug>/<streamSlug>/archive`,
 * а не тот же файл с пустым параметром). ArchiveView сама переключает
 * endpoint'ы на `/v1/public/orgs/<org>/broadcasts...` (без `/streams/<slug>`),
 * когда streamSlug — пустая строка.
 */
export async function generateMetadata({ params }: { params: { orgSlug: string } }): Promise<Metadata> {
  const meta = await fetchPageMeta(params.orgSlug);

  if (!meta?.found || !meta.org) {
    return { title: 'Архив трансляций', robots: { index: false, follow: true } };
  }

  const { org, stats } = meta;
  // Пустой архив в индексе бесполезен: страница есть, смотреть нечего.
  const hasRecordings = stats.finishedBroadcasts > 0;

  return {
    title: `Архив трансляций — ${org.name}`,
    description: `Записи прошедших трансляций ${org.name}: матчи и мероприятия в записи на Liga Live.`,
    alternates: { canonical: `/watch/${org.slug}/archive` },
    openGraph: {
      title: `Архив трансляций — ${org.name}`,
      description: `Записи прошедших трансляций ${org.name}.`,
      url: `/watch/${org.slug}/archive`,
    },
    ...(meta.indexable && hasRecordings ? {} : { robots: { index: false, follow: true } }),
  };
}

export default function ArchiveDefaultStreamPage({
  params,
}: {
  params: { orgSlug: string };
}) {
  return <ArchiveView orgSlug={params.orgSlug} streamSlug="" />;
}
