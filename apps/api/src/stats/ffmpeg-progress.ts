/**
 * Разбор файла `-progress`, который пишет HLS-FFmpeg из `on-ready.sh`.
 *
 * Формат — блоки `ключ=значение` по строке, каждый блок закрывается строкой
 * `progress=continue` (или `progress=end` у последнего). FFmpeg дописывает
 * файл в конец, поэтому актуальное состояние — ПОСЛЕДНИЙ закрытый блок.
 *
 * Здесь только парсинг: чтение хвоста файла — в StatsService, чтобы эта часть
 * оставалась чистой и тестировалась без файловой системы.
 */

export interface FfmpegProgress {
  /** Кадров закодировано с начала сессии. */
  frame: number | null;
  /** Текущий fps кодирования. */
  fps: number | null;
  /** Исходящий битрейт, кбит/с (сумма по всем дорожкам лесенки). */
  outKbps: number | null;
  /** Накопительно: кадров ВЫБРОШЕНО, потому что энкодер не успевал. */
  dropFrames: number | null;
  /** Накопительно: кадров продублировано (источник медленнее целевого fps). */
  dupFrames: number | null;
  /** 1.0 = ровно realtime. Ниже — сервер не успевает за источником. */
  speed: number | null;
  /** Сколько секунд эфира обработано. */
  outTimeSeconds: number | null;
  /** true — FFmpeg дописал `progress=end`, то есть завершился штатно. */
  ended: boolean;
}

const EMPTY: FfmpegProgress = {
  frame: null, fps: null, outKbps: null, dropFrames: null,
  dupFrames: null, speed: null, outTimeSeconds: null, ended: false,
};

/** «6000.5kbits/s» → 6000.5; «N/A» и мусор → null. */
function parseBitrate(raw: string): number | null {
  const m = /^([\d.]+)\s*kbits\/s$/.exec(raw.trim());
  if (!m) return null;
  const v = parseFloat(m[1]);
  return Number.isFinite(v) ? v : null;
}

/** «1.01x» → 1.01. FFmpeg на старте пишет «N/A». */
function parseSpeed(raw: string): number | null {
  const m = /^([\d.]+)x$/.exec(raw.trim());
  if (!m) return null;
  const v = parseFloat(m[1]);
  return Number.isFinite(v) ? v : null;
}

function parseNum(raw: string): number | null {
  const v = parseFloat(raw.trim());
  return Number.isFinite(v) ? v : null;
}

/**
 * Достаёт последний ЗАКРЫТЫЙ блок из хвоста progress-файла.
 *
 * Хвост почти всегда начинается с середины блока (читаем фиксированное окно
 * с конца файла) и заканчивается недописанным блоком — берём последний, у
 * которого встретился ключ `progress`, иначе показали бы полуфабрикат с
 * поехавшими полями.
 */
export function parseFfmpegProgress(tail: string): FfmpegProgress | null {
  const lines = tail.split('\n');

  // Границы блоков — индексы строк `progress=...`.
  const boundaries: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('progress=')) boundaries.push(i);
  }
  if (boundaries.length === 0) return null;

  const endIdx = boundaries[boundaries.length - 1];
  // Начало блока — строка после предыдущей границы (или начало хвоста, но
  // тогда блок может быть обрезан — это не страшно, недостающие поля = null).
  const startIdx = boundaries.length >= 2 ? boundaries[boundaries.length - 2] + 1 : 0;

  const kv = new Map<string, string>();
  for (let i = startIdx; i <= endIdx; i++) {
    const eq = lines[i].indexOf('=');
    if (eq <= 0) continue;
    kv.set(lines[i].slice(0, eq).trim(), lines[i].slice(eq + 1));
  }

  const outTimeUs = kv.has('out_time_us') ? parseNum(kv.get('out_time_us')!) : null;

  return {
    ...EMPTY,
    frame: kv.has('frame') ? parseNum(kv.get('frame')!) : null,
    fps: kv.has('fps') ? parseNum(kv.get('fps')!) : null,
    outKbps: kv.has('bitrate') ? parseBitrate(kv.get('bitrate')!) : null,
    dropFrames: kv.has('drop_frames') ? parseNum(kv.get('drop_frames')!) : null,
    dupFrames: kv.has('dup_frames') ? parseNum(kv.get('dup_frames')!) : null,
    speed: kv.has('speed') ? parseSpeed(kv.get('speed')!) : null,
    outTimeSeconds: outTimeUs === null ? null : outTimeUs / 1e6,
    ended: kv.get('progress')?.trim() === 'end',
  };
}
