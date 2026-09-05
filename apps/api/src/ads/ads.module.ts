import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { AdsService } from './ads.service';
import { AdminAdsController } from './admin-ads.controller';
import { PublicAdsController } from './public-ads.controller';

@Module({
  imports: [StorageModule],
  controllers: [AdminAdsController, PublicAdsController],
  providers: [AdsService],
})
export class AdsModule {}
