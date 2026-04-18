'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Broadcast, Gear, ImageSquare, Archive, Copy, Eye, EyeSlash, ArrowsClockwise, PencilSimple, DownloadSimple, Trash, VideoCamera, Upload } from '@phosphor-icons/react';

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
interface BroadcastItem {
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

const inputClasses = 'w-full px-3 py-2 bg-surface-primary border border-zinc-700 rounded-lg text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-brand focus:ring-1 focus:ring-brand/30 outline-none transition-colors';

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
    queryFn: () => api.get<BroadcastItem[]>('/v1/org/broadcasts'),
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

  return (
    <DashboardLayout>
      <div className="max-w-[920px] mx-auto px-6 py-8 space-y-5">
        <h1 className="text-xl font-semibold text-zinc-50 tracking-tight">{profile?.name} — Панель управления</h1>

        {/* SRT Parameters */}
        <section className="bg-surface-elevated border border-zinc-800/50 rounded-xl p-5">
          <h2 className="flex items-center gap-2 text-base font-medium text-zinc-300 mb-4">
            <Broadcast size={18} className="text-brand" weight="fill" />
            Параметры трансляции
          </h2>
          <div className="flex flex-col">
            <div className="flex items-center py-3 border-b border-zinc-800/40 gap-3">
              <span className="w-28 shrink-0 text-xs text-zinc-500">Протокол</span>
              <span className="flex-1 font-mono text-sm text-zinc-300">SRT</span>
            </div>

            {(() => {
              const serverIp = process.env.NEXT_PUBLIC_SERVER_IP ?? '';
              const serverAddr = serverIp ? `${serverIp}:8890` : ':8890';
              return (
                <div className="flex items-center py-3 border-b border-zinc-800/40 gap-3">
                  <span className="w-28 shrink-0 text-xs text-zinc-500">Сервер</span>
                  <span className="flex-1 font-mono text-sm text-zinc-300">
                    {serverIp ? serverAddr : <span className="text-zinc-600">Задайте NEXT_PUBLIC_SERVER_IP</span>}
                  </span>
                  {serverIp && (
                    <button onClick={() => copyText(serverAddr)} className="shrink-0 flex items-center gap-1 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs rounded-md transition-all active:scale-[0.98] cursor-pointer">
                      <Copy size={12} /> Копировать
                    </button>
                  )}
                </div>
              );
            })()}

            <div className="flex items-center py-3 border-b border-zinc-800/40 gap-3">
              <span className="w-28 shrink-0 text-xs text-zinc-500">Stream ID</span>
              <span className="flex-1 font-mono text-sm text-zinc-300 break-all">{streamId}</span>
              <button onClick={() => copyText(streamId)} className="shrink-0 flex items-center gap-1 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs rounded-md transition-all active:scale-[0.98] cursor-pointer">
                <Copy size={12} /> Копировать
              </button>
            </div>

            <div className="flex items-center py-3 gap-3">
              <span className="w-28 shrink-0 text-xs text-zinc-500">Passphrase</span>
              <span className="flex-1 font-mono text-sm text-zinc-300">
                {keyVisible ? profile?.ingestKey : '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022'}
              </span>
              <div className="shrink-0 flex gap-1.5">
                {keyVisible && (
                  <button onClick={() => copyText(profile?.ingestKey ?? '')} className="flex items-center gap-1 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs rounded-md transition-all active:scale-[0.98] cursor-pointer">
                    <Copy size={12} /> Копировать
                  </button>
                )}
                <button onClick={() => setKeyVisible((v) => !v)} className="flex items-center gap-1 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs rounded-md transition-all active:scale-[0.98] cursor-pointer">
                  {keyVisible ? <><EyeSlash size={12} /> Скрыть</> : <><Eye size={12} /> Показать</>}
                </button>
                <button
                  onClick={() => { if (confirm('Сгенерировать новый ключ? Текущий стрим будет прерван.')) rotateMutation.mutate(); }}
                  className="flex items-center gap-1 px-2.5 py-1 bg-brand hover:bg-brand-hover text-white text-xs rounded-md transition-all active:scale-[0.98] cursor-pointer"
                >
                  <ArrowsClockwise size={12} /> Сменить
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Stream settings */}
        <section className="bg-surface-elevated border border-zinc-800/50 rounded-xl p-5">
          <h2 className="flex items-center gap-2 text-base font-medium text-zinc-300 mb-4">
            <Gear size={18} className="text-zinc-400" />
            Настройки стрима
          </h2>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-zinc-500">Название</label>
              <input
                key={profile?.streamTitle}
                defaultValue={profile?.streamTitle ?? ''}
                onBlur={(e) => {
                  if (e.target.value !== profile?.streamTitle) {
                    updateStreamMutation.mutate({ streamTitle: e.target.value });
                  }
                }}
                className={inputClasses}
                placeholder="Название трансляции"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-zinc-500">Описание</label>
              <textarea
                key={profile?.streamDescription}
                defaultValue={profile?.streamDescription ?? ''}
                onBlur={(e) => {
                  if (e.target.value !== (profile?.streamDescription ?? '')) {
                    updateStreamMutation.mutate({ streamDescription: e.target.value || undefined });
                  }
                }}
                rows={2}
                className={`${inputClasses} resize-y min-h-[60px]`}
                placeholder="Описание (необязательно)"
              />
            </div>

            <div className="flex gap-4 flex-wrap items-center">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={profile?.streamIsPublic ?? true}
                  onChange={(e) => updateStreamMutation.mutate({ streamIsPublic: e.target.checked })}
                  className="accent-brand w-4 h-4 cursor-pointer"
                />
                <span className="text-zinc-300 text-sm">Публичная трансляция</span>
              </label>

              {!profile?.streamIsPublic && profile?.streamPreviewKey && (
                <button onClick={copyPreviewLink} className="flex items-center gap-1 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs rounded-lg transition-all active:scale-[0.98] cursor-pointer">
                  <Copy size={12} /> Скопировать ссылку для зрителей
                </button>
              )}
            </div>

            <div className="pt-3 border-t border-zinc-800/40">
              {profile?.isLive ? (
                <span className="flex items-center gap-2 text-brand text-sm font-semibold">
                  <span className="w-2 h-2 rounded-full bg-brand animate-pulse" />
                  LIVE — идёт трансляция
                </span>
              ) : (
                <span className="text-zinc-600 text-sm">Ожидание SRT-потока...</span>
              )}
            </div>
          </div>
        </section>

        {/* Preview settings */}
        <section className="bg-surface-elevated border border-zinc-800/50 rounded-xl p-5">
          <h2 className="flex items-center gap-2 text-base font-medium text-zinc-300 mb-4">
            <ImageSquare size={18} className="text-zinc-400" />
            Превью на главной
          </h2>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-zinc-500">Камера для превью (во время стрима)</label>
              <select
                value={profile?.previewMode ?? 'multicam'}
                onChange={(e) => updateStreamMutation.mutate({ previewMode: e.target.value })}
                className={`${inputClasses} cursor-pointer`}
              >
                <option value="multicam">Мультикам (все камеры)</option>
                <option value="cam1">Камера 1 (верхний левый)</option>
                <option value="cam2">Камера 2 (верхний правый)</option>
                <option value="cam3">Камера 3 (нижний левый)</option>
                <option value="cam4">Камера 4 (нижний правый)</option>
              </select>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs text-zinc-500">Статичное превью (когда стрим не идёт)</label>
              {profile?.previewImagePath ? (
                <div className="flex items-center gap-4">
                  <img
                    src={`${process.env.NEXT_PUBLIC_API_URL ?? '/api'}/v1/public/orgs/${profile.slug}/thumbnail?t=${Date.now()}`}
                    alt="Текущее превью"
                    className="w-40 aspect-video object-cover rounded-lg border border-zinc-700"
                  />
                  <button
                    onClick={() => { if (confirm('Удалить превью?')) deletePreviewMutation.mutate(); }}
                    className="flex items-center gap-1 px-3 py-1.5 bg-red-900/30 hover:bg-red-900/60 text-red-400 hover:text-red-300 text-xs rounded-lg transition-all active:scale-[0.98] cursor-pointer"
                  >
                    <Trash size={12} /> Удалить
                  </button>
                </div>
              ) : (
                <p className="text-zinc-600 text-xs">Не установлено</p>
              )}
              <label className="flex items-center gap-2 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs rounded-lg transition-all cursor-pointer w-fit">
                <Upload size={14} />
                Загрузить изображение
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) uploadPreviewMutation.mutate(file);
                    e.target.value = '';
                  }}
                  className="hidden"
                />
              </label>
              {uploadPreviewMutation.isPending && <p className="text-zinc-500 text-xs">Загрузка...</p>}
            </div>
          </div>
        </section>

        {/* Broadcasts archive */}
        <section className="bg-surface-elevated border border-zinc-800/50 rounded-xl p-5">
          <h2 className="flex items-center gap-2 text-base font-medium text-zinc-300 mb-4">
            <Archive size={18} className="text-zinc-400" />
            Архив трансляций
          </h2>

          {broadcasts?.length === 0 && (
            <div className="flex flex-col items-center py-8 gap-2 opacity-40">
              <VideoCamera size={32} className="text-zinc-600" weight="thin" />
              <p className="text-zinc-500 text-sm">Завершённых трансляций пока нет</p>
            </div>
          )}

          <div className="flex flex-col gap-2">
            {broadcasts?.map((b) => (
              <div key={b.id} className="bg-surface-primary rounded-lg p-3.5">
                {editingBroadcast?.id === b.id ? (
                  <div className="flex flex-col gap-2">
                    <input
                      value={editingBroadcast.title}
                      onChange={(e) => setEditingBroadcast({ ...editingBroadcast, title: e.target.value })}
                      className={inputClasses}
                      placeholder="Название"
                    />
                    <input
                      value={editingBroadcast.description}
                      onChange={(e) => setEditingBroadcast({ ...editingBroadcast, description: e.target.value })}
                      className={inputClasses}
                      placeholder="Описание (необязательно)"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => updateBroadcastMutation.mutate({ id: b.id, data: { title: editingBroadcast.title, description: editingBroadcast.description || undefined } })}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium rounded-lg transition-all active:scale-[0.98] cursor-pointer"
                      >
                        Сохранить
                      </button>
                      <button
                        onClick={() => setEditingBroadcast(null)}
                        className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-xs rounded-lg transition-all active:scale-[0.98] cursor-pointer"
                      >
                        Отмена
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <span className="font-semibold text-sm text-zinc-100">{b.title}</span>
                      {b.description && <span className="ml-2 text-zinc-600 text-xs">{b.description}</span>}
                      <div className="text-xs text-zinc-600 mt-0.5 font-mono tabular-nums">
                        {new Date(b.startedAt).toLocaleDateString('ru-RU')}
                        {b.recording?.duration ? ` \u00b7 ${formatTime(b.recording.duration)}` : ''}
                      </div>
                    </div>
                    <div className="flex gap-1.5 shrink-0 flex-wrap justify-end">
                      <button
                        onClick={() => setEditingBroadcast({ id: b.id, title: b.title, description: b.description ?? '' })}
                        className="flex items-center gap-1 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs rounded-md transition-all active:scale-[0.98] cursor-pointer"
                      >
                        <PencilSimple size={12} /> Изменить
                      </button>
                      {b.recording?.status === 'ready' && (
                        <a
                          href={`/api/v1/org/broadcasts/${b.id}/recording/download`}
                          className="flex items-center gap-1 px-2.5 py-1 bg-brand hover:bg-brand-hover text-white text-xs rounded-md transition-all active:scale-[0.98] no-underline"
                        >
                          <DownloadSimple size={12} /> Скачать{b.recording.fileSize ? ` (${(b.recording.fileSize / 1024 / 1024 / 1024).toFixed(1)} ГБ)` : ''}
                        </a>
                      )}
                      {b.recording?.status === 'processing' && (
                        <span className="px-2.5 py-1 bg-zinc-800 text-zinc-500 text-xs rounded-md">
                          Обрабатывается...
                        </span>
                      )}
                      <button
                        onClick={() => { if (confirm(`Удалить запись "${b.title}"?`)) deleteBroadcastMutation.mutate(b.id); }}
                        className="flex items-center gap-1 px-2.5 py-1 bg-red-900/30 hover:bg-red-900/60 text-red-400 hover:text-red-300 text-xs rounded-md transition-all active:scale-[0.98] cursor-pointer"
                      >
                        <Trash size={12} /> Удалить
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
