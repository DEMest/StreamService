'use client';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import Hls from 'hls.js';
import type { PlayerViewMode } from './ViewSwitcher';

interface PropsBase {
  viewMode: PlayerViewMode;
  volume?: number;
  isArchive?: boolean;
  onMutedFallback?: () => void;
  onTimeUpdate?: (current: number, duration: number, isLive: boolean, seekableStart: number) => void;
  onBuffering?: (isBuffering: boolean) => void;
  onQualityChange?: (levelIndex: number) => void;
  /** Буфер опустел — зритель увидел рывок. Для метрик ёмкости. */
  onStall?: () => void;
  /** Фрагмент догрузился за столько миллисекунд. Для метрик ёмкости. */
  onFragLoad?: (ms: number) => void;
  /** Признак жизни от нативного плеера, который про фрагменты не сообщает. */
  onAlive?: () => void;
  /**
   * Сменилась ступень лесенки: имя каталога (`hd`, `p720`…) из адреса уровня.
   * Именно каталог, а не подпись из плейлиста: по нему считается вес зрителя.
   */
  onRendition?: (rendition: string | null) => void;
}

interface PropsLegacy extends PropsBase {
  mode?: 'composite';
  streamUrl: string;
  streamUrls?: undefined;
}

interface PropsComposite extends PropsBase {
  mode: 'composite';
  streamUrls: string[];
  streamUrl?: undefined;
}

type Props = PropsLegacy | PropsComposite;

export interface MatPlayerHandle {
  enterIOSFullscreen: () => void;
  seekTo: (time: number) => void;
  seekToLive: () => void;
  pause: () => void;
  play: () => void;
  getVideoElement: () => HTMLVideoElement | null;
  getQualityLevels: () => { index: number; height: number; name: string }[];
  setQualityLevel: (index: number) => void;
  getCurrentQuality: () => number;
}

const QUAD: Record<string, [number, number]> = {
  cam1: [0, 0], cam2: [1, 0], cam3: [0, 1], cam4: [1, 1],
};

function drawContain(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  sx: number, sy: number, sw: number, sh: number,
  dxBase: number, dyBase: number, dwBase: number, dhBase: number,
) {
  const ar = sw / sh;
  const car = dwBase / dhBase;
  let dx = dxBase, dy = dyBase, dw = dwBase, dh = dhBase;
  if (Math.abs(car - ar) > 0.01) {
    ctx.fillStyle = '#000';
    ctx.fillRect(dxBase, dyBase, dwBase, dhBase);
    if (car > ar) { dw = Math.round(dhBase * ar); dx = dxBase + Math.round((dwBase - dw) / 2); }
    else           { dh = Math.round(dwBase / ar); dy = dyBase + Math.round((dhBase - dh) / 2); }
  }
  ctx.drawImage(video, sx, sy, sw, sh, dx, dy, dw, dh);
}

/** Stable signature of a string array (order matters). */
/**
 * Каталог ступени из адреса её плейлиста: `…/live/hls/p720/index.m3u8` → `p720`.
 *
 * Берём именно каталог, а не подпись уровня из master.m3u8: подпись —
 * человеческая («Оригинал», «720p») и может измениться, а каталог создаёт
 * `on-ready.sh`, и по нему же считает вес зрителя серверная часть.
 */
function renditionOf(levelUrl: string | undefined): string | null {
  if (!levelUrl) return null;
  const path = levelUrl.split('?')[0];
  const parts = path.split('/');
  // Предпоследний сегмент — каталог, последний — сам index.m3u8.
  return parts.length >= 2 ? parts[parts.length - 2] || null : null;
}

/**
 * Ступень лесенки по высоте кадра — единственный способ узнать качество у
 * нативного плеера Safari, который списка уровней не отдаёт. Границы взяты с
 * запасом вниз: важно не перепутать соседние ступени, а точную высоту
 * кодировщик может слегка менять.
 */
function renditionByHeight(height: number): string | null {
  if (!height) return null;
  if (height >= 900) return 'hd';
  if (height >= 620) return 'p720';
  if (height >= 380) return 'p480';
  return 'p240';
}

/**
 * Телеметрия для нативного HLS. Возвращает функцию отписки.
 *
 * `timeupdate` срабатывает несколько раз в секунду при воспроизведении и
 * молчит на паузе — ровно то определение «зритель ест канал», которое нам и
 * нужно. `waiting` означает опустевший буфер, то есть видимый рывок.
 */
function attachNativeTelemetry(
  video: HTMLVideoElement,
  handlers: {
    onAlive?: () => void;
    onStall?: () => void;
    onRendition?: (rendition: string | null) => void;
  },
): () => void {
  let lastRendition: string | null = null;

  const onTime = () => {
    handlers.onAlive?.();
    const next = renditionByHeight(video.videoHeight);
    if (next !== lastRendition) {
      lastRendition = next;
      handlers.onRendition?.(next);
    }
  };
  const onWaiting = () => handlers.onStall?.();

  video.addEventListener('timeupdate', onTime);
  video.addEventListener('waiting', onWaiting);

  return () => {
    video.removeEventListener('timeupdate', onTime);
    video.removeEventListener('waiting', onWaiting);
  };
}

function arrSig(arr: string[]): string {
  return arr.join('');
}

const MatPlayer = forwardRef<MatPlayerHandle, Props>((props, ref) => {
  const {
    viewMode,
    volume = 1,
    isArchive = false,
    onMutedFallback,
    onTimeUpdate,
    onBuffering,
    onQualityChange,
    onStall,
    onFragLoad,
    onAlive,
    onRendition,
  } = props;

  // Resolve the array of source URLs in a uniform way.
  const rawUrls: string[] = (() => {
    if (props.mode === 'composite' && props.streamUrls) return props.streamUrls;
    if ('streamUrl' in props && props.streamUrl) return [props.streamUrl];
    return [];
  })();
  const streamUrlsSig = arrSig(rawUrls);
  const streamUrls = useMemo<string[]>(() => rawUrls, [streamUrlsSig]); // eslint-disable-line react-hooks/exhaustive-deps

  const canvasRef       = useRef<HTMLCanvasElement>(null);
  const primaryVideoRef = useRef<HTMLVideoElement>(null);
  const primaryHlsRef   = useRef<Hls | null>(null);
  const modeRef         = useRef(viewMode);

  modeRef.current = viewMode;

  function getActiveVideo(): HTMLVideoElement | null {
    return primaryVideoRef.current;
  }

  useImperativeHandle(ref, () => ({
    enterIOSFullscreen() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const stream = (canvas as any).captureStream?.(30) as MediaStream | undefined;
      if (!stream) return;
      const tmp = document.createElement('video');
      tmp.srcObject = stream;
      tmp.autoplay = true;
      tmp.muted = true;
      tmp.playsInline = false;
      tmp.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0.01;top:0;left:0';
      document.body.appendChild(tmp);
      tmp.play()
        .then(() => {
          (tmp as any).webkitEnterFullscreen?.();
          tmp.addEventListener('webkitendfullscreen', () => document.body.removeChild(tmp), { once: true });
        })
        .catch(() => document.body.removeChild(tmp));
    },
    seekTo(time: number) {
      const video = primaryVideoRef.current;
      if (video) video.currentTime = time;
    },
    seekToLive() {
      const video = primaryVideoRef.current;
      if (!video) return;
      // На архивном плеере «прыжок к эфиру» — no-op (как и во внутренней версии).
      if (isArchive) return;
      // Ищем живой край надёжно: liveSyncPosition часто null (например сразу
      // после BUFFER_STALLED, пока hls.js не пересчитал позицию). Тогда берём
      // конец доступного диапазона seekable, иначе конец buffered, иначе duration.
      let target = primaryHlsRef.current?.liveSyncPosition ?? null;
      if (target == null || !Number.isFinite(target)) {
        const seekable = video.seekable;
        if (seekable.length > 0) {
          target = seekable.end(seekable.length - 1);
        } else {
          const buffered = video.buffered;
          if (buffered.length > 0) {
            target = buffered.end(buffered.length - 1);
          }
        }
      }
      if (target == null || !Number.isFinite(target)) {
        target = video.duration;
      }
      // Прыгаем только на конечную цель, иначе currentTime = NaN сломает плеер.
      if (Number.isFinite(target)) {
        video.currentTime = target;
      }
    },
    pause() {
      primaryVideoRef.current?.pause();
    },
    play() {
      primaryVideoRef.current?.play().catch(() => {});
    },
    getVideoElement() {
      return getActiveVideo();
    },
    getQualityLevels() {
      const hls = primaryHlsRef.current;
      if (!hls) return [];
      return hls.levels.map((level, index) => {
        let name: string;
        if ((level as any).name) {
          name = (level as any).name;
        } else if (level.height > 0) {
          name = `${level.height}p`;
        } else if (level.bitrate > 0) {
          const mbps = level.bitrate / 1_000_000;
          name = mbps >= 1 ? `${mbps.toFixed(1)} Mbps` : `${Math.round(level.bitrate / 1000)} kbps`;
        } else {
          name = `Поток ${index + 1}`;
        }
        return { index, height: level.height, name };
      });
    },
    setQualityLevel(index: number) {
      const hls = primaryHlsRef.current;
      if (hls) hls.currentLevel = index;
    },
    getCurrentQuality() {
      const hls = primaryHlsRef.current;
      return hls ? hls.currentLevel : -1;
    },
  }), []);

  // ─── Composite media setup ────────────────────────────────────────────
  useEffect(() => {
    const video = primaryVideoRef.current;
    if (!video) return;
    const compositeUrl = streamUrls[0];
    if (!compositeUrl) return;

    let hls: Hls | null = null;
    let nativeCleanup: (() => void) | null = null;

    if (isArchive) {
      if (Hls.isSupported()) {
        hls = new Hls();
        primaryHlsRef.current = hls;
        hls.loadSource(compositeUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          video.play().catch(() => {
            video.muted = true;
            onMutedFallback?.();
            video.play().catch(() => {});
          });
        });
        hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
          onQualityChange?.(data.level);
        });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = compositeUrl;
        video.play().catch(() => {
          video.muted = true;
          onMutedFallback?.();
          video.play().catch(() => {});
        });
      }
    } else if (Hls.isSupported()) {
      hls = new Hls({
        liveDurationInfinity: true,
        lowLatencyMode: false,
        liveSyncDuration: 20,
        // Отстали больше ~40c (≈ окну сегментов на сервере) → догоняем эфир,
        // а не ждём уже удалённый сегмент (иначе стоп-кадр в бесконечность).
        liveMaxLatencyDuration: 40,
        // Плавный догон ускорением до 1.5x вместо резкого прыжка, когда отставание умеренное.
        maxLiveSyncPlaybackRate: 1.5,
        maxBufferLength: 45,
        maxMaxBufferLength: 60,
        // Перепрыгивать дыры до 1c (пропущенные/битые сегменты), а не вставать на них.
        maxBufferHole: 1,
        backBufferLength: 600,
        startLevel: -1,
      });
      primaryHlsRef.current = hls;
      hls.loadSource(compositeUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {
          video.muted = true;
          onMutedFallback?.();
          video.play().catch(() => {});
        });
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
        onQualityChange?.(data.level);
        onRendition?.(renditionOf(hls?.levels?.[data.level]?.url?.[0]));
      });
      hls.on(Hls.Events.FRAG_BUFFERED, (_event, data) => {
        const ms = data.frag.stats.loading.end - data.frag.stats.loading.start;
        if (Number.isFinite(ms) && ms >= 0) onFragLoad?.(Math.round(ms));
      });
      // Прыжок к живому краю: спасает от вечного стоп-кадра, когда буфер опустел
      // и нужный сегмент уже стёрт с сервера (плеер иначе ждёт его бесконечно).
      const seekToLive = () => {
        if (isArchive) return;
        // Основной ориентир — liveSyncPosition от hls.js.
        let pos = hls?.liveSyncPosition ?? null;
        // Фолбэк: hls.js часто отдаёт null (например сразу после BUFFER_STALLED,
        // пока не пересчитал позицию). В этом случае живой край — это конец
        // доступного диапазона seekable, а если его нет — конец buffered.
        if (pos == null || !Number.isFinite(pos)) {
          const seekable = video.seekable;
          if (seekable.length > 0) {
            pos = seekable.end(seekable.length - 1);
          } else {
            const buffered = video.buffered;
            if (buffered.length > 0) {
              pos = buffered.end(buffered.length - 1);
            }
          }
        }
        // Прыгаем только если цель конечна и заметно опережает текущую позицию.
        if (pos != null && Number.isFinite(pos) && pos - video.currentTime > 1) {
          video.currentTime = pos;
          video.play().catch(() => {});
        }
      };

      hls.on(Hls.Events.ERROR, (_event, data) => {
        // Застревание буфера у hls.js — НЕ фатально, но на живом стриме требует
        // прыжка к эфиру, иначе плеер молча стоит на месте.
        if (!isArchive && data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) {
          onStall?.();
          seekToLive();
          return;
        }
        if (!data.fatal) return;
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            hls!.startLoad();
            seekToLive();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            hls!.recoverMediaError();
            break;
          default:
            hls!.destroy();
            primaryHlsRef.current = null;
            break;
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = compositeUrl;
      video.play().catch(() => {
        video.muted = true;
        onMutedFallback?.();
        video.play().catch(() => {});
      });

      // Телеметрия для нативного HLS (весь iOS). Событий загрузки фрагментов и
      // списка уровней Safari не даёт, поэтому берём то, что есть: движение
      // времени как признак жизни, `waiting` как подвисание и высоту кадра как
      // ступень лесенки — при переключении качества Safari меняет videoHeight.
      // Без этого зрители с iPhone потребляли бы канал, не попадая в счётчик,
      // и потолок занижался бы тем сильнее, чем мобильнее зал.
      nativeCleanup = attachNativeTelemetry(video, {
        onAlive,
        onStall,
        onRendition,
      });
    }
    return () => {
      nativeCleanup?.();
      hls?.destroy();
      primaryHlsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamUrls[0], isArchive]);

  // ─── Time-update wiring ───────────────────────────────────────────────
  useEffect(() => {
    if (!onTimeUpdate) return;
    const video = getActiveVideo();
    if (!video) return;

    const handler = () => {
      const hls = primaryHlsRef.current;
      const isLive = !isArchive && !!hls && hls.latency !== undefined;
      const duration = isArchive ? video.duration : (hls?.liveSyncPosition ?? video.duration);
      let seekableStart = 0;
      try { if (video.seekable.length > 0) seekableStart = video.seekable.start(0); } catch {}
      onTimeUpdate(video.currentTime, duration, isLive, seekableStart);
    };

    video.addEventListener('timeupdate', handler);
    return () => video.removeEventListener('timeupdate', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onTimeUpdate, isArchive, streamUrls.length]);

  // ─── Volume routing ───────────────────────────────────────────────────
  useEffect(() => {
    const video = primaryVideoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = volume === 0;
  }, [volume]);

  // ─── Buffering callbacks ──────────────────────────────────────────────
  useEffect(() => {
    if (!onBuffering) return;
    const video = primaryVideoRef.current;
    if (!video) return;
    const onWaiting = () => onBuffering(true);
    const onPlaying = () => onBuffering(false);
    const onCanPlay = () => onBuffering(false);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('canplay', onCanPlay);
    return () => {
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('canplay', onCanPlay);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onBuffering, streamUrls.length]);

  // ─── Canvas DPR sync ─────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const ro = new ResizeObserver(() => {
      canvas.width  = Math.round(canvas.offsetWidth  * dpr);
      canvas.height = Math.round(canvas.offsetHeight * dpr);
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  // ─── Draw loop ───────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let animId: number;

    const draw = () => {
      animId = requestAnimationFrame(draw);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const cw = canvas.width;
      const ch = canvas.height;
      if (cw === 0 || ch === 0) return;
      const mv = modeRef.current;

      const video = primaryVideoRef.current;
      if (!video || video.readyState < 2 || !video.videoWidth) return;
      const vw = video.videoWidth;
      const vh = video.videoHeight;

      if (mv === 'multicam') {
        drawContain(ctx, video, 0, 0, vw, vh, 0, 0, cw, ch);
      } else if (mv === 'cam1' || mv === 'cam2' || mv === 'cam3' || mv === 'cam4') {
        const [qx, qy] = QUAD[mv];
        drawContain(ctx, video, qx * vw / 2, qy * vh / 2, vw / 2, vh / 2, 0, 0, cw, ch);
      } else {
        // unknown view — full frame
        drawContain(ctx, video, 0, 0, vw, vh, 0, 0, cw, ch);
      }
    };

    animId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <div className="relative w-full h-full bg-black">
      <video
        ref={primaryVideoRef}
        autoPlay
        playsInline
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, pointerEvents: 'none' }}
      />
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
      />
    </div>
  );
});

MatPlayer.displayName = 'MatPlayer';
export default MatPlayer;
export type { Props as MatPlayerProps };
