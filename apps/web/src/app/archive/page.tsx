'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';
import { Header } from '@/components/Header';
import { fadeUp, staggerContainer, cardFadeUp } from '@/lib/motion';
import type { CatalogOrg } from '@/lib/types';
import { API_BASE } from '@/lib/types';
import { Monitor, TelevisionSimple, Play, CalendarBlank, Clock } from '@phosphor-icons/react';

interface BroadcastItem {
  id: string;
  title: string;
  description?: string;
  startedAt: string;
  endedAt: string;
  recording?: {
    id: string;
    status: string;
    fileSize?: number;
    duration?: number;
  };
}

interface BroadcastWithOrg extends BroadcastItem {
  orgSlug: string;
  orgName: string;
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function ArchiveCard({ broadcast }: { broadcast: BroadcastWithOrg }) {
  const [imgError, setImgError] = useState(false);
  const thumbUrl = `${API_BASE}/v1/public/orgs/${broadcast.orgSlug}/thumbnail`;

  return (
    <Link href={`/watch/${broadcast.orgSlug}/archive`} className="no-underline group">
      <article className="rounded-xl overflow-hidden bg-surface-elevated border border-zinc-800/50 hover:border-zinc-700 hover:shadow-lg hover:shadow-black/20 transition-all duration-200 active:scale-[0.99]">
        <div className="relative aspect-video bg-zinc-900 overflow-hidden">
          {!imgError ? (
            <img
              src={thumbUrl}
              alt={broadcast.title}
              onError={() => setImgError(true)}
              className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <Monitor size={48} className="text-zinc-800" weight="thin" />
            </div>
          )}

          <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <div className="w-11 h-11 rounded-full bg-black/60 flex items-center justify-center backdrop-blur-sm">
              <Play size={20} weight="fill" className="text-white ml-0.5" />
            </div>
          </div>

          {broadcast.recording?.duration && (
            <span className="absolute bottom-2 right-2 px-1.5 py-0.5 bg-black/80 text-zinc-200 text-[0.65rem] font-mono rounded flex items-center gap-1">
              <Clock size={10} />
              {formatTime(broadcast.recording.duration)}
            </span>
          )}
        </div>

        <div className="p-3.5">
          <p className="font-semibold text-sm text-zinc-100 group-hover:text-white transition-colors truncate">
            {broadcast.title}
          </p>
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-xs text-brand font-medium truncate">{broadcast.orgName}</span>
            <span className="text-zinc-700">·</span>
            <span className="text-xs text-zinc-500 flex items-center gap-1 shrink-0">
              <CalendarBlank size={10} />
              {formatDate(broadcast.startedAt)}
            </span>
          </div>
          {broadcast.description && (
            <p className="text-xs text-zinc-600 mt-1 line-clamp-1">{broadcast.description}</p>
          )}
        </div>
      </article>
    </Link>
  );
}

function ArchiveSkeleton() {
  return (
    <div className="rounded-xl overflow-hidden bg-surface-elevated border border-zinc-800/50 animate-pulse">
      <div className="aspect-video bg-zinc-800" />
      <div className="p-3.5 space-y-2">
        <div className="h-4 bg-zinc-800 rounded w-3/4" />
        <div className="h-3 bg-zinc-800/60 rounded w-1/2" />
      </div>
    </div>
  );
}

export default function ArchivePage() {
  const { data: orgs, isLoading: orgsLoading } = useQuery({
    queryKey: ['catalog'],
    queryFn: () => api.get<CatalogOrg[]>('/v1/public/orgs'),
  });

  const orgSlugs = useMemo(() => orgs?.map(o => o.slug) ?? [], [orgs]);

  const { data: allBroadcasts, isLoading: broadcastsLoading } = useQuery({
    queryKey: ['all-broadcasts', orgSlugs],
    queryFn: async () => {
      if (!orgs?.length) return [];
      const results = await Promise.all(
        orgs.map(async (org) => {
          try {
            const broadcasts = await api.get<BroadcastItem[]>(`/v1/public/orgs/${org.slug}/broadcasts`);
            return broadcasts
              .filter(b => b.recording?.status === 'ready')
              .map(b => ({ ...b, orgSlug: org.slug, orgName: org.name }));
          } catch {
            return [];
          }
        })
      );
      return results.flat().sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    },
    enabled: !!orgs?.length,
  });

  const isLoading = orgsLoading || broadcastsLoading;

  return (
    <div className="min-h-[100dvh] flex flex-col bg-surface-primary text-zinc-200">
      <Header />

      <main className="flex-1 max-w-[1400px] mx-auto px-4 sm:px-6 py-8 w-full">
        <motion.section initial="hidden" animate="visible" variants={staggerContainer}>
          <motion.h2 variants={fadeUp} className="text-lg font-semibold text-zinc-50 tracking-tight mb-5">
            Архив трансляций
          </motion.h2>

          {isLoading && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {Array.from({ length: 8 }).map((_, i) => <ArchiveSkeleton key={i} />)}
            </div>
          )}

          {!isLoading && (!allBroadcasts || allBroadcasts.length === 0) && (
            <motion.div variants={fadeUp} className="flex flex-col items-center justify-center py-20 gap-3 rounded-xl bg-surface-elevated border border-zinc-800/50">
              <TelevisionSimple size={40} className="text-zinc-700" weight="thin" />
              <p className="text-zinc-500 text-sm">Записей пока нет</p>
            </motion.div>
          )}

          {allBroadcasts && allBroadcasts.length > 0 && (
            <motion.div variants={staggerContainer} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {allBroadcasts.map((b) => (
                <motion.div key={b.id} variants={cardFadeUp}>
                  <ArchiveCard broadcast={b} />
                </motion.div>
              ))}
            </motion.div>
          )}
        </motion.section>
      </main>
    </div>
  );
}
