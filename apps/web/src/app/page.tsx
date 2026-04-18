'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { Header } from '@/components/Header';
import {
  Broadcast, Monitor, TelevisionSimple, VideoCamera,
  ChatCircle, Archive, ShieldCheck, Gauge, Globe,
  PaperPlaneTilt, CheckCircle, ArrowRight, Envelope,
  Phone, Buildings, User,
} from '@phosphor-icons/react';

/* ───────────────────── Types ───────────────────── */
interface CatalogOrg {
  slug: string;
  name: string;
  isLive: boolean;
  streamTitle: string;
  previewMode: string;
  hasCustomPreview: boolean;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';

/* ───────────────────── OrgCard ───────────────────── */
function OrgCard({ org, thumbKey }: { org: CatalogOrg; thumbKey: number }) {
  const [imgError, setImgError] = useState(false);
  const hasThumbnail = org.isLive || org.hasCustomPreview;
  const thumbUrl = hasThumbnail ? `${API_BASE}/v1/public/orgs/${org.slug}/thumbnail?t=${thumbKey}` : null;

  useEffect(() => { setImgError(false); }, [thumbKey]);

  return (
    <Link href={`/watch/${org.slug}`} className="no-underline group">
      <article
        className={`rounded-xl overflow-hidden border transition-all duration-200 active:scale-[0.99] ${
          org.isLive
            ? 'bg-surface-elevated border-brand/20 hover:border-brand/40 hover:shadow-lg hover:shadow-brand/5'
            : 'bg-surface-elevated border-zinc-800/50 hover:border-zinc-700 hover:shadow-lg hover:shadow-black/20'
        }`}
      >
        <div className="relative aspect-video bg-zinc-900 overflow-hidden">
          {thumbUrl && !imgError ? (
            <img src={thumbUrl} alt={org.name} onError={() => setImgError(true)}
              className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <Monitor size={48} className="text-zinc-800" weight="thin" />
            </div>
          )}
          {org.isLive && (
            <span className="absolute top-3 left-3 px-2 py-0.5 bg-brand text-white text-[0.65rem] font-bold uppercase tracking-wider rounded-md shadow-lg shadow-brand/30">
              Live
            </span>
          )}
        </div>
        <div className="p-4">
          <p className={`font-semibold text-sm group-hover:text-white transition-colors ${org.isLive ? 'text-zinc-100' : 'text-zinc-300'}`}>
            {org.name}
          </p>
          {org.streamTitle && <p className="text-xs text-zinc-500 mt-0.5 truncate">{org.streamTitle}</p>}
        </div>
      </article>
    </Link>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-xl overflow-hidden bg-surface-elevated border border-zinc-800/50 animate-pulse">
      <div className="aspect-video bg-zinc-800" />
      <div className="p-4 space-y-2">
        <div className="h-4 bg-zinc-800 rounded w-3/4" />
        <div className="h-3 bg-zinc-800/60 rounded w-1/2" />
      </div>
    </div>
  );
}

/* ───────────────────── Feature Card ───────────────────── */
function FeatureCard({ icon: Icon, title, desc }: { icon: React.ElementType; title: string; desc: string }) {
  return (
    <div className="p-6 rounded-xl bg-surface-elevated border border-zinc-800/40 hover:border-zinc-700/60 transition-colors group">
      <div className="w-10 h-10 rounded-lg bg-brand/10 flex items-center justify-center mb-4 group-hover:bg-brand/15 transition-colors">
        <Icon size={22} className="text-brand" weight="duotone" />
      </div>
      <h3 className="text-sm font-semibold text-zinc-100 mb-1.5">{title}</h3>
      <p className="text-xs text-zinc-500 leading-relaxed">{desc}</p>
    </div>
  );
}

/* ───────────────────── Contact Form ───────────────────── */
function ContactForm() {
  const [form, setForm] = useState({ org: '', name: '', email: '', phone: '', message: '' });
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
  }

  const inputClasses = 'w-full px-4 py-3 bg-surface-primary border border-zinc-700 rounded-lg text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-brand focus:ring-1 focus:ring-brand/30 outline-none transition-colors';

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
        <input
          value={form.org}
          onChange={(e) => setForm((f) => ({ ...f, org: e.target.value }))}
          placeholder="Название организации"
          className={inputClasses}
          required
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-zinc-400 flex items-center gap-1.5">
          <User size={12} /> Контактное лицо
        </label>
        <input
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="Имя и фамилия"
          className={inputClasses}
          required
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-zinc-400 flex items-center gap-1.5">
          <Envelope size={12} /> Email
        </label>
        <input
          type="email"
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          placeholder="email@example.com"
          className={inputClasses}
          required
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-zinc-400 flex items-center gap-1.5">
          <Phone size={12} /> Телефон
        </label>
        <input
          type="tel"
          value={form.phone}
          onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
          placeholder="+7 (___) ___-__-__"
          className={inputClasses}
        />
      </div>

      <div className="flex flex-col gap-1.5 md:col-span-2">
        <label className="text-xs font-medium text-zinc-400">Сообщение</label>
        <textarea
          value={form.message}
          onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
          placeholder="Расскажите о вашем мероприятии или задайте вопрос"
          rows={3}
          className={`${inputClasses} resize-y min-h-[80px]`}
        />
      </div>

      <div className="md:col-span-2">
        <button
          type="submit"
          className="flex items-center justify-center gap-2 w-full md:w-auto px-8 py-3 bg-brand hover:bg-brand-hover text-white font-semibold rounded-lg transition-all duration-200 active:scale-[0.98] cursor-pointer"
        >
          <PaperPlaneTilt size={18} weight="fill" />
          Отправить заявку
        </button>
      </div>
    </form>
  );
}

/* ───────────────────── Main Page ───────────────────── */
export default function HomePage() {
  const { data, isLoading } = useQuery({
    queryKey: ['catalog'],
    queryFn: () => api.get<CatalogOrg[]>('/v1/public/orgs'),
    refetchInterval: 30_000,
  });

  const [thumbKey, setThumbKey] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setThumbKey(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  const live = data?.filter((o) => o.isLive) ?? [];
  const all = data ?? [];

  return (
    <div className="min-h-[100dvh] flex flex-col bg-surface-primary text-zinc-200">
      <Header />

      {/* ── Hero ────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        {/* Decorative blobs */}
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-brand/5 rounded-full blur-[120px] -translate-y-1/2" />
        <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-brand/3 rounded-full blur-[100px] translate-y-1/2" />

        <div className="relative max-w-[1400px] mx-auto px-6 py-20 md:py-32">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 mb-6">
              <span className="flex items-center gap-1.5 px-3 py-1 bg-brand/10 border border-brand/20 rounded-full text-xs font-medium text-brand">
                <Broadcast size={12} weight="fill" className="animate-pulse" />
                Стриминговая платформа
              </span>
            </div>

            <h1 className="text-4xl md:text-5xl font-bold text-zinc-50 tracking-tight leading-[1.1] mb-5">
              Прямые трансляции спортивных мероприятий
            </h1>

            <p className="text-base md:text-lg text-zinc-400 leading-relaxed mb-8 max-w-lg">
              StreamService — профессиональная платформа для организаций, проводящих спортивные события. Мультикамерный стриминг, чат со зрителями и полный архив записей.
            </p>

            <div className="flex flex-wrap gap-3">
              <a
                href="#contact"
                className="flex items-center gap-2 px-6 py-3 bg-brand hover:bg-brand-hover text-white font-semibold rounded-lg transition-all duration-200 active:scale-[0.98] no-underline"
              >
                Подключить организацию
                <ArrowRight size={16} weight="bold" />
              </a>
              <a
                href="#streams"
                className="flex items-center gap-2 px-6 py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium rounded-lg transition-all duration-200 active:scale-[0.98] no-underline"
              >
                Смотреть трансляции
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── Features ───────────────────────────────────────── */}
      <section className="py-16 md:py-24 border-t border-zinc-800/40">
        <div className="max-w-[1400px] mx-auto px-6">
          <div className="mb-10">
            <h2 className="text-2xl font-bold text-zinc-50 tracking-tight mb-2">Возможности платформы</h2>
            <p className="text-sm text-zinc-500 max-w-md">Всё необходимое для профессиональных спортивных трансляций в одном месте</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <FeatureCard
              icon={VideoCamera}
              title="Мультикамерный стриминг"
              desc="До 4 камер в одном потоке. Зрители переключают ракурсы прямо в браузере без задержки."
            />
            <FeatureCard
              icon={ChatCircle}
              title="Чат в реальном времени"
              desc="Встроенный чат для каждой трансляции. Зрители общаются и обсуждают происходящее на экране."
            />
            <FeatureCard
              icon={Archive}
              title="Архив записей"
              desc="Все трансляции автоматически сохраняются. Зрители могут пересмотреть любой момент в любое время."
            />
            <FeatureCard
              icon={Gauge}
              title="4K без транскодинга"
              desc="Прямая трансляция в максимальном качестве. SRT-протокол обеспечивает минимальную задержку."
            />
            <FeatureCard
              icon={ShieldCheck}
              title="Приватные трансляции"
              desc="Ограничение доступа по ссылке с ключом. Контролируйте, кто может смотреть ваши мероприятия."
            />
            <FeatureCard
              icon={Globe}
              title="Работает везде"
              desc="Браузерный плеер без установки приложений. Полная поддержка мобильных устройств и планшетов."
            />
          </div>
        </div>
      </section>

      {/* ── Live Streams ───────────────────────────────────── */}
      <section id="streams" className="py-16 md:py-24 border-t border-zinc-800/40">
        <div className="max-w-[1400px] mx-auto px-6">
          <div className="mb-10">
            <h2 className="text-2xl font-bold text-zinc-50 tracking-tight mb-2">Трансляции</h2>
            <p className="text-sm text-zinc-500">Смотрите спортивные мероприятия прямо сейчас</p>
          </div>

          {isLoading && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
          )}

          {!isLoading && all.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 opacity-50">
              <TelevisionSimple size={48} className="text-zinc-600" weight="thin" />
              <p className="text-zinc-500 text-sm">Сейчас нет активных трансляций</p>
            </div>
          )}

          {live.length > 0 && (
            <div className="mb-8">
              <h3 className="flex items-center gap-2 text-sm font-medium text-brand mb-4">
                <Broadcast size={14} weight="fill" className="animate-pulse" />
                Сейчас в эфире
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {live.map((org) => <OrgCard key={org.slug} org={org} thumbKey={thumbKey} />)}
              </div>
            </div>
          )}

          {all.filter(o => !o.isLive).length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-zinc-500 mb-4">Все организации</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {all.filter(o => !o.isLive).map((org) => <OrgCard key={org.slug} org={org} thumbKey={thumbKey} />)}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── Contact Form ───────────────────────────────────── */}
      <section id="contact" className="py-16 md:py-24 border-t border-zinc-800/40">
        <div className="max-w-[800px] mx-auto px-6">
          <div className="mb-10">
            <h2 className="text-2xl font-bold text-zinc-50 tracking-tight mb-2">Подключите вашу организацию</h2>
            <p className="text-sm text-zinc-500 max-w-md">Оставьте заявку и мы свяжемся с вами для обсуждения деталей подключения к платформе</p>
          </div>

          <div className="bg-surface-elevated border border-zinc-800/50 rounded-xl p-6 md:p-8">
            <ContactForm />
          </div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────── */}
      <footer className="border-t border-zinc-800/40 py-8">
        <div className="max-w-[1400px] mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <span className="text-xs text-zinc-600">&copy; {new Date().getFullYear()} StreamService. Все права защищены.</span>
          <div className="flex items-center gap-4">
            <Link href="/login" className="text-xs text-zinc-600 hover:text-zinc-400 no-underline transition-colors">Вход для организаций</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
