import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { NotifyModule } from '../notify/notify.module';
import { AdsService } from './ads.service';
import { AdManagerBootstrap } from './ad-manager.bootstrap';
import { AdminAdsController } from './admin-ads.controller';
import { PublicAdsController } from './public-ads.controller';

@Module({
  imports: [StorageModule, NotifyModule],
  controllers: [AdminAdsController, PublicAdsController],
  providers: [AdsService, AdManagerBootstrap],
})
export class AdsModule {}
