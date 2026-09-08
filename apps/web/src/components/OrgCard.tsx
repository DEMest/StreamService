'use client';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { VideoCamera } from '@phosphor-icons/react';
import type { CatalogOrgCard } from '@/lib/types';
import { API_BASE } from '@/lib/types';
import { OrgAvatar } from '@/components/OrgAvatar';

/**
 * Карточка каталога (одна орга). По умолчанию ведёт на `/watch/<orgSlug>` —
 * обзор орги со списком её Stream'ов; можно переопределить `href` (например
 * на странице архива — сразу в архивный режим обзора орги).
 */
export function OrgCard({ org, href }: { org: CatalogOrgCard; href?: string }) {
  const [imgError, setImgError] = useState(false);
  const isLive = org.liveCount > 0;
  // Без cache-buster'а — по тому же правилу, что и в OrgAvatar: ручка отдаёт
  // `Cache-Control: public, max-age=300`, а подставленный в URL таймер обнулял
  // этот кеш каждые 30 секунд и заставлял КАЖДОГО посетителя каталога заново
  // тянуть все аватарки из S3. Живых кадров на карточках давно нет — здесь
  // только картинка орги, которая меняется раз в полгода.
  //
  // Свежесть после загрузки новой картинки держится на данных, а не на
  // таймерах: `hasImage` приходит с каталогом и мгновенно переключает карточку
  // между картинкой и монограммой, а тот, кто картинку загрузил, видит новую
  // сразу — в кабинете URL версионируется по факту загрузки (`imgBump`).
  // Остальным посетителям она достаётся максимум через 5 минут — ровно тот
  // срок, который сервер сам объявил в Cache-Control.
  const thumbUrl = org.hasImage
    ? `${API_BASE}/v1/public/orgs/${org.orgSlug}/image`
    : null;

  // Орга сменилась (или картинку загрузили/удалили) — даём <img> ещё попытку.
  useEffect(() => { setImgError(false); }, [org.orgSlug, org.hasImage]);

  return (
    <Link href={href ?? `/watch/${org.orgSlug}`} className="no-underline group">
      <article
        className={`rounded-xl overflow-hidden border transition-all duration-200 active:scale-[0.99] ${
          isLive
            ? 'bg-surface-elevated border-brand/20 hover:border-brand/40 hover:shadow-lg hover:shadow-brand/5'
            : 'bg-surface-elevated border-zinc-800/50 hover:border-zinc-700 hover:shadow-lg hover:shadow-black/20'
        }`}
      >
        <div className="relative aspect-video bg-zinc-900 overflow-hidden">
          {thumbUrl && !imgError ? (
            <img src={thumbUrl} alt={org.orgName} onError={() => setImgError(true)}
              className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              {/* Картинки нет — вместо обезличенной иконки показываем монограмму
                  орги, чтобы карточки без превью всё-таки различались между собой. */}
              {/* Без `live` — карточка уже несёт крупный бейдж Live выше,
                  брендовое кольцо дублировало бы тот же сигнал. */}
              <OrgAvatar orgSlug={org.orgSlug} orgName={org.orgName} size={56} />
            </div>
          )}
          {isLive && (
            <span className="absolute top-3 left-3 inline-flex items-center gap-1.5 px-2 py-0.5 bg-brand text-white text-[0.65rem] font-bold uppercase tracking-wider rounded-md shadow-lg shadow-brand/30">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              Live
            </span>
          )}
          {org.liveCount > 1 && (
            <span className="absolute top-3 right-3 inline-flex items-center gap-1 px-2 py-0.5 bg-black/65 backdrop-blur-sm border border-white/10 text-zinc-100 text-[0.65rem] font-semibold uppercase tracking-wider rounded-md">
              <VideoCamera size={11} weight="fill" />
              <span className="tabular-nums">{org.liveCount}</span>
            </span>
          )}
        </div>
        <div className="p-4">
          <p className={`font-semibold text-sm group-hover:text-white transition-colors ${isLive ? 'text-zinc-100' : 'text-zinc-300'}`}>
            {org.orgName}
          </p>
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
