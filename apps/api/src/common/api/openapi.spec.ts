import { Body, INestApplication, Type } from '@nestjs/common';
import { PARAMTYPES_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { MetadataScanner, ModulesContainer } from '@nestjs/core';
import { getSchemaPath, OpenAPIObject } from '@nestjs/swagger';
import { DECORATORS } from '@nestjs/swagger/dist/constants';
import { readFileSync } from 'fs';
import { createPreviewApp, OPENAPI_FILE } from './generate-openapi';
import { buildOpenApiDocument, HTTP_METHODS, isNonContractPath, operationId, serializeOpenApiDocument } from './openapi';

/**
 * Контроллеры, написанные до правил контракта (docs/api-contract.md): тела и
 * ответы у них — интерфейсы, в OpenAPI их нет. Список только сокращается:
 * контроллер, описанный по правилам, получает `@ApiTags` и уходит отсюда.
 * Новый контроллер сюда не добавляется — он сразу пишется по правилам.
 *
 * Контроллеры под `/v1/admin` и `/v1/internal` здесь не нужны: эти маршруты
 * вне публичного контракта по префиксу (`NON_CONTRACT_PREFIXES`).
 */
const LEGACY_CONTROLLERS = new Set([
  'AuthController',
  'OrgController',
  'PublicAdsController',
  'PublicController',
  'QoeController',
  'RecordingController',
  'SeoController',
  'StreamController',
]);

/** Вне контракта навсегда, хотя и не под служебным префиксом. */
const NOT_FOR_CLIENTS = new Set([
  // Проба живости для docker и deploy.sh, вне /v1.
  'HealthController',
]);

const hasApiTags = (controller: Type) => (Reflect.getMetadata(DECORATORS.API_TAGS, controller) ?? []).length > 0;

/** Под служебным префиксом: `@Controller('v1/admin/ads')`. */
function underNonContractPrefix(controller: Type): boolean {
  const raw: string | string[] | undefined = Reflect.getMetadata(PATH_METADATA, controller);
  const paths = Array.isArray(raw) ? raw : [raw ?? '/'];
  return paths.every((p) => isNonContractPath(p));
}

/** Эндпоинты контракта, у которых ответ или тело — не схема, а пустое место. */
function undescribedOperations(doc: OpenAPIObject, controllers: Type[]): string[] {
  const bodyTypes = new Map<string, Type>();
  const scanner = new MetadataScanner();
  for (const controller of controllers) {
    for (const method of scanner.getAllMethodNames(controller.prototype)) {
      const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, method) ?? {};
      const types = Reflect.getMetadata(PARAMTYPES_METADATA, controller.prototype, method) ?? [];
      for (const [key, arg] of Object.entries<{ index: number }>(args)) {
        if (key.split(':')[0] !== String(RouteParamtypes.BODY)) continue;
        const operation = Reflect.getMetadata(DECORATORS.API_OPERATION, controller.prototype[method]);
        bodyTypes.set(operation?.operationId ?? operationId(controller.name, method), types[arg.index]);
      }
    }
  }
  const out: string[] = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (!op) continue;
      const name = `${method.toUpperCase()} ${path}`;
      const success = Object.entries(op.responses ?? {}).filter(([status]) => /^2\d\d$/.test(status));
      const described = success.length > 0 && success.every(([status, res]) =>
        status === '204' || '$ref' in res || Object.values(res.content ?? {}).some((media) => media.schema),
      );
      if (!described) out.push(`${name}: ответ без схемы (нет @ApiOkResponse({ type }) и т.п.)`);
      const body = op.requestBody as { content?: Record<string, { schema?: { $ref?: string } }> } | undefined;
      const bodySchemas = Object.values(body?.content ?? {}).map((c) => c.schema);
      const dto = bodyTypes.get(op.operationId);
      if (bodyTypes.has(op.operationId) && (!dto || dto === Object || !bodySchemas.length ||
          bodySchemas.some((s) => s?.$ref !== getSchemaPath(dto)))) {
        out.push(`${name}: тело — не класс-DTO`);
      } else if (bodySchemas.some((s) => !s?.$ref)) {
        out.push(`${name}: тело без схемы DTO`);
      }
    }
  }
  return out;
}

describe('контракт OpenAPI', () => {
  let app: INestApplication;
  let controllers: Type[];

  beforeAll(async () => {
    app = await createPreviewApp();
    // Тот же контейнер модулей, по которому строит документ сам swagger.
    controllers = [...app.get(ModulesContainer).values()].flatMap((m) =>
      [...m.controllers.values()].map((w) => w.metatype as Type),
    );
  });

  afterAll(() => app.close());

  it('apps/api/openapi.json совпадает с кодом', () => {
    const actual = serializeOpenApiDocument(buildOpenApiDocument(app));
    const committed = readFileSync(OPENAPI_FILE, 'utf8');
    if (actual !== committed) {
      throw new Error(
        'apps/api/openapi.json отстал от кода. Обновите контракт и типы сайта: `pnpm api:contract`, ' +
          'и закоммитьте оба файла (apps/api/openapi.json, apps/web/src/lib/api-schema.ts).',
      );
    }
  });

  it('каждый новый контроллер входит в контракт (@ApiTags)', () => {
    expect(controllers.length).toBeGreaterThan(LEGACY_CONTROLLERS.size);

    const outside = controllers
      .filter((c) => !hasApiTags(c) && !underNonContractPrefix(c))
      .map((c) => c.name)
      .filter((name) => !LEGACY_CONTROLLERS.has(name) && !NOT_FOR_CLIENTS.has(name));
    // Пусто — значит, всё новое описано. Иначе: повесьте на контроллер
    // @ApiTags и опишите запросы и ответы классами (docs/api-contract.md).
    expect(outside).toEqual([]);
  });

  it('список старых контроллеров честный: только существующие, неописанные и не под служебным префиксом', () => {
    const byName = new Map(controllers.map((c) => [c.name, c]));
    for (const name of [...LEGACY_CONTROLLERS, ...NOT_FOR_CLIENTS]) {
      const controller = byName.get(name);
      expect({ name, exists: !!controller }).toEqual({ name, exists: true });
      // Описанный по правилам контроллер из списка убирается.
      expect({ name, tagged: hasApiTags(controller!) }).toEqual({ name, tagged: false });
      expect({ name, nonContractPrefix: underNonContractPrefix(controller!) }).toEqual({
        name,
        nonContractPrefix: false,
      });
    }
  });

  it('у каждого эндпоинта контракта ответ и тело описаны схемами', () => {
    // Тег без классов дал бы сайту и приложениям пустые типы.
    expect(undescribedOperations(buildOpenApiDocument(app), controllers)).toEqual([]);
  });

  it('замечает @Body с интерфейсом, даже если Swagger пропустил requestBody', () => {
    class ExampleController {
      create(@Body() _body: { title: string }) {}
    }
    const doc: OpenAPIObject = {
      openapi: '3.0.0',
      info: { title: 'test', version: '1' },
      paths: { '/example': { post: { operationId: 'exampleCreate', responses: { '204': { description: '' } } } } },
    };
    expect(undescribedOperations(doc, [ExampleController])).toEqual(['POST /example: тело — не класс-DTO']);
  });

  it('в документе есть пилот — поиск — и нет админки и служебных адресов', () => {
    const doc = buildOpenApiDocument(app);
    expect(doc.servers?.[0].url).toBe('/api');
    expect(doc.paths['/v1/public/search']?.get?.responses?.['200']).toBeDefined();
    expect(doc.components?.schemas).toHaveProperty('SearchResultsDto');
    expect(doc.components?.schemas).toHaveProperty('ApiErrorDto');
    expect(Object.keys(doc.paths).filter(isNonContractPath)).toEqual([]);
  });

  it('поиск описывает запись эфира как объект или null', () => {
    const { schemas } = buildOpenApiDocument(app).components ?? {};
    expect(schemas?.RecordingSummaryDto).toHaveProperty('properties.fileSize.format', 'int64');
    expect(schemas?.SearchBroadcastHitDto).toHaveProperty('properties.recording', {
      oneOf: [
        { $ref: '#/components/schemas/RecordingSummaryDto' },
        { type: 'object', nullable: true, enum: [null] },
      ],
    });
  });
});
