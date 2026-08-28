import type { Metadata } from 'next';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { LegalBlocks } from '@/components/LegalDocument';
import { FaqHashOpener } from '@/components/FaqHashOpener';
import { LEGAL } from '@/lib/legal';
import { faqItems } from '@/lib/legal-content/faq';

export const metadata: Metadata = {
  title: 'Вопросы и ответы',
  description:
    'Ответы зрителям Liga Live: почему тормозит видео, как переключать камеры, где найти запись матча.',
  alternates: { canonical: '/faq' },
  openGraph: {
    title: 'Вопросы и ответы — Liga Live',
    description: 'Почему тормозит видео, как переключать камеры и где найти запись матча.',
    url: '/faq',
  },
};

export default function FaqPage() {
  return (
    <div className="min-h-[100dvh] flex flex-col bg-surface-primary text-zinc-200">
      <Header />
      <FaqHashOpener />

      <main className="flex-1">
        <div className="max-w-[800px] mx-auto px-6 py-12 md:py-16">
          <header className="mb-10">
            <h1 className="text-2xl md:text-3xl font-bold text-zinc-50 tracking-tight leading-tight mb-3">
              Вопросы и ответы
            </h1>
            <p className="text-sm leading-relaxed text-zinc-400 max-w-[60ch]">
              Всё, что обычно спрашивают зрители: почему подтормаживает видео, как переключить
              камеру и где найти запись вчерашнего матча.
            </p>
          </header>

          <div className="flex flex-col gap-2">
            {faqItems.map((item) => (
              <details
                key={item.id}
                id={item.id}
                className="group scroll-mt-20 bg-surface-elevated border border-zinc-800/60 rounded-xl overflow-hidden"
              >
                <summary className="flex items-center justify-between gap-4 px-5 py-4 cursor-pointer list-none text-sm font-medium text-zinc-200 hover:text-zinc-50 transition-colors [&::-webkit-details-marker]:hidden">
                  {item.question}
                  <svg
                    viewBox="0 0 16 16"
                    aria-hidden="true"
                    className="w-4 h-4 shrink-0 text-zinc-600 transition-transform duration-200 group-open:rotate-180"
                  >
                    <path
                      d="M4 6l4 4 4-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </summary>
                <div className="flex flex-col gap-3 px-5 pt-4 pb-5 border-t border-zinc-800/40">
                  <LegalBlocks blocks={item.answer} />
                </div>
              </details>
            ))}
          </div>

          <section className="mt-10 bg-surface-elevated border border-zinc-800/60 rounded-xl p-5 flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-zinc-100">Не нашли ответ?</h2>
            <p className="text-sm leading-relaxed text-zinc-400">
              Нажмите «Обратная связь» в шапке сайта — к обращению автоматически приложится
              техническая информация о странице, и разобраться получится быстрее. Или напишите на{' '}
              <a
                href={`mailto:${LEGAL.email}`}
                className="text-zinc-300 hover:text-white underline underline-offset-2 transition-colors"
              >
                {LEGAL.email}
              </a>
              .
            </p>
            <p className="text-xs text-zinc-600 mt-1">
              Правила пользования сервисом — в{' '}
              <Link
                href="/legal/terms"
                className="text-zinc-500 hover:text-zinc-300 no-underline transition-colors"
              >
                пользовательском соглашении
              </Link>
              , про данные —{' '}
              <Link
                href="/legal/privacy"
                className="text-zinc-500 hover:text-zinc-300 no-underline transition-colors"
              >
                в политике конфиденциальности
              </Link>
              .
            </p>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
