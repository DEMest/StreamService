import { Module } from '@nestjs/common';
import { EventService } from './event.service';
import { EventController } from './event.controller';

/**
 * Step 5 — Event entity REST API (см. spec §9).
 *
 * PrismaModule глобальный, поэтому отдельный imports не нужен. EventService
 * экспортирован для возможного reuse (но пока никто не консьюмит — Broadcast
 * linking сделан inline в StreamService без зависимости от EventModule,
 * чтобы избежать circular dep между StreamModule и EventModule).
 */
@Module({
  providers: [EventService],
  controllers: [EventController],
  exports: [EventService],
})
export class EventModule {}
