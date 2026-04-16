'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { DashboardLayout } from '@/components/DashboardLayout';

interface OrgProfile {
  id: string;
  slug: string;
  name: string;
  ingestKey?: string;
  ingestKeyCreatedAt: string;
  isLive: boolean;
  autoStream: boolean;
  streamTitle: string;
  streamDescription?: string;
  streamIsPublic: boolean;
  streamPreviewKey?: string;
  previewMode: string;
  previewImagePath?: string;
}
interface Broadcast {
  id: string;
  title: string;
  description?: string;
  startedAt: string;
  endedAt?: string;
  recording?: {
    id: string;
    status: string;
    fileSize?: number;
    duration?: number;
  };
}

export default function DashboardPage() {
  const qc = useQueryClient();
  const [keyVisible, setKeyVisible] = useState(false);
  const [editingBroadcast, setEditingBroadcast] = useState<{ id: string; title: string; description: string } | null>(null);

  const { data: profile } = useQuery({
    queryKey: ['org-profile', keyVisible],
    queryFn: () => api.get<OrgProfile>(`/v1/org/me${keyVisible ? '?reveal=true' : ''}`),
    refetchInterval: 10_000,
  });

  const { data: broadcasts } = useQuery({
    queryKey: ['org-broadcasts'],
    queryFn: () => api.get<Broadcast[]>('/v1/org/broadcasts'),
  });

  const rotateMutation = useMutation({
    mutationFn: () => api.post('/v1/org/ingest-key/rotate'),
    onSuccess: () => { setKeyVisible(true); qc.invalidateQueries({ queryKey: ['org-profile'] }); },
  });

  const updateStreamMutation = useMutation({
    mutationFn: (data: Partial<OrgProfile>) => api.patch('/v1/org/stream', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org-profile'] }),
  });

  const uploadPreviewMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? '/api'}/v1/org/preview`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      if (!res.ok) throw new Error('Upload failed');
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org-profile'] }),
  });

  const deletePreviewMutation = useMutation({
    mutationFn: () => api.delete('/v1/org/preview'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org-profile'] }),
  });

  const updateBroadcastMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { title: string; description?: string } }) =>
      api.patch(`/v1/org/broadcasts/${id}`, data),
    onSuccess: () => { setEditingBroadcast(null); qc.invalidateQueries({ queryKey: ['org-broadcasts'] }); },
  });

  const deleteBroadcastMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/v1/org/broadcasts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org-broadcasts'] }),
  });

  const streamId = `publish:live/${profile?.slug}`;

  function copyText(text: string) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
    } else {
      legacyCopy(text);
    }
  }

  function legacyCopy(text: string) {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(el);
    el.focus();
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
  }

  function copyPreviewLink() {
    if (!profile?.streamPreviewKey) return;
    const url = `${window.location.origin}/watch/${profile.slug}?key=${profile.streamPreviewKey}`;
    copyText(url);
  }

  function formatTime(seconds: number): string {
    if (!seconds || !isFinite(seconds)) return '';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '0.5rem 0.75rem', background: '#0a0a0a',
    border: '1px solid #333', color: '#fff', borderRadius: '4px', fontSize: '0.875rem',
    boxSizing: 'border-box',
  };

  return (
    <DashboardLayout>
      <div style={{ padding: '2rem', maxWidth: '900px' }}>
        <h1 style={{ fontSize: '1.25rem', marginBottom: '2rem' }}>{profile?.name} — Панель управления</h1>

        {/* SRT Parameters */}
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
                    <button onClick={() => copyText(serverAddr)}
                      style={{ flexShrink: 0, background: '#2d2d2d', border: 'none', color: '#ccc', padding: '0.25rem 0.6rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>
                      Копировать
                    </button>
                  )}
                </div>
              );
            })()}

            <div style={{ display: 'flex', alignItems: 'center', padding: '0.625rem 0', borderBottom: '1px solid #1f1f1f', gap: '0.75rem' }}>
              <span style={{ width: '120px', flexShrink: 0, color: '#666', fontSize: '0.8rem' }}>Stream ID</span>
              <span style={{ flex: 1, fontFamily: 'monospace', fontSize: '0.875rem', wordBreak: 'break-all' }}>{streamId}</span>
              <button onClick={() => copyText(streamId)}
                style={{ flexShrink: 0, background: '#2d2d2d', border: 'none', color: '#ccc', padding: '0.25rem 0.6rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>
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
                  <button onClick={() => copyText(profile?.ingestKey ?? '')}
                    style={{ background: '#2d2d2d', border: 'none', color: '#ccc', padding: '0.25rem 0.6rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>
                    Копировать
                  </button>
                )}
                <button onClick={() => setKeyVisible((v) => !v)}
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

        {/* Stream settings */}
        <section style={{ background: '#1a1a1a', borderRadius: '8px', padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1rem', marginBottom: '1.25rem', color: '#ccc' }}>Настройки стрима</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

            <div>
              <label style={{ display: 'block', color: '#666', fontSize: '0.8rem', marginBottom: '0.4rem' }}>Название</label>
              <input
                key={profile?.streamTitle}
                defaultValue={profile?.streamTitle ?? ''}
                onBlur={(e) => {
                  if (e.target.value !== profile?.streamTitle) {
                    updateStreamMutation.mutate({ streamTitle: e.target.value });
                  }
                }}
                style={inputStyle}
                placeholder="Название трансляции"
              />
            </div>

            <div>
              <label style={{ display: 'block', color: '#666', fontSize: '0.8rem', marginBottom: '0.4rem' }}>Описание</label>
              <textarea
                key={profile?.streamDescription}
                defaultValue={profile?.streamDescription ?? ''}
                onBlur={(e) => {
                  if (e.target.value !== (profile?.streamDescription ?? '')) {
                    updateStreamMutation.mutate({ streamDescription: e.target.value || undefined });
                  }
                }}
                rows={2}
                style={{ ...inputStyle, resize: 'vertical' }}
                placeholder="Описание (необязательно)"
              />
            </div>

            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={profile?.streamIsPublic ?? true}
                  onChange={(e) => updateStreamMutation.mutate({ streamIsPublic: e.target.checked })}
                />
                <span style={{ color: '#ccc', fontSize: '0.875rem' }}>Публичная трансляция</span>
              </label>

              {!profile?.streamIsPublic && profile?.streamPreviewKey && (
                <button onClick={copyPreviewLink}
                  style={{ padding: '0.25rem 0.75rem', background: '#374151', border: 'none', color: '#ccc', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>
                  Скопировать ссылку для зрителей
                </button>
              )}
            </div>

            <div style={{ paddingTop: '0.5rem', borderTop: '1px solid #2a2a2a' }}>
              {profile?.isLive
                ? <span style={{ color: '#e53', fontSize: '0.875rem', fontWeight: 600 }}>● LIVE — идёт трансляция</span>
                : <span style={{ color: '#555', fontSize: '0.875rem' }}>Ожидание SRT-потока...</span>
              }
            </div>
          </div>
        </section>

        {/* Preview settings */}
        <section style={{ background: '#1a1a1a', borderRadius: '8px', padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1rem', marginBottom: '1.25rem', color: '#ccc' }}>Превью на главной</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

            <div>
              <label style={{ display: 'block', color: '#666', fontSize: '0.8rem', marginBottom: '0.4rem' }}>Камера для превью (во время стрима)</label>
              <select
                value={profile?.previewMode ?? 'multicam'}
                onChange={(e) => updateStreamMutation.mutate({ previewMode: e.target.value })}
                style={{ ...inputStyle, cursor: 'pointer' }}
              >
                <option value="multicam">Мультикам (все камеры)</option>
                <option value="cam1">Камера 1 (верхний левый)</option>
                <option value="cam2">Камера 2 (верхний правый)</option>
                <option value="cam3">Камера 3 (нижний левый)</option>
                <option value="cam4">Камера 4 (нижний правый)</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', color: '#666', fontSize: '0.8rem', marginBottom: '0.4rem' }}>Статичное превью (когда стрим не идёт)</label>
              {profile?.previewImagePath ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <img
                    src={`${process.env.NEXT_PUBLIC_API_URL ?? '/api'}/v1/public/orgs/${profile.slug}/thumbnail?t=${Date.now()}`}
                    alt="Текущее превью"
                    style={{ width: '160px', height: '90px', objectFit: 'cover', borderRadius: '4px', border: '1px solid #333' }}
                  />
                  <button
                    onClick={() => { if (confirm('Удалить превью?')) deletePreviewMutation.mutate(); }}
                    style={{ padding: '0.4rem 0.75rem', background: '#7f1d1d', border: 'none', color: '#fff', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>
                    Удалить
                  </button>
                </div>
              ) : (
                <p style={{ color: '#555', fontSize: '0.8rem', margin: '0 0 0.5rem' }}>Не установлено</p>
              )}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadPreviewMutation.mutate(file);
                  e.target.value = '';
                }}
                style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#888' }}
              />
              {uploadPreviewMutation.isPending && <p style={{ color: '#888', fontSize: '0.8rem', marginTop: '0.25rem' }}>Загрузка...</p>}
            </div>
          </div>
        </section>

        {/* Broadcasts archive */}
        <section style={{ background: '#1a1a1a', borderRadius: '8px', padding: '1.5rem' }}>
          <h2 style={{ fontSize: '1rem', marginBottom: '1rem', color: '#ccc' }}>Архив трансляций</h2>

          {broadcasts?.length === 0 && (
            <p style={{ color: '#555', fontSize: '0.875rem' }}>Завершённых трансляций пока нет.</p>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {broadcasts?.map((b) => (
              <div key={b.id} style={{ background: '#0a0a0a', borderRadius: '6px', padding: '0.75rem 1rem' }}>
                {editingBroadcast?.id === b.id ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <input
                      value={editingBroadcast.title}
                      onChange={(e) => setEditingBroadcast({ ...editingBroadcast, title: e.target.value })}
                      style={{ ...inputStyle }}
                      placeholder="Название"
                    />
                    <input
                      value={editingBroadcast.description}
                      onChange={(e) => setEditingBroadcast({ ...editingBroadcast, description: e.target.value })}
                      style={{ ...inputStyle }}
                      placeholder="Описание (необязательно)"
                    />
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        onClick={() => updateBroadcastMutation.mutate({ id: b.id, data: { title: editingBroadcast.title, description: editingBroadcast.description || undefined } })}
                        style={{ padding: '0.25rem 0.75rem', background: '#059669', border: 'none', color: '#fff', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>
                        Сохранить
                      </button>
                      <button onClick={() => setEditingBroadcast(null)}
                        style={{ padding: '0.25rem 0.75rem', background: '#374151', border: 'none', color: '#ccc', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>
                        Отмена
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                    <div>
                      <span style={{ fontWeight: 600 }}>{b.title}</span>
                      {b.description && <span style={{ marginLeft: '0.5rem', color: '#666', fontSize: '0.8rem' }}>{b.description}</span>}
                      <div style={{ fontSize: '0.75rem', color: '#555', marginTop: '0.2rem' }}>
                        {new Date(b.startedAt).toLocaleDateString('ru-RU')}
                        {b.recording?.duration ? ` · ${formatTime(b.recording.duration)}` : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <button
                        onClick={() => setEditingBroadcast({ id: b.id, title: b.title, description: b.description ?? '' })}
                        style={{ padding: '0.25rem 0.6rem', background: '#2d2d2d', border: 'none', color: '#ccc', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem' }}>
                        Изменить
                      </button>
                      {b.recording?.status === 'ready' && (
                        <a
                          href={`/api/v1/org/broadcasts/${b.id}/recording/download`}
                          style={{ padding: '0.25rem 0.6rem', background: '#1d4ed8', border: 'none', color: '#fff', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem', textDecoration: 'none' }}>
                          Скачать{b.recording.fileSize ? ` (${(b.recording.fileSize / 1024 / 1024 / 1024).toFixed(1)} ГБ)` : ''}
                        </a>
                      )}
                      {b.recording?.status === 'processing' && (
                        <span style={{ padding: '0.25rem 0.6rem', background: '#374151', color: '#888', borderRadius: '4px', fontSize: '0.75rem' }}>
                          Обрабатывается...
                        </span>
                      )}
                      <button
                        onClick={() => { if (confirm(`Удалить запись "${b.title}"?`)) deleteBroadcastMutation.mutate(b.id); }}
                        style={{ padding: '0.25rem 0.6rem', background: '#7f1d1d', border: 'none', color: '#fff', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem' }}>
                        Удалить
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </DashboardLayout>
  );
}
