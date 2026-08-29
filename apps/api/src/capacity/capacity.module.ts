import { Module } from '@nestjs/common';
import { CapacityController } from './capacity.controller';
import { CapacityService } from './capacity.service';
import { QoeController } from './qoe.controller';
import { QoeService } from './qoe.service';

@Module({
  controllers: [CapacityController, QoeController],
  providers: [CapacityService, QoeService],
  exports: [CapacityService, QoeService],
})
export class CapacityModule {}
