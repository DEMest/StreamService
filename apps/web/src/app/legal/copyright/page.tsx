import type { Metadata } from 'next';
import { LegalDocument } from '@/components/LegalDocument';
import { copyrightDoc } from '@/lib/legal-content/copyright';

export const metadata: Metadata = {
  title: 'Правообладателям — Liga Live',
  description:
    'Реквизиты владельца сайта, требования к заявлению правообладателя и сроки его рассмотрения.',
};

export default function CopyrightPage() {
  return <LegalDocument doc={copyrightDoc} />;
}
