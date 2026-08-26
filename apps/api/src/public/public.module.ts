import { Module } from '@nestjs/common';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';
import { ThumbnailModule } from '../thumbnail/thumbnail.module';
import { ContactModule } from '../contact/contact.module';
import { FeedbackModule } from '../feedback/feedback.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [ThumbnailModule, ContactModule, FeedbackModule, StorageModule],
  controllers: [PublicController],
  providers: [PublicService],
})
export class PublicModule {}
