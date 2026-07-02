'use client';

import { useEffect, useRef, useState } from 'react';
import { CaretDown, Check } from '@phosphor-icons/react';

export type RecordingMode = 'auto' | 'manual';

export interface RecordingControlProps {
  enabled: boolean;
  mode: RecordingMode;
  /** Patch вызывается с тем что изменилось (enabled или mode), а не с обоими сразу. */
  onPatch: (patch: { enabled?: boolean; mode?: RecordingMode }) => void;
  pending: boolean;
  /** Если false — кнопка/dropdown disabled (например когда нет Stream'а). */
  available?: boolean;
}

/**
 * Кнопка-переключатель «Идёт запись / Запись выкл.» + popover с явным
 * визуальным выбором режима (auto/manual). Используется в Studio-странице.
 */
export function RecordingControl({
  enabled,
  mode,
  onPatch,
  pending,
  available = true,
}: RecordingControlProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div ref={wrapRef} className="relative flex items-stretch">
      <button
        onClick={() => available && onPatch({ enabled: !enabled })}
        disabled={pending || !available}
        title={
          !available
            ? 'Нет активного стрима'
            : enabled
              ? 'Запись включена — клик чтобы выключить'
              : 'Запись выключена — клик чтобы включить'
        }
        className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-l-lg transition-all active:scale-[0.98] cursor-pointer disabled:opacity-50 disabled:cursor-wait ${
          enabled
            ? 'bg-red-500/15 hover:bg-red-500/25 text-red-300 hover:text-red-200'
            : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200'
        }`}
      >
        <span
          className={`w-2 h-2 rounded-full ${
            enabled ? 'bg-red-400 animate-pulse' : 'bg-zinc-600'
          }`}
        />
        {enabled ? 'Идёт запись' : 'Запись выкл.'}
      </button>
      <button
        onClick={() => available && setOpen((v) => !v)}
        disabled={pending || !available}
        title={!available ? 'Нет активного стрима' : 'Настройки записи'}
        className={`flex items-center gap-1 px-2 py-1.5 border-l border-zinc-900 rounded-r-lg transition-all active:scale-[0.98] cursor-pointer disabled:opacity-50 ${
          enabled
            ? 'bg-red-500/15 hover:bg-red-500/25 text-red-300 hover:text-red-200'
            : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200'
        }`}
      >
        <span
          className={`text-[10px] font-semibold tracking-wide ${
            mode === 'auto' ? 'text-emerald-300' : 'text-zinc-400'
          }`}
        >
          {mode === 'auto' ? 'AUTO' : 'MAN'}
        </span>
        <CaretDown size={12} />
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1.5 z-30 min-w-[280px] bg-surface-elevated border border-zinc-800 rounded-lg shadow-xl p-2 space-y-1">
          <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider px-2 py-1">
            При публикации стрима
          </div>
          <ModeOption
            label="Автоматически"
            description="Запись включается сама при первом publish-сигнале"
            selected={mode === 'auto'}
            onSelect={() => onPatch({ mode: 'auto' })}
          />
          <ModeOption
            label="Только вручную"
            description="Записывается только когда нажата кнопка слева"
            selected={mode === 'manual'}
            onSelect={() => onPatch({ mode: 'manual' })}
          />
        </div>
      )}
    </div>
  );
}

function ModeOption({
  label,
  description,
  selected,
  onSelect,
}: {
  label: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left flex items-start gap-2.5 px-2.5 py-2 rounded-md border transition-colors cursor-pointer ${
        selected
          ? 'bg-emerald-500/10 border-emerald-500/40'
          : 'bg-transparent border-transparent hover:bg-zinc-800/60'
      }`}
    >
      <span
        className={`mt-[3px] shrink-0 w-4 h-4 rounded-full flex items-center justify-center transition-colors ${
          selected
            ? 'bg-emerald-500 border border-emerald-400'
            : 'border border-zinc-600 bg-transparent'
        }`}
      >
        {selected && <Check size={10} weight="bold" className="text-white" />}
      </span>
      <span className="flex-1 min-w-0">
        <span
          className={`block text-sm font-medium ${
            selected ? 'text-emerald-200' : 'text-zinc-100'
          }`}
        >
          {label}
        </span>
        <span className="block text-xs text-zinc-500 mt-0.5">{description}</span>
      </span>
    </button>
  );
}
