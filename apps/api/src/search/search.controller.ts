import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrorDto } from '../common/api/api-error';
import { SearchQueryDto, SearchResultsDto } from './search.dto';
import { SearchService } from './search.service';

/**
 * Публичный поиск по сайту. Без авторизации: отдаёт только то, что и так
 * открыто анониму.
 *
 * Кэш короткий: список эфиров меняется в момент выхода в эфир, а поиск —
 * первое, куда пойдёт зритель, не нашедший трансляцию.
 *
 * Первый эндпоинт, описанный по правилам контракта (docs/api-contract.md):
 * классы запроса и ответа, валидация, место в OpenAPI.
 */
@ApiTags('search')
@Controller('v1/public/search')
export class SearchController {
  constructor(private search: SearchService) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=30')
  @ApiOperation({ summary: 'Поиск по организациям, стримам и записям эфиров' })
  @ApiOkResponse({ type: SearchResultsDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: '`VALIDATION_FAILED` — `q` передан не строкой.' })
  find(@Query() query: SearchQueryDto): Promise<SearchResultsDto> {
    return this.search.search(query.q ?? '');
  }
}
