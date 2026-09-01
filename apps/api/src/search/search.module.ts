import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

/**
 * Поиск по публичной части сайта. Отдельный модуль, а не ещё один метод в
 * PublicService: тот и так отвечает за каталог, watch, архив и превью.
 */
@Module({
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
