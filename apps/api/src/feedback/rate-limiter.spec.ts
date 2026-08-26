import { SlidingWindowLimiter } from './rate-limiter';

const HOUR = 60 * 60 * 1000;

describe('SlidingWindowLimiter', () => {
  it('пропускает ровно max попаданий и отсекает следующее', () => {
    const limiter = new SlidingWindowLimiter(3, HOUR);
    const t0 = 1_000_000;

    expect(limiter.tryHit('ip', t0)).toBe(true);
    expect(limiter.tryHit('ip', t0 + 1)).toBe(true);
    expect(limiter.tryHit('ip', t0 + 2)).toBe(true);
    expect(limiter.tryHit('ip', t0 + 3)).toBe(false);
  });

  it('не засчитывает отклонённую попытку, поэтому окно не продлевается', () => {
    const limiter = new SlidingWindowLimiter(1, HOUR);
    const t0 = 1_000_000;

    expect(limiter.tryHit('ip', t0)).toBe(true);
    // Долбёжка в закрытую дверь весь час
    expect(limiter.tryHit('ip', t0 + HOUR / 2)).toBe(false);
    // ...и ровно через час после единственного засчитанного попадания открыто
    expect(limiter.tryHit('ip', t0 + HOUR)).toBe(true);
  });

  it('освобождает квоту по мере выхода отметок из окна', () => {
    const limiter = new SlidingWindowLimiter(2, HOUR);
    const t0 = 1_000_000;

    limiter.tryHit('ip', t0);
    limiter.tryHit('ip', t0 + HOUR / 2);
    expect(limiter.tryHit('ip', t0 + HOUR / 2 + 1)).toBe(false);

    // Первая отметка выпала — один слот вернулся, второй ещё занят
    expect(limiter.tryHit('ip', t0 + HOUR + 1)).toBe(true);
    expect(limiter.tryHit('ip', t0 + HOUR + 2)).toBe(false);
  });

  it('считает адреса независимо друг от друга', () => {
    const limiter = new SlidingWindowLimiter(1, HOUR);
    const t0 = 1_000_000;

    expect(limiter.tryHit('1.1.1.1', t0)).toBe(true);
    expect(limiter.tryHit('1.1.1.1', t0 + 1)).toBe(false);
    expect(limiter.tryHit('2.2.2.2', t0 + 2)).toBe(true);
  });

  it('remaining показывает остаток и не тратит квоту', () => {
    const limiter = new SlidingWindowLimiter(2, HOUR);
    const t0 = 1_000_000;

    expect(limiter.remaining('ip', t0)).toBe(2);
    limiter.tryHit('ip', t0);
    expect(limiter.remaining('ip', t0)).toBe(1);
    expect(limiter.remaining('ip', t0)).toBe(1);
  });

  it('чистит просроченные ключи, а не копит их вечно', () => {
    const limiter = new SlidingWindowLimiter(1, HOUR);
    const t0 = 1_000_000;

    for (let i = 0; i < 50; i++) limiter.tryHit(`ip-${i}`, t0);
    // Через два часа все отметки протухли; sweep случается на первом же вызове
    limiter.tryHit('trigger', t0 + 2 * HOUR);

    const map: Map<string, number[]> = (limiter as any).hits;
    expect(map.has('ip-0')).toBe(false);
    expect(map.size).toBe(1);
  });

  it('сбрасывает карту, когда живых ключей больше предохранителя', () => {
    const limiter = new SlidingWindowLimiter(1, HOUR, 10);
    const t0 = 1_000_000;

    for (let i = 0; i < 40; i++) limiter.tryHit(`ip-${i}`, t0 + i);

    const map: Map<string, number[]> = (limiter as any).hits;
    expect(map.size).toBeLessThanOrEqual(11);
  });
});
