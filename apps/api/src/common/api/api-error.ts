import { HttpException, HttpStatus } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { STATUS_CODES } from 'http';

/**
 * Единый формат ошибки API. Его получает любой клиент на любой ответ 4xx/5xx:
 * сайт, приложения, внешние программы.
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
 * Общий код по статусу: 404 → `NOT_FOUND`, 500 → `INTERNAL_SERVER_ERROR`.
 * Берётся из стандартных названий статусов Node, поэтому одинаков для любого
 * статуса, а не только для тех, что кто-то не забыл вписать в таблицу.
 */
export function errorCodeForStatus(status: number): string {
  const name = STATUS_CODES[status];
  if (!name) return `HTTP_${status}`;
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
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
