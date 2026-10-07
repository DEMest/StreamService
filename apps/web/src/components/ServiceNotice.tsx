'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle, X } from '@phosphor-icons/react';

/**
 * Временное объявление сервиса над каталогом (/streams, /archive) — в той же
 * форме, что рекламная полоса: подпись и крестик сверху, полоса-таймер снизу
 * (`ad-drain` из globals.css). По окончании таймера плашка уходит до
 * следующего захода на страницу.
 *
 * До SHOW_UNTIL её видят все зрители на каждом заходе; только закрытие
 * крестиком запоминается в localStorage. После SHOW_UNTIL не показывается
 * никому — убирать её отдельной выкаткой не нужно, а сам компонент можно
 * удалить при случае.
 *
 * Новое объявление — новый NOTICE_ID, иначе его не увидят те, кто закрыл
 * прошлое.
 */
const NOTICE_ID = 'archive-fixed-2026-10';
/** Конец показа: двое суток с выкатки, по Новосибирску (UTC+7). */
const SHOW_UNTIL = Date.parse('2026-10-09T18:00:00+07:00');
const VISIBLE_MS = 20_000;
const STORAGE_KEY = `notice:${NOTICE_ID}`;

function wasClosed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    // Приватный режим Safari и отключённое хранилище — показываем, но не запоминаем.
    return false;
  }
}

function rememberClosed() {
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    /* см. wasClosed */
  }
}

export function ServiceNotice({ showArchiveLink = false }: { showArchiveLink?: boolean }) {
  // Решение о показе — только на клиенте: localStorage на сервере нет, а
  // отрисованная там плашка мигала бы у тех, кто её уже закрыл. Срок тоже
  // проверяется здесь: статически пререндеренная страница не знает «сейчас».
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (Date.now() >= SHOW_UNTIL || wasClosed()) return;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), VISIBLE_MS);
    return () => clearTimeout(timer);
  }, []);

  function close() {
    rememberClosed();
    setVisible(false);
  }

  return (
    <AnimatePresence initial={false}>
      {visible && (
        <motion.aside
          role="status"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, height: 0, marginBottom: 0 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="mb-5 rounded-xl border border-white/15 bg-surface-elevated overflow-hidden shadow-lg shadow-black/20"
        >
          <div className="flex items-center justify-between px-3 py-1.5 bg-black/40">
            <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">Новости сервиса</span>
            <button
              onClick={close}
              aria-label="Закрыть"
              className="w-5 h-5 -mr-1 rounded-md hover:bg-white/10 flex items-center justify-center text-zinc-500 hover:text-white border-none bg-transparent cursor-pointer"
            >
              <X size={11} weight="bold" />
            </button>
          </div>

          <div className="flex items-start gap-3 px-4 py-3.5">
            <CheckCircle size={22} weight="fill" className="shrink-0 mt-px text-emerald-400" />
            <div className="flex flex-col gap-1 min-w-0 max-w-3xl">
              <p className="text-sm font-semibold text-zinc-100">Архив снова работает</p>
              <p className="text-[13px] text-zinc-400 leading-relaxed">
                Спасибо всем, кто написал нам о проблеме: длинные записи не открывались, теперь это
                исправлено. А ещё записи в архиве больше не удаляются через неделю — они хранятся,
                пока организация сама их не удалит.
                {showArchiveLink && (
                  <>
                    {' '}
                    <Link href="/archive" className="text-brand no-underline hover:text-brand-hover transition-colors whitespace-nowrap">
                      Перейти в архив →
                    </Link>
                  </>
                )}
              </p>
            </div>
          </div>

          <div className="h-[3px] bg-white/10 overflow-hidden">
            <div className="h-full bg-brand" style={{ animation: `ad-drain ${VISIBLE_MS / 1000}s linear forwards` }} />
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
