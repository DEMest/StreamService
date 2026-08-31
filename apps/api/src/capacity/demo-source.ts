import { CapacityIncident, CapacityPoint, RenditionShare } from './capacity.types';
import { LADDER } from './ladder';

/**
 * Синтетические данные для стенда.
 *
 * Нужны затем, что экран ёмкости имеет смысл только под нагрузкой, а на
 * машине разработчика зрителей нет вообще. Проверять вёрстку на нулях —
 * значит не проверить ничего: вся суть экрана в том, как он выглядит, когда
 * канал заполняется.
 *
 * Данные помечаются флагом `demo` и подписываются на самом экране. Молча
 * подсунуть выдуманный потолок хуже, чем не показать никакого.
 */


/** Шаг точки на графике. 30 с × 120 = час истории. */
const STEP_MS = 30_000;
const POINTS = 120;

/** Детерминированный шум: одинаковый в пределах минуты, чтобы график не дёргался. */
function noise(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Кривая зрителей: разогрев, выход на плато, короткий пик к концу.
 * Отдалённо повторяет форму реального турнира — плавный вход, всплеск на
 * финале.
 */
function viewersAt(i: number): number {
  const p = i / (POINTS - 1);
  const ramp = 1 - Math.exp(-p * 4);
  const finale = p > 0.82 ? (p - 0.82) * 5.5 : 0;
  return Math.round((30 + 150 * ramp + 120 * finale) * (0.94 + noise(i) * 0.12));
}

/**
 * Распределение по ступеням. Чем плотнее канал, тем больше зрителей ABR
 * сам сдвигает вниз — именно этот эффект и делает потолок «плавающим», ради
 * него весь экран и затевался.
 */
export function mixAt(viewers: number): RenditionShare[] {
  const pressure = Math.min(1, viewers / 260);
  const weights = [
    0.42 - 0.3 * pressure, // Оригинал уходит первым
    0.36 - 0.05 * pressure,
    0.17 + 0.2 * pressure,
    0.05 + 0.15 * pressure,
  ];
  const sum = weights.reduce((a, b) => a + b, 0);
  const shares = weights.map((w) => w / sum);

  // Раздаём зрителей по долям, остаток — самой массовой ступени, чтобы
  // сумма по ступеням сходилась с общим числом зрителей ровно.
  const counts = shares.map((s) => Math.floor(s * viewers));
  const rest = viewers - counts.reduce((a, b) => a + b, 0);
  const biggest = shares.indexOf(Math.max(...shares));
  counts[biggest] += rest;

  return LADDER.map((r, i) => ({
    ...r,
    viewers: counts[i],
    share: viewers > 0 ? counts[i] / viewers : 0,
  }));
}

/** Отдача, Мбит/с — сумма «вес ступени × сидящих на ней». */
export function egressOf(mix: RenditionShare[]): number {
  return +mix.reduce((acc, r) => acc + r.viewers * r.bitrateMbps, 0).toFixed(1);
}

export function demoHistory(now: number): CapacityPoint[] {
  const points: CapacityPoint[] = [];
  for (let i = 0; i < POINTS; i++) {
    const viewers = viewersAt(i);
    const mix = mixAt(viewers);
    const egressMbps = egressOf(mix);
    // Ближе к потолку кэш начинает промахиваться, а зрители — подвисать.
    const strain = Math.max(0, egressMbps / 600 - 0.75);
    points.push({
      t: now - (POINTS - 1 - i) * STEP_MS,
      viewers,
      egressMbps,
      cacheHitRatio: +(0.94 - strain * 0.5 - noise(i + 7) * 0.03).toFixed(3),
      errorRate: +(strain * 0.06 + noise(i + 13) * 0.002).toFixed(4),
      stallRatio: +(strain * 0.5 + noise(i + 21) * 0.01).toFixed(3),
    });
  }
  return points;
}

/**
 * Раскладка нагрузки по стримам для стенда: два корта с разной посещаемостью.
 * Без неё карточка «По стримам» на стенде пуста, и проверить её нечем.
 */
export function demoStreams(viewers: number, egressMbps: number) {
  const split = [
    { streamKey: 'liga/court-a', weight: 0.62 },
    { streamKey: 'liga/', weight: 0.38 },
  ];
  return split.map((s) => ({
    streamKey: s.streamKey,
    viewers: Math.round(viewers * s.weight),
    egressMbps: +(egressMbps * s.weight).toFixed(1),
  }));
}

export function demoIncidents(now: number): CapacityIncident[] {
  return [
    {
      id: 'demo-1',
      kind: 'uplink',
      severity: 'crit',
      title: 'Канал занят более 80%',
      startedAt: now - 6 * 60_000,
      endedAt: null,
      peak: '87% канала',
    },
    {
      id: 'demo-2',
      kind: 'stalls',
      severity: 'warn',
      title: 'Подвисания у части зрителей',
      startedAt: now - 9 * 60_000,
      endedAt: now - 4 * 60_000,
      peak: '18% зрителей',
    },
    {
      id: 'demo-3',
      kind: 'encode',
      severity: 'warn',
      title: 'Кодирование не успевает за эфиром',
      startedAt: now - 52 * 60_000,
      endedAt: now - 47 * 60_000,
      peak: 'speed 0.86',
    },
  ];
}
