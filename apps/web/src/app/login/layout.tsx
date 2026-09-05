import type { Metadata } from 'next';

/**
 * Логин намеренно открыт для индексации: по запросам вида «лига лайв вход»
 * человек должен попадать на нашу страницу входа, а не на чужой агрегатор.
 * Вес у неё в sitemap низкий (0.3) — она не должна перебивать лендинг.
 */
export const metadata: Metadata = {
  // Ровно тот же текст, что у ссылки в подвале: подпись расширенной ссылки
  // в выдаче Google берётся из заголовка страницы или анкора, и разнобой
  // между ними — лишний повод показать что-то своё.
  title: 'Вход для организаций',
  description:
    'Вход для организаций и администраторов Liga Live: управление трансляциями, ключами вещания, записями и чатом.',
  alternates: { canonical: '/login' },
  openGraph: {
    // Обязателен для Telegram — см. пояснение в app/streams/layout.tsx.
    type: 'website',
    title: 'Вход в личный кабинет Liga Live',
    description: 'Управление трансляциями, записями и настройками организации.',
    url: '/login',
  },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
