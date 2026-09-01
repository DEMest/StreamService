'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { MagnifyingGlass, Broadcast, TelevisionSimple, Buildings, FilmSlate } from '@phosphor-icons/react';
import { api } from '@/lib/api';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { fadeUp, staggerContainer, cardFadeUp } from '@/lib/motion';

interface SearchResults {
  query: string;
  organizations: Array<{ orgSlug: string; orgName: string; hasImage: boolean; liveCount: number }>;
  streams: Array<{ orgSlug: string; orgName: string; streamSlug: string; streamName: string; isLive: boolean }>;
  broadcasts: Array<{
    id: string;
    title: string;
    startedAt: string;
    orgSlug: string;
    orgName: string;
    streamSlug: string;
    streamName: string;
  }>;
}

/** Пауза перед запросом: печатающий человек делает 3–5 нажатий в секунду. */
const DEBOUNCE_MS = 300;

export function SearchView() {
  const router = useRouter();
  const params = useSearchParams();
  const initial = params.get('q') ?? '';

  const [input, setInput] = useState(initial);
  const [query, setQuery] = useState(initial);

  // Ввод и адресная строка расходятся на время debounce: в URL уезжает уже
  // «осевший» запрос, чтобы историю браузера не засыпало каждой буквой.
  useEffect(() => {
    const id = setTimeout(() => {
      setQuery(input);
      const next = input.trim() ? `/search?q=${encodeURIComponent(input.trim())}` : '/search';
      router.replace(next, { scroll: false });
    }, DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [input, router]);

  const trimmed = query.trim();
  const { data, isFetching } = useQuery({
    queryKey: ['search', trimmed],
    queryFn: () => api.get<SearchResults>(`/v1/public/search?q=${encodeURIComponent(trimmed)}`),
    enabled: trimmed.length >= 2,
  });

  const total = data ? data.organizations.length + data.streams.length + data.broadcasts.length : 0;

  return (
    <div className="min-h-[100dvh] flex flex-col bg-surface-primary text-zinc-200">
      <Header />

      <main className="flex-1 max-w-[1000px] mx-auto px-4 sm:px-6 py-8 w-full">
        <motion.section initial="hidden" animate="visible" variants={staggerContainer} className="flex flex-col gap-6">
          <motion.div variants={fadeUp} className="flex flex-col gap-2">
            <h1 className="flex items-center gap-2 text-lg font-semibold text-zinc-50 tracking-tight">
              <MagnifyingGlass size={18} weight="bold" className="text-brand" />
              Поиск
            </h1>
            <label className="relative block">
              <span className="sr-only">Что ищем</span>
              <MagnifyingGlass
                size={18}
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"
              />
              <input
                autoFocus
                type="search"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Организация, трансляция или матч"
                className="w-full rounded-xl bg-surface-elevated border border-zinc-800/60 pl-11 pr-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-brand/60 focus:ring-1 focus:ring-brand/40 transition-colors"
              />
            </label>
          </motion.div>

          {trimmed.length > 0 && trimmed.length < 2 && (
            <motion.p variants={fadeUp} className="text-sm text-zinc-500">
              Введите хотя бы два символа.
            </motion.p>
          )}

          {trimmed.length >= 2 && !isFetching && total === 0 && (
            <motion.div
              variants={fadeUp}
              className="flex flex-col items-center justify-center py-16 gap-3 rounded-xl bg-surface-elevated border border-zinc-800/50"
            >
              <TelevisionSimple size={40} className="text-zinc-700" weight="thin" />
              <p className="text-zinc-500 text-sm">По запросу «{trimmed}» ничего не нашлось</p>
              <Link href="/archive" className="text-brand text-sm no-underline hover:text-brand-hover transition-colors">
                Посмотреть весь архив
              </Link>
            </motion.div>
          )}

          {data && data.organizations.length > 0 && (
            <Group title="Организации" icon={<Buildings size={16} weight="fill" className="text-zinc-500" />}>
              {data.organizations.map((org) => (
                <Row
                  key={org.orgSlug}
                  href={`/watch/${org.orgSlug}`}
                  title={org.orgName}
                  subtitle={org.liveCount > 0 ? `В эфире: ${org.liveCount}` : 'Сейчас не вещает'}
                  live={org.liveCount > 0}
                />
              ))}
            </Group>
          )}

          {data && data.streams.length > 0 && (
            <Group title="Трансляции" icon={<Broadcast size={16} weight="fill" className="text-zinc-500" />}>
              {data.streams.map((s) => (
                <Row
                  key={`${s.orgSlug}/${s.streamSlug}`}
                  href={`/watch/${s.orgSlug}/${s.streamSlug}`}
                  title={s.streamName}
                  subtitle={s.orgName}
                  live={s.isLive}
                />
              ))}
            </Group>
          )}

          {data && data.broadcasts.length > 0 && (
            <Group title="Записи" icon={<FilmSlate size={16} weight="fill" className="text-zinc-500" />}>
              {data.broadcasts.map((b) => (
                <Row
                  key={b.id}
                  href={`/watch/${b.orgSlug}/${b.streamSlug}/archive`}
                  title={b.title}
                  subtitle={`${b.orgName} · ${new Date(b.startedAt).toLocaleDateString('ru-RU')}`}
                />
              ))}
            </Group>
          )}
        </motion.section>
      </main>
      <Footer />
    </div>
  );
}

function Group({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <motion.div variants={fadeUp} className="flex flex-col gap-2">
      <h2 className="flex items-center gap-2 text-xs uppercase tracking-wider text-zinc-500 font-medium">
        {icon}
        {title}
      </h2>
      <motion.div variants={staggerContainer} className="flex flex-col gap-2">
        {children}
      </motion.div>
    </motion.div>
  );
}

function Row({ href, title, subtitle, live }: { href: string; title: string; subtitle: string; live?: boolean }) {
  return (
    <motion.div variants={cardFadeUp}>
      <Link
        href={href}
        className="flex items-center justify-between gap-4 rounded-xl bg-surface-elevated border border-zinc-800/50 px-4 py-3 no-underline hover:border-zinc-700 transition-colors"
      >
        <span className="min-w-0">
          <span className="block text-sm text-zinc-100 truncate">{title}</span>
          <span className="block text-xs text-zinc-500 truncate">{subtitle}</span>
        </span>
        {live && (
          <span className="shrink-0 inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-brand">
            <span className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse" />
            Эфир
          </span>
        )}
      </Link>
    </motion.div>
  );
}
