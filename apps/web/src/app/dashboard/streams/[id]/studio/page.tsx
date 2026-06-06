'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react';
import Hls from 'hls.js';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { Socket } from 'socket.io-client';
import {
  ArrowSquareOut,
  ArrowsClockwise,
  ArrowsLeftRight,
  CaretDown,
  CaretLeft,
  Copy,
  Eye,
  EyeSlash,
  Gear,
  Info,
  PencilSimple,
  Power,
  QrCode,
  Share,
  ShareNetwork,
  SpeakerHigh,
  SpeakerSlash,
  Stack,
  Stop,
  TelegramLogo,
  VideoCamera,
  X,
} from '@phosphor-icons/react';
import { api } from '@/lib/api';
import { getStudioSocket } from '@/lib/socket';
import { DashboardLayout } from '@/components/DashboardLayout';
import MatPlayer from '@/components/MatPlayer';
import { RecordingControl, type RecordingMode } from '@/components/dashboard/RecordingControl';
import {
  LAYOUT_PRESETS,
  DEFAULT_LAYOUT_BY_COUNT,
  type LayoutPreset,
} from '@/lib/layout-presets';

// ─── Types ──────────────────────────────────────────────────────────────────

interface StreamSlot {
  index: number;
  name?: string;
  isAudioSource?: boolean;
}

interface StreamDto {
  id: string;
  slug: string;
  name: string;
  description?: string;
  mode: 'composite' | 'multistream';
  slotCount: number;
  slots: StreamSlot[];
  slotOrder: number[];
  layoutPreset: string;
  fallbackLayouts: Record<string, string> | null;
  isPublic: boolean;
  previewKey?: string | null;
  previewMode: string;
  previewImagePath?: string | null;
  isLive: boolean;
  recordingEnabled: boolean;
  recordingMode: RecordingMode;
  autoStartMode: 'public' | 'test';
  ingestKey?: string;
  ingestKeyCreatedAt: string;
  currentBroadcastId?: string | null;
  createdAt: string;
}

interface OrgMe {
  sub: string;
  role: string;
  orgSlug?: string;
}

interface SlotStateMsg {
  streamId: string;
  slotIndex: number;
  isPublishing: boolean;
  bitrate: number | null;
  lastPublishAt: string | null;
  lastUnpublishAt: string | null;
}

type Status = 'OFF' | 'TEST' | 'PUBLIC';

// ─── Helpers ────────────────────────────────────────────────────────────────

function copyText(text: string) {
  if (!text) return;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
    return;
  }
  legacyCopy(text);
}

function legacyCopy(text: string) {
  const el = document.createElement('textarea');
  el.value = text;
  el.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.appendChild(el);
  el.focus();
  el.select();
  try {
    document.execCommand('copy');
  } catch {
    /* ignore */
  }
  document.body.removeChild(el);
}

function formatBitrate(bps: number | null): string {
  if (!bps || !isFinite(bps) || bps <= 0) return '—';
  const mbps = bps / 1_000_000;
  if (mbps >= 1) return `${mbps.toFixed(1)} Mbps`;
  const kbps = bps / 1_000;
  return `${Math.round(kbps)} kbps`;
}

function maskedKey(): string {
  return '••••••••••••';
}

function buildSrtUrl(opts: {
  serverIp: string;
  port: string;
  orgSlug: string;
  streamSlug: string;
  slotIndex: number;
  ingestKey: string;
}): string {
  const { serverIp, port, orgSlug, streamSlug, slotIndex, ingestKey } = opts;
  if (!serverIp) return '';
  const streamPath = streamSlug ? `${orgSlug}/${streamSlug}` : orgSlug;
  return `srt://${serverIp}:${port}?streamid=publish:live/${streamPath}/${slotIndex}&passphrase=${ingestKey}`;
}

function buildRtmpUrl(opts: {
  serverIp: string;
  port: string;
  orgSlug: string;
  streamSlug: string;
  slotIndex: number;
  ingestKey: string;
}): string {
  const { serverIp, port, orgSlug, streamSlug, slotIndex, ingestKey } = opts;
  if (!serverIp) return '';
  const streamPath = streamSlug ? `${orgSlug}/${streamSlug}` : orgSlug;
  return `rtmp://${serverIp}:${port}/live/${streamPath}/${slotIndex}?key=${ingestKey}`;
}

function computeStatus(stream: StreamDto, activeCount: number): Status {
  if (activeCount === 0) return 'OFF';
  return stream.isPublic ? 'PUBLIC' : 'TEST';
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function StudioPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const streamId = params?.id;
  const qc = useQueryClient();

  const [keyVisible, setKeyVisible] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [stopOpen, setStopOpen] = useState(false);
  const [editingSlotIdx, setEditingSlotIdx] = useState<number | null>(null);
  const [editingSlotName, setEditingSlotName] = useState('');
  const [copiedFlash, setCopiedFlash] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [origin, setOrigin] = useState('');

  const [slotStates, setSlotStates] = useState<Record<number, SlotStateMsg>>({});

  // ─── Origin (only available client-side) ────────────────────────────────
  useEffect(() => {
    if (typeof window !== 'undefined') setOrigin(window.location.origin);
  }, []);

  // ─── Me (for orgSlug, used to redirect composite to /dashboard) ─────────
  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<OrgMe>('/v1/auth/me'),
    retry: false,
  });

  // ─── Stream config (with ingestKey reveal) ──────────────────────────────
  const { data: stream, isLoading, error } = useQuery({
    queryKey: ['org-stream', streamId, keyVisible],
    queryFn: () =>
      api.get<StreamDto>(
        `/v1/org/streams/${streamId}${keyVisible ? '?reveal=true' : ''}`,
      ),
    enabled: !!streamId,
    refetchInterval: 15_000,
  });

  // Redirect composite Stream to legacy /dashboard.
  useEffect(() => {
    if (stream && stream.mode === 'composite') {
      router.replace('/dashboard');
    }
  }, [stream, router]);

  // ─── Mutations ──────────────────────────────────────────────────────────
  const patchStream = useMutation({
    mutationFn: (body: Partial<StreamDto> & { slots?: StreamSlot[] }) =>
      api.patch<StreamDto>(`/v1/org/streams/${streamId}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org-stream', streamId] }),
  });

  const rotateKey = useMutation({
    mutationFn: () => api.post(`/v1/org/streams/${streamId}/rotate-key`),
    onSuccess: () => {
      setKeyVisible(true);
      qc.invalidateQueries({ queryKey: ['org-stream', streamId] });
    },
  });

  const stopStream = useMutation({
    mutationFn: () => api.post(`/v1/org/streams/${streamId}/stop`),
    onSuccess: () => {
      setStopOpen(false);
      qc.invalidateQueries({ queryKey: ['org-stream', streamId] });
    },
  });

  const patchRecording = useMutation({
    mutationFn: (patch: { enabled?: boolean; mode?: RecordingMode }) =>
      api.patch<StreamDto>(`/v1/org/streams/${streamId}/recording`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org-stream', streamId] }),
  });

  // ─── WebSocket /studio ──────────────────────────────────────────────────
  useEffect(() => {
    if (!streamId) return;
    const socket: Socket = getStudioSocket();

    const handleSlotState = (msg: SlotStateMsg) => {
      if (msg.streamId !== streamId) return;
      setSlotStates((prev) => ({ ...prev, [msg.slotIndex]: msg }));
    };

    const handleJoined = () => {
      // Snapshot is sent as a series of `slotState` events right before this.
    };

    const handleError = (err: { code?: string; message?: string }) => {
      // Don't spam; rely on refetchInterval to recover stream config.
      // eslint-disable-next-line no-console
      console.warn('[studio ws]', err?.code, err?.message);
    };

    const joinIfReady = () => {
      socket.emit('join', { streamId });
    };

    if (socket.connected) {
      joinIfReady();
    } else {
      socket.once('connect', joinIfReady);
    }
    socket.on('connect', joinIfReady);
    socket.on('slotState', handleSlotState);
    socket.on('joined', handleJoined);
    socket.on('error', handleError);

    return () => {
      socket.off('connect', joinIfReady);
      socket.off('slotState', handleSlotState);
      socket.off('joined', handleJoined);
      socket.off('error', handleError);
    };
  }, [streamId]);

  // ─── Derived values ─────────────────────────────────────────────────────
  const orgSlug = useMemo(() => me?.orgSlug ?? '', [me]);
  const serverIp = process.env.NEXT_PUBLIC_SERVER_IP ?? '';
  const srtPort = process.env.NEXT_PUBLIC_SRT_PORT ?? '8890';
  const rtmpPort = process.env.NEXT_PUBLIC_RTMP_PORT ?? '1935';

  const slotsArr: StreamSlot[] = useMemo(() => {
    if (!stream) return [];
    const arr: StreamSlot[] = Array.isArray(stream.slots) ? [...stream.slots] : [];
    // Normalize length to slotCount and sort by index.
    const byIdx = new Map<number, StreamSlot>();
    for (const s of arr) {
      if (s && typeof s.index === 'number') byIdx.set(s.index, s);
    }
    const out: StreamSlot[] = [];
    for (let i = 1; i <= stream.slotCount; i++) {
      out.push(byIdx.get(i) ?? { index: i, name: '' });
    }
    return out;
  }, [stream]);

  const activeSlotIndexes: number[] = useMemo(() => {
    const arr: number[] = [];
    for (const [idxStr, st] of Object.entries(slotStates)) {
      if (st.isPublishing) arr.push(Number(idxStr));
    }
    arr.sort((a, b) => a - b);
    return arr;
  }, [slotStates]);

  const activeCount = activeSlotIndexes.length;
  const status: Status = stream
    ? computeStatus(stream, activeCount)
    : 'OFF';

  const slotHlsUrls = useMemo<string[]>(() => {
    if (!stream || !orgSlug) return [];
    // Default Stream (slug=''): /api/v1/public/orgs/<org>/live/hls/<n>/index.m3u8
    // Named Stream:             /api/v1/public/orgs/<org>/streams/<slug>/live/hls/<n>/index.m3u8
    const prefix = stream.slug
      ? `/api/v1/public/orgs/${orgSlug}/streams/${stream.slug}`
      : `/api/v1/public/orgs/${orgSlug}`;
    return slotsArr.map((s) => `${prefix}/live/hls/${s.index}/index.m3u8`);
  }, [stream, orgSlug, slotsArr]);

  const availableLayoutsForCurrentCount = useMemo<LayoutPreset[]>(() => {
    if (!stream) return [];
    return Object.values(LAYOUT_PRESETS).filter(
      (p) => p.slotCount === stream.slotCount,
    );
  }, [stream]);

  const watchUrl = useMemo(() => {
    if (!origin || !orgSlug) return '';
    const path = stream && stream.slug ? `/watch/${orgSlug}/${stream.slug}` : `/watch/${orgSlug}`;
    return `${origin}${path}`;
  }, [origin, orgSlug, stream]);

  const shareWatchUrl = useMemo(() => {
    if (!watchUrl) return '';
    if (stream && !stream.isPublic && stream.previewKey) {
      return `${watchUrl}?key=${stream.previewKey}`;
    }
    return watchUrl;
  }, [watchUrl, stream]);

  // ─── Copy helpers ───────────────────────────────────────────────────────
  const handleCopy = useCallback((text: string, flashId: string) => {
    if (!text) return;
    copyText(text);
    setCopiedFlash(flashId);
    setTimeout(() => {
      setCopiedFlash((prev) => (prev === flashId ? null : prev));
    }, 1300);
  }, []);

  // ─── Slot operations ────────────────────────────────────────────────────
  const renameSlot = useCallback(
    (slotIndex: number, name: string) => {
      if (!stream) return;
      const slots = slotsArr.map((s) =>
        s.index === slotIndex ? { ...s, name } : s,
      );
      patchStream.mutate({ slots });
      setEditingSlotIdx(null);
    },
    [stream, slotsArr, patchStream],
  );

  const setAudioSource = useCallback(
    (slotIndex: number) => {
      if (!stream) return;
      const slots = slotsArr.map((s) => ({
        ...s,
        isAudioSource: s.index === slotIndex,
      }));
      patchStream.mutate({ slots });
    },
    [stream, slotsArr, patchStream],
  );

  const swapSlotOrder = useCallback(
    (fromSlotIdx: number, toSlotIdx: number) => {
      if (!stream || fromSlotIdx === toSlotIdx) return;
      const order = [...stream.slotOrder];
      const fromPos = order.indexOf(fromSlotIdx);
      const toPos = order.indexOf(toSlotIdx);
      if (fromPos < 0 || toPos < 0) return;
      [order[fromPos], order[toPos]] = [order[toPos], order[fromPos]];
      patchStream.mutate({ slotOrder: order });
    },
    [stream, patchStream],
  );

  // ─── Layout picker ──────────────────────────────────────────────────────
  const setLayout = useCallback(
    (presetId: string) => {
      if (!stream || stream.layoutPreset === presetId) return;
      patchStream.mutate({ layoutPreset: presetId });
    },
    [stream, patchStream],
  );

  // ─── Public toggle ──────────────────────────────────────────────────────
  const toggleIsPublic = useCallback(() => {
    if (!stream) return;
    patchStream.mutate({ isPublic: !stream.isPublic });
  }, [stream, patchStream]);

  // ─── Render guards ──────────────────────────────────────────────────────
  if (isLoading || !stream) {
    return (
      <DashboardLayout>
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-8">
          {error ? (
            <div className="bg-red-950/40 border border-red-900/60 rounded-xl p-5 text-sm text-red-300">
              {(error as Error)?.message ?? 'Не удалось загрузить Stream'}
              <Link
                href="/dashboard"
                className="ml-3 text-zinc-400 hover:text-zinc-200 underline"
              >
                Вернуться
              </Link>
            </div>
          ) : (
            <StudioSkeleton />
          )}
        </div>
      </DashboardLayout>
    );
  }

  if (stream.mode === 'composite') {
    // Effect above triggers a replace; render nothing while routing.
    return (
      <DashboardLayout>
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-8 text-sm text-zinc-500">
          Перенаправление...
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 space-y-5">
        {/* ─── Header ────────────────────────────────────────────────── */}
        <StudioHeader
          stream={stream}
          status={status}
          activeCount={activeCount}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenStop={() => setStopOpen(true)}
          onPatchRecording={(p) => patchRecording.mutate(p)}
          recordingPending={patchRecording.isPending}
        />

        {/* ─── Main grid: preview + slots ───────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5">
          {/* Composed preview */}
          <section className="space-y-3">
            <div className="bg-surface-elevated border border-zinc-800/60 rounded-xl overflow-hidden">
              <div className="relative w-full aspect-video bg-black">
                {activeCount > 0 ? (
                  <MatPlayer
                    mode="multistream"
                    streamUrls={slotHlsUrls}
                    slots={slotsArr.map((s) => ({
                      index: s.index,
                      name: s.name ?? '',
                      isAudioSource: !!s.isAudioSource,
                    }))}
                    activeSlotIndexes={activeSlotIndexes}
                    layoutPreset={stream.layoutPreset}
                    fallbackLayouts={
                      stream.fallbackLayouts
                        ? Object.fromEntries(
                            Object.entries(stream.fallbackLayouts).map(([k, v]) => [Number(k), v]),
                          )
                        : null
                    }
                    viewMode="composed"
                    volume={0}
                  />
                ) : (
                  <PreviewEmpty />
                )}

                {/* Slot position overlay — drag-to-swap entry points */}
                {activeCount >= 2 && (
                  <DragOverlay
                    stream={stream}
                    activeSlotIndexes={activeSlotIndexes}
                    onSwap={swapSlotOrder}
                  />
                )}
              </div>
            </div>

            {/* Layout picker */}
            <LayoutPicker
              presets={availableLayoutsForCurrentCount}
              current={stream.layoutPreset}
              onSelect={setLayout}
              pending={patchStream.isPending}
            />

            {/* Setup guide — пошаговая инструкция для vMix/OBS + параметры по слотам */}
            <SetupGuide
              serverIp={serverIp}
              srtPort={srtPort}
              rtmpPort={rtmpPort}
              orgSlug={orgSlug}
              streamSlug={stream.slug}
              slots={slotsArr}
              ingestKey={stream.ingestKey}
              keyVisible={keyVisible}
              onReveal={() => setKeyVisible(true)}
              onCopy={handleCopy}
              copiedFlash={copiedFlash}
            />
          </section>

          {/* Slots panel */}
          <aside className="space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-medium text-zinc-300 px-1">
              <Stack size={16} weight="fill" className="text-brand" />
              Камеры · {stream.slotCount}
            </h2>

            <div className="flex flex-col gap-2.5">
              {slotsArr.map((slot) => {
                const sState = slotStates[slot.index];
                const isPublishing = !!sState?.isPublishing;
                const bitrate = sState?.bitrate ?? null;
                const isEditing = editingSlotIdx === slot.index;

                const srtUrl = stream.ingestKey
                  ? buildSrtUrl({
                      serverIp,
                      port: srtPort,
                      orgSlug,
                      streamSlug: stream.slug,
                      slotIndex: slot.index,
                      ingestKey: stream.ingestKey,
                    })
                  : '';
                const rtmpUrl = stream.ingestKey
                  ? buildRtmpUrl({
                      serverIp,
                      port: rtmpPort,
                      orgSlug,
                      streamSlug: stream.slug,
                      slotIndex: slot.index,
                      ingestKey: stream.ingestKey,
                    })
                  : '';

                const maskedSrt = serverIp
                  ? `srt://${serverIp}:${srtPort}?streamid=publish:live/${stream.slug ? `${orgSlug}/${stream.slug}` : orgSlug}/${slot.index}&passphrase=${maskedKey()}`
                  : '';
                const maskedRtmp = serverIp
                  ? `rtmp://${serverIp}:${rtmpPort}/live/${stream.slug ? `${orgSlug}/${stream.slug}` : orgSlug}/${slot.index}?key=${maskedKey()}`
                  : '';

                return (
                  <SlotCard
                    key={slot.index}
                    slot={slot}
                    isPublishing={isPublishing}
                    bitrate={bitrate}
                    orgSlug={orgSlug}
                    streamSlug={stream.slug}
                    keyVisible={keyVisible}
                    isEditing={isEditing}
                    editingName={editingSlotName}
                    onStartEdit={() => {
                      setEditingSlotIdx(slot.index);
                      setEditingSlotName(slot.name ?? '');
                    }}
                    onChangeEditName={setEditingSlotName}
                    onCancelEdit={() => setEditingSlotIdx(null)}
                    onSaveName={() => renameSlot(slot.index, editingSlotName.trim())}
                    onToggleAudio={() => setAudioSource(slot.index)}
                    srtUrl={srtUrl}
                    rtmpUrl={rtmpUrl}
                    maskedSrt={maskedSrt}
                    maskedRtmp={maskedRtmp}
                    onCopySrt={() => handleCopy(srtUrl, `srt-${slot.index}`)}
                    onCopyRtmp={() => handleCopy(rtmpUrl, `rtmp-${slot.index}`)}
                    onReveal={() => setKeyVisible(true)}
                    copiedFlash={copiedFlash}
                  />
                );
              })}
            </div>

            {/* Key visibility + rotate */}
            <KeyControls
              keyVisible={keyVisible}
              setKeyVisible={setKeyVisible}
              ingestKey={stream.ingestKey}
              onRotate={() => {
                if (
                  confirm(
                    'Сгенерировать новый ключ? Текущая публикация будет прервана.',
                  )
                ) {
                  rotateKey.mutate();
                }
              }}
              rotating={rotateKey.isPending}
              onCopy={() => handleCopy(stream.ingestKey ?? '', 'ingest-key')}
              copiedFlash={copiedFlash}
            />
          </aside>
        </div>

        {/* ─── Share panel ──────────────────────────────────────────── */}
        <SharePanel
          stream={stream}
          status={status}
          shareWatchUrl={shareWatchUrl}
          watchUrl={watchUrl}
          onToggleIsPublic={toggleIsPublic}
          onCopy={() => handleCopy(shareWatchUrl, 'watch-url')}
          onOpenQr={() => setQrOpen(true)}
          copiedFlash={copiedFlash}
          activeCount={activeCount}
          pending={patchStream.isPending}
        />
      </div>

      {settingsOpen && (
        <SettingsModal
          stream={stream}
          onClose={() => setSettingsOpen(false)}
          onSubmit={(payload) => {
            patchStream.mutate(payload, {
              onSuccess: () => setSettingsOpen(false),
            });
          }}
          pending={patchStream.isPending}
        />
      )}

      {stopOpen && (
        <StopModal
          onClose={() => setStopOpen(false)}
          onConfirm={() => stopStream.mutate()}
          pending={stopStream.isPending}
        />
      )}

      {qrOpen && shareWatchUrl && (
        <QrModal
          url={shareWatchUrl}
          onClose={() => setQrOpen(false)}
        />
      )}
    </DashboardLayout>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────────────

function StudioSkeleton() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="h-12 bg-surface-elevated rounded-xl" />
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5">
        <div className="aspect-video bg-surface-elevated rounded-xl" />
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-32 bg-surface-elevated rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}

function PreviewEmpty() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-zinc-500">
      <VideoCamera size={42} weight="thin" />
      <div className="text-sm">Ни одна камера не публикует поток</div>
      <div className="text-xs text-zinc-600 max-w-[320px] text-center">
        Подключите vMix/OBS по SRT- или RTMP-адресу любого слота. Превью появится автоматически.
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  if (status === 'PUBLIC') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs font-medium tracking-wide">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        PUBLIC
      </span>
    );
  }
  if (status === 'TEST') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-300 text-xs font-medium tracking-wide">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
        TEST
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-800/70 border border-zinc-700 text-zinc-400 text-xs font-medium tracking-wide">
      <span className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
      OFFLINE
    </span>
  );
}

function StudioHeader({
  stream,
  status,
  activeCount,
  onOpenSettings,
  onOpenStop,
  onPatchRecording,
  recordingPending,
}: {
  stream: StreamDto;
  status: Status;
  activeCount: number;
  onOpenSettings: () => void;
  onOpenStop: () => void;
  onPatchRecording: (patch: { enabled?: boolean; mode?: RecordingMode }) => void;
  recordingPending: boolean;
}) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <Link
        href="/dashboard"
        className="flex items-center gap-1.5 text-zinc-500 hover:text-zinc-200 no-underline text-sm transition-colors px-2 py-1.5 rounded-lg hover:bg-zinc-800/50"
      >
        <CaretLeft size={16} />
        Dashboard
      </Link>
      <div className="w-px h-5 bg-zinc-800" />
      <h1 className="text-lg font-semibold text-zinc-50 tracking-tight">
        {stream.name?.trim() || 'Без названия'}
      </h1>
      <StatusBadge status={status} />
      <span className="text-xs text-zinc-500 font-mono tabular-nums">
        {activeCount}/{stream.slotCount} камер
      </span>

      <div className="ml-auto flex items-center gap-2">
        <RecordingControl
          enabled={stream.recordingEnabled}
          mode={stream.recordingMode}
          onPatch={onPatchRecording}
          pending={recordingPending}
        />
        <button
          onClick={onOpenSettings}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-zinc-100 text-sm font-medium rounded-lg transition-all active:scale-[0.98] cursor-pointer"
        >
          <Gear size={14} />
          Настройки
        </button>
        <button
          onClick={onOpenStop}
          disabled={!stream.isLive}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/15 hover:bg-red-500/25 text-red-300 hover:text-red-200 text-sm font-medium rounded-lg transition-all active:scale-[0.98] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Stop size={14} weight="fill" />
          Остановить
        </button>
      </div>
    </div>
  );
}

function LayoutPicker({
  presets,
  current,
  onSelect,
  pending,
}: {
  presets: LayoutPreset[];
  current: string;
  onSelect: (id: string) => void;
  pending: boolean;
}) {
  if (presets.length === 0) return null;
  return (
    <div className="bg-surface-elevated border border-zinc-800/60 rounded-xl p-3">
      <div className="flex items-center gap-2 mb-2.5">
        <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
          Раскладка
        </span>
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {presets.map((p) => {
          const active = p.id === current;
          return (
            <button
              key={p.id}
              onClick={() => onSelect(p.id)}
              disabled={pending || active}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all active:scale-[0.98] cursor-pointer disabled:cursor-default ${
                active
                  ? 'bg-brand text-white shadow-sm shadow-brand/20'
                  : 'bg-zinc-800/60 hover:bg-zinc-800 text-zinc-300 hover:text-zinc-100'
              }`}
            >
              {p.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DragOverlay({
  stream,
  activeSlotIndexes,
  onSwap,
}: {
  stream: StreamDto;
  activeSlotIndexes: number[];
  onSwap: (from: number, to: number) => void;
}) {
  // Compute layout positions normalized to 0..1 once per layout/activeCount
  // and overlay invisible drop targets. Each active slot exposes a small
  // drag handle in its top-left corner.
  //
  // We use the same `pickLayout` logic — but to keep this component free of
  // imports of the heavy resolver, we just split the canvas evenly per the
  // current count when the layout preset doesn't match the activeCount.
  const positions = useMemo(() => {
    const cw = 100;
    const ch = 100;
    const preset =
      LAYOUT_PRESETS[stream.layoutPreset]?.slotCount === activeSlotIndexes.length
        ? LAYOUT_PRESETS[stream.layoutPreset]
        : LAYOUT_PRESETS[DEFAULT_LAYOUT_BY_COUNT[Math.min(activeSlotIndexes.length, 4)] ?? 'solo'];
    if (!preset) return [];
    return preset
      .resolve(cw, ch)
      .map((p) => ({
        leftPct: p.x,
        topPct: p.y,
        widthPct: p.w,
        heightPct: p.h,
      }));
  }, [stream.layoutPreset, activeSlotIndexes.length]);

  // Map "layout position index" → slotIndex via stream.slotOrder filtered by active.
  const slotForPosition = useMemo(() => {
    const activeSet = new Set(activeSlotIndexes);
    const orderedActive = stream.slotOrder.filter((idx) => activeSet.has(idx));
    return orderedActive;
  }, [stream.slotOrder, activeSlotIndexes]);

  const handleDragStart = (e: DragEvent<HTMLButtonElement>, slotIdx: number) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(slotIdx));
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>, slotIdx: number) => {
    e.preventDefault();
    const fromStr = e.dataTransfer.getData('text/plain');
    const from = Number(fromStr);
    if (!Number.isFinite(from) || from === slotIdx) return;
    onSwap(from, slotIdx);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  if (positions.length !== slotForPosition.length) return null;

  return (
    <div className="absolute inset-0 pointer-events-none">
      {positions.map((pos, i) => {
        const slotIdx = slotForPosition[i];
        if (slotIdx === undefined) return null;
        return (
          <div
            key={`${slotIdx}-${i}`}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, slotIdx)}
            style={{
              position: 'absolute',
              left: `${pos.leftPct}%`,
              top: `${pos.topPct}%`,
              width: `${pos.widthPct}%`,
              height: `${pos.heightPct}%`,
            }}
            className="pointer-events-auto group"
          >
            <button
              type="button"
              draggable
              onDragStart={(e) => handleDragStart(e, slotIdx)}
              className="absolute top-2 left-2 flex items-center gap-1 px-2 py-1 rounded-md bg-black/65 backdrop-blur-sm border border-white/15 text-white text-[11px] font-medium cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity duration-150"
              title="Перетащите, чтобы поменять местами"
            >
              <ArrowsLeftRight size={11} />
              Cam {slotIdx}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function SlotCard({
  slot,
  isPublishing,
  bitrate,
  orgSlug,
  streamSlug,
  keyVisible,
  isEditing,
  editingName,
  onStartEdit,
  onChangeEditName,
  onCancelEdit,
  onSaveName,
  onToggleAudio,
  srtUrl,
  rtmpUrl,
  maskedSrt,
  maskedRtmp,
  onCopySrt,
  onCopyRtmp,
  onReveal,
  copiedFlash,
}: {
  slot: StreamSlot;
  isPublishing: boolean;
  bitrate: number | null;
  orgSlug: string;
  streamSlug: string;
  keyVisible: boolean;
  isEditing: boolean;
  editingName: string;
  onStartEdit: () => void;
  onChangeEditName: (v: string) => void;
  onCancelEdit: () => void;
  onSaveName: () => void;
  onToggleAudio: () => void;
  srtUrl: string;
  rtmpUrl: string;
  maskedSrt: string;
  maskedRtmp: string;
  onCopySrt: () => void;
  onCopyRtmp: () => void;
  onReveal: () => void;
  copiedFlash: string | null;
}) {
  const label = slot.name?.trim() || 'Без имени';
  return (
    <div
      className={`rounded-xl border bg-surface-elevated p-4 transition-colors ${
        isPublishing ? 'border-emerald-500/30' : 'border-zinc-800/60'
      }`}
    >
      {/* Header: slot N + name + edit + audio */}
      <div className="flex items-center gap-2.5">
        <span
          className={`shrink-0 w-7 h-7 rounded-full text-xs font-semibold flex items-center justify-center font-mono ${
            isPublishing
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
              : 'bg-zinc-800 text-zinc-500 border border-zinc-700'
          }`}
        >
          {slot.index}
        </span>

        {isEditing ? (
          <input
            autoFocus
            value={editingName}
            onChange={(e) => onChangeEditName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSaveName();
              if (e.key === 'Escape') onCancelEdit();
            }}
            onBlur={onSaveName}
            className="flex-1 min-w-0 px-2 py-1 bg-surface-primary border border-zinc-700 rounded-md text-sm text-zinc-200 focus:border-brand outline-none"
            placeholder="Название камеры"
            maxLength={48}
          />
        ) : (
          <button
            onClick={onStartEdit}
            className="flex-1 min-w-0 flex items-center gap-1.5 text-sm font-medium text-zinc-100 hover:text-white text-left cursor-pointer group"
            title="Переименовать"
          >
            <span className="truncate">{label}</span>
            <PencilSimple
              size={12}
              className="text-zinc-600 group-hover:text-zinc-300 transition-colors shrink-0"
            />
          </button>
        )}

        <button
          onClick={onToggleAudio}
          title={slot.isAudioSource ? 'Аудио-источник' : 'Сделать аудио-источником'}
          className={`shrink-0 w-7 h-7 flex items-center justify-center rounded-md transition-all active:scale-[0.95] cursor-pointer ${
            slot.isAudioSource
              ? 'bg-brand text-white'
              : 'bg-zinc-800 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700'
          }`}
        >
          {slot.isAudioSource ? (
            <SpeakerHigh size={14} weight="fill" />
          ) : (
            <SpeakerSlash size={14} />
          )}
        </button>
      </div>

      {/* Status row */}
      <div className="mt-3 flex items-center gap-2 text-xs">
        {isPublishing ? (
          <>
            <span className="inline-flex items-center gap-1 text-emerald-300">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              publishing
            </span>
            <span className="text-zinc-600">·</span>
            <span className="text-zinc-400 font-mono tabular-nums">
              {formatBitrate(bitrate)}
            </span>
          </>
        ) : (
          <span className="text-zinc-500">ожидает поток</span>
        )}
      </div>

      {/* Live preview (own hls.js per slot) */}
      <div className="mt-3 aspect-video w-full rounded-lg overflow-hidden bg-zinc-900 border border-zinc-800/60 flex items-center justify-center">
        {isPublishing && orgSlug ? (
          <SlotLivePreview
            orgSlug={orgSlug}
            streamSlug={streamSlug}
            slotIndex={slot.index}
          />
        ) : (
          <div className="flex flex-col items-center gap-1 text-zinc-700">
            <VideoCamera size={28} weight="thin" />
            <span className="text-xs">Превью</span>
          </div>
        )}
      </div>

      {/* SRT row */}
      <div className="mt-3 space-y-2">
        <UrlRow
          label="SRT"
          value={keyVisible ? srtUrl : maskedSrt}
          onCopy={onCopySrt}
          canCopy={keyVisible && !!srtUrl}
          onReveal={onReveal}
          flashing={copiedFlash === `srt-${slot.index}`}
        />
        <UrlRow
          label="RTMP"
          value={keyVisible ? rtmpUrl : maskedRtmp}
          onCopy={onCopyRtmp}
          canCopy={keyVisible && !!rtmpUrl}
          onReveal={onReveal}
          flashing={copiedFlash === `rtmp-${slot.index}`}
        />
      </div>
    </div>
  );
}

function SlotLivePreview({
  orgSlug,
  streamSlug,
  slotIndex,
}: {
  orgSlug: string;
  streamSlug: string;
  slotIndex: number;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const hlsUrl = streamSlug
    ? `/api/v1/public/orgs/${orgSlug}/streams/${streamSlug}/live/hls/${slotIndex}/index.m3u8`
    : `/api/v1/public/orgs/${orgSlug}/live/hls/${slotIndex}/index.m3u8`;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let hls: Hls | null = null;

    if (Hls.isSupported()) {
      hls = new Hls({
        liveDurationInfinity: true,
        lowLatencyMode: false,
        liveSyncDuration: 4,
        maxBufferLength: 10,
        backBufferLength: 0,
      });
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls?.startLoad();
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls?.recoverMediaError();
        else { hls?.destroy(); hls = null; }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = hlsUrl;
      video.play().catch(() => {});
    }

    return () => {
      hls?.destroy();
    };
  }, [hlsUrl]);

  return (
    <video
      ref={videoRef}
      muted
      autoPlay
      playsInline
      className="w-full h-full object-cover bg-black"
    />
  );
}

function UrlRow({
  label,
  value,
  onCopy,
  canCopy,
  onReveal,
  flashing,
}: {
  label: string;
  value: string;
  onCopy: () => void;
  canCopy: boolean;
  /**
   * Если ключ скрыт — вместо кнопки Copy показываем "глаз": один клик раскроет
   * ключ, после чего на её месте появится Copy. Это убирает 2-этапный путь
   * "сначала жмёшь Показать наверху, потом возвращайся к URL'у".
   */
  onReveal?: () => void;
  flashing: boolean;
}) {
  const showReveal = !canCopy && !!onReveal;
  return (
    <div className="flex items-center gap-2 bg-surface-primary border border-zinc-800/60 rounded-lg px-2.5 py-1.5">
      <span className="shrink-0 text-[10px] font-semibold tracking-wider text-zinc-500 uppercase font-mono">
        {label}
      </span>
      {/* overflow-x-auto + whitespace-nowrap: текст не обрезается многоточием,
          можно выделить мышью и проскроллить вправо. Скрываем скроллбар, чтобы
          ряд не «прыгал» при появлении (Firefox: thin; WebKit: transparent track). */}
      <code
        className="flex-1 min-w-0 text-xs text-zinc-300 font-mono overflow-x-auto whitespace-nowrap select-text cursor-text"
        style={{ scrollbarWidth: 'thin' }}
      >
        {value || '—'}
      </code>
      {showReveal ? (
        <button
          onClick={onReveal}
          className="shrink-0 p-1 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-all active:scale-[0.95] cursor-pointer"
          title="Показать ключ, чтобы скопировать"
        >
          <Eye size={12} />
        </button>
      ) : (
        <button
          onClick={onCopy}
          disabled={!canCopy}
          className={`shrink-0 p-1 rounded-md transition-all active:scale-[0.95] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
            flashing
              ? 'bg-emerald-500/20 text-emerald-300'
              : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800'
          }`}
          title={canCopy ? 'Копировать' : 'Покажите ключ, чтобы скопировать'}
        >
          <Copy size={12} />
        </button>
      )}
    </div>
  );
}

function KeyControls({
  keyVisible,
  setKeyVisible,
  ingestKey,
  onRotate,
  rotating,
  onCopy,
  copiedFlash,
}: {
  keyVisible: boolean;
  setKeyVisible: (v: boolean) => void;
  ingestKey?: string;
  onRotate: () => void;
  rotating: boolean;
  onCopy: () => void;
  copiedFlash: string | null;
}) {
  return (
    <div className="bg-surface-elevated border border-zinc-800/60 rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
          Ingest key
        </span>
        <div className="flex items-center gap-1.5">
          {keyVisible && ingestKey && (
            <button
              onClick={onCopy}
              className={`flex items-center gap-1 px-2 py-1 text-xs rounded-md transition-all active:scale-[0.98] cursor-pointer ${
                copiedFlash === 'ingest-key'
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
              }`}
            >
              <Copy size={11} />
              {copiedFlash === 'ingest-key' ? 'Скопировано' : 'Копировать'}
            </button>
          )}
          <button
            onClick={() => setKeyVisible(!keyVisible)}
            className="flex items-center gap-1 px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs rounded-md transition-all active:scale-[0.98] cursor-pointer"
          >
            {keyVisible ? <EyeSlash size={11} /> : <Eye size={11} />}
            {keyVisible ? 'Скрыть' : 'Показать'}
          </button>
          <button
            onClick={onRotate}
            disabled={rotating}
            className="flex items-center gap-1 px-2 py-1 bg-brand hover:bg-brand-hover text-white text-xs rounded-md transition-all active:scale-[0.98] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ArrowsClockwise size={11} />
            {rotating ? '...' : 'Сменить'}
          </button>
        </div>
      </div>
      <code className="block px-2.5 py-1.5 bg-surface-primary border border-zinc-800/60 rounded-md font-mono text-xs text-zinc-300 break-all">
        {keyVisible ? ingestKey ?? '—' : maskedKey() + maskedKey()}
      </code>
    </div>
  );
}

function SharePanel({
  stream,
  status,
  shareWatchUrl,
  watchUrl,
  onToggleIsPublic,
  onCopy,
  onOpenQr,
  copiedFlash,
  activeCount,
  pending,
}: {
  stream: StreamDto;
  status: Status;
  shareWatchUrl: string;
  watchUrl: string;
  onToggleIsPublic: () => void;
  onCopy: () => void;
  onOpenQr: () => void;
  copiedFlash: string | null;
  activeCount: number;
  pending: boolean;
}) {
  const canGoPublic = activeCount > 0;
  const showWarning = stream.isPublic === false && activeCount > 0 && activeCount < stream.slotCount;

  const vkShare = shareWatchUrl
    ? `https://vk.com/share.php?url=${encodeURIComponent(shareWatchUrl)}&title=${encodeURIComponent(stream.name || 'Live')}`
    : '';
  const tgShare = shareWatchUrl
    ? `https://t.me/share/url?url=${encodeURIComponent(shareWatchUrl)}&text=${encodeURIComponent(stream.name || 'Live')}`
    : '';

  return (
    <section className="bg-surface-elevated border border-zinc-800/60 rounded-xl p-5">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Share size={16} className="text-brand" weight="fill" />
          <h2 className="text-sm font-medium text-zinc-200">Зрители</h2>
        </div>
        <StatusBadge status={status} />

        <button
          onClick={onToggleIsPublic}
          disabled={pending || !canGoPublic}
          className={`ml-auto flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-all active:scale-[0.98] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
            stream.isPublic
              ? 'bg-amber-500/20 text-amber-200 hover:bg-amber-500/30'
              : 'bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30'
          }`}
        >
          {stream.isPublic ? (
            <>
              <EyeSlash size={14} />
              Скрыть от зрителей
            </>
          ) : (
            <>
              <Eye size={14} />
              Открыть для зрителей
            </>
          )}
        </button>
      </div>

      {showWarning && (
        <p className="mt-3 text-xs text-amber-300/80 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
          Сейчас публикуют {activeCount} из {stream.slotCount} камер. Раскладка адаптируется автоматически.
        </p>
      )}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex-1 flex items-center gap-2 bg-surface-primary border border-zinc-800/60 rounded-lg px-3 py-2">
          <ShareNetwork size={14} className="text-zinc-500 shrink-0" />
          <code className="flex-1 min-w-0 text-sm text-zinc-200 font-mono truncate">
            {shareWatchUrl || '—'}
          </code>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={onCopy}
            disabled={!shareWatchUrl}
            className={`flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md transition-all active:scale-[0.98] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
              copiedFlash === 'watch-url'
                ? 'bg-emerald-500/20 text-emerald-300'
                : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
            }`}
          >
            <Copy size={12} />
            {copiedFlash === 'watch-url' ? 'Скопировано' : 'Копировать'}
          </button>
          <a
            href={watchUrl || '#'}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-zinc-100 text-xs rounded-md transition-all active:scale-[0.98] no-underline"
          >
            <ArrowSquareOut size={12} />
            Открыть
          </a>
          <a
            href={vkShare || '#'}
            target="_blank"
            rel="noreferrer"
            aria-label="Поделиться ВКонтакте"
            className="flex items-center justify-center w-8 h-8 rounded-md bg-zinc-800 hover:bg-[#0077FF]/20 text-zinc-300 hover:text-[#5C9EFF] transition-all active:scale-[0.95] no-underline text-xs font-bold"
            title="ВКонтакте"
          >
            VK
          </a>
          <a
            href={tgShare || '#'}
            target="_blank"
            rel="noreferrer"
            aria-label="Поделиться в Telegram"
            className="flex items-center justify-center w-8 h-8 rounded-md bg-zinc-800 hover:bg-[#229ED9]/20 text-zinc-300 hover:text-[#5EB3E4] transition-all active:scale-[0.95] no-underline"
            title="Telegram"
          >
            <TelegramLogo size={14} weight="fill" />
          </a>
          <button
            onClick={onOpenQr}
            disabled={!shareWatchUrl}
            className="flex items-center justify-center w-8 h-8 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-zinc-100 transition-all active:scale-[0.95] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            title="QR-код"
          >
            <QrCode size={14} />
          </button>
        </div>
      </div>
    </section>
  );
}

// ─── SetupGuide ─────────────────────────────────────────────────────────────
//
// Пошаговый помощник по вставке в vMix / OBS / ffmpeg. Слот выбирается
// отдельным селектором (камера = слот), потому что у каждой камеры свой
// `streamid` и свой URL. Параметры всегда видны (Hostname/Port/Stream ID),
// passphrase скрывается до клика «Показать», как и в SlotCard.
//
// Зачем здесь, а не как мини-гайд внутри SlotCard:
//  - аside 360px слишком узкий для пошагового how-to с 4-мя шагами;
//  - стример обычно копирует под ОДИН софт за раз — выбрал слот, потом текст;
//  - снимает пустое пространство под LayoutPicker'ом на широких экранах.

interface SetupGuideProps {
  serverIp: string;
  srtPort: string;
  rtmpPort: string;
  orgSlug: string;
  streamSlug: string;
  slots: StreamSlot[];
  ingestKey: string | undefined;
  keyVisible: boolean;
  onReveal: () => void;
  onCopy: (text: string, flashId: string) => void;
  copiedFlash: string | null;
}

function SetupGuide({
  serverIp,
  srtPort,
  rtmpPort,
  orgSlug,
  streamSlug,
  slots,
  ingestKey,
  keyVisible,
  onReveal,
  onCopy,
  copiedFlash,
}: SetupGuideProps) {
  const [protocol, setProtocol] = useState<'srt' | 'rtmp'>('srt');
  const [activeSlotIdx, setActiveSlotIdx] = useState<number>(slots[0]?.index ?? 1);

  const slot = useMemo(
    () => slots.find((s) => s.index === activeSlotIdx) ?? slots[0],
    [slots, activeSlotIdx],
  );

  // Куски URL. Передаём в гайды по отдельности (поле «Server», поле «Stream ID»)
  // и склеиваем в одну полную ссылку — vMix-style и OBS-style разные.
  const streamPath = streamSlug ? `${orgSlug}/${streamSlug}` : orgSlug;
  const streamId = slot ? `publish:live/${streamPath}/${slot.index}` : '';
  const passDisplay = ingestKey && keyVisible ? ingestKey : '••••••••••••';
  const passForCopy = ingestKey ?? '';

  const srtFullUrl =
    serverIp && ingestKey && slot
      ? `srt://${serverIp}:${srtPort}?streamid=${streamId}&passphrase=${ingestKey}`
      : '';
  const rtmpServer = serverIp ? `rtmp://${serverIp}:${rtmpPort}/live` : '';
  const rtmpKey =
    slot && ingestKey ? `${streamPath}/${slot.index}?key=${ingestKey}` : '';
  const rtmpFullUrl =
    serverIp && ingestKey && slot
      ? `rtmp://${serverIp}:${rtmpPort}/live/${streamPath}/${slot.index}?key=${ingestKey}`
      : '';

  // ffmpeg-команда для SRT (одна камера). Для RTMP конструкция аналогичная,
  // но vMix/OBS обычно — два самых популярных варианта, поэтому ffmpeg
  // оставим только в SRT-режиме как «for power users».
  const ffmpegSrt =
    srtFullUrl
      ? `ffmpeg -re -i input.mp4 -c:v libx264 -preset veryfast -b:v 6M -c:a aac -f mpegts "${srtFullUrl}"`
      : '';

  const slotLabel = (s: StreamSlot) =>
    s.name?.trim() ? `Слот ${s.index} · ${s.name.trim()}` : `Слот ${s.index}`;

  return (
    <section className="bg-surface-elevated border border-zinc-800/60 rounded-xl p-5">
      <div className="flex items-center gap-2 mb-1">
        <Info size={16} className="text-brand" weight="fill" />
        <h2 className="text-sm font-medium text-zinc-200">Как подключить камеру</h2>
      </div>
      <p className="text-xs text-zinc-500 mb-4">
        У каждой камеры свой <span className="text-zinc-300 font-mono">streamid</span> — выберите
        слот ниже и скопируйте параметры под нужный софт.
      </p>

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

      {/* Slot selector — только если больше одной камеры */}
      {slots.length > 1 && (
        <div className="mb-4">
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
            Камера
          </label>
          <div className="flex gap-1.5 flex-wrap">
            {slots.map((s) => {
              const active = s.index === activeSlotIdx;
              return (
                <button
                  key={s.index}
                  onClick={() => setActiveSlotIdx(s.index)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all active:scale-[0.98] cursor-pointer ${
                    active
                      ? 'bg-brand text-white shadow-sm shadow-brand/20'
                      : 'bg-zinc-800/60 hover:bg-zinc-800 text-zinc-300 hover:text-zinc-100'
                  }`}
                >
                  {slotLabel(s)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Параметры подключения (Сервер / Порт / Stream ID / Passphrase) */}
      <div className="flex flex-col">
        <SetupRow
          label="Сервер"
          value={serverIp || ''}
          placeholder="Задайте NEXT_PUBLIC_SERVER_IP"
          onCopy={() => onCopy(serverIp, 'guide-server')}
          flashing={copiedFlash === 'guide-server'}
        />
        <SetupRow
          label="Порт"
          value={protocol === 'srt' ? srtPort : rtmpPort}
          onCopy={() =>
            onCopy(protocol === 'srt' ? srtPort : rtmpPort, 'guide-port')
          }
          flashing={copiedFlash === 'guide-port'}
        />
        {protocol === 'srt' ? (
          <SetupRow
            label="Stream ID"
            value={streamId}
            mono
            onCopy={() => onCopy(streamId, 'guide-streamid')}
            flashing={copiedFlash === 'guide-streamid'}
            hint={`Каждая камера — свой ID. Текущий = камера ${slot?.index ?? 1}.`}
          />
        ) : (
          <SetupRow
            label="Ключ потока"
            value={rtmpKey || ''}
            mono
            obscured={!keyVisible}
            obscuredText={`${streamPath}/${slot?.index ?? 1}?key=••••••••••••`}
            onCopy={() => onCopy(rtmpKey, 'guide-rtmpkey')}
            onReveal={onReveal}
            flashing={copiedFlash === 'guide-rtmpkey'}
            hint="Включает в себя путь камеры и passphrase — одной строкой."
          />
        )}
        <SetupRow
          label={protocol === 'srt' ? 'Passphrase' : 'Пароль'}
          value={passForCopy}
          mono
          obscured={!keyVisible}
          obscuredText={passDisplay}
          onCopy={() => onCopy(passForCopy, 'guide-pass')}
          onReveal={onReveal}
          flashing={copiedFlash === 'guide-pass'}
        />
      </div>

      {/* Setup guides — раскрывающиеся блоки */}
      <div className="mt-5 pt-5 border-t border-zinc-800/40 space-y-2">
        <GuideDetails title="Настройка OBS Studio">
          {protocol === 'srt' ? (
            <>
              <GuideStep n={1}>
                Откройте <em className="text-zinc-200 not-italic">Настройки → Трансляция</em>,
                служба: <em className="text-zinc-200 not-italic">Настраиваемая</em>
              </GuideStep>
              <GuideStep n={2}>
                <p className="text-sm text-zinc-400 mb-1.5">
                  В поле <em className="text-zinc-200 not-italic">«Сервер»</em> вставьте полную
                  ссылку:
                </p>
                <FullUrlBlock
                  value={srtFullUrl}
                  fallback={`srt://${serverIp || 'IP'}:${srtPort}?streamid=${streamId || 'publish:live/.../N'}&passphrase=••••••••`}
                  canCopy={!!srtFullUrl && keyVisible}
                  onReveal={onReveal}
                  onCopy={() => onCopy(srtFullUrl, 'guide-obs-srt-full')}
                  flashing={copiedFlash === 'guide-obs-srt-full'}
                />
              </GuideStep>
              <GuideStep n={3}>
                Поле <em className="text-zinc-200 not-italic">«Ключ потока»</em> оставьте пустым
              </GuideStep>
              <GuideStep n={4}>
                Нажмите <em className="text-zinc-200 not-italic">«Начать трансляцию»</em>
              </GuideStep>
            </>
          ) : (
            <>
              <GuideStep n={1}>
                Откройте <em className="text-zinc-200 not-italic">Настройки → Трансляция</em>,
                служба: <em className="text-zinc-200 not-italic">Настраиваемая</em>
              </GuideStep>
              <GuideStep n={2}>
                <p className="text-sm text-zinc-400 mb-1.5">
                  В поле <em className="text-zinc-200 not-italic">«Сервер»</em> вставьте:
                </p>
                <FullUrlBlock
                  value={rtmpServer}
                  fallback={`rtmp://${serverIp || 'IP'}:${rtmpPort}/live`}
                  canCopy={!!rtmpServer}
                  onCopy={() => onCopy(rtmpServer, 'guide-obs-rtmp-server')}
                  flashing={copiedFlash === 'guide-obs-rtmp-server'}
                />
              </GuideStep>
              <GuideStep n={3}>
                <p className="text-sm text-zinc-400 mb-1.5">
                  В поле <em className="text-zinc-200 not-italic">«Ключ потока»</em> вставьте:
                </p>
                <FullUrlBlock
                  value={rtmpKey}
                  fallback={`${streamPath}/${slot?.index ?? 1}?key=••••••••`}
                  canCopy={!!rtmpKey && keyVisible}
                  onReveal={onReveal}
                  onCopy={() => onCopy(rtmpKey, 'guide-obs-rtmp-key')}
                  flashing={copiedFlash === 'guide-obs-rtmp-key'}
                />
              </GuideStep>
              <GuideStep n={4}>
                Нажмите <em className="text-zinc-200 not-italic">«Начать трансляцию»</em>
              </GuideStep>
            </>
          )}
        </GuideDetails>

        <GuideDetails title="Настройка vMix">
          {protocol === 'srt' ? (
            <>
              <GuideStep n={1}>
                <em className="text-zinc-200 not-italic">Settings → Outputs / NDI / SRT</em>, нажмите{' '}
                <em className="text-zinc-200 not-italic">+ Add</em>
              </GuideStep>
              <GuideStep n={2}>
                Тип: <em className="text-zinc-200 not-italic">SRT Caller</em>
              </GuideStep>
              <GuideStep n={3}>
                <p className="text-sm text-zinc-400 mb-1.5">Заполните поля:</p>
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  <span className="text-zinc-500">Hostname:</span>
                  <span className="text-zinc-200 font-mono break-all">
                    {serverIp || 'IP сервера'}
                  </span>
                  <span className="text-zinc-500">Port:</span>
                  <span className="text-zinc-200 font-mono">{srtPort}</span>
                  <span className="text-zinc-500">Stream ID:</span>
                  <span className="text-zinc-200 font-mono break-all">{streamId}</span>
                  <span className="text-zinc-500">Passphrase:</span>
                  <span className="text-zinc-200 font-mono">{passDisplay}</span>
                  <span className="text-zinc-500">Latency:</span>
                  <span className="text-zinc-200 font-mono">200</span>
                </div>
              </GuideStep>
            </>
          ) : (
            <>
              <GuideStep n={1}>
                <em className="text-zinc-200 not-italic">Settings → Outputs / Streaming</em>,
                нажмите <em className="text-zinc-200 not-italic">+ Add</em>
              </GuideStep>
              <GuideStep n={2}>
                Тип: <em className="text-zinc-200 not-italic">RTMP Server</em>
              </GuideStep>
              <GuideStep n={3}>
                <p className="text-sm text-zinc-400 mb-1.5">
                  В поле <em className="text-zinc-200 not-italic">URL</em> вставьте полную ссылку:
                </p>
                <FullUrlBlock
                  value={rtmpFullUrl}
                  fallback={`rtmp://${serverIp || 'IP'}:${rtmpPort}/live/${streamPath}/${slot?.index ?? 1}?key=••••••••`}
                  canCopy={!!rtmpFullUrl && keyVisible}
                  onReveal={onReveal}
                  onCopy={() => onCopy(rtmpFullUrl, 'guide-vmix-rtmp-full')}
                  flashing={copiedFlash === 'guide-vmix-rtmp-full'}
                />
              </GuideStep>
              <GuideStep n={4}>
                Поле <em className="text-zinc-200 not-italic">Stream Key</em> оставьте пустым
              </GuideStep>
            </>
          )}
        </GuideDetails>

        {protocol === 'srt' && (
          <GuideDetails title="ffmpeg (для опытных)">
            <p className="text-sm text-zinc-400 mb-2">
              Подходит для тест-публикации с файла или web-камеры на Linux/Mac:
            </p>
            <FullUrlBlock
              value={ffmpegSrt}
              fallback={'ffmpeg -re -i input.mp4 ... -f mpegts "srt://..."'}
              canCopy={!!ffmpegSrt && keyVisible}
              onReveal={onReveal}
              onCopy={() => onCopy(ffmpegSrt, 'guide-ffmpeg')}
              flashing={copiedFlash === 'guide-ffmpeg'}
            />
            <p className="text-xs text-zinc-500 mt-2">
              Замените <span className="font-mono">input.mp4</span> на свой источник
              (для web-камеры — <span className="font-mono">-f v4l2 -i /dev/video0</span>).
            </p>
          </GuideDetails>
        )}
      </div>
    </section>
  );
}

function SetupRow({
  label,
  value,
  placeholder,
  mono,
  obscured,
  obscuredText,
  onCopy,
  onReveal,
  flashing,
  hint,
}: {
  label: string;
  value: string;
  placeholder?: string;
  mono?: boolean;
  obscured?: boolean;
  obscuredText?: string;
  onCopy: () => void;
  onReveal?: () => void;
  flashing: boolean;
  hint?: string;
}) {
  const showReveal = !!obscured && !!onReveal;
  const display = obscured ? obscuredText ?? '••••' : value || placeholder || '—';
  const canCopy = !obscured && !!value;
  return (
    <div className="border-b border-zinc-800/40 last:border-b-0">
      <div className="flex items-center py-2.5 gap-3">
        <span className="w-24 sm:w-28 shrink-0 text-xs text-zinc-500">{label}</span>
        <code
          className={`flex-1 min-w-0 text-sm overflow-x-auto whitespace-nowrap select-text cursor-text ${
            mono === false ? '' : 'font-mono'
          } ${value || (!obscured && !!value) ? 'text-zinc-200' : 'text-zinc-500'}`}
          style={{ scrollbarWidth: 'thin' }}
        >
          {display}
        </code>
        {showReveal ? (
          <button
            onClick={onReveal}
            className="shrink-0 flex items-center gap-1 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs rounded-md transition-all active:scale-[0.98] cursor-pointer"
            title="Показать ключ, чтобы скопировать"
          >
            <Eye size={12} /> Показать
          </button>
        ) : (
          <button
            onClick={onCopy}
            disabled={!canCopy}
            className={`shrink-0 flex items-center gap-1 px-2.5 py-1 text-xs rounded-md transition-all active:scale-[0.98] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
              flashing
                ? 'bg-emerald-500/20 text-emerald-300'
                : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Copy size={12} />
            {flashing ? 'Скопировано' : 'Копировать'}
          </button>
        )}
      </div>
      {hint && <p className="-mt-1.5 mb-2.5 text-[11px] text-zinc-600 pl-[6.5rem]">{hint}</p>}
    </div>
  );
}

function GuideDetails({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group bg-surface-primary rounded-xl border border-zinc-800/40 overflow-hidden">
      <summary className="flex items-center gap-2.5 cursor-pointer text-sm font-medium text-zinc-300 hover:text-zinc-100 transition-colors px-4 py-3 [&::-webkit-details-marker]:hidden list-none select-none">
        <CaretDown
          size={14}
          className="text-zinc-500 transition-transform -rotate-90 group-open:rotate-0"
        />
        {title}
      </summary>
      <div className="px-4 pb-4 space-y-3">{children}</div>
    </details>
  );
}

function GuideStep({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="shrink-0 w-6 h-6 rounded-full bg-zinc-800 text-zinc-400 text-xs flex items-center justify-center mt-0.5">
        {n}
      </span>
      <div className="flex-1 min-w-0 text-sm text-zinc-400">{children}</div>
    </div>
  );
}

function FullUrlBlock({
  value,
  fallback,
  canCopy,
  onReveal,
  onCopy,
  flashing,
}: {
  value: string;
  fallback: string;
  canCopy: boolean;
  onReveal?: () => void;
  onCopy: () => void;
  flashing: boolean;
}) {
  const display = canCopy ? value : fallback;
  return (
    <div className="flex items-center gap-2 bg-zinc-900 rounded-lg px-3 py-2 border border-zinc-800">
      <code
        className="flex-1 min-w-0 text-sm text-zinc-200 font-mono overflow-x-auto whitespace-nowrap select-text cursor-text"
        style={{ scrollbarWidth: 'thin' }}
      >
        {display}
      </code>
      {!canCopy && onReveal ? (
        <button
          onClick={onReveal}
          className="shrink-0 p-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 rounded-md transition-all active:scale-[0.95] cursor-pointer"
          title="Показать ключ"
        >
          <Eye size={14} />
        </button>
      ) : (
        <button
          onClick={onCopy}
          disabled={!canCopy}
          className={`shrink-0 p-1.5 rounded-md transition-all active:scale-[0.95] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
            flashing
              ? 'bg-emerald-500/20 text-emerald-300'
              : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200'
          }`}
          title="Копировать"
        >
          <Copy size={14} />
        </button>
      )}
    </div>
  );
}

// ─── Modals ─────────────────────────────────────────────────────────────────

function StopModal({
  onClose,
  onConfirm,
  pending,
}: {
  onClose: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <ModalShell title="Остановить трансляцию" onClose={onClose} icon={<Stop size={16} weight="fill" />}>
      <p className="text-sm text-zinc-400">
        Будет принудительно завершён активный Broadcast. Push с vMix/OBS при этом не прерывается — если он продолжит публиковать, через несколько секунд запустится новый Broadcast.
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <button
          onClick={onClose}
          className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm rounded-lg transition-all active:scale-[0.98] cursor-pointer"
        >
          Отмена
        </button>
        <button
          onClick={onConfirm}
          disabled={pending}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-200 text-sm rounded-lg transition-all active:scale-[0.98] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Power size={14} weight="fill" />
          {pending ? 'Останавливаем...' : 'Остановить'}
        </button>
      </div>
    </ModalShell>
  );
}

function QrModal({ url, onClose }: { url: string; onClose: () => void }) {
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(url)}&size=300x300&margin=4&bgcolor=ffffff&color=0c0c0e`;
  return (
    <ModalShell title="QR-код ссылки" onClose={onClose} icon={<QrCode size={16} />}>
      <div className="flex flex-col items-center gap-3">
        <img
          src={qrSrc}
          alt="QR"
          className="w-[260px] h-[260px] rounded-lg bg-white p-3"
        />
        <code className="text-xs text-zinc-400 font-mono break-all max-w-full text-center">
          {url}
        </code>
      </div>
    </ModalShell>
  );
}

interface SettingsForm {
  name: string;
  description: string;
  slotCount: number;
  layoutPreset: string;
  autoStartMode: 'public' | 'test';
  slots: StreamSlot[];
}

function SettingsModal({
  stream,
  onClose,
  onSubmit,
  pending,
}: {
  stream: StreamDto;
  onClose: () => void;
  onSubmit: (payload: {
    name?: string;
    description?: string;
    slotCount?: number;
    layoutPreset?: string;
    autoStartMode?: 'public' | 'test';
    slots?: StreamSlot[];
    slotOrder?: number[];
  }) => void;
  pending: boolean;
}) {
  const initialSlots = useMemo(() => {
    const m = new Map<number, StreamSlot>();
    for (const s of stream.slots ?? []) {
      if (s && typeof s.index === 'number') m.set(s.index, s);
    }
    const out: StreamSlot[] = [];
    for (let i = 1; i <= stream.slotCount; i++) {
      out.push(m.get(i) ?? { index: i, name: '' });
    }
    return out;
  }, [stream]);

  const [form, setForm] = useState<SettingsForm>({
    name: stream.name ?? '',
    description: stream.description ?? '',
    slotCount: stream.slotCount,
    layoutPreset: stream.layoutPreset,
    autoStartMode: stream.autoStartMode,
    slots: initialSlots,
  });

  // When slotCount changes, normalize slots length and pick a default layout
  // valid for the new count.
  const onChangeSlotCount = (newCount: number) => {
    const clamped = Math.max(1, Math.min(4, Math.round(newCount)));
    setForm((prev) => {
      // Rebuild slots up to clamped length.
      const map = new Map<number, StreamSlot>();
      for (const s of prev.slots) map.set(s.index, s);
      const slots: StreamSlot[] = [];
      let audioAssigned = false;
      for (let i = 1; i <= clamped; i++) {
        const existing = map.get(i) ?? { index: i, name: '' };
        if (existing.isAudioSource) audioAssigned = true;
        slots.push({ ...existing, index: i });
      }
      if (!audioAssigned && slots.length > 0) {
        slots[0] = { ...slots[0], isAudioSource: true };
      }
      const presetForCount = LAYOUT_PRESETS[prev.layoutPreset]?.slotCount === clamped
        ? prev.layoutPreset
        : (DEFAULT_LAYOUT_BY_COUNT[clamped] ?? prev.layoutPreset);
      return {
        ...prev,
        slotCount: clamped,
        layoutPreset: presetForCount,
        slots,
      };
    });
  };

  const layoutChoices = useMemo(
    () => Object.values(LAYOUT_PRESETS).filter((p) => p.slotCount === form.slotCount),
    [form.slotCount],
  );

  const updateSlotName = (idx: number, name: string) => {
    setForm((prev) => ({
      ...prev,
      slots: prev.slots.map((s) => (s.index === idx ? { ...s, name } : s)),
    }));
  };

  const handleSubmit = () => {
    const payload: Parameters<typeof onSubmit>[0] = {};
    if (form.name !== (stream.name ?? '')) payload.name = form.name;
    if (form.description !== (stream.description ?? '')) {
      payload.description = form.description || undefined;
    }
    if (form.slotCount !== stream.slotCount) {
      payload.slotCount = form.slotCount;
      // When slotCount changes we MUST also send slots + slotOrder + layout
      // because backend validates length=slotCount.
      payload.slots = form.slots;
      payload.slotOrder = Array.from({ length: form.slotCount }, (_v, i) => i + 1);
      payload.layoutPreset = form.layoutPreset;
    } else {
      // Slot count unchanged — send slots only if names actually changed.
      const namesChanged = form.slots.some((s, i) => {
        const orig = stream.slots?.[i];
        return (s.name ?? '') !== (orig?.name ?? '');
      });
      if (namesChanged) payload.slots = form.slots;
      if (form.layoutPreset !== stream.layoutPreset) {
        payload.layoutPreset = form.layoutPreset;
      }
    }
    if (form.autoStartMode !== stream.autoStartMode) {
      payload.autoStartMode = form.autoStartMode;
    }
    onSubmit(payload);
  };

  return (
    <ModalShell
      title="Настройки Stream'а"
      onClose={onClose}
      icon={<Gear size={16} />}
      maxWidth="max-w-[560px]"
    >
      <div className="space-y-4">
        {/* Name */}
        <FormField label="Название">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full px-3 py-2 bg-surface-primary border border-zinc-700 rounded-lg text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-brand focus:ring-1 focus:ring-brand/30 outline-none transition-colors"
            placeholder="Например, Корт 1 — финал"
          />
        </FormField>

        {/* Description */}
        <FormField label="Описание">
          <textarea
            value={form.description}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
              setForm({ ...form, description: e.target.value })
            }
            rows={2}
            className="w-full px-3 py-2 bg-surface-primary border border-zinc-700 rounded-lg text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-brand focus:ring-1 focus:ring-brand/30 outline-none transition-colors resize-y min-h-[60px]"
            placeholder="Необязательно"
          />
        </FormField>

        {/* Slot count */}
        <FormField label="Число камер">
          <div className="flex gap-1 bg-surface-primary rounded-lg p-1 border border-zinc-800/60">
            {[1, 2, 3, 4].map((n) => {
              const active = form.slotCount === n;
              return (
                <button
                  key={n}
                  onClick={() => onChangeSlotCount(n)}
                  className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-all cursor-pointer ${
                    active ? 'bg-brand text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {n}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-zinc-500 mt-1">
            Изменение пересоздаст ingest-пути в MediaMTX. Текущая публикация будет прервана.
          </p>
        </FormField>

        {/* Layout preset */}
        <FormField label="Раскладка по умолчанию">
          <select
            value={form.layoutPreset}
            onChange={(e) => setForm({ ...form, layoutPreset: e.target.value })}
            className="w-full px-3 py-2 bg-surface-primary border border-zinc-700 rounded-lg text-sm text-zinc-200 focus:border-brand focus:ring-1 focus:ring-brand/30 outline-none transition-colors cursor-pointer"
          >
            {layoutChoices.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </FormField>

        {/* Slot names */}
        <FormField label="Имена камер">
          <div className="flex flex-col gap-2">
            {form.slots.map((s) => (
              <div
                key={s.index}
                className="flex items-center gap-2 bg-surface-primary border border-zinc-800/60 rounded-lg px-3 py-2"
              >
                <span className="shrink-0 w-6 h-6 rounded-full text-xs font-semibold flex items-center justify-center font-mono bg-zinc-800 text-zinc-400 border border-zinc-700">
                  {s.index}
                </span>
                <input
                  value={s.name ?? ''}
                  onChange={(e) => updateSlotName(s.index, e.target.value)}
                  className="flex-1 bg-transparent text-sm text-zinc-200 outline-none placeholder:text-zinc-600"
                  placeholder={`Камера ${s.index}`}
                  maxLength={48}
                />
              </div>
            ))}
          </div>
        </FormField>

        {/* autoStartMode */}
        <FormField label="При старте публикации">
          <div className="flex gap-1 bg-surface-primary rounded-lg p-1 border border-zinc-800/60">
            <button
              onClick={() => setForm({ ...form, autoStartMode: 'public' })}
              className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-all cursor-pointer ${
                form.autoStartMode === 'public'
                  ? 'bg-brand text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Сразу PUBLIC
            </button>
            <button
              onClick={() => setForm({ ...form, autoStartMode: 'test' })}
              className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-all cursor-pointer ${
                form.autoStartMode === 'test'
                  ? 'bg-brand text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              В TEST (скрыто)
            </button>
          </div>
          <p className="text-xs text-zinc-500 mt-1">
            «TEST» — стрим начинается невидимым для зрителей, открывается вручную кнопкой «Открыть для зрителей».
          </p>
        </FormField>
      </div>

      <div className="mt-6 flex justify-end gap-2 pt-4 border-t border-zinc-800/60">
        <button
          onClick={onClose}
          className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm rounded-lg transition-all active:scale-[0.98] cursor-pointer"
        >
          Отмена
        </button>
        <button
          onClick={handleSubmit}
          disabled={pending}
          className="px-3 py-1.5 bg-brand hover:bg-brand-hover text-white text-sm font-medium rounded-lg transition-all active:scale-[0.98] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? 'Сохранение...' : 'Сохранить'}
        </button>
      </div>
    </ModalShell>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
        {label}
      </label>
      {children}
    </div>
  );
}

function ModalShell({
  title,
  onClose,
  icon,
  children,
  maxWidth = 'max-w-[420px]',
}: {
  title: string;
  onClose: () => void;
  icon?: React.ReactNode;
  children: React.ReactNode;
  maxWidth?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={`w-full ${maxWidth} bg-surface-elevated border border-zinc-800/80 rounded-xl shadow-2xl shadow-black/60 overflow-hidden max-h-[90vh] flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800/60 shrink-0">
          <div className="flex items-center gap-2 text-zinc-100">
            {icon}
            <span className="text-sm font-medium">{title}</span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-all cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

