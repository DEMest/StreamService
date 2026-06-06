'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';
import { API_BASE } from '@/lib/types';
import { Header } from '@/components/Header';
import { fadeUp, staggerContainer, cardFadeUp } from '@/lib/motion';
import {
  CaretLeft, Monitor, VideoCamera, CalendarBlank, Clock,
  TelevisionSimple,
} from '@phosphor-icons/react';

/**
 * Public Event landing (Step 5, spec §12 «Viewer UX → Event landing»).
 *
 * URL: `/event/<orgSlug>/<eventSlug>`.
 *
 * Запрос: `GET /v1/public/orgs/:orgSlug/events/:eventSlug` →
 *   {
 *     orgSlug, orgName, eventSlug, title, description, scheduledAt,
 *     startedAt, endedAt, streams: [{ slug, name, isLive, previewMode, hasCustomPreview }]
 *   }
 *
 * Не показываем чат: общий event-чат подключается на самой Watch View
 * (chat.gateway resolveScope автоматически переключит room на event-scope если
 * Stream привязан к активному Event'у — см. spec §9).
 */

interface EventLandingStream {
  slug: string;
  name: string;
  isLive: boolean;
  previewMode: string;
  hasCustomPreview: boolean;
}

interface EventLandingDto {
  orgSlug: string;
  orgName: string;
  eventSlug: string;
  title: string;
  description: string | null;
  scheduledAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  streams: EventLandingStream[];
}

type EventStatus = 'scheduled' | 'active' | 'ended';

function getStatus(ev: EventLandingDto): EventStatus {
  if (ev.endedAt) return 'ended';
  if (ev.startedAt) return 'active';
  return 'scheduled';
}

function formatScheduled(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function EventLandingPage({
  params,
}: {
  params: { orgSlug: string; eventSlug: string };
}) {
  const { orgSlug, eventSlug } = params;

  const { data: ev, isLoading, isError } = useQuery({
    queryKey: ['event-landing', orgSlug, eventSlug],
    queryFn: () =>
      api.get<EventLandingDto>(
        `/v1/public/orgs/${orgSlug}/events/${eventSlug}`,
      ),
    refetchInterval: 15_000,
    retry: false,
  });

  // Cache-buster для thumbnail'ов — обновляем каждые 30s, плюс при появлении
  // нового live-Stream'а (через ev.streams.map(s.isLive) changes).
  const [thumbKey, setThumbKey] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setThumbKey(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  if (isError) {
    return (
      <div className="min-h-[100dvh] flex flex-col bg-surface-primary text-zinc-200">
        <Header />
        <main className="flex-1 flex items-center justify-center px-6">
          <div className="text-center max-w-md">
            <TelevisionSimple size={48} className="text-zinc-700 mx-auto" weight="thin" />
            <h1 className="text-zinc-100 text-xl font-semibold mt-4">Событие не найдено</h1>
            <p className="text-zinc-500 text-sm mt-2">
              Возможно, ссылка устарела или организатор удалил мероприятие.
            </p>
            <Link
              href="/streams"
              className="inline-flex items-center gap-1.5 mt-6 text-brand text-sm no-underline hover:text-brand-hover transition-colors"
            >
              <CaretLeft size={14} /> К трансляциям
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] flex flex-col bg-surface-primary text-zinc-200">
      <Header />

      <main className="flex-1 max-w-[1400px] mx-auto px-4 sm:px-6 py-8 w-full">
        {isLoading || !ev ? (
          <EventLandingSkeleton />
        ) : (
          <EventLandingContent event={ev} thumbKey={thumbKey} />
        )}
      </main>
    </div>
  );
}

function EventLandingContent({ event: ev, thumbKey }: { event: EventLandingDto; thumbKey: number }) {
  const status = getStatus(ev);
  const scheduledText = formatScheduled(ev.scheduledAt);
  const liveCount = ev.streams.filter((s) => s.isLive).length;

  return (
    <motion.div initial="hidden" animate="visible" variants={staggerContainer}>
      {/* Breadcrumb */}
      <motion.div variants={fadeUp} className="mb-5">
        <Link
          href="/streams"
          className="inline-flex items-center gap-1 text-zinc-500 hover:text-zinc-300 text-sm no-underline transition-colors"
        >
          <CaretLeft size={14} />
          Трансляции
        </Link>
      </motion.div>

      {/* Header */}
      <motion.section
        variants={fadeUp}
        className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6 lg:gap-10 items-start mb-10 pb-10 border-b border-zinc-800/50"
      >
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs text-zinc-500 uppercase tracking-wider font-mono">
              {ev.orgName}
            </span>
            <span className="text-zinc-700">·</span>
            <StatusBadge status={status} />
          </div>
          <h1 className="text-3xl md:text-5xl font-bold text-zinc-50 tracking-tight leading-[1.05]">
            {ev.title}
          </h1>
          {ev.description && (
            <p className="text-zinc-400 text-base md:text-lg leading-relaxed mt-5 max-w-[60ch]">
              {ev.description}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-3 lg:items-end">
          {scheduledText && (
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <CalendarBlank size={16} className="text-zinc-500" />
              <span>{scheduledText}</span>
            </div>
          )}
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            <VideoCamera size={16} className="text-zinc-500" />
            <span className="tabular-nums">
              {ev.streams.length} {pluralizeStreams(ev.streams.length)}
            </span>
            {liveCount > 0 && (
              <span className="text-brand font-medium">
                · {liveCount} в эфире
              </span>
            )}
          </div>
        </div>
      </motion.section>

      {/* Streams grid */}
      {ev.streams.length === 0 ? (
        <motion.div
          variants={fadeUp}
          className="flex flex-col items-center justify-center py-20 gap-3 rounded-xl bg-surface-elevated border border-zinc-800/50"
        >
          <TelevisionSimple size={40} className="text-zinc-700" weight="thin" />
          <p className="text-zinc-500 text-sm">Стримы пока не подключены</p>
          <p className="text-zinc-600 text-xs max-w-sm text-center">
            Организатор привязывает камеры к событию в студии. Эта страница обновится
            автоматически когда стримы появятся.
          </p>
        </motion.div>
      ) : (
        <motion.div
          variants={staggerContainer}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5"
        >
          {ev.streams.map((s) => (
            <motion.div key={`${s.slug || 'default'}`} variants={cardFadeUp}>
              <StreamTile
                orgSlug={ev.orgSlug}
                orgName={ev.orgName}
                stream={s}
                thumbKey={thumbKey}
              />
            </motion.div>
          ))}
        </motion.div>
      )}
    </motion.div>
  );
}

function StatusBadge({ status }: { status: EventStatus }) {
  if (status === 'active') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-brand text-white text-[0.65rem] font-bold uppercase tracking-wider">
        <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
        В эфире
      </span>
    );
  }
  if (status === 'ended') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-400 text-[0.65rem] font-semibold uppercase tracking-wider">
        Завершено
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-zinc-800/60 border border-zinc-700/60 text-zinc-300 text-[0.65rem] font-semibold uppercase tracking-wider">
      <Clock size={10} weight="bold" />
      Запланировано
    </span>
  );
}

function StreamTile({
  orgSlug,
  orgName,
  stream,
  thumbKey,
}: {
  orgSlug: string;
  orgName: string;
  stream: EventLandingStream;
  thumbKey: number;
}) {
  const [imgError, setImgError] = useState(false);
  useEffect(() => { setImgError(false); }, [thumbKey]);

  const isNamed = stream.slug !== '';
  const thumbPath = isNamed
    ? `/v1/public/orgs/${orgSlug}/streams/${stream.slug}/thumbnail`
    : `/v1/public/orgs/${orgSlug}/thumbnail`;
  const watchPath = isNamed
    ? `/watch/${orgSlug}/${stream.slug}`
    : `/watch/${orgSlug}`;

  const hasThumb = stream.isLive || stream.hasCustomPreview;
  const thumbUrl = hasThumb ? `${API_BASE}${thumbPath}?t=${thumbKey}` : null;

  const primaryName = stream.name?.trim() || (isNamed ? stream.slug : orgName);

  return (
    <Link href={watchPath} className="no-underline group">
      <article
        className={`rounded-xl overflow-hidden border transition-all duration-200 active:scale-[0.99] ${
          stream.isLive
            ? 'bg-surface-elevated border-brand/20 hover:border-brand/40 hover:shadow-lg hover:shadow-brand/5'
            : 'bg-surface-elevated border-zinc-800/50 hover:border-zinc-700 hover:shadow-lg hover:shadow-black/20'
        }`}
      >
        <div className="relative aspect-video bg-zinc-900 overflow-hidden">
          {thumbUrl && !imgError ? (
            <img
              src={thumbUrl}
              alt={primaryName}
              onError={() => setImgError(true)}
              className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <Monitor size={44} className="text-zinc-800" weight="thin" />
            </div>
          )}

          {stream.isLive ? (
            <span className="absolute top-2.5 left-2.5 inline-flex items-center gap-1.5 px-2 py-0.5 bg-brand text-white text-[0.65rem] font-bold uppercase tracking-wider rounded-md shadow-lg shadow-brand/30">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              Live
            </span>
          ) : (
            <span className="absolute top-2.5 left-2.5 inline-flex items-center gap-1 px-2 py-0.5 bg-black/65 backdrop-blur-sm border border-white/10 text-zinc-300 text-[0.65rem] font-semibold uppercase tracking-wider rounded-md">
              Не в эфире
            </span>
          )}
        </div>

        <div className="p-4">
          <p className={`font-semibold text-sm group-hover:text-white transition-colors ${stream.isLive ? 'text-zinc-100' : 'text-zinc-300'}`}>
            {primaryName}
          </p>
        </div>
      </article>
    </Link>
  );
}

function EventLandingSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-4 w-24 bg-zinc-800 rounded mb-6" />
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6 mb-10 pb-10 border-b border-zinc-800/50">
        <div>
          <div className="h-3 w-32 bg-zinc-800 rounded mb-3" />
          <div className="h-10 w-3/4 bg-zinc-800 rounded mb-2" />
          <div className="h-10 w-1/2 bg-zinc-800 rounded mb-5" />
          <div className="h-4 w-full max-w-md bg-zinc-800/60 rounded mb-2" />
          <div className="h-4 w-4/5 max-w-sm bg-zinc-800/60 rounded" />
        </div>
        <div className="flex flex-col gap-3 lg:items-end">
          <div className="h-4 w-40 bg-zinc-800 rounded" />
          <div className="h-4 w-32 bg-zinc-800 rounded" />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl overflow-hidden bg-surface-elevated border border-zinc-800/50">
            <div className="aspect-video bg-zinc-800" />
            <div className="p-4">
              <div className="h-4 w-2/3 bg-zinc-800 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function pluralizeStreams(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return 'стримов';
  if (mod10 === 1) return 'стрим';
  if (mod10 >= 2 && mod10 <= 4) return 'стрима';
  return 'стримов';
}
