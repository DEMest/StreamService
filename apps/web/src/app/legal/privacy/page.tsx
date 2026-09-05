import type { Metadata } from 'next';
import { LegalDocument } from '@/components/LegalDocument';
import { privacyDoc } from '@/lib/legal-content/privacy';

export const metadata: Metadata = {
  title: 'Политика конфиденциальности',
  description:
    'Какие персональные данные обрабатывает Liga Live, зачем, сколько они хранятся и как их удалить.',
  alternates: { canonical: '/legal/privacy' },
  openGraph: {
    // Обязателен для Telegram — см. пояснение в app/streams/layout.tsx.
    type: 'website',
    title: 'Политика конфиденциальности Liga Live',
    description: 'Состав данных, цели обработки, сроки хранения и права пользователя.',
    url: '/legal/privacy',
  },
};

export default function PrivacyPage() {
  return <LegalDocument doc={privacyDoc} />;
}
