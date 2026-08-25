'use client';
import { ArchiveView } from '@/components/ArchiveView';

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
export default function ArchiveDefaultStreamPage({
  params,
}: {
  params: { orgSlug: string };
}) {
  return <ArchiveView orgSlug={params.orgSlug} streamSlug="" />;
}
