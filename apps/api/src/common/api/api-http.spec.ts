import {
  Body,
  Controller,
  Get,
  HttpStatus,
  INestApplication,
  Logger,
  NotFoundException,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';
import type { Response } from 'express';
import { AddressInfo } from 'net';
import { SearchController } from '../../search/search.controller';
import { SearchService } from '../../search/search.service';
import { ApiException } from './api-error';
import { configureApi } from './configure-api';
import { CursorQueryDto } from './cursor';
import { OPENAPI_PATH, serveOpenApi } from './openapi';

/**
 * Правила HTTP-слоя на настоящем HTTP: то же `configureApi`, что в main.ts.
 * Главное здесь — что старые эндпоинты (тело-интерфейс, `@Query('x')`,
 * `@Res()` с потоком) ведут себя как раньше, а новые получают валидацию.
 */

class NestedDto {
  @IsInt()
  quad: number;
}

class CreateThingDto {
  @IsString()
  @MaxLength(5)
  name: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  count?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => NestedDto)
  nested?: NestedDto;
}

class ListQueryDto extends CursorQueryDto {
  @IsOptional()
  @IsIn(['live', 'archive'])
  state?: string;
}

interface LegacyBody {
  anything: string;
}

@Controller('t')
class LegacyAndNewController {
  @Post('dto')
  create(@Body() body: CreateThingDto) {
    return { body, isInstance: body instanceof CreateThingDto };
  }

  @Post('optional')
  optional(@Body() body: ListQueryDto) {
    return body;
  }

  @Get('list')
  list(@Query() q: ListQueryDto) {
    return { limit: q.limit, limitType: typeof q.limit, keys: Object.keys(q).sort() };
  }

  @Post('legacy')
  legacy(@Body() body: LegacyBody) {
    return body;
  }

  @Get('legacy-query')
  legacyQuery(@Query('x') x?: string) {
    return { x: x ?? null };
  }

  @Get('not-found')
  notFound() {
    throw new NotFoundException('Stream not found');
  }

  @Get('api-error')
  apiError() {
    throw new ApiException(HttpStatus.CONFLICT, 'STREAM_IS_LIVE', 'Стрим в эфире');
  }

  @Get('boom')
  boom() {
    throw new Error('db exploded: password=secret');
  }

  /** Как отдача HLS-файла: заголовки и часть тела уже ушли, потом ошибка. */
  @Get('stream')
  stream(@Res() res: Response) {
    res.status(200);
    res.write('partial');
    throw new Error('stream broke');
  }
}

class ThingDto {
  @ApiProperty()
  name: string;
}

@ApiTags('things')
@Controller('tagged')
class TaggedController {
  @Get()
  @ApiOkResponse({ type: ThingDto })
  get(): ThingDto {
    return { name: 'x' };
  }
}

class AdminSecretDto {
  @ApiProperty()
  internalNote: string;
}

/**
 * Описан по правилам, но под служебным префиксом — в публичный документ не
 * идёт ни путь, ни схема его ответа.
 */
@ApiTags('admin-things')
@Controller('v1/admin/things')
class AdminThingsController {
  @Get()
  @ApiOkResponse({ type: AdminSecretDto })
  get(): AdminSecretDto {
    return { internalNote: 'secret' };
  }
}

describe('HTTP-слой API: ошибки, валидация, OpenAPI', () => {
  let app: INestApplication;
  let base: string;
  let loggedErrors: jest.SpyInstance;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [LegacyAndNewController, TaggedController, AdminThingsController, SearchController],
      providers: [
        {
          provide: SearchService,
          useValue: { search: (query: string) => ({ query, organizations: [], streams: [], broadcasts: [] }) },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApi(app);
    serveOpenApi(app);
    await app.listen(0);
    const { port } = app.getHttpServer().address() as AddressInfo;
    base = `http://127.0.0.1:${port}`;
  });

  beforeEach(() => {
    loggedErrors = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => loggedErrors.mockRestore());

  afterAll(() => app.close());

  const post = (path: string, body: unknown) =>
    fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  describe('единый формат ошибки', () => {
    it('старое NotFoundException: code по статусу, прежние поля на месте', async () => {
      const res = await fetch(`${base}/t/not-found`);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'Stream not found',
        error: 'Not Found',
      });
    });

    it('ApiException: конкретный код', async () => {
      const res = await fetch(`${base}/t/api-error`);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ statusCode: 409, code: 'STREAM_IS_LIVE', message: 'Стрим в эфире' });
    });

    it('необработанная ошибка: 500 без подробностей наружу, но в логе', async () => {
      const res = await fetch(`${base}/t/boom`);
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        statusCode: 500,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Internal server error',
      });
      expect(loggedErrors).toHaveBeenCalledWith('db exploded: password=secret', expect.any(String));
    });

    it('несуществующий адрес: тот же формат', async () => {
      const res = await fetch(`${base}/nope`);
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    });

    it('ошибка после ушедших заголовков: ответ просто закрывается, как раньше', async () => {
      const res = await fetch(`${base}/t/stream`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('partial');
    });
  });

  describe('валидация', () => {
    it('класс-DTO: неверные поля → 400 VALIDATION_FAILED с путями полей', async () => {
      const res = await post('/t/dto', { name: 'toolong', count: 0, nested: { quad: 'x' } });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('VALIDATION_FAILED');
      expect(typeof body.message).toBe('string');
      expect(body.fields.map((f: { field: string }) => f.field).sort()).toEqual(['count', 'name', 'nested.quad']);
    });

    it('DTO с необязательными полями принимает пустой объект и отклоняет массив', async () => {
      expect((await post('/t/optional', {})).status).toBe(201);
      const bad = await post('/t/optional', []);
      expect(bad.status).toBe(400);
      expect(await bad.json()).toMatchObject({ code: 'VALIDATION_FAILED', fields: [{ field: 'body' }] });
    });

    it('класс-DTO: незнакомые поля отбрасываются, а не ломают запрос', async () => {
      const res = await post('/t/dto', { name: 'ok', extra: 'from a newer app' });
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ body: { name: 'ok' }, isInstance: true });
    });

    it('запрос списка: limit приходит числом, курсор и фильтр описаны', async () => {
      const ok = await fetch(`${base}/t/list?limit=20&state=live&junk=1`);
      expect(await ok.json()).toEqual({ limit: 20, limitType: 'number', keys: ['limit', 'state'] });

      // Без limit — умолчание из CursorQueryDto, а не undefined.
      const dflt = await fetch(`${base}/t/list`);
      expect(await dflt.json()).toEqual({ limit: 20, limitType: 'number', keys: ['limit'] });

      const bad = await fetch(`${base}/t/list?limit=1000`);
      expect(bad.status).toBe(400);
      expect((await bad.json()).fields).toEqual([
        { field: 'limit', messages: ['limit must not be greater than 100'] },
      ]);
    });

    it('старое тело-интерфейс: не валидируется и не обрезается', async () => {
      const res = await post('/t/legacy', { anything: 1, extra: true });
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ anything: 1, extra: true });
    });

    it("старый @Query('x'): значение как было", async () => {
      expect(await (await fetch(`${base}/t/legacy-query?x=abc`)).json()).toEqual({ x: 'abc' });
      expect(await (await fetch(`${base}/t/legacy-query?x=a&x=b`)).json()).toEqual({ x: ['a', 'b'] });
      expect(await (await fetch(`${base}/t/legacy-query`)).json()).toEqual({ x: null });
    });
  });

  it('поиск сохраняет ответ и кэш для строки и отклоняет повторённый q', async () => {
    const ok = await fetch(`${base}/v1/public/search?q=liga&extra=1`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('public, max-age=30');
    expect(await ok.json()).toEqual({ query: 'liga', organizations: [], streams: [], broadcasts: [] });

    const bad = await fetch(`${base}/v1/public/search?q=a&q=b`);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: 'VALIDATION_FAILED', fields: [{ field: 'q' }] });
  });

  describe(OPENAPI_PATH, () => {
    it('отдаёт контракт: только контроллеры с @ApiTags и не из /v1/admin', async () => {
      const res = await fetch(base + OPENAPI_PATH);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/json');
      const doc = await res.json();
      expect(Object.keys(doc.paths)).toEqual(['/tagged', '/v1/public/search']);
      expect(doc.components.schemas).toHaveProperty('ThingDto');
      expect(doc.components.schemas).toHaveProperty('ApiErrorDto');
      expect(doc.components.schemas).toHaveProperty('ApiFieldErrorDto');
      expect(doc.components.schemas).not.toHaveProperty('AdminSecretDto');
    });
  });
});
