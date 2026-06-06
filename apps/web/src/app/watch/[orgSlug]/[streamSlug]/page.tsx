'use client';
import { WatchView } from '@/components/WatchView';

/**
 * Watch-страница для named Stream'а орги (slug ≠ '').
 *
 * URL `/watch/<orgSlug>/<streamSlug>` — введён в Step 4 (multi-stream). Орга
 * может иметь несколько Stream'ов помимо default'а; каждый named Stream
 * адресуется через явный сегмент `<streamSlug>`.
 *
 * Backend endpoint'ы: `/v1/public/orgs/:orgSlug/streams/:streamSlug/...`.
 * Логика плеера/чата живёт в `WatchView`, который сам подстраивает API base
 * path и линки по наличию streamSlug.
 */
export default function WatchStreamPage({
  params,
}: {
  params: { orgSlug: string; streamSlug: string };
}) {
  return <WatchView orgSlug={params.orgSlug} streamSlug={params.streamSlug} />;
}
