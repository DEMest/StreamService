'use client';
import { useState } from 'react';
import Link from 'next/link';
import {
  PaperPlaneTilt, CheckCircle, Buildings, User, Envelope, Phone, Warning,
} from '@phosphor-icons/react';
import { api } from '@/lib/api';
import { LEGAL } from '@/lib/legal';

const inputClasses = 'w-full px-4 py-3 bg-surface-primary border border-zinc-700 rounded-lg text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-brand focus:ring-1 focus:ring-brand/30 outline-none transition-colors';

export function ContactForm() {
  const [form, setForm] = useState({ org: '', name: '', email: '', phone: '', message: '' });
  const [consent, setConsent] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // Редакцию политики шлём ту, что показана на этой странице: сервер
      // запишет её рядом с заявкой как доказательство, с чем именно согласились.
      await api.post('/v1/public/contact', { ...form, consent, consentVersion: LEGAL.version });
      setSubmitted(true);
    } catch (err) {
      setError((err as Error).message || 'Не удалось отправить заявку');
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
        <div className="w-14 h-14 rounded-full bg-emerald-500/10 flex items-center justify-center">
          <CheckCircle size={32} className="text-emerald-500" weight="fill" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-zinc-100 mb-1">Заявка отправлена</h3>
          <p className="text-sm text-zinc-500 max-w-sm">Мы свяжемся с вами в ближайшее время для обсуждения подключения к платформе.</p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-zinc-400 flex items-center gap-1.5">
          <Buildings size={12} /> Организация
        </label>
        <input value={form.org} onChange={(e) => setForm((f) => ({ ...f, org: e.target.value }))}
          placeholder="Название организации" className={inputClasses} required />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-zinc-400 flex items-center gap-1.5">
          <User size={12} /> Контактное лицо
        </label>
        <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="Имя и фамилия" className={inputClasses} required />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-zinc-400 flex items-center gap-1.5">
          <Envelope size={12} /> Email
        </label>
        <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          placeholder="email@example.com" className={inputClasses} required />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-zinc-400 flex items-center gap-1.5">
          <Phone size={12} /> Телефон
        </label>
        <input type="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
          placeholder="+7 (___) ___-__-__" className={inputClasses} />
      </div>

      <div className="flex flex-col gap-1.5 md:col-span-2">
        <label className="text-xs font-medium text-zinc-400">Сообщение</label>
        <textarea value={form.message} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
          placeholder="Расскажите о вашем мероприятии или задайте вопрос"
          rows={3} className={`${inputClasses} resize-y min-h-[80px]`} />
      </div>

      {error && (
        <div className="md:col-span-2 flex items-center gap-2 text-sm text-red-400">
          <Warning size={16} weight="fill" className="shrink-0" />
          {error}
        </div>
      )}

      <div className="md:col-span-2">
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            required
            className="mt-0.5 w-4 h-4 shrink-0 accent-brand cursor-pointer"
          />
          <span className="text-xs leading-relaxed text-zinc-500">
            Я согласен на обработку моих персональных данных в соответствии с{' '}
            <Link href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="text-zinc-400 hover:text-zinc-200 underline underline-offset-2 transition-colors">
              политикой конфиденциальности
            </Link>{' '}
            и принимаю{' '}
            <Link href="/legal/terms" target="_blank" rel="noopener noreferrer" className="text-zinc-400 hover:text-zinc-200 underline underline-offset-2 transition-colors">
              пользовательское соглашение
            </Link>
            .
          </span>
        </label>
      </div>

      <div className="md:col-span-2">
        <button type="submit" disabled={submitting || !consent}
          className="flex items-center justify-center gap-2 w-full md:w-auto px-8 py-3 bg-brand hover:bg-brand-hover text-white font-semibold rounded-lg transition-all duration-200 active:scale-[0.98] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
          <PaperPlaneTilt size={18} weight="fill" />
          {submitting ? 'Отправляем...' : 'Отправить заявку'}
        </button>
      </div>
    </form>
  );
}
