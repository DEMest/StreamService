'use client';
import { WatchView } from '@/components/WatchView';

/**
 * Watch-страница конкретного Stream'а орги.
 *
 * URL `/watch/<orgSlug>/<streamSlug>` — единственный способ посмотреть
 * конкретный Stream орги (орги может иметь несколько Stream'ов).
 *
 * Backend endpoint'ы: `/v1/public/orgs/:orgSlug/streams/:streamSlug/...`.
 * Логика плеера/чата живёт в `WatchView`.
 */
export default function WatchStreamPage({
  params,
}: {
  params: { orgSlug: string; streamSlug: string };
}) {
  return <WatchView orgSlug={params.orgSlug} streamSlug={params.streamSlug} />;
}
