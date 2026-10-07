import { CapacityAlertsService, humanDuration } from './capacity-alerts.service';
import { CapacityPoint } from './capacity.types';
import { readArchiveDisk } from '../org/archive-disk';

jest.mock('../org/archive-disk', () => ({ readArchiveDisk: jest.fn() }));
const readDisk = readArchiveDisk as jest.MockedFunction<typeof readArchiveDisk>;

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
    // clearAllMocks не трогает подставленные значения — без сброса они
    // протекали бы из теста в тест.
    prisma.capacityIncident.findFirst.mockResolvedValue(null);
    collector.history.mockImplementation(() => [point()]);
    capacity.getSnapshot.mockImplementation(() => ({ utilization: 0.85, health: { encodeSpeed: 1.0 } }));
    readDisk.mockReturnValue({ disk: null, diskStatus: 'external' });
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

  describe('место на диске', () => {
    const GIB = 1024 ** 3;
    const free = (gib: number) =>
      readDisk.mockReturnValue({ disk: { totalBytes: 1000 * GIB, freeBytes: gib * GIB }, diskStatus: 'ok' });
    const checks = async (svc: CapacityAlertsService, n: number) => {
      for (let i = 0; i < n; i++) await svc.check();
    };

    beforeEach(() => {
      // Канал спокоен — в базу и почту попадает только диск.
      capacity.getSnapshot.mockImplementation(() => ({ utilization: 0.3, health: { encodeSpeed: 1.0 } }));
    });

    it('открывает инцидент о диске с подсказкой, что делать', async () => {
      free(90);
      const svc = make();
      await checks(svc, 2);

      expect(prisma.capacityIncident.create).toHaveBeenCalledTimes(1);
      expect(prisma.capacityIncident.create.mock.calls[0][0].data).toMatchObject({
        kind: 'disk',
        severity: 'warn',
        peak: 'свободно 90 ГБ',
      });
      expect(mail.send.mock.calls[0][0]).toContain('Заканчивается место на диске');
      expect(mail.send.mock.calls[0][1]).toContain('Архив записей сам не удаляется');
      expect(telegram.send).toHaveBeenCalledTimes(1);
    });

    it('проверяет диск и без единой точки сборщика', async () => {
      collector.history.mockImplementation(() => []);
      free(90);
      await checks(make(), 2);
      expect(prisma.capacityIncident.create.mock.calls[0][0].data.kind).toBe('disk');
    });

    it('повышение до критичного обновляет тот же инцидент, а не открывает второй', async () => {
      free(90);
      const svc = make();
      await checks(svc, 2);

      prisma.capacityIncident.findFirst.mockResolvedValue({
        id: 'd1',
        startedAt: new Date(),
        peak: 'свободно 90 ГБ',
      });
      free(40);
      await checks(svc, 2);

      expect(prisma.capacityIncident.create).toHaveBeenCalledTimes(1);
      expect(prisma.capacityIncident.update).toHaveBeenCalledWith({
        where: { id: 'd1' },
        data: { severity: 'crit', title: 'Диск почти заполнен', peak: 'свободно 40 ГБ' },
      });
      expect(mail.send.mock.calls[1][0]).toBe('🔴 Диск почти заполнен');
    });

    it('после рестарта не дублирует открытый инцидент и закрывает его, когда место освободили', async () => {
      prisma.capacityIncident.findFirst.mockResolvedValue({
        id: 'd1',
        kind: 'disk',
        severity: 'warn',
        startedAt: new Date(Date.now() - 3 * 24 * 60 * 60_000),
        peak: 'свободно 80 ГБ',
      });
      free(85);
      const svc = make();
      await checks(svc, 3);

      expect(prisma.capacityIncident.findFirst.mock.calls[0][0].where).toEqual({ kind: 'disk', endedAt: null });
      expect(prisma.capacityIncident.create).not.toHaveBeenCalled();
      expect(mail.send).not.toHaveBeenCalled();

      free(160);
      await checks(svc, 3);

      expect(prisma.capacityIncident.update).toHaveBeenCalledTimes(1);
      expect(prisma.capacityIncident.update.mock.calls[0][0].data).toMatchObject({ peak: 'свободно 80 ГБ' });
      expect(mail.send.mock.calls[0][0]).toBe('✅ Восстановлено: Заканчивается место на диске');
      expect(mail.send.mock.calls[0][1]).toContain('3 дн');
    });

    it('архив во внешнем S3 — диск не проверяется и база о нём не спрашивается', async () => {
      await checks(make(), 3);
      expect(prisma.capacityIncident.findFirst).not.toHaveBeenCalled();
    });

    it('не узнав об открытом инциденте, пропускает минуту вместо дубля', async () => {
      prisma.capacityIncident.findFirst.mockRejectedValueOnce(new Error('база недоступна'));
      free(90);
      const svc = make();

      await expect(svc.check()).resolves.toBeUndefined();
      await svc.check();
      expect(prisma.capacityIncident.create).not.toHaveBeenCalled();

      await svc.check();
      expect(prisma.capacityIncident.create).toHaveBeenCalledTimes(1);
    });
  });
});

describe('humanDuration', () => {
  it.each([
    [7 * 60_000, '7 мин'],
    [20_000, '1 мин'],
    [90 * 60_000, '1 ч 30 мин'],
    [120 * 60_000, '2 ч'],
    [3 * 24 * 60 * 60_000, '3 дн'],
    [(3 * 24 + 5) * 60 * 60_000, '3 дн 5 ч'],
  ])('%d мс → %s', (ms, text) => {
    expect(humanDuration(ms)).toBe(text);
  });
});
