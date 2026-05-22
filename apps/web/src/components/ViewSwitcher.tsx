'use client';
import { GridFour, VideoCamera } from '@phosphor-icons/react';

export type ViewMode = 'multicam' | 'cam1' | 'cam2' | 'cam3' | 'cam4';
export type CompositeViewMode = ViewMode;
export type MultistreamViewMode = 'composed' | `slot-${number}`;
export type PlayerViewMode = CompositeViewMode | MultistreamViewMode;

const COMPOSITE_MODES: { key: CompositeViewMode; label: string }[] = [
  { key: 'multicam', label: 'Мультикам' },
  { key: 'cam1', label: 'Камера 1' },
  { key: 'cam2', label: 'Камера 2' },
  { key: 'cam3', label: 'Камера 3' },
  { key: 'cam4', label: 'Камера 4' },
];

export interface SlotDescriptor {
  index: number;
  name: string;
}

type CompositeProps = {
  mode: CompositeViewMode;
  onChange: (mode: CompositeViewMode) => void;
};

type MultistreamProps = {
  mode: 'multistream';
  value: MultistreamViewMode;
  onChange: (mode: MultistreamViewMode) => void;
  slots: SlotDescriptor[];
  activeSlotIndexes: number[];
};

type Props = CompositeProps | MultistreamProps;

function isMultistreamProps(props: Props): props is MultistreamProps {
  return (props as MultistreamProps).mode === 'multistream';
}

export default function ViewSwitcher(props: Props) {
  if (isMultistreamProps(props)) {
    return <MultistreamSwitcher {...props} />;
  }
  return <CompositeSwitcher value={props.mode} onChange={props.onChange} />;
}

function CompositeSwitcher({
  value,
  onChange,
}: {
  value: CompositeViewMode;
  onChange: (mode: CompositeViewMode) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {COMPOSITE_MODES.map((m) => {
        const active = value === m.key;
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
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

function MultistreamSwitcher({
  value,
  onChange,
  slots,
  activeSlotIndexes,
}: MultistreamProps) {
  const activeSet = new Set(activeSlotIndexes);
  const composedActive = value === 'composed';

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => onChange('composed')}
        className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium text-left transition-all duration-200 active:scale-[0.97] ${
          composedActive
            ? 'bg-brand text-white shadow-lg shadow-brand/20'
            : 'bg-zinc-800/50 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
        }`}
      >
        <GridFour size={16} weight={composedActive ? 'fill' : 'regular'} />
        Все камеры
      </button>

      {slots.map((slot) => {
        const slotValue = `slot-${slot.index}` as const;
        const active = value === slotValue;
        const isLive = activeSet.has(slot.index);
        const label = slot.name?.trim() || `Slot ${slot.index}`;

        if (!isLive) {
          return (
            <div
              key={slot.index}
              role="button"
              aria-disabled="true"
              tabIndex={-1}
              title="Этот слот сейчас не публикует поток"
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium text-left bg-zinc-900/40 text-zinc-500 opacity-50 cursor-not-allowed select-none"
            >
              <VideoCamera size={16} weight="regular" />
              <span className="flex-1 truncate">{label}</span>
              <span className="text-[10px] uppercase tracking-wider font-mono text-zinc-500 border border-zinc-700/60 rounded-md px-1.5 py-0.5">
                нет сигнала
              </span>
            </div>
          );
        }

        return (
          <button
            key={slot.index}
            type="button"
            onClick={() => onChange(slotValue)}
            className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium text-left transition-all duration-200 active:scale-[0.97] ${
              active
                ? 'bg-brand text-white shadow-lg shadow-brand/20'
                : 'bg-zinc-800/50 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
            }`}
          >
            <VideoCamera size={16} weight={active ? 'fill' : 'regular'} />
            <span className="flex-1 truncate">{label}</span>
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 rounded-full ${
                active ? 'bg-white/80' : 'bg-emerald-500'
              }`}
            />
          </button>
        );
      })}
    </div>
  );
}
