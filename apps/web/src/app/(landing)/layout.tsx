import type { Metadata } from 'next';

/**
 * Route group вокруг лендинга нужна ровно ради этого файла: корневой
 * `app/layout.tsx` — общий для ВСЕХ страниц, и заданный там canonical
 * унаследовали бы разделы, которые своего canonical не выставили (в том числе
 * 404 и страницы кабинета). Canonical «эта страница — главная» на чужом
 * адресе — прямой способ выкинуть её из индекса.
 */
export const metadata: Metadata = {
  alternates: { canonical: '/' },
};

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
