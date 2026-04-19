'use client';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import MatPlayer, { type MatPlayerHandle } from '@/components/MatPlayer';
import ViewSwitcher, { type ViewMode } from '@/components/ViewSwitcher';
import {
  ArrowLeft, Broadcast, Play, X, Monitor,
  CornersOut, CornersIn, SpeakerHigh, SpeakerLow, SpeakerSlash,
  CaretLeft, CaretRight, VideoCamera, GearSix,
} from '@phosphor-icons/react';

interface BroadcastItem {
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
  const [isBuffering, setIsBuffering] = useState(false);
  const [qualityLevel, setQualityLevel] = useState(-1); // -1 = auto
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const [activeQuality, setActiveQuality] = useState(-1); // actual level chosen by ABR

  const matRef = useRef<MatPlayerHandle>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null);

  const url = previewKey
    ? `/v1/public/orgs/${orgSlug}/broadcasts?key=${previewKey}`
    : `/v1/public/orgs/${orgSlug}/broadcasts`;

  const { data: broadcasts, isLoading } = useQuery({
    queryKey: ['broadcasts', orgSlug, previewKey],
    queryFn: () => api.get<BroadcastItem[]>(url),
  });

  const selected = broadcasts?.find(b => b.id === selectedId);
  const recordingUrl = selectedId
    ? `/api/v1/public/orgs/${orgSlug}/broadcasts/${selectedId}/recording/hls/master.m3u8`
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
    setQualityMenuOpen(false);
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
    if (volume === 0) return <SpeakerSlash size={18} />;
    if (volume <= 0.5) return <SpeakerLow size={18} />;
    return <SpeakerHigh size={18} />;
  }

  const readyBroadcasts = broadcasts?.filter(b => b.recording?.status === 'ready') ?? [];

  return (
    <div className="min-h-[100dvh] bg-surface-primary text-zinc-200">
      {/* Header */}
      {!isFullscreen && (
        <div className="px-4 py-3 bg-surface-elevated border-b border-zinc-800/60 flex items-center gap-4">
          <Link href="/" className="flex items-center gap-1.5 text-zinc-500 hover:text-zinc-300 no-underline text-sm transition-colors">
            <ArrowLeft size={16} /> Главная
          </Link>
          <Link href={watchLink} className="flex items-center gap-1.5 text-zinc-500 hover:text-zinc-300 no-underline text-sm transition-colors">
            <Broadcast size={14} /> Смотреть LIVE
          </Link>
          <span className="font-semibold text-zinc-100">Архив трансляций</span>
        </div>
      )}

      {/* Player */}
      {selectedId && recordingUrl && (
        <div className="bg-black">
          <div
            ref={playerContainerRef}
            className={`relative bg-black mx-auto w-full ${isFullscreen ? 'h-screen' : ''}`}
            style={isFullscreen ? undefined : { maxWidth: '1100px', maxHeight: '70vh' }}
          >
            {!isFullscreen && <div className="w-full" style={{ paddingTop: '56.25%' }} />}
            <div className="absolute inset-0 cursor-pointer" onClick={handleVideoClick}>
              <MatPlayer
                ref={matRef}
                streamUrl={recordingUrl}
                viewMode={viewMode}
                volume={volume}
                isArchive={true}
                onMutedFallback={() => setVolume(0)}
                onTimeUpdate={handleTimeUpdate}
                onBuffering={setIsBuffering}
                onQualityChange={setActiveQuality}
              />
            </div>

            {/* Buffering spinner */}
            {isBuffering && (
              <div className="absolute inset-0 flex items-center justify-center z-[11] pointer-events-none">
                <div className="w-12 h-12 border-3 border-zinc-600 border-t-white rounded-full animate-spin" />
              </div>
            )}

            {/* View panel toggle */}
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
                    className="absolute left-0 inset-y-0 w-40 backdrop-blur-sm p-4 flex flex-col justify-center z-[9]"
                    style={{ background: 'rgba(12,12,14,0.95)' }}>
                    <ViewSwitcher mode={viewMode} onChange={setViewMode} />
                  </div>
                )}
              </>
            )}

            {/* Control bar */}
            <div
              className="absolute inset-x-0 bottom-0 z-20 px-3 py-2.5 flex items-center gap-2"
              style={{ background: 'linear-gradient(transparent, rgba(0,0,0,0.85))' }}
              onClick={(e) => e.stopPropagation()}
            >
              <span className="text-zinc-500 text-xs font-mono tabular-nums shrink-0">{formatTime(currentTime)}</span>
              <input type="range" min={0} max={duration || 0} step={0.1} value={currentTime} onChange={handleSeek} className="flex-1" />
              <span className="text-zinc-500 text-xs font-mono tabular-nums shrink-0">{formatTime(duration)}</span>
              <input type="range" min={0} max={1} step={0.01} value={volume} onChange={(e) => setVolume(parseFloat(e.target.value))} className="w-20 shrink-0" />
              <button onClick={() => setVolume(v => v === 0 ? 1 : 0)} className="text-white bg-transparent border-none w-9 h-9 rounded flex items-center justify-center cursor-pointer shrink-0 hover:bg-white/10 transition-colors"><VolumeIcon /></button>
              {/* Quality selector */}
              <div className="relative shrink-0">
                <button
                  onClick={() => setQualityMenuOpen((v) => !v)}
                  className="text-white bg-transparent border-none h-9 px-2 rounded flex items-center gap-1 cursor-pointer hover:bg-white/10 transition-colors text-xs font-medium"
                >
                  <GearSix size={16} />
                  <span className="text-zinc-400">
                    {qualityLevel === -1
                      ? `Авто${activeQuality >= 0 ? ` (${matRef.current?.getQualityLevels()?.[activeQuality]?.name ?? ''})` : ''}`
                      : (matRef.current?.getQualityLevels()?.[qualityLevel]?.name ?? 'HD')}
                  </span>
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
              <button onClick={toggleFullscreen} className="text-white bg-transparent border-none w-9 h-9 rounded flex items-center justify-center cursor-pointer shrink-0 hover:bg-white/10 transition-colors">
                {isFullscreen ? <CornersIn size={18} /> : <CornersOut size={18} />}
              </button>
            </div>

            {/* Close button */}
            <button
              onClick={() => { setSelectedId(null); setCurrentTime(0); setDuration(0); setIsBuffering(false); setQualityLevel(-1); setQualityMenuOpen(false); setActiveQuality(-1); }}
              className="absolute top-3 right-3 bg-black/70 hover:bg-black text-white p-2 rounded-lg z-20 transition-all cursor-pointer border-none flex items-center gap-1.5 text-xs"
            >
              <X size={14} /> Закрыть
            </button>

            {/* Title overlay */}
            {selected && !isFullscreen && (
              <div className="absolute top-0 inset-x-0 px-4 py-3 z-[15]" style={{ background: 'linear-gradient(rgba(0,0,0,0.7), transparent)' }}>
                <div className="font-semibold text-sm text-zinc-100">{selected.title}</div>
                <div className="text-zinc-500 text-xs mt-0.5">{formatDate(selected.startedAt)}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Broadcast list */}
      <div className="max-w-[920px] mx-auto px-6 py-6">
        {isLoading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-xl overflow-hidden bg-surface-elevated border border-zinc-800/50 animate-pulse">
                <div className="aspect-video bg-zinc-800" />
                <div className="p-4 space-y-2">
                  <div className="h-4 bg-zinc-800 rounded w-3/4" />
                  <div className="h-3 bg-zinc-800/60 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!isLoading && readyBroadcasts.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 gap-3 opacity-50">
            <VideoCamera size={48} className="text-zinc-600" weight="thin" />
            <p className="text-zinc-500 text-sm">Записей пока нет</p>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {readyBroadcasts.map((b) => (
            <article
              key={b.id}
              onClick={() => setSelectedId(selectedId === b.id ? null : b.id)}
              className={`group rounded-xl overflow-hidden border cursor-pointer transition-all duration-200 active:scale-[0.99] ${
                selectedId === b.id
                  ? 'bg-brand/5 border-brand/40'
                  : 'bg-surface-elevated border-zinc-800/50 hover:border-zinc-700 hover:shadow-lg hover:shadow-black/20'
              }`}
            >
              {/* Thumbnail */}
              <div className="relative aspect-video bg-zinc-900 overflow-hidden">
                <ThumbnailImage src={thumbUrl} />
                {b.recording?.duration && (
                  <span className="absolute bottom-2 right-2 px-1.5 py-0.5 bg-black/80 text-zinc-300 text-[0.65rem] font-mono rounded">
                    {formatTime(b.recording.duration)}
                  </span>
                )}
                {/* Play overlay on hover */}
                <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                  <div className="w-12 h-12 rounded-full bg-black/60 flex items-center justify-center">
                    <Play size={24} weight="fill" className="text-white" />
                  </div>
                </div>
              </div>

              {/* Info */}
              <div className="p-4">
                <div className="font-semibold text-sm text-zinc-100 group-hover:text-white transition-colors">{b.title}</div>
                <div className="text-zinc-500 text-xs mt-0.5">{formatDate(b.startedAt)}</div>
                {b.description && <div className="text-zinc-600 text-xs mt-1 line-clamp-2">{b.description}</div>}
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

function ThumbnailImage({ src }: { src: string }) {
  const [error, setError] = useState(false);
  return error ? (
    <div className="absolute inset-0 flex items-center justify-center">
      <Monitor size={48} className="text-zinc-800" weight="thin" />
    </div>
  ) : (
    <img
      src={src}
      alt=""
      onError={() => setError(true)}
      className="absolute inset-0 w-full h-full object-cover"
    />
  );
}
