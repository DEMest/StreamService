'use client';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { DashboardLayout } from '@/components/DashboardLayout';
import { RecordingControl, type RecordingMode } from '@/components/dashboard/RecordingControl';
import { StreamStats } from '@/components/dashboard/StreamStats';
import {
  Broadcast,
  Gear,
  Archive,
  Copy,
  Eye,
  EyeSlash,
  ArrowsClockwise,
  DownloadSimple,
  Trash,
  VideoCamera,
  CaretLeft,
  ArrowRight,
  ImageSquare,
  Upload,
} from '@phosphor-icons/react';

// ─── Types ──────────────────────────────────────────────────────────────────

interface StreamDetail {
  id: string;
  slug: string;
  name: string;
  description?: string;
  isPublic: boolean;
  previewKey?: string;
  previewMode: string;
  feedMode: 'single' | 'composite';
  previewImagePath?: string | null;
  isLive: boolean;
  ingestKey?: string;
  ingestKeyCreatedAt?: string;
  recordingEnabled: boolean;
  recordingMode: RecordingMode;
  currentBroadcastId: string | null;
}

interface OrgProfile {
  id: string;
  slug: string;
  name: string;
}

interface BroadcastItem {
  id: string;
  title: string;
  description?: string;
  startedAt: string;
  endedAt?: string;
  hasPreview?: boolean;
  recording?: {
    id: string;
    status: string;
    // null у processing/failed — размер и хронометраж проставляются только
    // при финализации (toRecordingSummary на бэкенде отдаёт именно null).
    fileSize?: number | null;
    duration?: number | null;
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const inputClasses =
  'w-full px-3 py-2 bg-surface-primary border border-zinc-700 rounded-lg text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-brand focus:ring-1 focus:ring-brand/30 outline-none transition-colors';

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

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function StreamDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [keyVisible, setKeyVisible] = useState(false);
  const [protocol, setProtocol] = useState<'srt' | 'rtmp'>('srt');

  // ── Queries ──

  const { data: stream, isLoading: streamLoading } = useQuery({
    queryKey: ['org-stream-detail', id, keyVisible],
    queryFn: () =>
      api.get<StreamDetail>(`/v1/org/streams/${id}${keyVisible ? '?reveal=true' : ''}`),
    refetchInterval: 10_000,
  });

  const { data: broadcasts } = useQuery({
    queryKey: ['org-stream-broadcasts', id],
    queryFn: () => api.get<BroadcastItem[]>(`/v1/org/streams/${id}/broadcasts`),
  });

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ['org-profile'],
    queryFn: () => api.get<OrgProfile>('/v1/org/me'),
  });

  // ── Mutations ──

  const rotateKey = useMutation({
    mutationFn: () => api.post(`/v1/org/streams/${id}/rotate-key`),
    onSuccess: () => {
      setKeyVisible(true);
      qc.invalidateQueries({ queryKey: ['org-stream-detail', id] });
    },
  });

  const updateStream = useMutation({
    mutationFn: (patch: Partial<Pick<StreamDetail, 'name' | 'description' | 'isPublic' | 'previewMode' | 'feedMode'>>) =>
      api.patch(`/v1/org/streams/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org-stream-detail', id] }),
  });

  const patchRecording = useMutation({
    mutationFn: (patch: { enabled?: boolean; mode?: RecordingMode }) =>
      api.patch(`/v1/org/streams/${id}/recording`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org-stream-detail', id] }),
  });

  const deleteBroadcast = useMutation({
    mutationFn: (bid: string) => api.delete(`/v1/org/broadcasts/${bid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org-stream-broadcasts', id] }),
  });

  // Мультивыбор для массового удаления записей.
  const [selectedBroadcasts, setSelectedBroadcasts] = useState<Set<string>>(new Set());
  const bulkDeleteBroadcasts = useMutation({
    mutationFn: (ids: string[]) => Promise.all(ids.map((bid) => api.delete(`/v1/org/broadcasts/${bid}`))),
    onSuccess: () => {
      setSelectedBroadcasts(new Set());
      qc.invalidateQueries({ queryKey: ['org-stream-broadcasts', id] });
    },
  });
  // На дашборде скрываем пустые сессии (эфиры без записи) — показываем только записи.
  const visibleBroadcasts = broadcasts?.filter((b) => b.recording) ?? [];

  const [previewBump, setPreviewBump] = useState(() => Date.now());

  const uploadBroadcastPreview = useMutation({
    mutationFn: async ({ bid, file }: { bid: string; file: File }) => {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? '/api'}/v1/org/broadcasts/${bid}/preview`, {
        method: 'POST',
        body: form,
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Не удалось загрузить' }));
        throw new Error(err.message ?? 'Не удалось загрузить');
      }
      return res.json();
    },
    onSuccess: () => {
      setPreviewBump(Date.now());
      qc.invalidateQueries({ queryKey: ['org-stream-broadcasts', id] });
    },
  });

  const uploadPreview = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? '/api'}/v1/org/streams/${id}/preview`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      if (!res.ok) throw new Error('Upload failed');
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org-stream-detail', id] }),
  });

  const deletePreview = useMutation({
    mutationFn: () => api.delete(`/v1/org/streams/${id}/preview`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org-stream-detail', id] }),
  });

  const clearChat = useMutation({
    mutationFn: () => api.post(`/v1/org/streams/${id}/chat/clear`),
  });

  // ── Derived ingest URLs ──

  const serverIp = process.env.NEXT_PUBLIC_SERVER_IP ?? '';
  const srtPort = process.env.NEXT_PUBLIC_SRT_PORT ?? '8890';
  const rtmpPort = process.env.NEXT_PUBLIC_RTMP_PORT ?? '1935';
  const orgSlug = profile?.slug ?? '';
  const streamSlug = stream?.slug ?? '';

  const broadcastPreviewUrl = (bid: string) => {
    const keyPart = stream && !stream.isPublic && stream.previewKey ? `key=${stream.previewKey}&` : '';
    return `${process.env.NEXT_PUBLIC_API_URL ?? '/api'}/v1/public/orgs/${orgSlug}/streams/${streamSlug}/broadcasts/${bid}/preview?${keyPart}t=${previewBump}`;
  };

  const srtStreamId = `publish:live/${orgSlug}/${streamSlug}`;
  const srtFullUrl =
    serverIp && stream?.ingestKey
      ? `srt://${serverIp}:${srtPort}?streamid=${srtStreamId}&passphrase=${stream.ingestKey}`
      : '';
  const rtmpServer = serverIp ? `rtmp://${serverIp}:${rtmpPort}/live` : '';
  const rtmpStreamKey = `${orgSlug}/${streamSlug}?key=${stream?.ingestKey ?? ''}`;
  const rtmpFullUrl =
    serverIp && stream?.ingestKey
      ? `rtmp://${serverIp}:${rtmpPort}/live/${orgSlug}/${streamSlug}?key=${stream.ingestKey}`
      : '';

  // ── Loading / 404 ──

  if (streamLoading || profileLoading) {
    return (
      <DashboardLayout>
        <div className="max-w-[920px] mx-auto px-6 py-8 text-zinc-500 text-sm">Загрузка...</div>
      </DashboardLayout>
    );
  }

  if (!stream) {
    return (
      <DashboardLayout>
        <div className="max-w-[920px] mx-auto px-6 py-8 space-y-3">
          <p className="text-zinc-400 text-sm">Стрим не найден.</p>
          <Link href="/dashboard" className="text-brand text-sm hover:underline">
            ← Вернуться на панель
          </Link>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-[920px] mx-auto px-6 py-8 space-y-5">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex flex-col gap-1">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors no-underline mb-1"
            >
              <CaretLeft size={12} weight="bold" />
              К панели
            </Link>
            <h1 className="text-xl font-semibold text-zinc-50 tracking-tight flex items-center gap-2.5">
              {stream.name?.trim() || stream.slug}
              {stream.isLive && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[10px] font-medium">
                  <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
                  LIVE
                </span>
              )}
            </h1>
            <span className="text-xs text-zinc-500 font-mono">/{stream.slug}</span>
          </div>
          {orgSlug && streamSlug && (
            <Link
              href={`/watch/${orgSlug}/${streamSlug}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium rounded-md transition-all active:scale-[0.98] no-underline"
            >
              Смотреть
              <ArrowRight size={12} weight="bold" />
            </Link>
          )}
        </div>

        {/* Section: Broadcast Parameters */}
        {/* Живые метрики эфира: битрейт, транскодер, пропуск кадров, графики */}
        <StreamStats streamId={id} />

        <section className="bg-surface-elevated border border-zinc-800/50 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
            <h2 className="flex items-center gap-2 text-base font-medium text-zinc-300">
              <Broadcast size={18} className="text-brand" weight="fill" />
              Параметры трансляции
            </h2>
            <RecordingControl
              enabled={stream.recordingEnabled}
              mode={stream.recordingMode}
              onPatch={(p) => patchRecording.mutate(p)}
              pending={patchRecording.isPending}
              available={true}
            />
          </div>

          {stream.recordingMode === 'manual' && stream.recordingEnabled && !stream.isLive && stream.currentBroadcastId && (
            <div
              className="flex items-center gap-1.5 mb-4 px-2.5 py-1.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-medium w-fit"
              title="Стрим оборвался, но запись не завершена: следующий эфир продолжит эту же запись. Чтобы завершить и опубликовать в архив — выключите запись."
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              Запись на паузе — ждёт возврата стрима
            </div>
          )}

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
                    <button
                      onClick={() => copyText(serverIp)}
                      className="shrink-0 flex items-center gap-1 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs rounded-md transition-all active:scale-[0.98] cursor-pointer"
                    >
                      <Copy size={12} /> Копировать
                    </button>
                  )}
                </div>
                <div className="flex items-center py-3 border-b border-zinc-800/40 gap-3">
                  <span className="w-28 shrink-0 text-xs text-zinc-500">Порт</span>
                  <span className="flex-1 font-mono text-sm text-zinc-300">{srtPort}</span>
                  <button
                    onClick={() => copyText(srtPort)}
                    className="shrink-0 flex items-center gap-1 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs rounded-md transition-all active:scale-[0.98] cursor-pointer"
                  >
                    <Copy size={12} /> Копировать
                  </button>
                </div>
                <div className="flex items-center py-3 border-b border-zinc-800/40 gap-3">
                  <span className="w-28 shrink-0 text-xs text-zinc-500">Stream ID</span>
                  <span className="flex-1 font-mono text-sm text-zinc-300 break-all">{srtStreamId}</span>
                  <button
                    onClick={() => copyText(srtStreamId)}
                    className="shrink-0 flex items-center gap-1 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs rounded-md transition-all active:scale-[0.98] cursor-pointer"
                  >
                    <Copy size={12} /> Копировать
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center py-3 border-b border-zinc-800/40 gap-3">
                  <span className="w-28 shrink-0 text-xs text-zinc-500">Сервер</span>
                  <span className="flex-1 font-mono text-sm text-zinc-300">
                    {rtmpServer || <span className="text-zinc-600">Задайте NEXT_PUBLIC_SERVER_IP</span>}
                  </span>
                  {rtmpServer && (
                    <button
                      onClick={() => copyText(rtmpServer)}
                      className="shrink-0 flex items-center gap-1 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs rounded-md transition-all active:scale-[0.98] cursor-pointer"
                    >
                      <Copy size={12} /> Копировать
                    </button>
                  )}
                </div>
                <div className="flex items-center py-3 border-b border-zinc-800/40 gap-3">
                  <span className="w-28 shrink-0 text-xs text-zinc-500">Порт</span>
                  <span className="flex-1 font-mono text-sm text-zinc-300">{rtmpPort}</span>
                  <button
                    onClick={() => copyText(rtmpPort)}
                    className="shrink-0 flex items-center gap-1 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs rounded-md transition-all active:scale-[0.98] cursor-pointer"
                  >
                    <Copy size={12} /> Копировать
                  </button>
                </div>
                <div className="flex items-center py-3 border-b border-zinc-800/40 gap-3">
                  <span className="w-28 shrink-0 text-xs text-zinc-500">Ключ потока</span>
                  <span className="flex-1 font-mono text-sm text-zinc-300 break-all">
                    {keyVisible
                      ? rtmpStreamKey
                      : `${orgSlug}/${streamSlug}?key=••••••••`}
                  </span>
                  {keyVisible && (
                    <button
                      onClick={() => copyText(rtmpStreamKey)}
                      className="shrink-0 flex items-center gap-1 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs rounded-md transition-all active:scale-[0.98] cursor-pointer"
                    >
                      <Copy size={12} /> Копировать
                    </button>
                  )}
                </div>
              </>
            )}

            {/* Passphrase row */}
            <div className="flex items-center py-3 gap-3">
              <span className="w-28 shrink-0 text-xs text-zinc-500">
                {protocol === 'srt' ? 'Passphrase' : 'Пароль'}
              </span>
              <span className="flex-1 font-mono text-sm text-zinc-300">
                {keyVisible
                  ? stream.ingestKey
                  : '••••••••••••••••••'}
              </span>
              <div className="shrink-0 flex gap-1.5 flex-wrap justify-end">
                {keyVisible && stream.ingestKey && (
                  <button
                    onClick={() => copyText(stream.ingestKey!)}
                    className="flex items-center gap-1 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs rounded-md transition-all active:scale-[0.98] cursor-pointer"
                  >
                    <Copy size={12} /> Копировать
                  </button>
                )}
                <button
                  onClick={() => setKeyVisible((v) => !v)}
                  className="flex items-center gap-1 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs rounded-md transition-all active:scale-[0.98] cursor-pointer"
                >
                  {keyVisible ? (
                    <>
                      <EyeSlash size={12} /> Скрыть
                    </>
                  ) : (
                    <>
                      <Eye size={12} /> Показать
                    </>
                  )}
                </button>
                <button
                  onClick={() => {
                    if (confirm('Сгенерировать новый ключ? Текущий стрим будет прерван.'))
                      rotateKey.mutate();
                  }}
                  disabled={rotateKey.isPending}
                  className="flex items-center gap-1 px-2.5 py-1 bg-brand hover:bg-brand-hover text-white text-xs rounded-md transition-all active:scale-[0.98] cursor-pointer disabled:opacity-50"
                >
                  <ArrowsClockwise size={12} /> Сменить
                </button>
              </div>
            </div>

            {/* Full URL hint */}
            {protocol === 'srt' && (
              <div className="pt-3 border-t border-zinc-800/40">
                <p className="text-xs text-zinc-500 mb-1.5">Полная ссылка для OBS (поле «Сервер»):</p>
                <div className="flex items-center gap-2 bg-zinc-900 rounded-lg px-3 py-2 border border-zinc-800">
                  <code className="flex-1 text-xs text-zinc-300 font-mono break-all">
                    {srtFullUrl ||
                      `srt://${serverIp || 'IP'}:${srtPort}?streamid=${srtStreamId}&passphrase=•••`}
                  </code>
                  {srtFullUrl && (
                    <button
                      onClick={() => copyText(srtFullUrl)}
                      className="shrink-0 p-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 rounded-md transition-all active:scale-[0.95] cursor-pointer"
                      title="Копировать"
                    >
                      <Copy size={14} />
                    </button>
                  )}
                </div>
                {!keyVisible && (
                  <p className="text-xs text-zinc-600 mt-1">Покажите ключ, чтобы скопировать ссылку</p>
                )}
              </div>
            )}
            {protocol === 'rtmp' && (
              <div className="pt-3 border-t border-zinc-800/40">
                <p className="text-xs text-zinc-500 mb-1.5">
                  vMix / OBS: в поле «URL» («Сервер») вставьте Сервер, в поле «Stream Name or
                  Key» («Ключ потока») — Ключ потока. Не вставляйте полную ссылку в поле «URL»
                  vMix: он допишет «/» в конец, и сервер отклонит ключ.
                </p>
                <p className="text-xs text-zinc-500 mb-1.5">
                  Полная ссылка (для клиентов с одним полем адреса, например ffmpeg):
                </p>
                <div className="flex items-center gap-2 bg-zinc-900 rounded-lg px-3 py-2 border border-zinc-800">
                  <code className="flex-1 text-xs text-zinc-300 font-mono break-all">
                    {rtmpFullUrl ||
                      `rtmp://${serverIp || 'IP'}:${rtmpPort}/live/${orgSlug}/${streamSlug}?key=•••`}
                  </code>
                  {rtmpFullUrl && (
                    <button
                      onClick={() => copyText(rtmpFullUrl)}
                      className="shrink-0 p-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 rounded-md transition-all active:scale-[0.95] cursor-pointer"
                      title="Копировать"
                    >
                      <Copy size={14} />
                    </button>
                  )}
                </div>
                {!keyVisible && (
                  <p className="text-xs text-zinc-600 mt-1">Покажите ключ, чтобы скопировать ссылку</p>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Section: Stream Settings */}
        <section className="bg-surface-elevated border border-zinc-800/50 rounded-xl p-5">
          <h2 className="flex items-center gap-2 text-base font-medium text-zinc-300 mb-4">
            <Gear size={18} className="text-zinc-400" />
            Настройки стрима
          </h2>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-zinc-500">Название</label>
              <input
                key={stream.name}
                defaultValue={stream.name ?? ''}
                onBlur={(e) => {
                  if (e.target.value !== stream.name) {
                    updateStream.mutate({ name: e.target.value });
                  }
                }}
                className={inputClasses}
                placeholder="Название трансляции"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-zinc-500">Описание</label>
              <textarea
                key={stream.description}
                defaultValue={stream.description ?? ''}
                onBlur={(e) => {
                  if (e.target.value !== (stream.description ?? '')) {
                    updateStream.mutate({ description: e.target.value || undefined });
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
                  checked={stream.isPublic}
                  onChange={(e) => updateStream.mutate({ isPublic: e.target.checked })}
                  className="accent-brand w-4 h-4 cursor-pointer"
                />
                <span className="text-zinc-300 text-sm">Публичная трансляция</span>
              </label>

              {!stream.isPublic && stream.previewKey && orgSlug && streamSlug && (
                <button
                  onClick={() =>
                    copyText(
                      `${window.location.origin}/watch/${orgSlug}/${streamSlug}?key=${stream.previewKey}`,
                    )
                  }
                  className="flex items-center gap-1 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs rounded-lg transition-all active:scale-[0.98] cursor-pointer"
                >
                  <Copy size={12} /> Скопировать ссылку для зрителей
                </button>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-zinc-500">Камера для превью (во время стрима)</label>
              <select
                value={stream.previewMode ?? 'multicam'}
                onChange={(e) => updateStream.mutate({ previewMode: e.target.value })}
                className={`${inputClasses} cursor-pointer`}
              >
                <option value="multicam">Мультикам (все камеры)</option>
                <option value="cam1">Камера 1 (верхний левый)</option>
                <option value="cam2">Камера 2 (верхний правый)</option>
                <option value="cam3">Камера 3 (нижний левый)</option>
                <option value="cam4">Камера 4 (нижний правый)</option>
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-zinc-500">Формат трансляции</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => updateStream.mutate({ feedMode: 'composite' })}
                  className={`flex flex-col gap-1 p-3 rounded-lg border text-left cursor-pointer transition-colors ${
                    stream.feedMode === 'composite' ? 'border-brand bg-brand/10' : 'border-zinc-800 bg-surface-primary hover:border-zinc-700'
                  }`}
                >
                  <span className="text-sm text-zinc-200 font-medium">Composite</span>
                  <span className="text-[11px] text-zinc-500 leading-snug">Единый кадр с несколькими камерами (vMix), зритель кропает квадранты</span>
                </button>
                <button
                  type="button"
                  onClick={() => updateStream.mutate({ feedMode: 'single' })}
                  className={`flex flex-col gap-1 p-3 rounded-lg border text-left cursor-pointer transition-colors ${
                    stream.feedMode === 'single' ? 'border-brand bg-brand/10' : 'border-zinc-800 bg-surface-primary hover:border-zinc-700'
                  }`}
                >
                  <span className="text-sm text-zinc-200 font-medium">Single</span>
                  <span className="text-[11px] text-zinc-500 leading-snug">Одна камера целиком, для холста-компоновки на стороне зрителя</span>
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 pt-3 border-t border-zinc-800/40">
              <span className="text-xs text-zinc-500">Удалить все сообщения чата этого стрима</span>
              <button
                onClick={() => {
                  if (clearChat.isPending) return;
                  if (confirm('Удалить все сообщения чата этого стрима? Действие необратимо.')) clearChat.mutate();
                }}
                disabled={clearChat.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-zinc-100 transition-all cursor-pointer disabled:opacity-50"
              >
                <Trash size={12} />
                {clearChat.isPending ? 'Очистка...' : 'Очистить чат'}
              </button>
            </div>
          </div>
        </section>

        {/* Section: Preview image */}
        <section className="bg-surface-elevated border border-zinc-800/50 rounded-xl p-5">
          <h2 className="flex items-center gap-2 text-base font-medium text-zinc-300 mb-4">
            <ImageSquare size={18} className="text-zinc-400" />
            Статичное превью (когда стрим не идёт)
          </h2>
          <div className="flex flex-col gap-4">
            {stream.previewImagePath ? (
              <div className="flex items-center gap-4">
                <img
                  src={`${process.env.NEXT_PUBLIC_API_URL ?? '/api'}/v1/public/orgs/${orgSlug}/streams/${streamSlug}/thumbnail?t=${Date.now()}`}
                  alt="Текущее превью"
                  className="w-40 aspect-video object-cover rounded-lg border border-zinc-700"
                />
                <button
                  onClick={() => { if (confirm('Удалить превью?')) deletePreview.mutate(); }}
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
                  if (file) uploadPreview.mutate(file);
                  e.target.value = '';
                }}
                className="hidden"
              />
            </label>
            {uploadPreview.isPending && <p className="text-zinc-500 text-xs">Загрузка...</p>}
          </div>
        </section>

        {/* Section: Broadcasts Archive */}
        <section className="bg-surface-elevated border border-zinc-800/50 rounded-xl p-5">
          <h2 className="flex items-center gap-2 text-base font-medium text-zinc-300 mb-4">
            <Archive size={18} className="text-zinc-400" />
            Архив трансляций
          </h2>

          {visibleBroadcasts.length === 0 && (
            <div className="flex flex-col items-center py-8 gap-2 opacity-40">
              <VideoCamera size={32} className="text-zinc-600" weight="thin" />
              <p className="text-zinc-500 text-sm">Записей пока нет</p>
            </div>
          )}

          {visibleBroadcasts.length > 0 && (
            <div className="flex items-center justify-between mb-3">
              <label className="flex items-center gap-2 text-xs text-zinc-500 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="accent-brand"
                  checked={selectedBroadcasts.size === visibleBroadcasts.length}
                  onChange={(e) =>
                    setSelectedBroadcasts(
                      e.target.checked ? new Set(visibleBroadcasts.map((b) => b.id)) : new Set(),
                    )
                  }
                />
                Выбрать все
              </label>
              {selectedBroadcasts.size > 0 && (
                <button
                  onClick={() => {
                    if (confirm(`Удалить выбранные записи (${selectedBroadcasts.size})?`))
                      bulkDeleteBroadcasts.mutate(Array.from(selectedBroadcasts));
                  }}
                  disabled={bulkDeleteBroadcasts.isPending}
                  className="flex items-center gap-1 px-2.5 py-1 bg-red-900/30 hover:bg-red-900/60 text-red-400 hover:text-red-300 text-xs rounded-md transition-all active:scale-[0.98] cursor-pointer disabled:opacity-50"
                >
                  <Trash size={12} />
                  {bulkDeleteBroadcasts.isPending
                    ? 'Удаление...'
                    : `Удалить выбранные (${selectedBroadcasts.size})`}
                </button>
              )}
            </div>
          )}

          <div className="flex flex-col gap-2">
            {visibleBroadcasts.map((b) => (
              <div key={b.id} className="bg-surface-primary rounded-lg p-3.5">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    className="accent-brand shrink-0"
                    checked={selectedBroadcasts.has(b.id)}
                    onChange={(e) =>
                      setSelectedBroadcasts((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(b.id);
                        else next.delete(b.id);
                        return next;
                      })
                    }
                  />
                  <div className="relative w-28 shrink-0 aspect-video bg-zinc-900 rounded-md overflow-hidden hidden sm:block">
                    {b.hasPreview ? (
                      <img
                        src={broadcastPreviewUrl(b.id)}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <VideoCamera size={20} className="text-zinc-700" weight="thin" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="min-w-0">
                      <span className="font-semibold text-sm text-zinc-100">{b.title}</span>
                      {b.description && (
                        <span className="ml-2 text-zinc-600 text-xs">{b.description}</span>
                      )}
                      <div className="text-xs text-zinc-600 mt-0.5 font-mono tabular-nums">
                        {new Date(b.startedAt).toLocaleDateString('ru-RU')}
                        {b.recording?.duration ? ` · ${formatTime(b.recording.duration)}` : ''}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-1.5 shrink-0 flex-wrap justify-end">
                    {b.recording?.status === 'ready' && (
                      <a
                        href={`/api/v1/org/broadcasts/${b.id}/recording/download`}
                        className="flex items-center gap-1 px-2.5 py-1 bg-brand hover:bg-brand-hover text-white text-xs rounded-md transition-all active:scale-[0.98] no-underline"
                      >
                        <DownloadSimple size={12} />
                        Скачать
                        {b.recording.fileSize
                          ? ` (${(b.recording.fileSize / 1024 / 1024 / 1024).toFixed(1)} ГБ)`
                          : ''}
                      </a>
                    )}
                    {b.recording?.status === 'processing' && (
                      <span className="px-2.5 py-1 bg-zinc-800 text-zinc-500 text-xs rounded-md">
                        Обрабатывается...
                      </span>
                    )}
                    <label className="flex items-center gap-1 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs rounded-md transition-all active:scale-[0.98] cursor-pointer">
                      <ImageSquare size={12} />
                      {uploadBroadcastPreview.isPending ? 'Загрузка...' : 'Заменить превью'}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) uploadBroadcastPreview.mutate({ bid: b.id, file });
                          e.target.value = '';
                        }}
                      />
                    </label>
                    <button
                      onClick={() => {
                        if (confirm(`Удалить запись "${b.title}"?`))
                          deleteBroadcast.mutate(b.id);
                      }}
                      className="flex items-center gap-1 px-2.5 py-1 bg-red-900/30 hover:bg-red-900/60 text-red-400 hover:text-red-300 text-xs rounded-md transition-all active:scale-[0.98] cursor-pointer"
                    >
                      <Trash size={12} /> Удалить
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </DashboardLayout>
  );
}
