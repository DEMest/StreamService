# Multi-Tenant Streaming Platform — Design Spec

**Date:** 2026-04-12
**Status:** Approved

---

## 1. Overview

Расширение StreamService из одноорганизационного MVP в мультиарендную спортивную стриминговую платформу. Каждая организация получает собственные SRT-credentials и страницу трансляции. Зрители смотрят анонимно, общаются через чат с никнеймом.

---

## 2. Роли и доступ

Три роли, никакой OAuth или email-регистрации:

| Роль | Логин | Создаётся |
|------|-------|-----------|
| `superadmin` | логин + пароль (seed) | вручную при первом деплое |
| `org_admin` | slug организации + пароль | superadmin'ом вручную |
| `viewer` | без авторизации | анонимно, никнейм в localStorage |

- JWT хранится в `httpOnly cookie`, живёт 8 часов
- `superadmin` — отдельная таблица `User`, не смешивается с организациями
- Viewer может задать никнейм один раз — сохраняется в `localStorage`, используется в чате

---

## 3. База данных (Prisma + PostgreSQL)

```prisma
model User {
  id           String   @id @default(cuid())
  login        String   @unique
  passwordHash String
  role         String   // "superadmin"
  createdAt    DateTime @default(now())
}

model Organization {
  id                 String   @id @default(cuid())
  slug               String   @unique  // логин + часть URL
  name               String
  passwordHash       String
  ingestKey          String   @unique  // SRT passphrase, 24 символа
  ingestKeyCreatedAt DateTime @default(now())
  isActive           Boolean  @default(true)
  createdAt          DateTime @default(now())
  events             Event[]
}

model Event {
  id           String       @id @default(cuid())
  orgId        String
  org          Organization @relation(fields: [orgId], references: [id])
  title        String
  description  String?
  status       String       @default("scheduled") // "scheduled"|"live"|"ended"
  isPublic     Boolean      @default(true)
  startedAt    DateTime?
  endedAt      DateTime?
  createdAt    DateTime     @default(now())
  messages     ChatMessage[]
}

model ChatMessage {
  id        String   @id @default(cuid())
  eventId   String
  event     Event    @relation(fields: [eventId], references: [id])
  nickname  String
  content   String
  createdAt DateTime @default(now())
}
```

**Ключевые решения:**
- `Organization.slug` = логин org_admin и часть URL зрителя
- `ingestKey` = SRT passphrase в MediaMTX, не передаётся зрителям
- Никнейм в чате — строка в каждом сообщении, нормализации нет
- Один активный Event (`status=live`) на организацию в один момент

---

## 4. API

### Auth
```
POST /v1/auth/login          { login, password } → JWT cookie
POST /v1/auth/logout         очистить cookie
GET  /v1/auth/me             текущий пользователь
```

### Superadmin (`role=superadmin`)
```
POST   /v1/admin/orgs              создать организацию (генерирует ingestKey, регистрирует путь в MediaMTX)
GET    /v1/admin/orgs              список всех организаций
PATCH  /v1/admin/orgs/:slug        изменить name, isActive
DELETE /v1/admin/orgs/:slug        удалить (удаляет путь из MediaMTX)
```

### Org admin (`role=org_admin`, только своя организация)
```
GET    /v1/org/me                        данные организации + ingestKey (скрыт по умолчанию)
POST   /v1/org/ingest-key/rotate         новый ingestKey + обновить путь в MediaMTX
POST   /v1/org/events                    создать событие
PATCH  /v1/org/events/:id                редактировать (title, isPublic, status, description)
GET    /v1/org/events                    история событий
```

### Публичные (без auth)
```
GET    /v1/public/orgs                        каталог организаций с активной трансляцией (isPublic=true + status=live)
GET    /v1/public/orgs/:orgSlug               страница организации + текущее активное событие
GET    /v1/public/orgs/:orgSlug/stream        HLS URL для плеера
```

### WebSocket (`/chat` namespace, Socket.io)
```
emit:  join({ eventId })
emit:  message({ eventId, nickname, content })
on:    message → { id, nickname, content, createdAt }
```

---

## 5. Frontend (Next.js)

### Страницы

| Путь | Описание | Доступ |
|------|----------|--------|
| `/` | Каталог живых публичных трансляций | Публичный |
| `/watch/[orgSlug]` | Плеер + чат активного события организации | Публичный |
| `/login` | Форма входа | Публичный |
| `/dashboard` | Панель org_admin | `org_admin` |
| `/admin` | Панель superadmin | `superadmin` |

### Детали

- **`/watch/[orgSlug]`**: плеер слева (hls.js, quad/focus переключение сохраняется), чат справа. При первом открытии чата — модалка «Введите никнейм», сохраняется в `localStorage`
- **`/dashboard`**: ingestKey скрыт по умолчанию (кнопка "показать"), кнопка "ротировать ключ" с подтверждением, CRUD событий, переключатель `isPublic`
- **`/admin`**: таблица организаций, кнопка "создать" (modal: slug, name, password)
- **Middleware Next.js**: редирект на `/login` если нет JWT cookie для `/dashboard` и `/admin`
- **Состояние**: React Query для серверных данных, useState локально. Без Redux/Zustand.

---

## 6. Инфраструктура

### Docker Compose

```
postgres    — PostgreSQL 16, named volume
api         — NestJS (расширяется)
web         — Next.js (расширяется)
mediamtx    — обновлённый конфиг с включённым API
```

### MediaMTX интеграция

MediaMTX API включается (`api: yes`, `apiAddress: :9997`, внутри Docker-сети, не наружу).

**Жизненный цикл пути:**

| Событие | Действие NestJS → MediaMTX |
|---------|---------------------------|
| Создание организации | `POST /v3/config/paths/add/live/<orgSlug>` с `srtPublishPassphrase` |
| Ротация ключа | `POST /v3/config/paths/patch/live/<orgSlug>` с новым passphrase |
| Удаление организации | `DELETE /v3/config/paths/delete/live/<orgSlug>` |

**vMix настройки для стримера:**
```
Protocol:   SRT Push
Host:       <server-ip>
Port:       8890
Stream ID:  publish:live/<orgSlug>
Passphrase: <ingestKey>
```

**HLS для зрителей:** `/hls/live/<orgSlug>/index.m3u8`
Next.js проксирует `/hls/*` → `mediamtx:8888` как и сейчас.

### Переменные окружения (добавляются в .env.example)
```
DATABASE_URL=postgresql://user:pass@postgres:5432/streamservice
JWT_SECRET=<random-32-chars>
MEDIAMTX_API_URL=http://mediamtx:9997
SUPERADMIN_LOGIN=admin
SUPERADMIN_PASSWORD=<set-on-deploy>
```

### Первый запуск
```bash
docker compose up -d postgres
pnpm --filter api prisma migrate deploy
pnpm --filter api prisma db seed
docker compose up -d
```

---

## 7. NestJS модули

```
src/
  auth/           — login/logout, JWT strategy, guards
  admin/          — superadmin: CRUD организаций + вызовы MediaMTX API
  org/            — org_admin: профиль, ротация ключа, события
  public/         — публичный каталог и страницы событий
  chat/           — WebSocket gateway, сохранение сообщений
  mediamtx/       — сервис-обёртка для MediaMTX HTTP API
  prisma/         — PrismaService (singleton)
```

---

## 8. Ограничения и нон-голы

- Одна активная трансляция на организацию в один момент: попытка перевести второй event в `status=live` возвращает `409 Conflict`
- Чат — без модерации в этой итерации
- Без платежей, аналитики, Kubernetes
- Основная стриминговая архитектура остаётся: один composite SRT поток → HLS, без разбивки на 4 потока
