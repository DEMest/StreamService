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
  /**
   * Признак жизни от плеера, который не умеет сообщать про фрагменты.
   *
   * Нативный HLS в Safari (весь iOS) не даёт ни событий загрузки фрагментов,
   * ни списка уровней — а его зрители потребляют канал наравне со всеми. Без
   * этого сигнала они бы не попадали в счётчик, и «вес среднего зрителя»
   * оказался бы завышен ровно на их долю: потолок занижался бы тем сильнее,
   * чем мобильнее зал.
   */
  onAlive: () => void;
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
  const rendition = useRef<string | null>(null);
  const fragLoads = useRef<number[]>([]);
  /** Плеер шевелился в текущем интервале — хотя бы просто продвигал время. */
  const alive = useRef(false);

  const onStall = useCallback(() => {
    stalls.current += 1;
  }, []);

  const onQuality = useCallback((name: string | null) => {
    rendition.current = name;
  }, []);

  const onAlive = useCallback(() => {
    alive.current = true;
  }, []);

  const onFragLoad = useCallback((ms: number) => {
    alive.current = true;
    fragLoads.current.push(ms);
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const timer = setInterval(() => {
      const loads = fragLoads.current;

      // Молчим, если плеер за интервал не подавал признаков жизни. Открытая
      // вкладка с остановленным видео канал не ест, и считать её зрителем —
      // значит вернуться к подсчёту вкладок, от которого мы и уходили. Плеер
      // на паузе добирает буфер и замолкает сам через минуту.
      if (!alive.current) {
        stalls.current = 0;
        return;
      }

      const body = JSON.stringify({
        streamKey: `${orgSlug}/${streamSlug}`,
        clientId: clientId.current,
        rendition: rendition.current,
        stalls: stalls.current,
        // Нативный плеер времени загрузки фрагмента не сообщает — тогда null,
        // а не выдуманный ноль: перцентиль обязан считаться по тем, кто его
        // действительно измерил.
        fragLoadMs:
          loads.length > 0 ? Math.round(loads.reduce((a, b) => a + b, 0) / loads.length) : null,
      });

      // Счётчики обнуляются сразу: интервал закрыт, что бы дальше ни случилось
      // с самой отправкой.
      stalls.current = 0;
      fragLoads.current = [];
      alive.current = false;

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

  return { onStall, onQuality, onFragLoad, onAlive };
}
