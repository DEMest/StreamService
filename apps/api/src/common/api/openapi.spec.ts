import { INestApplication } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { DECORATORS } from '@nestjs/swagger/dist/constants';
import { readFileSync } from 'fs';
import { AppModule } from '../../app.module';
import { createPreviewApp, OPENAPI_FILE } from './generate-openapi';
import { buildOpenApiDocument, serializeOpenApiDocument } from './openapi';

/**
 * Контроллеры, написанные до правил контракта (docs/api-contract.md): тела и
 * ответы у них — интерфейсы, в OpenAPI их нет. Список только сокращается:
 * контроллер, описанный по правилам, получает `@ApiTags` и уходит отсюда.
 * Новый контроллер сюда не добавляется — он сразу пишется по правилам.
 */
const LEGACY_CONTROLLERS = new Set([
  'AdminAdsController',
  'AdminController',
  'AuthController',
  'CapacityController',
  'OrgController',
  'PublicAdsController',
  'PublicController',
  'QoeController',
  'RecordingController',
  'SeoController',
  'StreamController',
]);

/** Вне контракта навсегда: не API для клиентов. */
const NOT_FOR_CLIENTS = new Set([
  // Вебхук и авторизация MediaMTX: внутренний адрес под общим секретом.
  'MediamtxWebhookController',
  // Проба живости для docker и deploy.sh, вне /v1.
  'HealthController',
]);

type ModuleRef = Function | { module?: Function; controllers?: Function[]; imports?: unknown[]; forwardRef?: () => unknown };

function collectControllers(ref: unknown, seen = new Set<Function>()): Function[] {
  const r = ref as ModuleRef | undefined;
  if (!r) return [];
  if (typeof r === 'object' && typeof r.forwardRef === 'function') return collectControllers(r.forwardRef(), seen);
  const mod = typeof r === 'function' ? r : r.module;
  if (!mod || seen.has(mod)) return [];
  seen.add(mod);
  const dynamic = typeof r === 'object' ? r : {};
  const controllers: Function[] = [
    ...(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, mod) ?? []),
    ...((dynamic as { controllers?: Function[] }).controllers ?? []),
  ];
  const imports: unknown[] = [
    ...(Reflect.getMetadata(MODULE_METADATA.IMPORTS, mod) ?? []),
    ...((dynamic as { imports?: unknown[] }).imports ?? []),
  ];
  for (const i of imports) controllers.push(...collectControllers(i, seen));
  return controllers;
}

const hasApiTags = (controller: Function) =>
  (Reflect.getMetadata(DECORATORS.API_TAGS, controller) ?? []).length > 0;

describe('контракт OpenAPI', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createPreviewApp();
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
    const controllers = collectControllers(AppModule);
    expect(controllers.length).toBeGreaterThan(LEGACY_CONTROLLERS.size);

    const outside = controllers
      .filter((c) => !hasApiTags(c))
      .map((c) => c.name)
      .filter((name) => !LEGACY_CONTROLLERS.has(name) && !NOT_FOR_CLIENTS.has(name));
    // Пусто — значит, всё новое описано. Иначе: повесьте на контроллер
    // @ApiTags и опишите запросы и ответы классами (docs/api-contract.md).
    expect(outside).toEqual([]);
  });

  it('список старых контроллеров честный: в нём только существующие и неописанные', () => {
    const byName = new Map(collectControllers(AppModule).map((c) => [c.name, c]));
    for (const name of [...LEGACY_CONTROLLERS, ...NOT_FOR_CLIENTS]) {
      const controller = byName.get(name);
      expect({ name, exists: !!controller }).toEqual({ name, exists: true });
      // Описанный по правилам контроллер из списка убирается.
      expect({ name, tagged: hasApiTags(controller!) }).toEqual({ name, tagged: false });
    }
  });

  it('в документе есть пилот — поиск — со схемой ответа и общей схемой ошибки', () => {
    const doc = buildOpenApiDocument(app);
    expect(doc.paths['/v1/public/search']?.get?.responses?.['200']).toBeDefined();
    expect(doc.components?.schemas).toHaveProperty('SearchResultsDto');
    expect(doc.components?.schemas).toHaveProperty('ApiErrorDto');
    // Внутреннее и админское в контракт не попадает.
    expect(Object.keys(doc.paths).some((p) => p.startsWith('/v1/internal') || p.startsWith('/v1/admin'))).toBe(false);
  });
});
