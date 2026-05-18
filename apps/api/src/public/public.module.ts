import { Module } from '@nestjs/common';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';
import { ThumbnailModule } from '../thumbnail/thumbnail.module';
import { ContactModule } from '../contact/contact.module';

@Module({
  imports: [ThumbnailModule, ContactModule],
  controllers: [PublicController],
  providers: [PublicService],
})
export class PublicModule {}
