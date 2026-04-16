import { Module } from '@nestjs/common';
import { OrgController } from './org.controller';
import { OrgService } from './org.service';
import { MediamtxWebhookController } from './mediamtx-webhook.controller';
import { RecordingModule } from '../recording/recording.module';

@Module({
  imports: [RecordingModule],
  controllers: [OrgController, MediamtxWebhookController],
  providers: [OrgService],
  exports: [OrgService],
})
export class OrgModule {}
