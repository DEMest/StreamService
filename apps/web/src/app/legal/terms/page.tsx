import type { Metadata } from 'next';
import { LegalDocument } from '@/components/LegalDocument';
import { termsDoc } from '@/lib/legal-content/terms';

export const metadata: Metadata = {
  title: 'Пользовательское соглашение — Liga Live',
  description:
    'Правила пользования Liga Live: права на трансляции, правила чата, ответственность сторон.',
};

export default function TermsPage() {
  return <LegalDocument doc={termsDoc} />;
}
