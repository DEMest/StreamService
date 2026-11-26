import { Module } from '@nestjs/common';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';
import { ThumbnailModule } from '../thumbnail/thumbnail.module';
import { ContactModule } from '../contact/contact.module';
import { FeedbackModule } from '../feedback/feedback.module';
import { StorageModule } from '../storage/storage.module';
import { EventFeedController } from '../event/event-feed.controller';
import { EventFeedService } from '../event/event-feed.service';

@Module({
  imports: [ThumbnailModule, ContactModule, FeedbackModule, StorageModule],
  controllers: [PublicController, EventFeedController],
  providers: [PublicService, EventFeedService],
})
export class PublicModule {}
