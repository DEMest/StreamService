import { CapacityIncident } from './capacity.types';
import { CLOSE_AFTER, OPEN_AFTER } from './incident-detector';
import { DISK_RESERVE_BYTES } from '../org/storage-estimate';

/**
 * Тревога о свободном месте на томе архива.
 *
 * Архив записей сам не удаляется, а лежит на одном разделе с живым HLS,
 * scratch записи и Postgres. Забитый под ноль диск останавливает лесенку
 * FFmpeg у всех орг сразу и может уронить базу — то есть это не проблема
 * архива, а авария всего эфира, и узнать о ней надо раньше, чем она случится.
 *
 * Пороги выведены из `DISK_RESERVE_BYTES` — того же резерва, который дашборд
 * орги вычитает из свободного места. Своих чисел здесь нет намеренно: тревога
 * и прогноз «сколько часов записи влезет» обязаны говорить об одном и том же.
 */

type Severity = CapacityIncident['severity'];

/** Предупреждение: до резерва осталось столько же, сколько весит сам резерв. */
export const DISK_WARN_BYTES = 2 * DISK_RESERVE_BYTES;
/** Критично: свободное место ушло в резерв, дашборд орги уже показывает «0 ч записи». */
export const DISK_CRIT_BYTES = DISK_RESERVE_BYTES;
/**
 * Закрытие — только выше этой границы, а не на пороге открытия.
 *
 * Свободное место ходит пилой: пока идёт запись, оно убывает, на финализации
 * проваливается ещё на два размера записи (`FINALIZE_PEAK_FACTOR`), а после
 * заливки в S3 scratch удаляется и место прыгает обратно вверх. Восьмичасовой
 * эфир даёт зубец в 30–40 ГБ. Закрывай мы ровно на пороге открытия, каждый
 * эфир у границы приносил бы пару писем «мало места» / «восстановлено», и
 * через неделю их перестали бы читать. Целый резерв сверху перекрывает зубец
 * любого реального эфира: «восстановлено» значит, что место освободили, а не
 * что закончилась очередная заливка.
 */
export const DISK_CLEAR_BYTES = DISK_WARN_BYTES + DISK_RESERVE_BYTES;

const TITLES: Record<Severity, string> = {
  warn: 'Заканчивается место на диске',
  crit: 'Диск почти заполнен',
};

/**
 * Двоичные гигабайты, как у плитки диска на `/admin/capacity`: пик инцидента
 * читают рядом с ней, и разные единицы дали бы два разных числа об одном.
 */
const GIB = 1024 ** 3;
const gib = (bytes: number) => (bytes < 10 * GIB ? (bytes / GIB).toFixed(1) : Math.round(bytes / GIB).toString());

/** Что делать получившему тревогу. Уходит в письмо и телеграм, на экран — нет. */
export const DISK_HINT =
  'Архив записей сам не удаляется. Удалите старые записи или расширьте раздел: ' +
  'на полном диске встанет HLS всех эфиров и может упасть Postgres. ' +
  `Тревога снимется, когда свободно будет больше ${gib(DISK_CLEAR_BYTES)} ГБ.`;

/** Пик инцидента — худшее, то есть наименьшее, свободное место за время просадки. */
export function formatFree(bytes: number): string {
  return `свободно ${gib(bytes)} ГБ`;
}

/**
 * Обратное к {@link formatFree}. Нужно после рестарта: в базе лежит только
 * текст пика, а сравнивать новые замеры приходится с числом.
 */
export function parseFreePeak(text: string): number | null {
  const m = /^свободно (\d+(?:\.\d+)?) ГБ$/.exec(text);
  return m ? Number(m[1]) * GIB : null;
}

export function diskLevel(freeBytes: number): Severity | null {
  if (freeBytes < DISK_CRIT_BYTES) return 'crit';
  if (freeBytes < DISK_WARN_BYTES) return 'warn';
  return null;
}

export interface DiskEvent {
  kind: 'disk';
  /**
   * escalate — тот же инцидент перешёл из warn в crit. Отдельного инцидента
   * на crit нет: два открытых сразу о том же диске — это две строки в ленте
   * и двойные письма об одной беде.
   */
  action: 'open' | 'escalate' | 'close';
  /** Худший уровень за время инцидента: назад до warn он не опускается. */
  severity: Severity;
  title: string;
  peak: string;
  at: number;
  hint: string;
}

/**
 * Автомат тревоги о диске.
 *
 * От {@link IncidentDetector} он отличается тремя вещами, ради которых и
 * вынесен отдельно, а не втиснут правилом в общий список: у него два уровня
 * в одном инциденте, гистерезис по значению, а не только по времени, и он
 * переживает рестарт API (см. {@link resume}). Терпение к шуму — те же
 * `OPEN_AFTER` / `CLOSE_AFTER`, что и у остальных порогов.
 */
export class DiskSpaceWatch {
  /** Уровень открытого инцидента; null — инцидента нет. */
  private level: Severity | null = null;
  private lowInARow = 0;
  private critInARow = 0;
  private clearInARow = 0;
  private worstFree = Infinity;
  private worstText = '';

  openLevel(): Severity | null {
    return this.level;
  }

  /**
   * Подхватить инцидент, открытый до рестарта.
   *
   * Остальные пороги начинают после рестарта с чистого листа — их инциденты
   * длятся минуты. Нехватка места длится днями, а каждый мерж в main — это
   * рестарт API, так что без этого каждая выкатка открывала бы в базе
   * дубликат и слала повторное письмо о том, о чём уже знают, а исходная
   * строка висела бы открытой вечно.
   */
  resume(level: Severity, peak: string): void {
    this.level = level;
    // Не разобрали пик — не перетираем его вовсе: старый пик честнее, чем
    // минимум только за время после рестарта.
    this.worstFree = parseFreePeak(peak) ?? -Infinity;
    this.worstText = peak;
  }

  /** @param freeBytes null — замера нет; он ничего не подтверждает и не опровергает. */
  evaluate(freeBytes: number | null, now: number): DiskEvent[] {
    if (freeBytes === null) return [];

    const level = diskLevel(freeBytes);
    this.lowInARow = level ? this.lowInARow + 1 : 0;
    this.critInARow = level === 'crit' ? this.critInARow + 1 : 0;
    this.clearInARow = freeBytes >= DISK_CLEAR_BYTES ? this.clearInARow + 1 : 0;

    if (level && freeBytes < this.worstFree) {
      this.worstFree = freeBytes;
      this.worstText = formatFree(freeBytes);
    }

    if (this.level === null) {
      if (this.lowInARow < OPEN_AFTER) {
        // Просадка, не дотянувшая до инцидента, не должна оставлять свой
        // минимум следующей.
        if (!level) this.resetWorst();
        return [];
      }
      this.level = this.critInARow >= OPEN_AFTER ? 'crit' : 'warn';
      return [this.event('open', now)];
    }

    if (this.level === 'warn' && this.critInARow >= OPEN_AFTER) {
      this.level = 'crit';
      return [this.event('escalate', now)];
    }

    if (this.clearInARow >= CLOSE_AFTER) {
      const closed = this.event('close', now);
      this.level = null;
      this.resetWorst();
      return [closed];
    }

    return [];
  }

  private event(action: DiskEvent['action'], at: number): DiskEvent {
    const severity = this.level!;
    return { kind: 'disk', action, severity, title: TITLES[severity], peak: this.worstText, at, hint: DISK_HINT };
  }

  private resetWorst(): void {
    this.worstFree = Infinity;
    this.worstText = '';
  }
}
