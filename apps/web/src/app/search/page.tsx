import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SearchView } from '@/components/SearchView';

/**
 * Поиск по сайту: организации, трансляции, записи.
 *
 * Страница закрыта от индексации намеренно: результаты поиска — это бесконечный
 * набор адресов с одним и тем же содержимым, поисковики такие страницы считают
 * мусором. При этом сам адрес `/search?q=` остаётся открытым для обхода (в
 * robots.txt он не запрещён) — Google должен иметь возможность зайти по нему и
 * убедиться, что поиск существует, иначе не покажет строку поиска сайта в
 * выдаче (SearchAction в разметке лендинга).
 *
 * `follow` оставлен: со страницы ведут обычные ссылки на трансляции и архив.
 */
export const metadata: Metadata = {
  title: 'Поиск',
  description: 'Поиск трансляций, организаций и записей матчей на Liga Live.',
  robots: { index: false, follow: true },
};

export default function SearchPage() {
  // useSearchParams внутри требует Suspense — иначе сборка Next.js падает на
  // пререндере этой страницы.
  return (
    <Suspense>
      <SearchView />
    </Suspense>
  );
}
