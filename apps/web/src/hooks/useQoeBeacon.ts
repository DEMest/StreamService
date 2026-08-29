'use client';

import { useCallback, useEffect, useRef } from 'react';

/**
 * Реже нельзя — потеряем короткие всплески подвисаний; чаще незачем: это
 * метрика ёмкости, а не трассировка воспроизведения.
 */
const BEACON_INTERVAL_MS = 15_000;

export interface QoeBeacon {
  /** Плеер обнаружил подвисание буфера. */
  onStall: () => void;
  /** Сменилось качество: имя каталога рендишена (`hd`, `p720`…) либо null. */
  onQuality: (rendition: string | null) => void;
  /** Фрагмент догрузился за столько миллисекунд. */
  onFragLoad: (ms: number) => void;
}

/**
 * Телеметрия плеера: раз в 15 секунд отправляет счётчики за интервал.
 *
 * Смысл именно в подвисаниях и времени загрузки фрагмента. Загрузка сервера
 * говорит, сколько он отдаёт, но не говорит, хорошо ли зрителю; а решение о
 * CDN принимается по второму. Это единственный сигнал, который отличает
 * «сервер занят» от «зрителю уже плохо».
 *
 * Идентификатор вкладки случайный и живёт только в памяти страницы — после
 * перезагрузки он другой. Ничего, что относилось бы к человеку, не
 * отправляется и не сохраняется.
 */
export function useQoeBeacon({
  orgSlug,
  streamSlug,
  enabled,
}: {
  orgSlug: string;
  streamSlug: string;
  enabled: boolean;
}): QoeBeacon {
  const clientId = useRef(Math.random().toString(36).slice(2) + Date.now().toString(36));
  const stalls = useRef(0);
  const stallMs = useRef(0);
  const stallStartedAt = useRef<number | null>(null);
  const rendition = useRef<string | null>(null);
  const fragLoads = useRef<number[]>([]);

  const onStall = useCallback(() => {
    stalls.current += 1;
    // Начало отсчёта длительности: конец засчитается, когда доедет фрагмент.
    if (stallStartedAt.current === null) stallStartedAt.current = Date.now();
  }, []);

  const onQuality = useCallback((name: string | null) => {
    rendition.current = name;
  }, []);

  const onFragLoad = useCallback((ms: number) => {
    if (stallStartedAt.current !== null) {
      stallMs.current += Date.now() - stallStartedAt.current;
      stallStartedAt.current = null;
    }
    fragLoads.current.push(ms);
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const timer = setInterval(() => {
      const loads = fragLoads.current;

      // Молчим, если за интервал не догрузилось ни одного фрагмента.
      // Открытая вкладка с остановленным видео канал не ест, и считать её
      // зрителем — значит вернуться к подсчёту вкладок, от которого мы и
      // уходили. Плеер на паузе добирает буфер и замолкает сам через минуту.
      if (loads.length === 0) {
        stalls.current = 0;
        stallMs.current = 0;
        return;
      }

      const body = JSON.stringify({
        streamKey: `${orgSlug}/${streamSlug}`,
        clientId: clientId.current,
        rendition: rendition.current,
        stalls: stalls.current,
        stallMs: stallMs.current,
        fragLoadMs: Math.round(loads.reduce((a, b) => a + b, 0) / loads.length),
      });

      // Счётчики обнуляются сразу: интервал закрыт, что бы дальше ни случилось
      // с самой отправкой.
      stalls.current = 0;
      stallMs.current = 0;
      fragLoads.current = [];

      // keepalive: вкладку могут закрыть ровно в момент отправки, и обычный
      // запрос отменился бы вместе с ней.
      void fetch('/api/v1/public/qoe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => {
        // Сбой метрики не должен быть виден зрителю ничем — ни ошибкой в
        // консоли, ни задержкой воспроизведения.
      });
    }, BEACON_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [orgSlug, streamSlug, enabled]);

  return { onStall, onQuality, onFragLoad };
}
