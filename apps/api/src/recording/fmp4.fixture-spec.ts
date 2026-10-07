/**
 * Синтетический фрагментированный MP4 для тестов — той же формы, что
 * `download.mp4` (ftyp + moov с mvex, затем пары moof+mdat). Имя файла
 * оканчивается на `-spec.ts`: в сборку его не пускает `**\/*spec.ts` из
 * tsconfig.build.json, а jest (`\.spec\.ts$`) не считает его тестом.
 */
import type { ByteSource } from './fmp4-index';

const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const u64 = (n: number) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(n));
  return b;
};
const fullBox = (version: number, flags: number) => Buffer.from([version, (flags >> 16) & 0xff, (flags >> 8) & 0xff, flags & 0xff]);

export function box(type: string, ...payload: Buffer[]): Buffer {
  const body = Buffer.concat(payload);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, body]);
}

export interface TrackSpec {
  id: number;
  timescale: number;
  handler: 'vide' | 'soun';
  /** Дефолтная длительность сэмпла из trex. */
  trexDuration?: number;
}

function trak(t: TrackSpec): Buffer {
  return box(
    'trak',
    box('tkhd', fullBox(0, 3), u32(0), u32(0), u32(t.id), Buffer.alloc(68)),
    box(
      'mdia',
      box('mdhd', fullBox(0, 0), u32(0), u32(0), u32(t.timescale), u32(0), u32(0)),
      box('hdlr', fullBox(0, 0), u32(0), Buffer.from(t.handler, 'latin1'), Buffer.alloc(12), Buffer.from('h\0')),
    ),
  );
}

export function init(tracks: TrackSpec[]): Buffer {
  return Buffer.concat([
    box('ftyp', Buffer.from('iso5', 'latin1'), u32(512), Buffer.from('iso5iso6mp41', 'latin1')),
    box(
      'moov',
      box('mvhd', fullBox(0, 0), Buffer.alloc(96)),
      ...tracks.map(trak),
      box('mvex', ...tracks.map((t) => box('trex', fullBox(0, 0), u32(t.id), u32(1), u32(t.trexDuration ?? 0), u32(0), u32(0)))),
    ),
  ]);
}

export interface TrafSpec {
  trackId: number;
  /** baseMediaDecodeTime; undefined — без tfdt. */
  tfdt?: number;
  /** Длительности сэмплов в trun (флаг 0x100). */
  durations?: number[];
  /** Вместо durations: число сэмплов без длительностей в trun... */
  sampleCount?: number;
  /** ...и дефолт из tfhd (флаг 0x8). Не задан — берётся trex. */
  tfhdDuration?: number;
}

function traf(t: TrafSpec): Buffer {
  const tfhdFlags = 0x020000 | (t.tfhdDuration !== undefined ? 0x8 : 0);
  const tfhd = box('tfhd', fullBox(0, tfhdFlags), u32(t.trackId), ...(t.tfhdDuration !== undefined ? [u32(t.tfhdDuration)] : []));
  const tfdt = t.tfdt !== undefined ? [box('tfdt', fullBox(1, 0), u64(t.tfdt))] : [];
  let trun: Buffer;
  if (t.durations) {
    // data-offset (0x1) + duration (0x100) + size (0x200) — как пишет ffmpeg для звука.
    const samples = t.durations.map((d) => Buffer.concat([u32(d), u32(100)]));
    trun = box('trun', fullBox(0, 0x000301), u32(t.durations.length), u32(0), ...samples);
  } else {
    const count = t.sampleCount ?? 0;
    trun = box('trun', fullBox(0, 0x000201), u32(count), u32(0), ...Array.from({ length: count }, () => u32(100)));
  }
  return box('traf', tfhd, ...tfdt, trun);
}

export function fragment(trafs: TrafSpec[], mdatBytes = 1000, seq = 1): Buffer {
  return Buffer.concat([
    box('moof', box('mfhd', fullBox(0, 0), u32(seq)), ...trafs.map(traf)),
    box('mdat', Buffer.alloc(mdatBytes, 0xab)),
  ]);
}

export const VIDEO: TrackSpec = { id: 1, timescale: 90000, handler: 'vide' };
export const AUDIO: TrackSpec = { id: 2, timescale: 48000, handler: 'soun' };

/**
 * Файл из `count` фрагментов по `gopSeconds` (25 кадров/с видео, 1024-сэмпловые
 * кадры звука). Видео-traf идёт ВТОРЫМ — шкалой обязана быть видеодорожка,
 * а не первая попавшаяся.
 */
export function makeFmp4(count: number, gopSeconds = 2, mdatBytes = 1000): Buffer {
  const frames = gopSeconds * 25;
  const frameTicks = VIDEO.timescale / 25;
  const parts = [init([AUDIO, VIDEO])];
  for (let i = 0; i < count; i++) {
    parts.push(fragment([
      { trackId: AUDIO.id, tfdt: Math.round(i * gopSeconds * AUDIO.timescale), durations: [1024, 1024] },
      { trackId: VIDEO.id, tfdt: i * frames * frameTicks, durations: Array(frames).fill(frameTicks) },
    ], mdatBytes, i + 1));
  }
  return Buffer.concat(parts);
}

/** ByteSource поверх буфера; `reads` — число обращений (= range-запросов к S3). */
export function memorySource(buf: Buffer): ByteSource & { reads: number } {
  const src = {
    size: buf.length,
    reads: 0,
    async read(offset: number, length: number) {
      src.reads++;
      return buf.subarray(offset, offset + length);
    },
  };
  return src;
}
