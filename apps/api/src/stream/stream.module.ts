import { Module } from '@nestjs/common';
import { StreamService } from './stream.service';
import { MediamtxModule } from '../mediamtx/mediamtx.module';
import { RecordingModule } from '../recording/recording.module';

@Module({
  imports: [MediamtxModule, RecordingModule],
  providers: [StreamService],
  exports: [StreamService],
})
export class StreamModule {}
