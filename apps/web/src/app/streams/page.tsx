'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';
import { Header } from '@/components/Header';
import { OrgCard, SkeletonCard } from '@/components/OrgCard';
import { fadeUp, staggerContainer, cardFadeUp } from '@/lib/motion';
import type { CatalogItem } from '@/lib/types';
import { Broadcast, TelevisionSimple } from '@phosphor-icons/react';

export default function StreamsPage() {
  const { data: items, isLoading } = useQuery({
    queryKey: ['catalog'],
    queryFn: () => api.get<CatalogItem[]>('/v1/public/orgs'),
    refetchInterval: 30_000,
  });

  const [thumbKey, setThumbKey] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setThumbKey(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  // На странице «Трансляции» показываем только live Stream-карточки.
  const live = (items ?? []).filter((it) => it.liveCount > 0);

  return (
    <div className="min-h-[100dvh] flex flex-col bg-surface-primary text-zinc-200">
      <Header />

      <main className="flex-1 max-w-[1400px] mx-auto px-4 sm:px-6 py-8 w-full">
        <motion.section initial="hidden" animate="visible" variants={staggerContainer}>
          <motion.h2 variants={fadeUp} className="flex items-center gap-2 text-lg font-semibold text-zinc-50 tracking-tight mb-5">
            <Broadcast size={18} weight="fill" className="text-brand animate-pulse" />
            Трансляции
          </motion.h2>

          {isLoading && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
          )}

          {!isLoading && live.length === 0 && (
            <motion.div variants={fadeUp} className="flex flex-col items-center justify-center py-20 gap-3 rounded-xl bg-surface-elevated border border-zinc-800/50">
              <TelevisionSimple size={40} className="text-zinc-700" weight="thin" />
              <p className="text-zinc-500 text-sm">Сейчас нет активных трансляций</p>
              <Link href="/archive" className="text-brand text-sm no-underline hover:text-brand-hover transition-colors mt-1">
                Посмотреть записи
              </Link>
            </motion.div>
          )}

          {live.length > 0 && (
            <motion.div variants={staggerContainer} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {live.map((item) => (
                <motion.div key={item.orgSlug} variants={cardFadeUp}>
                  <OrgCard org={item} thumbKey={thumbKey} />
                </motion.div>
              ))}
            </motion.div>
          )}
        </motion.section>
      </main>
    </div>
  );
}
