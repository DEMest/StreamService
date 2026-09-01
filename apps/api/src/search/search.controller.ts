import { Controller, Get, Header, Query } from '@nestjs/common';
import { SearchService } from './search.service';

/**
 * Публичный поиск по сайту. Без авторизации: отдаёт только то, что и так
 * открыто анониму.
 *
 * Кэш короткий: список эфиров меняется в момент выхода в эфир, а поиск —
 * первое, куда пойдёт зритель, не нашедший трансляцию.
 */
@Controller('v1/public/search')
export class SearchController {
  constructor(private search: SearchService) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=30')
  find(@Query('q') q?: string) {
    return this.search.search(q ?? '');
  }
}
