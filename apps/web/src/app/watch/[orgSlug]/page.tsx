'use client';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import MatPlayer, { type MatPlayerHandle } from '@/components/MatPlayer';
import ViewSwitcher, { type ViewMode } from '@/components/ViewSwitcher';
import { Chat } from '@/components/Chat';

interface OrgWatch {
  slug: string;
  name: string;
  description?: string;
  isLive: boolean;
  streamTitle: string;
  streamDescription?: string;
  streamIsPublic: boolean;
  accessDenied?: boolean;
}
interface StreamInfo { hlsUrl: string }

const ExpandIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
  </svg>
);
const CompressIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>
  </svg>
);

export default function WatchPage({ params }: { params: { orgSlug: string } }) {
  const { orgSlug } = params;
  const searchParams = useSearchParams();
  const previewKey = searchParams.get('key') ?? undefined;

  const [viewMode, setViewMode]             = useState<ViewMode>('multicam');
  const [chatOpen, setChatOpen]             = useState(true);
  const [viewPanelOpen, setViewPanelOpen]   = useState(false);
  const [isMobile, setIsMobile]             = useState(false);
  const [uiVisible, setUiVisible]           = useState(true);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [mobileViewOpen, setMobileViewOpen] = useState(false);
  const [isFullscreen, setIsFullscreen]     = useState(false);
  const [viewerCount, setViewerCount]       = useState<number | null>(null);

  const uiTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const matRef         = useRef<MatPlayerHandle>(null);
  const videoColumnRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  function resetUiTimer() {
    setUiVisible(true);
    if (uiTimerRef.current) clearTimeout(uiTimerRef.current);
    uiTimerRef.current = setTimeout(() => setUiVisible(false), 3000);
  }

  useEffect(() => {
    if (!isMobile) return;
    resetUiTimer();
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
      videoColumnRef.current?.requestFullscreen();
    } else {
      matRef.current?.enterIOSFullscreen();
    }
  }

  const apiUrl = previewKey
    ? `/v1/public/orgs/${orgSlug}?key=${previewKey}`
    : `/v1/public/orgs/${orgSlug}`;

  const { data: org } = useQuery({
    queryKey: ['watch', orgSlug, previewKey],
    queryFn: () => api.get<OrgWatch>(apiUrl),
    refetchInterval: 15_000,
  });

  const { data: stream } = useQuery({
    queryKey: ['stream', orgSlug, previewKey],
    queryFn: () => api.get<StreamInfo>(`/v1/public/orgs/${orgSlug}/stream${previewKey ? `?key=${previewKey}` : ''}`),
    enabled: org?.isLive === true,
    retry: false,
  });

  function handleVideoClick(e: React.MouseEvent<HTMLDivElement>) {
    setMobileViewOpen(false);
    if (viewMode !== 'multicam') { setViewMode('multicam'); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if      (x < 0.5 && y < 0.5) setViewMode('cam1');
    else if (x >= 0.5 && y < 0.5) setViewMode('cam2');
    else if (x < 0.5)             setViewMode('cam3');
    else                           setViewMode('cam4');
  }

  const fsBtn: React.CSSProperties = {
    position: 'absolute', right: 12, bottom: 12, zIndex: 20,
    background: 'rgba(0,0,0,0.6)', border: 'none', color: '#fff',
    width: 36, height: 36, borderRadius: 4, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };

  // ── Mobile layout ──────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#000' }} onClick={resetUiTimer}>
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }} onClick={handleVideoClick}>
          {stream
            ? <MatPlayer ref={matRef} streamUrl={stream.hlsUrl} viewMode={viewMode} />
            : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#555' }}>
                {event ? 'Трансляция скоро начнётся...' : 'Нет активной трансляции'}
              </div>
          }
          {stream && (
            <button onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }} style={fsBtn}>
              {isFullscreen ? <CompressIcon /> : <ExpandIcon />}
            </button>
          )}
        </div>

        {uiVisible && (
          <>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '0.75rem 1rem', background: 'linear-gradient(to bottom, rgba(0,0,0,0.7), transparent)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', pointerEvents: 'none' }}>
              <span style={{ fontWeight: 700, color: '#fff' }}>{org?.name}</span>
              {event && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ color: '#e53', fontSize: '0.75rem', fontWeight: 600 }}>● LIVE</span>
                  {viewerCount !== null && <span style={{ color: '#888', fontSize: '0.75rem' }}>👁 {viewerCount}</span>}
                </div>
              )}
            </div>

            <button
              onClick={(e) => { e.stopPropagation(); setMobileViewOpen((v) => !v); setMobileChatOpen(false); }}
              style={{ position: 'absolute', left: mobileViewOpen ? 180 : 0, top: '50%', transform: 'translateY(-50%)', background: 'rgba(0,0,0,0.6)', border: 'none', color: '#fff', padding: '0.75rem 0.5rem', cursor: 'pointer', borderRadius: '0 4px 4px 0', transition: 'left 0.2s' }}>
              {mobileViewOpen ? '‹' : '›'}
            </button>

            {event && (
              <button
                onClick={(e) => { e.stopPropagation(); setMobileChatOpen((v) => !v); setMobileViewOpen(false); }}
                style={{ position: 'absolute', right: mobileChatOpen ? 240 : 0, top: '50%', transform: 'translateY(-50%)', background: 'rgba(0,0,0,0.6)', border: 'none', color: '#fff', padding: '0.75rem 0.5rem', cursor: 'pointer', borderRadius: '4px 0 0 4px', transition: 'right 0.2s' }}>
                {mobileChatOpen ? '›' : '‹'}
              </button>
            )}
          </>
        )}

        <div style={{ position: 'absolute', left: mobileViewOpen ? 0 : -180, top: 0, bottom: 0, width: 180, background: 'rgba(17,17,17,0.95)', padding: '1rem', transition: 'left 0.2s', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <ViewSwitcher mode={viewMode} onChange={(m) => { setViewMode(m); setMobileViewOpen(false); }} />
        </div>

        {event && (
          <div style={{ position: 'absolute', right: mobileChatOpen ? 0 : -240, top: 0, bottom: 0, width: 240, background: 'rgba(17,17,17,0.95)', transition: 'right 0.2s' }}>
            <Chat eventId={event.id} onViewersChange={setViewerCount} />
          </div>
        )}

        <div
          onClick={(e) => { e.stopPropagation(); setMobileViewOpen((v) => !v); setMobileChatOpen(false); resetUiTimer(); }}
          style={{ position: 'absolute', left: mobileViewOpen ? 180 : 0, top: 0, bottom: 0, width: 44, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', transition: 'left 0.2s', zIndex: 6 }}>
          <span style={{ color: '#fff', fontSize: '1.25rem', opacity: uiVisible ? 1 : 0, transition: 'opacity 0.3s', background: 'rgba(0,0,0,0.45)', borderRadius: '0 4px 4px 0', padding: '0.6rem 0.35rem', lineHeight: 1 }}>
            {mobileViewOpen ? '‹' : '›'}
          </span>
        </div>

        <div
          onClick={(e) => { e.stopPropagation(); setMobileChatOpen((v) => !v); setMobileViewOpen(false); resetUiTimer(); }}
          style={{ position: 'absolute', right: mobileChatOpen ? 240 : 0, top: 0, bottom: 0, width: 44, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', transition: 'right 0.2s', zIndex: 6 }}>
          <span style={{ color: '#fff', fontSize: '1.25rem', opacity: uiVisible ? 1 : 0, transition: 'opacity 0.3s', background: 'rgba(0,0,0,0.45)', borderRadius: '4px 0 0 4px', padding: '0.6rem 0.35rem', lineHeight: 1 }}>
            {mobileChatOpen ? '›' : '‹'}
          </span>
        </div>

        <div style={{ position: 'absolute', left: mobileViewOpen ? 0 : -180, top: 0, bottom: 0, width: 180, background: 'rgba(17,17,17,0.95)', padding: '1rem', transition: 'left 0.2s', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '1.5rem', zIndex: 5 }}>
          <ViewSwitcher mode={viewMode} onChange={(m) => { setViewMode(m); setMobileViewOpen(false); }} />
          <Link href={archiveLink} style={{ color: '#888', fontSize: '0.8rem', textDecoration: 'none' }}>Архив →</Link>
        </div>

        <div style={{ position: 'absolute', right: mobileChatOpen ? 0 : -240, top: 0, bottom: 0, width: 240, background: 'rgba(17,17,17,0.95)', transition: 'right 0.2s', zIndex: 5 }}>
          {org && <Chat orgSlug={orgSlug} onViewersChange={setViewerCount} />}
        </div>
      </div>
    );
  }

  // ── Desktop layout ─────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100vh', background: '#0a0a0a', color: '#fff', flexDirection: 'column' }}>
      {!isFullscreen && (
        <div style={{ padding: '0.75rem 1rem', background: '#111', borderBottom: '1px solid #222', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <Link href="/" style={{ color: '#888', textDecoration: 'none', fontSize: '0.875rem' }}>← Главная</Link>
            <span style={{ fontWeight: 700 }}>{org?.name}</span>
            {event && <span style={{ color: '#888', fontSize: '0.875rem' }}>{event.title}</span>}
          </div>
          {event && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ color: '#e53', fontSize: '0.75rem', fontWeight: 600 }}>● LIVE</span>
              {viewerCount !== null && <span style={{ color: '#888', fontSize: '0.75rem' }}>👁 {viewerCount}</span>}
            </div>
          )}
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Video column — fullscreened as a whole so ViewSwitcher stays visible */}
        <div
          ref={videoColumnRef}
          style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#000', cursor: 'pointer' }}
          onClick={handleVideoClick}
        >
          {stream
            ? <MatPlayer ref={matRef} streamUrl={stream.hlsUrl} viewMode={viewMode} />
            : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#555' }}>
                {event ? 'Трансляция скоро начнётся...' : 'Нет активной трансляции'}
              </div>
          }

          {/* ViewSwitcher — always-visible handle on the left edge */}
          <div
            onMouseEnter={() => setViewPanelOpen(true)}
            onMouseLeave={() => setViewPanelOpen(false)}
            onClick={(e) => e.stopPropagation()}
            style={{ position: 'absolute', left: 0, top: 0, bottom: 0, zIndex: 10, display: 'flex' }}
          >
            {/* Visible tab strip */}
            <div style={{
              width: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(0,0,0,0.45)', borderRadius: '0 6px 6px 0',
              color: '#aaa', fontSize: 14, userSelect: 'none', letterSpacing: 1,
              writingMode: 'vertical-rl', gap: 4, paddingBlock: 12,
              transition: 'background 0.15s',
            }}>
              ⊞
            </div>
            {/* Expanded panel */}
            {viewPanelOpen && (
              <div style={{ position: 'absolute', left: 24, top: 0, bottom: 0, width: 152, background: 'rgba(17,17,17,0.95)', padding: '1rem', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <ViewSwitcher mode={viewMode} onChange={setViewMode} />
              </div>
            )}
          </div>

          {/* Fullscreen button */}
          {stream && (
            <button onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }} style={fsBtn}>
              {isFullscreen ? <CompressIcon /> : <ExpandIcon />}
            </button>
          )}
        </div>

        {/* Chat panel */}
        {event && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); setChatOpen((v) => !v); }}
              style={{ position: 'absolute', right: chatOpen ? 280 : 0, top: '50%', transform: 'translateY(-50%)', zIndex: 10, background: '#222', border: 'none', color: '#fff', padding: '0.5rem 0.4rem', cursor: 'pointer', borderRadius: '4px 0 0 4px', transition: 'right 0.2s' }}>
              {chatOpen ? '›' : '‹'}
            </button>
            <div style={{ width: chatOpen ? 280 : 0, overflow: 'hidden', borderLeft: chatOpen ? '1px solid #222' : 'none', transition: 'width 0.2s', flexShrink: 0 }}>
              <div style={{ width: 280, height: '100%' }}>
                <Chat eventId={event.id} onViewersChange={setViewerCount} />
              </div>
          }

          {!isFullscreen && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); setViewPanelOpen((v) => !v); }}
                style={{ position: 'absolute', left: viewPanelOpen ? 160 : 0, top: '50%', transform: 'translateY(-50%)', zIndex: 10, background: '#222', border: 'none', color: '#fff', padding: '0.5rem 0.4rem', cursor: 'pointer', borderRadius: '0 4px 4px 0', transition: 'left 0.2s' }}>
                {viewPanelOpen ? '‹' : '›'}
              </button>
              {viewPanelOpen && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 160, background: 'rgba(17,17,17,0.95)', padding: '1rem', display: 'flex', flexDirection: 'column', justifyContent: 'center', zIndex: 9 }}>
                  <ViewSwitcher mode={viewMode} onChange={setViewMode} />
                </div>
              )}
            </>
          )}

          {stream && (
            <div
              style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 20, padding: '8px 12px', background: 'linear-gradient(transparent, rgba(0,0,0,0.8))', display: 'flex', alignItems: 'center', gap: 8, transition: 'opacity 0.3s', opacity: desktopControlsVisible ? 1 : 0, pointerEvents: desktopControlsVisible ? 'auto' : 'none' }}
              onClick={(e) => e.stopPropagation()}
            >
              {!isAtLive && (
                <button onClick={goToLive} style={{ background: '#e53', border: 'none', color: '#fff', padding: '2px 8px', borderRadius: 4, cursor: 'pointer', fontSize: '0.7rem', fontWeight: 700, flexShrink: 0 }}>LIVE</button>
              )}
              <span style={{ color: '#aaa', fontSize: '0.7rem', flexShrink: 0 }}>{formatTime(currentTime)}</span>
              <input type="range" min={0} max={duration || 0} step={0.1} value={currentTime} onChange={handleSeek} style={{ flex: 1, accentColor: '#e53' }} />
              <span style={{ color: '#aaa', fontSize: '0.7rem', flexShrink: 0 }}>{formatTime(duration)}</span>
              <input type="range" min={0} max={1} step={0.01} value={volume} onChange={(e) => setVolume(parseFloat(e.target.value))} style={{ width: 80, accentColor: '#e53', flexShrink: 0 }} />
              <button style={iconBtn}><VolumeIcon /></button>
              <button onClick={toggleFullscreen} style={iconBtn}>
                {isFullscreen ? <CompressIcon /> : <ExpandIcon />}
              </button>
            </div>
          )}
        </div>

        <>
          <button
            onClick={(e) => { e.stopPropagation(); setChatOpen((v) => !v); }}
            style={{ position: 'absolute', right: chatOpen ? 280 : 0, top: '50%', transform: 'translateY(-50%)', zIndex: 10, background: '#222', border: 'none', color: '#fff', padding: '0.5rem 0.4rem', cursor: 'pointer', borderRadius: '4px 0 0 4px', transition: 'right 0.2s' }}>
            {chatOpen ? '›' : '‹'}
          </button>
          <div style={{ width: chatOpen ? 280 : 0, overflow: 'hidden', borderLeft: chatOpen ? '1px solid #222' : 'none', transition: 'width 0.2s', flexShrink: 0 }}>
            <div style={{ width: 280, height: '100%' }}>
              {org && <Chat orgSlug={orgSlug} onViewersChange={setViewerCount} />}
            </div>
          </div>
        </>
      </div>
    </div>
  );
}
