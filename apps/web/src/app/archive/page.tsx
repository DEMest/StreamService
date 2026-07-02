'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';
import { Header } from '@/components/Header';
import { fadeUp, staggerContainer, cardFadeUp } from '@/lib/motion';
import type { CatalogItem } from '@/lib/types';
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

/**
 * Запись + контекст Stream'а, к которому она относится. Так как один Stream
 * — атомарная единица архива (broadcasts хранятся per-Stream), здесь хранятся
 * `orgSlug`, `streamSlug` и человекочитаемые имена для отображения.
 */
interface BroadcastWithOrg extends BroadcastItem {
  orgSlug: string;
  streamSlug: string;
  orgName: string;
  streamName: string;
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

  // URL'ы зависят от того, default Stream или named.
  const isNamed = broadcast.streamSlug !== '';
  const thumbPath = isNamed
    ? `/v1/public/orgs/${broadcast.orgSlug}/streams/${broadcast.streamSlug}/thumbnail`
    : `/v1/public/orgs/${broadcast.orgSlug}/thumbnail`;
  const archivePath = isNamed
    ? `/watch/${broadcast.orgSlug}/${broadcast.streamSlug}/archive`
    : `/watch/${broadcast.orgSlug}/archive`;
  const thumbUrl = `${API_BASE}${thumbPath}`;

  // Подпись «организация · стрим»: если у named-Stream'а имя совпадает с
  // именем орги — не дублируем.
  const sourceLabel = broadcast.streamName && broadcast.streamName !== broadcast.orgName
    ? `${broadcast.orgName} · ${broadcast.streamName}`
    : broadcast.orgName;

  return (
    <Link href={archivePath} className="no-underline group">
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
            <span className="text-xs text-brand font-medium truncate">{sourceLabel}</span>
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
  const { data: items, isLoading: orgsLoading } = useQuery({
    queryKey: ['catalog'],
    queryFn: () => api.get<CatalogItem[]>('/v1/public/orgs'),
  });

  // Архив строится поверх Stream'ов (broadcasts хранятся per-Stream).
  const orgs = items ?? [];

  // Stable cache-key — список «orgSlug/streamSlug» строк, иначе query-key
  // меняется по ссылке `orgs` каждый refetch.
  const streamKeys = useMemo(
    () => orgs.map(o => `${o.orgSlug}/${o.streamSlug}`).join(','),
    [orgs],
  );

  const { data: allBroadcasts, isLoading: broadcastsLoading } = useQuery({
    queryKey: ['all-broadcasts', streamKeys],
    queryFn: async () => {
      if (!orgs.length) return [];
      // Fetch broadcasts per Stream (default или named) — endpoint выбирается
      // по streamSlug; для default ('') это `/orgs/<o>/broadcasts`, для named
      // — `/orgs/<o>/streams/<s>/broadcasts`.
      const results = await Promise.all(
        orgs.map(async (org) => {
          const path = org.streamSlug === ''
            ? `/v1/public/orgs/${org.orgSlug}/broadcasts`
            : `/v1/public/orgs/${org.orgSlug}/streams/${org.streamSlug}/broadcasts`;
          try {
            const broadcasts = await api.get<BroadcastItem[]>(path);
            return broadcasts
              .filter(b => b.recording?.status === 'ready')
              .map(b => ({
                ...b,
                orgSlug: org.orgSlug,
                streamSlug: org.streamSlug,
                orgName: org.orgName,
                streamName: org.streamName,
              }));
          } catch {
            return [];
          }
        })
      );
      return results.flat().sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    },
    enabled: orgs.length > 0,
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
                <motion.div key={`${b.orgSlug}/${b.streamSlug}/${b.id}`} variants={cardFadeUp}>
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
