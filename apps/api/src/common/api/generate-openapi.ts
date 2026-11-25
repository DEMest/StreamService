import { NestFactory } from '@nestjs/core';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { AppModule } from '../../app.module';
import { buildOpenApiDocument, serializeOpenApiDocument } from './openapi';

/**
 * Пишет контракт в `apps/api/openapi.json` — файл, из которого собираются
 * типы сайта и клиенты приложений. Запуск: `pnpm --filter api openapi`.
 *
 * Приложение поднимается в режиме preview: граф модулей строится, а
 * провайдеры не создаются — ни базы, ни S3, ни переменных окружения не нужно.
 * Что файл совпадает с кодом, проверяет `openapi.spec.ts`.
 */
export const OPENAPI_FILE = resolve(__dirname, '../../../openapi.json');

export async function createPreviewApp() {
  return NestFactory.create(AppModule, { preview: true, logger: false, abortOnError: false });
}

async function main() {
  const app = await createPreviewApp();
  const doc = buildOpenApiDocument(app);
  writeFileSync(OPENAPI_FILE, serializeOpenApiDocument(doc));
  await app.close();
  console.log(`OpenAPI: ${Object.keys(doc.paths).length} путей → ${OPENAPI_FILE}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
