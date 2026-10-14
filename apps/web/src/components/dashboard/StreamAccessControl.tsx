'use client';

import { useEffect, useState } from 'react';
import { ArrowsClockwise, Check, Copy, GlobeSimple, LockSimple } from '@phosphor-icons/react';

export interface StreamAccessControlProps {
  isPublic: boolean;
  isLive: boolean;
  /** Ссылка для зрителей приватного стрима; `null`, пока стрим публичный. */
  privateLink: string | null;
  onChange: (isPublic: boolean) => void;
  onRotate: () => void;
  pending: boolean;
  rotatePending: boolean;
  onCopy: (text: string) => void;
}

/**
 * Режим доступа стрима в студии: переключатель «Приватная ↔ Публичная» и,
 * для приватной, ссылка-приглашение.
 *
 * Приватный режим — чтобы организация проверила качество эфира без зрителей:
 * обычный адрес стрима тогда закрыт целиком (плеер, архив, чат, превью), стрим
 * пропадает из каталога и поиска. Поэтому закрытие идущего эфира
 * переспрашивает — оно отключает всех, кто смотрит прямо сейчас.
 */
export function StreamAccessControl({
  isPublic,
  isLive,
  privateLink,
  onChange,
  onRotate,
  pending,
  rotatePending,
  onCopy,
}: StreamAccessControlProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  function toggle() {
    const nextPublic = !isPublic;
    if (
      !nextPublic &&
      isLive &&
      !confirm(
        'Сделать трансляцию приватной?\n\nВсе, кто смотрит сейчас, будут отключены. Обычная ссылка перестанет работать — смотреть можно будет только по новой ссылке-приглашению.',
      )
    ) {
      return;
    }
    onChange(nextPublic);
  }

  function rotate() {
    if (confirm('Сменить ссылку-приглашение?\n\nСтарая перестанет работать сразу, все, кто смотрит по ней, будут отключены.')) {
      onRotate();
    }
  }

  function copy() {
    if (!privateLink) return;
    onCopy(privateLink);
    setCopied(true);
  }

  return (
    <div className="flex flex-col rounded-lg border border-zinc-800 bg-surface-primary">
      <div className="flex items-center justify-between gap-4 p-3.5">
        <div className="flex items-start gap-3 min-w-0">
          <span
            className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-200 ${
              isPublic ? 'bg-emerald-500/15 text-emerald-300' : 'bg-zinc-800 text-zinc-300'
            }`}
          >
            {isPublic ? <GlobeSimple size={16} weight="bold" /> : <LockSimple size={16} weight="bold" />}
          </span>
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-sm font-medium text-zinc-200">
              {isPublic ? 'Публичная трансляция' : 'Приватная трансляция'}
            </span>
            <span className="text-xs leading-snug text-zinc-500">
              {isPublic
                ? 'Видна всем: в каталоге, поиске и архиве.'
                : 'Только по ссылке-приглашению. Обычный адрес закрыт, в каталоге и поиске стрима нет.'}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          <span
            className={`hidden text-xs transition-colors sm:inline ${isPublic ? 'text-zinc-600' : 'font-medium text-zinc-200'}`}
            aria-hidden
          >
            Приватная
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={isPublic}
            aria-label="Публичная трансляция"
            onClick={toggle}
            disabled={pending}
            className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-primary disabled:cursor-wait disabled:opacity-60 ${
              isPublic ? 'bg-emerald-500' : 'bg-zinc-700'
            }`}
          >
            <span
              className={`inline-block h-6 w-6 rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,0.35)] transition-transform duration-200 ease-out ${
                isPublic ? 'translate-x-[22px]' : 'translate-x-[2px]'
              }`}
            />
          </button>
          <span
            className={`hidden text-xs transition-colors sm:inline ${isPublic ? 'font-medium text-zinc-200' : 'text-zinc-600'}`}
            aria-hidden
          >
            Публичная
          </span>
        </div>
      </div>

      {!isPublic && privateLink && (
        <div className="flex flex-col gap-2.5 border-t border-zinc-800/70 p-3.5">
          <label className="text-xs text-zinc-500" htmlFor="private-link">
            Ссылка-приглашение
          </label>
          <div className="flex gap-2">
            <input
              id="private-link"
              readOnly
              value={privateLink}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-surface-elevated px-3 py-2 font-mono text-xs text-zinc-300 outline-none focus:border-zinc-500"
            />
            <button
              type="button"
              onClick={copy}
              className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 transition-all hover:bg-zinc-700 hover:text-zinc-100 active:scale-[0.98]"
            >
              {copied ? <Check size={12} weight="bold" className="text-emerald-300" /> : <Copy size={12} />}
              {copied ? 'Скопировано' : 'Копировать'}
            </button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] leading-snug text-zinc-600">
              Ссылка попала не тем людям — смените её: старая сразу перестанет работать.
            </span>
            <button
              type="button"
              onClick={rotate}
              disabled={rotatePending}
              className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:cursor-wait disabled:opacity-50"
            >
              <ArrowsClockwise size={12} className={rotatePending ? 'animate-spin' : ''} />
              Сменить ссылку
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
