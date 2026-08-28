import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Трансляции',
  description:
    'Все трансляции, которые идут прямо сейчас: живой эфир матчей и мероприятий в HD. Смотреть бесплатно, без регистрации.',
  alternates: { canonical: '/streams' },
  openGraph: {
    title: 'Трансляции в прямом эфире',
    description: 'Матчи и мероприятия, которые идут прямо сейчас.',
    url: '/streams',
  },
};

export default function StreamsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
