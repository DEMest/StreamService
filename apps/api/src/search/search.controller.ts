import { Controller, Get, HttpException, HttpStatus, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { SearchService } from './search.service';
import { SlidingWindowLimiter } from '../feedback/rate-limiter';
import { clientIp } from '../feedback/client-ip';

/**
 * Три `ILIKE '%...%'` без индексов на запрос (см. `search.service.ts`) — это
 * последовательное сканирование таблиц, и отдельной зоны `limit_req_zone` для
 * `/api/v1/public/search` в nginx нет, только общие 10 r/s на IP. Живой набор
 * с клавиатуры — не больше нескольких запросов в секунду даже без клиентского
 * дебаунса; 20 в 10 секунд (2 rps) — с запасом на обычный ввод и за одним
 * адресом несколько человек, но не на скрипт, гоняющий тяжёлый LIKE по кругу.
 */
export const SEARCH_RATE_MAX = 20;
export const SEARCH_RATE_WINDOW_MS = 10_000;

/**
 * Публичный поиск по сайту. Без авторизации: отдаёт только то, что и так
 * открыто анониму.
 *
 * Кэш короткий: список эфиров меняется в момент выхода в эфир, а поиск —
 * первое, куда пойдёт зритель, не нашедший трансляцию.
 */
@Controller('v1/public/search')
export class SearchController {
  private readonly limiter = new SlidingWindowLimiter(SEARCH_RATE_MAX, SEARCH_RATE_WINDOW_MS);

  constructor(private search: SearchService) {}

  @Get()
  find(
    @Query('q') q: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!this.limiter.tryHit(clientIp(req) ?? 'unknown')) {
      throw new HttpException('Слишком много запросов. Попробуйте позже.', HttpStatus.TOO_MANY_REQUESTS);
    }
    // Заголовок ставим только на успешный ответ: закэшировать 429 на 30 с
    // значило бы держать зрителя в отказе дольше самого лимита.
    res.set('Cache-Control', 'public, max-age=30');
    return this.search.search(q ?? '');
  }
}
