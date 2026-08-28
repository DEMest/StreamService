import type { Metadata } from 'next';

/** Админка суперадмина — закрыта от индексации так же, как и кабинет. */
export const metadata: Metadata = {
  title: 'Администрирование',
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
