'use client';
import { useState } from 'react';
import { ChatText } from '@phosphor-icons/react';
import { FeedbackModal } from '@/components/FeedbackModal';
import type { StreamContext } from '@/lib/feedback-context';

/**
 * `nav`   — пункт десктопной навигации в шапке
 * `menu`  — строка мобильного меню
 * `panel` — компактная строка в боковой панели плеера, рядом с «Архивом»
 */
type Variant = 'nav' | 'menu' | 'panel';

const VARIANT_CLASSES: Record<Variant, string> = {
  nav: 'px-3 py-1.5 rounded-lg text-sm text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/40 transition-colors bg-transparent border-none cursor-pointer',
  menu: 'flex items-center gap-2 px-4 py-3 text-zinc-400 hover:text-zinc-200 text-sm rounded-lg hover:bg-zinc-800/40 transition-colors bg-transparent border-none cursor-pointer text-left w-full',
  panel:
    'flex items-center gap-1.5 text-zinc-500 text-xs hover:text-zinc-300 transition-colors bg-transparent border-none cursor-pointer p-0 text-left',
};

interface TriggerProps {
  variant?: Variant;
  onClick: () => void;
}

/**
 * Только кнопка, без состояния. Нужна там, где сам триггер живёт в поддереве,
 * которое исчезает при открытии формы: мобильное меню шапки закрывается по
 * клику, и модалка, подвешенная к кнопке внутри него, размонтировалась бы
 * вместе с ней, так и не появившись. Состояние в таком месте держит родитель.
 */
export function FeedbackTrigger({ variant = 'nav', onClick }: TriggerProps) {
  return (
    <button
      type="button"
      onClick={(e) => {
        // На странице просмотра клики по плееру ставят паузу и прячут UI —
        // всплытие отсюда закрыло бы панель вместе с открытием формы.
        e.stopPropagation();
        onClick();
      }}
      className={VARIANT_CLASSES[variant]}
    >
      {variant === 'nav' ? (
        'Обратная связь'
      ) : (
        <>
          <ChatText size={variant === 'panel' ? 14 : 16} /> Обратная связь
        </>
      )}
    </button>
  );
}

interface Props {
  variant?: Variant;
  /** Слаги со страницы просмотра; без них берутся из адреса страницы. */
  context?: StreamContext;
}

/**
 * Кнопка вместе с формой. Годится там, где триггер остаётся смонтированным,
 * пока форма открыта, — боковые панели плеера, хлебные крошки архива.
 */
export function FeedbackButton({ variant = 'nav', context }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <FeedbackTrigger variant={variant} onClick={() => setOpen(true)} />
      {open && <FeedbackModal onClose={() => setOpen(false)} context={context} />}
    </>
  );
}
