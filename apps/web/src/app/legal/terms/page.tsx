import type { Metadata } from 'next';
import { LegalDocument } from '@/components/LegalDocument';
import { termsDoc } from '@/lib/legal-content/terms';

export const metadata: Metadata = {
  title: 'Пользовательское соглашение',
  description:
    'Правила пользования Liga Live: права на трансляции, правила чата, ответственность сторон.',
  alternates: { canonical: '/legal/terms' },
  openGraph: {
    title: 'Пользовательское соглашение Liga Live',
    description: 'Права на трансляции, правила чата и ответственность сторон.',
    url: '/legal/terms',
  },
};

export default function TermsPage() {
  return <LegalDocument doc={termsDoc} />;
}
