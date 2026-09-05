'use client';
import { useEffect, useRef, useState } from 'react';
import { CaretRight, X } from '@phosphor-icons/react';
import type { PublicAd } from '@/lib/types';
import { adGradient, adInitials } from '@/lib/ad-fallback';
import { sendAdEvent } from '@/lib/ad-events';
import { useAdsGate } from '@/hooks/useAdsGate';

/**
 * Полоса над сеткой карточек в каталоге (/streams, /organizations, /archive).
 * В отличие от watch-баннера — без конвейера: одно объявление на загрузку
 * страницы (выбирается случайно, чтобы разные рекламодатели получали показы
 * на разных заходах), закрывается до конца сессии на этой вкладке.
 * Организациям (org_admin/суперадмин) не показывается никогда.
 */
export function AdCatalogBanner() {
  const { isOrgOrSuperadmin, ads } = useAdsGate();

  const [ad, setAd] = useState<PublicAd | null>(null);
  const [closed, setClosed] = useState(false);
  const pickedRef = useRef(false);

  useEffect(() => {
    // Один показ на маунт страницы: фон-рефетч того же списка (staleTime
    // истёк) не должен переигрывать выбор и слать новый impression на уже
    // показанный баннер.
    if (!ads || ads.length === 0 || pickedRef.current) return;
    pickedRef.current = true;
    const picked = ads[Math.floor(Math.random() * ads.length)];
    setAd(picked);
    sendAdEvent(picked.id, 'catalog', 'impression', null);
  }, [ads]);

  if (isOrgOrSuperadmin || closed || !ad) return null;

  function close(e: React.MouseEvent) {
    e.stopPropagation();
    setClosed(true);
    sendAdEvent(ad!.id, 'catalog', 'dismiss_no_reason', null);
  }

  return (
    <div
      className="relative flex items-center justify-between gap-4 mb-5 p-5 rounded-2xl border border-white/10 bg-gradient-to-r from-surface-elevated to-surface-card cursor-pointer overflow-hidden transition-colors hover:border-white/20"
      onClick={() => window.open(ad.targetUrl, '_blank', 'noopener,noreferrer')}
    >
      {ad.catalogImageUrl && (
        <>
          <img src={ad.catalogImageUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
        </>
      )}

      <span className="absolute top-[9px] left-[22px] text-[9px] font-bold uppercase tracking-wider text-zinc-500 z-[1] pointer-events-none">
        Реклама
      </span>
      <button
        onClick={close}
        className="absolute top-[9px] right-[9px] z-[1] w-[22px] h-[22px] rounded-md bg-white/10 hover:bg-white/20 flex items-center justify-center text-zinc-300 hover:text-white border-none cursor-pointer"
      >
        <X size={11} weight="bold" />
      </button>

      <div className="relative z-[1] flex items-center gap-3.5 min-w-0">
        <div
          className="w-[46px] h-[46px] rounded-[11px] shrink-0 flex items-center justify-center text-white font-bold text-base overflow-hidden"
          style={ad.catalogImageUrl ? undefined : { background: adGradient(ad.id) }}
        >
          {!ad.catalogImageUrl && adInitials(ad.title)}
        </div>
        <div className="min-w-0">
          <div className={`text-sm font-semibold truncate ${ad.catalogImageUrl ? 'text-white' : 'text-zinc-100'}`}>
            {ad.title}
          </div>
          {ad.subtitle && (
            <div className={`text-xs mt-0.5 truncate ${ad.catalogImageUrl ? 'text-white/75' : 'text-zinc-400'}`}>
              {ad.subtitle}
            </div>
          )}
        </div>
      </div>

      <div
        className={`relative z-[1] flex items-center gap-1.5 text-xs font-medium rounded-lg px-3.5 py-2 shrink-0 whitespace-nowrap border ${
          ad.catalogImageUrl
            ? 'text-white border-white/35 bg-black/25'
            : 'text-zinc-200 border-white/15'
        }`}
      >
        Подробнее
        <CaretRight size={12} weight="bold" />
      </div>
    </div>
  );
}
