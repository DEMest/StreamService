import { ArgumentMetadata, HttpStatus, ValidationError, ValidationPipe } from '@nestjs/common';
import { API_ERROR_CODES, ApiException, ApiFieldErrorDto } from './api-error';

/** Плоский список ошибок: вложенные поля получают путь `venues.0.quad`. */
export function flattenValidationErrors(errors: ValidationError[], prefix = ''): ApiFieldErrorDto[] {
  const out: ApiFieldErrorDto[] = [];
  for (const e of errors) {
    const field = prefix ? `${prefix}.${e.property}` : e.property;
    const messages = Object.values(e.constraints ?? {});
    if (messages.length) out.push({ field, messages });
    if (e.children?.length) out.push(...flattenValidationErrors(e.children, field));
  }
  return out;
}

class DtoValidationPipe extends ValidationPipe {
  override async transform(value: unknown, metadata: ArgumentMetadata) {
    if (metadata.type === 'body' && !metadata.data && this.toValidate(metadata) &&
        (value === null || typeof value !== 'object' || Array.isArray(value))) {
      const message = 'Тело запроса должно быть объектом';
      throw new ApiException(HttpStatus.BAD_REQUEST, API_ERROR_CODES.VALIDATION_FAILED, message, [
        { field: 'body', messages: [message] },
      ]);
    }
    return super.transform(value, metadata);
  }

  protected override transformPrimitive(value: unknown): unknown {
    // Именованные query/param сохраняют значения, полученные от Express.
    return value;
  }
}

/**
 * Глобальная валидация запросов.
 *
 * Работает только на параметрах, чей тип — класс с декораторами
 * class-validator (`@Body() body: CreateEventDto`, `@Query() q: CursorQueryDto`).
 * Старые эндпоинты описывают тело интерфейсом или литералом типа, в рантайме
 * это `Object`, и пайп их пропускает: их поведение не меняется.
 *
 * - `whitelist` — незнакомые поля молча отбрасываются, а не ломают запрос:
 *   приложение из стора может прислать поле, которого сервер ещё или уже не
 *   знает (docs/api-contract.md, правило совместимости). До сервиса доходят
 *   только описанные поля.
 * - `transform` — сервис получает экземпляр класса с приведёнными типами
 *   (`?limit=20` приходит числом через `@Type(() => Number)`).
 */
export function createValidationPipe(): ValidationPipe {
  return new DtoValidationPipe({
    whitelist: true,
    transform: true,
    exceptionFactory: (errors) => {
      const fields = flattenValidationErrors(errors);
      const summary = fields.map((f) => f.messages.join(', ')).join('; ');
      return new ApiException(
        HttpStatus.BAD_REQUEST,
        API_ERROR_CODES.VALIDATION_FAILED,
        summary || 'Некорректный запрос',
        fields,
      );
    },
  });
}
