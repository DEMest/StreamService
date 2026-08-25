'use client';
import { ArchiveView } from '@/components/ArchiveView';

/**
 * Archive-страница конкретного Stream'а орги.
 *
 * URL `/watch/<orgSlug>/<streamSlug>/archive` — архив именованного Stream'а
 * (`slug != ''`). Список broadcast'ов и плеер recording'а используют
 * endpoint'ы с префиксом `/streams/<streamSlug>`. Для дефолтного Stream'а
 * орги (`slug=''`) — соседний роут `/watch/<orgSlug>/archive`
 * (см. `../archive/page.tsx`).
 */
export default function ArchiveStreamPage({
  params,
}: {
  params: { orgSlug: string; streamSlug: string };
}) {
  return <ArchiveView orgSlug={params.orgSlug} streamSlug={params.streamSlug} />;
}
