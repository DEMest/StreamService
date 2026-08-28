'use client';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle, ChatText, PaperPlaneTilt, Warning, X } from '@phosphor-icons/react';
import { api } from '@/lib/api';
import { LEGAL } from '@/lib/legal';
import { deriveStreamContext, type StreamContext } from '@/lib/feedback-context';

const TOPIC_MAX = 120;
const MESSAGE_MAX = 4000;
const CONTACT_MAX = 200;

const inputClasses =
  'w-full px-3 py-2.5 bg-surface-primary border border-zinc-700 rounded-lg text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-brand focus:ring-1 focus:ring-brand/30 outline-none transition-colors';

interface Props {
  onClose: () => void;
  /** Слаги со страницы просмотра. Точнее адреса, поэтому имеют приоритет. */
  context?: StreamContext;
}

export function FeedbackModal({ onClose, context }: Props) {
  const pathname = usePathname();
  const [topic, setTopic] = useState('');
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState('');
  const [consent, setConsent] = useState(false);
  /** Honeypot: скрыт и от глаз, и от скринридеров — заполнит только бот. */
  const [website, setWebsite] = useState('');

  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSending(true);
    try {
      const derived = deriveStreamContext(pathname ?? '');
      await api.post('/v1/public/feedback', {
        topic,
        message,
        contact,
        website,
        consent,
        consentVersion: LEGAL.version,
        pageUrl: typeof window === 'undefined' ? undefined : window.location.href,
        orgSlug: context?.orgSlug ?? derived.orgSlug,
        streamSlug: context?.streamSlug ?? derived.streamSlug,
      });
      setSent(true);
    } catch (err) {
      setError((err as Error).message || 'Не удалось отправить. Попробуйте ещё раз.');
    } finally {
      setSending(false);
    }
  }

  // Портал в body обязателен. Кнопка живёт внутри боковых панелей плеера, а у
  // них backdrop-blur: любой backdrop-filter делает элемент containing block'ом
  // для position:fixed, и модалка схлопнулась бы в 180-пиксельную панель.
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Обратная связь"
        onClick={(e) => e.stopPropagation()}
        className="relative bg-surface-elevated border border-zinc-800 rounded-xl w-full max-w-md max-h-[90dvh] overflow-y-auto shadow-2xl shadow-black/50"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть"
          className="absolute top-2 right-2 text-zinc-500 hover:text-zinc-200 bg-transparent border-none w-8 h-8 flex items-center justify-center rounded-md cursor-pointer transition-colors z-10"
        >
          <X size={16} />
        </button>

        {sent ? (
          <div className="flex flex-col items-center justify-center text-center gap-4 px-6 py-14">
            <div className="w-14 h-14 rounded-full bg-emerald-500/10 flex items-center justify-center">
              <CheckCircle size={32} className="text-emerald-500" weight="fill" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-zinc-100 mb-1">Спасибо, получили</h2>
              <p className="text-sm text-zinc-500 max-w-xs">
                Разберёмся с этим. Если оставили контакт — напишем, когда починим.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="mt-2 px-6 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm font-medium rounded-lg transition-colors cursor-pointer border-none"
            >
              Закрыть
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-6">
            <div className="flex items-center gap-2.5 pr-8">
              <ChatText size={20} className="text-brand" weight="fill" />
              <h2 className="text-base font-semibold text-zinc-100">Обратная связь</h2>
            </div>
            <p className="text-xs text-zinc-500 -mt-2">
              Что-то тормозит, не грузится или мешает — напишите. Читаем всё.
            </p>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="feedback-topic" className="text-xs font-medium text-zinc-400">
                Тема
              </label>
              <input
                id="feedback-topic"
                autoFocus
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                maxLength={TOPIC_MAX}
                minLength={3}
                required
                placeholder="Например: видео постоянно останавливается"
                className={inputClasses}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="feedback-message" className="text-xs font-medium text-zinc-400">
                Комментарий
              </label>
              <textarea
                id="feedback-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={MESSAGE_MAX}
                minLength={5}
                required
                rows={5}
                placeholder="Что именно происходит и когда началось"
                className={`${inputClasses} resize-y min-h-[110px]`}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="feedback-contact" className="text-xs font-medium text-zinc-400">
                Контакт для ответа <span className="text-zinc-600">— необязательно</span>
              </label>
              <input
                id="feedback-contact"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                maxLength={CONTACT_MAX}
                placeholder="Почта или телеграм"
                className={inputClasses}
              />
            </div>

            {/* Ловушка для ботов. aria-hidden + tabIndex=-1, чтобы её не нашли
                ни скринридер, ни Tab; автозаполнение выключено, чтобы браузер
                не подставил туда что-нибудь за живого человека. Прячем через
                clip, а не смещением за экран: смещение растянуло бы модалку по
                горизонтали и добавило скроллбар. */}
            <input
              type="text"
              name="website"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              style={{
                position: 'absolute',
                width: 1,
                height: 1,
                padding: 0,
                margin: -1,
                border: 0,
                overflow: 'hidden',
                clip: 'rect(0 0 0 0)',
                whiteSpace: 'nowrap',
              }}
            />

            {error && (
              <div className="flex items-start gap-2 text-sm text-red-400">
                <Warning size={16} weight="fill" className="shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                required
                className="mt-0.5 w-4 h-4 shrink-0 accent-brand cursor-pointer"
              />
              <span className="text-xs leading-relaxed text-zinc-500">
                Согласен на обработку персональных данных согласно{' '}
                {/* В новой вкладке: модалку открывают в том числе поверх эфира,
                    и уход на другую страницу оборвал бы просмотр. */}
                <Link
                  href="/legal/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-zinc-400 hover:text-zinc-200 underline underline-offset-2 transition-colors"
                >
                  политике конфиденциальности
                </Link>
                .
              </span>
            </label>

            <button
              type="submit"
              disabled={sending || !consent}
              className="flex items-center justify-center gap-2 w-full px-6 py-2.5 bg-brand hover:bg-brand-hover text-white font-semibold rounded-lg transition-all duration-200 active:scale-[0.98] cursor-pointer border-none disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <PaperPlaneTilt size={16} weight="fill" />
              {sending ? 'Отправляем…' : 'Отправить'}
            </button>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
