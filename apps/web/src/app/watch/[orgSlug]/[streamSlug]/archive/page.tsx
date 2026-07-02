'use client';
import { ArchiveView } from '@/components/ArchiveView';

/**
 * Archive-страница конкретного Stream'а орги.
 *
 * URL `/watch/<orgSlug>/<streamSlug>/archive` — единственный способ
 * посмотреть архив конкретного Stream'а. Список broadcast'ов и плеер
 * recording'а используют endpoint'ы с префиксом `/streams/<streamSlug>`.
 */
export default function ArchiveStreamPage({
  params,
}: {
  params: { orgSlug: string; streamSlug: string };
}) {
  return <ArchiveView orgSlug={params.orgSlug} streamSlug={params.streamSlug} />;
}
