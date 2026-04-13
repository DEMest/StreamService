# Multi-Tenant Streaming Platform — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Превратить StreamService из однотенантного MVP в мультиарендную спортивную стриминговую платформу с управлением организациями, динамическими SRT-credentials через MediaMTX API и WebSocket чатом для зрителей.

**Architecture:** NestJS монолит расширяется модулями `prisma`, `auth`, `admin`, `org`, `public`, `chat`, `mediamtx`. Аутентификация через JWT в httpOnly cookie. Чат через Socket.io WebSocket. Управление SRT-путями MediaMTX через его HTTP API.

**Tech Stack:** NestJS 10 + Prisma + PostgreSQL 16 + `@nestjs/jwt` + `bcrypt` + `@nestjs/websockets` + `socket.io` | Next.js 14 + `@tanstack/react-query` + `socket.io-client`

**Spec:** `docs/specs/2026-04-12-multi-tenant-platform-design.md`

---

## Карта файлов

### Backend (`apps/api/src/`)
```
prisma/
  prisma.service.ts        — PrismaClient singleton
  prisma.module.ts         — глобальный модуль

auth/
  auth.module.ts
  auth.controller.ts       — POST /v1/auth/login, logout, GET /v1/auth/me
  auth.service.ts          — login logic, JWT sign
  jwt-auth.guard.ts        — читает cookie, верифицирует JWT
  roles.guard.ts           — проверяет role из JWT
  roles.decorator.ts       — @Roles('superadmin')
  current-user.decorator.ts — @CurrentUser()

admin/
  admin.module.ts
  admin.controller.ts      — /v1/admin/orgs CRUD
  admin.service.ts         — создание/удаление орг + вызовы MediaMTX

mediamtx/
  mediamtx.module.ts
  mediamtx.service.ts      — обёртка над MediaMTX HTTP API

org/
  org.module.ts
  org.controller.ts        — /v1/org/me, /v1/org/ingest-key/rotate, /v1/org/events CRUD
  org.service.ts           — профиль, ротация ключа, события

public/
  public.module.ts
  public.controller.ts     — /v1/public/orgs (каталог + watch + stream)

chat/
  chat.module.ts
  chat.gateway.ts          — Socket.io WebSocket gateway
  chat.service.ts          — сохранение и загрузка сообщений
```

### Frontend (`apps/web/src/`)
```
middleware.ts              — защита /dashboard и /admin
lib/
  api.ts                   — fetch-обёртка с cookie auth
  socket.ts                — socket.io-client singleton

app/
  page.tsx                 — обновить: каталог живых трансляций
  login/page.tsx           — форма входа
  watch/[orgSlug]/page.tsx — плеер + чат
  dashboard/page.tsx       — панель org_admin
  admin/page.tsx           — панель superadmin

components/
  Chat.tsx                 — чат компонент с socket.io
  NicknameModal.tsx        — модалка ввода никнейма
```

### Инфраструктура
```
docker-compose.yml         — добавить service postgres
infra/mediamtx/mediamtx.yml — включить api: yes
prisma/schema.prisma       — схема БД
prisma/seed.ts             — создание superadmin
.env.example               — добавить DATABASE_URL, JWT_SECRET и др.
```

---

## Task 1: Создать feature-ветку и обновить инфраструктуру

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.env.example`
- Modify: `infra/mediamtx/mediamtx.yml`

- [ ] **Step 1: Создать ветку**

```bash
cd D:/Project/StreamService
git checkout -b feature/multi-tenant
```

Expected: `Switched to a new branch 'feature/multi-tenant'`

- [ ] **Step 2: Обновить docker-compose.yml** — добавить postgres, добавить `mediamtx` api порт, задать depends_on для api

Заменить весь файл:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: streamservice
      POSTGRES_USER: stream
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-streampass}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U stream -d streamservice"]
      interval: 5s
      timeout: 5s
      retries: 5

  mediamtx:
    image: bluenviron/mediamtx:latest
    ports:
      - "${MEDIAMTX_HLS_PORT:-8888}:8888"
      - "${MEDIAMTX_SRT_PORT:-8890}:8890/udp"
      - "9997:9997"
    volumes:
      - ./infra/mediamtx/mediamtx.yml:/mediamtx.yml:ro
    restart: unless-stopped

  api:
    build:
      context: ./apps/api
      dockerfile: Dockerfile
    container_name: streamservice-api
    ports:
      - "${API_PORT:-3001}:3001"
    environment:
      API_PORT: ${API_PORT:-3001}
      DATABASE_URL: postgresql://stream:${POSTGRES_PASSWORD:-streampass}@postgres:5432/streamservice
      JWT_SECRET: ${JWT_SECRET:-changeme-in-production}
      MEDIAMTX_API_URL: http://mediamtx:9997
      SUPERADMIN_LOGIN: ${SUPERADMIN_LOGIN:-admin}
      SUPERADMIN_PASSWORD: ${SUPERADMIN_PASSWORD:-adminpass}
    depends_on:
      postgres:
        condition: service_healthy
      mediamtx:
        condition: service_started
    restart: unless-stopped

  web:
    build:
      context: ./apps/web
      dockerfile: Dockerfile
      args:
        HLS_UPSTREAM: http://mediamtx:8888
        API_UPSTREAM: http://api:3001
    container_name: streamservice-web
    ports:
      - "${WEB_PORT:-3000}:3000"
    environment:
      NEXT_PUBLIC_API_URL: /api
      NEXT_PUBLIC_STREAM_BASE_URL: /hls/live
    depends_on:
      - api
      - mediamtx
    restart: unless-stopped

volumes:
  postgres_data:
```

- [ ] **Step 3: Обновить .env.example**

```env
WEB_PORT=3000
API_PORT=3001
MEDIAMTX_SRT_PORT=8890
MEDIAMTX_HLS_PORT=8888

POSTGRES_PASSWORD=streampass

JWT_SECRET=change-this-to-random-32-chars-in-production

SUPERADMIN_LOGIN=admin
SUPERADMIN_PASSWORD=changeme
```

- [ ] **Step 4: Обновить infra/mediamtx/mediamtx.yml** — включить API, убрать хардкоженный путь

```yaml
logLevel: info
logDestinations: [stdout]

api: yes
apiAddress: :9997

srt:
  address: :8890

hls:
  address: :8888
  alwaysRemux: yes
  segmentCount: 7
  segmentDuration: 1s
  partDuration: 200ms

rtsp: no
rtmp: no
webrtc: no
```

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml .env.example infra/mediamtx/mediamtx.yml
git commit -m "feat: add postgres service, enable mediamtx api"
```

---

## Task 2: Prisma — установка, схема, модуль

**Files:**
- Create: `prisma/schema.prisma`
- Create: `apps/api/src/prisma/prisma.service.ts`
- Create: `apps/api/src/prisma/prisma.module.ts`

- [ ] **Step 1: Установить Prisma в api**

```bash
cd apps/api
pnpm add @prisma/client
pnpm add -D prisma
```

- [ ] **Step 2: Создать `prisma/schema.prisma`** в корне репозитория

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id           String   @id @default(cuid())
  login        String   @unique
  passwordHash String
  role         String   @default("superadmin")
  createdAt    DateTime @default(now())
}

model Organization {
  id                 String   @id @default(cuid())
  slug               String   @unique
  name               String
  passwordHash       String
  ingestKey          String   @unique
  ingestKeyCreatedAt DateTime @default(now())
  isActive           Boolean  @default(true)
  createdAt          DateTime @default(now())
  events             Event[]
}

model Event {
  id          String        @id @default(cuid())
  orgId       String
  org         Organization  @relation(fields: [orgId], references: [id], onDelete: Cascade)
  title       String
  description String?
  status      String        @default("scheduled")
  isPublic    Boolean       @default(true)
  startedAt   DateTime?
  endedAt     DateTime?
  createdAt   DateTime      @default(now())
  messages    ChatMessage[]
}

model ChatMessage {
  id        String   @id @default(cuid())
  eventId   String
  event     Event    @relation(fields: [eventId], references: [id], onDelete: Cascade)
  nickname  String
  content   String
  createdAt DateTime @default(now())
}
```

- [ ] **Step 3: Добавить `prisma` в package.json scripts api и задать путь схемы**

В `apps/api/package.json` добавить в `"scripts"`:
```json
"prisma:generate": "prisma generate --schema=../../prisma/schema.prisma",
"prisma:migrate": "prisma migrate deploy --schema=../../prisma/schema.prisma",
"prisma:seed": "ts-node ../../prisma/seed.ts"
```

В `apps/api/package.json` добавить на верхнем уровне:
```json
"prisma": {
  "schema": "../../prisma/schema.prisma"
}
```

- [ ] **Step 4: Создать `apps/api/src/prisma/prisma.service.ts`**

```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();
  }
}
```

- [ ] **Step 5: Создать `apps/api/src/prisma/prisma.module.ts`**

```typescript
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

- [ ] **Step 6: Сгенерировать Prisma client и создать первую миграцию**

```bash
# Из корня репозитория — postgres должен быть запущен
docker compose up -d postgres
# Подождать 5 секунд пока postgres поднимется

cd apps/api
DATABASE_URL="postgresql://stream:streampass@localhost:5432/streamservice" pnpm exec prisma migrate dev --name init --schema=../../prisma/schema.prisma
```

Expected: Migration `0001_init` created and applied.

- [ ] **Step 7: Commit**

```bash
cd ../..
git add prisma/ apps/api/package.json apps/api/src/prisma/
git commit -m "feat: add prisma schema and prisma module"
```

---

## Task 3: Seed — создание superadmin

**Files:**
- Create: `prisma/seed.ts`
- Modify: `apps/api/package.json`

- [ ] **Step 1: Установить bcrypt**

```bash
cd apps/api
pnpm add bcrypt
pnpm add -D @types/bcrypt
```

- [ ] **Step 2: Создать `prisma/seed.ts`**

```typescript
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const login = process.env.SUPERADMIN_LOGIN ?? 'admin';
  const password = process.env.SUPERADMIN_PASSWORD ?? 'adminpass';

  const existing = await prisma.user.findUnique({ where: { login } });
  if (existing) {
    console.log(`Superadmin '${login}' already exists, skipping seed.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.create({ data: { login, passwordHash, role: 'superadmin' } });
  console.log(`Superadmin '${login}' created.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 3: Запустить seed**

```bash
cd apps/api
DATABASE_URL="postgresql://stream:streampass@localhost:5432/streamservice" \
SUPERADMIN_LOGIN=admin \
SUPERADMIN_PASSWORD=adminpass \
pnpm exec ts-node ../../prisma/seed.ts
```

Expected: `Superadmin 'admin' created.`

- [ ] **Step 4: Commit**

```bash
cd ../..
git add prisma/seed.ts apps/api/package.json
git commit -m "feat: add superadmin seed script"
```

---

## Task 4: Удалить старый events модуль, подключить PrismaModule

**Files:**
- Delete: `apps/api/src/events/`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Удалить старый events модуль**

```bash
rm -rf apps/api/src/events
```

- [ ] **Step 2: Обновить `apps/api/src/app.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [HealthController],
})
export class AppModule {}
```

- [ ] **Step 3: Убедиться что api компилируется**

```bash
cd apps/api
pnpm build
```

Expected: Build succeeds without errors.

- [ ] **Step 4: Commit**

```bash
cd ../..
git add apps/api/src/
git commit -m "chore: remove mock events module, wire PrismaModule"
```

---

## Task 5: Auth модуль

**Files:**
- Create: `apps/api/src/auth/auth.module.ts`
- Create: `apps/api/src/auth/auth.service.ts`
- Create: `apps/api/src/auth/auth.controller.ts`
- Create: `apps/api/src/auth/jwt-auth.guard.ts`
- Create: `apps/api/src/auth/roles.guard.ts`
- Create: `apps/api/src/auth/roles.decorator.ts`
- Create: `apps/api/src/auth/current-user.decorator.ts`
- Create: `apps/api/src/auth/auth.service.spec.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/main.ts`

- [ ] **Step 1: Установить зависимости**

```bash
cd apps/api
pnpm add @nestjs/jwt cookie-parser
pnpm add -D @types/cookie-parser
```

- [ ] **Step 2: Написать тесты для AuthService**

Создать `apps/api/src/auth/auth.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

const hash = (p: string) => bcrypt.hashSync(p, 10);

const mockPrisma = {
  user: { findUnique: jest.fn() },
  organization: { findUnique: jest.fn() },
};

const mockJwt = { signAsync: jest.fn().mockResolvedValue('token') };

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
      ],
    }).compile();
    service = module.get(AuthService);
  });

  it('returns token for valid superadmin credentials', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: '1', login: 'admin', passwordHash: hash('pass'), role: 'superadmin',
    });
    const result = await service.login('admin', 'pass');
    expect(result.token).toBe('token');
    expect(result.role).toBe('superadmin');
  });

  it('returns token for valid org_admin credentials', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.organization.findUnique.mockResolvedValue({
      id: 'org1', slug: 'club', passwordHash: hash('key'), isActive: true,
    });
    const result = await service.login('club', 'key');
    expect(result.role).toBe('org_admin');
    expect(result.orgId).toBe('org1');
  });

  it('throws UnauthorizedException for wrong password', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: '1', login: 'admin', passwordHash: hash('pass'), role: 'superadmin',
    });
    await expect(service.login('admin', 'wrong')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws UnauthorizedException for inactive org', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.organization.findUnique.mockResolvedValue({
      id: 'org1', slug: 'club', passwordHash: hash('key'), isActive: false,
    });
    await expect(service.login('club', 'key')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
```

- [ ] **Step 3: Запустить тест — убедиться что падает**

```bash
cd apps/api
pnpm test -- --testPathPattern=auth.service.spec
```

Expected: FAIL — `AuthService` не существует.

- [ ] **Step 4: Создать `apps/api/src/auth/auth.service.ts`**

```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

export interface JwtPayload {
  sub: string;
  role: 'superadmin' | 'org_admin';
  orgId?: string;
  orgSlug?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async login(login: string, password: string) {
    // Попробовать superadmin
    const user = await this.prisma.user.findUnique({ where: { login } });
    if (user) {
      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) throw new UnauthorizedException('Invalid credentials');
      const payload: JwtPayload = { sub: user.id, role: 'superadmin' };
      const token = await this.jwt.signAsync(payload);
      return { token, role: 'superadmin' as const, login: user.login };
    }

    // Попробовать org_admin
    const org = await this.prisma.organization.findUnique({ where: { slug: login } });
    if (!org) throw new UnauthorizedException('Invalid credentials');
    if (!org.isActive) throw new UnauthorizedException('Organization is disabled');
    const valid = await bcrypt.compare(password, org.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');
    const payload: JwtPayload = { sub: org.id, role: 'org_admin', orgId: org.id, orgSlug: org.slug };
    const token = await this.jwt.signAsync(payload);
    return { token, role: 'org_admin' as const, orgId: org.id, login: org.slug };
  }
}
```

- [ ] **Step 5: Запустить тест — убедиться что проходит**

```bash
pnpm test -- --testPathPattern=auth.service.spec
```

Expected: PASS (4 tests).

- [ ] **Step 6: Создать guards и декораторы**

`apps/api/src/auth/jwt-auth.guard.ts`:
```typescript
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const token = req.cookies?.['access_token'];
    if (!token) throw new UnauthorizedException('Not authenticated');
    try {
      req['user'] = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    return true;
  }
}
```

`apps/api/src/auth/roles.guard.ts`:
```typescript
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      ctx.getHandler(), ctx.getClass(),
    ]);
    if (!required) return true;
    const user = ctx.switchToHttp().getRequest()['user'];
    if (!required.includes(user?.role)) throw new ForbiddenException('Insufficient role');
    return true;
  }
}
```

`apps/api/src/auth/roles.decorator.ts`:
```typescript
import { SetMetadata } from '@nestjs/common';
export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
```

`apps/api/src/auth/current-user.decorator.ts`:
```typescript
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest()['user'],
);
```

- [ ] **Step 7: Создать `apps/api/src/auth/auth.controller.ts`**

```typescript
import { Body, Controller, Get, HttpCode, Post, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';
import { JwtPayload } from './auth.service';

@Controller('v1/auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: { login: string; password: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(body.login, body.password);
    res.cookie('access_token', result.token, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000, // 8 hours
    });
    return { role: result.role, login: result.login, orgId: result.orgId ?? null };
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('access_token');
    return { ok: true };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: JwtPayload) {
    return user;
  }
}
```

- [ ] **Step 8: Создать `apps/api/src/auth/auth.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'dev-secret',
      signOptions: { expiresIn: '8h' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [JwtModule],
})
export class AuthModule {}
```

- [ ] **Step 9: Обновить `apps/api/src/main.ts`**

```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());
  app.enableCors({ origin: true, credentials: true });
  const port = process.env.API_PORT ?? 3001;
  await app.listen(port);
  console.log(`API running on port ${port}`);
}
bootstrap();
```

- [ ] **Step 10: Добавить AuthModule в AppModule**

`apps/api/src/app.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [HealthController],
})
export class AppModule {}
```

- [ ] **Step 11: Запустить все тесты**

```bash
cd apps/api
pnpm test
```

Expected: All tests pass.

- [ ] **Step 12: Commit**

```bash
cd ../..
git add apps/api/src/auth/ apps/api/src/main.ts apps/api/src/app.module.ts apps/api/package.json
git commit -m "feat: add auth module with JWT cookie login"
```

---

## Task 6: MediaMTX сервис

**Files:**
- Create: `apps/api/src/mediamtx/mediamtx.service.ts`
- Create: `apps/api/src/mediamtx/mediamtx.module.ts`

- [ ] **Step 1: Установить axios**

```bash
cd apps/api
pnpm add axios
```

- [ ] **Step 2: Создать `apps/api/src/mediamtx/mediamtx.service.ts`**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class MediamtxService {
  private readonly logger = new Logger(MediamtxService.name);
  private readonly base = process.env.MEDIAMTX_API_URL ?? 'http://localhost:9997';

  async addPath(orgSlug: string, passphrase: string): Promise<void> {
    try {
      await axios.post(`${this.base}/v3/config/paths/add/live/${orgSlug}`, {
        srtPublishPassphrase: passphrase,
      });
    } catch (err) {
      this.logger.warn(`MediaMTX addPath failed for ${orgSlug}: ${err.message}`);
    }
  }

  async patchPath(orgSlug: string, passphrase: string): Promise<void> {
    try {
      await axios.patch(`${this.base}/v3/config/paths/patch/live/${orgSlug}`, {
        srtPublishPassphrase: passphrase,
      });
    } catch (err) {
      this.logger.warn(`MediaMTX patchPath failed for ${orgSlug}: ${err.message}`);
    }
  }

  async deletePath(orgSlug: string): Promise<void> {
    try {
      await axios.delete(`${this.base}/v3/config/paths/delete/live/${orgSlug}`);
    } catch (err) {
      this.logger.warn(`MediaMTX deletePath failed for ${orgSlug}: ${err.message}`);
    }
  }
}
```

> **Примечание:** Ошибки MediaMTX логируются как warn (не бросают exception) — чтобы API не падал если MediaMTX временно недоступен.

- [ ] **Step 3: Создать `apps/api/src/mediamtx/mediamtx.module.ts`**

```typescript
import { Global, Module } from '@nestjs/common';
import { MediamtxService } from './mediamtx.service';

@Global()
@Module({
  providers: [MediamtxService],
  exports: [MediamtxService],
})
export class MediamtxModule {}
```

- [ ] **Step 4: Добавить MediamtxModule в AppModule**

```typescript
import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { MediamtxModule } from './mediamtx/mediamtx.module';

@Module({
  imports: [PrismaModule, AuthModule, MediamtxModule],
  controllers: [HealthController],
})
export class AppModule {}
```

- [ ] **Step 5: Commit**

```bash
cd ../..
git add apps/api/src/mediamtx/ apps/api/src/app.module.ts apps/api/package.json
git commit -m "feat: add mediamtx service for dynamic path management"
```

---

## Task 7: Admin модуль (управление организациями)

**Files:**
- Create: `apps/api/src/admin/admin.service.ts`
- Create: `apps/api/src/admin/admin.service.spec.ts`
- Create: `apps/api/src/admin/admin.controller.ts`
- Create: `apps/api/src/admin/admin.module.ts`

- [ ] **Step 1: Написать тесты для AdminService**

`apps/api/src/admin/admin.service.spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { AdminService } from './admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { MediamtxService } from '../mediamtx/mediamtx.service';
import { ConflictException, NotFoundException } from '@nestjs/common';

const mockPrisma = {
  organization: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};
const mockMediamtx = { addPath: jest.fn(), deletePath: jest.fn() };

describe('AdminService', () => {
  let service: AdminService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MediamtxService, useValue: mockMediamtx },
      ],
    }).compile();
    service = module.get(AdminService);
  });

  it('creates org with generated ingestKey and calls mediamtx.addPath', async () => {
    mockPrisma.organization.create.mockResolvedValue({ id: '1', slug: 'club', name: 'Club', ingestKey: 'key123' });
    const result = await service.createOrg({ slug: 'club', name: 'Club', password: 'pass' });
    expect(result.slug).toBe('club');
    expect(mockMediamtx.addPath).toHaveBeenCalledWith('club', expect.any(String));
  });

  it('throws NotFoundException when deleting non-existent org', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue(null);
    await expect(service.deleteOrg('ghost')).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться что падает**

```bash
cd apps/api
pnpm test -- --testPathPattern=admin.service.spec
```

Expected: FAIL — `AdminService` не существует.

- [ ] **Step 3: Создать `apps/api/src/admin/admin.service.ts`**

```typescript
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MediamtxService } from '../mediamtx/mediamtx.service';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private mediamtx: MediamtxService,
  ) {}

  private generateIngestKey(): string {
    return randomBytes(18).toString('base64url'); // ~24 chars, SRT-safe
  }

  async createOrg(data: { slug: string; name: string; password: string }) {
    const ingestKey = this.generateIngestKey();
    const passwordHash = await bcrypt.hash(data.password, 10);
    try {
      const org = await this.prisma.organization.create({
        data: { slug: data.slug, name: data.name, passwordHash, ingestKey },
        select: { id: true, slug: true, name: true, isActive: true, createdAt: true },
      });
      await this.mediamtx.addPath(data.slug, ingestKey);
      return org;
    } catch (e: any) {
      if (e.code === 'P2002') throw new ConflictException(`Slug '${data.slug}' already taken`);
      throw e;
    }
  }

  async listOrgs() {
    return this.prisma.organization.findMany({
      select: { id: true, slug: true, name: true, isActive: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateOrg(slug: string, data: { name?: string; isActive?: boolean }) {
    try {
      return await this.prisma.organization.update({
        where: { slug },
        data,
        select: { id: true, slug: true, name: true, isActive: true },
      });
    } catch (e: any) {
      if (e.code === 'P2025') throw new NotFoundException(`Org '${slug}' not found`);
      throw e;
    }
  }

  async deleteOrg(slug: string) {
    const org = await this.prisma.organization.findUnique({ where: { slug } });
    if (!org) throw new NotFoundException(`Org '${slug}' not found`);
    await this.prisma.organization.delete({ where: { slug } });
    await this.mediamtx.deletePath(slug);
    return { ok: true };
  }
}
```

- [ ] **Step 4: Запустить тест — убедиться что проходит**

```bash
pnpm test -- --testPathPattern=admin.service.spec
```

Expected: PASS.

- [ ] **Step 5: Создать `apps/api/src/admin/admin.controller.ts`**

```typescript
import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('v1/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('superadmin')
export class AdminController {
  constructor(private admin: AdminService) {}

  @Post('orgs')
  createOrg(@Body() body: { slug: string; name: string; password: string }) {
    return this.admin.createOrg(body);
  }

  @Get('orgs')
  listOrgs() {
    return this.admin.listOrgs();
  }

  @Patch('orgs/:slug')
  updateOrg(@Param('slug') slug: string, @Body() body: { name?: string; isActive?: boolean }) {
    return this.admin.updateOrg(slug, body);
  }

  @Delete('orgs/:slug')
  deleteOrg(@Param('slug') slug: string) {
    return this.admin.deleteOrg(slug);
  }
}
```

- [ ] **Step 6: Создать `apps/api/src/admin/admin.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
```

- [ ] **Step 7: Добавить AdminModule в AppModule**

```typescript
import { AdminModule } from './admin/admin.module';
// ... добавить AdminModule в imports
```

- [ ] **Step 8: Commit**

```bash
cd ../..
git add apps/api/src/admin/ apps/api/src/app.module.ts
git commit -m "feat: add admin module for org management"
```

---

## Task 8: Org модуль (панель org_admin)

**Files:**
- Create: `apps/api/src/org/org.service.ts`
- Create: `apps/api/src/org/org.service.spec.ts`
- Create: `apps/api/src/org/org.controller.ts`
- Create: `apps/api/src/org/org.module.ts`

- [ ] **Step 1: Написать тесты для OrgService**

`apps/api/src/org/org.service.spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { OrgService } from './org.service';
import { PrismaService } from '../prisma/prisma.service';
import { MediamtxService } from '../mediamtx/mediamtx.service';
import { ConflictException, NotFoundException } from '@nestjs/common';

const mockPrisma = {
  organization: { findUnique: jest.fn(), update: jest.fn() },
  event: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), findMany: jest.fn() },
};
const mockMediamtx = { patchPath: jest.fn() };

describe('OrgService', () => {
  let service: OrgService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        OrgService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MediamtxService, useValue: mockMediamtx },
      ],
    }).compile();
    service = module.get(OrgService);
  });

  it('rotates ingestKey and calls mediamtx.patchPath', async () => {
    mockPrisma.organization.update.mockResolvedValue({ id: '1', slug: 'club', ingestKey: 'newkey' });
    const result = await service.rotateKey('1', 'club');
    expect(mockMediamtx.patchPath).toHaveBeenCalledWith('club', expect.any(String));
    expect(result.ingestKey).toBeDefined();
  });

  it('throws ConflictException when setting event live while another is live', async () => {
    mockPrisma.event.findFirst.mockResolvedValue({ id: 'other', status: 'live' });
    await expect(service.updateEvent('1', 'evt1', { status: 'live' }))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('throws NotFoundException for event not belonging to org', async () => {
    mockPrisma.event.findFirst.mockResolvedValue(null);
    // findFirst returns null for "find live event" check, then second call for "find event"
    mockPrisma.event.findFirst
      .mockResolvedValueOnce(null) // no live event
      .mockResolvedValueOnce(null); // event not found
    await expect(service.updateEvent('1', 'nonexistent', { title: 'x' }))
      .rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться что падает**

```bash
pnpm test -- --testPathPattern=org.service.spec
```

Expected: FAIL.

- [ ] **Step 3: Создать `apps/api/src/org/org.service.ts`**

```typescript
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MediamtxService } from '../mediamtx/mediamtx.service';
import { randomBytes } from 'crypto';

@Injectable()
export class OrgService {
  constructor(
    private prisma: PrismaService,
    private mediamtx: MediamtxService,
  ) {}

  async getProfile(orgId: string, revealKey = false) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        id: true, slug: true, name: true, isActive: true,
        ingestKey: revealKey, ingestKeyCreatedAt: true, createdAt: true,
      },
    });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  async rotateKey(orgId: string, slug: string) {
    const ingestKey = randomBytes(18).toString('base64url');
    const org = await this.prisma.organization.update({
      where: { id: orgId },
      data: { ingestKey, ingestKeyCreatedAt: new Date() },
      select: { id: true, slug: true, ingestKey: true, ingestKeyCreatedAt: true },
    });
    await this.mediamtx.patchPath(slug, ingestKey);
    return org;
  }

  async createEvent(orgId: string, data: { title: string; description?: string; isPublic?: boolean }) {
    return this.prisma.event.create({
      data: { orgId, ...data },
      select: { id: true, title: true, description: true, status: true, isPublic: true, createdAt: true },
    });
  }

  async updateEvent(orgId: string, eventId: string, data: { title?: string; description?: string; isPublic?: boolean; status?: string }) {
    // Проверить конфликт: нельзя сделать live если уже есть live событие
    if (data.status === 'live') {
      const liveEvent = await this.prisma.event.findFirst({
        where: { orgId, status: 'live', id: { not: eventId } },
      });
      if (liveEvent) throw new ConflictException('Another event is already live');
    }

    const event = await this.prisma.event.findFirst({ where: { id: eventId, orgId } });
    if (!event) throw new NotFoundException('Event not found');

    const updateData: any = { ...data };
    if (data.status === 'live') updateData.startedAt = new Date();
    if (data.status === 'ended') updateData.endedAt = new Date();

    return this.prisma.event.update({
      where: { id: eventId },
      data: updateData,
      select: { id: true, title: true, status: true, isPublic: true, startedAt: true, endedAt: true },
    });
  }

  async listEvents(orgId: string) {
    return this.prisma.event.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, status: true, isPublic: true, startedAt: true, endedAt: true, createdAt: true },
    });
  }
}
```

- [ ] **Step 4: Запустить тест — убедиться что проходит**

```bash
pnpm test -- --testPathPattern=org.service.spec
```

Expected: PASS.

- [ ] **Step 5: Создать `apps/api/src/org/org.controller.ts`**

```typescript
import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { OrgService } from './org.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/auth.service';

@Controller('v1/org')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('org_admin')
export class OrgController {
  constructor(private org: OrgService) {}

  @Get('me')
  getProfile(@CurrentUser() user: JwtPayload, @Query('reveal') reveal?: string) {
    return this.org.getProfile(user.orgId!, reveal === 'true');
  }

  @Post('ingest-key/rotate')
  rotateKey(@CurrentUser() user: JwtPayload) {
    return this.org.rotateKey(user.orgId!, user.orgSlug!);
  }

  @Post('events')
  createEvent(@CurrentUser() user: JwtPayload, @Body() body: { title: string; description?: string; isPublic?: boolean }) {
    return this.org.createEvent(user.orgId!, body);
  }

  @Patch('events/:id')
  updateEvent(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() body: any) {
    return this.org.updateEvent(user.orgId!, id, body);
  }

  @Get('events')
  listEvents(@CurrentUser() user: JwtPayload) {
    return this.org.listEvents(user.orgId!);
  }
}
```

- [ ] **Step 6: Создать `apps/api/src/org/org.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { OrgController } from './org.controller';
import { OrgService } from './org.service';

@Module({
  controllers: [OrgController],
  providers: [OrgService],
  exports: [OrgService],
})
export class OrgModule {}
```

- [ ] **Step 7: Добавить OrgModule в AppModule**

```typescript
import { OrgModule } from './org/org.module';
// добавить OrgModule в imports
```

- [ ] **Step 8: Commit**

```bash
cd ../..
git add apps/api/src/org/ apps/api/src/app.module.ts
git commit -m "feat: add org module for org_admin dashboard"
```

---

## Task 9: Public модуль (каталог и страница просмотра)

**Files:**
- Create: `apps/api/src/public/public.service.ts`
- Create: `apps/api/src/public/public.controller.ts`
- Create: `apps/api/src/public/public.module.ts`

- [ ] **Step 1: Создать `apps/api/src/public/public.service.ts`**

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PublicService {
  constructor(private prisma: PrismaService) {}

  async getCatalog() {
    // Организации с активной публичной трансляцией
    return this.prisma.organization.findMany({
      where: { isActive: true, events: { some: { status: 'live', isPublic: true } } },
      select: {
        slug: true, name: true,
        events: {
          where: { status: 'live', isPublic: true },
          take: 1,
          select: { id: true, title: true, startedAt: true },
        },
      },
    });
  }

  async getOrgWatch(orgSlug: string) {
    const org = await this.prisma.organization.findUnique({
      where: { slug: orgSlug, isActive: true },
      select: {
        slug: true, name: true,
        events: {
          where: { status: 'live' },
          take: 1,
          select: { id: true, title: true, description: true, isPublic: true, startedAt: true },
        },
      },
    });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  async getStreamUrl(orgSlug: string) {
    const org = await this.prisma.organization.findUnique({
      where: { slug: orgSlug, isActive: true },
      select: { slug: true, ingestKey: true, events: { where: { status: 'live' }, take: 1, select: { id: true } } },
    });
    if (!org || org.events.length === 0) throw new NotFoundException('No live stream');
    // HLS путь строится по slug (MediaMTX путь = live/<slug>)
    return { hlsUrl: `/hls/live/${orgSlug}/index.m3u8` };
  }
}
```

- [ ] **Step 2: Создать `apps/api/src/public/public.controller.ts`**

```typescript
import { Controller, Get, Param } from '@nestjs/common';
import { PublicService } from './public.service';

@Controller('v1/public')
export class PublicController {
  constructor(private pub: PublicService) {}

  @Get('orgs')
  getCatalog() {
    return this.pub.getCatalog();
  }

  @Get('orgs/:orgSlug')
  getOrgWatch(@Param('orgSlug') orgSlug: string) {
    return this.pub.getOrgWatch(orgSlug);
  }

  @Get('orgs/:orgSlug/stream')
  getStreamUrl(@Param('orgSlug') orgSlug: string) {
    return this.pub.getStreamUrl(orgSlug);
  }
}
```

- [ ] **Step 3: Создать `apps/api/src/public/public.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';

@Module({
  controllers: [PublicController],
  providers: [PublicService],
})
export class PublicModule {}
```

- [ ] **Step 4: Добавить PublicModule в AppModule**

```typescript
import { PublicModule } from './public/public.module';
// добавить PublicModule в imports
```

- [ ] **Step 5: Commit**

```bash
cd ../..
git add apps/api/src/public/ apps/api/src/app.module.ts
git commit -m "feat: add public module for viewer catalog and watch page"
```

---

## Task 10: Chat модуль (WebSocket)

**Files:**
- Create: `apps/api/src/chat/chat.gateway.ts`
- Create: `apps/api/src/chat/chat.service.ts`
- Create: `apps/api/src/chat/chat.module.ts`

- [ ] **Step 1: Установить зависимости**

```bash
cd apps/api
pnpm add @nestjs/websockets @nestjs/platform-socket.io socket.io
```

- [ ] **Step 2: Создать `apps/api/src/chat/chat.service.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ChatService {
  constructor(private prisma: PrismaService) {}

  async saveMessage(eventId: string, nickname: string, content: string) {
    return this.prisma.chatMessage.create({
      data: { eventId, nickname, content: content.slice(0, 500) },
      select: { id: true, nickname: true, content: true, createdAt: true },
    });
  }

  async getRecentMessages(eventId: string, limit = 50) {
    const messages = await this.prisma.chatMessage.findMany({
      where: { eventId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, nickname: true, content: true, createdAt: true },
    });
    return messages.reverse();
  }
}
```

- [ ] **Step 3: Создать `apps/api/src/chat/chat.gateway.ts`**

```typescript
import {
  ConnectedSocket, MessageBody, OnGatewayInit,
  SubscribeMessage, WebSocketGateway, WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';

@WebSocketGateway({ cors: { origin: '*' }, namespace: '/chat' })
export class ChatGateway implements OnGatewayInit {
  @WebSocketServer() server: Server;

  constructor(private chat: ChatService) {}

  afterInit() {
    console.log('Chat WebSocket gateway initialized');
  }

  @SubscribeMessage('join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { eventId: string },
  ) {
    client.join(`event:${data.eventId}`);
    const messages = await this.chat.getRecentMessages(data.eventId);
    client.emit('history', messages);
  }

  @SubscribeMessage('message')
  async handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { eventId: string; nickname: string; content: string },
  ) {
    if (!data.eventId || !data.nickname?.trim() || !data.content?.trim()) return;
    const message = await this.chat.saveMessage(data.eventId, data.nickname.trim(), data.content.trim());
    this.server.to(`event:${data.eventId}`).emit('message', message);
  }
}
```

- [ ] **Step 4: Создать `apps/api/src/chat/chat.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';

@Module({
  providers: [ChatGateway, ChatService],
})
export class ChatModule {}
```

- [ ] **Step 5: Добавить ChatModule в AppModule**

```typescript
import { ChatModule } from './chat/chat.module';
// добавить ChatModule в imports
```

- [ ] **Step 6: Запустить все тесты**

```bash
cd apps/api
pnpm test
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
cd ../..
git add apps/api/src/chat/ apps/api/src/app.module.ts apps/api/package.json
git commit -m "feat: add chat module with socket.io websocket gateway"
```

---

## Task 11: Frontend — установка зависимостей и базовая инфраструктура

**Files:**
- Create: `apps/web/src/middleware.ts`
- Create: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/lib/socket.ts`
- Modify: `apps/web/src/app/layout.tsx`

- [ ] **Step 1: Установить зависимости**

```bash
cd apps/web
pnpm add @tanstack/react-query socket.io-client
```

- [ ] **Step 2: Создать `apps/web/src/middleware.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';

const PROTECTED_PATHS = ['/dashboard', '/admin'];

export function middleware(req: NextRequest) {
  const token = req.cookies.get('access_token');
  if (PROTECTED_PATHS.some((p) => req.nextUrl.pathname.startsWith(p)) && !token) {
    return NextResponse.redirect(new URL('/login', req.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ['/dashboard/:path*', '/admin/:path*'] };
```

- [ ] **Step 3: Создать `apps/web/src/lib/api.ts`**

```typescript
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(error.message ?? 'Request failed');
  }
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
```

- [ ] **Step 4: Создать `apps/web/src/lib/socket.ts`**

> **Важно:** Next.js `rewrites` не форвардят WebSocket upgrade. Socket.io подключается напрямую к API URL, минуя прокси. CORS уже включён в NestJS.

```typescript
import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    // Подключаемся напрямую к API (не через Next.js прокси — он не форвардит WS upgrade)
    const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL ?? 'http://localhost:3001';
    socket = io(`${socketUrl}/chat`, {
      transports: ['websocket'],
      withCredentials: true,
    });
  }
  return socket;
}
```

- [ ] **Step 4a: Добавить `NEXT_PUBLIC_SOCKET_URL` в `.env.example` и `docker-compose.yml`**

В `.env.example` добавить:
```env
NEXT_PUBLIC_SOCKET_URL=http://localhost:3001
```

В `docker-compose.yml` в секции `web.environment` добавить:
```yaml
NEXT_PUBLIC_SOCKET_URL: http://localhost:3001
```

> В продакшне `NEXT_PUBLIC_SOCKET_URL` должен указывать на публичный URL API.

- [ ] **Step 5: Обновить `apps/web/src/app/layout.tsx`** — добавить React Query provider

```typescript
'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import './globals.css';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient());
  return (
    <html lang="ru">
      <body>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </body>
    </html>
  );
}
```

> **Примечание:** metadata экспорт убирается из layout (несовместим с `'use client'`). Создайте отдельный `apps/web/src/app/metadata.ts` если нужно задать title.

- [ ] **Step 6: Commit**

```bash
cd ../..
git add apps/web/src/middleware.ts apps/web/src/lib/ apps/web/src/app/layout.tsx apps/web/package.json
git commit -m "feat: add web infra — react query, api client, socket, middleware"
```

---

## Task 12: Frontend — страница /login

**Files:**
- Create: `apps/web/src/app/login/page.tsx`

- [ ] **Step 1: Создать `apps/web/src/app/login/page.tsx`**

```typescript
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post<{ role: string }>('/v1/auth/login', { login, password });
      router.push(res.role === 'superadmin' ? '/admin' : '/dashboard');
    } catch (err: any) {
      setError(err.message ?? 'Неверный логин или пароль');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#0a0a0a' }}>
      <form onSubmit={handleSubmit} style={{ background: '#1a1a1a', padding: '2rem', borderRadius: '8px', width: '320px', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <h1 style={{ color: '#fff', margin: 0, fontSize: '1.25rem' }}>StreamService</h1>
        <input
          value={login} onChange={(e) => setLogin(e.target.value)}
          placeholder="Логин организации"
          style={{ padding: '0.75rem', borderRadius: '4px', border: '1px solid #333', background: '#0a0a0a', color: '#fff' }}
          required
        />
        <input
          type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder="Пароль"
          style={{ padding: '0.75rem', borderRadius: '4px', border: '1px solid #333', background: '#0a0a0a', color: '#fff' }}
          required
        />
        {error && <p style={{ color: '#ff4444', margin: 0, fontSize: '0.875rem' }}>{error}</p>}
        <button type="submit" disabled={loading}
          style={{ padding: '0.75rem', borderRadius: '4px', background: '#e53', color: '#fff', border: 'none', cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 600 }}>
          {loading ? 'Вход...' : 'Войти'}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/login/
git commit -m "feat: add login page"
```

---

## Task 13: Frontend — главная страница (каталог трансляций)

**Files:**
- Modify: `apps/web/src/app/page.tsx`

- [ ] **Step 1: Заменить `apps/web/src/app/page.tsx`**

```typescript
'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '@/lib/api';

interface CatalogOrg {
  slug: string;
  name: string;
  events: { id: string; title: string; startedAt: string }[];
}

export default function CatalogPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['catalog'],
    queryFn: () => api.get<CatalogOrg[]>('/v1/public/orgs'),
    refetchInterval: 30_000,
  });

  return (
    <div style={{ background: '#0a0a0a', minHeight: '100vh', padding: '2rem', color: '#fff' }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '2rem' }}>Прямые трансляции</h1>
      {isLoading && <p style={{ color: '#888' }}>Загрузка...</p>}
      {data?.length === 0 && <p style={{ color: '#888' }}>Нет активных трансляций</p>}
      <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
        {data?.map((org) => (
          <Link key={org.slug} href={`/watch/${org.slug}`} style={{ textDecoration: 'none' }}>
            <div style={{ background: '#1a1a1a', borderRadius: '8px', padding: '1.25rem', cursor: 'pointer', border: '1px solid #2d2d2d' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#e53', display: 'inline-block' }} />
                <span style={{ color: '#e53', fontSize: '0.75rem', fontWeight: 600 }}>LIVE</span>
              </div>
              <p style={{ color: '#fff', fontWeight: 600, margin: '0 0 0.25rem' }}>{org.name}</p>
              <p style={{ color: '#888', fontSize: '0.875rem', margin: 0 }}>{org.events[0]?.title}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/page.tsx
git commit -m "feat: update home page with live catalog"
```

---

## Task 14: Frontend — страница просмотра /watch/[orgSlug]

**Files:**
- Create: `apps/web/src/app/watch/[orgSlug]/page.tsx`
- Create: `apps/web/src/components/Chat.tsx`
- Create: `apps/web/src/components/NicknameModal.tsx`

- [ ] **Step 1: Создать `apps/web/src/components/NicknameModal.tsx`**

```typescript
'use client';
import { useState } from 'react';

interface Props {
  onConfirm: (nickname: string) => void;
}

export function NicknameModal({ onConfirm }: Props) {
  const [value, setValue] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = value.trim();
    if (name) onConfirm(name);
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <form onSubmit={handleSubmit} style={{ background: '#1a1a1a', padding: '2rem', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '1rem', minWidth: '280px' }}>
        <p style={{ color: '#fff', margin: 0, fontWeight: 600 }}>Введите никнейм для чата</p>
        <input
          autoFocus value={value} onChange={(e) => setValue(e.target.value)}
          maxLength={32} placeholder="Ваш никнейм"
          style={{ padding: '0.75rem', borderRadius: '4px', border: '1px solid #333', background: '#0a0a0a', color: '#fff' }}
          required
        />
        <button type="submit" style={{ padding: '0.75rem', borderRadius: '4px', background: '#2563eb', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
          Войти в чат
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Создать `apps/web/src/components/Chat.tsx`**

```typescript
'use client';
import { useEffect, useRef, useState } from 'react';
import { getSocket } from '@/lib/socket';
import { NicknameModal } from './NicknameModal';

interface Message { id: string; nickname: string; content: string; createdAt: string }

interface Props { eventId: string }

export function Chat({ eventId }: Props) {
  const [nickname, setNickname] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem('chat_nickname');
    if (saved) setNickname(saved);
  }, []);

  useEffect(() => {
    const socket = getSocket();
    socket.emit('join', { eventId });
    socket.on('history', (msgs: Message[]) => setMessages(msgs));
    socket.on('message', (msg: Message) => setMessages((prev) => [...prev, msg]));
    return () => { socket.off('history'); socket.off('message'); };
  }, [eventId]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  function handleNicknameConfirm(name: string) {
    localStorage.setItem('chat_nickname', name);
    setNickname(name);
  }

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || !nickname) return;
    getSocket().emit('message', { eventId, nickname, content: input.trim() });
    setInput('');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#111' }}>
      {!nickname && <NicknameModal onConfirm={handleNicknameConfirm} />}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {messages.map((m) => (
          <div key={m.id}>
            <span style={{ color: '#2563eb', fontWeight: 600, fontSize: '0.8rem' }}>{m.nickname}: </span>
            <span style={{ color: '#ddd', fontSize: '0.875rem' }}>{m.content}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={handleSend} style={{ display: 'flex', borderTop: '1px solid #222', padding: '0.5rem' }}>
        <input
          value={input} onChange={(e) => setInput(e.target.value)}
          placeholder="Сообщение..."
          maxLength={500}
          style={{ flex: 1, padding: '0.5rem', background: '#0a0a0a', border: 'none', color: '#fff', borderRadius: '4px 0 0 4px' }}
        />
        <button type="submit" style={{ padding: '0.5rem 1rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '0 4px 4px 0', cursor: 'pointer' }}>
          →
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Создать `apps/web/src/app/watch/[orgSlug]/page.tsx`**

```typescript
'use client';
import { useQuery } from '@tanstack/react-query';
import { use, useState } from 'react';
import { api } from '@/lib/api';
import { MatPlayer } from '@/components/MatPlayer';
import { ViewSwitcher } from '@/components/ViewSwitcher';
import { Chat } from '@/components/Chat';

const QUAD_ORIGIN: Record<number, string> = {
  1: '25% 25%', 2: '75% 25%', 3: '25% 75%', 4: '75% 75%',
};

interface OrgWatch {
  slug: string; name: string;
  events: { id: string; title: string; description?: string; isPublic: boolean; startedAt: string }[];
}

interface StreamInfo { hlsUrl: string }

export default function WatchPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = use(params);
  const [viewMode, setViewMode] = useState<'quad' | 'focus'>('quad');
  const [activeMat, setActiveMat] = useState(1);

  const { data: org } = useQuery({
    queryKey: ['watch', orgSlug],
    queryFn: () => api.get<OrgWatch>(`/v1/public/orgs/${orgSlug}`),
    refetchInterval: 15_000,
  });

  const { data: stream } = useQuery({
    queryKey: ['stream', orgSlug],
    queryFn: () => api.get<StreamInfo>(`/v1/public/orgs/${orgSlug}/stream`),
    enabled: (org?.events.length ?? 0) > 0,
  });

  const event = org?.events[0];

  const videoStyle: React.CSSProperties = {
    width: '100%', height: '100%',
    transform: viewMode === 'focus' ? `scale(2)` : 'scale(1)',
    transformOrigin: viewMode === 'focus' ? QUAD_ORIGIN[activeMat] : '50% 50%',
    transition: 'transform 0.3s ease, transform-origin 0.3s ease',
  };

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#0a0a0a', color: '#fff', flexDirection: 'column' }}>
      <div style={{ padding: '0.75rem 1rem', background: '#111', borderBottom: '1px solid #222', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={{ fontWeight: 700 }}>{org?.name}</span>
          {event && <span style={{ color: '#888', marginLeft: '1rem', fontSize: '0.875rem' }}>{event.title}</span>}
        </div>
        {event && <span style={{ color: '#e53', fontSize: '0.75rem', fontWeight: 600 }}>● LIVE</span>}
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
            {stream ? (
              <div style={videoStyle}>
                <MatPlayer streamUrl={stream.hlsUrl} />
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#555' }}>
                {event ? 'Трансляция скоро начнётся...' : 'Нет активной трансляции'}
              </div>
            )}
          </div>
          <ViewSwitcher
            viewMode={viewMode} activeMat={activeMat}
            onViewChange={setViewMode} onMatChange={setActiveMat}
          />
        </div>

        {event && (
          <div style={{ width: '280px', borderLeft: '1px solid #222' }}>
            <Chat eventId={event.id} />
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/watch/ apps/web/src/components/Chat.tsx apps/web/src/components/NicknameModal.tsx
git commit -m "feat: add watch page with player and chat"
```

---

## Task 15: Frontend — /dashboard (панель org_admin)

**Files:**
- Create: `apps/web/src/app/dashboard/page.tsx`

- [ ] **Step 1: Создать `apps/web/src/app/dashboard/page.tsx`**

```typescript
'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface OrgProfile { id: string; slug: string; name: string; ingestKey?: string; ingestKeyCreatedAt: string }
interface Event { id: string; title: string; status: string; isPublic: boolean; startedAt?: string }

export default function DashboardPage() {
  const qc = useQueryClient();
  const [keyVisible, setKeyVisible] = useState(false);
  const [newEventTitle, setNewEventTitle] = useState('');

  const { data: profile } = useQuery({
    queryKey: ['org-profile', keyVisible],
    queryFn: () => api.get<OrgProfile>(`/v1/org/me${keyVisible ? '?reveal=true' : ''}`),
  });

  const { data: events } = useQuery({
    queryKey: ['org-events'],
    queryFn: () => api.get<Event[]>('/v1/org/events'),
  });

  const rotateMutation = useMutation({
    mutationFn: () => api.post('/v1/org/ingest-key/rotate'),
    onSuccess: () => { setKeyVisible(true); qc.invalidateQueries({ queryKey: ['org-profile'] }); },
  });

  const createEventMutation = useMutation({
    mutationFn: (title: string) => api.post('/v1/org/events', { title }),
    onSuccess: () => { setNewEventTitle(''); qc.invalidateQueries({ queryKey: ['org-events'] }); },
  });

  const updateEventMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Event> }) => api.patch(`/v1/org/events/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org-events'] }),
  });

  const streamId = `publish:live/${profile?.slug}`;

  return (
    <div style={{ background: '#0a0a0a', minHeight: '100vh', color: '#fff', padding: '2rem', maxWidth: '900px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.25rem', marginBottom: '2rem' }}>{profile?.name} — Панель управления</h1>

      {/* Ingest credentials */}
      <section style={{ background: '#1a1a1a', borderRadius: '8px', padding: '1.5rem', marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1rem', marginBottom: '1rem', color: '#ccc' }}>Параметры трансляции</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontFamily: 'monospace', fontSize: '0.875rem' }}>
          <div><span style={{ color: '#888' }}>Порт (SRT): </span><span>8890</span></div>
          <div><span style={{ color: '#888' }}>Stream ID: </span><span>{streamId}</span></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ color: '#888' }}>Passphrase: </span>
            <span>{keyVisible ? profile?.ingestKey : '••••••••••••••••••'}</span>
            <button onClick={() => setKeyVisible((v) => !v)} style={{ background: '#2d2d2d', border: 'none', color: '#ccc', padding: '0.25rem 0.75rem', borderRadius: '4px', cursor: 'pointer' }}>
              {keyVisible ? 'Скрыть' : 'Показать'}
            </button>
            <button onClick={() => { if (confirm('Сгенерировать новый ключ? Текущий стрим будет прерван.')) rotateMutation.mutate(); }}
              style={{ background: '#7c3aed', border: 'none', color: '#fff', padding: '0.25rem 0.75rem', borderRadius: '4px', cursor: 'pointer' }}>
              Сменить ключ
            </button>
          </div>
        </div>
      </section>

      {/* Events */}
      <section style={{ background: '#1a1a1a', borderRadius: '8px', padding: '1.5rem' }}>
        <h2 style={{ fontSize: '1rem', marginBottom: '1rem', color: '#ccc' }}>События</h2>
        <form onSubmit={(e) => { e.preventDefault(); createEventMutation.mutate(newEventTitle); }}
          style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
          <input value={newEventTitle} onChange={(e) => setNewEventTitle(e.target.value)} placeholder="Название нового события"
            style={{ flex: 1, padding: '0.5rem', background: '#0a0a0a', border: '1px solid #333', color: '#fff', borderRadius: '4px' }} required />
          <button type="submit" style={{ padding: '0.5rem 1rem', background: '#059669', border: 'none', color: '#fff', borderRadius: '4px', cursor: 'pointer' }}>
            Создать
          </button>
        </form>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {events?.map((ev) => (
            <div key={ev.id} style={{ background: '#0a0a0a', borderRadius: '6px', padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <span style={{ fontWeight: 600 }}>{ev.title}</span>
                <span style={{ marginLeft: '0.75rem', fontSize: '0.75rem', color: ev.status === 'live' ? '#e53' : '#888' }}>
                  {ev.status === 'live' ? '● LIVE' : ev.status}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {ev.status === 'scheduled' && (
                  <button onClick={() => updateEventMutation.mutate({ id: ev.id, data: { status: 'live' } })}
                    style={{ padding: '0.25rem 0.75rem', background: '#e53', border: 'none', color: '#fff', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>
                    Начать
                  </button>
                )}
                {ev.status === 'live' && (
                  <button onClick={() => updateEventMutation.mutate({ id: ev.id, data: { status: 'ended' } })}
                    style={{ padding: '0.25rem 0.75rem', background: '#444', border: 'none', color: '#fff', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>
                    Завершить
                  </button>
                )}
                <button onClick={() => updateEventMutation.mutate({ id: ev.id, data: { isPublic: !ev.isPublic } })}
                  style={{ padding: '0.25rem 0.75rem', background: ev.isPublic ? '#1d4ed8' : '#374151', border: 'none', color: '#fff', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>
                  {ev.isPublic ? 'Публичный' : 'Скрытый'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/dashboard/
git commit -m "feat: add org_admin dashboard page"
```

---

## Task 16: Frontend — /admin (панель superadmin)

**Files:**
- Create: `apps/web/src/app/admin/page.tsx`

- [ ] **Step 1: Создать `apps/web/src/app/admin/page.tsx`**

```typescript
'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface Org { id: string; slug: string; name: string; isActive: boolean; createdAt: string }

export default function AdminPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ slug: '', name: '', password: '' });
  const [showCreate, setShowCreate] = useState(false);

  const { data: orgs } = useQuery({
    queryKey: ['admin-orgs'],
    queryFn: () => api.get<Org[]>('/v1/admin/orgs'),
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof form) => api.post('/v1/admin/orgs', data),
    onSuccess: () => { setForm({ slug: '', name: '', password: '' }); setShowCreate(false); qc.invalidateQueries({ queryKey: ['admin-orgs'] }); },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ slug, isActive }: { slug: string; isActive: boolean }) =>
      api.patch(`/v1/admin/orgs/${slug}`, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-orgs'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (slug: string) => api.delete(`/v1/admin/orgs/${slug}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-orgs'] }),
  });

  return (
    <div style={{ background: '#0a0a0a', minHeight: '100vh', color: '#fff', padding: '2rem', maxWidth: '900px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.25rem', margin: 0 }}>Управление организациями</h1>
        <button onClick={() => setShowCreate((v) => !v)}
          style={{ padding: '0.5rem 1.25rem', background: '#059669', border: 'none', color: '#fff', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}>
          + Новая организация
        </button>
      </div>

      {showCreate && (
        <form onSubmit={(e) => { e.preventDefault(); createMutation.mutate(form); }}
          style={{ background: '#1a1a1a', borderRadius: '8px', padding: '1.5rem', marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <h2 style={{ margin: 0, fontSize: '1rem' }}>Новая организация</h2>
          {[
            { key: 'slug', placeholder: 'Slug (логин, URL)', label: 'Slug' },
            { key: 'name', placeholder: 'Название организации', label: 'Название' },
            { key: 'password', placeholder: 'Пароль для входа', label: 'Пароль' },
          ].map(({ key, placeholder }) => (
            <input key={key} value={(form as any)[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              placeholder={placeholder}
              style={{ padding: '0.75rem', background: '#0a0a0a', border: '1px solid #333', color: '#fff', borderRadius: '4px' }}
              required />
          ))}
          <button type="submit" disabled={createMutation.isPending}
            style={{ padding: '0.75rem', background: '#059669', border: 'none', color: '#fff', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}>
            {createMutation.isPending ? 'Создание...' : 'Создать'}
          </button>
          {createMutation.isError && (
            <p style={{ color: '#ff4444', margin: 0, fontSize: '0.875rem' }}>{(createMutation.error as Error).message}</p>
          )}
        </form>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {orgs?.map((org) => (
          <div key={org.id} style={{ background: '#1a1a1a', borderRadius: '8px', padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <span style={{ fontWeight: 600 }}>{org.name}</span>
              <span style={{ color: '#666', marginLeft: '0.5rem', fontSize: '0.875rem', fontFamily: 'monospace' }}>@{org.slug}</span>
              {!org.isActive && <span style={{ marginLeft: '0.75rem', color: '#888', fontSize: '0.75rem' }}>ОТКЛЮЧЕНА</span>}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button onClick={() => toggleMutation.mutate({ slug: org.slug, isActive: !org.isActive })}
                style={{ padding: '0.25rem 0.75rem', background: org.isActive ? '#374151' : '#059669', border: 'none', color: '#fff', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>
                {org.isActive ? 'Отключить' : 'Включить'}
              </button>
              <button onClick={() => { if (confirm(`Удалить организацию ${org.name}?`)) deleteMutation.mutate(org.slug); }}
                style={{ padding: '0.25rem 0.75rem', background: '#7f1d1d', border: 'none', color: '#fff', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>
                Удалить
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/admin/
git commit -m "feat: add superadmin panel for org management"
```

---

## Task 17: Финальная сборка и дымовой тест

- [ ] **Step 1: Запустить полный стек**

```bash
cd D:/Project/StreamService
docker compose up -d --build
```

- [ ] **Step 2: Выполнить seed**

```bash
docker compose exec api pnpm exec ts-node ../../prisma/seed.ts
```

- [ ] **Step 3: Проверить health endpoint**

```bash
curl http://localhost:3001/health
```

Expected: `{"status":"ok"}`

- [ ] **Step 4: Проверить логин superadmin**

```bash
curl -c cookies.txt -X POST http://localhost:3001/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"login":"admin","password":"adminpass"}'
```

Expected: `{"role":"superadmin","login":"admin","orgId":null}`

- [ ] **Step 5: Создать тестовую организацию**

```bash
curl -b cookies.txt -X POST http://localhost:3001/v1/admin/orgs \
  -H "Content-Type: application/json" \
  -d '{"slug":"wrestling-club","name":"Wrestling Club","password":"clubpass"}'
```

Expected: `{"id":"...","slug":"wrestling-club","name":"Wrestling Club","isActive":true,...}`

- [ ] **Step 6: Проверить публичный каталог**

```bash
curl http://localhost:3001/v1/public/orgs
```

Expected: `[]` (нет live событий)

- [ ] **Step 7: Войти как org_admin и создать событие**

```bash
curl -c org-cookies.txt -X POST http://localhost:3001/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"login":"wrestling-club","password":"clubpass"}'

curl -b org-cookies.txt -X POST http://localhost:3001/v1/org/events \
  -H "Content-Type: application/json" \
  -d '{"title":"Региональный турнир 2026"}'
```

- [ ] **Step 8: Запустить трансляцию и проверить каталог**

```bash
# Получить id события из предыдущего ответа
EVENT_ID="<id из ответа>"

curl -b org-cookies.txt -X PATCH http://localhost:3001/v1/org/events/$EVENT_ID \
  -H "Content-Type: application/json" \
  -d '{"status":"live"}'

curl http://localhost:3001/v1/public/orgs
```

Expected: каталог содержит `wrestling-club` с активным событием.

- [ ] **Step 9: Открыть UI в браузере**

- Главная: `http://localhost:3000` — каталог с карточкой wrestling-club
- Вход: `http://localhost:3000/login` — войти как `admin` / `adminpass`
- Admin: `http://localhost:3000/admin` — список организаций
- Org dashboard: `http://localhost:3000/login` → войти как `wrestling-club` / `clubpass` → `/dashboard`

- [ ] **Step 10: Запустить агент ui-comprehensive-tester**

Запустить агента `ui-comprehensive-tester` для полного UI-тестирования всех страниц.

- [ ] **Step 11: Финальный коммит**

```bash
rm -f cookies.txt org-cookies.txt
git add .
git commit -m "chore: complete multi-tenant platform implementation"
```

---

## Итоговая структура веток

После завершения всех задач:
- Ветка `feature/multi-tenant` содержит полную реализацию
- Используй `superpowers:finishing-a-development-branch` чтобы смержить в `main`
