import { CapacityCollectorService } from './capacity-collector.service';
import { QoeSnapshot } from './qoe.service';

/** Строка лога сегмента: удобный конструктор для тестов. */
const line = (
  bytes: number,
  rendition: string,
  cache = 'HIT',
  status = 200,
  stream = 'a',
) =>
  `2026-08-29T12:00:00+00:00|${status}|${bytes}|0.003|${cache}|` +
  `/api/v1/public/orgs/club/streams/${stream}/live/hls/${rendition}/s1.ts`;

const qoeOf = (over: Partial<QoeSnapshot> = {}): QoeSnapshot => ({
  players: 4,
  stallingShare: 0.25,
  fragLoadP95: 800,
  byRendition: new Map([['p720', 4]]),
  byStream: new Map([['club/a', 4]]),
  ...over,
});

/**
 * Сборщик получает источники через конструктор, поэтому тестируется без
 * файловой системы и без сети: подсовываем заглушку хвоста лога и снимок
 * телеметрии.
 */
const make = (lines: string[], qoe: QoeSnapshot = qoeOf()) =>
  new CapacityCollectorService(
    { read: () => lines } as never,
    { snapshot: () => qoe } as never,
  );

describe('CapacityCollectorService', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-29T12:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  /** Сдвигает время на интервал тика, чтобы дельта была ровно 10 секунд. */
  const tickAfter10s = (svc: CapacityCollectorService) => {
    jest.advanceTimersByTime(10_000);
    svc.tick();
  };

  it('переводит байты за интервал в мегабиты в секунду', () => {
    // 12.5 МБ за 10 с = 10 Мбит/с
    const svc = make([line(12_500_000, 'p720')]);
    tickAfter10s(svc);
    expect(svc.history().at(-1)!.egressMbps).toBeCloseTo(10, 1);
  });

  it('считает долю попаданий в кэш по сегментам', () => {
    const svc = make([line(100, 'hd', 'HIT'), line(100, 'hd', 'MISS'), line(100, 'hd', 'HIT')]);
    tickAfter10s(svc);
    expect(svc.history().at(-1)!.cacheHitRatio).toBeCloseTo(2 / 3, 2);
  });

  it('считает долю ошибочных ответов', () => {
    const svc = make([line(100, 'hd'), line(0, 'hd', '-', 429)]);
    tickAfter10s(svc);
    expect(svc.history().at(-1)!.errorRate).toBeCloseTo(0.5, 2);
  });

  it('берёт число зрителей из телеметрии, а не из числа запросов', () => {
    const svc = make([line(100, 'hd'), line(100, 'hd'), line(100, 'hd')]);
    tickAfter10s(svc);
    expect(svc.history().at(-1)!.viewers).toBe(4);
  });

  it('раскладывает отдачу по стримам', () => {
    const svc = make([line(1_000_000, 'hd', 'HIT', 200, 'a'), line(3_000_000, 'hd', 'HIT', 200, 'b')]);
    tickAfter10s(svc);
    const byStream = svc.byStream();
    expect(byStream.get('club/b')!.egressMbps).toBeGreaterThan(byStream.get('club/a')!.egressMbps);
  });

  it('приписывает стриму зрителей из телеметрии', () => {
    const svc = make([line(1_000_000, 'hd', 'HIT', 200, 'a')]);
    tickAfter10s(svc);
    expect(svc.byStream().get('club/a')!.viewers).toBe(4);
  });

  it('строит микс качеств по телеметрии, а не по запросам', () => {
    const svc = make([line(100, 'hd')], qoeOf({ players: 4, byRendition: new Map([['p480', 3], ['hd', 1]]) }));
    tickAfter10s(svc);
    const mix = svc.renditions();
    expect(mix.find((r) => r.key === 'p480')!.viewers).toBe(3);
    expect(mix.find((r) => r.key === 'p480')!.share).toBeCloseTo(0.75);
    expect(mix.find((r) => r.key === 'p720')!.viewers).toBe(0);
  });

  it('не копит историю дольше часа', () => {
    const svc = make([]);
    for (let i = 0; i < 400; i++) tickAfter10s(svc);
    expect(svc.history().length).toBeLessThanOrEqual(360);
  });

  it('пустой лог даёт нулевую отдачу, а не деление на ноль', () => {
    const svc = make([], qoeOf({ players: 0, stallingShare: 0, byRendition: new Map(), byStream: new Map() }));
    tickAfter10s(svc);
    const p = svc.history().at(-1)!;
    expect(p.egressMbps).toBe(0);
    expect(p.cacheHitRatio).toBe(0);
    expect(p.errorRate).toBe(0);
  });

  it('игнорирует строки, не относящиеся к живому HLS', () => {
    const svc = make(['2026-08-29T12:00:00+00:00|200|9999999|0.1|-|/dashboard', 'мусор']);
    tickAfter10s(svc);
    expect(svc.history().at(-1)!.egressMbps).toBe(0);
  });
});
