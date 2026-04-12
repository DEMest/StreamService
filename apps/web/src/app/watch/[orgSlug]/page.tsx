'use client';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import MatPlayer from '@/components/MatPlayer';
import ViewSwitcher from '@/components/ViewSwitcher';
import type { ViewMode, MatId } from '@/components/ViewSwitcher';
import { Chat } from '@/components/Chat';

const QUAD_ORIGIN: Record<number, string> = {
  1: '25% 25%', 2: '75% 25%', 3: '25% 75%', 4: '75% 75%',
};

interface OrgWatch {
  slug: string; name: string;
  events: { id: string; title: string; description?: string; isPublic: boolean; startedAt: string }[];
}

interface StreamInfo { hlsUrl: string }

export default function WatchPage({ params }: { params: { orgSlug: string } }) {
  const { orgSlug } = params;
  const [viewMode, setViewMode] = useState<ViewMode>('quad');
  const [activeMat, setActiveMat] = useState<MatId>(1);

  const { data: org } = useQuery({
    queryKey: ['watch', orgSlug],
    queryFn: () => api.get<OrgWatch>(`/v1/public/orgs/${orgSlug}`),
    refetchInterval: 15_000,
  });

  const { data: stream } = useQuery({
    queryKey: ['stream', orgSlug],
    queryFn: () => api.get<StreamInfo>(`/v1/public/orgs/${orgSlug}/stream`),
    enabled: (org?.events.length ?? 0) > 0,
  });

  const event = org?.events[0];

  const videoStyle: React.CSSProperties = {
    width: '100%', height: '100%',
    transform: viewMode === 'focus' ? `scale(2)` : 'scale(1)',
    transformOrigin: viewMode === 'focus' ? QUAD_ORIGIN[activeMat] : '50% 50%',
    transition: 'transform 0.3s ease, transform-origin 0.3s ease',
  };

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#0a0a0a', color: '#fff', flexDirection: 'column' }}>
      <div style={{ padding: '0.75rem 1rem', background: '#111', borderBottom: '1px solid #222', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={{ fontWeight: 700 }}>{org?.name}</span>
          {event && <span style={{ color: '#888', marginLeft: '1rem', fontSize: '0.875rem' }}>{event.title}</span>}
        </div>
        {event && <span style={{ color: '#e53', fontSize: '0.75rem', fontWeight: 600 }}>● LIVE</span>}
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
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
          <ViewSwitcher
            mode={viewMode}
            activeMat={activeMat}
            onModeChange={setViewMode}
            onMatSelect={setActiveMat}
          />
        </div>

        {event && (
          <div style={{ width: '280px', borderLeft: '1px solid #222' }}>
            <Chat eventId={event.id} />
          </div>
        )}
      </div>
    </div>
  );
}
