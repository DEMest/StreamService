import { Module } from '@nestjs/common';
import { FeedbackService } from './feedback.service';
import { NotifyModule } from '../notify/notify.module';

@Module({
  imports: [NotifyModule],
  providers: [FeedbackService],
  exports: [FeedbackService],
})
export class FeedbackModule {}
