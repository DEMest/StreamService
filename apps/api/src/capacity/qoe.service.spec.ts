import { QoeService, percentile } from './qoe.service';

describe('QoeService', () => {
  let svc: QoeService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-29T12:00:00Z'));
    svc = new QoeService();
  });
  afterEach(() => jest.useRealTimers());

  const report = (clientId: string, over: Record<string, unknown> = {}) => ({
    streamKey: 'club/court-a',
    clientId,
    rendition: 'p720',
    stalls: 0,
    stallMs: 0,
    fragLoadMs: 100,
    ...over,
  }) as Parameters<QoeService['ingest']>[0];

  it('считает каждого клиента один раз, сколько бы отчётов он ни прислал', () => {
    svc.ingest(report('a'));
    svc.ingest(report('a'));
    svc.ingest(report('b'));
    expect(svc.snapshot().players).toBe(2);
  });

  it('забывает клиента, переставшего слать отчёты', () => {
    svc.ingest(report('a'));
    jest.advanceTimersByTime(46_000);
    expect(svc.snapshot().players).toBe(0);
  });

  it('доля подвисающих считается по клиентам, а не по отчётам', () => {
    svc.ingest(report('a', { stalls: 3 }));
    svc.ingest(report('b'));
    svc.ingest(report('c'));
    svc.ingest(report('d'));
    expect(svc.snapshot().stallingShare).toBeCloseTo(0.25);
  });

  it('раскладывает клиентов по качествам', () => {
    svc.ingest(report('a', { rendition: 'hd' }));
    svc.ingest(report('b', { rendition: 'p720' }));
    svc.ingest(report('c', { rendition: 'p720' }));
    const s = svc.snapshot();
    expect(s.byRendition.get('p720')).toBe(2);
    expect(s.byRendition.get('hd')).toBe(1);
  });

  it('раскладывает клиентов по стримам', () => {
    svc.ingest(report('a'));
    svc.ingest(report('b', { streamKey: 'club/court-b' }));
    svc.ingest(report('c', { streamKey: 'club/court-b' }));
    expect(svc.snapshot().byStream.get('club/court-b')).toBe(2);
  });

  it('отдаёт 95-й перцентиль загрузки фрагмента, а не среднее', () => {
    for (let i = 1; i <= 100; i++) svc.ingest(report(`c${i}`, { fragLoadMs: i * 10 }));
    expect(svc.snapshot().fragLoadP95).toBe(950);
  });

  it('без отчётов перцентиль равен null, а не нулю', () => {
    expect(svc.snapshot().fragLoadP95).toBeNull();
  });

  it('свежий отчёт продлевает жизнь клиента', () => {
    svc.ingest(report('a'));
    jest.advanceTimersByTime(30_000);
    svc.ingest(report('a'));
    jest.advanceTimersByTime(30_000);
    expect(svc.snapshot().players).toBe(1);
  });
});

describe('percentile', () => {
  it('на пустом наборе возвращает null', () => {
    expect(percentile([], 0.95)).toBeNull();
  });

  it('на одном значении возвращает его же', () => {
    expect(percentile([42], 0.95)).toBe(42);
  });

  it('не зависит от порядка входных данных', () => {
    expect(percentile([5, 1, 4, 2, 3], 0.5)).toBe(3);
  });
});
