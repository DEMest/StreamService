import { Module } from '@nestjs/common';
import { StreamService } from './stream.service';
import { StreamController } from './stream.controller';
import { MediamtxModule } from '../mediamtx/mediamtx.module';
import { RecordingModule } from '../recording/recording.module';
import { ChatModule } from '../chat/chat.module';
import { StorageModule } from '../storage/storage.module';
import { SeoModule } from '../seo/seo.module';

@Module({
  imports: [MediamtxModule, RecordingModule, ChatModule, StorageModule, SeoModule],
  controllers: [StreamController],
  providers: [StreamService],
  exports: [StreamService],
})
export class StreamModule {}

