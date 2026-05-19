import { Module } from '@nestjs/common';
import { OrgService } from './org.service';
import { OrgController } from './org.controller';
import { MediamtxWebhookController } from './mediamtx-webhook.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { StreamModule } from '../stream/stream.module';
import { RecordingModule } from '../recording/recording.module';
import { ChatModule } from '../chat/chat.module';

@Module({
  imports: [PrismaModule, StreamModule, RecordingModule, ChatModule],
  providers: [OrgService],
  controllers: [OrgController, MediamtxWebhookController],
  exports: [OrgService],
})
export class OrgModule {}
