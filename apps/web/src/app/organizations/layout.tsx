import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Организации',
  description:
    'Клубы, лиги и организаторы, которые ведут трансляции на Liga Live. Выберите организацию, чтобы смотреть её эфиры и архив записей.',
  alternates: { canonical: '/organizations' },
  openGraph: {
    title: 'Организации на Liga Live',
    description: 'Клубы, лиги и организаторы, которые ведут трансляции.',
    url: '/organizations',
  },
};

export default function OrganizationsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
