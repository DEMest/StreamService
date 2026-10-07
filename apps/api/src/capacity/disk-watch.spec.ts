import {
  DISK_CLEAR_BYTES,
  DISK_CRIT_BYTES,
  DISK_WARN_BYTES,
  DiskSpaceWatch,
  diskLevel,
  formatFree,
  parseFreePeak,
} from './disk-watch';
import { DISK_RESERVE_BYTES } from '../org/storage-estimate';

const GIB = 1024 ** 3;
const MIN = 60_000;

/** Прогнать серию замеров по минуте и собрать все события. */
function run(w: DiskSpaceWatch, freeGib: Array<number | null>, from = 0) {
  return freeGib.flatMap((g, i) => w.evaluate(g === null ? null : g * GIB, from + i * MIN));
}

describe('пороги диска', () => {
  it('выведены из резерва дашборда, а не заданы отдельно', () => {
    expect(DISK_CRIT_BYTES).toBe(DISK_RESERVE_BYTES);
    expect(DISK_WARN_BYTES).toBe(2 * DISK_RESERVE_BYTES);
    expect(DISK_CLEAR_BYTES).toBe(3 * DISK_RESERVE_BYTES);
  });

  it('уровень по свободному месту', () => {
    expect(diskLevel(DISK_WARN_BYTES)).toBeNull();
    expect(diskLevel(DISK_WARN_BYTES - 1)).toBe('warn');
    expect(diskLevel(DISK_CRIT_BYTES)).toBe('warn');
    expect(diskLevel(DISK_CRIT_BYTES - 1)).toBe('crit');
  });

  it('пик читается обратно из текста, сохранённого в базе', () => {
    expect(formatFree(87 * GIB)).toBe('свободно 87 ГБ');
    expect(formatFree(4.26 * GIB)).toBe('свободно 4.3 ГБ');
    expect(parseFreePeak(formatFree(87 * GIB))).toBe(87 * GIB);
    expect(parseFreePeak(formatFree(4.26 * GIB))).toBeCloseTo(4.3 * GIB);
    expect(parseFreePeak('85% канала')).toBeNull();
  });
});

describe('DiskSpaceWatch', () => {
  it('один замер ниже порога ещё не инцидент', () => {
    expect(run(new DiskSpaceWatch(), [90])).toEqual([]);
  });

  it('открывает предупреждение после двух замеров ниже 2× резерва', () => {
    const out = run(new DiskSpaceWatch(), [95, 90]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'disk', action: 'open', severity: 'warn', peak: 'свободно 90 ГБ' });
    expect(out[0].hint).toContain('150 ГБ');
  });

  it('сразу открывает критичный, если место уже ушло в резерв', () => {
    const out = run(new DiskSpaceWatch(), [40, 38]);
    expect(out).toEqual([expect.objectContaining({ action: 'open', severity: 'crit', title: 'Диск почти заполнен' })]);
  });

  it('повышает открытое предупреждение до критичного одним событием', () => {
    const w = new DiskSpaceWatch();
    run(w, [95, 90]);
    const out = run(w, [45, 40, 35, 30], 2 * MIN);
    expect(out).toEqual([expect.objectContaining({ action: 'escalate', severity: 'crit', peak: 'свободно 40 ГБ' })]);
    expect(w.openLevel()).toBe('crit');
  });

  it('разовый провал в резерв не повышает уровень', () => {
    const w = new DiskSpaceWatch();
    run(w, [95, 90]);
    expect(run(w, [45, 60, 45, 60], 2 * MIN)).toEqual([]);
    expect(w.openLevel()).toBe('warn');
  });

  it('пила от заливки записи не закрывает инцидент', () => {
    const w = new DiskSpaceWatch();
    run(w, [95, 90]);
    // После заливки scratch удалён и место прыгнуло выше порога открытия, но
    // не выше порога закрытия — инцидент держится сколько угодно долго.
    expect(run(w, Array(120).fill(130), 2 * MIN)).toEqual([]);
    expect(w.openLevel()).toBe('warn');
  });

  it('закрывает после трёх замеров выше 3× резерва, с худшим уровнем и пиком', () => {
    const w = new DiskSpaceWatch();
    run(w, [40, 38, 70]);
    expect(run(w, [160, 160], 3 * MIN)).toEqual([]);
    const out = run(w, [160], 5 * MIN);
    expect(out).toEqual([
      expect.objectContaining({ action: 'close', severity: 'crit', peak: 'свободно 38 ГБ' }),
    ]);
    expect(w.openLevel()).toBeNull();
  });

  it('короткий выход за порог закрытия не закрывает', () => {
    const w = new DiskSpaceWatch();
    run(w, [95, 90]);
    expect(run(w, [160, 160, 120, 160, 160], 2 * MIN)).toEqual([]);
    expect(run(w, [160], 7 * MIN)).toHaveLength(1);
  });

  it('отсутствие замера не открывает, не закрывает и не сбивает счёт', () => {
    const w = new DiskSpaceWatch();
    expect(run(w, [90, null])).toEqual([]);
    expect(run(w, [90], 2 * MIN)).toHaveLength(1);
    expect(run(w, [null, null, null, null], 3 * MIN)).toEqual([]);
    expect(w.openLevel()).toBe('warn');
  });

  it('просадка, не ставшая инцидентом, не оставляет свой пик следующей', () => {
    const w = new DiskSpaceWatch();
    run(w, [60, 200]);
    const out = run(w, [95, 90], 2 * MIN);
    expect(out[0].peak).toBe('свободно 90 ГБ');
  });

  it('следующий инцидент получает свой пик, а не пик закрытого', () => {
    const w = new DiskSpaceWatch();
    run(w, [40, 38, 160, 160, 160]);
    expect(run(w, [90, 85], 5 * MIN)[0].peak).toBe('свободно 85 ГБ');
  });

  it('после закрытия может открыться снова', () => {
    const w = new DiskSpaceWatch();
    run(w, [95, 90, 160, 160, 160]);
    expect(run(w, [80, 80], 5 * MIN)).toEqual([expect.objectContaining({ action: 'open' })]);
  });

  describe('после рестарта API', () => {
    it('подхваченный инцидент не открывается повторно', () => {
      const w = new DiskSpaceWatch();
      w.resume('warn', 'свободно 80 ГБ');
      expect(run(w, [85, 85, 85])).toEqual([]);
    });

    it('закрывается, когда место освободили, сохранив пик до рестарта', () => {
      const w = new DiskSpaceWatch();
      w.resume('crit', 'свободно 30 ГБ');
      run(w, [70, 70]);
      expect(run(w, [160, 160, 160], 2 * MIN)).toEqual([
        expect.objectContaining({ action: 'close', severity: 'crit', peak: 'свободно 30 ГБ' }),
      ]);
    });

    it('новый минимум ниже сохранённого обновляет пик', () => {
      const w = new DiskSpaceWatch();
      w.resume('warn', 'свободно 80 ГБ');
      const out = run(w, [45, 42]);
      expect(out).toEqual([expect.objectContaining({ action: 'escalate', peak: 'свободно 42 ГБ' })]);
    });

    it('неразборчивый пик из базы не перетирается', () => {
      const w = new DiskSpaceWatch();
      w.resume('warn', 'пик неизвестен');
      expect(run(w, [70, 160, 160, 160]).pop()?.peak).toBe('пик неизвестен');
    });
  });
});
