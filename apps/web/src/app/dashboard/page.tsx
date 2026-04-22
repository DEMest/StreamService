'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Broadcast, Gear, ImageSquare, Archive, Copy, Eye, EyeSlash, ArrowsClockwise, PencilSimple, DownloadSimple, Trash, VideoCamera, Upload, CaretDown } from '@phosphor-icons/react';

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
  const [protocol, setProtocol] = useState<'srt' | 'rtmp'>('srt');
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

  const serverIp = process.env.NEXT_PUBLIC_SERVER_IP ?? '';
  const streamId = `publish:live/${profile?.slug}`;
  const srtServer = serverIp ? `${serverIp}:8890` : '';
  const rtmpServer = serverIp ? `rtmp://${serverIp}:1935/live` : '';
  const srtFullUrl = serverIp && profile?.ingestKey
    ? `srt://${serverIp}:8890?streamid=publish:live/${profile.slug}&passphrase=${profile.ingestKey}`
    : '';
  const rtmpFullUrl = serverIp && profile?.ingestKey
    ? `rtmp://${serverIp}:1935/live/${profile.slug}?key=${profile.ingestKey}`
    : '';

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

        {/* Stream Parameters */}
        <section className="bg-surface-elevated border border-zinc-800/50 rounded-xl p-5">
          <h2 className="flex items-center gap-2 text-base font-medium text-zinc-300 mb-4">
            <Broadcast size={18} className="text-brand" weight="fill" />
            Параметры трансляции
          </h2>

          {/* Protocol tabs */}
          <div className="flex gap-1 mb-4 bg-surface-primary rounded-lg p-1">
            {(['srt', 'rtmp'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setProtocol(p)}
                className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-all cursor-pointer ${
                  protocol === p ? 'bg-brand text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {p.toUpperCase()}
              </button>
            ))}
          </div>

          <div className="flex flex-col">
            {protocol === 'srt' ? (
              <>
                <div className="flex items-center py-3 border-b border-zinc-800/40 gap-3">
                  <span className="w-28 shrink-0 text-xs text-zinc-500">Сервер</span>
                  <span className="flex-1 font-mono text-sm text-zinc-300">
                    {serverIp || <span className="text-zinc-600">Задайте NEXT_PUBLIC_SERVER_IP</span>}
                  </span>
                  {serverIp && (
                    <button onClick={() => copyText(serverIp)} className="shrink-0 flex items-center gap-1 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs rounded-md transition-all active:scale-[0.98] cursor-pointer">
                      <Copy size={12} /> Копировать
                    </button>
                  )}
                </div>
                <div className="flex items-center py-3 border-b border-zinc-800/40 gap-3">
                  <span className="w-28 shrink-0 text-xs text-zinc-500">Порт</span>
                  <span className="flex-1 font-mono text-sm text-zinc-300">8890</span>
                  <button onClick={() => copyText('8890')} className="shrink-0 flex items-center gap-1 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs rounded-md transition-all active:scale-[0.98] cursor-pointer">
                    <Copy size={12} /> Копировать
                  </button>
                </div>
                <div className="flex items-center py-3 border-b border-zinc-800/40 gap-3">
                  <span className="w-28 shrink-0 text-xs text-zinc-500">Stream ID</span>
                  <span className="flex-1 font-mono text-sm text-zinc-300 break-all">{streamId}</span>
                  <button onClick={() => copyText(streamId)} className="shrink-0 flex items-center gap-1 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs rounded-md transition-all active:scale-[0.98] cursor-pointer">
                    <Copy size={12} /> Копировать
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center py-3 border-b border-zinc-800/40 gap-3">
                  <span className="w-28 shrink-0 text-xs text-zinc-500">Сервер</span>
                  <span className="flex-1 font-mono text-sm text-zinc-300">
                    {serverIp || <span className="text-zinc-600">Задайте NEXT_PUBLIC_SERVER_IP</span>}
                  </span>
                  {serverIp && (
                    <button onClick={() => copyText(serverIp)} className="shrink-0 flex items-center gap-1 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs rounded-md transition-all active:scale-[0.98] cursor-pointer">
                      <Copy size={12} /> Копировать
                    </button>
                  )}
                </div>
                <div className="flex items-center py-3 border-b border-zinc-800/40 gap-3">
                  <span className="w-28 shrink-0 text-xs text-zinc-500">Порт</span>
                  <span className="flex-1 font-mono text-sm text-zinc-300">1935</span>
                  <button onClick={() => copyText('1935')} className="shrink-0 flex items-center gap-1 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs rounded-md transition-all active:scale-[0.98] cursor-pointer">
                    <Copy size={12} /> Копировать
                  </button>
                </div>
                <div className="flex items-center py-3 border-b border-zinc-800/40 gap-3">
                  <span className="w-28 shrink-0 text-xs text-zinc-500">Ключ потока</span>
                  <span className="flex-1 font-mono text-sm text-zinc-300">{profile?.slug}</span>
                  <button onClick={() => copyText(profile?.slug ?? '')} className="shrink-0 flex items-center gap-1 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs rounded-md transition-all active:scale-[0.98] cursor-pointer">
                    <Copy size={12} /> Копировать
                  </button>
                </div>
              </>
            )}

            {/* Shared passphrase / password row */}
            <div className="flex items-center py-3 gap-3">
              <span className="w-28 shrink-0 text-xs text-zinc-500">{protocol === 'srt' ? 'Passphrase' : 'Пароль'}</span>
              <span className="flex-1 font-mono text-sm text-zinc-300">
                {keyVisible ? profile?.ingestKey : '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022'}
              </span>
              <div className="shrink-0 flex gap-1.5 flex-wrap justify-end">
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

          {/* Setup guides */}
          <div className="mt-5 pt-5 border-t border-zinc-800/40 space-y-3">
            <details className="group bg-surface-primary rounded-xl border border-zinc-800/40 overflow-hidden">
              <summary className="flex items-center gap-2.5 cursor-pointer text-sm font-medium text-zinc-300 hover:text-zinc-100 transition-colors px-4 py-3 [&::-webkit-details-marker]:hidden list-none select-none">
                <CaretDown size={14} className="text-zinc-500 transition-transform -rotate-90 group-open:rotate-0" />
                Настройка OBS Studio
              </summary>
              <div className="px-4 pb-4 space-y-3">
                {protocol === 'srt' ? (
                  <>
                    <div className="flex items-start gap-3">
                      <span className="shrink-0 w-6 h-6 rounded-full bg-zinc-800 text-zinc-400 text-xs flex items-center justify-center mt-0.5">1</span>
                      <p className="text-sm text-zinc-400">Откройте <span className="text-zinc-200">Настройки → Трансляция</span>, служба: <span className="text-zinc-200">Настраиваемая</span></p>
                    </div>
                    <div className="flex items-start gap-3">
                      <span className="shrink-0 w-6 h-6 rounded-full bg-zinc-800 text-zinc-400 text-xs flex items-center justify-center mt-0.5">2</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-zinc-400 mb-1.5">В поле <span className="text-zinc-200">«Сервер»</span> вставьте полную ссылку:</p>
                        <div className="flex items-center gap-2 bg-zinc-900 rounded-lg px-3 py-2 border border-zinc-800">
                          <code className="flex-1 text-sm text-zinc-200 font-mono break-all">{srtFullUrl || `srt://${serverIp || 'IP'}:8890?streamid=${streamId}&passphrase=\u2022\u2022\u2022`}</code>
                          {srtFullUrl && (
                            <button onClick={() => copyText(srtFullUrl)} className="shrink-0 p-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 rounded-md transition-all active:scale-[0.95] cursor-pointer" title="Копировать">
                              <Copy size={14} />
                            </button>
                          )}
                        </div>
                        {!keyVisible && <p className="text-xs text-zinc-600 mt-1">Покажите пароль, чтобы скопировать ссылку</p>}
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <span className="shrink-0 w-6 h-6 rounded-full bg-zinc-800 text-zinc-400 text-xs flex items-center justify-center mt-0.5">3</span>
                      <p className="text-sm text-zinc-400">Поле <span className="text-zinc-200">«Ключ потока»</span> оставьте пустым</p>
                    </div>
                    <div className="flex items-start gap-3">
                      <span className="shrink-0 w-6 h-6 rounded-full bg-zinc-800 text-zinc-400 text-xs flex items-center justify-center mt-0.5">4</span>
                      <p className="text-sm text-zinc-400">Нажмите <span className="text-zinc-200">«Начать трансляцию»</span></p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-start gap-3">
                      <span className="shrink-0 w-6 h-6 rounded-full bg-zinc-800 text-zinc-400 text-xs flex items-center justify-center mt-0.5">1</span>
                      <p className="text-sm text-zinc-400">Откройте <span className="text-zinc-200">Настройки → Трансляция</span>, служба: <span className="text-zinc-200">Настраиваемая</span></p>
                    </div>
                    <div className="flex items-start gap-3">
                      <span className="shrink-0 w-6 h-6 rounded-full bg-zinc-800 text-zinc-400 text-xs flex items-center justify-center mt-0.5">2</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-zinc-400 mb-1.5">В поле <span className="text-zinc-200">«Сервер»</span> вставьте:</p>
                        <div className="flex items-center gap-2 bg-zinc-900 rounded-lg px-3 py-2 border border-zinc-800">
                          <code className="flex-1 text-sm text-zinc-200 font-mono">{rtmpServer || `rtmp://${serverIp || 'IP'}:1935/live`}</code>
                          {serverIp && (
                            <button onClick={() => copyText(rtmpServer)} className="shrink-0 p-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 rounded-md transition-all active:scale-[0.95] cursor-pointer" title="Копировать">
                              <Copy size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <span className="shrink-0 w-6 h-6 rounded-full bg-zinc-800 text-zinc-400 text-xs flex items-center justify-center mt-0.5">3</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-zinc-400 mb-1.5">В поле <span className="text-zinc-200">«Ключ потока»</span> вставьте:</p>
                        <div className="flex items-center gap-2 bg-zinc-900 rounded-lg px-3 py-2 border border-zinc-800">
                          <code className="flex-1 text-sm text-zinc-200 font-mono break-all">{profile?.slug ?? 'slug'}?key={keyVisible ? profile?.ingestKey : '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022'}</code>
                          {keyVisible && (
                            <button onClick={() => copyText(`${profile?.slug}?key=${profile?.ingestKey}`)} className="shrink-0 p-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 rounded-md transition-all active:scale-[0.95] cursor-pointer" title="Копировать">
                              <Copy size={14} />
                            </button>
                          )}
                        </div>
                        {!keyVisible && <p className="text-xs text-zinc-600 mt-1">Покажите пароль, чтобы скопировать ключ</p>}
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <span className="shrink-0 w-6 h-6 rounded-full bg-zinc-800 text-zinc-400 text-xs flex items-center justify-center mt-0.5">4</span>
                      <p className="text-sm text-zinc-400">Нажмите <span className="text-zinc-200">«Начать трансляцию»</span></p>
                    </div>
                  </>
                )}
              </div>
            </details>

            <details className="group bg-surface-primary rounded-xl border border-zinc-800/40 overflow-hidden">
              <summary className="flex items-center gap-2.5 cursor-pointer text-sm font-medium text-zinc-300 hover:text-zinc-100 transition-colors px-4 py-3 [&::-webkit-details-marker]:hidden list-none select-none">
                <CaretDown size={14} className="text-zinc-500 transition-transform -rotate-90 group-open:rotate-0" />
                Настройка vMix
              </summary>
              <div className="px-4 pb-4 space-y-3">
                {protocol === 'srt' ? (
                  <>
                    <div className="flex items-start gap-3">
                      <span className="shrink-0 w-6 h-6 rounded-full bg-zinc-800 text-zinc-400 text-xs flex items-center justify-center mt-0.5">1</span>
                      <p className="text-sm text-zinc-400">Откройте <span className="text-zinc-200">Settings → Outputs</span>, нажмите <span className="text-zinc-200">+ (Add)</span></p>
                    </div>
                    <div className="flex items-start gap-3">
                      <span className="shrink-0 w-6 h-6 rounded-full bg-zinc-800 text-zinc-400 text-xs flex items-center justify-center mt-0.5">2</span>
                      <p className="text-sm text-zinc-400">Выберите тип: <span className="text-zinc-200">SRT Caller</span></p>
                    </div>
                    <div className="flex items-start gap-3">
                      <span className="shrink-0 w-6 h-6 rounded-full bg-zinc-800 text-zinc-400 text-xs flex items-center justify-center mt-0.5">3</span>
                      <div className="flex-1 min-w-0 text-sm text-zinc-400 space-y-1.5">
                        <p>Заполните поля:</p>
                        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                          <span className="text-zinc-500">Hostname:</span>
                          <span className="text-zinc-200 font-mono">{serverIp || 'IP сервера'}</span>
                          <span className="text-zinc-500">Port:</span>
                          <span className="text-zinc-200 font-mono">8890</span>
                          <span className="text-zinc-500">Stream ID:</span>
                          <span className="text-zinc-200 font-mono break-all">{streamId}</span>
                          <span className="text-zinc-500">Passphrase:</span>
                          <span className="text-zinc-200 font-mono">{keyVisible ? profile?.ingestKey : '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022'}</span>
                          <span className="text-zinc-500">Latency:</span>
                          <span className="text-zinc-200 font-mono">200</span>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-start gap-3">
                      <span className="shrink-0 w-6 h-6 rounded-full bg-zinc-800 text-zinc-400 text-xs flex items-center justify-center mt-0.5">1</span>
                      <p className="text-sm text-zinc-400">Откройте <span className="text-zinc-200">Settings → Outputs</span>, нажмите <span className="text-zinc-200">+ (Add)</span></p>
                    </div>
                    <div className="flex items-start gap-3">
                      <span className="shrink-0 w-6 h-6 rounded-full bg-zinc-800 text-zinc-400 text-xs flex items-center justify-center mt-0.5">2</span>
                      <p className="text-sm text-zinc-400">Выберите тип: <span className="text-zinc-200">RTMP</span></p>
                    </div>
                    <div className="flex items-start gap-3">
                      <span className="shrink-0 w-6 h-6 rounded-full bg-zinc-800 text-zinc-400 text-xs flex items-center justify-center mt-0.5">3</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-zinc-400 mb-1.5">В поле <span className="text-zinc-200">URL</span> вставьте полную ссылку:</p>
                        <div className="flex items-center gap-2 bg-zinc-900 rounded-lg px-3 py-2 border border-zinc-800">
                          <code className="flex-1 text-sm text-zinc-200 font-mono break-all">{rtmpFullUrl || `rtmp://${serverIp || 'IP'}:1935/live/${profile?.slug ?? 'slug'}?key=\u2022\u2022\u2022`}</code>
                          {rtmpFullUrl && (
                            <button onClick={() => copyText(rtmpFullUrl)} className="shrink-0 p-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 rounded-md transition-all active:scale-[0.95] cursor-pointer" title="Копировать">
                              <Copy size={14} />
                            </button>
                          )}
                        </div>
                        {!keyVisible && <p className="text-xs text-zinc-600 mt-1">Покажите пароль, чтобы скопировать ссылку</p>}
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <span className="shrink-0 w-6 h-6 rounded-full bg-zinc-800 text-zinc-400 text-xs flex items-center justify-center mt-0.5">4</span>
                      <p className="text-sm text-zinc-400">Поле <span className="text-zinc-200">Stream Key</span> оставьте пустым</p>
                    </div>
                  </>
                )}
              </div>
            </details>
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
                <span className="text-zinc-600 text-sm">Ожидание потока...</span>
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
