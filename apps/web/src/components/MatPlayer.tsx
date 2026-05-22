'use client';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import Hls from 'hls.js';
import type { PlayerViewMode } from './ViewSwitcher';
import { pickLayout, type LayoutPosition } from '@/lib/layout-presets';

export type PlayerSlot = {
  index: number;
  name: string;
  isAudioSource?: boolean;
};

interface PropsBase {
  viewMode: PlayerViewMode;
  volume?: number;
  isArchive?: boolean;
  onMutedFallback?: () => void;
  onTimeUpdate?: (current: number, duration: number, isLive: boolean, seekableStart: number) => void;
  onBuffering?: (isBuffering: boolean) => void;
  onQualityChange?: (levelIndex: number) => void;
}

interface PropsLegacy extends PropsBase {
  mode?: 'composite';
  streamUrl: string;
  streamUrls?: undefined;
  slots?: undefined;
  activeSlotIndexes?: undefined;
  layoutPreset?: undefined;
  fallbackLayouts?: undefined;
}

interface PropsComposite extends PropsBase {
  mode: 'composite';
  streamUrls: string[];
  streamUrl?: undefined;
  slots?: undefined;
  activeSlotIndexes?: undefined;
  layoutPreset?: undefined;
  fallbackLayouts?: undefined;
}

interface PropsMultistream extends PropsBase {
  mode: 'multistream';
  streamUrls: string[];
  streamUrl?: undefined;
  slots: PlayerSlot[];
  activeSlotIndexes?: number[];
  layoutPreset?: string;
  fallbackLayouts?: Record<number, string> | null;
}

type Props = PropsLegacy | PropsComposite | PropsMultistream;

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
function arrSig(arr: string[]): string {
  return arr.join('');
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
  } = props;

  const mode: 'composite' | 'multistream' =
    props.mode === 'multistream' ? 'multistream' : 'composite';

  // Resolve the array of source URLs in a uniform way for both modes.
  // We compute it on every render but cache by signature so downstream
  // effects don't tear down hls.js instances spuriously.
  const rawUrls: string[] = (() => {
    if (props.mode === 'multistream') return props.streamUrls ?? [];
    if (props.mode === 'composite' && props.streamUrls) return props.streamUrls;
    if ('streamUrl' in props && props.streamUrl) return [props.streamUrl];
    return [];
  })();
  const streamUrlsSig = arrSig(rawUrls);
  const streamUrls = useMemo<string[]>(() => rawUrls, [streamUrlsSig]); // eslint-disable-line react-hooks/exhaustive-deps

  const slots = props.mode === 'multistream' ? props.slots : undefined;
  const activeSlotIndexes = props.mode === 'multistream' ? props.activeSlotIndexes : undefined;
  const layoutPreset = props.mode === 'multistream' ? props.layoutPreset : undefined;
  const fallbackLayouts = props.mode === 'multistream' ? props.fallbackLayouts : undefined;

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);

  // composite primary video (also used as the single audio source in composite mode)
  const primaryVideoRef = useRef<HTMLVideoElement>(null);
  const primaryHlsRef   = useRef<Hls | null>(null);

  // multistream: index in streamUrls -> video element / hls instance
  const slotVideosRef = useRef<Map<number, HTMLVideoElement>>(new Map());
  const slotHlsRef    = useRef<Map<number, Hls>>(new Map());

  const modeRef           = useRef(viewMode);
  const playerModeRef     = useRef<'composite' | 'multistream'>(mode);
  const slotsRef          = useRef(slots);
  const activeIndexesRef  = useRef(activeSlotIndexes);
  const layoutPresetRef   = useRef(layoutPreset);
  const fallbackRef       = useRef(fallbackLayouts);

  modeRef.current = viewMode;
  playerModeRef.current = mode;
  slotsRef.current = slots;
  activeIndexesRef.current = activeSlotIndexes;
  layoutPresetRef.current = layoutPreset;
  fallbackRef.current = fallbackLayouts;

  // The "active video" used for time-update / quality / fullscreen handle.
  // In composite mode this is the primary video.
  // In multistream mode we delegate to the audio-source slot's video.
  function getAudioSlotIndex(): number | null {
    const slotList = slotsRef.current;
    const active = activeIndexesRef.current;
    if (!slotList || slotList.length === 0) return null;

    const activeList = active && active.length > 0 ? active : slotList.map(s => s.index);
    if (activeList.length === 0) return null;

    const flagged = slotList.find(s => s.isAudioSource && activeList.includes(s.index));
    if (flagged) return flagged.index;
    return activeList[0];
  }

  function getActiveVideo(): HTMLVideoElement | null {
    if (playerModeRef.current === 'multistream') {
      // viewMode 'slot-N' -> audio from slot N; 'composed' -> from audio-source slot
      const mv = modeRef.current;
      if (typeof mv === 'string' && mv.startsWith('slot-')) {
        const idx = parseInt(mv.slice('slot-'.length), 10);
        if (!Number.isNaN(idx)) {
          const v = slotVideosRef.current.get(idx);
          if (v) return v;
        }
      }
      const audioIdx = getAudioSlotIndex();
      if (audioIdx !== null) {
        const v = slotVideosRef.current.get(audioIdx);
        if (v) return v;
      }
      // fall back to first available
      const first = slotVideosRef.current.values().next().value;
      return first ?? null;
    }
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
      if (playerModeRef.current === 'multistream') {
        slotVideosRef.current.forEach(v => { v.currentTime = time; });
      } else {
        const video = primaryVideoRef.current;
        if (video) video.currentTime = time;
      }
    },
    seekToLive() {
      if (playerModeRef.current === 'multistream') {
        slotVideosRef.current.forEach((v, idx) => {
          const hls = slotHlsRef.current.get(idx);
          if (hls) v.currentTime = hls.liveSyncPosition ?? v.duration;
          else v.currentTime = v.duration;
        });
        return;
      }
      const video = primaryVideoRef.current;
      if (!video) return;
      if (primaryHlsRef.current) {
        video.currentTime = primaryHlsRef.current.liveSyncPosition ?? video.duration;
      } else {
        video.currentTime = video.duration;
      }
    },
    pause() {
      if (playerModeRef.current === 'multistream') {
        slotVideosRef.current.forEach(v => v.pause());
      } else {
        primaryVideoRef.current?.pause();
      }
    },
    play() {
      if (playerModeRef.current === 'multistream') {
        slotVideosRef.current.forEach(v => v.play().catch(() => {}));
      } else {
        primaryVideoRef.current?.play().catch(() => {});
      }
    },
    getVideoElement() {
      return getActiveVideo();
    },
    getQualityLevels() {
      // Multistream: each slot is effectively one variant. We don't expose
      // per-slot ABR through this handle — keep the array empty so the UI
      // can hide the quality picker. Composite path retains the legacy ABR.
      if (playerModeRef.current === 'multistream') return [];
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
      if (playerModeRef.current === 'multistream') return;
      const hls = primaryHlsRef.current;
      if (hls) hls.currentLevel = index;
    },
    getCurrentQuality() {
      if (playerModeRef.current === 'multistream') return -1;
      const hls = primaryHlsRef.current;
      return hls ? hls.currentLevel : -1;
    },
  }), []);

  // ─── Composite media setup (legacy path) ─────────────────────────────
  useEffect(() => {
    if (mode !== 'composite') return;
    const video = primaryVideoRef.current;
    if (!video) return;
    const compositeUrl = streamUrls[0];
    if (!compositeUrl) return;

    let hls: Hls | null = null;

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
        liveSyncDuration: 4,
        liveMaxLatencyDuration: 600,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
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
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            hls!.startLoad();
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
    }
    return () => {
      hls?.destroy();
      primaryHlsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, streamUrls[0], isArchive]);

  // ─── Multistream media setup ─────────────────────────────────────────
  // Tracks the last seen signature so we know when streamUrls actually changed.
  const lastSigRef = useRef<string>('');
  useEffect(() => {
    if (mode !== 'multistream') {
      // Tear down any multistream resources if we switched mode.
      slotHlsRef.current.forEach(h => h.destroy());
      slotHlsRef.current.clear();
      const container = containerRef.current;
      slotVideosRef.current.forEach(v => {
        if (v.parentNode === container) container?.removeChild(v);
      });
      slotVideosRef.current.clear();
      lastSigRef.current = '';
      return;
    }

    const sig = arrSig(streamUrls);
    if (sig === lastSigRef.current) return;
    lastSigRef.current = sig;

    const container = containerRef.current;
    if (!container) return;

    // Destroy any existing hls instances + remove the existing <video>s.
    slotHlsRef.current.forEach(h => h.destroy());
    slotHlsRef.current.clear();
    slotVideosRef.current.forEach(v => {
      if (v.parentNode === container) container.removeChild(v);
    });
    slotVideosRef.current.clear();

    // Create one hidden <video> per URL.
    streamUrls.forEach((url, idx) => {
      if (!url) return;
      const video = document.createElement('video');
      video.autoplay = true;
      video.playsInline = true;
      video.muted = true; // start muted; volume routing happens later
      video.preload = 'auto';
      video.crossOrigin = 'anonymous';
      video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;opacity:0;pointer-events:none';
      container.appendChild(video);
      slotVideosRef.current.set(idx, video);

      if (Hls.isSupported() && !isArchive) {
        const hls = new Hls({
          liveDurationInfinity: true,
          lowLatencyMode: false,
          liveSyncDuration: 4,
          liveMaxLatencyDuration: 600,
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
          backBufferLength: 600,
          startLevel: -1,
        });
        slotHlsRef.current.set(idx, hls);
        hls.loadSource(url);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          video.play().catch(() => {
            video.muted = true;
            onMutedFallback?.();
            video.play().catch(() => {});
          });
        });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              hls.destroy();
              slotHlsRef.current.delete(idx);
              break;
          }
        });
      } else if (Hls.isSupported() && isArchive) {
        const hls = new Hls();
        slotHlsRef.current.set(idx, hls);
        hls.loadSource(url);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          video.play().catch(() => {
            video.muted = true;
            onMutedFallback?.();
            video.play().catch(() => {});
          });
        });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url;
        video.play().catch(() => {
          video.muted = true;
          onMutedFallback?.();
          video.play().catch(() => {});
        });
      }
    });

    return () => {
      slotHlsRef.current.forEach(h => h.destroy());
      slotHlsRef.current.clear();
      const c = containerRef.current;
      slotVideosRef.current.forEach(v => {
        if (c && v.parentNode === c) c.removeChild(v);
      });
      slotVideosRef.current.clear();
      lastSigRef.current = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, arrSig(streamUrls), isArchive]);

  // ─── Time-update / buffering wiring (driven off the active video) ────
  useEffect(() => {
    if (!onTimeUpdate) return;
    const video = getActiveVideo();
    if (!video) return;

    const handler = () => {
      const hls =
        playerModeRef.current === 'multistream'
          ? slotHlsRef.current.get(getAudioSlotIndex() ?? -1) ?? null
          : primaryHlsRef.current;
      const isLive = !isArchive && !!hls && hls.latency !== undefined;
      const duration = isArchive ? video.duration : (hls?.liveSyncPosition ?? video.duration);
      let seekableStart = 0;
      try { if (video.seekable.length > 0) seekableStart = video.seekable.start(0); } catch {}
      onTimeUpdate(video.currentTime, duration, isLive, seekableStart);
    };

    video.addEventListener('timeupdate', handler);
    return () => video.removeEventListener('timeupdate', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onTimeUpdate, isArchive, mode, streamUrls.length, viewMode]);

  // ─── Volume / audio-source routing ───────────────────────────────────
  useEffect(() => {
    if (mode === 'composite') {
      const video = primaryVideoRef.current;
      if (!video) return;
      video.volume = volume;
      video.muted = volume === 0;
      return;
    }
    // multistream: only the chosen audio source is unmuted; the rest are muted.
    const audioIdx = (() => {
      if (typeof viewMode === 'string' && viewMode.startsWith('slot-')) {
        const i = parseInt(viewMode.slice('slot-'.length), 10);
        if (!Number.isNaN(i) && slotVideosRef.current.has(i)) return i;
      }
      return getAudioSlotIndex();
    })();

    slotVideosRef.current.forEach((video, idx) => {
      if (idx === audioIdx) {
        video.volume = volume;
        video.muted = volume === 0;
      } else {
        video.muted = true;
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volume, mode, viewMode, slots, activeSlotIndexes, streamUrls.length]);

  // ─── Buffering callbacks (composite uses the primary video; multistream
  // listens on every slot video and reports buffering if any slot stalls). ─
  useEffect(() => {
    if (!onBuffering) return;
    if (mode === 'composite') {
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
    }
    // multistream
    const videos = Array.from(slotVideosRef.current.values());
    const waiting = new Set<HTMLVideoElement>();
    const onWaiting = (e: Event) => {
      const v = e.currentTarget as HTMLVideoElement;
      waiting.add(v);
      onBuffering(true);
    };
    const onReady = (e: Event) => {
      const v = e.currentTarget as HTMLVideoElement;
      waiting.delete(v);
      if (waiting.size === 0) onBuffering(false);
    };
    videos.forEach(v => {
      v.addEventListener('waiting', onWaiting);
      v.addEventListener('playing', onReady);
      v.addEventListener('canplay', onReady);
    });
    return () => {
      videos.forEach(v => {
        v.removeEventListener('waiting', onWaiting);
        v.removeEventListener('playing', onReady);
        v.removeEventListener('canplay', onReady);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onBuffering, mode, streamUrls.length]);

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

      if (playerModeRef.current === 'composite') {
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
          // unknown view in composite mode — full frame
          drawContain(ctx, video, 0, 0, vw, vh, 0, 0, cw, ch);
        }
        return;
      }

      // multistream
      const slotList = slotsRef.current ?? [];
      const active = activeIndexesRef.current;
      const activeList = (active && active.length > 0)
        ? active.slice()
        : slotList.map(s => s.index);

      // slot-N — single slot, letterboxed
      if (typeof mv === 'string' && mv.startsWith('slot-')) {
        const targetIdx = parseInt(mv.slice('slot-'.length), 10);
        if (Number.isNaN(targetIdx)) return;
        const video = slotVideosRef.current.get(targetIdx);
        if (!video || video.readyState < 2 || !video.videoWidth) {
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, cw, ch);
          return;
        }
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, cw, ch);
        drawContain(ctx, video, 0, 0, video.videoWidth, video.videoHeight, 0, 0, cw, ch);
        return;
      }

      // composed
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, cw, ch);

      const activeCount = activeList.length;
      if (activeCount === 0) return;

      let positions: LayoutPosition[];
      try {
        const layout = pickLayout({
          layoutPreset: layoutPresetRef.current,
          fallbackLayouts: fallbackRef.current ?? null,
          activeCount: Math.min(activeCount, 4),
        });
        positions = layout.resolve(cw, ch);
      } catch {
        return;
      }

      // Sort active indexes by their numeric index for deterministic placement
      // (slot 1 -> first position, slot 2 -> second, etc.).
      activeList.sort((a, b) => a - b);

      for (let i = 0; i < positions.length && i < activeList.length; i++) {
        const slotIdx = activeList[i];
        // Resolve which video element corresponds to this slot index.
        // We index videos by their position in `streamUrls`, which mirrors
        // the order of `slots` provided by the parent.
        const arrayIdx = slotList.findIndex(s => s.index === slotIdx);
        const video = slotVideosRef.current.get(arrayIdx >= 0 ? arrayIdx : slotIdx);
        const pos = positions[i];
        if (!video || video.readyState < 2 || !video.videoWidth) {
          ctx.fillStyle = '#0a0a0a';
          ctx.fillRect(pos.x, pos.y, pos.w, pos.h);
          continue;
        }
        ctx.drawImage(
          video,
          0, 0, video.videoWidth, video.videoHeight,
          pos.x, pos.y, pos.w, pos.h,
        );
      }
    };

    animId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <div ref={containerRef} className="relative w-full h-full bg-black">
      {/* Composite mode keeps a single declarative <video>. Multistream
          videos are created imperatively as children of containerRef. */}
      {mode === 'composite' && (
        <video
          ref={primaryVideoRef}
          autoPlay
          playsInline
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, pointerEvents: 'none' }}
        />
      )}
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
