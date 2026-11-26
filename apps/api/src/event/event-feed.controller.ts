import { Controller, Get, Header, Param, Query, StreamableFile } from '@nestjs/common';
import {
  ApiBadRequestResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags,
} from '@nestjs/swagger';
import { ApiErrorDto } from '../common/api/api-error';
import {
  BoutFeedPageDto, BoutFeedQueryDto, EventAthleteParamsDto, EventDetailDto, EventFeedPageDto,
  EventFeedQueryDto, EventParamsDto, EventVenueParamsDto,
} from './event-feed.dto';
import { EventFeedService } from './event-feed.service';

const jpeg = { 'image/jpeg': { schema: { type: 'string', format: 'binary' } } };

@ApiTags('event-feed')
@ApiBadRequestResponse({ type: ApiErrorDto })
@Controller('v1/public/events')
export class EventFeedController {
  constructor(private feed: EventFeedService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Лента опубликованных турниров', description: 'Сначала турниры с более поздней датой афиши.' })
  @ApiOkResponse({ type: EventFeedPageDto })
  listEvents(@Query() query: EventFeedQueryDto): Promise<EventFeedPageDto> {
    return this.feed.listEvents(query);
  }

  @Get(':eventId')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Шапка турнира и ковры' })
  @ApiOkResponse({ type: EventDetailDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  getEvent(@Param() params: EventParamsDto): Promise<EventDetailDto> {
    return this.feed.getEvent(params.eventId);
  }

  @Get(':eventId/bouts')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Лента схваток турнира',
    description: 'Идущие, затем завершившиеся за последние 15 минут от новых к старым, затем остальные по расписанию.',
  })
  @ApiOkResponse({ type: BoutFeedPageDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  listBouts(@Param() params: EventParamsDto, @Query() query: BoutFeedQueryDto): Promise<BoutFeedPageDto> {
    return this.feed.listBouts(params.eventId, query);
  }

  @Get(':eventId/poster')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Афиша турнира' })
  @ApiOkResponse({ content: jpeg })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  async getPoster(@Param() params: EventParamsDto): Promise<StreamableFile> {
    return new StreamableFile(await this.feed.getPoster(params.eventId), { type: 'image/jpeg' });
  }

  @Get(':eventId/athletes/:athleteId/photo')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Фотография участника турнира' })
  @ApiOkResponse({ content: jpeg })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  async getAthletePhoto(@Param() params: EventAthleteParamsDto): Promise<StreamableFile> {
    return new StreamableFile(await this.feed.getAthletePhoto(params.eventId, params.athleteId), { type: 'image/jpeg' });
  }

  @Get(':eventId/venues/:venueId/thumbnail')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Полный стоп-кадр открытого эфира ковра или его превью' })
  @ApiOkResponse({ content: jpeg })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  async getVenueThumbnail(@Param() params: EventVenueParamsDto): Promise<StreamableFile> {
    return new StreamableFile(await this.feed.getVenueThumbnail(params.eventId, params.venueId), { type: 'image/jpeg' });
  }
}
