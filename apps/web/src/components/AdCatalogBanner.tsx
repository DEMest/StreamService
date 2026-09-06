'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from '@phosphor-icons/react';
import { API_BASE, type PublicAd } from '@/lib/types';
import { adGradient, adInitials } from '@/lib/ad-fallback';
import { sendAdEvent } from '@/lib/ad-events';
import { useAdsGate } from '@/hooks/useAdsGate';

/** Leaderboard — стандартный формат полосы над списком. */
const AD_ASPECT = '728 / 90';

const REASONS = ['Неинтересно', 'Слишком часто', 'Не по теме'];

/**
 * Полоса над сеткой карточек в каталоге (/streams, /organizations, /archive).
 * В отличие от watch-баннера — без конвейера: одно объявление на загрузку
 * страницы (выбирается случайно, чтобы разные рекламодатели получали показы
 * на разных заходах). Организациям (org_admin/суперадмин) не показывается
 * никогда.
 *
 * Баннер — готовый креатив рекламодателя (Leaderboard 728×90), показывается
 * как есть, без своего текста поверх: метка «Реклама» и крестик — отдельной
 * полосой сверху.
 */
export function AdCatalogBanner() {
  const { isOrgOrSuperadmin, ads } = useAdsGate();
  // Показываем только объявления с картинкой под этот плейсмент — без неё
  // показывать нечего (текст поверх больше не рисуем).
  const catalogAds = useMemo(() => (ads ?? []).filter((a) => a.catalogImageUrl), [ads]);

  const [ad, setAd] = useState<PublicAd | null>(null);
  const [closed, setClosed] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const pickedRef = useRef(false);

  useEffect(() => {
    // Один показ на маунт страницы: фон-рефетч того же списка (staleTime
    // истёк) не должен переигрывать выбор и слать новый impression на уже
    // показанный баннер.
    if (catalogAds.length === 0 || pickedRef.current) return;
    pickedRef.current = true;
    const picked = catalogAds[Math.floor(Math.random() * catalogAds.length)];
    setAd(picked);
    sendAdEvent(picked.id, 'catalog', 'impression', null);
  }, [catalogAds]);

  if (isOrgOrSuperadmin || closed || !ad) return null;

  function handleCloseClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (feedbackOpen) {
      setClosed(true);
      sendAdEvent(ad!.id, 'catalog', 'dismiss_no_reason', null);
    } else {
      setFeedbackOpen(true);
    }
  }

  function pickReason(reason: string, e: React.MouseEvent) {
    e.stopPropagation();
    setClosed(true);
    sendAdEvent(ad!.id, 'catalog', 'dismiss_reason', reason);
  }

  return (
    <div className="max-w-[728px] mx-auto mb-5 rounded-xl border border-white/10 bg-surface-elevated overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-black/40">
        <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">Реклама</span>
        <button
          onClick={handleCloseClick}
          className="w-5 h-5 -mr-1 rounded-md hover:bg-white/10 flex items-center justify-center text-zinc-500 hover:text-white border-none bg-transparent cursor-pointer"
        >
          <X size={11} weight="bold" />
        </button>
      </div>

      {!feedbackOpen ? (
        <div
          className="relative w-full cursor-pointer"
          style={{ aspectRatio: AD_ASPECT }}
          onClick={() => window.open(ad.targetUrl, '_blank', 'noopener,noreferrer')}
        >
          {ad.catalogImageUrl ? (
            <img src={`${API_BASE}${ad.catalogImageUrl}`} alt={ad.title} className="absolute inset-0 w-full h-full object-contain bg-black" />
          ) : (
            <div
              className="absolute inset-0 flex items-center justify-center text-white font-bold text-lg"
              style={{ background: adGradient(ad.id) }}
            >
              {adInitials(ad.title)}
            </div>
          )}
        </div>
      ) : (
        <div className="p-4 flex flex-col gap-2">
          <div className="text-[13px] font-semibold text-zinc-100">Почему скрыли рекламу?</div>
          <div className="flex flex-wrap gap-1.5">
            {REASONS.map((r) => (
              <button
                key={r}
                onClick={(e) => pickReason(r, e)}
                className="text-[11px] text-zinc-200 bg-white/10 hover:bg-white/20 border border-white/15 hover:border-white/30 rounded-full px-2.5 py-1.5 cursor-pointer"
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
