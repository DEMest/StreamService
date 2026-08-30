import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../notify/mail.service';
import { TelegramService } from '../notify/telegram.service';
import { CapacityCollectorService } from './capacity-collector.service';
import { CapacityIncident } from './capacity.types';
import { DetectorEvent, IncidentDetector } from './incident-detector';
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
 * Уведомления уходят fire-and-forget — недоступная почта или телеграм не
 * должны влиять ни на эфир, ни на запись самого инцидента.
 */
@Injectable()
export class CapacityAlertsService {
  private readonly logger = new Logger(CapacityAlertsService.name);
  private readonly detector = new IncidentDetector();

  constructor(
    private readonly prisma: PrismaService,
    private readonly collector: CapacityCollectorService,
    private readonly capacity: CapacityService,
    private readonly mail: MailService,
    private readonly telegram: TelegramService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async check(): Promise<void> {
    const history = this.collector.history();
    const last = history[history.length - 1];
    if (!last) return;

    const snapshot = this.capacity.getSnapshot();
    const events = this.detector.evaluate(
      last,
      { utilization: snapshot.utilization, encodeSpeed: snapshot.health.encodeSpeed },
      Date.now(),
    );

    for (const e of events) {
      try {
        await this.apply(e);
      } catch (err: unknown) {
        this.logger.warn(`Не удалось записать инцидент ${e.rule.kind}: ${(err as Error)?.message}`);
      }
    }
  }

  private async apply(e: DetectorEvent): Promise<void> {
    if (e.action === 'open') {
      await this.prisma.capacityIncident.create({
        data: {
          kind: e.rule.kind,
          severity: e.rule.severity,
          title: e.rule.title,
          startedAt: new Date(e.at),
          peak: e.peak,
        },
      });
      this.notify(`⚠️ ${e.rule.title}`, `Пик: ${e.peak}`);
      return;
    }

    // Закрываем самый свежий незакрытый инцидент этого типа. Их не может быть
    // больше одного — детектор не откроет второй, пока не закрыт первый, — но
    // после перезапуска API в базе мог остаться висящий.
    const open = await this.prisma.capacityIncident.findFirst({
      where: { kind: e.rule.kind, endedAt: null },
      orderBy: { startedAt: 'desc' },
    });
    if (!open) return;

    await this.prisma.capacityIncident.update({
      where: { id: open.id },
      data: { endedAt: new Date(e.at), peak: e.peak || open.peak },
    });

    const minutes = Math.max(1, Math.round((e.at - open.startedAt.getTime()) / 60_000));
    this.notify(`✅ Восстановлено: ${e.rule.title}`, `Длилось ${minutes} мин, пик: ${e.peak}`);
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
