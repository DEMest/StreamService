import { Module } from '@nestjs/common';
import { CapacityController } from './capacity.controller';
import { CapacityService } from './capacity.service';
import { CapacityCollectorService } from './capacity-collector.service';
import { CapacityStoreService } from './capacity-store.service';
import { HostMetricsReader } from './host-metrics';
import { LogTailer } from './log-tailer';
import { QoeController } from './qoe.controller';
import { QoeService } from './qoe.service';

/** Куда nginx пишет лог, размеченный под метрики (см. `CAPACITY_LOG_FORMAT`). */
const DEFAULT_LOG_PATH = '/var/log/nginx/capacity.log';

@Module({
  controllers: [CapacityController, QoeController],
  providers: [
    CapacityService,
    QoeService,
    CapacityCollectorService,
    CapacityStoreService,
    // Один читатель железа на всё приложение: он хранит предыдущий замер ради
    // дельты, и два независимых экземпляра делили бы интервал пополам, занижая
    // загрузку процессора вдвое.
    HostMetricsReader,
    {
      // Фабрика, а не класс в providers: путь к логу задаётся окружением, и
      // тестам удобнее подсунуть свою реализацию чтения.
      provide: LogTailer,
      useFactory: () => new LogTailer(process.env.NGINX_LOG_PATH ?? DEFAULT_LOG_PATH),
    },
  ],
  exports: [CapacityService, QoeService, CapacityCollectorService],
})
export class CapacityModule {}
