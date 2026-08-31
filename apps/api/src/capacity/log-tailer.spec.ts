import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LogTailer } from './log-tailer';

describe('LogTailer', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailer-'));
    file = path.join(dir, 'capacity.log');
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('отсутствующий файл не роняет чтение', () => {
    expect(new LogTailer(file).read()).toEqual([]);
  });

  it('первое чтение не отдаёт накопленное прошлое', () => {
    fs.writeFileSync(file, 'старое\n');
    expect(new LogTailer(file).read()).toEqual([]);
  });

  it('отдаёт только дописанные строки', () => {
    fs.writeFileSync(file, 'старое\n');
    const t = new LogTailer(file);
    t.read();
    fs.appendFileSync(file, 'новое-1\nновое-2\n');
    expect(t.read()).toEqual(['новое-1', 'новое-2']);
    expect(t.read()).toEqual([]);
  });

  it('не отдаёт незавершённую строку, пока не пришёл перевод строки', () => {
    fs.writeFileSync(file, '');
    const t = new LogTailer(file);
    t.read();
    fs.appendFileSync(file, 'полов');
    expect(t.read()).toEqual([]);
    fs.appendFileSync(file, 'ина\n');
    expect(t.read()).toEqual(['половина']);
  });

  it('переживает ротацию: файл усох — читаем с начала', () => {
    fs.writeFileSync(file, 'первое\n');
    const t = new LogTailer(file);
    t.read();
    fs.writeFileSync(file, 'после ротации\n');
    expect(t.read()).toEqual(['после ротации']);
  });

  it('появление файла после старта не теряется', () => {
    const t = new LogTailer(file);
    expect(t.read()).toEqual([]);
    fs.writeFileSync(file, 'первая строка\n');
    expect(t.read()).toEqual(['первая строка']);
  });

  it('не читает целиком гигантский хвост за один раз', () => {
    fs.writeFileSync(file, '');
    const t = new LogTailer(file);
    t.read();
    const line = 'x'.repeat(999) + '\n';
    fs.appendFileSync(file, line.repeat(5000)); // ~5 МБ
    const first = t.read();
    expect(first.length).toBeGreaterThan(0);
    expect(first.length).toBeLessThan(5000);
  });
});
