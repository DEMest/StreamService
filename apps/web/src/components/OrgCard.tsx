'use client';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { Monitor } from '@phosphor-icons/react';
import type { CatalogItem, CatalogStreamCard } from '@/lib/types';
import { API_BASE } from '@/lib/types';

/**
 * Карточка каталога (одиночный Stream).
 *
 *   default ('')  → `/watch/<orgSlug>`            · `/api/v1/public/orgs/<orgSlug>/thumbnail`
 *   named  (foo)  → `/watch/<orgSlug>/<streamSlug>` · `/api/v1/public/orgs/<orgSlug>/streams/<streamSlug>/thumbnail`
 */
export function OrgCard({ org, thumbKey }: { org: CatalogItem; thumbKey: number }) {
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
