import { Module } from '@nestjs/common';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';
import { ThumbnailModule } from '../thumbnail/thumbnail.module';

@Module({
  imports: [ThumbnailModule],
  controllers: [PublicController],
  providers: [PublicService],
})
export class PublicModule {}
