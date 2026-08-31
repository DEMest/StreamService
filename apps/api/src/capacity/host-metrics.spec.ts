import { HostMetricsReader, parseNetDev } from './host-metrics';

describe('parseNetDev', () => {
  const sample = [
    'Inter-|   Receive                                                |  Transmit',
    ' face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed',
    '    lo: 1000       10    0    0    0     0          0         0     2000      20    0    0    0     0       0          0',
    '  eth0: 5000       50    1    2    0     0          0         0     9000      90    3    4    0     0       0          0',
  ].join('\n');

  it('складывает счётчики всех интерфейсов, кроме петли', () => {
    expect(parseNetDev(sample)).toEqual({ rx: 5000, tx: 9000, errors: 4, dropped: 6 });
  });

  it('на пустом вводе отдаёт нули, а не падает', () => {
    expect(parseNetDev('')).toEqual({ rx: 0, tx: 0, errors: 0, dropped: 0 });
  });

  it('переживает строку без двоеточия', () => {
    expect(parseNetDev('мусор\nещё мусор\nи ещё')).toEqual({ rx: 0, tx: 0, errors: 0, dropped: 0 });
  });
});

describe('HostMetricsReader', () => {
  it('первый замер не выдумывает загрузку процессора', () => {
    // Дельты ещё нет: «мы не знаем» и «нагрузки нет» на экране выглядят
    // по-разному, и подменять первое вторым нельзя.
    expect(new HostMetricsReader().read().cpu.usage).toBeNull();
  });

  it('второй замер уже даёт долю в разумных пределах', () => {
    const r = new HostMetricsReader();
    r.read();
    const usage = r.read().cpu.usage;
    if (usage !== null) {
      expect(usage).toBeGreaterThanOrEqual(0);
      expect(usage).toBeLessThanOrEqual(1);
    }
  });

  it('всегда сообщает число ядер и объём памяти', () => {
    const m = new HostMetricsReader().read();
    expect(m.cpu.cores).toBeGreaterThan(0);
    expect(m.memory.totalBytes).toBeGreaterThan(0);
    expect(m.memory.usage).toBeGreaterThanOrEqual(0);
    expect(m.memory.usage).toBeLessThanOrEqual(1);
  });
});
