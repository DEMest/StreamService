'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from '@phosphor-icons/react';
import { API_BASE, type PublicAd } from '@/lib/types';
import { adGradient, adInitials } from '@/lib/ad-fallback';
import { sendAdEvent } from '@/lib/ad-events';
import { useAdsGate } from '@/hooks/useAdsGate';

/** Medium Rectangle — стандартный формат оверлея поверх видео. */
const AD_ASPECT = '300 / 250';

/** Показ на 15 секунд — реальное продуктовое число, не демо-сжатие. */
const AD_DURATION_MS = 15_000;
/** Раз в ~5 минут просмотра — фиксированный таймер, не зависит от того,
 * закрыли предыдущий баннер раньше или нет (см. итерацию в дизайне). */
const PERIOD_MS = 5 * 60 * 1000;
/** Не мгновенно при заходе на страницу. */
const FIRST_DELAY_MS = 8_000;

const REASONS = ['Неинтересно', 'Слишком часто', 'Не по теме'];

/**
 * Плашка-баннер поверх плеера watch-страницы (десктоп). Организациям
 * (org_admin/суперадмин) не показывается никогда — оба флага (`isFullscreen`,
 * роль) гейтят именно рендер, а не таймер: расписание показов продолжает
 * идти в фоне, чтобы уход в fullscreen на минуту не откатывал следующий показ
 * к самому началу пятиминутки.
 *
 * Баннер — готовый креатив рекламодателя (Medium Rectangle 300×250), а не
 * логотип с текстом: показывается как есть, без наложения своего текста
 * поверх картинки. Метка «Реклама» и крестик — отдельной полосой сверху,
 * чтобы не перекрывать содержимое баннера.
 */
export function AdBanner({ isFullscreen }: { isFullscreen: boolean }) {
  const { isOrgOrSuperadmin, ads } = useAdsGate();
  // Крутим только объявления, у которых есть картинка под этот плейсмент —
  // без неё показывать нечего (текст поверх больше не рисуем).
  const watchAds = useMemo(() => (ads ?? []).filter((a) => a.watchImageUrl), [ads]);

  const [currentAd, setCurrentAd] = useState<PublicAd | null>(null);
  const [cycle, setCycle] = useState(0);
  const [visible, setVisible] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const adIndexRef = useRef(0);
  const dismissedRef = useRef(false);
  const adsRef = useRef<PublicAd[]>([]);
  const startedRef = useRef(false);

  useEffect(() => {
    adsRef.current = watchAds;
  }, [watchAds]);

  useEffect(() => {
    if (watchAds.length === 0 || startedRef.current) return;
    startedRef.current = true;
    // Случайный старт — чтобы не у всех зрителей первой шла одна и та же реклама.
    adIndexRef.current = Math.floor(Math.random() * watchAds.length);

    let cancelled = false;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    let periodTimer: ReturnType<typeof setTimeout> | undefined;

    function showNext() {
      if (cancelled) return;
      // Читаем актуальный список через ref: фоновый рефетч того же списка
      // (staleTime истёк, фокус вкладки) не должен перезапускать всю цепочку
      // таймеров — период фиксированный, не зависит от рефетчей.
      const list = adsRef.current;
      if (list.length === 0) return;
      const ad = list[adIndexRef.current % list.length];
      adIndexRef.current += 1;
      dismissedRef.current = false;
      setCurrentAd(ad);
      setCycle((c) => c + 1);
      setVisible(true);
      setFeedbackOpen(false);
      sendAdEvent(ad.id, 'watch', 'impression', null);

      hideTimer = setTimeout(() => {
        if (cancelled || dismissedRef.current) return;
        setVisible(false);
        sendAdEvent(ad.id, 'watch', 'dismiss_timeout', null);
      }, AD_DURATION_MS);

      periodTimer = setTimeout(showNext, PERIOD_MS);
    }

    const firstTimer = setTimeout(showNext, FIRST_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(firstTimer);
      clearTimeout(hideTimer);
      clearTimeout(periodTimer);
    };
  }, [watchAds]);

  if (isOrgOrSuperadmin || isFullscreen || !visible || !currentAd) return null;

  function close(e: React.MouseEvent) {
    e.stopPropagation();
    if (feedbackOpen) {
      dismissedRef.current = true;
      setVisible(false);
      setFeedbackOpen(false);
      sendAdEvent(currentAd!.id, 'watch', 'dismiss_no_reason', null);
    } else {
      setFeedbackOpen(true);
    }
  }

  function pickReason(reason: string, e: React.MouseEvent) {
    e.stopPropagation();
    dismissedRef.current = true;
    setVisible(false);
    setFeedbackOpen(false);
    sendAdEvent(currentAd!.id, 'watch', 'dismiss_reason', reason);
  }

  return (
    <div className="absolute right-4 z-10 w-[240px] rounded-xl border border-white/10 bg-surface-2 shadow-[0_10px_30px_rgba(0,0,0,0.45)] overflow-hidden" style={{ bottom: 76 }}>
      <div className="flex items-center justify-between px-2.5 py-1.5 bg-black/85">
        <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-400">Реклама</span>
        <button
          onClick={close}
          className="w-5 h-5 -mr-1 rounded-md hover:bg-white/10 flex items-center justify-center text-zinc-400 hover:text-white border-none bg-transparent cursor-pointer"
        >
          <X size={11} weight="bold" />
        </button>
      </div>

      {!feedbackOpen ? (
        <div
          className="relative w-full cursor-pointer"
          style={{ aspectRatio: AD_ASPECT }}
          onClick={() => window.open(currentAd.targetUrl, '_blank', 'noopener,noreferrer')}
        >
          {currentAd.watchImageUrl ? (
            <img src={`${API_BASE}${currentAd.watchImageUrl}`} alt={currentAd.title} className="absolute inset-0 w-full h-full object-contain bg-black" />
          ) : (
            <div
              className="absolute inset-0 flex items-center justify-center text-white font-bold text-xl"
              style={{ background: adGradient(currentAd.id) }}
            >
              {adInitials(currentAd.title)}
            </div>
          )}
          <div className="absolute left-0 right-0 bottom-0 h-[3px] bg-white/10 overflow-hidden">
            <div key={cycle} className="h-full bg-brand" style={{ animation: `ad-drain ${AD_DURATION_MS / 1000}s linear forwards` }} />
          </div>
        </div>
      ) : (
        <div className="p-3 flex flex-col gap-2">
          <div className="text-[12px] font-semibold text-zinc-100">Почему скрыли рекламу?</div>
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
