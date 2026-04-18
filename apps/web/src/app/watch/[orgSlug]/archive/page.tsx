'use client';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import MatPlayer, { type MatPlayerHandle } from '@/components/MatPlayer';
import ViewSwitcher, { type ViewMode } from '@/components/ViewSwitcher';

interface Broadcast {
  id: string;
  title: string;
  description?: string;
  startedAt: string;
  endedAt: string;
  recording?: {
    id: string;
    status: string;
    fileSize?: number;
    duration?: number;
  };
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';

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
const SpeakerHighIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M11 5L6 9H2v6h4l5 4V5z"/>
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
  </svg>
);
const SpeakerLowIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M11 5L6 9H2v6h4l5 4V5z"/>
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
  </svg>
);
const SpeakerMuteIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M11 5L6 9H2v6h4l5 4V5z"/>
    <line x1="23" y1="9" x2="17" y2="15"/>
    <line x1="17" y1="9" x2="23" y2="15"/>
  </svg>
);
const PlayIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
    <path d="M8 5v14l11-7z"/>
  </svg>
);

export default function ArchivePage({ params }: { params: { orgSlug: string } }) {
  const { orgSlug } = params;
  const searchParams = useSearchParams();
  const previewKey = searchParams.get('key') ?? undefined;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('multicam');
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [viewPanelOpen, setViewPanelOpen] = useState(false);

  const matRef = useRef<MatPlayerHandle>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null);

  const url = previewKey
    ? `/v1/public/orgs/${orgSlug}/broadcasts?key=${previewKey}`
    : `/v1/public/orgs/${orgSlug}/broadcasts`;

  const { data: broadcasts, isLoading } = useQuery({
    queryKey: ['broadcasts', orgSlug, previewKey],
    queryFn: () => api.get<Broadcast[]>(url),
  });

  const selected = broadcasts?.find(b => b.id === selectedId);
  const recordingUrl = selectedId
    ? `/api/v1/public/orgs/${orgSlug}/broadcasts/${selectedId}/recording/stream`
    : null;

  const watchLink = previewKey ? `/watch/${orgSlug}?key=${previewKey}` : `/watch/${orgSlug}`;
  const thumbUrl = `${API_BASE}/v1/public/orgs/${orgSlug}/thumbnail`;

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  function toggleFullscreen() {
    if (isFullscreen) {
      document.exitFullscreen();
    } else if (playerContainerRef.current) {
      playerContainerRef.current.requestFullscreen();
    }
  }

  function handleTimeUpdate(current: number, dur: number) {
    setCurrentTime(current);
    setDuration(dur);
  }

  function handleSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const time = parseFloat(e.target.value);
    matRef.current?.seekTo(time);
    setCurrentTime(time);
  }

  function handleVideoClick(e: React.MouseEvent<HTMLDivElement>) {
    if (viewMode !== 'multicam') { setViewMode('multicam'); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if      (x < 0.5 && y < 0.5) setViewMode('cam1');
    else if (x >= 0.5 && y < 0.5) setViewMode('cam2');
    else if (x < 0.5)             setViewMode('cam3');
    else                           setViewMode('cam4');
  }

  function VolumeIcon() {
    if (volume === 0) return <SpeakerMuteIcon />;
    if (volume <= 0.5) return <SpeakerLowIcon />;
    return <SpeakerHighIcon />;
  }

  const iconBtn: React.CSSProperties = {
    background: 'none', border: 'none', color: '#fff',
    width: 36, height: 36, borderRadius: 4, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  };

  const readyBroadcasts = broadcasts?.filter(b => b.recording?.status === 'ready') ?? [];

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#fff' }}>
      {/* Header */}
      {!isFullscreen && (
        <div style={{ padding: '0.75rem 1rem', background: '#111', borderBottom: '1px solid #222', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Link href="/" style={{ color: '#888', textDecoration: 'none', fontSize: '0.875rem' }}>← Главная</Link>
          <Link href={watchLink} style={{ color: '#888', textDecoration: 'none', fontSize: '0.875rem' }}>Смотреть LIVE</Link>
          <span style={{ fontWeight: 700 }}>Архив трансляций</span>
        </div>
      )}

      {/* Player */}
      {selectedId && recordingUrl && (
        <div
          ref={playerContainerRef}
          style={{
            position: 'relative',
            background: '#000',
            aspectRatio: isFullscreen ? undefined : '16/9',
            maxHeight: isFullscreen ? '100vh' : '60vh',
            height: isFullscreen ? '100vh' : undefined,
          }}
        >
          <div
            style={{ position: 'absolute', inset: 0, cursor: 'pointer' }}
            onClick={handleVideoClick}
          >
            <MatPlayer
              ref={matRef}
              streamUrl={recordingUrl}
              viewMode={viewMode}
              volume={volume}
              isArchive={true}
              onMutedFallback={() => setVolume(0)}
              onTimeUpdate={handleTimeUpdate}
            />
          </div>

          {/* View panel toggle */}
          {!isFullscreen && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); setViewPanelOpen((v) => !v); }}
                style={{ position: 'absolute', left: viewPanelOpen ? 160 : 0, top: '50%', transform: 'translateY(-50%)', zIndex: 10, background: '#222', border: 'none', color: '#fff', padding: '0.5rem 0.4rem', cursor: 'pointer', borderRadius: '0 4px 4px 0', transition: 'left 0.2s' }}>
                {viewPanelOpen ? '\u2039' : '\u203A'}
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

          {/* Control bar */}
          <div
            style={{
              position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 20,
              padding: '8px 12px',
              background: 'linear-gradient(transparent, rgba(0,0,0,0.8))',
              display: 'flex', alignItems: 'center', gap: 8,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <span style={{ color: '#aaa', fontSize: '0.7rem', flexShrink: 0 }}>{formatTime(currentTime)}</span>
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={currentTime}
              onChange={handleSeek}
              style={{ flex: 1, accentColor: '#7c3aed' }}
            />
            <span style={{ color: '#aaa', fontSize: '0.7rem', flexShrink: 0 }}>{formatTime(duration)}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              style={{ width: 80, accentColor: '#7c3aed', flexShrink: 0 }}
            />
            <button onClick={() => setVolume(v => v === 0 ? 1 : 0)} style={iconBtn}><VolumeIcon /></button>
            <button onClick={toggleFullscreen} style={iconBtn}>
              {isFullscreen ? <CompressIcon /> : <ExpandIcon />}
            </button>
          </div>

          {/* Close button */}
          <button
            onClick={() => { setSelectedId(null); setCurrentTime(0); setDuration(0); }}
            style={{ position: 'absolute', top: 12, right: 12, background: 'rgba(0,0,0,0.7)', border: 'none', color: '#fff', padding: '0.4rem 0.8rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem', zIndex: 20 }}
          >
            ✕ Закрыть
          </button>

          {/* Title overlay */}
          {selected && !isFullscreen && (
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '0.75rem 1rem', background: 'linear-gradient(rgba(0,0,0,0.7), transparent)', zIndex: 15 }}>
              <div style={{ fontWeight: 600 }}>{selected.title}</div>
              <div style={{ color: '#888', fontSize: '0.8rem' }}>{formatDate(selected.startedAt)}</div>
            </div>
          )}
        </div>
      )}

      {/* Broadcast list */}
      <div style={{ padding: '1.5rem', maxWidth: 900, margin: '0 auto' }}>
        {isLoading && <p style={{ color: '#888' }}>Загрузка...</p>}

        {!isLoading && readyBroadcasts.length === 0 && (
          <p style={{ color: '#555' }}>Записей пока нет.</p>
        )}

        <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {readyBroadcasts.map((b) => (
            <div
              key={b.id}
              onClick={() => setSelectedId(selectedId === b.id ? null : b.id)}
              style={{
                background: selectedId === b.id ? '#1a1a2e' : '#1a1a1a',
                border: `1px solid ${selectedId === b.id ? '#7c3aed' : '#2d2d2d'}`,
                borderRadius: 8,
                cursor: 'pointer',
                overflow: 'hidden',
                transition: 'border-color 0.2s',
              }}
            >
              {/* Thumbnail */}
              <div style={{
                position: 'relative',
                width: '100%',
                paddingTop: '56.25%',
                background: '#0d0d0d',
              }}>
                <ThumbnailImage src={thumbUrl} />
                {/* Duration badge */}
                {b.recording?.duration && (
                  <span style={{
                    position: 'absolute',
                    bottom: 6,
                    right: 6,
                    background: 'rgba(0,0,0,0.8)',
                    color: '#fff',
                    fontSize: '0.7rem',
                    padding: '2px 6px',
                    borderRadius: 3,
                    fontFamily: 'monospace',
                  }}>
                    {formatTime(b.recording.duration)}
                  </span>
                )}
                {/* Play overlay */}
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: selectedId === b.id ? 0 : 0,
                  transition: 'opacity 0.2s',
                }}>
                  <div style={{
                    width: 48, height: 48, borderRadius: '50%',
                    background: 'rgba(0,0,0,0.6)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <PlayIcon />
                  </div>
                </div>
              </div>

              {/* Info */}
              <div style={{ padding: '0.75rem 1rem' }}>
                <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.2rem' }}>{b.title}</div>
                <div style={{ color: '#888', fontSize: '0.75rem' }}>{formatDate(b.startedAt)}</div>
                {b.description && <div style={{ color: '#666', fontSize: '0.75rem', marginTop: '0.2rem' }}>{b.description}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ThumbnailImage({ src }: { src: string }) {
  const [error, setError] = useState(false);
  return error ? (
    <div style={{
      position: 'absolute', inset: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#333', fontSize: '2rem',
    }}>
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </svg>
    </div>
  ) : (
    <img
      src={src}
      alt=""
      onError={() => setError(true)}
      style={{
        position: 'absolute', top: 0, left: 0,
        width: '100%', height: '100%', objectFit: 'cover',
      }}
    />
  );
}
