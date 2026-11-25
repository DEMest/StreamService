import { ApiExtraModels, ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { RecordingSummaryDto } from '../recording/recording-summary';

/**
 * Контракт `GET /v1/public/search` (docs/api-contract.md). Эти же классы —
 * тип результата `SearchService.search`: описание ответа и то, что сервис
 * возвращает на самом деле, не могут разойтись без ошибки компиляции.
 */

/** Короче двух символов запрос не имеет смысла: выдаст пол-базы. */
export const MIN_SEARCH_QUERY_LENGTH = 2;
/** Защита от запроса-простыни, который превратится в тяжёлый LIKE. */
export const MAX_SEARCH_QUERY_LENGTH = 100;

export class SearchQueryDto {
  @ApiPropertyOptional({
    description:
      `Строка поиска. Короче ${MIN_SEARCH_QUERY_LENGTH} символов — пустой результат; ` +
      `длиннее ${MAX_SEARCH_QUERY_LENGTH} — обрезается.`,
  })
  @IsOptional()
  @IsString()
  q?: string;
}

export class SearchOrgHitDto {
  @ApiProperty()
  orgSlug: string;

  @ApiProperty()
  orgName: string;

  @ApiProperty({ description: 'Есть картинка организации.' })
  hasImage: boolean;

  @ApiProperty({ type: 'integer', description: 'Сколько публичных стримов организации сейчас в эфире.' })
  liveCount: number;
}

export class SearchStreamHitDto {
  @ApiProperty()
  orgSlug: string;

  @ApiProperty()
  orgName: string;

  @ApiProperty()
  streamSlug: string;

  @ApiProperty({ description: 'Название стрима; у безымянного — название организации.' })
  streamName: string;

  @ApiProperty()
  isLive: boolean;
}

@ApiExtraModels(RecordingSummaryDto)
export class SearchBroadcastHitDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ type: String, format: 'date-time' })
  startedAt: Date;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  endedAt: Date | null;

  @ApiProperty({ description: 'Есть стоп-кадр записи.' })
  hasPreview: boolean;

  // В OpenAPI 3.0 nullable рядом с allOf не разрешает null для схемы по ссылке.
  @ApiProperty({
    type: Object,
    oneOf: [
      { $ref: getSchemaPath(RecordingSummaryDto) },
      { type: 'object', nullable: true, enum: [null] },
    ],
  })
  recording: RecordingSummaryDto | null;

  @ApiProperty()
  orgSlug: string;

  @ApiProperty()
  orgName: string;

  @ApiProperty()
  streamSlug: string;

  @ApiProperty({ description: 'Название стрима; у безымянного — название организации.' })
  streamName: string;
}

export class SearchResultsDto {
  @ApiProperty({ description: 'Запрос после обрезки пробелов и длины — то, что искали на самом деле.' })
  query: string;

  @ApiProperty({ type: [SearchOrgHitDto] })
  organizations: SearchOrgHitDto[];

  @ApiProperty({ type: [SearchStreamHitDto] })
  streams: SearchStreamHitDto[];

  @ApiProperty({ type: [SearchBroadcastHitDto] })
  broadcasts: SearchBroadcastHitDto[];
}
