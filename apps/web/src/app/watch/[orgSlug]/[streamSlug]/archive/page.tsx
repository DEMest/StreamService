'use client';
import { ArchiveView } from '@/components/ArchiveView';

/**
 * Archive-страница для named Stream'а орги (slug ≠ '').
 *
 * URL `/watch/<orgSlug>/<streamSlug>/archive` — Step 4 (multi-stream). Список
 * broadcast'ов и плеер recording'а используют те же endpoint'ы, что и default,
 * но с префиксом `/streams/<streamSlug>`.
 */
export default function ArchiveStreamPage({
  params,
}: {
  params: { orgSlug: string; streamSlug: string };
}) {
  return <ArchiveView orgSlug={params.orgSlug} streamSlug={params.streamSlug} />;
}
