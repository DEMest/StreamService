import { INestApplication, Logger } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ApiErrorDto } from './api-error';

/**
 * Контракт API в OpenAPI 3 — генерируется из кода (декораторы `@nestjs/swagger`
 * на контроллерах и классах запросов/ответов). Из него собираются типы сайта
 * (`apps/web/src/lib/api-schema.ts`) и клиенты приложений.
 *
 * Правила — в docs/api-contract.md. Здесь только механика.
 */

/** Адрес документа в рантайме. Через прокси сайта — `/api/v1/openapi.json`. */
export const OPENAPI_PATH = '/v1/openapi.json';

/**
 * Заголовок, в котором приложение называет себя: `ios/1.4.0`, `android/1.4.0`.
 * Сайт его не шлёт. Выпущенное приложение обновить принудительно нельзя, и
 * этот заголовок — способ узнать, какие версии из сторов ещё ходят в API.
 * Сейчас сервер его не читает и не пишет в лог: правило заложено в контракт
 * до первой сборки, а учёт версий появится отдельной задачей.
 */
export const CLIENT_VERSION_HEADER = 'X-Client-Version';

export const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;

/**
 * Маршруты, которые не входят в публичный контракт, даже если описаны по
 * правилам. Документ открыт без авторизации, а это API админки (на основном
 * домене nginx отдаёт на него 404) и служебные адреса MediaMTX — приложениям
 * они не нужны. Тот же список освобождает их контроллеры от `@ApiTags` в
 * `openapi.spec.ts`.
 */
export const NON_CONTRACT_PREFIXES = ['/v1/admin', '/v1/internal'] as const;

export function isNonContractPath(path: string): boolean {
  const normalized = '/' + path.replace(/^\/+/, '');
  return NON_CONTRACT_PREFIXES.some((p) => normalized === p || normalized.startsWith(p + '/'));
}

/**
 * В контракт попадают только эндпоинты контроллеров с `@ApiTags` и вне
 * `NON_CONTRACT_PREFIXES`.
 *
 * Старые контроллеры описаны интерфейсами, которых в рантайме нет: в документе
 * они выглядели бы эндпоинтами без тела и без ответа, и сгенерированные по ним
 * типы были бы ложью. Тег же нужен всё равно — генераторы клиентов собирают по
 * нему классы API. Что каждый новый контроллер с тегом, проверяет
 * `openapi.spec.ts`.
 */
export function onlyContractOperations(doc: OpenAPIObject): OpenAPIObject {
  const paths: OpenAPIObject['paths'] = {};
  for (const [path, item] of Object.entries(doc.paths)) {
    if (isNonContractPath(path)) continue;
    const kept = { ...item };
    let hasOperations = false;
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (!op) continue;
      if (op.tags?.length) hasOperations = true;
      else delete kept[method];
    }
    if (hasOperations) paths[path] = kept;
  }
  return withReachableSchemas({ ...doc, paths }, ALWAYS_PUBLISHED_SCHEMAS);
}

/** Схемы, которые нужны клиентам, даже если на них пока не ссылается ни один путь. */
const ALWAYS_PUBLISHED_SCHEMAS = [ApiErrorDto.name];

const SCHEMA_REF_PREFIX = '#/components/schemas/';

/**
 * Оставляет в `components.schemas` только схемы, достижимые по `$ref` из
 * оставшихся путей (и `keep`). Swagger кладёт туда схемы всех описанных
 * классов, в том числе DTO отброшенных маршрутов: без этой чистки класс-ответ
 * админки утёк бы в открытый документ и в типы сайта, хотя самого пути там нет.
 * Порядок схем сохраняется — от него зависит побайтное сравнение файла.
 */
export function withReachableSchemas(doc: OpenAPIObject, keep: string[] = []): OpenAPIObject {
  const schemas = doc.components?.schemas ?? {};
  const reachable = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string' && value.startsWith(SCHEMA_REF_PREFIX)) {
        mark(value.slice(SCHEMA_REF_PREFIX.length));
      } else {
        visit(value);
      }
    }
  };
  const mark = (name: string): void => {
    if (reachable.has(name)) return;
    reachable.add(name);
    visit(schemas[name]);
  };

  visit(doc.paths);
  keep.forEach(mark);
  const kept = Object.fromEntries(Object.entries(schemas).filter(([name]) => reachable.has(name)));
  return { ...doc, components: { ...doc.components, schemas: kept } };
}

/** `SearchController.find` → `searchFind`: читаемые имена методов в клиентах. */
export function operationId(controllerKey: string, methodKey: string): string {
  const controller = controllerKey.replace(/Controller$/, '');
  return controller.charAt(0).toLowerCase() + controller.slice(1) + methodKey.charAt(0).toUpperCase() + methodKey.slice(1);
}

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Лига Лайв API')
    .setVersion('1')
    .addServer('/api', 'Публичный API через сайт')
    .setDescription(
      'Контракт API для сайта и приложений. В `/v1` поля только добавляются; клиент пропускает ' +
        'незнакомые поля и значения перечислений. Ошибки — `ApiErrorDto`, ветвиться по `code`. ' +
        'Списки — порциями с курсором. Время — UTC в ISO 8601, календарные дни — строки `YYYY-MM-DD`. ' +
        'Правила: docs/api-contract.md в репозитории.',
    )
    .addGlobalParameters({
      in: 'header',
      name: CLIENT_VERSION_HEADER,
      required: false,
      description: 'Платформа и версия приложения: `ios/1.4.0`, `android/1.4.0`. Сайт не передаёт.',
      schema: { type: 'string' },
    })
    .build();

  const doc = SwaggerModule.createDocument(app, config, {
    extraModels: [ApiErrorDto],
    operationIdFactory: operationId,
    // Иначе swagger сам вешает тег по имени контроллера на всё подряд, и
    // признак «описан явно» (см. onlyContractOperations) теряется.
    autoTagControllers: false,
  });
  return onlyContractOperations(doc);
}

/** Документ ровно в том виде, в каком он лежит в `apps/api/openapi.json`. */
export function serializeOpenApiDocument(doc: OpenAPIObject): string {
  return JSON.stringify(doc, null, 2) + '\n';
}

/**
 * Отдаёт контракт по `GET /v1/openapi.json`. Собирается один раз на старте.
 *
 * Сломанный документ не должен ронять API: тот же процесс отдаёт live HLS.
 * Такая ошибка видна в тестах раньше выкатки, а в рантайме — 503 и лог.
 */
export function serveOpenApi(app: INestApplication): void {
  const logger = new Logger('OpenApi');
  let body: string | null = null;
  try {
    body = serializeOpenApiDocument(buildOpenApiDocument(app));
  } catch (e) {
    logger.error(`Не удалось собрать OpenAPI: ${(e as Error).message}`, (e as Error).stack);
  }

  app.getHttpAdapter().get(OPENAPI_PATH, (_req: Request, res: Response) => {
    if (body === null) {
      res.status(503).json({
        statusCode: 503,
        code: 'SERVICE_UNAVAILABLE',
        message: 'OpenAPI document is not available',
      });
      return;
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(body);
  });
}
