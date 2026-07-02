'use client';
import { useQuery } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';
import { Header } from '@/components/Header';
import { OrgCard, SkeletonCard } from '@/components/OrgCard';
import { fadeUp, staggerContainer, cardFadeUp } from '@/lib/motion';
import type { CatalogItem } from '@/lib/types';
import { TelevisionSimple } from '@phosphor-icons/react';

/**
 * Архив организован по оргам: карточка ведёт на обзор орги в архивном режиме
 * (`/watch/<orgSlug>?view=archive`) — там ссылки на Stream'ы сразу указывают
 * на их архив, а не на live-просмотр. Глобальная агрегация отдельных записей
 * убрана — новая форма каталога (`CatalogOrgCard`, одна карточка на орг)
 * не несёт данных для этого на уровне списка орг.
 */
export default function ArchivePage() {
  const { data: items, isLoading } = useQuery({
    queryKey: ['catalog'],
    queryFn: () => api.get<CatalogItem[]>('/v1/public/orgs'),
    refetchInterval: 30_000,
  });
  const orgs = items;

  const [thumbKey, setThumbKey] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setThumbKey(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-[100dvh] flex flex-col bg-surface-primary text-zinc-200">
      <Header />

      <main className="flex-1 max-w-[1400px] mx-auto px-4 sm:px-6 py-8 w-full">
        <motion.section initial="hidden" animate="visible" variants={staggerContainer}>
          <motion.h2 variants={fadeUp} className="text-lg font-semibold text-zinc-50 tracking-tight mb-2">
            Архив трансляций
          </motion.h2>
          <motion.p variants={fadeUp} className="text-zinc-500 text-sm mb-5">
            Выберите организацию, чтобы посмотреть записи её трансляций
          </motion.p>

          {isLoading && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
          )}

          {!isLoading && (!orgs || orgs.length === 0) && (
            <motion.div variants={fadeUp} className="flex flex-col items-center justify-center py-20 gap-3 rounded-xl bg-surface-elevated border border-zinc-800/50">
              <TelevisionSimple size={40} className="text-zinc-700" weight="thin" />
              <p className="text-zinc-500 text-sm">Организаций пока нет</p>
            </motion.div>
          )}

          {orgs && orgs.length > 0 && (
            <motion.div variants={staggerContainer} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {orgs.map((item) => (
                <motion.div key={item.orgSlug} variants={cardFadeUp}>
                  <OrgCard org={item} thumbKey={thumbKey} href={`/watch/${item.orgSlug}?view=archive`} />
                </motion.div>
              ))}
            </motion.div>
          )}
        </motion.section>
      </main>
    </div>
  );
}
