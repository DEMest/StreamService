import { Global, Module } from '@nestjs/common';
import { StatsService } from './stats.service';

/**
 * Global: счётчик зрителей дёргается из RecordingController (модуль recording),
 * а снимок статистики отдаёт StreamController — заводить перекрёстные импорты
 * ради одного сервиса-синглтона с состоянием в памяти ни к чему.
 */
@Global()
@Module({
  providers: [StatsService],
  exports: [StatsService],
})
export class StatsModule {}
