import type { Metadata } from 'next';
import { DEFAULT_OG_IMAGE } from '@/lib/seo';

export const metadata: Metadata = {
  title: 'Трансляции',
  description:
    'Все трансляции, которые идут прямо сейчас: живой эфир матчей и мероприятий в HD. Смотреть бесплатно, без регистрации.',
  alternates: { canonical: '/streams' },
  openGraph: {
    // og:type обязателен по спецификации Open Graph (наравне с title/image/url).
    // VK и большинство парсеров снисходительны и молча считают его "website" по
    // умолчанию, а вот Telegram без явного og:type всю разметку страницы
    // считает невалидной и даже не пытается забрать og:image — картинка не
    // появится в превью, хотя сама она рабочая (проверено логами nginx).
    type: 'website',
    title: 'Трансляции в прямом эфире',
    description: 'Матчи и мероприятия, которые идут прямо сейчас.',
    url: '/streams',
    images: [DEFAULT_OG_IMAGE],
  },
};

export default function StreamsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
