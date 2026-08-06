'use client';

import { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CornersOut, GridFour, VideoCamera, CircleNotch } from '@phosphor-icons/react';

type CamId = 'cam1' | 'cam2' | 'cam3' | 'cam4';
type ViewMode = 'multicam' | CamId;

const CAMERAS: { id: CamId; label: string; shortLabel: string; col: number; row: number }[] = [
  { id: 'cam1', label: 'Камера 1', shortLabel: '1', col: 0, row: 0 },
  { id: 'cam2', label: 'Камера 2', shortLabel: '2', col: 1, row: 0 },
  { id: 'cam3', label: 'Камера 3', shortLabel: '3', col: 0, row: 1 },
  { id: 'cam4', label: 'Камера 4', shortLabel: '4', col: 1, row: 1 },
];

/*
 * Демо-ролик (~97 МБ) лежит в объектном хранилище, а не в git и не в
 * apps/web/public — иначе он попадает в образ и раздувает репозиторий.
 * Прод: публичный бакет MinIO за edge-nginx (location /static/, см.
 * infra/deploy/nginx-streamservice.conf) — стабильный URL с immutable-кэшем.
 *
 * NEXT_PUBLIC_* инлайнится на build-time, поэтому после смены значения нужен
 * `docker compose build web`, а не просто restart.
 *
 * Переменная не задана — это НЕ поломка лендинга: блок рендерится статичной
 * заглушкой (см. hasVideo ниже), интерактив с квадрантами продолжает работать.
 */
const DEMO_VIDEO_URL = process.env.NEXT_PUBLIC_DEMO_VIDEO_URL ?? '';

/*
 * translate 51% (вместо 50%) сдвигает центральную границу видео
 * на ~5px за край контейнера, скрывая стык между камерами.
 * scale(2.04) компенсирует лишний сдвиг, чтобы внешние края
 * тоже не выглядывали.
 */
function getTransform(mode: ViewMode): string {
  if (mode === 'multicam') return 'translate(0%, 0%) scale(1)';
  const cam = CAMERAS.find(c => c.id === mode)!;
  const tx = (1 - 2 * cam.col) * 51;
  const ty = (1 - 2 * cam.row) * 51;
  return `translate(${tx}%, ${ty}%) scale(2.04)`;
}

export function InteractiveDemo() {
  const hasVideo = DEMO_VIDEO_URL !== '';
  const [mode, setMode] = useState<ViewMode>('multicam');
  const [hasInteracted, setHasInteracted] = useState(false);
  // Без URL спиннер не показываем вовсе — иначе он крутился бы вечно.
  const [videoReady, setVideoReady] = useState(!hasVideo);
  const videoRef = useRef<HTMLVideoElement>(null);

  const handleCanPlay = useCallback(() => setVideoReady(true), []);
  // Хранилище недоступно или URL битый — гасим спиннер и оставляем тёмную
  // подложку с сеткой вместо бесконечной «Загрузки видео».
  const handleVideoError = useCallback(() => setVideoReady(true), []);

  function selectCam(cam: CamId) {
    setMode(cam);
    if (!hasInteracted) setHasInteracted(true);
  }

  function handleContainerClick() {
    if (mode !== 'multicam') setMode('multicam');
  }

  return (
    <div>
      {/* ── Video container ───────────────────────── */}
      <div
        className={`relative aspect-video rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-800/50 shadow-2xl shadow-black/40 ${
          mode !== 'multicam' ? 'cursor-pointer' : ''
        }`}
        onClick={handleContainerClick}
      >
        {hasVideo && (
          <video
            ref={videoRef}
            autoPlay
            muted
            loop
            playsInline
            src={DEMO_VIDEO_URL}
            onCanPlay={handleCanPlay}
            onError={handleVideoError}
            className={`w-full h-full object-cover will-change-transform transition-opacity duration-500 ${
              videoReady ? 'opacity-100' : 'opacity-0'
            }`}
            style={{
              transform: getTransform(mode),
              transition: `transform 0.7s cubic-bezier(0.16, 1, 0.3, 1)${videoReady ? '' : ', opacity 0.5s ease'}`,
            }}
          />
        )}

        {/* Loading state */}
        <AnimatePresence>
          {!videoReady && (
            <motion.div
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-900 pointer-events-none"
            >
              <CircleNotch size={28} className="text-zinc-600 animate-spin" weight="bold" />
              <span className="text-xs text-zinc-600">Загрузка видео</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Grid overlay ─ multicam only */}
        {mode === 'multicam' && (
          <>
            <div className="absolute top-1/2 left-0 right-0 h-px bg-white/[0.12] pointer-events-none" />
            <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/[0.12] pointer-events-none" />

            {CAMERAS.map((cam) => (
              <button
                key={cam.id}
                onClick={(e) => {
                  e.stopPropagation();
                  selectCam(cam.id);
                }}
                className="absolute w-1/2 h-1/2 bg-transparent hover:bg-white/[0.04] transition-all duration-300 cursor-pointer border-none outline-none group/quad"
                style={{
                  left: cam.col === 0 ? 0 : '50%',
                  top: cam.row === 0 ? 0 : '50%',
                }}
                aria-label={`Развернуть ${cam.label}`}
              >
                <span className="absolute bottom-2.5 left-2.5 text-[11px] text-white/40 group-hover/quad:text-white/70 transition-colors bg-black/30 backdrop-blur-sm px-2 py-0.5 rounded">
                  {cam.label}
                </span>

                <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/quad:opacity-100 transition-opacity duration-300">
                  <span className="w-9 h-9 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center border border-white/[0.08] shadow-lg shadow-black/20">
                    <CornersOut size={16} className="text-white/80" weight="bold" />
                  </span>
                </span>
              </button>
            ))}

            {/* Hint ─ before first interaction */}
            {!hasInteracted && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="text-sm text-white/50 bg-black/40 backdrop-blur-sm px-4 py-2 rounded-full border border-white/[0.06] animate-pulse">
                  Нажмите на любой ракурс
                </span>
              </div>
            )}
          </>
        )}

        {/* Active camera badge ─ zoomed */}
        <AnimatePresence>
          {mode !== 'multicam' && (
            <motion.div
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.25 }}
              className="absolute top-3.5 left-3.5 flex items-center gap-1.5 px-2.5 py-1 bg-brand/90 backdrop-blur-sm text-white text-xs font-medium rounded-lg shadow-lg shadow-brand/20 pointer-events-none"
            >
              <VideoCamera size={13} weight="fill" />
              {CAMERAS.find(c => c.id === mode)?.label}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Interactive minimap ─ zoomed ────────── */}
        <AnimatePresence>
          {mode !== 'multicam' && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.25 }}
              className="absolute bottom-3.5 left-3.5 bg-black/50 backdrop-blur-md rounded-lg p-1.5 border border-white/[0.08]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="grid grid-cols-2 gap-[3px] w-12 h-8">
                {CAMERAS.map(cam => (
                  <button
                    key={cam.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (mode === cam.id) {
                        setMode('multicam');
                      } else {
                        selectCam(cam.id);
                      }
                    }}
                    className={`rounded-[2px] cursor-pointer border-none outline-none transition-all duration-300 ${
                      mode === cam.id
                        ? 'bg-brand/70'
                        : 'bg-white/15 hover:bg-white/30'
                    }`}
                    aria-label={cam.label}
                  />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Camera buttons ────────────────────────── */}
      <div className="flex items-center gap-1.5 mt-3 justify-center flex-wrap">
        <button
          onClick={() => setMode('multicam')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-300 cursor-pointer border ${
            mode === 'multicam'
              ? 'bg-brand/12 text-brand border-brand/25'
              : 'bg-surface-card text-zinc-500 border-zinc-800/40 hover:text-zinc-300 hover:border-zinc-700'
          }`}
        >
          <GridFour size={13} weight={mode === 'multicam' ? 'fill' : 'regular'} />
          <span className="hidden sm:inline">Все камеры</span>
          <span className="sm:hidden">Все</span>
        </button>
        {CAMERAS.map(cam => (
          <button
            key={cam.id}
            onClick={() => selectCam(cam.id)}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-300 cursor-pointer border ${
              mode === cam.id
                ? 'bg-brand/12 text-brand border-brand/25'
                : 'bg-surface-card text-zinc-500 border-zinc-800/40 hover:text-zinc-300 hover:border-zinc-700'
            }`}
            aria-label={cam.label}
          >
            <VideoCamera size={12} weight={mode === cam.id ? 'fill' : 'regular'} />
            <span className="hidden sm:inline">{cam.label}</span>
            <span className="sm:hidden">{cam.shortLabel}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
