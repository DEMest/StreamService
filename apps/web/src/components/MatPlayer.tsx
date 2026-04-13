'use client';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import Hls from 'hls.js';
import type { ViewMode } from './ViewSwitcher';

interface Props {
  streamUrl: string;
  viewMode: ViewMode;
}

export interface MatPlayerHandle {
  enterIOSFullscreen: () => void;
}

const QUAD: Record<string, [number, number]> = {
  cam1: [0, 0], cam2: [1, 0], cam3: [0, 1], cam4: [1, 1],
};

function drawContain(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  sx: number, sy: number, sw: number, sh: number,
  cw: number, ch: number,
) {
  const ar = sw / sh;
  const car = cw / ch;
  let dx = 0, dy = 0, dw = cw, dh = ch;
  if (Math.abs(car - ar) > 0.01) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cw, ch);
    if (car > ar) { dw = Math.round(ch * ar); dx = Math.round((cw - dw) / 2); }
    else           { dh = Math.round(cw / ar); dy = Math.round((ch - dh) / 2); }
  }
  ctx.drawImage(video, sx, sy, sw, sh, dx, dy, dw, dh);
}

const MatPlayer = forwardRef<MatPlayerHandle, Props>(({ streamUrl, viewMode }, ref) => {
  const videoRef  = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modeRef   = useRef(viewMode);
  modeRef.current = viewMode;

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
  }), []);

  // HLS setup
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
      return () => hls.destroy();
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = streamUrl;
      video.play().catch(() => {
        video.muted = true;
        onMutedFallback?.();
        video.play().catch(() => {});
      });
    }
    return () => { hls?.destroy(); hlsRef.current = null; };
  }, [streamUrl, isArchive]);

  // Time update callback for seekbar
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !onTimeUpdate) return;

    const handler = () => {
      const hls = hlsRef.current;
      const isLive = !isArchive && !!hls && hls.latency !== undefined;
      const duration = isArchive ? video.duration : (hls?.liveSyncPosition ?? video.duration);
      onTimeUpdate(video.currentTime, duration, isLive);
    };

    video.addEventListener('timeupdate', handler);
    return () => video.removeEventListener('timeupdate', handler);
  }, [onTimeUpdate, isArchive]);

  // Sync volume prop to video element
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = volume === 0;
  }, [volume]);

  // Keep canvas pixel size synced with CSS size
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      canvas.width  = Math.round(canvas.offsetWidth  * (window.devicePixelRatio || 1));
      canvas.height = Math.round(canvas.offsetHeight * (window.devicePixelRatio || 1));
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  // Draw loop — modeRef avoids restarting rAF on every mode change
  useEffect(() => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    let animId: number;

    const draw = () => {
      animId = requestAnimationFrame(draw);
      if (video.readyState < 2 || !video.videoWidth) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const cw = canvas.width;
      const ch = canvas.height;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const mode = modeRef.current;

      if (mode === 'multicam') {
        drawContain(ctx, video, 0, 0, vw, vh, cw, ch);
      } else {
        const [qx, qy] = QUAD[mode];
        drawContain(ctx, video, qx * vw / 2, qy * vh / 2, vw / 2, vh / 2, cw, ch);
      }
    };

    animId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animId);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep canvas pixel size synced with CSS size
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      canvas.width  = Math.round(canvas.offsetWidth  * (window.devicePixelRatio || 1));
      canvas.height = Math.round(canvas.offsetHeight * (window.devicePixelRatio || 1));
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  // Draw loop — modeRef avoids restarting rAF on every mode change
  useEffect(() => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    let animId: number;

    const draw = () => {
      animId = requestAnimationFrame(draw);
      if (video.readyState < 2 || !video.videoWidth) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const cw = canvas.width;
      const ch = canvas.height;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const mode = modeRef.current;

      if (mode === 'multicam') {
        drawContain(ctx, video, 0, 0, vw, vh, cw, ch);
      } else {
        const [qx, qy] = QUAD[mode];
        drawContain(ctx, video, qx * vw / 2, qy * vh / 2, vw / 2, vh / 2, cw, ch);
      }
    };

    animId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animId);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#000' }}>
      {/* opacity:0 + absolute keeps video in render tree so iOS can decode it for canvas */}
      <video
        ref={videoRef}
        autoPlay muted playsInline
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
