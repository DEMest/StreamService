import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { CapacityCollectorService } from './capacity-collector.service';
import { CapacityPoint } from './capacity.types';
import { HostMetricsReader } from './host-metrics';

/** Сколько держим минутные срезы. Дальше сравнивать турниры уже не с чем. */
const RETENTION_DAYS = 90;
const MINUTE_MS = 60_000;
/** Ключ среза по всему серверу. Пустая строка, а не NULL — см. схему. */
const SERVER_KEY = '';

/**
 * Минутные срезы нагрузки в Postgres.
 *
 * Живая история лежит в памяти сборщика и умирает вместе с процессом — этого
 * достаточно, чтобы смотреть на эфир прямо сейчас, но не чтобы ответить, что
 * было на прошлом турнире. А именно сравнение турниров и подтверждает потолок:
 * одна удачная трансляция ничего не доказывает.
 *
 * Пишем усреднение по минуте, а не каждую десятисекундную точку: за 90 дней
 * это 130 тысяч строк вместо восьмисот, а разрешения в минуту хватает для
 * любого вывода о ёмкости.
 */
@Injectable()
export class CapacityStoreService {
  private readonly logger = new Logger(CapacityStoreService.name);
  /** Последняя записанная минута: защита от повторной записи того же среза. */
  private lastFlushedMinute = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly collector: CapacityCollectorService,
    private readonly host: HostMetricsReader,
  ) {}

  @Cron('30 * * * * *')
  async flushCron(): Promise<void> {
    await this.flush();
  }

  async flush(): Promise<void> {
    const history = this.collector.history();
    if (history.length === 0) return;

    // Текущая минута ещё наполняется — её срез был бы неполным и занял бы
    // место, после чего защита от дублей не дала бы записать её целиком.
    const currentMinute = Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;

    const byMinute = new Map<number, CapacityPoint[]>();
    for (const p of history) {
      const minute = Math.floor(p.t / MINUTE_MS) * MINUTE_MS;
      if (minute >= currentMinute) continue;
      if (minute <= this.lastFlushedMinute) continue;
      const bucket = byMinute.get(minute);
      if (bucket) bucket.push(p);
      else byMinute.set(minute, [p]);
    }
    if (byMinute.size === 0) return;

    const hostMetrics = this.host.read();
    const renditionMix = Object.fromEntries(
      this.collector.renditions().map((r) => [r.key, r.viewers]),
    );

    const data: Array<Record<string, unknown>> = [];
    for (const [minute, points] of byMinute) {
      const avg = (pick: (p: CapacityPoint) => number) =>
        points.reduce((a, p) => a + pick(p), 0) / points.length;

      data.push({
        at: new Date(minute),
        streamKey: SERVER_KEY,
        viewers: Math.round(avg((p) => p.viewers)),
        egressMbps: +avg((p) => p.egressMbps).toFixed(2),
        cacheHitRatio: +avg((p) => p.cacheHitRatio).toFixed(3),
        errorRate: +avg((p) => p.errorRate).toFixed(4),
        stallShare: +avg((p) => p.stallRatio).toFixed(3),
        fragLoadP95: null,
        renditionMix,
        cpuUsage: hostMetrics.cpu.usage,
        memoryUsage: hostMetrics.memory.usage,
        netTxMbps: hostMetrics.net?.txMbps ?? null,
      });
    }

    // Разрез по стримам пишется только за последнюю закрытую минуту: сборщик
    // держит по стримам лишь текущее состояние, а не историю.
    const latestMinute = Math.max(...byMinute.keys());
    for (const [streamKey, load] of this.collector.byStream()) {
      data.push({
        at: new Date(latestMinute),
        streamKey,
        viewers: load.viewers,
        egressMbps: load.egressMbps,
        cacheHitRatio: 0,
        errorRate: 0,
        stallShare: 0,
        fragLoadP95: null,
        renditionMix: {},
        cpuUsage: null,
        memoryUsage: null,
        netTxMbps: null,
      });
    }

    try {
      // skipDuplicates: параллельный экземпляр API (например, в момент
      // выкатки) мог успеть записать ту же минуту. Это не ошибка.
      await this.prisma.capacitySample.createMany({ data: data as never, skipDuplicates: true });
      this.lastFlushedMinute = Math.max(this.lastFlushedMinute, latestMinute);
    } catch (err: unknown) {
      // Метрики не стоят того, чтобы их сбой ронял что-либо ещё.
      this.logger.warn(`Не удалось записать срезы ёмкости: ${(err as Error)?.message ?? err}`);
    }
  }

  /**
   * История за период. Отдаёт те же `CapacityPoint`, что и живой сборщик, —
   * экран не должен знать, из памяти пришли данные или из базы.
   */
  async range(from: Date, to: Date, streamKey = SERVER_KEY): Promise<CapacityPoint[]> {
    const rows = await this.prisma.capacitySample.findMany({
      where: { at: { gte: from, lte: to }, streamKey },
      orderBy: { at: 'asc' },
      select: {
        at: true,
        viewers: true,
        egressMbps: true,
        cacheHitRatio: true,
        errorRate: true,
        stallShare: true,
      },
    });

    return rows.map((r) => ({
      t: r.at.getTime(),
      viewers: r.viewers,
      egressMbps: r.egressMbps,
      cacheHitRatio: r.cacheHitRatio,
      errorRate: r.errorRate,
      stallRatio: r.stallShare,
    }));
  }

  /** Ночная уборка — рядом с существующей чисткой записей. */
  @Cron('0 15 3 * * *')
  async cleanup(): Promise<number> {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000);
    const { count } = await this.prisma.capacitySample.deleteMany({ where: { at: { lt: cutoff } } });
    if (count > 0) this.logger.log(`Удалено ${count} устаревших срезов ёмкости`);
    return count;
  }
}
