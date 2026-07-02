'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';
import { SpeakerHigh, X, CornersOut, ArrowsOut } from '@phosphor-icons/react';
import { computeCanvasLayout, type TileRect } from '@/lib/canvas-layout-presets';

export interface CanvasTile {
  streamSlug: string;
  streamName: string;
  hlsUrl: string;
}

interface OrgCanvasPlayerProps {
  tiles: CanvasTile[];
}

const MOBILE_BREAKPOINT = 640;

/** Рисует видео внутри прямоугольника тайла с сохранением пропорций (contain), без искажений. */
function drawTileContain(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, rect: TileRect) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return;
  const videoAspect = vw / vh;
  const tileAspect = rect.w / rect.h;
  let dw: number, dh: number, dx: number, dy: number;
  if (videoAspect > tileAspect) {
    dw = rect.w;
    dh = dw / videoAspect;
    dx = rect.x;
    dy = rect.y + (rect.h - dh) / 2;
  } else {
    dh = rect.h;
    dw = dh * videoAspect;
    dy = rect.y;
    dx = rect.x + (rect.w - dw) / 2;
  }
  ctx.drawImage(video, 0, 0, vw, vh, dx, dy, dw, dh);
}

/** Настоящий OS-level fullscreen конкретного &lt;video&gt; (обходит canvas — честное качество). */
function enterVideoFullscreen(video: HTMLVideoElement) {
  const v = video as HTMLVideoElement & { webkitEnterFullscreen?: () => void; webkitRequestFullscreen?: () => void };
  if (video.requestFullscreen) video.requestFullscreen().catch(() => {});
  else if (v.webkitEnterFullscreen) v.webkitEnterFullscreen();
  else if (v.webkitRequestFullscreen) v.webkitRequestFullscreen();
}

/**
 * Fullscreen всей композиции (canvas). На iOS Safari нет fullscreen для
 * произвольных элементов — обходим тем же трюком, что MatPlayer: захватываем
 * поток холста через captureStream и открываем нативный fullscreen на
 * временном &lt;video&gt;.
 */
function enterCanvasFullscreen(container: HTMLElement, canvas: HTMLCanvasElement) {
  if (container.requestFullscreen) { container.requestFullscreen().catch(() => {}); return; }
  const c = canvas as HTMLCanvasElement & { captureStream?: (fps?: number) => MediaStream };
  if (!c.captureStream) return;
  const stream = c.captureStream(30);
  const tempVideo = document.createElement('video');
  tempVideo.srcObject = stream;
  tempVideo.muted = true;
  tempVideo.playsInline = true;
  tempVideo.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;';
  document.body.appendChild(tempVideo);
  tempVideo.play().catch(() => {}).finally(() => {
    const v = tempVideo as HTMLVideoElement & { webkitEnterFullscreen?: () => void };
    if (v.webkitEnterFullscreen) {
      v.webkitEnterFullscreen();
      tempVideo.addEventListener('webkitendfullscreen', () => { tempVideo.pause(); tempVideo.remove(); }, { once: true });
    } else {
      tempVideo.remove();
    }
  });
}

/**
 * Клиентская компоновка N независимых Stream'ов орги на одном холсте.
 * Каждый тайл — отдельный hls.js instance на скрытом &lt;video&gt;. Тайлы всегда
 * 16:9 без искажений; на мобильных (&lt;640px) — всегда вертикальный стек.
 *
 * Клик по тайлу — режим фокуса: холст сжимается до ОДНОЙ выбранной камеры
 * (чистый 16:9, без превью остальных сбоку) — из него можно дальше открыть
 * настоящий fullscreen. Отдельно — fullscreen всей плитки целиком.
 *
 * Звук — микшер: у каждой камеры свой ползунок громкости (не эксклюзивный
 * выбор одного источника), можно свести несколько сразу.
 */
export function OrgCanvasPlayer({ tiles }: OrgCanvasPlayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const outerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const videosRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const hlsRef = useRef<Map<string, Hls>>(new Map());
  const [volumes, setVolumes] = useState<Record<string, number>>({});
  const [focusedSlug, setFocusedSlug] = useState<string | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [isGridFullscreen, setIsGridFullscreen] = useState(false);
  const [fullscreenVideoSlug, setFullscreenVideoSlug] = useState<string | null>(null);

  const cappedTiles = tiles.slice(0, 4);
  const tileCount = cappedTiles.length;
  const isMobile = containerSize.width > 0 && containerSize.width < MOBILE_BREAKPOINT;
  const focusedTile = focusedSlug ? cappedTiles.find((t) => t.streamSlug === focusedSlug) ?? null : null;
  // В режиме фокуса — только один тайл (без превью остальных); иначе обычная сетка.
  const visibleTiles = focusedTile ? [focusedTile] : cappedTiles;

  const layout = useMemo(
    () => (focusedTile ? computeCanvasLayout(1, { isMobile: false }) : computeCanvasLayout(tileCount, { isMobile })),
    [tileCount, isMobile, focusedTile],
  );

  // Первая когда-либо появившаяся камера получает звук по умолчанию (100%),
  // остальные — 0. Новые камеры (когда сет уже не пуст) добавляются молча,
  // 0 громкости, ушедшие — вычищаются.
  useEffect(() => {
    setVolumes((prev) => {
      const next: Record<string, number> = {};
      const isFirstEver = Object.keys(prev).length === 0;
      cappedTiles.forEach((t, i) => {
        if (t.streamSlug in prev) next[t.streamSlug] = prev[t.streamSlug];
        else next[t.streamSlug] = isFirstEver && i === 0 ? 100 : 0;
      });
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cappedTiles.map((t) => t.streamSlug).join(',')]);

  // Clear focus if the focused tile leaves the set.
  useEffect(() => {
    if (focusedSlug && !cappedTiles.some((t) => t.streamSlug === focusedSlug)) {
      setFocusedSlug(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cappedTiles.map((t) => t.streamSlug).join(',')]);

  // Set up / tear down one hidden <video> + hls.js per tile.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const currentSlugs = new Set(cappedTiles.map((t) => t.streamSlug));

    videosRef.current.forEach((video, slug) => {
      if (!currentSlugs.has(slug)) {
        hlsRef.current.get(slug)?.destroy();
        hlsRef.current.delete(slug);
        if (video.parentNode === container) container.removeChild(video);
        videosRef.current.delete(slug);
      }
    });

    for (const tile of cappedTiles) {
      if (videosRef.current.has(tile.streamSlug)) continue;
      const video = document.createElement('video');
      video.autoplay = true;
      video.playsInline = true;
      video.muted = true;
      video.preload = 'auto';
      video.crossOrigin = 'anonymous';
      video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;opacity:0;pointer-events:none';
      container.appendChild(video);
      videosRef.current.set(tile.streamSlug, video);

      if (Hls.isSupported()) {
        const hls = new Hls({
          liveDurationInfinity: true,
          liveSyncDuration: 4,
          liveMaxLatencyDuration: 600,
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
          backBufferLength: 600,
        });
        hlsRef.current.set(tile.streamSlug, hls);
        hls.loadSource(tile.hlsUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => {}); });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = tile.hlsUrl;
        video.play().catch(() => {});
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cappedTiles.map((t) => `${t.streamSlug}:${t.hlsUrl}`).join(',')]);

  // Full cleanup on unmount.
  useEffect(() => {
    return () => {
      hlsRef.current.forEach((h) => h.destroy());
      hlsRef.current.clear();
      videosRef.current.forEach((v) => v.parentNode?.removeChild(v));
      videosRef.current.clear();
    };
  }, []);

  // Микшер: применяем громкость/mute каждого видео независимо.
  useEffect(() => {
    videosRef.current.forEach((video, slug) => {
      const vol = (volumes[slug] ?? 0) / 100;
      video.volume = vol;
      video.muted = vol === 0;
    });
  }, [volumes]);

  // Track rendered size of the aspect-locked box (source of truth for canvas/layout/hit-test).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setContainerSize({ width, height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Sync canvas device-pixel size whenever the rendered box size changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || containerSize.width === 0 || containerSize.height === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(containerSize.width * dpr);
    canvas.height = Math.round(containerSize.height * dpr);
  }, [containerSize]);

  // Track whole-grid fullscreen state (Fullscreen API) to swap CSS layout mode.
  useEffect(() => {
    function onFsChange() {
      setIsGridFullscreen(document.fullscreenElement === outerRef.current);
    }
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Toggle the visibility of a video temporarily while it's fullscreen on its own
  // (opacity:0 by default so it doesn't show through under the canvas).
  useEffect(() => {
    videosRef.current.forEach((video, slug) => {
      video.style.opacity = slug === fullscreenVideoSlug ? '1' : '0';
    });
    if (!fullscreenVideoSlug) return;
    function onFsChange() {
      if (!document.fullscreenElement) setFullscreenVideoSlug(null);
    }
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
    };
  }, [fullscreenVideoSlug]);

  // Draw loop.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let animId: number;

    const draw = () => {
      animId = requestAnimationFrame(draw);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const cw = canvas.width;
      if (cw === 0 || canvas.height === 0) return;

      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, cw, canvas.height);

      visibleTiles.forEach((tile, i) => {
        const t = layout.tiles[i];
        if (!t) return;
        // Раскладка нормализована по ширине — y/h тоже в долях ШИРИНЫ, не высоты.
        const rect: TileRect = { x: t.x * cw, y: t.y * cw, w: t.w * cw, h: t.h * cw };
        const video = videosRef.current.get(tile.streamSlug);
        if (!video || video.readyState < 2 || !video.videoWidth || tile.streamSlug === fullscreenVideoSlug) {
          ctx.fillStyle = '#0a0a0a';
          ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
          return;
        }
        drawTileContain(ctx, video, rect);
      });
    };

    animId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, visibleTiles.map((t) => t.streamSlug).join(','), fullscreenVideoSlug]);

  function handleCanvasClickHitTest(e: React.MouseEvent<HTMLCanvasElement>) {
    if (focusedTile) { setFocusedSlug(null); return; }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0) return;
    // Единая база (ширина) и для x, и для y — совпадает с нормализацией раскладки.
    const xNorm = (e.clientX - rect.left) / rect.width;
    const yNorm = (e.clientY - rect.top) / rect.width;
    for (let i = 0; i < layout.tiles.length; i++) {
      const t = layout.tiles[i];
      if (xNorm >= t.x && xNorm <= t.x + t.w && yNorm >= t.y && yNorm <= t.y + t.h) {
        const tile = visibleTiles[i];
        if (!tile) return;
        setFocusedSlug(tile.streamSlug);
        return;
      }
    }
  }

  function handleTileExpand(streamSlug: string) {
    const video = videosRef.current.get(streamSlug);
    if (!video) return;
    setFullscreenVideoSlug(streamSlug);
    enterVideoFullscreen(video);
  }

  function handleGridFullscreen() {
    const outer = outerRef.current;
    const canvas = canvasRef.current;
    if (!outer || !canvas) return;
    enterCanvasFullscreen(outer, canvas);
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div
        ref={outerRef}
        className={isGridFullscreen
          ? 'fixed inset-0 z-50 bg-black flex items-center justify-center'
          : 'w-full'}
      >
        <div
          ref={containerRef}
          className={`relative bg-black rounded-lg overflow-hidden ${isGridFullscreen ? 'max-w-full max-h-full' : 'w-full'}`}
          style={{ aspectRatio: `${layout.aspect}`, width: isGridFullscreen ? undefined : '100%' }}
        >
          <canvas
            ref={canvasRef}
            onClick={handleCanvasClickHitTest}
            className="absolute inset-0 w-full h-full cursor-pointer"
          />

          {/* Per-tile expand-to-fullscreen buttons, positioned over the canvas via the same layout. */}
          {visibleTiles.map((tile, i) => {
            const t = layout.tiles[i];
            if (!t) return null;
            const topPct = t.y * layout.aspect * 100;
            const leftPct = t.x * 100;
            return (
              <button
                key={tile.streamSlug}
                onClick={(e) => { e.stopPropagation(); handleTileExpand(tile.streamSlug); }}
                title="Развернуть камеру на весь экран"
                className="absolute p-1.5 bg-black/50 hover:bg-black/75 backdrop-blur-sm text-zinc-300 hover:text-white rounded-md transition-colors border-none cursor-pointer"
                style={{ top: `calc(${topPct}% + 6px)`, left: `calc(${leftPct}% + 6px)` }}
              >
                <ArrowsOut size={13} weight="bold" />
              </button>
            );
          })}

          {focusedTile ? (
            <button
              onClick={(e) => { e.stopPropagation(); setFocusedSlug(null); }}
              className="absolute top-2.5 right-2.5 flex items-center gap-1 px-2 py-1 bg-black/60 hover:bg-black/80 backdrop-blur-sm text-zinc-200 text-xs rounded-md transition-colors border-none cursor-pointer"
            >
              <X size={12} weight="bold" />
              К сетке
            </button>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); handleGridFullscreen(); }}
              title="Вся плитка на весь экран"
              className="absolute top-2.5 right-2.5 flex items-center gap-1 px-2 py-1 bg-black/60 hover:bg-black/80 backdrop-blur-sm text-zinc-200 text-xs rounded-md transition-colors border-none cursor-pointer"
            >
              <CornersOut size={13} weight="bold" />
              Весь экран
            </button>
          )}
        </div>
      </div>

      {tileCount > 1 && !isGridFullscreen && (
        <div className="flex flex-col gap-1.5 bg-surface-elevated border border-zinc-800/50 rounded-lg p-3">
          <span className="flex items-center gap-1.5 text-xs text-zinc-500 mb-0.5">
            <SpeakerHigh size={14} />
            Микшер звука
          </span>
          {cappedTiles.map((tile) => {
            const vol = volumes[tile.streamSlug] ?? 0;
            return (
              <div key={tile.streamSlug} className="flex items-center gap-2.5">
                <span className="text-xs text-zinc-400 w-24 truncate shrink-0">{tile.streamName || tile.streamSlug}</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={vol}
                  onChange={(e) => setVolumes((prev) => ({ ...prev, [tile.streamSlug]: Number(e.target.value) }))}
                  className="flex-1 h-1.5 accent-brand cursor-pointer"
                />
                <span className="text-[0.65rem] text-zinc-600 tabular-nums w-8 text-right shrink-0">{vol}%</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
