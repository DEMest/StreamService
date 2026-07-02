'use client';
import { OrgOverview } from '@/components/OrgOverview';

/**
 * Обзор орги: список её публичных Stream'ов + опциональный режим совместного
 * просмотра (канвас-компоновка всех live Stream'ов). Больше НЕ проигрывает
 * какой-то конкретный «дефолтный» Stream — для этого используйте
 * `/watch/<orgSlug>/<streamSlug>`.
 */
export default function WatchOrgPage({ params }: { params: { orgSlug: string } }) {
  return <OrgOverview orgSlug={params.orgSlug} />;
}
