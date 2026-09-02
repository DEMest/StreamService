import type { Metadata } from 'next';
import { DEFAULT_OG_IMAGE } from '@/lib/seo';

export const metadata: Metadata = {
  title: 'Архив трансляций',
  description:
    'Записи прошедших матчей и мероприятий: полный архив трансляций Liga Live с возможностью смотреть в любое время.',
  alternates: { canonical: '/archive' },
  openGraph: {
    title: 'Архив трансляций',
    description: 'Записи прошедших матчей и мероприятий.',
    url: '/archive',
    images: [DEFAULT_OG_IMAGE],
  },
};

export default function ArchiveLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
