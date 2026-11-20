import { boutStatus } from './bout-status';

const T1 = new Date('2026-12-14T10:00:00Z');
const T2 = new Date('2026-12-14T10:04:00Z');

describe('boutStatus', () => {
  it('нет времени начала и конца — ожидание', () => {
    expect(boutStatus({ startedAt: null, endedAt: null })).toBe('waiting');
  });

  it('началась и не закончилась — идёт', () => {
    expect(boutStatus({ startedAt: T1, endedAt: null })).toBe('live');
  });

  it('есть время конца — завершена', () => {
    expect(boutStatus({ startedAt: T1, endedAt: T2 })).toBe('finished');
  });

  it('введён только итог, начало не отмечали — всё равно завершена', () => {
    expect(boutStatus({ startedAt: null, endedAt: T2 })).toBe('finished');
  });
});
