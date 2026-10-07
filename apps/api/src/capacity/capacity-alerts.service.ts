import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../notify/mail.service';
import { TelegramService } from '../notify/telegram.service';
import { DiskStatus, readArchiveDisk } from '../org/archive-disk';
import { CapacityCollectorService } from './capacity-collector.service';
import { CapacityIncident, IncidentEvent } from './capacity.types';
import { IncidentDetector } from './incident-detector';
import { DiskSpaceWatch } from './disk-watch';
import { CapacityService } from './capacity.service';

/** Сколько последних инцидентов показываем на экране. */
const FEED_LIMIT = 20;

/**
 * Инциденты ёмкости: обнаружение, хранение и уведомления.
 *
 * Раз в минуту берётся последняя точка сборщика, прогоняется через пороги, и
 * открытия с закрытиями пишутся в базу. База нужна именно затем, чтобы
 * «моменты падения» пережили перезапуск API: ночной инцидент, о котором знала
 * только оперативная память, ничем не отличается от неслучившегося.
 *
 * Тем же кроном проверяется свободное место на томе архива (`disk-watch.ts`).
 *
 * Уведомления уходят fire-and-forget — недоступная почта или телеграм не
 * должны влиять ни на эфир, ни на запись самого инцидента.
 */
@Injectable()
export class CapacityAlertsService {
  private readonly logger = new Logger(CapacityAlertsService.name);
  private readonly detector = new IncidentDetector();
  private readonly disk = new DiskSpaceWatch();
  private readonly demo = process.env.CAPACITY_DEMO === 'true';
  /** Подхвачен ли из базы disk-инцидент, открытый до рестарта. */
  private diskResumed = false;
  private lastDiskStatus: DiskStatus | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly collector: CapacityCollectorService,
    private readonly capacity: CapacityService,
    private readonly mail: MailService,
    private readonly telegram: TelegramService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async check(): Promise<void> {
    // Синтетическая нагрузка стенда не должна порождать настоящих инцидентов и
    // настоящих писем. Демо-кривая специально доходит до перегруза — без этой
    // проверки стенд молча рассылал бы тревоги о канале, которого нет. Диск на
    // стенде настоящий, но и его пропускаем: экран там показывает демо-ленту,
    // и письмо пришло бы об инциденте, которого на экране не найти.
    if (this.demo) return;

    const now = Date.now();
    const events = [...this.thresholdEvents(now), ...(await this.diskEvents(now))];

    for (const e of events) {
      try {
        await this.apply(e);
      } catch (err: unknown) {
        this.logger.warn(`Не удалось записать инцидент ${e.kind}: ${(err as Error)?.message}`);
      }
    }
  }

  private thresholdEvents(now: number): IncidentEvent[] {
    const history = this.collector.history();
    const last = history[history.length - 1];
    if (!last) return [];

    const snapshot = this.capacity.getSnapshot();
    return this.detector
      .evaluate(last, { utilization: snapshot.utilization, encodeSpeed: snapshot.health.encodeSpeed }, now)
      .map((e) => ({
        kind: e.rule.kind,
        action: e.action,
        severity: e.rule.severity,
        title: e.rule.title,
        peak: e.peak,
        at: e.at,
      }));
  }

  /**
   * Диск не зависит от точек сборщика: место кончается и без единого зрителя.
   * Тот же statfs, что у карточки «Хранилище», и то же условие — архив в
   * локальном MinIO; во внешнем S3 архив этот том не ест.
   */
  private async diskEvents(now: number): Promise<IncidentEvent[]> {
    const reading = readArchiveDisk();
    this.logDiskStatus(reading.diskStatus, reading.error);
    if (!reading.disk) return [];

    if (!this.diskResumed) {
      try {
        const open = await this.prisma.capacityIncident.findFirst({
          where: { kind: 'disk', endedAt: null },
          orderBy: { startedAt: 'desc' },
        });
        if (open && (open.severity === 'warn' || open.severity === 'crit')) {
          this.disk.resume(open.severity, open.peak);
        }
        this.diskResumed = true;
      } catch (err: unknown) {
        // Не зная, открыт ли инцидент, лучше пропустить минуту, чем открыть
        // дубликат. Следующий тик попробует снова.
        this.logger.warn(`Не удалось прочитать открытый инцидент диска: ${(err as Error)?.message}`);
        return [];
      }
    }

    return this.disk.evaluate(reading.disk.freeBytes, now);
  }

  /** Раз на смену статуса, а не каждую минуту: на dev-машине /recordings нет вовсе. */
  private logDiskStatus(status: DiskStatus, error?: string): void {
    if (status === this.lastDiskStatus) return;
    this.lastDiskStatus = status;
    if (status === 'unavailable') this.logger.warn(`Место на диске не проверяется: ${error}`);
    if (status === 'external') {
      this.logger.log('Архив не в локальном MinIO (S3_ENDPOINT) — тревога о месте на диске выключена');
    }
  }

  private async apply(e: IncidentEvent): Promise<void> {
    // Тревогу шлём до записи в базу, а не после: запись может не пройти, и
    // ровно тогда, когда тревога нужнее всего, — полный диск роняет Postgres.
    // Состояние детектора к этому моменту уже сдвинулось, так что неудачная
    // запись без этого означала бы потерянную тревогу без повтора.
    if (e.action !== 'close') {
      this.notify(`${e.action === 'open' ? '⚠️' : '🔴'} ${e.title}`, withHint(`Пик: ${e.peak}`, e.hint));
    }

    if (e.action === 'open') {
      await this.create(e);
      return;
    }

    // Обновляем и закрываем самый свежий незакрытый инцидент этого типа. Их не
    // может быть больше одного — детектор не откроет второй, пока не закрыт
    // первый, — но после перезапуска API в базе мог остаться висящий.
    const open = await this.prisma.capacityIncident.findFirst({
      where: { kind: e.kind, endedAt: null },
      orderBy: { startedAt: 'desc' },
    });

    if (e.action === 'escalate') {
      // Строки нет, если открытие не записалось (база была недоступна), —
      // тогда повышение и есть первая запись об инциденте.
      if (open) {
        await this.prisma.capacityIncident.update({
          where: { id: open.id },
          data: { severity: e.severity, title: e.title, peak: e.peak || open.peak },
        });
      } else {
        await this.create(e);
      }
      return;
    }

    if (!open) return;

    await this.prisma.capacityIncident.update({
      where: { id: open.id },
      data: { endedAt: new Date(e.at), peak: e.peak || open.peak },
    });

    const lasted = humanDuration(e.at - open.startedAt.getTime());
    this.notify(`✅ Восстановлено: ${e.title}`, `Длилось ${lasted}, пик: ${e.peak || open.peak}`);
  }

  private async create(e: IncidentEvent): Promise<void> {
    await this.prisma.capacityIncident.create({
      data: {
        kind: e.kind,
        severity: e.severity,
        title: e.title,
        startedAt: new Date(e.at),
        peak: e.peak,
      },
    });
  }

  /** Оба канала разом и без ожидания: это уведомление, а не транзакция. */
  private notify(subject: string, text: string): void {
    void this.mail.send(subject, text);
    void this.telegram.send(`${subject}\n${text}`);
  }

  /** Лента для экрана: свежие первыми. */
  async recent(): Promise<CapacityIncident[]> {
    const rows = await this.prisma.capacityIncident.findMany({
      orderBy: { startedAt: 'desc' },
      take: FEED_LIMIT,
    });

    return rows.map((r) => ({
      id: r.id,
      kind: r.kind as CapacityIncident['kind'],
      severity: r.severity as CapacityIncident['severity'],
      title: r.title,
      startedAt: r.startedAt.getTime(),
      endedAt: r.endedAt ? r.endedAt.getTime() : null,
      peak: r.peak,
    }));
  }
}

function withHint(text: string, hint?: string): string {
  return hint ? `${text}\n${hint}` : text;
}

/** Инцидент с диском длится сутками — «4320 мин» в письме никто не пересчитает. */
export function humanDuration(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 ? `${h} ч ${min % 60} мин` : `${h} ч`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} дн ${h % 24} ч` : `${d} дн`;
}
