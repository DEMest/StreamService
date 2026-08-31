import { CapacityAlertsService } from './capacity-alerts.service';
import { CapacityPoint } from './capacity.types';

const point = (over: Partial<CapacityPoint> = {}): CapacityPoint => ({
  t: Date.now(),
  viewers: 100,
  egressMbps: 650,
  cacheHitRatio: 0.95,
  errorRate: 0,
  stallRatio: 0,
  ...over,
});

describe('CapacityAlertsService', () => {
  const prisma = {
    capacityIncident: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
  };
  const collector = { history: jest.fn(() => [point()]) };
  const capacity = {
    getSnapshot: jest.fn(() => ({
      utilization: 0.85,
      health: { encodeSpeed: 1.0 },
    })),
  };
  const mail = { send: jest.fn().mockResolvedValue(true) };
  const telegram = { send: jest.fn().mockResolvedValue(true) };

  const make = () =>
    new CapacityAlertsService(
      prisma as never,
      collector as never,
      capacity as never,
      mail as never,
      telegram as never,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.capacityIncident.create.mockResolvedValue({ id: 'i1' });
    prisma.capacityIncident.update.mockResolvedValue({});
  });

  it('одна минута над порогом ещё не инцидент', async () => {
    const svc = make();
    await svc.check();
    expect(prisma.capacityIncident.create).not.toHaveBeenCalled();
  });

  it('вторая минута открывает инцидент и шлёт уведомление', async () => {
    const svc = make();
    await svc.check();
    await svc.check();

    expect(prisma.capacityIncident.create).toHaveBeenCalledTimes(1);
    const data = prisma.capacityIncident.create.mock.calls[0][0].data;
    expect(data.kind).toBe('uplink');
    expect(data.endedAt).toBeUndefined();
    expect(mail.send).toHaveBeenCalledTimes(1);
    expect(telegram.send).toHaveBeenCalledTimes(1);
  });

  it('пустая история не приводит ни к чему', async () => {
    collector.history.mockReturnValueOnce([]);
    await make().check();
    expect(prisma.capacityIncident.create).not.toHaveBeenCalled();
    expect(capacity.getSnapshot).not.toHaveBeenCalled();
  });

  it('закрытие проставляет конец и длительность в уведомлении', async () => {
    const svc = make();
    await svc.check();
    await svc.check();
    jest.clearAllMocks();

    prisma.capacityIncident.findFirst.mockResolvedValue({
      id: 'i1',
      startedAt: new Date(Date.now() - 7 * 60_000),
      peak: '85% канала',
    });
    capacity.getSnapshot.mockReturnValue({ utilization: 0.3, health: { encodeSpeed: 1.0 } });

    await svc.check();
    await svc.check();
    await svc.check();

    expect(prisma.capacityIncident.update).toHaveBeenCalledTimes(1);
    expect(prisma.capacityIncident.update.mock.calls[0][0].data.endedAt).toBeInstanceOf(Date);
    expect(mail.send.mock.calls[0][1]).toContain('7 мин');
  });

  it('в демо-режиме не открывает инцидентов и не шлёт уведомлений', async () => {
    const old = process.env.CAPACITY_DEMO;
    process.env.CAPACITY_DEMO = 'true';
    try {
      const svc = make();
      await svc.check();
      await svc.check();
      await svc.check();
      expect(prisma.capacityIncident.create).not.toHaveBeenCalled();
      expect(mail.send).not.toHaveBeenCalled();
      expect(telegram.send).not.toHaveBeenCalled();
    } finally {
      process.env.CAPACITY_DEMO = old;
    }
  });

  it('сбой записи в базу не выбрасывает наружу', async () => {
    prisma.capacityIncident.create.mockRejectedValue(new Error('база недоступна'));
    capacity.getSnapshot.mockReturnValue({ utilization: 0.9, health: { encodeSpeed: 1.0 } });

    const svc = make();
    await svc.check();
    await expect(svc.check()).resolves.toBeUndefined();
  });

  it('лента отдаёт инциденты в виде, понятном экрану', async () => {
    const started = new Date('2026-08-29T12:00:00Z');
    prisma.capacityIncident.findMany.mockResolvedValue([
      { id: 'i1', kind: 'uplink', severity: 'crit', title: 'Канал', startedAt: started, endedAt: null, peak: '90%' },
    ]);

    expect(await make().recent()).toEqual([
      {
        id: 'i1',
        kind: 'uplink',
        severity: 'crit',
        title: 'Канал',
        startedAt: started.getTime(),
        endedAt: null,
        peak: '90%',
      },
    ]);
  });
});
