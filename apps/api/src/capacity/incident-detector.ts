import { CapacityIncident, CapacityPoint } from './capacity.types';

/**
 * Сколько подряд оценок нужно, чтобы открыть и чтобы закрыть инцидент.
 *
 * Открытие быстрее закрытия намеренно: о проблеме лучше узнать на минуту
 * раньше, а вот объявлять её решённой стоит только когда отпустило всерьёз.
 * Симметричные пороги дают «мигающий» инцидент на границе — а вместе с ним
 * пачку писем, после которой уведомления перестают читать.
 */
const OPEN_AFTER = 2;
const CLOSE_AFTER = 3;

/** Занятость канала, выше которой запаса на всплеск уже нет. */
const UPLINK_LIMIT = 0.8;
/** Ниже этой скорости кодирования зритель видит рывки. */
const ENCODE_LIMIT = 0.95;
/** Доля ответов с ошибкой, выше которой это уже отказы зрителям. */
const ERROR_LIMIT = 0.01;
/** Доля зрителей с подвисаниями, выше которой это уже не единичный случай. */
const STALL_LIMIT = 0.05;

/** Всё, что нужно правилам сверх самой точки. */
export interface RuleContext {
  /** Занятая доля канала, 0..1. */
  utilization: number;
  /** speed FFmpeg; null — эфира нет, и судить не о чем. */
  encodeSpeed: number | null;
}

export interface Rule {
  kind: CapacityIncident['kind'];
  severity: CapacityIncident['severity'];
  title: string;
  breached(p: CapacityPoint, ctx: RuleContext): boolean;
  peak(p: CapacityPoint, ctx: RuleContext): string;
}

/**
 * Правила порогов.
 *
 * `offline` сюда не входит: обрыв эфира приходит событием от MediaMTX, а не
 * вычисляется из чисел. Смешивать эти два механизма — значит ждать порога там,
 * где факт уже известен.
 */
export const RULES: Rule[] = [
  {
    kind: 'uplink',
    severity: 'crit',
    title: 'Канал занят более 80%',
    breached: (_p, ctx) => ctx.utilization >= UPLINK_LIMIT,
    peak: (_p, ctx) => `${Math.round(ctx.utilization * 100)}% канала`,
  },
  {
    kind: 'encode',
    severity: 'warn',
    title: 'Кодирование не успевает за эфиром',
    breached: (_p, ctx) => ctx.encodeSpeed !== null && ctx.encodeSpeed < ENCODE_LIMIT,
    peak: (_p, ctx) => `speed ${ctx.encodeSpeed?.toFixed(2) ?? '—'}`,
  },
  {
    kind: 'errors',
    severity: 'warn',
    title: 'Всплеск ошибок в ответах',
    breached: (p) => p.errorRate > ERROR_LIMIT,
    peak: (p) => `${(p.errorRate * 100).toFixed(1)}% ответов`,
  },
  {
    kind: 'stalls',
    severity: 'warn',
    title: 'Подвисания у части зрителей',
    breached: (p) => p.stallRatio > STALL_LIMIT,
    peak: (p) => `${Math.round(p.stallRatio * 100)}% зрителей`,
  },
];

export interface DetectorEvent {
  rule: Rule;
  action: 'open' | 'close';
  /** Худшее значение за время инцидента — для открытия; последнее — для закрытия. */
  peak: string;
  at: number;
}

interface RuleState {
  breachedInARow: number;
  calmInARow: number;
  open: boolean;
  /** Худшее числовое значение с момента открытия — по нему выбирается пик. */
  worst: number;
  worstText: string;
}

/**
 * Отслеживание порогов во времени.
 *
 * Состояние держится в памяти: детектор отвечает на вопрос «стало ли хуже
 * прямо сейчас», а сами инциденты, уже открытые, лежат в базе и переживают
 * перезапуск. После рестарта API счётчики начинаются заново — это осознанно:
 * лучше запоздать с уведомлением на две минуты, чем восстанавливать
 * полусостояние и слать ложные тревоги на старте.
 */
export class IncidentDetector {
  private readonly states = new Map<string, RuleState>();

  private stateOf(kind: string): RuleState {
    let st = this.states.get(kind);
    if (!st) {
      st = { breachedInARow: 0, calmInARow: 0, open: false, worst: -Infinity, worstText: '' };
      this.states.set(kind, st);
    }
    return st;
  }

  /** Типы инцидентов, открытых прямо сейчас. */
  openKinds(): CapacityIncident['kind'][] {
    return [...this.states.entries()]
      .filter(([, st]) => st.open)
      .map(([kind]) => kind as CapacityIncident['kind']);
  }

  evaluate(p: CapacityPoint, ctx: RuleContext, now: number): DetectorEvent[] {
    const events: DetectorEvent[] = [];

    for (const rule of RULES) {
      const st = this.stateOf(rule.kind);
      const breached = rule.breached(p, ctx);

      if (breached) {
        st.breachedInARow += 1;
        st.calmInARow = 0;

        // Пик обновляем по числовой величине нарушения, а не по тексту: текст
        // нужен человеку, а сравнивать его между собой бессмысленно.
        const severity = severityValue(rule, p, ctx);
        if (severity > st.worst) {
          st.worst = severity;
          st.worstText = rule.peak(p, ctx);
        }

        if (!st.open && st.breachedInARow >= OPEN_AFTER) {
          st.open = true;
          events.push({ rule, action: 'open', peak: st.worstText, at: now });
        }
      } else {
        st.calmInARow += 1;
        st.breachedInARow = 0;

        if (st.open && st.calmInARow >= CLOSE_AFTER) {
          st.open = false;
          events.push({ rule, action: 'close', peak: st.worstText, at: now });
          st.worst = -Infinity;
          st.worstText = '';
        }
      }
    }

    return events;
  }
}

/**
 * Числовая «глубина» нарушения для сравнения пиков внутри одного инцидента.
 * У скорости кодирования знак обратный: чем меньше, тем хуже.
 */
function severityValue(rule: Rule, p: CapacityPoint, ctx: RuleContext): number {
  switch (rule.kind) {
    case 'uplink':
      return ctx.utilization;
    case 'encode':
      return ctx.encodeSpeed === null ? -Infinity : -ctx.encodeSpeed;
    case 'errors':
      return p.errorRate;
    case 'stalls':
      return p.stallRatio;
    default:
      return 0;
  }
}
