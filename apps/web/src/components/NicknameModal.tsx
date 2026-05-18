'use client';
import { useEffect, useState } from 'react';
import { ChatCircle, X } from '@phosphor-icons/react';

interface Props {
  onConfirm: (nickname: string) => void;
  onCancel?: () => void;
}

export function NicknameModal({ onConfirm, onCancel }: Props) {
  const [value, setValue] = useState('');

  useEffect(() => {
    if (!onCancel) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onCancel?.(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = value.trim();
    if (name) onConfirm(name);
  }

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50"
      onClick={onCancel ? () => onCancel() : undefined}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="relative bg-surface-elevated border border-zinc-800 rounded-xl p-6 flex flex-col gap-4 w-80 shadow-2xl shadow-black/50"
      >
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            aria-label="Закрыть"
            className="absolute top-2 right-2 text-zinc-500 hover:text-zinc-200 bg-transparent border-none w-8 h-8 flex items-center justify-center rounded-md cursor-pointer transition-colors"
          >
            <X size={16} />
          </button>
        )}
        <div className="flex items-center gap-2.5">
          <ChatCircle size={20} className="text-brand" weight="fill" />
          <h2 className="text-base font-semibold text-zinc-100">Введите никнейм для чата</h2>
        </div>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={32}
          placeholder="Ваш никнейм"
          className="px-3 py-2.5 bg-surface-primary border border-zinc-700 rounded-lg text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-brand focus:ring-1 focus:ring-brand/30 outline-none transition-colors"
          required
        />
        <button
          type="submit"
          className="py-2.5 bg-brand hover:bg-brand-hover text-white font-medium rounded-lg transition-all duration-200 active:scale-[0.98]"
        >
          Войти в чат
        </button>
      </form>
    </div>
  );
}
