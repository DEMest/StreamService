import { Module } from '@nestjs/common';
import { StreamService } from './stream.service';
import { StreamController } from './stream.controller';
import { MediamtxModule } from '../mediamtx/mediamtx.module';
import { RecordingModule } from '../recording/recording.module';
import { ChatModule } from '../chat/chat.module';

@Module({
  imports: [MediamtxModule, RecordingModule, ChatModule],
  controllers: [StreamController],
  providers: [StreamService],
  exports: [StreamService],
})
export class StreamModule {}

