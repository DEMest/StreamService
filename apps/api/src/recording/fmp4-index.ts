import * as fs from 'fs';

/**
 * Оглавление фрагментированного MP4 — того самого `download.mp4`, который
 * RecordingService склеивает с `-movflags frag_keyframe+empty_moov+default_base_moof`:
 * `ftyp` + `moov` (init) и дальше пары `moof`+`mdat`, по одной на каждый
 * ключевой кадр. По этому оглавлению строится HLS-VOD плейлист из байтовых
 * диапазонов (`EXT-X-BYTERANGE`) прямо поверх `download.mp4`.
 *
 * Зачем: плеер (hls.js) скачивает фрагмент плейлиста целиком, прежде чем
 * показать первый кадр. Раньше фрагментами служили сами файлы MediaMTX по
 * 3 часа (`recordSegmentDuration`) — 6 ГБ на фрагмент, которые браузер не
 * в состоянии ни дождаться, ни уместить в память. Фрагмент `download.mp4` —
 * один GOP, секунды видео и единицы мегабайт.
 *
 * Модуль чистый: байты читаются через `ByteSource`, поэтому один и тот же
 * разбор работает и по локальному файлу при финализации записи, и по
 * объекту S3 range-запросами — при переводе уже залитых архивов.
 */

/** Источник байт: локальный файл или объект S3. */
export interface ByteSource {
  size: number;
  read(offset: number, length: number): Promise<Buffer>;
}

export interface Fmp4Fragment {
  /** Смещение `moof`. */
  offset: number;
  /** `moof` + `mdat`, байт. */
  length: number;
  /** Секунды по видеодорожке. */
  duration: number;
}

export interface Fmp4Index {
  /** `ftyp` + `moov` — всё до первого `moof`; это `EXT-X-MAP`. */
  initLength: number;
  fragments: Fmp4Fragment[];
}

/**
 * Окно одного чтения. `moof` с двумя дорожками на GOP весит единицы КБ, так
 * что `moof` целиком и заголовок следующего за ним `mdat` приходят одним
 * запросом — по S3 это ровно один range-GET на фрагмент.
 */
const READ_WINDOW = 16 * 1024;
/** `moov` и `moof` — метаданные; больше этого — битый файл, а не большой. */
const MAX_META_BOX = 16 * 1024 * 1024;

interface Box {
  type: string;
  /** Смещение начала бокса (заголовка). */
  start: number;
  /** Смещение первого байта после заголовка. */
  body: number;
  /** Смещение первого байта после бокса. */
  end: number;
}

interface TrackInfo {
  timescale: number;
  defaultSampleDuration: number;
}

interface MoovInfo {
  videoTrackId: number;
  tracks: Map<number, TrackInfo>;
}

/** Окно поверх ByteSource: соседние мелкие чтения обслуживаются одним запросом. */
function windowed(src: ByteSource): ByteSource {
  let winStart = 0;
  let win: Buffer = Buffer.alloc(0);
  return {
    size: src.size,
    async read(offset, length) {
      if (offset >= winStart && offset + length <= winStart + win.length) {
        return win.subarray(offset - winStart, offset - winStart + length);
      }
      const want = Math.min(src.size - offset, Math.max(length, READ_WINDOW));
      win = await src.read(offset, want);
      winStart = offset;
      if (win.length < length) throw new Error(`short read at ${offset}: ${win.length}/${length}`);
      return win.subarray(0, length);
    },
  };
}

async function readBoxHeader(src: ByteSource, offset: number): Promise<Box> {
  if (offset + 8 > src.size) throw new Error(`truncated box header at ${offset}`);
  const head = await src.read(offset, Math.min(16, src.size - offset));
  const size32 = head.readUInt32BE(0);
  const type = head.toString('latin1', 4, 8);
  let headerLen = 8;
  let size: number;
  if (size32 === 1) {
    if (head.length < 16) throw new Error(`truncated largesize header at ${offset}`);
    size = Number(head.readBigUInt64BE(8));
    headerLen = 16;
  } else if (size32 === 0) {
    size = src.size - offset; // бокс до конца файла
  } else {
    size = size32;
  }
  if (size < headerLen) throw new Error(`invalid ${type} box size ${size} at ${offset}`);
  if (offset + size > src.size) {
    // Склейка, оборванная по таймауту/kill, кончается на полуслове. Такой файл
    // нельзя выдавать за готовую запись — пусть финализация упадёт и уйдёт в retry.
    throw new Error(`truncated ${type} box at ${offset}: needs ${size}, file has ${src.size - offset}`);
  }
  return { type, start: offset, body: offset + headerLen, end: offset + size };
}

/** Дочерние боксы внутри уже прочитанного в память контейнера. */
function* children(buf: Buffer, from: number, to: number): Generator<Box> {
  let o = from;
  while (o + 8 <= to) {
    const size32 = buf.readUInt32BE(o);
    const type = buf.toString('latin1', o + 4, o + 8);
    let headerLen = 8;
    let size = size32;
    if (size32 === 1) {
      size = Number(buf.readBigUInt64BE(o + 8));
      headerLen = 16;
    } else if (size32 === 0) {
      size = to - o;
    }
    if (size < headerLen || o + size > to) throw new Error(`invalid ${type} box inside container at ${o}`);
    yield { type, start: o, body: o + headerLen, end: o + size };
    o += size;
  }
}

function findChild(buf: Buffer, parent: Box, type: string): Box | undefined {
  for (const b of children(buf, parent.body, parent.end)) if (b.type === type) return b;
  return undefined;
}

function parseMoov(buf: Buffer): MoovInfo {
  const moov: Box = { type: 'moov', start: 0, body: 8, end: buf.length };
  const tracks = new Map<number, TrackInfo>();
  let videoTrackId = 0;
  let firstTrackId = 0;

  for (const box of children(buf, moov.body, moov.end)) {
    if (box.type === 'trak') {
      const tkhd = findChild(buf, box, 'tkhd');
      const mdia = findChild(buf, box, 'mdia');
      const mdhd = mdia && findChild(buf, mdia, 'mdhd');
      const hdlr = mdia && findChild(buf, mdia, 'hdlr');
      if (!tkhd || !mdhd) continue;
      // Full box: version(1) flags(3), затем времена 32 или 64 бита по версии.
      const trackId = buf.readUInt32BE(tkhd.body + (buf[tkhd.body] === 1 ? 20 : 12));
      const timescale = buf.readUInt32BE(mdhd.body + (buf[mdhd.body] === 1 ? 20 : 12));
      const prev = tracks.get(trackId);
      tracks.set(trackId, { timescale, defaultSampleDuration: prev?.defaultSampleDuration ?? 0 });
      if (!firstTrackId) firstTrackId = trackId;
      if (!videoTrackId && hdlr && buf.toString('latin1', hdlr.body + 8, hdlr.body + 12) === 'vide') {
        videoTrackId = trackId;
      }
    } else if (box.type === 'mvex') {
      for (const trex of children(buf, box.body, box.end)) {
        if (trex.type !== 'trex') continue;
        const trackId = buf.readUInt32BE(trex.body + 4);
        const defaultSampleDuration = buf.readUInt32BE(trex.body + 12);
        const prev = tracks.get(trackId);
        tracks.set(trackId, { timescale: prev?.timescale ?? 0, defaultSampleDuration });
      }
    }
  }

  // Без видео (чистый звук) шкалой времени служит первая дорожка.
  const timeTrack = videoTrackId || firstTrackId;
  if (!timeTrack || !tracks.get(timeTrack)?.timescale) throw new Error('moov has no usable track');
  return { videoTrackId: timeTrack, tracks };
}

/**
 * Время начала (`tfdt`) и суммарная длительность сэмплов (`trun`) фрагмента
 * по дорожке-шкале — в её тиках. `start` = null, если `tfdt` не записан.
 */
function parseMoof(buf: Buffer, moov: MoovInfo): { start: number | null; ticks: number } | null {
  const moof: Box = { type: 'moof', start: 0, body: 8, end: buf.length };
  for (const traf of children(buf, moof.body, moof.end)) {
    if (traf.type !== 'traf') continue;
    const tfhd = findChild(buf, traf, 'tfhd');
    if (!tfhd) continue;
    const tfhdFlags = buf.readUIntBE(tfhd.body + 1, 3);
    const trackId = buf.readUInt32BE(tfhd.body + 4);
    if (trackId !== moov.videoTrackId) continue;

    // Необязательные поля tfhd идут строго в порядке флагов (ISO/IEC 14496-12, 8.8.7).
    let p = tfhd.body + 8;
    if (tfhdFlags & 0x1) p += 8; // base-data-offset
    if (tfhdFlags & 0x2) p += 4; // sample-description-index
    let defaultDuration = moov.tracks.get(trackId)?.defaultSampleDuration ?? 0;
    if (tfhdFlags & 0x8) defaultDuration = buf.readUInt32BE(p);

    let start: number | null = null;
    let ticks = 0;
    for (const b of children(buf, traf.body, traf.end)) {
      if (b.type === 'tfdt') {
        start = buf[b.body] === 1 ? Number(buf.readBigUInt64BE(b.body + 4)) : buf.readUInt32BE(b.body + 4);
      } else if (b.type === 'trun') {
        const flags = buf.readUIntBE(b.body + 1, 3);
        const count = buf.readUInt32BE(b.body + 4);
        if (!(flags & 0x100)) {
          ticks += count * defaultDuration;
          continue;
        }
        let q = b.body + 8;
        if (flags & 0x1) q += 4; // data-offset
        if (flags & 0x4) q += 4; // first-sample-flags
        const perSample = 4 * [0x100, 0x200, 0x400, 0x800].filter((f) => flags & f).length;
        for (let i = 0; i < count; i++, q += perSample) ticks += buf.readUInt32BE(q);
      }
    }
    return { start, ticks };
  }
  return null;
}

/**
 * Проходит файл бокс за боксом от начала до конца. Попутно это проверка
 * целостности: обрыв посреди бокса — ошибка, а не «запись покороче».
 */
export async function indexFmp4(source: ByteSource): Promise<Fmp4Index> {
  const src = windowed(source);
  let moov: MoovInfo | null = null;
  let initLength = -1;
  const raw: { offset: number; end: number; start: number | null; ticks: number }[] = [];
  let pendingMoof: { offset: number; start: number | null; ticks: number } | null = null;

  for (let offset = 0; offset < src.size; ) {
    const box = await readBoxHeader(src, offset);
    if (box.type === 'moov') {
      if (box.end - box.start > MAX_META_BOX) throw new Error('moov is too large');
      moov = parseMoov(await src.read(box.start, box.end - box.start));
    } else if (box.type === 'moof') {
      if (!moov) throw new Error('moof before moov');
      if (pendingMoof) throw new Error(`moof at ${pendingMoof.offset} has no mdat`);
      if (box.end - box.start > MAX_META_BOX) throw new Error(`moof at ${box.start} is too large`);
      if (initLength < 0) initLength = box.start;
      const timing = parseMoof(await src.read(box.start, box.end - box.start), moov);
      pendingMoof = { offset: box.start, start: timing?.start ?? null, ticks: timing?.ticks ?? 0 };
    } else if (box.type === 'mdat' && pendingMoof) {
      raw.push({ ...pendingMoof, end: box.end });
      pendingMoof = null;
    }
    offset = box.end;
  }

  if (!moov) throw new Error('no moov box');
  if (pendingMoof) throw new Error(`moof at ${pendingMoof.offset} has no mdat`);
  if (raw.length === 0) throw new Error('no fragments');

  const timescale = moov.tracks.get(moov.videoTrackId)!.timescale;
  const fragments = raw.map((f, i) => {
    // Длительность — по разнице tfdt соседних фрагментов: она учитывает и
    // возможные дыры в таймлайне. Для последнего (и при отсутствии tfdt) —
    // сумма длительностей сэмплов.
    const next = raw[i + 1];
    const ticks = f.start !== null && next?.start != null && next.start > f.start ? next.start - f.start : f.ticks;
    return { offset: f.offset, length: f.end - f.offset, duration: ticks / timescale };
  });
  return { initLength, fragments };
}

/** ByteSource поверх локального файла. */
export async function fileByteSource(filePath: string): Promise<ByteSource & { close(): Promise<void> }> {
  const handle = await fs.promises.open(filePath, 'r');
  const { size } = await handle.stat();
  return {
    size,
    async read(offset, length) {
      const buf = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buf, 0, length, offset);
      return buf.subarray(0, bytesRead);
    },
    close: () => handle.close(),
  };
}
