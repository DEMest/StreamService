import type { Metadata } from 'next';

/**
 * Логин намеренно открыт для индексации: по запросам вида «лига лайв вход»
 * человек должен попадать на нашу страницу входа, а не на чужой агрегатор.
 * Вес у неё в sitemap низкий (0.3) — она не должна перебивать лендинг.
 */
export const metadata: Metadata = {
  title: 'Вход в личный кабинет',
  description:
    'Вход для организаций и администраторов Liga Live: управление трансляциями, ключами вещания, записями и чатом.',
  alternates: { canonical: '/login' },
  openGraph: {
    title: 'Вход в личный кабинет Liga Live',
    description: 'Управление трансляциями, записями и настройками организации.',
    url: '/login',
  },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
