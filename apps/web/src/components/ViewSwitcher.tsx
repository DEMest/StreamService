'use client';
import { GridFour, VideoCamera } from '@phosphor-icons/react';

export type ViewMode = 'multicam' | 'cam1' | 'cam2' | 'cam3' | 'cam4';
export type CompositeViewMode = ViewMode;
export type PlayerViewMode = CompositeViewMode;

const COMPOSITE_MODES: { key: CompositeViewMode; label: string }[] = [
  { key: 'multicam', label: 'Мультикам' },
  { key: 'cam1', label: 'Камера 1' },
  { key: 'cam2', label: 'Камера 2' },
  { key: 'cam3', label: 'Камера 3' },
  { key: 'cam4', label: 'Камера 4' },
];

type Props = {
  mode: CompositeViewMode;
  onChange: (mode: CompositeViewMode) => void;
  /** 'single' — Stream это одна камера целиком, кроп по квадрантам не показывается. */
  feedMode?: 'single' | 'composite';
};

export default function ViewSwitcher({ mode, onChange, feedMode = 'composite' }: Props) {
  const options = feedMode === 'single'
    ? COMPOSITE_MODES.filter((m) => m.key === 'multicam')
    : COMPOSITE_MODES;

  return (
    <div className="flex flex-col gap-1.5">
      {options.map((m) => {
        const active = mode === m.key;
        return (
          <button
            key={m.key}
            type="button"
            onClick={() => onChange(m.key)}
            className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium text-left transition-all duration-200 active:scale-[0.97] ${
              active
                ? 'bg-brand text-white shadow-lg shadow-brand/20'
                : 'bg-zinc-800/50 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
            }`}
          >
            {m.key === 'multicam' ? (
              <GridFour size={16} weight={active ? 'fill' : 'regular'} />
            ) : (
              <VideoCamera size={16} weight={active ? 'fill' : 'regular'} />
            )}
            {m.key === 'multicam' && feedMode === 'single' ? 'Весь кадр' : m.label}
          </button>
        );
      })}
    </div>
  );
}
