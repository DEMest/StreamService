import { ApiExtraModels, ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { CursorPage, CursorQueryDto } from '../common/api/cursor';
import { BoutStatus } from './bout-status';

export const EVENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export class EventParamsDto {
  @ApiProperty({ pattern: EVENT_ID_PATTERN.source })
  @Matches(EVENT_ID_PATTERN)
  eventId: string;
}

export class EventAthleteParamsDto extends EventParamsDto {
  @ApiProperty({ pattern: EVENT_ID_PATTERN.source })
  @Matches(EVENT_ID_PATTERN)
  athleteId: string;
}

export class EventVenueParamsDto extends EventParamsDto {
  @ApiProperty({ pattern: EVENT_ID_PATTERN.source })
  @Matches(EVENT_ID_PATTERN)
  venueId: string;
}

export class BoutFeedQueryDto extends CursorQueryDto {
  @ApiPropertyOptional({ maxLength: 100, description: 'Фамилия спортсмена. Фильтрация появится в #143.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: 2147483647, description: 'Номер ковра. Фильтрация появится в #143.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  venueNumber?: number;

  @ApiPropertyOptional({ maxLength: 100, description: 'Весовая категория. Фильтрация появится в #143.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  weightClass?: string;

  @ApiPropertyOptional({ maxLength: 100, description: 'Школа. Фильтрация появится в #143.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  school?: string;

  @ApiPropertyOptional({ type: 'integer', minimum: 1900, maximum: 2100, description: 'Год рождения. Фильтрация появится в #143.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @Max(2100)
  birthYear?: number;
}

const EVENT_MODES = ['live', 'archive'] as const;

export class EventFeedQueryDto extends CursorQueryDto {
  @ApiPropertyOptional({ enum: EVENT_MODES, description: 'Режим ленты. Фильтрация появится в #142.' })
  @IsOptional()
  @IsIn(EVENT_MODES)
  mode?: (typeof EVENT_MODES)[number];

  @ApiPropertyOptional({ maxLength: 100, description: 'Поиск по названию и городу. Фильтрация появится в #142.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ maxLength: 100, description: 'Вид спорта. Фильтрация появится в #142.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sport?: string;

  @ApiPropertyOptional({ maxLength: 32, description: 'Код региона. Фильтрация появится в #142.' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  regionCode?: string;

  @ApiPropertyOptional({ maxLength: 100, description: 'Фамилия спортсмена. Фильтрация появится в #142.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @ApiPropertyOptional({ maxLength: 100, description: 'Весовая категория. Фильтрация появится в #142.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  weightClass?: string;

  @ApiPropertyOptional({ type: 'integer', minimum: 1900, maximum: 2100, description: 'Год рождения. Фильтрация появится в #142.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @Max(2100)
  birthYear?: number;
}

export class EventAthleteDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  firstName: string;

  @ApiProperty()
  lastName: string;

  @ApiProperty({ type: String, nullable: true })
  school: string | null;

  @ApiProperty({ type: 'integer', nullable: true })
  birthYear: number | null;

  @ApiProperty({ type: String, nullable: true })
  photoUrl: string | null;
}

const nullableObject = (model: typeof EventAthleteDto | typeof BoutScoreDto) => ({
  type: Object,
  oneOf: [{ $ref: getSchemaPath(model) }, { type: 'object' as const, nullable: true, enum: [null] }],
});

@ApiExtraModels(EventAthleteDto)
export class BoutScoreDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: ['waiting', 'live', 'finished'], description: 'Неизвестное значение показывается как waiting.' })
  status: BoutStatus;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  startedAt: Date | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  endedAt: Date | null;

  @ApiProperty(nullableObject(EventAthleteDto))
  redAthlete: EventAthleteDto | null;

  @ApiProperty(nullableObject(EventAthleteDto))
  blueAthlete: EventAthleteDto | null;

  @ApiProperty({ type: 'integer' })
  redScore: number;

  @ApiProperty({ type: 'integer' })
  blueScore: number;
}

@ApiExtraModels(BoutScoreDto)
export class EventVenueSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ type: 'integer' })
  number: number;

  @ApiProperty({ type: String, nullable: true })
  name: string | null;

  @ApiProperty(nullableObject(BoutScoreDto))
  liveBout: BoutScoreDto | null;
}

export class EventVenueDto extends EventVenueSummaryDto {
  @ApiProperty({ type: String, nullable: true, description: 'HLS только для открытого эфира ковра.' })
  hlsUrl: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Стоп-кадр эфира или загруженное превью потока, если доступно.' })
  thumbnailUrl: string | null;

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 4, nullable: true, description: 'Четверть кадра. Без кадрирования — null.' })
  quad: number | null;
}

export class EventCardDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  sport: string;

  @ApiProperty({ type: 'integer', nullable: true })
  birthYearFrom: number | null;

  @ApiProperty({ type: 'integer', nullable: true })
  birthYearTo: number | null;

  @ApiProperty({ description: 'Уровень турнира: international, regional или local. Для неизвестного значения используется оформление local.' })
  level: string;

  @ApiProperty({ format: 'date' })
  startsOn: string;

  @ApiProperty({ format: 'date' })
  endsOn: string;

  @ApiProperty({ type: String, nullable: true })
  timeZone: string | null;

  @ApiProperty({ type: String, nullable: true })
  city: string | null;

  @ApiProperty({ type: String, nullable: true })
  address: string | null;

  @ApiProperty({ type: String, nullable: true })
  regionCode: string | null;

  @ApiProperty({ type: String, nullable: true })
  posterUrl: string | null;

  @ApiProperty()
  isLive: boolean;
}

export class EventFeedCardDto extends EventCardDto {
  @ApiProperty({ type: [EventVenueSummaryDto], description: 'Ковры и текущие схватки идущего турнира.' })
  venues: EventVenueSummaryDto[];
}

export class EventDetailDto extends EventCardDto {
  @ApiProperty({ type: [EventVenueDto] })
  venues: EventVenueDto[];
}

export class BoutCardDto extends BoutScoreDto {
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  scheduledAt: Date | null;

  @ApiProperty({ type: 'integer', nullable: true })
  sequence: number | null;

  @ApiProperty({ type: String, nullable: true })
  weightClass: string | null;

  @ApiProperty()
  venueId: string;

  @ApiProperty({ type: 'integer' })
  venueNumber: number;

  @ApiProperty({ type: String, nullable: true, description: 'HLS открытого эфира ковра, если он идёт.' })
  hlsUrl: string | null;

  @ApiProperty({ type: String, nullable: true })
  thumbnailUrl: string | null;

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 4, nullable: true })
  quad: number | null;
}

export class EventFeedPageDto extends CursorPage(EventFeedCardDto) {}

export class BoutFeedPageDto extends CursorPage(BoutCardDto) {}
