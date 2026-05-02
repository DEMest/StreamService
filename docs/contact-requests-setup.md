# Заявки на подключение — настройка и миграция

Эта фича добавляет публичную форму на лендинге → запись в БД → просмотр и обработку в админке суперадмина.

## Где находится «админка»

«Админка» в этом проекте — это страница `/admin` (фронтенд: `apps/web/src/app/admin/page.tsx`). Доступ только у пользователя с ролью `superadmin` (логин/пароль из `SUPERADMIN_LOGIN` / `SUPERADMIN_PASSWORD`, создаётся автоматически при старте API в `AdminService.onModuleInit`).

После релиза в шапке `/admin` появляется кнопка **«Заявки»** → ведёт на `/admin/requests`. Там видно все заявки с лендинга: новые подсвечены брендовым цветом, можно отметить «обработана», вернуть в «новые» или удалить. Email и телефон кликабельны (`mailto:` / `tel:`).

API-эндпоинты (под JWT суперадмина):

- `GET    /v1/admin/contact-requests` — список (опц. `?status=new|processed`)
- `PATCH  /v1/admin/contact-requests/:id`  body: `{ status }`
- `DELETE /v1/admin/contact-requests/:id`

Публичный эндпоинт (без авторизации, его дёргает форма):

- `POST   /v1/public/contact`  body: `{ org, name, email, phone?, message? }`

## Шаги миграции БД

В `prisma/schema.prisma` добавлена модель `ContactRequest`. Нужно применить её к Postgres.

> В проекте сейчас нет папки `prisma/migrations` — то есть схема накатывается через `prisma db push` (без истории миграций). Сохраняем тот же подход.

### Локально (Docker compose, БД в контейнере)

В `.env` нужны переменные (Prisma CLI читает их с хоста):
```bash
POSTGRES_PASSWORD=streampass
# Если на 5432 уже сидит локальный Postgres Windows — мапим Docker на свободный порт
POSTGRES_PORT=55432
DATABASE_URL=postgresql://stream:streampass@localhost:55432/streamservice
```

> Проверить, кто занимает 5432 на Windows: `netstat -ano | findstr :5432`. Если LISTENING на `127.0.0.1:5432` — это системный Postgres, поэтому Docker-контейнер должен слушать другой порт хоста.

```bash
# 1. Postgres должен быть поднят
docker compose up -d postgres

# 2. Применить схему. Скрипт автоматически подхватывает корневой .env
cd apps/api
pnpm prisma:push

# 3. Запустить API/Web в dev-режиме
pnpm dev:api    # терминал 1
pnpm dev:web    # терминал 2
```

> **Важно:** `npx prisma db push` напрямую из `apps/api` не работает — Prisma CLI не находит корневой `.env`. Используй именно `pnpm prisma:push` (он через `dotenv-cli` указывает путь к `../../.env`).

### На проде (сервер)

```bash
# на сервере, в корне проекта, после git pull
docker compose up -d --build api web

# применить схему изнутри контейнера API
docker compose exec api npx prisma db push
docker compose restart api
```

## Проверка

```bash
# отправить тестовую заявку
curl -X POST http://localhost:3001/v1/public/contact \
  -H "Content-Type: application/json" \
  -d '{"org":"Тест","name":"Иван","email":"test@example.com","phone":"+79991234567","message":"Привет"}'
```

После этого заявка должна появиться в админке `/admin/requests` со статусом «Новая».

## Откат

```sql
DROP TABLE "ContactRequest";
```

И откатить изменения в `schema.prisma` (удалить модель `ContactRequest`).
