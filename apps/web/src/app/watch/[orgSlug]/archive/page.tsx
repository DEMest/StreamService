'use client';
import { ArchiveView } from '@/components/ArchiveView';

/**
 * Archive-страница для default Stream'а орги.
 *
 * Backward-compat: путь `/watch/<orgSlug>/archive`. Логика рендера общего
 * списка broadcast'ов и плеера recording'а вынесена в `ArchiveView`, чтобы
 * переиспользоваться с named Stream archive'ом (`/watch/<orgSlug>/<streamSlug>/archive`).
 */
export default function ArchivePage({ params }: { params: { orgSlug: string } }) {
  return <ArchiveView orgSlug={params.orgSlug} />;
}
