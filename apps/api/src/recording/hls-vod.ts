export interface FmpSegment {
  filename: string;   // basename без пути, например 'seg-001.mp4'
  duration: number;   // секунды, float
}

/**
 * Строит HLS-VOD manifest для списка fmp4-сегментов.
 * Каждый сегмент должен быть самодостаточным fmp4 (с moov box внутри),
 * как пишет MediaMTX с recordFormat: fmp4.
 *
 * Не использует EXT-X-MAP — каждый сегмент играется независимо.
 */
export function buildHlsVodPlaylist(segments: FmpSegment[]): string {
  const targetDuration = segments.length === 0
    ? 0
    : Math.ceil(Math.max(...segments.map(s => s.duration)));

  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    `#EXT-X-TARGETDURATION:${targetDuration}`,
    '#EXT-X-PLAYLIST-TYPE:VOD',
  ];

  for (const seg of segments) {
    lines.push(`#EXTINF:${seg.duration.toFixed(3)},`);
    lines.push(seg.filename);
  }

  lines.push('#EXT-X-ENDLIST');
  lines.push('');  // trailing newline

  return lines.join('\n');
}

/**
 * Строит master.m3u8 — корневой playlist записи.
 *
 * Variant ровно один: `RecordingService.onStreamEnded` создаёт на трансляцию
 * ровно один `Recording`. Раньше функция принимала СПИСОК слотов под
 * многокамерный режим, которого в коде больше нет, и цикл по списку из одного
 * элемента обещал читателю гибкость, которой нет ни у вызывающего кода, ни у
 * плеера.
 *
 * А `slotIndex` остаётся параметром, а не зашитой единицей: это имя каталога
 * в архиве и в ключах S3 (`archive/<path>/<broadcastId>/slot-<n>/`), его же
 * хранит `Recording.slotIndex`. Зашив здесь `slot-1`, мы бы отдали плееру
 * плейлист, указывающий не в тот каталог, куда `convertRecording` реально
 * положил сегменты.
 *
 * Формат байт-в-байт совпадает с master.m3u8 уже залитых архивов — они
 * не перегенерируются и должны продолжать играть.
 */
export function buildMasterPlaylist(variant: { slotIndex: number; bandwidth: number; resolution: string }): string {
  return [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    '',
    `#EXT-X-STREAM-INF:BANDWIDTH=${variant.bandwidth},RESOLUTION=${variant.resolution},NAME="slot-${variant.slotIndex}"`,
    `slot-${variant.slotIndex}/index.m3u8`,
    '',
  ].join('\n');
}
