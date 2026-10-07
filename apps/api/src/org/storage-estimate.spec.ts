import {
  DEFAULT_BITRATE_MBPS,
  DISK_RESERVE_BYTES,
  FINALIZE_PEAK_FACTOR,
  bitrateFromBytesPerHour,
  bytesPerHourAt,
  hourlyRate,
  hoursLeft,
} from './storage-estimate';

const GiB = 1024 ** 3;

describe('storage-estimate', () => {
  describe('bytesPerHourAt', () => {
    it('переводит Мбит/с в байты архива за час — видео в архиве ровно одной копией', () => {
      // 4 Мбит/с = 500 000 байт/с * 3600 = 1.8 ГБ
      expect(bytesPerHourAt(4)).toBe(1_800_000_000);
    });

    it('обратима через bitrateFromBytesPerHour', () => {
      expect(bitrateFromBytesPerHour(bytesPerHourAt(6))).toBeCloseTo(6, 6);
    });
  });

  describe('hourlyRate', () => {
    it('берёт дефолтный битрейт, пока истории нет', () => {
      const r = hourlyRate(0, 0);
      expect(r.fromHistory).toBe(false);
      expect(r.bitrateMbps).toBe(DEFAULT_BITRATE_MBPS);
      expect(r.bytesPerHour).toBe(bytesPerHourAt(DEFAULT_BITRATE_MBPS));
    });

    it('игнорирует слишком короткую историю (шум от тестовых включений)', () => {
      // 5 минут записи — меньше MIN_HISTORY_SECONDS
      const r = hourlyRate(1 * GiB, 300);
      expect(r.fromHistory).toBe(false);
      expect(r.bitrateMbps).toBe(DEFAULT_BITRATE_MBPS);
    });

    it('считает по собственной истории орги, когда её достаточно', () => {
      // 2 часа эфира на 8 Мбит/с → ровно 8 Мбит/с обратно
      const twoHours = 7200;
      const used = bytesPerHourAt(8) * 2;
      const r = hourlyRate(used, twoHours);
      expect(r.fromHistory).toBe(true);
      expect(r.bitrateMbps).toBeCloseTo(8, 3);
      expect(r.bytesPerHour).toBe(bytesPerHourAt(8));
    });

    it('не делит на ноль при нулевом объёме и ненулевой длительности', () => {
      const r = hourlyRate(0, 7200);
      expect(r.fromHistory).toBe(false);
      expect(r.bytesPerHour).toBeGreaterThan(0);
    });
  });

  describe('hoursLeft', () => {
    it('вычитает резерв диска и делит по ПИКОВОМУ расходу, а не установившемуся', () => {
      const free = DISK_RESERVE_BYTES + bytesPerHourAt(4) * 10;
      // 10 часов установившегося следа → 10/3 часа: на заливке запись лежит на
      // томе трижды (исходники, склейка, её копия в S3); floor до десятых.
      expect(hoursLeft(free, bytesPerHourAt(4))).toBe(3.3);
    });

    it('обещанные часы реально доживают до конца заливки', () => {
      const free = 600 * GiB;
      const bph = bytesPerHourAt(6);
      const promised = hoursLeft(free, bph);
      // Пик = запись лежит на томе трижды. Он обязан уместиться в свободное
      // место за вычетом резерва — иначе ENOSPC посреди заливки.
      const peakBytes = promised * bph * FINALIZE_PEAK_FACTOR;
      expect(peakBytes).toBeLessThanOrEqual(free - DISK_RESERVE_BYTES);
    });

    it('возвращает 0, когда свободное место уже в пределах резерва', () => {
      expect(hoursLeft(DISK_RESERVE_BYTES, bytesPerHourAt(4))).toBe(0);
      expect(hoursLeft(1 * GiB, bytesPerHourAt(4))).toBe(0);
    });

    it('возвращает 0 при нулевом расходе, а не Infinity', () => {
      expect(hoursLeft(500 * GiB, 0)).toBe(0);
    });
  });

  it('FINALIZE_PEAK_FACTOR = 3 — исходники, склейка и её копия в S3 одновременно', () => {
    expect(FINALIZE_PEAK_FACTOR).toBe(3);
  });
});
