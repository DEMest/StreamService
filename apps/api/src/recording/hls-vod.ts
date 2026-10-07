import type { Fmp4Fragment } from './fmp4-index';

/**
 * Склейка всех сегментов записи — единственная копия видео в архиве: и файл
 * для скачивания, и (байтовыми диапазонами через vod.m3u8) поток для плеера.
 */
export const DOWNLOAD_FILE = 'download.mp4';

/** Медиаплейлист записи — рядом с master.m3u8 и download.mp4. */
export const VOD_PLAYLIST = 'vod.m3u8';

/**
 * Минимальная длина куска плейлиста. Фрагмент `download.mp4` — один GOP; при
 * секундном GOP вышли бы десятки тысяч строк плейлиста и столько же запросов,
 * поэтому соседние фрагменты склеиваются в кусок не короче этого. GOP длиннее
 * (OBS/vMix часто ставят ~10 с) — кусок равен одному GOP: резать внутри него
 * без перекодирования нельзя.
 */
export const VOD_CHUNK_TARGET_SECONDS = 6;

export interface VodChunk {
  offset: number;
  length: number;
  duration: number;
}

/**
 * Склеивает подряд идущие фрагменты в куски не короче `targetSeconds`.
 * Склеиваются только смежные по байтам фрагменты: кусок обязан быть одним
 * непрерывным диапазоном файла.
 */
export function groupFragments(fragments: Fmp4Fragment[], targetSeconds = VOD_CHUNK_TARGET_SECONDS): VodChunk[] {
  const chunks: VodChunk[] = [];
  let cur: VodChunk | null = null;
  for (const f of fragments) {
    if (cur && cur.duration < targetSeconds && cur.offset + cur.length === f.offset) {
      cur.length += f.length;
      cur.duration += f.duration;
      continue;
    }
    cur = { ...f };
    chunks.push(cur);
  }
  return chunks;
}

/**
 * HLS-VOD плейлист из байтовых диапазонов одного fMP4-файла: `EXT-X-MAP` —
 * его init (`ftyp`+`moov`), каждый кусок — `EXT-X-BYTERANGE` внутри того же
 * файла. Плеер качает секунды видео, а не файл целиком; отдельная нарезка в
 * S3 не нужна — `download.mp4` одновременно и поток для браузера, и файл для
 * скачивания.
 */
export function buildByteRangeVodPlaylist(mediaUri: string, initLength: number, chunks: VodChunk[]): string {
  const targetDuration = chunks.length === 0 ? 0 : Math.ceil(Math.max(...chunks.map((c) => c.duration)));

  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    `#EXT-X-TARGETDURATION:${targetDuration}`,
    '#EXT-X-PLAYLIST-TYPE:VOD',
    '#EXT-X-INDEPENDENT-SEGMENTS',
    `#EXT-X-MAP:URI="${mediaUri}",BYTERANGE="${initLength}@0"`,
  ];

  for (const c of chunks) {
    lines.push(`#EXTINF:${c.duration.toFixed(3)},`);
    lines.push(`#EXT-X-BYTERANGE:${c.length}@${c.offset}`);
    lines.push(mediaUri);
  }

  lines.push('#EXT-X-ENDLIST');
  lines.push('');  // trailing newline

  return lines.join('\n');
}

/**
 * Строит master.m3u8 — корневой playlist записи. Variant ровно один:
 * `RecordingService` создаёт на трансляцию ровно один `Recording`.
 */
export function buildMasterPlaylist(variant: { uri: string; bandwidth: number; resolution: string }): string {
  return [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    '',
    `#EXT-X-STREAM-INF:BANDWIDTH=${variant.bandwidth},RESOLUTION=${variant.resolution}`,
    variant.uri,
    '',
  ].join('\n');
}

/**
 * Каталог старой нарезки, если master.m3u8 ещё в прежнем формате — variant
 * `slot-N/index.m3u8` поверх сырых сегментов MediaMTX по 3 часа. Иначе null.
 */
export function legacySlotDir(master: string): string | null {
  const m = master.match(/^(slot-\d+)\/index\.m3u8$/m);
  return m ? m[1] : null;
}
