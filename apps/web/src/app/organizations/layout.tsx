import type { Metadata } from 'next';
import { DEFAULT_OG_IMAGE } from '@/lib/seo';

export const metadata: Metadata = {
  title: 'Организации',
  description:
    'Клубы, лиги и организаторы, которые ведут трансляции на Liga Live. Выберите организацию, чтобы смотреть её эфиры и архив записей.',
  alternates: { canonical: '/organizations' },
  openGraph: {
    // Обязателен для Telegram — см. пояснение в app/streams/layout.tsx.
    type: 'website',
    title: 'Организации на Liga Live',
    description: 'Клубы, лиги и организаторы, которые ведут трансляции.',
    url: '/organizations',
    images: [DEFAULT_OG_IMAGE],
  },
};

export default function OrganizationsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
