'use client';
import { useRef, useState, useCallback } from 'react';

interface Props {
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}

/*
 * Custom range slider for touch UX.
 * Track is inset by THUMB_RADIUS so the thumb never extends past the
 * container's left/right edges (the native <input type="range"> thumb
 * sits at the very edge and visually overflows on small screens).
 */
const THUMB_RADIUS = 10; // px — half of (visual thumb diameter + safety margin)

export function MobileSeekBar({ min, max, value, onChange, disabled }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const range = Math.max(0, max - min);
  const progress = range > 0
    ? Math.max(0, Math.min(1, (value - min) / range))
    : 0;

  const updateFromClientX = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el || range <= 0) return;
    const rect = el.getBoundingClientRect();
    const usable = rect.width - THUMB_RADIUS * 2;
    if (usable <= 0) return;
    const x = Math.max(0, Math.min(1, (clientX - rect.left - THUMB_RADIUS) / usable));
    onChange(min + x * range);
  }, [min, range, onChange]);

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    updateFromClientX(e.clientX);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    updateFromClientX(e.clientX);
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    setDragging(false);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  }

  return (
    <div
      ref={trackRef}
      className={`relative w-full select-none ${disabled ? 'opacity-50 pointer-events-none' : ''}`}
      style={{ height: 28, touchAction: 'none' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* Track */}
      <div
        className="absolute top-1/2 -translate-y-1/2 h-1 rounded-full bg-white/20 overflow-hidden"
        style={{ left: THUMB_RADIUS, right: THUMB_RADIUS }}
      >
        <div
          className="h-full bg-brand rounded-full"
          style={{ width: `${progress * 100}%`, transition: dragging ? 'none' : 'width 0.1s linear' }}
        />
      </div>
      {/* Thumb */}
      <div
        className="absolute top-1/2 rounded-full bg-white shadow-md pointer-events-none"
        style={{
          width: 14,
          height: 14,
          left: `calc(${THUMB_RADIUS}px + ${progress} * (100% - ${THUMB_RADIUS * 2}px))`,
          transform: `translate(-50%, -50%) scale(${dragging ? 1.25 : 1})`,
          transition: 'transform 0.15s ease-out',
        }}
      />
    </div>
  );
}
