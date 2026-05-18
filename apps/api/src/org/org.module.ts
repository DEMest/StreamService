import { Module } from '@nestjs/common';
import { OrgController } from './org.controller';
import { OrgService } from './org.service';
import { MediamtxWebhookController } from './mediamtx-webhook.controller';
import { RecordingModule } from '../recording/recording.module';
import { ChatModule } from '../chat/chat.module';

@Module({
  imports: [RecordingModule, ChatModule],
  controllers: [OrgController, MediamtxWebhookController],
  providers: [OrgService],
  exports: [OrgService],
})
export class OrgModule {}
