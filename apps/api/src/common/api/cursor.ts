import { HttpStatus, Type as ClassType } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { API_ERROR_CODES, ApiException } from './api-error';

/**
 * Списки в API отдаются порциями с курсором, а не страницами по номеру:
 * лента меняется, пока её листают (схватка началась, турнир вышел в эфир), и
 * `?page=2` показал бы карточку дважды или потерял бы её.
 *
 * Курсор для клиента непрозрачен: это base64url от позиции последней отданной
 * строки. Клиент только передаёт обратно `nextCursor` из прошлой порции;
 * `nextCursor: null` — дальше ничего нет.
 */

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

/** Параметры порции. Запрос списка наследует их: `class EventsQueryDto extends CursorQueryDto`. */
export class CursorQueryDto {
  @ApiPropertyOptional({ description: '`nextCursor` из предыдущей порции. Не передан — первая порция.' })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  cursor?: string;

  @ApiPropertyOptional({
    type: 'integer',
    description: 'Сколько элементов в порции.',
    minimum: 1,
    maximum: MAX_PAGE_LIMIT,
    default: DEFAULT_PAGE_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  // Умолчание — здесь, а не `q.limit ?? 20` в каждом эндпоинте: забытое `??`
  // дало бы `take: NaN` и 500. ValidationPipe (transform) создаёт экземпляр
  // класса, поэтому инициализатор срабатывает и для запроса без `limit`.
  limit: number = DEFAULT_PAGE_LIMIT;
}

/**
 * Класс ответа-порции для OpenAPI. У каждой порции своё имя схемы — так в
 * клиентах Swift и Kotlin получается тип `EventPage`, а не безымянный generic:
 *
 *   export class EventPageDto extends CursorPage(EventCardDto) {}
 */
export function CursorPage<T>(item: ClassType<T>) {
  abstract class CursorPageBase {
    @ApiProperty({ type: () => [item] })
    items: T[];

    @ApiProperty({
      type: String,
      nullable: true,
      description: 'Курсор следующей порции; `null` — это последняя порция.',
    })
    nextCursor: string | null;
  }
  return CursorPageBase;
}

export function encodeCursor(position: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(position), 'utf8').toString('base64url');
}

/**
 * Позиция из курсора. Форму проверяет эндпоинт (`isPosition`): курсор пришёл
 * от клиента, и испорченный или чужой курсор — это 400 `INVALID_CURSOR`, а не
 * 500 из глубины запроса к базе.
 */
export function decodeCursor<T>(raw: string, isPosition: (value: unknown) => value is T): T {
  let value: unknown;
  try {
    const bytes = Buffer.from(raw, 'base64url');
    // Декодер Node пропускает посторонние символы и принимает лишний padding.
    if (bytes.toString('base64url') === raw) value = JSON.parse(bytes.toString('utf8'));
  } catch {
    value = undefined;
  }
  if (!isPosition(value)) {
    throw new ApiException(HttpStatus.BAD_REQUEST, API_ERROR_CODES.INVALID_CURSOR, 'Некорректный курсор');
  }
  return value;
}

/**
 * Порция из строк, выбранных с `take: limit + 1`: лишняя строка говорит, что
 * дальше что-то есть, и в ответ не попадает.
 */
export function toCursorPage<T>(
  rows: T[],
  limit: number,
  positionOf: (last: T) => Record<string, unknown>,
): { items: T[]; nextCursor: string | null } {
  if (rows.length <= limit) return { items: rows, nextCursor: null };
  const items = rows.slice(0, limit);
  return { items, nextCursor: encodeCursor(positionOf(items[items.length - 1])) };
}
