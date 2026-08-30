import { Module } from '@nestjs/common';
import { CapacityController } from './capacity.controller';
import { CapacityService } from './capacity.service';
import { CapacityCollectorService } from './capacity-collector.service';
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
