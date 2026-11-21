import { INestApplication } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { ApiExceptionFilter } from './api-exception.filter';
import { createValidationPipe } from './validation';

/**
 * Общие правила HTTP-слоя: валидация запросов и единый формат ошибок.
 * Одна функция и для `main.ts`, и для тестов — иначе тест проверял бы не то
 * приложение, что работает в проде.
 */
export function configureApi(app: INestApplication): void {
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new ApiExceptionFilter(app.get(HttpAdapterHost).httpAdapter));
}
