'use client';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import MatPlayer from '@/components/MatPlayer';
import ViewSwitcher, { type ViewMode } from '@/components/ViewSwitcher';
import { Chat } from '@/components/Chat';

const CAM_ORIGIN: Record<string, string> = {
  cam1: '0% 0%',
  cam2: '100% 0%',
  cam3: '0% 100%',
  cam4: '100% 100%',
};

interface OrgWatch {
  slug: string;
  name: string;
  description?: string;
  events: { id: string; title: string; description?: string; isPublic: boolean; startedAt: string }[];
}
interface StreamInfo { hlsUrl: string }

export default function WatchPage({ params }: { params: { orgSlug: string } }) {
  const { orgSlug } = params;
  const searchParams = useSearchParams();
  const previewKey = searchParams.get('key') ?? undefined;

  const [viewMode, setViewMode] = useState<ViewMode>('multicam');
  const [chatOpen, setChatOpen] = useState(true);
  const [viewPanelVisible, setViewPanelVisible] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [uiVisible, setUiVisible] = useState(true);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [mobileViewOpen, setMobileViewOpen] = useState(false);
  const uiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevModeRef = useRef<ViewMode>('multicam');

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

  const apiUrl = previewKey
    ? `/v1/public/orgs/${orgSlug}?key=${previewKey}`
    : `/v1/public/orgs/${orgSlug}`;

  const { data: org } = useQuery({
    queryKey: ['watch', orgSlug, previewKey],
    queryFn: () => api.get<OrgWatch>(apiUrl),
    refetchInterval: 15_000,
  });

  const { data: stream } = useQuery({
    queryKey: ['stream', orgSlug],
    queryFn: () => api.get<StreamInfo>(`/v1/public/orgs/${orgSlug}/stream`),
    enabled: (org?.events.length ?? 0) > 0,
  });

  const event = org?.events[0];

  function handleVideoClick(e: React.MouseEvent<HTMLDivElement>) {
    setMobileViewOpen(false);
    if (viewMode !== 'multicam') {
      setViewMode('multicam');
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (x < 0.5 && y < 0.5) setViewMode('cam1');
    else if (x >= 0.5 && y < 0.5) setViewMode('cam2');
    else if (x < 0.5) setViewMode('cam3');
    else setViewMode('cam4');
  }

  // Instant cut between cameras; smooth zoom only when entering/leaving multicam
  const camToCam = viewMode !== 'multicam' && prevModeRef.current !== 'multicam';
  useEffect(() => { prevModeRef.current = viewMode; }, [viewMode]);

  const videoStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    transform: viewMode === 'multicam' ? 'scale(1)' : 'scale(2)',
    transformOrigin: viewMode === 'multicam' ? '50% 50%' : CAM_ORIGIN[viewMode],
    transition: camToCam ? 'none' : 'transform 0.3s ease, transform-origin 0.3s ease',
  };

  if (isMobile) {
    return (
      <div
        style={{ position: 'fixed', inset: 0, background: '#000' }}
        onClick={resetUiTimer}
      >
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }} onClick={handleVideoClick}>
          {stream ? (
            <div style={videoStyle}>
              <MatPlayer streamUrl={stream.hlsUrl} />
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#555' }}>
              {event ? 'Трансляция скоро начнётся...' : 'Нет активной трансляции'}
            </div>
          )}
        </div>

        {uiVisible && (
          <>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '0.75rem 1rem', background: 'linear-gradient(to bottom, rgba(0,0,0,0.7), transparent)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 700, color: '#fff' }}>{org?.name}</span>
              {event && <span style={{ color: '#e53', fontSize: '0.75rem', fontWeight: 600 }}>● LIVE</span>}
            </div>

            <button
              onClick={(e) => { e.stopPropagation(); setMobileViewOpen((v) => !v); setMobileChatOpen(false); }}
              style={{ position: 'absolute', left: mobileViewOpen ? '180px' : 0, top: '50%', transform: 'translateY(-50%)', background: 'rgba(0,0,0,0.6)', border: 'none', color: '#fff', padding: '0.75rem 0.5rem', cursor: 'pointer', borderRadius: '0 4px 4px 0', transition: 'left 0.2s' }}>
              {mobileViewOpen ? '‹' : '›'}
            </button>

            {event && (
              <button
                onClick={(e) => { e.stopPropagation(); setMobileChatOpen((v) => !v); setMobileViewOpen(false); }}
                style={{ position: 'absolute', right: mobileChatOpen ? '240px' : 0, top: '50%', transform: 'translateY(-50%)', background: 'rgba(0,0,0,0.6)', border: 'none', color: '#fff', padding: '0.75rem 0.5rem', cursor: 'pointer', borderRadius: '4px 0 0 4px', transition: 'right 0.2s' }}>
                {mobileChatOpen ? '›' : '‹'}
              </button>
            )}
          </>
        )}

        <div style={{ position: 'absolute', left: mobileViewOpen ? 0 : '-180px', top: 0, bottom: 0, width: '180px', background: 'rgba(17,17,17,0.95)', padding: '1rem', transition: 'left 0.2s', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <ViewSwitcher mode={viewMode} onChange={(m) => { setViewMode(m); setMobileViewOpen(false); }} />
        </div>

        {event && (
          <div style={{ position: 'absolute', right: mobileChatOpen ? 0 : '-240px', top: 0, bottom: 0, width: '240px', background: 'rgba(17,17,17,0.95)', transition: 'right 0.2s' }}>
            <Chat eventId={event.id} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#0a0a0a', color: '#fff', flexDirection: 'column' }}>
      <div style={{ padding: '0.75rem 1rem', background: '#111', borderBottom: '1px solid #222', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Link href="/" style={{ color: '#888', textDecoration: 'none', fontSize: '0.875rem' }}>← Главная</Link>
          <span style={{ fontWeight: 700 }}>{org?.name}</span>
          {event && <span style={{ color: '#888', fontSize: '0.875rem' }}>{event.title}</span>}
        </div>
        {event && <span style={{ color: '#e53', fontSize: '0.75rem', fontWeight: 600 }}>● LIVE</span>}
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
        <div
          onMouseEnter={() => setViewPanelVisible(true)}
          onMouseLeave={() => setViewPanelVisible(false)}
          style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: viewPanelVisible ? '160px' : '16px', zIndex: 10, transition: 'width 0.2s' }}>
          {viewPanelVisible && (
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '160px', background: 'rgba(17,17,17,0.95)', padding: '1rem', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <ViewSwitcher mode={viewMode} onChange={setViewMode} />
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflow: 'hidden', position: 'relative', cursor: 'pointer' }} onClick={handleVideoClick}>
          {stream ? (
            <div style={videoStyle}>
              <MatPlayer streamUrl={stream.hlsUrl} />
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#555' }}>
              {event ? 'Трансляция скоро начнётся...' : 'Нет активной трансляции'}
            </div>
          )}
        </div>

        {event && (
          <>
            <button
              onClick={() => setChatOpen((v) => !v)}
              style={{ position: 'absolute', right: chatOpen ? '280px' : 0, top: '50%', transform: 'translateY(-50%)', zIndex: 10, background: '#222', border: 'none', color: '#fff', padding: '0.5rem 0.4rem', cursor: 'pointer', borderRadius: '4px 0 0 4px', transition: 'right 0.2s' }}>
              {chatOpen ? '›' : '‹'}
            </button>
            <div style={{ width: chatOpen ? '280px' : 0, overflow: 'hidden', borderLeft: chatOpen ? '1px solid #222' : 'none', transition: 'width 0.2s', flexShrink: 0 }}>
              <div style={{ width: '280px', height: '100%' }}>
                <Chat eventId={event.id} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
