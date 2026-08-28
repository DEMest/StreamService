import type { Metadata } from 'next';
import { LegalDocument } from '@/components/LegalDocument';
import { privacyDoc } from '@/lib/legal-content/privacy';

export const metadata: Metadata = {
  title: 'Политика конфиденциальности — Liga Live',
  description:
    'Какие персональные данные обрабатывает Liga Live, зачем, сколько они хранятся и как их удалить.',
};

export default function PrivacyPage() {
  return <LegalDocument doc={privacyDoc} />;
}
