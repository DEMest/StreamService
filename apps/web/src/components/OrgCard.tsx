'use client';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { Monitor, Calendar, VideoCamera } from '@phosphor-icons/react';
import type { CatalogItem, CatalogStreamCard, CatalogEventCard } from '@/lib/types';
import { API_BASE } from '@/lib/types';

/**
 * Универсальная карточка каталога. Принимает discriminated union `CatalogItem`
 * и рендерит либо Stream-карточку (одиночный live-стрим), либо Event-карточку
 * (активный Event с ≥2 live Stream'ами).
 *
 * Stream-карточка:
 *   default ('')  → `/watch/<orgSlug>`            · `/api/v1/public/orgs/<orgSlug>/thumbnail`
 *   named  (foo)  → `/watch/<orgSlug>/<streamSlug>` · `/api/v1/public/orgs/<orgSlug>/streams/<streamSlug>/thumbnail`
 *
 * Event-карточка:
 *   → `/event/<orgSlug>/<eventSlug>` · thumbnail коллаж из первых live Stream'ов
 *     (v1 — упрощённо: thumbnail первого Stream'а + бэйдж «N стримов»).
 */
export function OrgCard({ org, thumbKey }: { org: CatalogItem; thumbKey: number }) {
  if (org.type === 'event') return <EventCard event={org} thumbKey={thumbKey} />;
  return <StreamCard stream={org} thumbKey={thumbKey} />;
}

function StreamCard({ stream, thumbKey }: { stream: CatalogStreamCard; thumbKey: number }) {
  const [imgError, setImgError] = useState(false);
  const hasThumbnail = stream.isLive || stream.hasCustomPreview;

  const isNamed = stream.streamSlug !== '';
  const thumbPath = isNamed
    ? `/v1/public/orgs/${stream.orgSlug}/streams/${stream.streamSlug}/thumbnail`
    : `/v1/public/orgs/${stream.orgSlug}/thumbnail`;
  const watchPath = isNamed
    ? `/watch/${stream.orgSlug}/${stream.streamSlug}`
    : `/watch/${stream.orgSlug}`;

  const thumbUrl = hasThumbnail ? `${API_BASE}${thumbPath}?t=${thumbKey}` : null;

  useEffect(() => { setImgError(false); }, [thumbKey]);

  // Заголовок карточки: имя Stream'а если задано, иначе имя орги.
  // Для default-Stream'а с пустым streamName → орга-имя как primary, без
  // дублирующей подписи. Для named-Stream'а с непустым streamName → стрим
  // primary, орга — supplementary.
  const primaryName = stream.streamName?.trim() || stream.orgName;
  const supplementary = stream.streamName?.trim() && stream.streamName !== stream.orgName
    ? stream.orgName
    : null;

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
            <img src={thumbUrl} alt={primaryName} onError={() => setImgError(true)}
              className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <Monitor size={48} className="text-zinc-800" weight="thin" />
            </div>
          )}
          {stream.isLive && (
            <span className="absolute top-3 left-3 inline-flex items-center gap-1.5 px-2 py-0.5 bg-brand text-white text-[0.65rem] font-bold uppercase tracking-wider rounded-md shadow-lg shadow-brand/30">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              Live
            </span>
          )}
        </div>
        <div className="p-4">
          <p className={`font-semibold text-sm group-hover:text-white transition-colors ${stream.isLive ? 'text-zinc-100' : 'text-zinc-300'}`}>
            {primaryName}
          </p>
          {supplementary && <p className="text-xs text-zinc-500 mt-0.5 truncate">{supplementary}</p>}
        </div>
      </article>
    </Link>
  );
}

/**
 * Event-карточка. v1: thumbnail — первый live-Stream Event'а через стандартный
 * thumbnail endpoint, плюс бэйдж «N стримов» в углу. Полноценный 2×2 коллаж —
 * отложено (требует server-side композирования или client-side грид с 4
 * img-тегами, что усложняет skeleton/error state).
 *
 * Градиент-fallback используется когда thumbnail первого Stream'а недоступен.
 */
function EventCard({ event, thumbKey }: { event: CatalogEventCard; thumbKey: number }) {
  const [imgError, setImgError] = useState(false);
  useEffect(() => { setImgError(false); }, [thumbKey]);

  const firstStreamSlug = event.streamSlugs[0] ?? '';
  const thumbPath = firstStreamSlug === ''
    ? `/v1/public/orgs/${event.orgSlug}/thumbnail`
    : `/v1/public/orgs/${event.orgSlug}/streams/${firstStreamSlug}/thumbnail`;
  const thumbUrl = `${API_BASE}${thumbPath}?t=${thumbKey}`;

  const streamCount = event.streamSlugs.length;
  const eventPath = `/event/${event.orgSlug}/${event.eventSlug}`;

  return (
    <Link href={eventPath} className="no-underline group">
      <article className="rounded-xl overflow-hidden border border-brand/25 bg-surface-elevated hover:border-brand/45 hover:shadow-lg hover:shadow-brand/5 transition-all duration-200 active:scale-[0.99]">
        <div className="relative aspect-video overflow-hidden">
          {!imgError ? (
            <img
              src={thumbUrl}
              alt={event.eventTitle}
              onError={() => setImgError(true)}
              className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500"
            />
          ) : (
            // Градиент-fallback: тонкий контекстный фон без штампованных оттенков.
            <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(229,9,20,0.18),rgba(20,20,24,0.95)_60%)]">
              <div className="absolute inset-0 flex items-center justify-center">
                <Calendar size={44} className="text-zinc-700" weight="thin" />
              </div>
            </div>
          )}

          {/* Затемнение справа-снизу для контрастности бейджей */}
          <div className="absolute inset-0 bg-gradient-to-tr from-black/55 via-transparent to-transparent pointer-events-none" />

          {/* LIVE badge */}
          <span className="absolute top-3 left-3 inline-flex items-center gap-1.5 px-2 py-0.5 bg-brand text-white text-[0.65rem] font-bold uppercase tracking-wider rounded-md shadow-lg shadow-brand/30">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            Event Live
          </span>

          {/* Stream-count badge */}
          <span className="absolute top-3 right-3 inline-flex items-center gap-1 px-2 py-0.5 bg-black/65 backdrop-blur-sm border border-white/10 text-zinc-100 text-[0.65rem] font-semibold uppercase tracking-wider rounded-md">
            <VideoCamera size={11} weight="fill" />
            <span className="tabular-nums">{streamCount}</span>
          </span>
        </div>
        <div className="p-4">
          <p className="font-semibold text-sm text-zinc-100 group-hover:text-white transition-colors truncate">
            {event.eventTitle}
          </p>
          <p className="text-xs text-zinc-500 mt-0.5 truncate">
            {event.orgName} <span className="text-zinc-700">·</span>{' '}
            <span className="tabular-nums">{streamCount}</span> {pluralizeStreams(streamCount)}
          </p>
        </div>
      </article>
    </Link>
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

export function SkeletonCard() {
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
