'use client';
import { useState } from 'react';
import {
  PaperPlaneTilt, CheckCircle, Buildings, User, Envelope, Phone,
} from '@phosphor-icons/react';

const inputClasses = 'w-full px-4 py-3 bg-surface-primary border border-zinc-700 rounded-lg text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-brand focus:ring-1 focus:ring-brand/30 outline-none transition-colors';

export function ContactForm() {
  const [form, setForm] = useState({ org: '', name: '', email: '', phone: '', message: '' });
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
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

      <div className="md:col-span-2">
        <button type="submit"
          className="flex items-center justify-center gap-2 w-full md:w-auto px-8 py-3 bg-brand hover:bg-brand-hover text-white font-semibold rounded-lg transition-all duration-200 active:scale-[0.98] cursor-pointer">
          <PaperPlaneTilt size={18} weight="fill" />
          Отправить заявку
        </button>
      </div>
    </form>
  );
}
