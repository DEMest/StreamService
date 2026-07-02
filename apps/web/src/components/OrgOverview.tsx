'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Header } from '@/components/Header';
import { OrgCanvasPlayer, type CanvasTile } from '@/components/OrgCanvasPlayer';
import { Play, TelevisionSimple, VideoCamera } from '@phosphor-icons/react';

interface OrgOverviewStream {
  streamSlug: string;
  streamName: string;
  isLive: boolean;
  previewMode: string;
  hasCustomPreview: boolean;
}

interface OrgOverviewDto {
  orgSlug: string;
  orgName: string;
  orgDescription: string | null;
  streams: OrgOverviewStream[];
}

interface StreamUrlDto {
  hlsUrl: string;
  feedMode: 'single' | 'composite';
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';

export function OrgOverview({ orgSlug }: { orgSlug: string }) {
  const [canvasMode, setCanvasMode] = useState(false);

  const { data: org, isLoading } = useQuery({
    queryKey: ['org-overview', orgSlug],
    queryFn: () => api.get<OrgOverviewDto>(`/v1/public/orgs/${orgSlug}`),
    refetchInterval: 15_000,
  });

  const liveStreams = (org?.streams ?? []).filter((s) => s.isLive);

  // Fetch hlsUrl for each live stream only when canvas mode is on.
  //
  // Promise.allSettled (не Promise.all) — намеренно: если ОДИН стрим успел
  // уйти в офлайн между опросом каталога (liveStreams выше) и этим запросом
  // (гонка, интервалы poll'ов разные — 15s vs 10s), его getStreamUrl() кинет
  // 404. Promise.all уронил бы ВЕСЬ батч и скрыл холст целиком у зрителя,
  // хотя остальные камеры живы — просто отфильтровываем неудачный стрим.
  const { data: canvasTiles } = useQuery({
    queryKey: ['org-canvas-tiles', orgSlug, liveStreams.map((s) => s.streamSlug).join(',')],
    queryFn: async () => {
      const results = await Promise.allSettled(
        liveStreams.map(async (s) => {
          const info = await api.get<StreamUrlDto>(`/v1/public/orgs/${orgSlug}/streams/${s.streamSlug}/stream`);
          return { streamSlug: s.streamSlug, streamName: s.streamName, hlsUrl: info.hlsUrl } as CanvasTile;
        }),
      );
      return results
        .filter((r): r is PromiseFulfilledResult<CanvasTile> => r.status === 'fulfilled')
        .map((r) => r.value);
    },
    enabled: canvasMode && liveStreams.length >= 2,
    refetchInterval: 10_000,
  });

  return (
    <div className="min-h-[100dvh] bg-surface-primary text-zinc-200">
      <Header />
      <main className="max-w-[1100px] mx-auto px-6 py-8">
        <h1 className="text-xl font-semibold text-zinc-50 tracking-tight mb-1">{org?.orgName ?? orgSlug}</h1>
        {org?.orgDescription && <p className="text-zinc-500 text-sm mb-6">{org.orgDescription}</p>}

        {isLoading && <div className="text-zinc-500 text-sm py-12 text-center">Загрузка...</div>}

        {!isLoading && (org?.streams.length ?? 0) === 0 && (
          <div className="flex flex-col items-center justify-center py-24 gap-3 opacity-50">
            <TelevisionSimple size={48} className="text-zinc-700" weight="thin" />
            <p className="text-zinc-500 text-sm">У организации пока нет трансляций</p>
          </div>
        )}

        {liveStreams.length >= 2 && (
          <div className="mb-6">
            <button
              onClick={() => setCanvasMode((v) => !v)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-brand hover:bg-brand-hover text-white text-sm font-medium rounded-lg transition-all active:scale-[0.98] cursor-pointer"
            >
              <Play size={16} weight="fill" />
              {canvasMode ? 'Скрыть общий вид' : `Смотреть все вместе (${liveStreams.length} лайв)`}
            </button>
          </div>
        )}

        {canvasMode && canvasTiles && canvasTiles.length >= 2 && (
          <div className="mb-8">
            <OrgCanvasPlayer tiles={canvasTiles} />
          </div>
        )}

        {(org?.streams.length ?? 0) > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {org!.streams.map((s) => {
              const thumbUrl = s.isLive || s.hasCustomPreview
                ? `${API_BASE}/v1/public/orgs/${orgSlug}/streams/${s.streamSlug}/thumbnail`
                : null;
              return (
                <Link
                  key={s.streamSlug}
                  href={`/watch/${orgSlug}/${s.streamSlug}`}
                  className="no-underline group"
                >
                  <article className={`rounded-xl overflow-hidden border transition-all duration-200 active:scale-[0.99] ${
                    s.isLive
                      ? 'bg-surface-elevated border-brand/20 hover:border-brand/40'
                      : 'bg-surface-elevated border-zinc-800/50 hover:border-zinc-700'
                  }`}>
                    <div className="relative aspect-video bg-zinc-900 overflow-hidden">
                      {thumbUrl ? (
                        <img src={thumbUrl} alt={s.streamName} className="absolute inset-0 w-full h-full object-cover" />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <VideoCamera size={40} className="text-zinc-800" weight="thin" />
                        </div>
                      )}
                      {s.isLive && (
                        <span className="absolute top-3 left-3 inline-flex items-center gap-1.5 px-2 py-0.5 bg-brand text-white text-[0.65rem] font-bold uppercase tracking-wider rounded-md">
                          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> Live
                        </span>
                      )}
                    </div>
                    <div className="p-4">
                      <p className="font-semibold text-sm text-zinc-100 group-hover:text-white transition-colors truncate">
                        {s.streamName || s.streamSlug}
                      </p>
                    </div>
                  </article>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
