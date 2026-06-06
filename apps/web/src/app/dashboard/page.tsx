'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { DashboardLayout } from '@/components/DashboardLayout';
import { EventsSection } from '@/components/dashboard/EventsSection';
import { RecordingControl, type RecordingMode } from '@/components/dashboard/RecordingControl';
import { Broadcast, Gear, ImageSquare, Archive, Copy, Eye, EyeSlash, ArrowsClockwise, PencilSimple, DownloadSimple, Trash, VideoCamera, Upload, CaretDown, ArrowRight, Stack, Plus, DotsThreeVertical, X, Warning } from '@phosphor-icons/react';

interface OrgStreamSummary {
  id: string;
  slug: string;
  name: string;
  mode: 'composite' | 'multistream';
  slotCount: number;
  isLive: boolean;
}

type StreamMode = 'composite' | 'multistream';

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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
  chatTtlMinutes: number;
  chatEnabled: boolean;
}

const CHAT_TTL_PRESETS: { minutes: number; label: string }[] = [
  { minutes: 5,   label: '5 мин' },
  { minutes: 30,  label: '30 мин' },
  { minutes: 60,  label: '1 час' },
  { minutes: 180, label: '3 часа' },
  { minutes: 300, label: '5 часов' },
];
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
  const router = useRouter();
  const [keyVisible, setKeyVisible] = useState(false);
  const [protocol, setProtocol] = useState<'srt' | 'rtmp'>('srt');
  const [editingBroadcast, setEditingBroadcast] = useState<{ id: string; title: string; description: string } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<OrgStreamSummary | null>(null);
  const [renameTarget, setRenameTarget] = useState<OrgStreamSummary | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const defaultSectionRef = useRef<HTMLDivElement | null>(null);

  const { data: profile } = useQuery({
    queryKey: ['org-profile', keyVisible],
    queryFn: () => api.get<OrgProfile>(`/v1/org/me${keyVisible ? '?reveal=true' : ''}`),
    refetchInterval: 10_000,
  });

  const { data: broadcasts } = useQuery({
    queryKey: ['org-broadcasts'],
    queryFn: () => api.get<BroadcastItem[]>('/v1/org/broadcasts'),
  });

  // Все Stream'ы орги (default + named). Default — slug='', управляется
  // секциями ниже на этой же странице. Named — карточки с переходом в Studio
  // или удалением через [⋮]-меню.
  const { data: streamsList } = useQuery({
    queryKey: ['org-streams-list'],
    queryFn: () => api.get<OrgStreamSummary[]>('/v1/org/streams'),
    refetchInterval: 30_000,
  });

  // ID default-стрима (slug='') нужен для toggle записи дефолтного композитного
  // стрима. У орги всегда ровно один такой Stream (создаётся при заведении орги).
  const defaultStreamId = streamsList?.find((s) => s.slug === '')?.id;

  const { data: defaultStream } = useQuery({
    queryKey: ['org-stream', defaultStreamId],
    queryFn: () =>
      api.get<{ id: string; recordingEnabled: boolean; recordingMode: RecordingMode }>(
        `/v1/org/streams/${defaultStreamId}`,
      ),
    enabled: !!defaultStreamId,
    refetchInterval: 15_000,
  });

  const patchDefaultRecording = useMutation({
    mutationFn: (patch: { enabled?: boolean; mode?: RecordingMode }) =>
      api.patch(`/v1/org/streams/${defaultStreamId}/recording`, patch),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['org-stream', defaultStreamId] }),
  });

  // Сортируем: default первый, потом по имени.
  const sortedStreams = [...(streamsList ?? [])].sort((a, b) => {
    if (a.slug === '' && b.slug !== '') return -1;
    if (a.slug !== '' && b.slug === '') return 1;
    return (a.name || a.slug).localeCompare(b.name || b.slug, 'ru');
  });

  const createStreamMutation = useMutation({
    mutationFn: (data: { slug: string; name?: string; mode: StreamMode; slotCount: number }) =>
      api.post<OrgStreamSummary>('/v1/org/streams', data),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['org-streams-list'] });
      setCreateOpen(false);
      // Multistream — сразу в Studio. Composite — остаёмся на дашборде.
      if (created.mode === 'multistream') {
        router.push(`/dashboard/streams/${created.id}/studio`);
      }
    },
  });

  const deleteStreamMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/v1/org/streams/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-streams-list'] });
      setDeleteTarget(null);
    },
  });

  const renameStreamMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.patch(`/v1/org/streams/${id}`, { name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-streams-list'] });
      setRenameTarget(null);
    },
  });

  // Клик вне меню — закрыть.
  useEffect(() => {
    if (!menuFor) return;
    const onDocClick = () => setMenuFor(null);
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [menuFor]);

  const rotateMutation = useMutation({
    mutationFn: () => api.post('/v1/org/ingest-key/rotate'),
    onSuccess: () => { setKeyVisible(true); qc.invalidateQueries({ queryKey: ['org-profile'] }); },
  });

  const updateStreamMutation = useMutation({
    mutationFn: (data: Partial<OrgProfile>) => api.patch('/v1/org/stream', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org-profile'] }),
  });

  const clearChatMutation = useMutation({
    mutationFn: () => api.post('/v1/org/chat/clear'),
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
  const srtPort = process.env.NEXT_PUBLIC_SRT_PORT ?? '8890';
  const rtmpPort = process.env.NEXT_PUBLIC_RTMP_PORT ?? '1935';
  const streamId = `publish:live/${profile?.slug}`;
  const srtServer = serverIp ? `${serverIp}:${srtPort}` : '';
  const rtmpServer = serverIp ? `rtmp://${serverIp}:${rtmpPort}/live` : '';
  const srtFullUrl = serverIp && profile?.ingestKey
    ? `srt://${serverIp}:${srtPort}?streamid=publish:live/${profile.slug}&passphrase=${profile.ingestKey}`
    : '';
  const rtmpFullUrl = serverIp && profile?.ingestKey
    ? `rtmp://${serverIp}:${rtmpPort}/live/${profile.slug}?key=${profile.ingestKey}`
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

        {/* Streams catalog — все Stream'ы орги: default + named (composite/multistream) */}
        <section className="bg-surface-elevated border border-zinc-800/50 rounded-xl p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="flex items-center gap-2 text-base font-medium text-zinc-300">
              <Stack size={18} weight="fill" className="text-brand" />
              Мои стримы
              <span className="ml-1 text-xs text-zinc-600 font-mono tabular-nums">
                {sortedStreams.length}
              </span>
            </h2>
            <button
              onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand hover:bg-brand-hover text-white text-xs font-medium rounded-md transition-all active:scale-[0.98] cursor-pointer"
            >
              <Plus size={14} weight="bold" />
              Новый стрим
            </button>
          </div>

          {sortedStreams.length === 0 ? (
            <div className="flex flex-col items-center py-8 gap-2 opacity-40">
              <VideoCamera size={32} weight="thin" className="text-zinc-600" />
              <p className="text-zinc-500 text-sm">Стримы не настроены</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {sortedStreams.map((s) => {
                const isDefault = s.slug === '';
                const isMultistream = s.mode === 'multistream';
                const targetHref = isDefault
                  ? '#default-stream-config'
                  : `/dashboard/streams/${s.id}/studio`;
                return (
                  <div
                    key={s.id}
                    className="relative flex flex-col gap-2.5 p-4 rounded-xl bg-surface-primary border border-zinc-800/60 hover:border-zinc-700 transition-colors"
                  >
                    {/* Header row: name + menu */}
                    <div className="flex items-start justify-between gap-2 min-w-0">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-zinc-100 truncate">
                          {isDefault ? 'Default' : s.name?.trim() || s.slug}
                        </div>
                        <div className="text-[11px] text-zinc-500 font-mono truncate">
                          /{s.slug || 'default'}
                        </div>
                      </div>
                      {!isDefault && (
                        <div className="relative shrink-0">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenuFor(menuFor === s.id ? null : s.id);
                            }}
                            aria-label="Меню стрима"
                            className="p-1 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
                          >
                            <DotsThreeVertical size={16} weight="bold" />
                          </button>
                          {menuFor === s.id && (
                            <div
                              onClick={(e) => e.stopPropagation()}
                              className="absolute right-0 top-full mt-1 z-20 min-w-[160px] py-1 bg-surface-elevated border border-zinc-700 rounded-lg shadow-xl"
                            >
                              <button
                                onClick={() => {
                                  setRenameTarget(s);
                                  setMenuFor(null);
                                }}
                                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer text-left"
                              >
                                <PencilSimple size={12} />
                                Переименовать
                              </button>
                              <button
                                onClick={() => {
                                  setDeleteTarget(s);
                                  setMenuFor(null);
                                }}
                                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer text-left"
                              >
                                <Trash size={12} />
                                Удалить
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Badges row */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-zinc-800 border border-zinc-700/50 text-[10px] text-zinc-400 font-mono uppercase tracking-wider">
                        {isMultistream ? `${s.slotCount} cams` : 'composite'}
                      </span>
                      {s.isLive ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[10px] font-medium">
                          <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
                          LIVE
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-zinc-800/60 border border-zinc-700/40 text-zinc-500 text-[10px] font-medium">
                          <span className="w-1 h-1 rounded-full bg-zinc-600" />
                          OFF
                        </span>
                      )}
                    </div>

                    {/* Action */}
                    {isDefault ? (
                      <button
                        onClick={() => {
                          defaultSectionRef.current?.scrollIntoView({
                            behavior: 'smooth',
                            block: 'start',
                          });
                        }}
                        className="mt-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium rounded-md transition-all active:scale-[0.98] cursor-pointer"
                      >
                        Открыть
                        <ArrowRight size={12} weight="bold" />
                      </button>
                    ) : (
                      <Link
                        href={targetHref}
                        className="mt-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-brand/20 hover:bg-brand/30 text-brand text-xs font-medium rounded-md transition-all active:scale-[0.98] no-underline"
                      >
                        {isMultistream ? 'Studio' : 'Открыть'}
                        <ArrowRight size={12} weight="bold" />
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* TODO Step 5+: для named composite Stream'а нужен отдельный
              /dashboard/streams/[id]/page.tsx — упрощённый дашборд для конкретного
              Stream'а (URL/key/settings/archive). Пока ссылка ведёт в Studio,
              откуда composite Stream редиректится обратно на /dashboard. */}
        </section>

        {/* Events — Step 5: группирующая сущность над Stream'ами */}
        <EventsSection />

        {/* Anchor — секции ниже относятся к default Stream'у орги */}
        <div ref={defaultSectionRef} id="default-stream-config" />

        {/* Stream Parameters */}
        <section className="bg-surface-elevated border border-zinc-800/50 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
            <h2 className="flex items-center gap-2 text-base font-medium text-zinc-300">
              <Broadcast size={18} className="text-brand" weight="fill" />
              Параметры трансляции
            </h2>
            <RecordingControl
              enabled={defaultStream?.recordingEnabled ?? false}
              mode={defaultStream?.recordingMode ?? 'auto'}
              onPatch={(p) => patchDefaultRecording.mutate(p)}
              pending={patchDefaultRecording.isPending}
              available={!!defaultStreamId}
            />
          </div>

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
                  <span className="flex-1 font-mono text-sm text-zinc-300">{srtPort}</span>
                  <button onClick={() => copyText(srtPort)} className="shrink-0 flex items-center gap-1 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs rounded-md transition-all active:scale-[0.98] cursor-pointer">
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
                          <code className="flex-1 text-sm text-zinc-200 font-mono break-all">{srtFullUrl || `srt://${serverIp || 'IP'}:${srtPort}?streamid=${streamId}&passphrase=\u2022\u2022\u2022`}</code>
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
                          <code className="flex-1 text-sm text-zinc-200 font-mono">{rtmpServer || `rtmp://${serverIp || 'IP'}:${rtmpPort}/live`}</code>
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
                          <span className="text-zinc-200 font-mono">{srtPort}</span>
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
                          <code className="flex-1 text-sm text-zinc-200 font-mono break-all">{rtmpFullUrl || `rtmp://${serverIp || 'IP'}:${rtmpPort}/live/${profile?.slug ?? 'slug'}?key=\u2022\u2022\u2022`}</code>
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

            <div className="flex flex-col gap-3 p-3 rounded-lg border border-zinc-800/60 bg-surface-primary/30">
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col">
                  <span className="text-sm text-zinc-200 font-medium">Чат на трансляции</span>
                  <span className="text-xs text-zinc-500">
                    {profile?.chatEnabled === false ? 'Зрители не могут писать сообщения' : 'Открыт для зрителей'}
                  </span>
                </div>
                <button
                  onClick={() => updateStreamMutation.mutate({ chatEnabled: !(profile?.chatEnabled ?? true) } as Partial<OrgProfile>)}
                  disabled={updateStreamMutation.isPending}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                    profile?.chatEnabled === false
                      ? 'bg-brand text-white hover:bg-brand-hover'
                      : 'bg-red-500/15 text-red-400 hover:bg-red-500/25'
                  }`}
                >
                  {profile?.chatEnabled === false ? 'Включить чат' : 'Заблокировать'}
                </button>
              </div>
              <div className="flex items-center justify-between gap-3 pt-2 border-t border-zinc-800/50">
                <span className="text-xs text-zinc-500">Удалить все сообщения у всех зрителей</span>
                <button
                  onClick={() => {
                    if (clearChatMutation.isPending) return;
                    if (confirm('Удалить все сообщения чата? Действие необратимо.')) {
                      clearChatMutation.mutate();
                    }
                  }}
                  disabled={clearChatMutation.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-zinc-100 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Trash size={12} />
                  {clearChatMutation.isPending ? 'Очистка...' : 'Очистить чат'}
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <label className="text-xs text-zinc-500">Автоудаление сообщений чата</label>
                <span className="text-xs text-zinc-400 tabular-nums">
                  {CHAT_TTL_PRESETS.find((p) => p.minutes === (profile?.chatTtlMinutes ?? 180))?.label ?? '3 часа'}
                </span>
              </div>
              <div className="flex gap-1 bg-surface-primary rounded-lg p-1">
                {CHAT_TTL_PRESETS.map((p) => {
                  const active = (profile?.chatTtlMinutes ?? 180) === p.minutes;
                  return (
                    <button
                      key={p.minutes}
                      onClick={() => updateStreamMutation.mutate({ chatTtlMinutes: p.minutes } as Partial<OrgProfile>)}
                      disabled={updateStreamMutation.isPending}
                      className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-md transition-all cursor-pointer ${
                        active ? 'bg-brand text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-zinc-600">Сообщения старше выбранного интервала автоматически удаляются у всех зрителей.</p>
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

      {createOpen && (
        <CreateStreamModal
          onClose={() => setCreateOpen(false)}
          existingSlugs={sortedStreams.map((s) => s.slug)}
          onSubmit={(payload) => createStreamMutation.mutate(payload)}
          isSubmitting={createStreamMutation.isPending}
          errorMessage={createStreamMutation.error?.message ?? null}
        />
      )}

      {deleteTarget && (
        <DeleteStreamModal
          stream={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => deleteStreamMutation.mutate(deleteTarget.id)}
          isSubmitting={deleteStreamMutation.isPending}
          errorMessage={deleteStreamMutation.error?.message ?? null}
        />
      )}

      {renameTarget && (
        <RenameStreamModal
          stream={renameTarget}
          onClose={() => setRenameTarget(null)}
          onSubmit={(name) => renameStreamMutation.mutate({ id: renameTarget.id, name })}
          isSubmitting={renameStreamMutation.isPending}
          errorMessage={renameStreamMutation.error?.message ?? null}
        />
      )}
    </DashboardLayout>
  );
}

// ─── Modals ────────────────────────────────────────────────────────────────

interface ModalShellProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  widthClass?: string;
}

function ModalShell({ title, onClose, children, widthClass = 'max-w-md' }: ModalShellProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full ${widthClass} bg-surface-elevated border border-zinc-800 rounded-2xl shadow-2xl shadow-black/40 overflow-hidden`}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-zinc-800/60">
          <h3 className="text-base font-semibold text-zinc-100 tracking-tight">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Закрыть"
            className="p-1 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X size={16} weight="bold" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

interface CreateStreamModalProps {
  onClose: () => void;
  existingSlugs: string[];
  onSubmit: (payload: { slug: string; name?: string; mode: StreamMode; slotCount: number }) => void;
  isSubmitting: boolean;
  errorMessage: string | null;
}

function CreateStreamModal({ onClose, existingSlugs, onSubmit, isSubmitting, errorMessage }: CreateStreamModalProps) {
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [mode, setMode] = useState<StreamMode>('composite');
  const [slotCount, setSlotCount] = useState(2);

  const trimmedSlug = slug.trim().toLowerCase();
  const slugFormatValid = SLUG_REGEX.test(trimmedSlug);
  const slugDuplicate = existingSlugs.includes(trimmedSlug);
  const slugError = !trimmedSlug
    ? null
    : !slugFormatValid
      ? 'Только латинские буквы, цифры и дефисы (например: court-b)'
      : slugDuplicate
        ? 'Такой slug уже занят'
        : null;

  const canSubmit = trimmedSlug.length > 0 && !slugError && !isSubmitting;

  // Серверная ошибка по сообщению — распознаём 409 от других.
  const conflict = errorMessage?.toLowerCase().includes('already taken');
  const visibleError = conflict ? 'Slug уже занят в этой организации' : errorMessage;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      slug: trimmedSlug,
      name: name.trim() || undefined,
      mode,
      slotCount: mode === 'multistream' ? slotCount : 1,
    });
  }

  return (
    <ModalShell title="Новый стрим" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-zinc-500">Slug (часть URL)</label>
          <input
            autoFocus
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="court-b"
            className={inputClasses}
            disabled={isSubmitting}
          />
          {slugError ? (
            <p className="text-xs text-red-400">{slugError}</p>
          ) : (
            <p className="text-xs text-zinc-600">
              URL стрима будет: <span className="font-mono text-zinc-500">/{trimmedSlug || 'slug'}</span>
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-zinc-500">Название (необязательно)</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Корт B"
            className={inputClasses}
            disabled={isSubmitting}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-zinc-500">Тип стрима</label>
          <div className="grid grid-cols-2 gap-2">
            <label
              className={`flex flex-col gap-1 p-3 rounded-lg border cursor-pointer transition-colors ${
                mode === 'composite'
                  ? 'border-brand bg-brand/10'
                  : 'border-zinc-800 bg-surface-primary hover:border-zinc-700'
              }`}
            >
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  name="mode"
                  value="composite"
                  checked={mode === 'composite'}
                  onChange={() => setMode('composite')}
                  className="accent-brand"
                  disabled={isSubmitting}
                />
                <span className="text-sm text-zinc-200 font-medium">Composite</span>
              </div>
              <p className="text-[11px] text-zinc-500 leading-snug">
                Один SRT-поток, до 4 камер в кадре (vMix)
              </p>
            </label>
            <label
              className={`flex flex-col gap-1 p-3 rounded-lg border cursor-pointer transition-colors ${
                mode === 'multistream'
                  ? 'border-brand bg-brand/10'
                  : 'border-zinc-800 bg-surface-primary hover:border-zinc-700'
              }`}
            >
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  name="mode"
                  value="multistream"
                  checked={mode === 'multistream'}
                  onChange={() => setMode('multistream')}
                  className="accent-brand"
                  disabled={isSubmitting}
                />
                <span className="text-sm text-zinc-200 font-medium">Multistream</span>
              </div>
              <p className="text-[11px] text-zinc-500 leading-snug">
                Отдельные потоки на камеру, раскладка в Studio
              </p>
            </label>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-zinc-500">
            Количество камер{mode === 'composite' && <span className="text-zinc-600"> (фиксировано для composite)</span>}
          </label>
          <div className="grid grid-cols-4 gap-2">
            {[1, 2, 3, 4].map((n) => {
              const disabled = mode === 'composite' ? n !== 1 : false;
              const active = mode === 'composite' ? n === 1 : slotCount === n;
              return (
                <button
                  type="button"
                  key={n}
                  disabled={disabled || isSubmitting}
                  onClick={() => setSlotCount(n)}
                  className={`px-3 py-2 rounded-md text-sm font-medium transition-all cursor-pointer disabled:cursor-not-allowed ${
                    active
                      ? 'bg-brand text-white'
                      : disabled
                        ? 'bg-surface-primary text-zinc-700 border border-zinc-800/40'
                        : 'bg-surface-primary text-zinc-400 hover:text-zinc-200 border border-zinc-800/40'
                  }`}
                >
                  {n}
                </button>
              );
            })}
          </div>
        </div>

        {visibleError && !conflict && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-xs">
            <Warning size={14} className="shrink-0 mt-0.5" weight="fill" />
            <span>{visibleError}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="px-4 py-2 bg-brand hover:bg-brand-hover text-white text-sm font-medium rounded-md transition-all active:scale-[0.98] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Создание…' : 'Создать'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

interface DeleteStreamModalProps {
  stream: OrgStreamSummary;
  onClose: () => void;
  onConfirm: () => void;
  isSubmitting: boolean;
  errorMessage: string | null;
}

function DeleteStreamModal({ stream, onClose, onConfirm, isSubmitting, errorMessage }: DeleteStreamModalProps) {
  return (
    <ModalShell title="Удалить стрим?" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
          <Warning size={18} weight="fill" className="shrink-0 text-red-400 mt-0.5" />
          <div className="text-sm text-zinc-200">
            Стрим{' '}
            <span className="font-semibold">«{stream.name?.trim() || stream.slug}»</span>{' '}
            и все его записи будут удалены без возможности восстановления.
          </div>
        </div>

        {errorMessage && (
          <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-xs">
            {errorMessage}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting}
            className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded-md transition-all active:scale-[0.98] cursor-pointer disabled:opacity-50"
          >
            {isSubmitting ? 'Удаление…' : 'Удалить'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

interface RenameStreamModalProps {
  stream: OrgStreamSummary;
  onClose: () => void;
  onSubmit: (name: string) => void;
  isSubmitting: boolean;
  errorMessage: string | null;
}

function RenameStreamModal({ stream, onClose, onSubmit, isSubmitting, errorMessage }: RenameStreamModalProps) {
  const [name, setName] = useState(stream.name ?? '');
  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && trimmed !== stream.name && !isSubmitting;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit(trimmed);
  }

  return (
    <ModalShell title="Переименовать стрим" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-zinc-500">Название</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClasses}
            placeholder={stream.slug}
            disabled={isSubmitting}
          />
          <p className="text-xs text-zinc-600">
            Slug <span className="font-mono text-zinc-500">/{stream.slug}</span> не меняется.
          </p>
        </div>

        {errorMessage && (
          <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-xs">
            {errorMessage}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="px-4 py-2 bg-brand hover:bg-brand-hover text-white text-sm font-medium rounded-md transition-all active:scale-[0.98] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
