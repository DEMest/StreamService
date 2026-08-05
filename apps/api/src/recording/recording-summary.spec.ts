import { toRecordingSummary } from './recording-summary';

describe('toRecordingSummary', () => {
  it('возвращает null, когда записи у broadcast нет', () => {
    expect(toRecordingSummary(undefined)).toBeNull();
  });

  it('переводит BigInt fileSize в number — иначе ответ не сериализуется в JSON', () => {
    const r = toRecordingSummary({
      id: 'r1', status: 'ready', fileSize: 3_400_000_000n, duration: 3600,
    });
    expect(r).toEqual({ id: 'r1', status: 'ready', fileSize: 3_400_000_000, duration: 3600 });
    expect(typeof r!.fileSize).toBe('number');
    // Главное, ради чего конвертер и существует.
    expect(() => JSON.stringify(r)).not.toThrow();
  });

  it('сохраняет точность на размерах, недоступных прежнему int4', () => {
    // 12 часов на 20 Мбит/с — далеко за потолком int4 (2.15 ГБ), но внутри 2^53.
    const huge = 108_000_000_000n;
    expect(toRecordingSummary({ id: 'r2', status: 'ready', fileSize: huge, duration: 43200 })!.fileSize)
      .toBe(108_000_000_000);
  });

  it('различает нулевой размер и отсутствующий (processing/failed)', () => {
    expect(toRecordingSummary({ id: 'r3', status: 'ready', fileSize: 0n, duration: 0 })!.fileSize).toBe(0);
    expect(toRecordingSummary({ id: 'r4', status: 'processing', fileSize: null, duration: null })).toEqual({
      id: 'r4', status: 'processing', fileSize: null, duration: null,
    });
  });
});
