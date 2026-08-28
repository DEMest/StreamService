'use client';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { OrgAvatar } from '@/components/OrgAvatar';
import { fadeUp, staggerContainer, cardFadeUp } from '@/lib/motion';
import { API_BASE, type ArchiveFeedItem } from '@/lib/types';
import { Monitor, Play, VideoCamera } from '@phosphor-icons/react';

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * Архив — плоский список всех записей всех публичных Stream'ов, от новых к
 * старым (глубина 1: без выбора орги/Stream'а на отдельных экранах). Питается
 * `GET /v1/public/broadcasts`. Клик по карточке ведёт на архивную страницу
 * соответствующего Stream'а с `?broadcast=<id>` — она открывает плеер на
 * нужной записи (см. ArchiveView), так что сам проигрыватель не дублируется.
 */
export default function ArchivePage() {
  const { data: items, isLoading } = useQuery({
    queryKey: ['global-archive'],
    queryFn: () => api.get<ArchiveFeedItem[]>('/v1/public/broadcasts'),
    refetchInterval: 30_000,
  });

  const videos = items?.filter((item) => !!item.recording) ?? [];

  return (
    <div className="min-h-[100dvh] flex flex-col bg-surface-primary text-zinc-200">
      <Header />

      <main className="flex-1 max-w-[1400px] mx-auto px-4 sm:px-6 py-8 w-full">
        <motion.section initial="hidden" animate="visible" variants={staggerContainer}>
          <motion.h2 variants={fadeUp} className="text-lg font-semibold text-zinc-50 tracking-tight mb-2">
            Архив трансляций
          </motion.h2>
          <motion.p variants={fadeUp} className="text-zinc-500 text-sm mb-5">
            Все записи, от новых к старым
          </motion.p>

          {isLoading && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {Array.from({ length: 8 }).map((_, i) => <SkeletonVideoCard key={i} />)}
            </div>
          )}

          {!isLoading && videos.length === 0 && (
            <motion.div variants={fadeUp} className="flex flex-col items-center justify-center py-20 gap-3 rounded-xl bg-surface-elevated border border-zinc-800/50">
              <VideoCamera size={40} className="text-zinc-700" weight="thin" />
              <p className="text-zinc-500 text-sm">Записей пока нет</p>
            </motion.div>
          )}

          {videos.length > 0 && (
            <motion.div variants={staggerContainer} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {videos.map((item) => (
                <motion.div key={item.id} variants={cardFadeUp}>
                  <VideoCard item={item} />
                </motion.div>
              ))}
            </motion.div>
          )}
        </motion.section>
      </main>
      <Footer />
    </div>
  );
}

function VideoCard({ item }: { item: ArchiveFeedItem }) {
  const isReady = item.recording?.status === 'ready';
  // Дефолтный Stream орги (slug='') не несёт собственного названия — подпись
  // сокращается до одной орги, чтобы не показывать пустую вторую строку.
  const streamLabel = item.streamSlug !== '' ? (item.streamName || item.streamSlug) : null;
  // Пустой streamSlug — отдельный роут-сосед (см. ArchiveView): пустой
  // URL-сегмент между двумя `/` не матчится Express'ом на бэкенде.
  const archiveHref = item.streamSlug === ''
    ? `/watch/${item.orgSlug}/archive?broadcast=${item.id}`
    : `/watch/${item.orgSlug}/${item.streamSlug}/archive?broadcast=${item.id}`;
  const previewSrc = item.streamSlug === ''
    ? `${API_BASE}/v1/public/orgs/${item.orgSlug}/broadcasts/${item.id}/preview`
    : `${API_BASE}/v1/public/orgs/${item.orgSlug}/streams/${item.streamSlug}/broadcasts/${item.id}/preview`;

  return (
    <Link
      href={archiveHref}
      className="no-underline group block"
    >
      <article
        className={`rounded-xl overflow-hidden border transition-all duration-200 ${
          isReady ? 'active:scale-[0.99]' : ''
        } bg-surface-elevated border-zinc-800/50 hover:border-zinc-700 hover:shadow-lg hover:shadow-black/20`}
      >
        <div className="relative aspect-video bg-zinc-900 overflow-hidden">
          {item.hasPreview ? (
            <ThumbnailImage src={previewSrc} />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <Monitor size={48} className="text-zinc-800" weight="thin" />
            </div>
          )}
          {isReady && item.recording?.duration && (
            <span className="absolute bottom-2 right-2 px-1.5 py-0.5 bg-black/80 text-zinc-300 text-[0.65rem] font-mono rounded">
              {formatTime(item.recording.duration)}
            </span>
          )}
          {isReady ? (
            <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
              <div className="w-12 h-12 rounded-full bg-black/60 flex items-center justify-center">
                <Play size={24} weight="fill" className="text-white" />
              </div>
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-black/70">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900/90 border border-zinc-700/50 rounded-full">
                <div className="w-3 h-3 border-2 border-zinc-600 border-t-zinc-300 rounded-full animate-spin" />
                <span className="text-zinc-300 text-xs">Подготовка</span>
              </div>
            </div>
          )}
        </div>

        <div className="p-4">
          <div className={`font-semibold text-sm transition-colors ${isReady ? 'text-zinc-100 group-hover:text-white' : 'text-zinc-400'}`}>
            {item.title}
          </div>
          <div className="text-zinc-500 text-xs mt-0.5">{formatDate(item.startedAt)}</div>
          <div className="flex items-center gap-1.5 mt-2.5">
            <OrgAvatar orgSlug={item.orgSlug} orgName={item.orgName} size={18} />
            <span className="text-zinc-400 text-xs truncate">
              {item.orgName}
              {streamLabel && <span className="text-zinc-600"> · {streamLabel}</span>}
            </span>
          </div>
        </div>
      </article>
    </Link>
  );
}

function ThumbnailImage({ src }: { src: string }) {
  const [error, setError] = useState(false);
  return error ? (
    <div className="absolute inset-0 flex items-center justify-center">
      <Monitor size={48} className="text-zinc-800" weight="thin" />
    </div>
  ) : (
    <img
      src={src}
      alt=""
      onError={() => setError(true)}
      className="absolute inset-0 w-full h-full object-cover"
    />
  );
}

function SkeletonVideoCard() {
  return (
    <div className="rounded-xl overflow-hidden bg-surface-elevated border border-zinc-800/50 animate-pulse">
      <div className="aspect-video bg-zinc-800" />
      <div className="p-4 space-y-2">
        <div className="h-4 bg-zinc-800 rounded w-3/4" />
        <div className="h-3 bg-zinc-800/60 rounded w-1/2" />
        <div className="h-3 bg-zinc-800/60 rounded w-1/3 mt-2.5" />
      </div>
    </div>
  );
}
