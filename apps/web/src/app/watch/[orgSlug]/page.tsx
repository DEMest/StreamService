import type { Metadata } from 'next';
import { OrgOverview } from '@/components/OrgOverview';
import { JsonLd } from '@/components/JsonLd';
import { orgPageJsonLd } from '@/lib/json-ld';
import { fetchPageMeta, siteUrlForPage } from '@/lib/seo';

/**
 * Обзор орги: список её публичных Stream'ов + опциональный режим совместного
 * просмотра (канвас-компоновка всех live Stream'ов). Больше НЕ проигрывает
 * какой-то конкретный «дефолтный» Stream — для этого используйте
 * `/watch/<orgSlug>/<streamSlug>`.
 *
 * `?view=archive` — архивный режим: ссылки на Stream'ы ведут сразу в их
 * архив, а не в live-просмотр (используется со страницы `/archive`, чтобы
 * сохранить намерение зрителя при переходе от списка орг).
 *
 * Сама страница — серверный компонент ради `generateMetadata`: заголовок,
 * описание и решение об индексации приходят из БД. Вся интерактивность
 * по-прежнему в клиентском `OrgOverview`.
 */
export async function generateMetadata({ params }: { params: { orgSlug: string } }): Promise<Metadata> {
  const site = siteUrlForPage();
  const meta = await fetchPageMeta(params.orgSlug);

  if (!meta?.found || !meta.org) {
    // Организации нет или API недоступен — в индекс такую страницу не пускаем.
    return { title: 'Трансляции организации', robots: { index: false, follow: true } };
  }

  const { org, stats } = meta;
  const live = stats.liveCount > 0;
  const description =
    org.description ??
    (live
      ? `${org.name}: прямой эфир прямо сейчас. Смотрите трансляции и записи матчей на Liga Live.`
      : `${org.name}: расписание трансляций и архив записей матчей на Liga Live.`);

  return {
    // metadataBase не наследуем из корневого layout: он вычисляется на
    // сборке, а адрес сайта может быть известен только из запроса.
    ...(site ? { metadataBase: new URL(site) } : {}),
    title: live ? `${org.name} — прямой эфир` : org.name,
    description,
    alternates: { canonical: `/watch/${org.slug}` },
    openGraph: {
      type: 'website',
      title: live ? `${org.name} — прямой эфир` : `${org.name} — трансляции`,
      description,
      url: `/watch/${org.slug}`,
      ...(org.hasImage ? { images: [`/api/v1/public/orgs/${org.slug}/image`] } : {}),
    },
    // Ключ robots добавляем ТОЛЬКО для noindex: явный undefined затёр бы
    // унаследованные из корня max-image-preview/max-video-preview, а без них
    // сниппет трансляции в выдаче лишается превью.
    ...(meta.indexable ? {} : { robots: { index: false, follow: true } }),
  };
}

export default async function WatchOrgPage({
  params,
  searchParams,
}: {
  params: { orgSlug: string };
  searchParams: { view?: string };
}) {
  const site = siteUrlForPage();
  const meta = site ? await fetchPageMeta(params.orgSlug) : null;
  const jsonLd = site && meta?.found && meta.indexable ? orgPageJsonLd(site, meta) : null;

  return (
    <>
      {jsonLd && <JsonLd data={jsonLd} />}
      <OrgOverview orgSlug={params.orgSlug} archiveMode={searchParams.view === 'archive'} />
    </>
  );
}
