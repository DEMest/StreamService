'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Header } from '@/components/Header';
import { OrgCanvasPlayer, type CanvasTile } from '@/components/OrgCanvasPlayer';
import { OrgAvatar } from '@/components/OrgAvatar';
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
  hasImage: boolean;
  streams: OrgOverviewStream[];
}

interface StreamUrlDto {
  hlsUrl: string;
  feedMode: 'single' | 'composite';
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';

export function OrgOverview({ orgSlug, archiveMode = false }: { orgSlug: string; archiveMode?: boolean }) {
  const [canvasMode, setCanvasMode] = useState(false);

  const { data: org, isLoading } = useQuery({
    queryKey: ['org-overview', orgSlug],
    queryFn: () => api.get<OrgOverviewDto>(`/v1/public/orgs/${orgSlug}`),
    refetchInterval: 15_000,
  });

  const liveStreams = (org?.streams ?? []).filter((s) => s.isLive);

  // Fetch hlsUrl for each live stream only when canvas mode is on.
  //
  // Своего таймера у батча нет намеренно: адреса плейлистов детерминированы, и
  // пока состав живых стримов не изменился, повтор вернул бы ровно то же самое.
  // Обновляется он от данных — список слагов входит в queryKey, поэтому
  // 15-секундный опрос `org-overview` выше, заметив новый или погасший стрим,
  // сам меняет ключ и react-query тянет плитки заново.
  //
  // Promise.allSettled (не Promise.all) — намеренно: если ОДИН стрим успел
  // уйти в офлайн между опросом каталога (liveStreams выше) и этим запросом,
  // его getStreamUrl() кинет 404. Promise.all уронил бы ВЕСЬ батч и скрыл холст
  // целиком у зрителя, хотя остальные камеры живы — просто отфильтровываем
  // неудачный стрим. Ушедший в офлайн стрим следующий опрос `org-overview`
  // уберёт из liveStreams, ключ сменится, и батч пересоберётся уже без него.
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
    enabled: !archiveMode && canvasMode && liveStreams.length >= 2,
  });

  return (
    <div className="min-h-[100dvh] bg-surface-primary text-zinc-200">
      <Header />
      <main className="max-w-[1100px] mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-1">
          <OrgAvatar
            orgSlug={orgSlug}
            orgName={org?.orgName}
            hasImage={org?.hasImage}
            size={44}
            live={!archiveMode && liveStreams.length > 0}
          />
          <h1 className="text-xl font-semibold text-zinc-50 tracking-tight">
            {archiveMode ? `Архив · ${org?.orgName ?? orgSlug}` : (org?.orgName ?? orgSlug)}
          </h1>
        </div>
        {archiveMode && <p className="text-zinc-500 text-sm mb-3">Записи прошедших трансляций</p>}
        {org?.orgDescription && <p className="text-zinc-500 text-sm mb-6">{org.orgDescription}</p>}

        {isLoading && <div className="text-zinc-500 text-sm py-12 text-center">Загрузка...</div>}

        {!isLoading && (org?.streams.length ?? 0) === 0 && (
          <div className="flex flex-col items-center justify-center py-24 gap-3 opacity-50">
            <TelevisionSimple size={48} className="text-zinc-700" weight="thin" />
            <p className="text-zinc-500 text-sm">У организации пока нет трансляций</p>
          </div>
        )}

        {!archiveMode && liveStreams.length >= 2 && (
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

        {!archiveMode && canvasMode && canvasTiles && canvasTiles.length >= 2 && (
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
              // Дефолтный Stream орги (streamSlug='') — отдельный роут-сосед без
              // сегмента streamSlug (пустой URL-сегмент между двумя `/` не
              // матчится Express'ом на бэкенде); см. ArchiveView.tsx.
              const archiveHref = s.streamSlug === ''
                ? `/watch/${orgSlug}/archive`
                : `/watch/${orgSlug}/${s.streamSlug}/archive`;
              return (
                <Link
                  key={s.streamSlug}
                  href={archiveMode ? archiveHref : `/watch/${orgSlug}/${s.streamSlug}`}
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
