'use client';
import { WatchView } from '@/components/WatchView';

/**
 * Watch-страница для default Stream'а орги.
 *
 * Backward-compat: путь `/watch/<orgSlug>` (без сегмента /streams/<slug>) —
 * это исторический URL, который указывает на default Stream орги (slug='').
 *
 * Реальная логика плеера/чата вынесена в `WatchView`, чтобы переиспользоваться
 * между default и named (`/watch/<orgSlug>/<streamSlug>`) route'ами.
 */
export default function WatchPage({ params }: { params: { orgSlug: string } }) {
  return <WatchView orgSlug={params.orgSlug} />;
}
