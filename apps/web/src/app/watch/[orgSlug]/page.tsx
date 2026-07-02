'use client';
import { OrgOverview } from '@/components/OrgOverview';

/**
 * Обзор орги: список её публичных Stream'ов + опциональный режим совместного
 * просмотра (канвас-компоновка всех live Stream'ов). Больше НЕ проигрывает
 * какой-то конкретный «дефолтный» Stream — для этого используйте
 * `/watch/<orgSlug>/<streamSlug>`.
 *
 * `?view=archive` — архивный режим: ссылки на Stream'ы ведут сразу в их
 * архив, а не в live-просмотр (используется со страницы `/archive`, чтобы
 * сохранить намерение зрителя при переходе от списка орг).
 */
export default function WatchOrgPage({ params, searchParams }: { params: { orgSlug: string }; searchParams: { view?: string } }) {
  return <OrgOverview orgSlug={params.orgSlug} archiveMode={searchParams.view === 'archive'} />;
}
