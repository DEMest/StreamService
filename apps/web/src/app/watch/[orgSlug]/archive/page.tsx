'use client';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import MatPlayer from '@/components/MatPlayer';

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
  if (!isFinite(seconds) || seconds <= 0) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function ArchivePage({ params }: { params: { orgSlug: string } }) {
  const { orgSlug } = params;
  const searchParams = useSearchParams();
  const previewKey = searchParams.get('key') ?? undefined;
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#fff' }}>
      <div style={{ padding: '0.75rem 1rem', background: '#111', borderBottom: '1px solid #222', display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <Link href="/" style={{ color: '#888', textDecoration: 'none', fontSize: '0.875rem' }}>← Главная</Link>
        <Link href={watchLink} style={{ color: '#888', textDecoration: 'none', fontSize: '0.875rem' }}>Смотреть LIVE</Link>
        <span style={{ fontWeight: 700 }}>Архив трансляций</span>
      </div>

      {selectedId && recordingUrl && (
        <div style={{ position: 'relative', background: '#000', aspectRatio: '16/9', maxHeight: '60vh' }}>
          <MatPlayer
            streamUrl={recordingUrl}
            viewMode="multicam"
            volume={1}
            isArchive={true}
            onMutedFallback={() => {}}
            onTimeUpdate={() => {}}
          />
          <button
            onClick={() => setSelectedId(null)}
            style={{ position: 'absolute', top: 12, right: 12, background: 'rgba(0,0,0,0.7)', border: 'none', color: '#fff', padding: '0.4rem 0.8rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem' }}
          >
            ✕ Закрыть
          </button>
          {selected && (
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '0.75rem 1rem', background: 'linear-gradient(transparent, rgba(0,0,0,0.8))' }}>
              <div style={{ fontWeight: 600 }}>{selected.title}</div>
              <div style={{ color: '#888', fontSize: '0.8rem' }}>{formatDate(selected.startedAt)}</div>
            </div>
          )}
        </div>
      )}

      <div style={{ padding: '1.5rem', maxWidth: 900, margin: '0 auto' }}>
        {isLoading && <p style={{ color: '#888' }}>Загрузка...</p>}

        {!isLoading && broadcasts?.length === 0 && (
          <p style={{ color: '#555' }}>Записей пока нет.</p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {broadcasts?.filter(b => b.recording?.status === 'ready').map((b) => (
            <div
              key={b.id}
              onClick={() => setSelectedId(selectedId === b.id ? null : b.id)}
              style={{
                background: selectedId === b.id ? '#1a1a2e' : '#1a1a1a',
                border: `1px solid ${selectedId === b.id ? '#7c3aed' : '#2d2d2d'}`,
                borderRadius: 8,
                padding: '1rem 1.25rem',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '1rem',
              }}
            >
              <div>
                <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>{b.title}</div>
                <div style={{ color: '#888', fontSize: '0.8rem' }}>{formatDate(b.startedAt)}</div>
                {b.description && <div style={{ color: '#666', fontSize: '0.8rem', marginTop: '0.25rem' }}>{b.description}</div>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexShrink: 0 }}>
                {b.recording?.duration && (
                  <span style={{ color: '#888', fontSize: '0.8rem' }}>{formatTime(b.recording.duration)}</span>
                )}
                <span style={{ color: selectedId === b.id ? '#7c3aed' : '#555', fontSize: '0.8rem' }}>
                  {selectedId === b.id ? '▶ Воспроизводится' : '▶ Смотреть'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
