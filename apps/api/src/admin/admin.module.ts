import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AuthModule } from '../auth/auth.module';
import { ContactModule } from '../contact/contact.module';
import { FeedbackModule } from '../feedback/feedback.module';
import { RecordingModule } from '../recording/recording.module';

@Module({
  imports: [AuthModule, ContactModule, FeedbackModule, RecordingModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
