'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import MatPlayer, { type MatPlayerHandle } from '@/components/MatPlayer';
import ViewSwitcher, {
  type CompositeViewMode,
  type PlayerViewMode,
} from '@/components/ViewSwitcher';
import { Chat } from '@/components/Chat';
import { Header } from '@/components/Header';
import { MobileSeekBar } from '@/components/MobileSeekBar';
import { OrgAvatar } from '@/components/OrgAvatar';
import { FeedbackButton } from '@/components/FeedbackButton';
import {
  Eye, CornersOut, CornersIn,
  SpeakerHigh, SpeakerLow, SpeakerSlash,
  CaretLeft, CaretRight, ChatCircle, Archive,
  TelevisionSimple, GearSix, Play, Pause,
  GridFour, VideoCamera,
} from '@phosphor-icons/react';

// Camera-row entries shown on portrait mobile (composite: multicam + cam1..4).
type CameraRowEntry = {
  key: PlayerViewMode;
  label: string;
  isLive: boolean;
};

interface Me { sub: string; role: string; orgSlug?: string }

interface OrgWatch {
  slug: string;
  name: string;
  description?: string;
  hasImage?: boolean;
  isLive: boolean;
  streamTitle: string;
  streamDescription?: string;
  streamIsPublic: boolean;
  feedMode: 'single' | 'composite';
  accessDenied?: boolean;
}

interface StreamInfo {
  hlsUrl: string;
  feedMode: 'single' | 'composite';
}

interface WatchViewProps {
  orgSlug: string;
  streamSlug: string;
}

/**
 * Watch-компонент конкретного Stream'а: рендерит плеер + чат для Stream'а
 * `<orgSlug>/<streamSlug>`.
 */
export function WatchView({ orgSlug, streamSlug }: WatchViewProps) {
  const apiBasePath = `/v1/public/orgs/${orgSlug}/streams/${streamSlug}`;
  const searchParams = useSearchParams();
  const previewKey = searchParams.get('key') ?? undefined;
  const qc = useQueryClient();
  const router = useRouter();

  const { data: me, isLoading: meLoading } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<Me>('/v1/auth/me'),
    retry: false,
  });
  const isOwner = me?.orgSlug === orgSlug;

  async function handleLogout() {
    await api.post('/v1/auth/logout', {});
    qc.clear();
    router.push('/login');
  }

  const [viewMode, setViewMode]             = useState<PlayerViewMode>('multicam');
  const [chatOpen, setChatOpen]             = useState(true);
  const [viewPanelOpen, setViewPanelOpen]   = useState(false);
  const [isMobile, setIsMobile]             = useState(false);
  const [uiVisible, setUiVisible]           = useState(false);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [mobileViewOpen, setMobileViewOpen] = useState(false);
  const [isFullscreen, setIsFullscreen]     = useState(false);
  const [isPortrait, setIsPortrait]         = useState(true);
  const [viewerCount, setViewerCount]       = useState<number | null>(null);
  const [volume, setVolume]                 = useState(1);
  const [isPaused, setIsPaused]             = useState(false);
  const prevVolumeRef                       = useRef(1);
  const [currentTime, setCurrentTime]       = useState(0);
  const [duration, setDuration]             = useState(0);
  const [seekableStart, setSeekableStart]   = useState(0);
  const [isAtLive, setIsAtLive]             = useState(true);
  const [isBuffering, setIsBuffering] = useState(false);
  const [qualityLevel, setQualityLevel] = useState(-1);
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const [activeQuality, setActiveQuality] = useState(-1);

  const uiTimerRef         = useRef<ReturnType<typeof setTimeout> | null>(null);
  const matRef             = useRef<MatPlayerHandle>(null);
  const videoColumnRef     = useRef<HTMLDivElement>(null);
  const mobileContainerRef = useRef<HTMLDivElement>(null);
  const touchStartYRef     = useRef(0);
  const swipedRef          = useRef(false);
  const [swipeOffset, setSwipeOffset] = useState(0);

  useEffect(() => {
    const check = () => {
      setIsMobile(window.innerWidth < 768);
      setIsPortrait(window.innerHeight > window.innerWidth);
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  function resetUiTimer() {
    setUiVisible(true);
    if (uiTimerRef.current) clearTimeout(uiTimerRef.current);
    uiTimerRef.current = setTimeout(() => setUiVisible(false), 3000);
  }

  function toggleMobileUi() {
    if (uiTimerRef.current) clearTimeout(uiTimerRef.current);
    setUiVisible(v => !v);
  }

  useEffect(() => {
    if (!isMobile) return;
    return () => { if (uiTimerRef.current) clearTimeout(uiTimerRef.current); };
  }, [isMobile]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  function toggleFullscreen() {
    if (isFullscreen) {
      document.exitFullscreen();
    } else if (document.fullscreenEnabled) {
      const target = videoColumnRef.current ?? mobileContainerRef.current ?? document.documentElement;
      target.requestFullscreen();
    } else {
      matRef.current?.enterIOSFullscreen();
    }
  }

  const apiUrl = previewKey
    ? `${apiBasePath}?key=${previewKey}`
    : apiBasePath;

  const { data: org } = useQuery({
    queryKey: ['watch', orgSlug, streamSlug, previewKey],
    queryFn: () => api.get<OrgWatch>(apiUrl),
    refetchInterval: 15_000,
  });

  // Stream config + HLS URL. Polled every 3s while the org is live.
  const { data: stream } = useQuery({
    queryKey: ['stream', orgSlug, streamSlug, previewKey],
    queryFn: () => api.get<StreamInfo>(`${apiBasePath}/stream${previewKey ? `?key=${previewKey}` : ''}`),
    enabled: org?.isLive === true,
    retry: false,
    refetchInterval: () => (org?.isLive ? 3000 : false),
  });

  // ── Derived state ───────────────────────────────────────────────────────
  const compositeUrl = stream?.hlsUrl;

  // Camera-row entries for portrait mobile (composite: multicam + cam1..4).
  const cameraRowEntries = useMemo<CameraRowEntry[]>(() => {
    if (!stream) return [];
    if (stream.feedMode === 'single') {
      return [{ key: 'multicam', label: 'Все', isLive: true }];
    }
    return [
      { key: 'multicam', label: 'Все', isLive: true },
      { key: 'cam1', label: '1', isLive: true },
      { key: 'cam2', label: '2', isLive: true },
      { key: 'cam3', label: '3', isLive: true },
      { key: 'cam4', label: '4', isLive: true },
    ];
  }, [stream]);

  // ── Handlers ────────────────────────────────────────────────────────────
  function handleVideoClick(e: React.MouseEvent<HTMLDivElement>) {
    setQualityMenuOpen(false);
    setMobileViewOpen(false);
    if (!stream || stream.feedMode === 'single') return;

    if (viewMode !== 'multicam') { setViewMode('multicam'); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if      (x < 0.5 && y < 0.5) setViewMode('cam1');
    else if (x >= 0.5 && y < 0.5) setViewMode('cam2');
    else if (x < 0.5)             setViewMode('cam3');
    else                           setViewMode('cam4');
  }

  function handleTimeUpdate(current: number, dur: number, live: boolean, start: number) {
    setCurrentTime(current);
    setDuration(dur);
    setSeekableStart(start);
    if (live) setIsAtLive(dur - current < 10);
  }

  function handleSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const time = parseFloat(e.target.value);
    matRef.current?.seekTo(time);
    setIsAtLive(false);
  }

  function goToLive() {
    matRef.current?.seekToLive();
    setIsAtLive(true);
  }

  function formatTime(seconds: number): string {
    if (!isFinite(seconds)) return '0:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function VolumeIcon() {
    if (volume === 0) return <SpeakerSlash size={18} />;
    if (volume <= 0.5) return <SpeakerLow size={18} />;
    return <SpeakerHigh size={18} />;
  }

  function toggleMute() {
    if (volume === 0) {
      setVolume(prevVolumeRef.current || 1);
    } else {
      prevVolumeRef.current = volume;
      setVolume(0);
    }
  }

  function togglePause() {
    if (isPaused) {
      matRef.current?.play();
      setIsPaused(false);
    } else {
      matRef.current?.pause();
      setIsPaused(true);
    }
  }

  // Cycle through composite views (multicam → cam1 → cam2 → cam3 → cam4 → multicam).
  function cycleViewMode() {
    const cycle: CompositeViewMode[] = ['multicam', 'cam1', 'cam2', 'cam3', 'cam4'];
    setViewMode((prev) => {
      const idx = cycle.indexOf(prev as CompositeViewMode);
      return cycle[(idx + 1) % cycle.length];
    });
  }

  function handlePortraitTap(e: React.MouseEvent<HTMLDivElement>) {
    if (swipedRef.current) { swipedRef.current = false; return; }
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    if (x > 0.5) {
      cycleViewMode();
    } else {
      toggleMobileUi();
    }
  }

  function handleSwipeStart(e: React.TouchEvent) {
    touchStartYRef.current = e.touches[0].clientY;
    swipedRef.current = false;
  }

  function handleSwipeMove(e: React.TouchEvent) {
    const dy = e.touches[0].clientY - touchStartYRef.current;
    if (dy > 0) {
      setSwipeOffset(dy * 0.4);
      if (dy > 15) swipedRef.current = true;
    } else {
      setSwipeOffset(0);
    }
  }

  function handleSwipeEnd() {
    if (swipeOffset > 80) {
      router.back();
    }
    setSwipeOffset(0);
  }

  function qualityLabel(): string {
    if (qualityLevel === -1) {
      const activeName = activeQuality >= 0
        ? matRef.current?.getQualityLevels()?.[activeQuality]?.name
        : undefined;
      return activeName ? `Авто (${activeName})` : 'Авто';
    }
    return matRef.current?.getQualityLevels()?.[qualityLevel]?.name ?? 'HD';
  }

  const [desktopControlsVisible, setDesktopControlsVisible] = useState(true);
  const desktopControlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function resetDesktopControlsTimer() {
    setDesktopControlsVisible(true);
    if (desktopControlsTimerRef.current) clearTimeout(desktopControlsTimerRef.current);
    if (isFullscreen) {
      desktopControlsTimerRef.current = setTimeout(() => setDesktopControlsVisible(false), 1000);
    }
  }

  useEffect(() => {
    if (isFullscreen) {
      resetDesktopControlsTimer();
    } else {
      setDesktopControlsVisible(true);
      if (desktopControlsTimerRef.current) clearTimeout(desktopControlsTimerRef.current);
    }
    return () => { if (desktopControlsTimerRef.current) clearTimeout(desktopControlsTimerRef.current); };
  }, [isFullscreen]);

  const archiveBasePath = `/watch/${orgSlug}/${streamSlug}/archive`;
  const archiveLink = previewKey
    ? `${archiveBasePath}?key=${previewKey}`
    : archiveBasePath;

  // ── Player element ──────────────────────────────────────────────────────
  function renderPlayer() {
    if (!compositeUrl) return null;
    return (
      <MatPlayer
        ref={matRef}
        streamUrl={compositeUrl}
        viewMode={viewMode}
        volume={volume}
        isArchive={false}
        onMutedFallback={() => setVolume(0)}
        onTimeUpdate={handleTimeUpdate}
        onBuffering={setIsBuffering}
        onQualityChange={setActiveQuality}
      />
    );
  }

  // ── ViewSwitcher element ────────────────────────────────────────────────
  function renderViewSwitcher() {
    return (
      <ViewSwitcher
        mode={viewMode as CompositeViewMode}
        onChange={(m: CompositeViewMode) => { setViewMode(m); setMobileViewOpen(false); }}
        feedMode={org?.feedMode ?? 'composite'}
      />
    );
  }

  // Идентичность вещателя: организация — первичная строка (с аватаром), стрим —
  // подпись под ней. Намеренно НЕ склеиваем их в одну строку: иначе орга
  // читается как приставка к техническому названию потока и на mobile ещё и
  // дублируется отдельной строкой ниже.
  const orgTitle = org?.name || orgSlug;
  const streamTitle = org?.streamTitle?.trim() || '';
  const orgHref = previewKey ? `/watch/${orgSlug}?key=${previewKey}` : `/watch/${orgSlug}`;

  // ── Mobile layout ──────────────────────────────────────────────────────
  if (isMobile) {
    const showImmersive = isFullscreen || !isPortrait;

    return (
      <div
        ref={mobileContainerRef}
        className={showImmersive ? 'fixed inset-0 bg-black' : 'flex flex-col bg-surface-primary'}
        style={showImmersive
          ? { paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)', paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' }
          : { height: '100dvh', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }
        }
        onClick={showImmersive ? resetUiTimer : undefined}
      >
        {showImmersive ? (
          /* ── Immersive (landscape OR fullscreen from portrait) ───────── */
          <>
            <div className="absolute inset-0 overflow-hidden" onClick={handleVideoClick}>
              {compositeUrl
                ? renderPlayer()
                : <div className="flex items-center justify-center h-full">
                    <TelevisionSimple size={48} className="text-zinc-700" weight="thin" />
                  </div>
              }

              {stream && (
                <div
                  className="absolute inset-x-0 bottom-0 z-20 px-3 py-2 flex items-center gap-1.5"
                  style={{ background: 'linear-gradient(transparent, rgba(0,0,0,0.85))' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button onClick={togglePause} className="text-white bg-transparent border-none w-8 h-8 flex items-center justify-center cursor-pointer shrink-0">
                    {isPaused ? <Play size={16} weight="fill" /> : <Pause size={16} weight="fill" />}
                  </button>
                  {!isAtLive && (
                    <button onClick={goToLive} className="bg-brand text-white text-[0.6rem] font-bold px-1.5 py-0.5 rounded shrink-0 cursor-pointer border-none">LIVE</button>
                  )}
                  <span className="text-zinc-500 text-[0.65rem] font-mono tabular-nums shrink-0">{formatTime(currentTime - seekableStart)}</span>
                  <input type="range" min={seekableStart} max={duration || 0} step={0.1} value={currentTime} onChange={handleSeek} className="flex-1" />
                  <span className="text-zinc-500 text-[0.65rem] font-mono tabular-nums shrink-0">{formatTime(duration - seekableStart)}</span>
                  <button onClick={toggleMute} className="text-white bg-transparent border-none w-8 h-8 flex items-center justify-center cursor-pointer shrink-0">
                    <VolumeIcon />
                  </button>
                  {(matRef.current?.getQualityLevels()?.length ?? 0) > 1 && (
                    <div className="relative shrink-0">
                      <button
                        onClick={() => setQualityMenuOpen((v) => !v)}
                        className="text-white bg-transparent border-none h-8 px-1.5 rounded flex items-center gap-0.5 cursor-pointer hover:bg-white/10 transition-colors text-[0.65rem] font-medium"
                      >
                        <GearSix size={14} />
                        <span className="text-zinc-400">{qualityLabel()}</span>
                      </button>
                      {qualityMenuOpen && (
                        <div className="absolute bottom-full right-0 mb-2 bg-zinc-900/95 border border-zinc-700/50 rounded-lg overflow-hidden min-w-[110px] backdrop-blur-sm">
                          <button
                            onClick={() => { setQualityLevel(-1); matRef.current?.setQualityLevel(-1); setQualityMenuOpen(false); }}
                            className={`w-full text-left px-3 py-2 text-sm cursor-pointer border-none transition-colors ${qualityLevel === -1 ? 'bg-white/10 text-white' : 'bg-transparent text-zinc-300 hover:bg-white/5'}`}
                          >Авто</button>
                          {(matRef.current?.getQualityLevels() ?? []).map((q) => (
                            <button key={q.index}
                              onClick={() => { setQualityLevel(q.index); matRef.current?.setQualityLevel(q.index); setQualityMenuOpen(false); }}
                              className={`w-full text-left px-3 py-2 text-sm cursor-pointer border-none transition-colors ${qualityLevel === q.index ? 'bg-white/10 text-white' : 'bg-transparent text-zinc-300 hover:bg-white/5'}`}
                            >{q.name}</button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <button onClick={toggleFullscreen} className="text-white bg-transparent border-none w-8 h-8 flex items-center justify-center cursor-pointer shrink-0">
                    {isFullscreen ? <CornersIn size={18} /> : <CornersOut size={18} />}
                  </button>
                </div>
              )}

              {isBuffering && (
                <div className="absolute inset-0 flex items-center justify-center z-[11] pointer-events-none">
                  <div className="w-12 h-12 border-3 border-zinc-600 border-t-white rounded-full animate-spin" />
                </div>
              )}
            </div>

            {uiVisible && (
              <div className="absolute top-0 inset-x-0 px-4 py-3 flex justify-between items-center pointer-events-none" style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.7), transparent)' }}>
                <div className="flex items-center gap-2 min-w-0 max-w-[60%]">
                  <OrgAvatar orgSlug={orgSlug} orgName={org?.name} hasImage={org?.hasImage} size={22} live={!!org?.isLive} />
                  <span className="min-w-0 flex flex-col">
                    <span className="font-semibold text-white text-xs leading-tight truncate">{orgTitle}</span>
                    {streamTitle && (
                      <span className="text-zinc-400 text-[0.65rem] leading-tight truncate">{streamTitle}</span>
                    )}
                  </span>
                </div>
                <div className="flex items-center gap-2 pointer-events-auto">
                  {org?.isLive && (
                    <>
                      <span className="flex items-center gap-1 text-brand text-xs font-semibold">
                        <span className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse" /> LIVE
                      </span>
                      {viewerCount !== null && (
                        <span className="flex items-center gap-1 text-zinc-500 text-xs">
                          <Eye size={12} /> {viewerCount}
                        </span>
                      )}
                    </>
                  )}
                  {isOwner && (
                    <>
                      <Link href="/dashboard" className="text-white no-underline bg-brand px-2.5 py-1 rounded-md text-xs font-medium">Студия</Link>
                      <button onClick={handleLogout} className="text-zinc-500 bg-transparent border border-zinc-700 px-2.5 py-1 rounded-md text-xs cursor-pointer">Выйти</button>
                    </>
                  )}
                </div>
              </div>
            )}

            <div
              onClick={(e) => { e.stopPropagation(); setMobileViewOpen((v) => !v); setMobileChatOpen(false); resetUiTimer(); }}
              className="absolute top-0 z-[26] w-11 flex items-center justify-start cursor-pointer"
              style={{ left: mobileViewOpen ? 180 : 0, bottom: 50, transition: 'left 0.2s' }}
            >
              <span className="text-white rounded-r-md py-2.5 px-1.5 leading-none" style={{ background: 'rgba(0,0,0,0.5)', opacity: uiVisible ? 1 : 0, transition: 'opacity 0.3s' }}>
                {mobileViewOpen ? <CaretLeft size={16} /> : <CaretRight size={16} />}
              </span>
            </div>

            <div
              onClick={(e) => { e.stopPropagation(); setMobileChatOpen((v) => !v); setMobileViewOpen(false); resetUiTimer(); }}
              className="absolute top-0 z-[26] w-11 flex items-center justify-end cursor-pointer"
              style={{ right: mobileChatOpen ? 240 : 0, bottom: 50, transition: 'right 0.2s' }}
            >
              <span className="text-white rounded-l-md py-2.5 px-1.5 leading-none" style={{ background: 'rgba(0,0,0,0.5)', opacity: uiVisible ? 1 : 0, transition: 'opacity 0.3s' }}>
                {mobileChatOpen ? <CaretRight size={16} /> : <ChatCircle size={16} />}
              </span>
            </div>

            <div
              className="absolute top-0 z-[25] flex flex-col justify-center gap-6 p-4 backdrop-blur-sm overflow-y-auto"
              style={{ left: mobileViewOpen ? 0 : -180, bottom: 50, width: 180, background: 'rgba(12,12,14,0.95)', transition: 'left 0.2s' }}
            >
              {renderViewSwitcher()}
              <div className="flex flex-col gap-3">
                <Link href={archiveLink} className="flex items-center gap-1.5 text-zinc-500 text-xs no-underline hover:text-zinc-300 transition-colors">
                  <Archive size={14} /> Архив
                </Link>
                <FeedbackButton variant="panel" context={{ orgSlug, streamSlug }} />
              </div>
            </div>

            <div
              className="absolute top-0 z-[25] backdrop-blur-sm"
              style={{ right: mobileChatOpen ? 0 : -240, bottom: 50, width: 240, background: 'rgba(12,12,14,0.95)', transition: 'right 0.2s' }}
            >
              {org && <Chat orgSlug={orgSlug} streamSlug={streamSlug} onViewersChange={setViewerCount} authorName={isOwner ? (org.name ?? 'Автор') : undefined} authLoading={meLoading} />}
            </div>
          </>
        ) : (
          /* ── Portrait ─────────────────────────────────────────────────── */
          <>
            {/* Video 16:9 — swipe down to go back, right half = cycle camera, left half = toggle controls */}
            <div
              className="relative w-full bg-black shrink-0"
              style={{
                aspectRatio: '16/9',
                touchAction: 'none',
                transform: swipeOffset > 0 ? `translateY(${swipeOffset}px) scale(${1 - swipeOffset / 400})` : undefined,
                transition: swipeOffset === 0 ? 'transform 0.3s ease-out, opacity 0.3s ease-out' : 'none',
                opacity: swipeOffset > 0 ? Math.max(0.3, 1 - swipeOffset / 200) : 1,
                borderRadius: swipeOffset > 0 ? 12 : 0,
              }}
              onClick={handlePortraitTap}
              onTouchStart={handleSwipeStart}
              onTouchMove={handleSwipeMove}
              onTouchEnd={handleSwipeEnd}
            >
              {compositeUrl
                ? renderPlayer()
                : <div className="flex items-center justify-center h-full">
                    <TelevisionSimple size={40} className="text-zinc-700" weight="thin" />
                  </div>
              }

              {isBuffering && (
                <div className="absolute inset-0 flex items-center justify-center z-[11] pointer-events-none">
                  <div className="w-10 h-10 border-2 border-zinc-600 border-t-white rounded-full animate-spin" />
                </div>
              )}

              {/* Bottom bar */}
              {stream && (
                <div
                  className="absolute bottom-0 inset-x-0 z-20"
                  style={{ background: uiVisible ? 'linear-gradient(transparent, rgba(0,0,0,0.85))' : 'transparent' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {uiVisible && (
                    <div className="flex items-center justify-between px-3 py-2.5">
                      <button onClick={togglePause} className="text-white bg-transparent border-none w-11 h-11 flex items-center justify-center cursor-pointer active:scale-90 transition-transform">
                        {isPaused ? <Play size={22} weight="fill" /> : <Pause size={22} weight="fill" />}
                      </button>
                      <div className="flex items-center gap-1">
                        <button onClick={toggleMute} className="text-white bg-transparent border-none w-11 h-11 flex items-center justify-center cursor-pointer active:scale-90 transition-transform">
                          <VolumeIcon />
                        </button>
                        <button onClick={toggleFullscreen} className="text-white bg-transparent border-none w-11 h-11 flex items-center justify-center cursor-pointer active:scale-90 transition-transform">
                          <CornersOut size={20} />
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="px-2">
                    <MobileSeekBar
                      min={seekableStart}
                      max={duration || 0}
                      value={currentTime}
                      onChange={(t) => { matRef.current?.seekTo(t); setIsAtLive(false); }}
                      disabled={duration - seekableStart <= 0}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Camera selector row — composite shows multicam + cam1..4. */}
            {cameraRowEntries.length > 0 && (
              <div className="px-3 py-2 border-b border-zinc-800/40 shrink-0 flex items-center gap-1.5 overflow-x-auto">
                {cameraRowEntries.map((m) => {
                  const active = viewMode === m.key;
                  const isMulticam = m.key === 'multicam';
                  const dimmed = !m.isLive;
                  const onClick = () => {
                    if (dimmed) return;
                    setViewMode(m.key);
                  };
                  return (
                    <button
                      key={m.key}
                      onClick={onClick}
                      disabled={dimmed}
                      className={`flex items-center gap-1.5 shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 cursor-pointer border active:scale-95 ${
                        dimmed
                          ? 'bg-surface-card text-zinc-600 border-zinc-800/40 opacity-50 cursor-not-allowed'
                          : active
                            ? 'bg-brand/15 text-brand border-brand/30'
                            : 'bg-surface-card text-zinc-400 border-zinc-800/50 hover:text-zinc-200'
                      }`}
                      aria-label={isMulticam ? 'Мультикам' : `Камера ${m.label}`}
                    >
                      {isMulticam
                        ? <GridFour size={13} weight={active ? 'fill' : 'regular'} />
                        : <VideoCamera size={12} weight={active ? 'fill' : 'regular'} />}
                      {isMulticam
                        ? 'Все камеры'
                        : `Камера ${m.label}`}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Info bar */}
            <div className="px-4 py-2.5 border-b border-zinc-800/60 shrink-0">
              <div className="flex items-center justify-between gap-2">
                <button
                  onClick={() => router.back()}
                  className="text-zinc-400 bg-transparent border-none p-1.5 -ml-1.5 cursor-pointer shrink-0 active:scale-90 transition-transform"
                >
                  <CaretLeft size={20} weight="bold" />
                </button>
                <Link
                  href={orgHref}
                  className="flex items-center gap-2.5 min-w-0 flex-1 no-underline"
                  title={`К ${orgTitle}`}
                >
                  <OrgAvatar orgSlug={orgSlug} orgName={org?.name} hasImage={org?.hasImage} size={28} live={!!org?.isLive} />
                  <span className="min-w-0 flex flex-col">
                    <span className="text-zinc-50 font-semibold text-sm leading-snug truncate">{orgTitle}</span>
                    {streamTitle && (
                      <span className="text-zinc-400 text-xs leading-snug truncate">{streamTitle}</span>
                    )}
                  </span>
                </Link>
                <div className="flex items-center gap-2 shrink-0">
                  {org?.isLive && (
                    <span className="flex items-center gap-1 text-brand text-xs font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse" /> LIVE
                    </span>
                  )}
                  <span className="flex items-center gap-1 text-zinc-500 text-xs">
                    <Eye size={12} />
                    <span className="tabular-nums">{viewerCount !== null ? viewerCount : '—'}</span>
                  </span>
                </div>
              </div>
            </div>

            {/* Chat */}
            <div className="flex-1 overflow-hidden">
              {org && <Chat orgSlug={orgSlug} streamSlug={streamSlug} onViewersChange={setViewerCount} authorName={isOwner ? (org.name ?? 'Автор') : undefined} authLoading={meLoading} />}
            </div>
          </>
        )}
      </div>
    );
  }

  // ── Desktop layout ─────────────────────────────────────────────────────
  return (
    <div className="flex h-screen bg-surface-primary text-zinc-200 flex-col">
      {!isFullscreen && <Header />}

      <div className="flex-1 flex overflow-hidden">
        <div
          ref={videoColumnRef}
          className="flex-1 relative overflow-hidden bg-black cursor-pointer"
          onClick={handleVideoClick}
          onMouseMove={isFullscreen ? resetDesktopControlsTimer : undefined}
        >
          {compositeUrl
            ? renderPlayer()
            : <div className="flex flex-col items-center justify-center h-full gap-2">
                <TelevisionSimple size={48} className="text-zinc-700" weight="thin" />
                <span className="text-zinc-600 text-sm">Нет активной трансляции</span>
              </div>
          }

          {/* Title overlay (top-left) */}
          {!isFullscreen && org && (
            <div className="absolute top-3 left-3 z-10 flex flex-col gap-1 max-w-[60%] pointer-events-auto">
              <div className="flex items-center gap-2.5 bg-black/55 backdrop-blur-sm rounded-lg pl-2 pr-3 py-1.5">
                <Link
                  href={orgHref}
                  className="flex items-center gap-2.5 min-w-0 no-underline group"
                  title={`К ${orgTitle}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <CaretLeft size={14} className="text-zinc-400 group-hover:text-zinc-200 transition-colors shrink-0" />
                  <OrgAvatar orgSlug={orgSlug} orgName={org.name} hasImage={org.hasImage} size={32} live={org.isLive} />
                  <span className="min-w-0 flex flex-col">
                    <span className="text-zinc-50 text-sm font-semibold leading-tight truncate group-hover:text-white transition-colors">
                      {orgTitle}
                    </span>
                    {streamTitle && (
                      <span className="text-zinc-400 text-xs leading-tight truncate">{streamTitle}</span>
                    )}
                  </span>
                </Link>
                {org.isLive && (
                  <span className="flex items-center gap-1 text-brand text-xs font-semibold shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse" /> LIVE
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Viewer count overlay */}
          {viewerCount !== null && (
            <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5 bg-black/60 backdrop-blur-sm rounded-lg px-2.5 py-1.5 pointer-events-none">
              <Eye size={14} className="text-zinc-400" />
              <span className="text-zinc-300 text-xs font-medium tabular-nums">{viewerCount}</span>
            </div>
          )}

          {/* Buffering spinner */}
          {isBuffering && (
            <div className="absolute inset-0 flex items-center justify-center z-[11] pointer-events-none">
              <div className="w-12 h-12 border-3 border-zinc-600 border-t-white rounded-full animate-spin" />
            </div>
          )}

          {!isFullscreen && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); setViewPanelOpen((v) => !v); }}
                className="absolute top-1/2 -translate-y-1/2 z-10 bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-700/50 p-1.5 cursor-pointer rounded-r-lg transition-all text-white"
                style={{ left: viewPanelOpen ? 160 : 0 }}>
                {viewPanelOpen ? <CaretLeft size={14} /> : <CaretRight size={14} />}
              </button>
              {viewPanelOpen && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="absolute left-0 inset-y-0 w-40 backdrop-blur-sm p-4 flex flex-col justify-center z-[9] overflow-y-auto"
                  style={{ background: 'rgba(12,12,14,0.95)' }}>
                  {renderViewSwitcher()}
                  <div className="mt-6 flex flex-col gap-3">
                    <Link href={archiveLink} className="flex items-center gap-1.5 text-zinc-500 text-xs no-underline hover:text-zinc-300 transition-colors">
                      <Archive size={14} /> Архив
                    </Link>
                    <FeedbackButton variant="panel" context={{ orgSlug, streamSlug }} />
                  </div>
                </div>
              )}
            </>
          )}

          {stream && (
            <div
              className="absolute inset-x-0 bottom-0 z-20 px-3 py-2.5 flex items-center gap-2 transition-opacity duration-300"
              style={{ background: 'linear-gradient(transparent, rgba(0,0,0,0.85))', opacity: desktopControlsVisible ? 1 : 0, pointerEvents: desktopControlsVisible ? 'auto' : 'none' }}
              onClick={(e) => e.stopPropagation()}
            >
              <button onClick={togglePause} className="text-white bg-transparent border-none w-9 h-9 rounded flex items-center justify-center cursor-pointer shrink-0 hover:bg-white/10 transition-colors">
                {isPaused ? <Play size={18} weight="fill" /> : <Pause size={18} weight="fill" />}
              </button>
              {!isAtLive && (
                <button onClick={goToLive} className="bg-brand text-white text-[0.65rem] font-bold px-2 py-0.5 rounded-md shrink-0 cursor-pointer border-none">LIVE</button>
              )}
              <span className="text-zinc-500 text-xs font-mono tabular-nums shrink-0">{formatTime(currentTime - seekableStart)}</span>
              <input type="range" min={seekableStart} max={duration || 0} step={0.1} value={currentTime} onChange={handleSeek} className="flex-1" />
              <span className="text-zinc-500 text-xs font-mono tabular-nums shrink-0">{formatTime(duration - seekableStart)}</span>
              <input type="range" min={0} max={1} step={0.01} value={volume} onChange={(e) => setVolume(parseFloat(e.target.value))} className="w-20 shrink-0" />
              <button onClick={toggleMute} className="text-white bg-transparent border-none w-9 h-9 rounded flex items-center justify-center cursor-pointer shrink-0 hover:bg-white/10 transition-colors"><VolumeIcon /></button>
              {(matRef.current?.getQualityLevels()?.length ?? 0) > 1 && (
                <div className="relative shrink-0">
                  <button
                    onClick={() => setQualityMenuOpen((v) => !v)}
                    className="text-white bg-transparent border-none h-9 px-2 rounded flex items-center gap-1 cursor-pointer hover:bg-white/10 transition-colors text-xs font-medium"
                  >
                    <GearSix size={16} />
                    <span className="text-zinc-400">{qualityLabel()}</span>
                  </button>
                  {qualityMenuOpen && (
                    <div className="absolute bottom-full right-0 mb-2 bg-zinc-900/95 border border-zinc-700/50 rounded-lg overflow-hidden min-w-[120px] backdrop-blur-sm">
                      <button
                        onClick={() => { setQualityLevel(-1); matRef.current?.setQualityLevel(-1); setQualityMenuOpen(false); }}
                        className={`w-full text-left px-3 py-2 text-sm cursor-pointer border-none transition-colors ${qualityLevel === -1 ? 'bg-white/10 text-white' : 'bg-transparent text-zinc-300 hover:bg-white/5'}`}
                      >
                        Авто
                      </button>
                      {(matRef.current?.getQualityLevels() ?? []).map((q) => (
                        <button
                          key={q.index}
                          onClick={() => { setQualityLevel(q.index); matRef.current?.setQualityLevel(q.index); setQualityMenuOpen(false); }}
                          className={`w-full text-left px-3 py-2 text-sm cursor-pointer border-none transition-colors ${qualityLevel === q.index ? 'bg-white/10 text-white' : 'bg-transparent text-zinc-300 hover:bg-white/5'}`}
                        >
                          {q.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <button onClick={toggleFullscreen} className="text-white bg-transparent border-none w-9 h-9 rounded flex items-center justify-center cursor-pointer shrink-0 hover:bg-white/10 transition-colors">
                {isFullscreen ? <CornersIn size={18} /> : <CornersOut size={18} />}
              </button>
            </div>
          )}
        </div>

        <>
          <button
            onClick={(e) => { e.stopPropagation(); setChatOpen((v) => !v); }}
            className="absolute top-1/2 -translate-y-1/2 z-10 bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-700/50 p-1.5 cursor-pointer rounded-l-lg transition-all text-white"
            style={{ right: chatOpen ? 300 : 0 }}>
            {chatOpen ? <CaretRight size={14} /> : <ChatCircle size={14} />}
          </button>
          <div className="overflow-hidden shrink-0 transition-[width] duration-200" style={{ width: chatOpen ? 300 : 0, borderLeft: chatOpen ? '1px solid rgba(39,39,42,0.6)' : 'none' }}>
            <div className="h-full" style={{ width: 300 }}>
              {org && <Chat orgSlug={orgSlug} streamSlug={streamSlug} onViewersChange={setViewerCount} authorName={isOwner ? (org.name ?? 'Автор') : undefined} authLoading={meLoading} />}
            </div>
          </div>
        </>
      </div>
    </div>
  );
}
