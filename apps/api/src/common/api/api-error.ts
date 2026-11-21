import { HttpException, HttpStatus } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { STATUS_CODES } from 'http';

/**
 * Единый формат ошибки API. Его получает любой клиент на любую ошибку,
 * брошенную исключением: сайт, приложения, внешние программы. Ответ, который
 * обработчик пишет сам через `@Res()` (раздача HLS), фильтр не видит.
 *
 * Клиент ветвится по `code`, а не по `message`: текст пишется для человека,
 * бывает по-русски и меняется без предупреждения, а машинный код — часть
 * контракта и в `/v1` не переименовывается.
 *
 * Тело старых эндпоинтов могло нести и другие поля (`error` от Nest и т.п.) —
 * они остаются, фильтр только добавляет недостающее. По правилу совместимости
 * клиент незнакомые поля пропускает (docs/api-contract.md).
 */
export class ApiFieldErrorDto {
  @ApiProperty({ description: 'Путь к полю запроса: `limit`, `venues.0.quad`', example: 'limit' })
  field: string;

  @ApiProperty({ type: [String], example: ['limit must not be greater than 100'] })
  messages: string[];
}

export class ApiErrorDto {
  @ApiProperty({ type: 'integer', example: 404 })
  statusCode: number;

  @ApiProperty({
    description:
      'Машинный код ошибки, SCREAMING_SNAKE_CASE. Конкретный (`EVENT_NOT_FOUND`) или общий по статусу (`NOT_FOUND`). ' +
      'Незнакомый код клиент обрабатывает по `statusCode`.',
    example: 'NOT_FOUND',
  })
  code: string;

  @ApiProperty({ description: 'Текст для человека. Не для разбора кодом.', example: 'Турнир не найден' })
  message: string;

  @ApiPropertyOptional({
    type: [ApiFieldErrorDto],
    description: 'Ошибки по полям — только у `VALIDATION_FAILED`.',
  })
  fields?: ApiFieldErrorDto[];
}

/** Тело ошибки, как оно уходит в ответ. */
export type ApiErrorBody = ApiErrorDto & Record<string, unknown>;

/** Коды, которые ставит сам слой API, а не отдельные эндпоинты. */
export const API_ERROR_CODES = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  INVALID_CURSOR: 'INVALID_CURSOR',
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
} as const;

/**
 * Ошибка с машинным кодом — так её бросают новые эндпоинты:
 *
 *   throw new ApiException(HttpStatus.NOT_FOUND, 'EVENT_NOT_FOUND', 'Турнир не найден');
 *
 * Обычные `NotFoundException('…')` тоже работают: код тогда берётся общий по
 * статусу (`NOT_FOUND`). Конкретный код нужен, когда клиент должен отличить
 * одну причину от другой при одном и том же статусе.
 */
export class ApiException extends HttpException {
  constructor(status: HttpStatus, code: string, message: string, fields?: ApiFieldErrorDto[]) {
    super({ statusCode: status, code, message, ...(fields ? { fields } : {}) }, status);
  }
}

/**
 * Общие коды по статусу — явной таблицей, а не из фраз `http.STATUS_CODES`.
 * Фразы Node меняет вслед за RFC (413 уже «Content Too Large», 422 —
 * «Unprocessable Content»), а код в `/v1` переименовывать нельзя.
 * Здесь все статусы, которые бросают встроенные исключения Nest и сам API.
 */
const CODE_BY_STATUS: Readonly<Record<number, string>> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  406: 'NOT_ACCEPTABLE',
  408: 'REQUEST_TIMEOUT',
  409: 'CONFLICT',
  410: 'GONE',
  412: 'PRECONDITION_FAILED',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  416: 'RANGE_NOT_SATISFIABLE',
  421: 'MISDIRECTED_REQUEST',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'TOO_MANY_REQUESTS',
  500: 'INTERNAL_SERVER_ERROR',
  501: 'NOT_IMPLEMENTED',
  502: 'BAD_GATEWAY',
  503: 'SERVICE_UNAVAILABLE',
  504: 'GATEWAY_TIMEOUT',
  505: 'HTTP_VERSION_NOT_SUPPORTED',
};

/** Общий код по статусу: 404 → `NOT_FOUND`; статуса нет в таблице — `HTTP_<n>`. */
export function errorCodeForStatus(status: number): string {
  return CODE_BY_STATUS[status] ?? `HTTP_${status}`;
}

function normalizeMessage(raw: unknown, status: number): string {
  if (typeof raw === 'string' && raw) return raw;
  if (Array.isArray(raw) && raw.length) return raw.map(String).join('; ');
  return STATUS_CODES[status] ?? 'Error';
}

/**
 * Тело ответа для HttpException в едином формате. Поля, которые положил в
 * исключение сам эндпоинт, сохраняются — добавляются только `statusCode`,
 * `code` и строковый `message`.
 */
export function toApiErrorBody(exception: HttpException): ApiErrorBody {
  const status = exception.getStatus();
  const res = exception.getResponse();
  const base: Record<string, unknown> =
    typeof res === 'object' && res !== null ? { ...(res as Record<string, unknown>) } : { message: res };
  const code = typeof base.code === 'string' && base.code ? base.code : errorCodeForStatus(status);
  return {
    ...base,
    statusCode: status,
    code,
    message: normalizeMessage(base.message, status),
  };
}
