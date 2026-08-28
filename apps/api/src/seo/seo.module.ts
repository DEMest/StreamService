import { Module } from '@nestjs/common';
import { SeoController } from './seo.controller';
import { SeoService } from './seo.service';
import { IndexNowService } from './indexnow.service';
import { GoogleIndexingService } from './google-indexing.service';
import { SeoPingService } from './seo-ping.service';

/**
 * SEO: данные для sitemap.xml и мета-разметки фронта + пинг поисковикам при
 * старте/завершении эфира.
 *
 * `SeoPingService` экспортируется наружу — его дёргает StreamService из
 * обработчика webhook'а MediaMTX. Обратной зависимости нет, поэтому forwardRef
 * здесь не нужен.
 */
@Module({
  controllers: [SeoController],
  providers: [SeoService, IndexNowService, GoogleIndexingService, SeoPingService],
  exports: [SeoPingService],
})
export class SeoModule {}
