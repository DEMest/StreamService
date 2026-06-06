import { Module } from '@nestjs/common';
import { StreamService } from './stream.service';
import { StreamController } from './stream.controller';
import { SlotStateService } from './slot-state.service';
import { MediamtxModule } from '../mediamtx/mediamtx.module';
import { RecordingModule } from '../recording/recording.module';

/**
 * forwardRef для пары StreamService ↔ SlotStateService: SlotState на старте
 * (onModuleInit) обращается к StreamService.resolvePathToStream для
 * reconcile-логики, а StreamService уже зависит от SlotState через
 * webhook-хэндлер. Внутри одного модуля forwardRef локальный, без затрагивания
 * MediamtxModule/RecordingModule.
 */
@Module({
  imports: [MediamtxModule, RecordingModule],
  controllers: [StreamController],
  providers: [StreamService, SlotStateService],
  exports: [StreamService, SlotStateService],
})
export class StreamModule {}

