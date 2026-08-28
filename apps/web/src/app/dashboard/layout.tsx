import type { Metadata } from 'next';

/**
 * Кабинет организации за авторизацией — в индексе ему делать нечего.
 * Дублирует Disallow из robots.txt: robots.txt запрещает обход, мета-тег
 * страхует случаи, когда краулер пришёл по внешней ссылке.
 */
export const metadata: Metadata = {
  title: 'Панель управления',
  robots: { index: false, follow: false },
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
