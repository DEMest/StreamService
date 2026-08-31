import { IncidentDetector, RULES, RuleContext } from './incident-detector';
import { CapacityPoint } from './capacity.types';

const point = (over: Partial<CapacityPoint> = {}): CapacityPoint => ({
  t: 0,
  viewers: 100,
  egressMbps: 300,
  cacheHitRatio: 0.95,
  errorRate: 0,
  stallRatio: 0,
  ...over,
});

const calm: RuleContext = { utilization: 0.4, encodeSpeed: 1.0 };
const busy: RuleContext = { utilization: 0.85, encodeSpeed: 1.0 };

describe('IncidentDetector', () => {
  it('не открывает инцидент по одному превышению', () => {
    const d = new IncidentDetector();
    expect(d.evaluate(point(), busy, 0)).toEqual([]);
  });

  it('открывает инцидент после двух минут над порогом', () => {
    const d = new IncidentDetector();
    d.evaluate(point(), busy, 0);
    const out = d.evaluate(point(), busy, 60_000);
    expect(out).toHaveLength(1);
    expect(out[0].action).toBe('open');
    expect(out[0].rule.kind).toBe('uplink');
    expect(out[0].peak).toContain('85%');
  });

  it('не открывает тот же инцидент повторно, пока он не закрыт', () => {
    const d = new IncidentDetector();
    d.evaluate(point(), busy, 0);
    d.evaluate(point(), busy, 60_000);
    expect(d.evaluate(point(), busy, 120_000)).toEqual([]);
  });

  it('закрывает инцидент только после трёх спокойных минут', () => {
    const d = new IncidentDetector();
    d.evaluate(point(), busy, 0);
    d.evaluate(point(), busy, 60_000);

    expect(d.evaluate(point(), calm, 120_000)).toEqual([]);
    expect(d.evaluate(point(), calm, 180_000)).toEqual([]);
    const out = d.evaluate(point(), calm, 240_000);
    expect(out).toHaveLength(1);
    expect(out[0].action).toBe('close');
  });

  it('короткий провал под порог не закрывает инцидент', () => {
    const d = new IncidentDetector();
    d.evaluate(point(), busy, 0);
    d.evaluate(point(), busy, 60_000);

    d.evaluate(point(), calm, 120_000);
    d.evaluate(point(), busy, 180_000); // снова над порогом — счётчик спокойствия сброшен
    expect(d.evaluate(point(), calm, 240_000)).toEqual([]);
    expect(d.evaluate(point(), calm, 300_000)).toEqual([]);
    expect(d.evaluate(point(), calm, 360_000)).toHaveLength(1);
  });

  it('ловит отставание кодирования', () => {
    const d = new IncidentDetector();
    const slow: RuleContext = { utilization: 0.2, encodeSpeed: 0.8 };
    d.evaluate(point(), slow, 0);
    const out = d.evaluate(point(), slow, 60_000);
    expect(out.map((o) => o.rule.kind)).toContain('encode');
    expect(out[0].peak).toContain('0.8');
  });

  it('не жалуется на кодирование, когда эфира нет', () => {
    const d = new IncidentDetector();
    const noStream: RuleContext = { utilization: 0.1, encodeSpeed: null };
    d.evaluate(point(), noStream, 0);
    expect(d.evaluate(point(), noStream, 60_000)).toEqual([]);
  });

  it('ловит подвисания более чем у 5% зрителей', () => {
    const d = new IncidentDetector();
    const p = point({ stallRatio: 0.2 });
    d.evaluate(p, calm, 0);
    const out = d.evaluate(p, calm, 60_000);
    expect(out.map((o) => o.rule.kind)).toContain('stalls');
  });

  it('ловит всплеск ошибок', () => {
    const d = new IncidentDetector();
    const p = point({ errorRate: 0.05 });
    d.evaluate(p, calm, 0);
    expect(d.evaluate(p, calm, 60_000).map((o) => o.rule.kind)).toContain('errors');
  });

  it('может открыть несколько разных инцидентов сразу', () => {
    const d = new IncidentDetector();
    const p = point({ stallRatio: 0.3 });
    d.evaluate(p, busy, 0);
    const out = d.evaluate(p, busy, 60_000);
    expect(out.map((o) => o.rule.kind).sort()).toEqual(['stalls', 'uplink']);
  });

  it('покрывает все объявленные правила', () => {
    expect(RULES.map((r) => r.kind).sort()).toEqual(['encode', 'errors', 'stalls', 'uplink']);
  });

  it('знает, какие инциденты сейчас открыты', () => {
    const d = new IncidentDetector();
    d.evaluate(point(), busy, 0);
    d.evaluate(point(), busy, 60_000);
    expect(d.openKinds()).toEqual(['uplink']);
  });
});
