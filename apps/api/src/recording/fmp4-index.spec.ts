import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileByteSource, indexFmp4 } from './fmp4-index';
import { AUDIO, VIDEO, box, fragment, init, makeFmp4, memorySource } from './fmp4.fixture-spec';

describe('indexFmp4', () => {
  it('отдаёт init (ftyp+moov) и по фрагменту на каждую пару moof+mdat', async () => {
    const file = makeFmp4(3, 2, 1000);
    const idx = await indexFmp4(memorySource(file));

    const head = init([AUDIO, VIDEO]);
    expect(idx.initLength).toBe(head.length);
    expect(idx.fragments).toHaveLength(3);
    // Фрагменты идут встык и покрывают файл до конца.
    expect(idx.fragments[0].offset).toBe(head.length);
    expect(idx.fragments[1].offset).toBe(idx.fragments[0].offset + idx.fragments[0].length);
    const last = idx.fragments[2];
    expect(last.offset + last.length).toBe(file.length);
    for (const f of idx.fragments) expect(f.duration).toBeCloseTo(2, 6);
  });

  it('берёт за шкалу видеодорожку, даже когда звук объявлен и записан первым', async () => {
    // В makeFmp4 audio-trak идёт первым в moov и первым traf в moof; длительность
    // звука там нарочно другая (2×1024 сэмпла ≈ 0.043 с), чем у GOP видео.
    const idx = await indexFmp4(memorySource(makeFmp4(2, 4)));
    expect(idx.fragments.map((f) => f.duration)).toEqual([4, 4]);
  });

  it('длительность последнего фрагмента — сумма сэмплов trun (соседнего tfdt нет)', async () => {
    const file = Buffer.concat([
      init([VIDEO]),
      fragment([{ trackId: 1, tfdt: 0, durations: [3600, 3600] }]),
      fragment([{ trackId: 1, tfdt: 7200, durations: [3600, 3600, 3600] }]),
    ]);
    const idx = await indexFmp4(memorySource(file));
    expect(idx.fragments.map((f) => f.duration)).toEqual([0.08, 0.12]);
  });

  it('разрыв в таймлайне попадает в длительность (по tfdt, а не по сумме сэмплов)', async () => {
    const file = Buffer.concat([
      init([VIDEO]),
      fragment([{ trackId: 1, tfdt: 0, durations: [90000] }]),
      // следующий фрагмент начинается через 3 с, хотя сэмплы первого — на 1 с
      fragment([{ trackId: 1, tfdt: 270000, durations: [90000] }]),
    ]);
    const idx = await indexFmp4(memorySource(file));
    expect(idx.fragments.map((f) => f.duration)).toEqual([3, 1]);
  });

  it('без длительностей в trun берёт дефолт из tfhd, а без него — из trex', async () => {
    const file = Buffer.concat([
      init([{ ...VIDEO, trexDuration: 4500 }]),
      fragment([{ trackId: 1, sampleCount: 10, tfhdDuration: 9000 }]),
      fragment([{ trackId: 1, sampleCount: 10 }]),
    ]);
    const idx = await indexFmp4(memorySource(file));
    // Без tfdt длительность — по сэмплам: 10×9000 и 10×4500 тиков на 90 кГц.
    expect(idx.fragments.map((f) => f.duration)).toEqual([1, 0.5]);
  });

  it('пропускает служебные боксы после последнего mdat (mfra)', async () => {
    const body = makeFmp4(2);
    const file = Buffer.concat([body, box('mfra', Buffer.alloc(40))]);
    const idx = await indexFmp4(memorySource(file));
    const last = idx.fragments[1];
    expect(last.offset + last.length).toBe(body.length);
  });

  it('читает mdat с 64-битным размером (largesize)', async () => {
    const mdatBody = Buffer.alloc(500, 1);
    const large = Buffer.alloc(16);
    large.writeUInt32BE(1);
    large.write('mdat', 4, 'latin1');
    large.writeBigUInt64BE(BigInt(16 + mdatBody.length), 8);
    const moofOnly = fragment([{ trackId: 1, tfdt: 0, durations: [90000] }], 0);
    const moof = moofOnly.subarray(0, moofOnly.length - 8); // отрезаем пустой 8-байтный mdat
    const file = Buffer.concat([init([VIDEO]), moof, large, mdatBody]);
    const idx = await indexFmp4(memorySource(file));
    expect(idx.fragments).toHaveLength(1);
    expect(idx.fragments[0].length).toBe(moof.length + 16 + mdatBody.length);
  });

  it('оборванный файл — ошибка, а не «запись покороче»', async () => {
    const file = makeFmp4(3);
    await expect(indexFmp4(memorySource(file.subarray(0, file.length - 10)))).rejects.toThrow(/truncated/);
  });

  it('moof без mdat — ошибка', async () => {
    const lone = fragment([{ trackId: 1, tfdt: 0, durations: [90000] }]);
    const moofOnly = lone.subarray(0, lone.length - 8 - 1000);
    await expect(indexFmp4(memorySource(Buffer.concat([init([VIDEO]), moofOnly])))).rejects.toThrow(/no mdat/);
  });

  it('файл без moov — ошибка', async () => {
    const frag = fragment([{ trackId: 1, tfdt: 0, durations: [90000] }]);
    await expect(indexFmp4(memorySource(frag))).rejects.toThrow(/moof before moov/);
  });

  it('один range-запрос на фрагмент: moof и заголовок mdat приходят одним окном', async () => {
    // 200 КБ mdat — заведомо больше окна чтения, как у реального GOP.
    const src = memorySource(makeFmp4(50, 2, 200_000));
    await indexFmp4(src);
    // +1 на init (ftyp+moov читаются первым окном вместе с первым moof)
    expect(src.reads).toBeLessThanOrEqual(50 + 1);
  });
});

describe('fileByteSource', () => {
  it('читает диапазоны локального файла', async () => {
    const tmp = path.join(os.tmpdir(), `fmp4-${process.pid}-${Date.now()}.mp4`);
    const file = makeFmp4(4);
    fs.writeFileSync(tmp, file);
    try {
      const src = await fileByteSource(tmp);
      try {
        expect(src.size).toBe(file.length);
        const idx = await indexFmp4(src);
        expect(idx.fragments).toHaveLength(4);
      } finally {
        await src.close();
      }
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});
