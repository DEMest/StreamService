import { CapacityStoreService } from './capacity-store.service';
import { CapacityPoint } from './capacity.types';

const BASE = Date.parse('2026-08-29T12:00:00Z');

const point = (offsetMs: number, over: Partial<CapacityPoint> = {}): CapacityPoint => ({
  t: BASE + offsetMs,
  viewers: 10,
  egressMbps: 100,
  cacheHitRatio: 0.9,
  errorRate: 0,
  stallRatio: 0,
  ...over,
});

describe('CapacityStoreService', () => {
  const prisma = {
    capacitySample: { createMany: jest.fn(), findMany: jest.fn(), deleteMany: jest.fn() },
  };
  const collector = {
    history: jest.fn(() => [] as CapacityPoint[]),
    byStream: jest.fn(() => new Map()),
    renditions: jest.fn(() => []),
  };
  const host = {
    read: jest.fn(() => ({
      cpu: { cores: 8, usage: 0.5, loadAvg1: 1 },
      memory: { totalBytes: 100, usedBytes: 40, usage: 0.4 },
      disks: [],
      net: { rxMbps: 1, txMbps: 200, errors: 0, dropped: 0 },
      uptimeSeconds: 10,
    })),
  };

  const qoe = { snapshot: jest.fn(() => ({ fragLoadP95: 640 })) };

  const make = () =>
    new CapacityStoreService(prisma as never, collector as never, host as never, qoe as never);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.capacitySample.createMany.mockResolvedValue({ count: 1 });
    jest.useFakeTimers().setSystemTime(new Date(BASE + 5 * 60_000));
  });
  afterEach(() => jest.useRealTimers());

  it('усредняет точки внутри минуты в одну строку', async () => {
    collector.history.mockReturnValue([
      point(0, { viewers: 10, egressMbps: 100 }),
      point(10_000, { viewers: 20, egressMbps: 200 }),
    ]);
    await make().flush();

    const rows = prisma.capacitySample.createMany.mock.calls[0][0].data;
    const server = rows.find((r: { streamKey: string }) => r.streamKey === '');
    expect(server.viewers).toBe(15);
    expect(server.egressMbps).toBe(150);
  });

  it('раскладывает разные минуты по разным строкам', async () => {
    collector.history.mockReturnValue([point(0), point(60_000), point(120_000)]);
    await make().flush();

    const rows = prisma.capacitySample.createMany.mock.calls[0][0].data;
    expect(rows.filter((r: { streamKey: string }) => r.streamKey === '')).toHaveLength(3);
  });

  it('не пишет одну и ту же минуту дважды', async () => {
    collector.history.mockReturnValue([point(0)]);
    const svc = make();
    await svc.flush();
    await svc.flush();
    expect(prisma.capacitySample.createMany).toHaveBeenCalledTimes(1);
  });

  it('пропускает незавершённую минуту: она ещё наполняется', async () => {
    // Сейчас 12:05; точка в 12:05 относится к минуте, которая ещё идёт.
    collector.history.mockReturnValue([point(0), point(5 * 60_000)]);
    await make().flush();

    const rows = prisma.capacitySample.createMany.mock.calls[0][0].data;
    const minutes = rows
      .filter((r: { streamKey: string }) => r.streamKey === '')
      .map((r: { at: Date }) => r.at.getTime());
    expect(minutes).toEqual([BASE]);
  });

  it('пустая история не приводит к записи', async () => {
    collector.history.mockReturnValue([]);
    await make().flush();
    expect(prisma.capacitySample.createMany).not.toHaveBeenCalled();
  });

  it('кладёт в серверный срез перцентиль загрузки фрагмента', async () => {
    collector.history.mockReturnValue([point(0)]);
    await make().flush();

    const server = prisma.capacitySample.createMany.mock.calls[0][0].data.find(
      (r: { streamKey: string }) => r.streamKey === '',
    );
    expect(server.fragLoadP95).toBe(640);
  });

  it('кладёт железо в серверный срез', async () => {
    collector.history.mockReturnValue([point(0)]);
    await make().flush();

    const server = prisma.capacitySample.createMany.mock.calls[0][0].data.find(
      (r: { streamKey: string }) => r.streamKey === '',
    );
    expect(server.cpuUsage).toBe(0.5);
    expect(server.memoryUsage).toBe(0.4);
    expect(server.netTxMbps).toBe(200);
  });

  it('пишет отдельную строку на каждый стрим', async () => {
    collector.history.mockReturnValue([point(0)]);
    collector.byStream.mockReturnValue(
      new Map([
        ['club/a', { egressMbps: 60, viewers: 6 }],
        ['club/b', { egressMbps: 40, viewers: 4 }],
      ]),
    );
    await make().flush();

    const rows = prisma.capacitySample.createMany.mock.calls[0][0].data;
    expect(rows.map((r: { streamKey: string }) => r.streamKey).sort()).toEqual([
      '',
      'club/a',
      'club/b',
    ]);
  });

  it('чистка удаляет строки старше 90 дней', async () => {
    prisma.capacitySample.deleteMany.mockResolvedValue({ count: 7 });
    expect(await make().cleanup()).toBe(7);

    const where = prisma.capacitySample.deleteMany.mock.calls[0][0].where;
    const cutoff = (where.at.lt as Date).getTime();
    expect(Date.now() - cutoff).toBeGreaterThan(89 * 86_400_000);
    expect(Date.now() - cutoff).toBeLessThan(91 * 86_400_000);
  });

  it('range отдаёт точки в том же виде, что живая история', async () => {
    prisma.capacitySample.findMany.mockResolvedValue([
      {
        at: new Date(BASE),
        viewers: 12,
        egressMbps: 111,
        cacheHitRatio: 0.8,
        errorRate: 0.01,
        stallShare: 0.05,
      },
    ]);
    const points = await make().range(new Date(BASE - 1000), new Date(BASE + 1000));
    expect(points).toEqual([
      { t: BASE, viewers: 12, egressMbps: 111, cacheHitRatio: 0.8, errorRate: 0.01, stallRatio: 0.05 },
    ]);
  });

  it('сбой записи не выбрасывает наружу', async () => {
    collector.history.mockReturnValue([point(0)]);
    prisma.capacitySample.createMany.mockRejectedValue(new Error('база недоступна'));
    await expect(make().flush()).resolves.toBeUndefined();
  });
});
