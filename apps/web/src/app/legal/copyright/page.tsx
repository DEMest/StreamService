import type { Metadata } from 'next';
import { LegalDocument } from '@/components/LegalDocument';
import { copyrightDoc } from '@/lib/legal-content/copyright';

export const metadata: Metadata = {
  title: 'Правообладателям',
  description:
    'Реквизиты владельца сайта, требования к заявлению правообладателя и сроки его рассмотрения.',
  alternates: { canonical: '/legal/copyright' },
  openGraph: {
    title: 'Правообладателям — Liga Live',
    description: 'Куда и как направить заявление о нарушении прав на контент.',
    url: '/legal/copyright',
  },
};

export default function CopyrightPage() {
  return <LegalDocument doc={copyrightDoc} />;
}
