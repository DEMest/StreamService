'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { DashboardLayout } from '@/components/DashboardLayout';

interface OrgProfile { id: string; slug: string; name: string; ingestKey?: string; ingestKeyCreatedAt: string }
interface OrgEvent { id: string; title: string; status: string; isPublic: boolean; previewKey?: string; startedAt?: string }

export default function DashboardPage() {
  const qc = useQueryClient();
  const [keyVisible, setKeyVisible] = useState(false);
  const [newEventTitle, setNewEventTitle] = useState('');

  const { data: profile } = useQuery({
    queryKey: ['org-profile', keyVisible],
    queryFn: () => api.get<OrgProfile>(`/v1/org/me${keyVisible ? '?reveal=true' : ''}`),
  });

  const { data: events } = useQuery({
    queryKey: ['org-events'],
    queryFn: () => api.get<OrgEvent[]>('/v1/org/events'),
  });

  const rotateMutation = useMutation({
    mutationFn: () => api.post('/v1/org/ingest-key/rotate'),
    onSuccess: () => { setKeyVisible(true); qc.invalidateQueries({ queryKey: ['org-profile'] }); },
  });

  const createEventMutation = useMutation({
    mutationFn: (title: string) => api.post('/v1/org/events', { title }),
    onSuccess: () => { setNewEventTitle(''); qc.invalidateQueries({ queryKey: ['org-events'] }); },
  });

  const updateEventMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<OrgEvent> }) => api.patch(`/v1/org/events/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org-events'] }),
  });

  const deleteEventMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/v1/org/events/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org-events'] }),
  });

  const streamId = `publish:live/${profile?.slug}`;

  function copyPreviewLink(previewKey: string) {
    const url = `${window.location.origin}/watch/${profile?.slug}?key=${previewKey}`;
    navigator.clipboard.writeText(url).catch(() => alert(`Ссылка: ${url}`));
  }

  return (
    <DashboardLayout>
      <div style={{ padding: '2rem', maxWidth: '900px' }}>
        <h1 style={{ fontSize: '1.25rem', marginBottom: '2rem' }}>{profile?.name} — Панель управления</h1>

        <section style={{ background: '#1a1a1a', borderRadius: '8px', padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1rem', marginBottom: '1.25rem', color: '#ccc' }}>Параметры трансляции</h2>
          <div style={{ display: 'flex', flexDirection: 'column' }}>

            <div style={{ display: 'flex', alignItems: 'center', padding: '0.625rem 0', borderBottom: '1px solid #1f1f1f', gap: '0.75rem' }}>
              <span style={{ width: '120px', flexShrink: 0, color: '#666', fontSize: '0.8rem' }}>Протокол</span>
              <span style={{ flex: 1, fontFamily: 'monospace', fontSize: '0.875rem' }}>SRT</span>
            </div>

            {(() => {
              const serverIp = process.env.NEXT_PUBLIC_SERVER_IP ?? '';
              const serverAddr = serverIp ? `${serverIp}:8890` : ':8890';
              return (
                <div style={{ display: 'flex', alignItems: 'center', padding: '0.625rem 0', borderBottom: '1px solid #1f1f1f', gap: '0.75rem' }}>
                  <span style={{ width: '120px', flexShrink: 0, color: '#666', fontSize: '0.8rem' }}>Сервер</span>
                  <span style={{ flex: 1, fontFamily: 'monospace', fontSize: '0.875rem' }}>
                    {serverIp ? serverAddr : <span style={{ color: '#555' }}>Задайте NEXT_PUBLIC_SERVER_IP</span>}
                  </span>
                  {serverIp && (
                    <button
                      onClick={() => navigator.clipboard.writeText(serverAddr).catch(() => alert(serverAddr))}
                      style={{ flexShrink: 0, background: '#2d2d2d', border: 'none', color: '#ccc', padding: '0.25rem 0.6rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                      Копировать
                    </button>
                  )}
                </div>
              );
            })()}

            <div style={{ display: 'flex', alignItems: 'center', padding: '0.625rem 0', borderBottom: '1px solid #1f1f1f', gap: '0.75rem' }}>
              <span style={{ width: '120px', flexShrink: 0, color: '#666', fontSize: '0.8rem' }}>Stream ID</span>
              <span style={{ flex: 1, fontFamily: 'monospace', fontSize: '0.875rem', wordBreak: 'break-all' }}>{streamId}</span>
              <button
                onClick={() => navigator.clipboard.writeText(streamId).catch(() => alert(streamId))}
                style={{ flexShrink: 0, background: '#2d2d2d', border: 'none', color: '#ccc', padding: '0.25rem 0.6rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                Копировать
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', padding: '0.625rem 0', gap: '0.75rem' }}>
              <span style={{ width: '120px', flexShrink: 0, color: '#666', fontSize: '0.8rem' }}>Passphrase</span>
              <span style={{ flex: 1, fontFamily: 'monospace', fontSize: '0.875rem' }}>
                {keyVisible ? profile?.ingestKey : '••••••••••••••••••'}
              </span>
              <div style={{ flexShrink: 0, display: 'flex', gap: '0.4rem' }}>
                {keyVisible && (
                  <button
                    onClick={() => navigator.clipboard.writeText(profile?.ingestKey ?? '').catch(() => alert(profile?.ingestKey))}
                    style={{ background: '#2d2d2d', border: 'none', color: '#ccc', padding: '0.25rem 0.6rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                    Копировать
                  </button>
                )}
                <button
                  onClick={() => setKeyVisible((v) => !v)}
                  style={{ background: '#2d2d2d', border: 'none', color: '#ccc', padding: '0.25rem 0.6rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>
                  {keyVisible ? 'Скрыть' : 'Показать'}
                </button>
                <button
                  onClick={() => { if (confirm('Сгенерировать новый ключ? Текущий стрим будет прерван.')) rotateMutation.mutate(); }}
                  style={{ background: '#7c3aed', border: 'none', color: '#fff', padding: '0.25rem 0.6rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>
                  Сменить
                </button>
              </div>
            </div>

          </div>
        </section>

        <section style={{ background: '#1a1a1a', borderRadius: '8px', padding: '1.5rem' }}>
          <h2 style={{ fontSize: '1rem', marginBottom: '1rem', color: '#ccc' }}>События</h2>
          <form onSubmit={(e) => { e.preventDefault(); createEventMutation.mutate(newEventTitle); }}
            style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
            <input value={newEventTitle} onChange={(e) => setNewEventTitle(e.target.value)} placeholder="Название нового события"
              style={{ flex: 1, padding: '0.5rem', background: '#0a0a0a', border: '1px solid #333', color: '#fff', borderRadius: '4px' }} required />
            <button type="submit"
              style={{ padding: '0.5rem 1rem', background: '#059669', border: 'none', color: '#fff', borderRadius: '4px', cursor: 'pointer' }}>
              Создать
            </button>
          </form>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {events?.map((ev) => (
              <div key={ev.id} style={{ background: '#0a0a0a', borderRadius: '6px', padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                <div>
                  <span style={{ fontWeight: 600 }}>{ev.title}</span>
                  <span style={{ marginLeft: '0.75rem', fontSize: '0.75rem', color: ev.status === 'live' ? '#e53' : '#888' }}>
                    {ev.status === 'live' ? '● LIVE' : ev.status}
                  </span>
                  {!ev.isPublic && <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: '#7c3aed' }}>🔒</span>}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {ev.status === 'scheduled' && (
                    <button onClick={() => updateEventMutation.mutate({ id: ev.id, data: { status: 'live' } })}
                      style={{ padding: '0.25rem 0.75rem', background: '#e53', border: 'none', color: '#fff', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>
                      Начать
                    </button>
                  )}
                  {ev.status === 'live' && (
                    <button onClick={() => updateEventMutation.mutate({ id: ev.id, data: { status: 'ended' } })}
                      style={{ padding: '0.25rem 0.75rem', background: '#444', border: 'none', color: '#fff', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>
                      Завершить
                    </button>
                  )}
                  <button onClick={() => updateEventMutation.mutate({ id: ev.id, data: { isPublic: !ev.isPublic } })}
                    style={{ padding: '0.25rem 0.75rem', background: ev.isPublic ? '#1d4ed8' : '#374151', border: 'none', color: '#fff', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>
                    {ev.isPublic ? 'Публичный' : 'Скрытый'}
                  </button>
                  {!ev.isPublic && ev.previewKey && (
                    <button onClick={() => copyPreviewLink(ev.previewKey!)}
                      style={{ padding: '0.25rem 0.75rem', background: '#374151', border: 'none', color: '#ccc', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>
                      Копировать ссылку
                    </button>
                  )}
                  <button onClick={() => { if (confirm(`Удалить событие "${ev.title}"?`)) deleteEventMutation.mutate(ev.id); }}
                    style={{ padding: '0.25rem 0.75rem', background: '#7f1d1d', border: 'none', color: '#fff', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>
                    Удалить
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </DashboardLayout>
  );
}
