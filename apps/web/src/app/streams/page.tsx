'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';
import { Header } from '@/components/Header';
import { OrgCard, SkeletonCard } from '@/components/OrgCard';
import { fadeUp, staggerContainer, cardFadeUp } from '@/lib/motion';
import type { CatalogOrg } from '@/lib/types';
import { API_BASE } from '@/lib/types';
import { Broadcast, Monitor, TelevisionSimple } from '@phosphor-icons/react';

function FeaturedStream({ org, thumbKey }: { org: CatalogOrg; thumbKey: number }) {
  const [imgError, setImgError] = useState(false);
  const hasThumbnail = org.isLive || org.hasCustomPreview;
  const thumbUrl = hasThumbnail ? `${API_BASE}/v1/public/orgs/${org.slug}/thumbnail?t=${thumbKey}` : null;

  useEffect(() => { setImgError(false); }, [thumbKey]);

  return (
    <Link href={`/watch/${org.slug}`} className="no-underline group block">
      <div className="relative rounded-xl overflow-hidden aspect-[21/9] bg-zinc-900 border border-zinc-800/50 hover:border-zinc-700 transition-all duration-300">
        {thumbUrl && !imgError ? (
          <img
            src={thumbUrl}
            alt={org.name}
            onError={() => setImgError(true)}
            className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-700"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <Monitor size={64} className="text-zinc-800" weight="thin" />
          </div>
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

        <div className="absolute bottom-0 inset-x-0 p-6 md:p-8">
          {org.isLive && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-brand text-white text-xs font-bold uppercase tracking-wider rounded-md mb-3 shadow-lg shadow-brand/30">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              Live
            </span>
          )}
          <h2 className="text-xl md:text-2xl font-bold text-white mb-1 group-hover:text-zinc-100 transition-colors">{org.name}</h2>
          {org.streamTitle && <p className="text-sm text-zinc-300">{org.streamTitle}</p>}
        </div>
      </div>
    </Link>
  );
}

function FeaturedSkeleton() {
  return (
    <div className="rounded-xl overflow-hidden bg-surface-elevated border border-zinc-800/50 animate-pulse">
      <div className="aspect-[21/9] bg-zinc-800" />
    </div>
  );
}

export default function StreamsPage() {
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
  const offline = data?.filter((o) => !o.isLive) ?? [];
  const featured = live[0] ?? offline[0] ?? null;
  const remainingLive = featured?.isLive ? live.slice(1) : live;

  return (
    <div className="min-h-[100dvh] flex flex-col bg-surface-primary text-zinc-200">
      <Header />

      <main className="flex-1 max-w-[1400px] mx-auto px-6 py-8 w-full">
        {/* Featured */}
        {isLoading ? (
          <FeaturedSkeleton />
        ) : featured ? (
          <motion.div initial="hidden" animate="visible" variants={fadeUp}>
            <FeaturedStream org={featured} thumbKey={thumbKey} />
          </motion.div>
        ) : null}

        {/* Empty state */}
        {!isLoading && !data?.length && (
          <motion.div
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            className="flex flex-col items-center justify-center py-24 gap-3 opacity-50"
          >
            <TelevisionSimple size={48} className="text-zinc-600" weight="thin" />
            <p className="text-zinc-500 text-sm">Сейчас нет доступных трансляций</p>
            <Link href="/" className="text-brand text-sm no-underline hover:text-brand-hover transition-colors mt-2">
              На главную
            </Link>
          </motion.div>
        )}

        {/* Live now */}
        {remainingLive.length > 0 && (
          <motion.section
            className="mt-10"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={staggerContainer}
          >
            <motion.h2 variants={fadeUp} className="flex items-center gap-2 text-sm font-medium text-brand mb-5">
              <Broadcast size={14} weight="fill" className="animate-pulse" />
              Сейчас в эфире
            </motion.h2>
            <motion.div variants={staggerContainer} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {remainingLive.map((org) => (
                <motion.div key={org.slug} variants={cardFadeUp}>
                  <OrgCard org={org} thumbKey={thumbKey} />
                </motion.div>
              ))}
            </motion.div>
          </motion.section>
        )}

        {/* All organizations */}
        {offline.length > 0 && (
          <motion.section
            className="mt-10"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={staggerContainer}
          >
            <motion.h2 variants={fadeUp} className="text-sm font-medium text-zinc-500 mb-5">
              Все организации
            </motion.h2>
            <motion.div variants={staggerContainer} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {offline.map((org) => (
                <motion.div key={org.slug} variants={cardFadeUp}>
                  <OrgCard org={org} thumbKey={thumbKey} />
                </motion.div>
              ))}
            </motion.div>
          </motion.section>
        )}
      </main>

      <footer className="border-t border-zinc-800/40 py-6">
        <div className="max-w-[1400px] mx-auto px-6 flex items-center justify-between">
          <span className="text-xs text-zinc-600">&copy; {new Date().getFullYear()} StreamService</span>
          <Link href="/" className="text-xs text-zinc-600 hover:text-zinc-400 no-underline transition-colors">На главную</Link>
        </div>
      </footer>
    </div>
  );
}
