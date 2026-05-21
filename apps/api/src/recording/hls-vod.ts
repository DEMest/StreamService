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
 * Строит master.m3u8 — корневой playlist, ссылающийся на per-slot variants.
 * Для Step 2 (single slot) — одна запись slot-1/index.m3u8.
 */
export function buildMasterPlaylist(slots: Array<{ slotIndex: number; bandwidth: number; resolution: string }>): string {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:7', ''];

  for (const slot of slots) {
    lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${slot.bandwidth},RESOLUTION=${slot.resolution},NAME="slot-${slot.slotIndex}"`);
    lines.push(`slot-${slot.slotIndex}/index.m3u8`);
    lines.push('');
  }

  return lines.join('\n');
}
