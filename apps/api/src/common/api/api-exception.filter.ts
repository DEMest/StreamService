import { ArgumentsHost, Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { API_ERROR_CODES, errorCodeForStatus, toApiErrorBody } from './api-error';

/** Ошибки библиотеки http-errors (их же так узнаёт BaseExceptionFilter). */
function isHttpErrorLike(e: unknown): e is { statusCode: number; message: string } {
  const err = e as { statusCode?: unknown; message?: unknown } | null;
  return typeof err?.statusCode === 'number' && typeof err?.message === 'string' && !!err.message;
}

/**
 * Приводит любое исключение HTTP-обработчика к единому формату (`ApiErrorDto`).
 * Ответ, который обработчик пишет сам через `@Res()` (раздача HLS), сюда не
 * попадает.
 *
 * Всё остальное — запись ответа, «заголовки уже ушли» посреди отдачи файла,
 * лог необработанной ошибки — делает штатный BaseExceptionFilter: фильтр
 * только подменяет тело. Live HLS отдаётся этим же API, поэтому поведение на
 * обрыве потока обязано остаться ровно прежним.
 *
 * WebSocket и прочие контексты не трогаем: у чата свой протокол событий.
 */
@Catch()
export class ApiExceptionFilter extends BaseExceptionFilter {
  private static readonly unknownErrorLogger = new Logger('ExceptionsHandler');

  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() !== 'http') return super.catch(exception, host);

    if (exception instanceof HttpException) {
      return super.catch(new HttpException(toApiErrorBody(exception), exception.getStatus()), host);
    }

    const status = isHttpErrorLike(exception) ? exception.statusCode : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = isHttpErrorLike(exception)
      ? { statusCode: status, code: errorCodeForStatus(status), message: exception.message }
      : {
          statusCode: status,
          code: API_ERROR_CODES.INTERNAL_SERVER_ERROR,
          message: 'Internal server error',
        };
    super.catch(new HttpException(body, status), host);

    // Тот же лог, что пишет BaseExceptionFilter для необработанной ошибки:
    // подменив исключение на HttpException, мы забрали его у базового класса.
    const err = exception as { message?: unknown; stack?: string } | null;
    if (err && typeof err === 'object' && err.message) {
      ApiExceptionFilter.unknownErrorLogger.error(err.message, err.stack);
    } else {
      ApiExceptionFilter.unknownErrorLogger.error(exception);
    }
  }
}
