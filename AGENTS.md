# AGENTS.md

Инструкции для Codex при работе с репозиторием StreamService.

## Как читать проект

- Перед изменениями прочитай этот файл, затронутый код, ближайшие тесты и релевантные разделы `README.md`/`CLAUDE.md`.
- Источник правды при расхождениях: текущая Prisma-схема и миграции → исполняемый код и тесты → CI/Compose → документация.
- `CLAUDE.md` содержит полезные эксплуатационные сведения, но часть архитектурного описания устарела. Не копируй его механически.
- `docs/architecture.md`, `docs/roadmap.md` и старые комментарии могут описывать прежние этапы MVP. Сверяй утверждения с кодом.

Известные устаревшие утверждения, которые нельзя возвращать в код без отдельного продуктового решения:

- `Event`/`EventStream` удалены миграцией `20260702000000_drop_event`.
- Multistream, slots, layout presets и Studio gateway удалены. У Stream один ingest-feed; актуальный `feedMode` — `single | composite`.
- Новые Stream создаются только с непустым slug. Старый `slug=''` и путь `live/<org>` поддерживаются местами как legacy, но обязательного default Stream больше нет и `AdminService.createOrg` его не создаёт.
- При `HLS_LQ_ENABLED=true` live ABR состоит из original/HD-copy и 720p/480p/240p, а не из одной 540p-копии.
- Готовый архив хранится в S3-совместимом хранилище; локальный `/recordings` — временный источник/scratch.

## Проект в двух словах

StreamService — pnpm-монорепозиторий платформы спортивных трансляций:

- `apps/web` — Next.js 14 App Router, React 18, TypeScript, Tailwind, React Query, hls.js, Socket.io client.
- `apps/api` — NestJS 10, Prisma 6, PostgreSQL, cookie JWT, Socket.io, cron-задачи.
- `prisma` — корневая схема, schema migrations и отдельные идемпотентные data migrations.
- `infra/mediamtx` — приём SRT/RTMP, запись fMP4 и запуск FFmpeg для live HLS.
- `infra/deploy` — production nginx и безопасный deploy под живым эфиром.
- `docker-compose.yml` — полный стек; `docker-compose.dev.yml` — только локальные зависимости для запуска API/Web через pnpm.

Node.js должен быть не ниже 20. Пакетный менеджер — pnpm; версия закреплена в корневом `package.json`. Не добавляй npm/yarn lock-файлы.

## Актуальная модель и медиапайплайн

Основная цепочка данных:

`Organization → Stream → Broadcast → Recording`.

- Organization — tenant и настройки организации/чата.
- Stream — самостоятельная трансляция с ingest key, приватностью, preview, feed/recording mode и live-состоянием.
- Broadcast — одна эфирная сессия Stream. `endedAt=null` означает открытый эфир или склеиваемую паузу; смотри также `pausedAt`.
- Recording — сейчас одна запись с `slotIndex=1`; поле осталось из прежней модели. После обработки manifest и медиа лежат в S3.
- ChatMessage относится к Stream. Nullable `orgId` — legacy-поле миграционного периода.
- User имеет роли `superadmin | ad_manager`; организация логинится как `org_admin`.

Live-путь обычного Stream: `live/<orgSlug>/<streamSlug>`. Bare `live/<orgSlug>` — только legacy для строки с `slug=''`.

Пайплайн эфира:

1. MediaMTX принимает SRT/RTMP и вызывает HTTP auth/webhook API.
2. `on-ready.sh` запускает FFmpeg: RTSP pull → HLS в общем `/hls` volume.
3. Nest API раздаёт live HLS и проверяет `previewKey` для приватного Stream.
4. Первый publish открывает Broadcast; unpublish либо закрывает его, либо переводит manual recording в склеиваемую паузу.
5. MediaMTX пишет fMP4 только когда запись включена в конфигурации пути.
6. `RecordingService` собирает HLS-VOD, `download.mp4` и preview, загружает каталог в S3 и только после успешной загрузки ставит `status='ready'`.

Не меняй базовые инварианты без явного требования:

- один ingest-feed на Stream;
- клиентский crop/compositing для `composite`, полный кадр для `single`;
- tenant-scoped `/v1/org/*`; чужой объект возвращает 404, не 403;
- живой или paused/open Stream нельзя удалять до явного завершения;
- приватный Stream и его HLS требуют корректный `previewKey`;
- publish/unpublish одного Stream сериализуются per-stream mutex;
- ошибки SEO ping, уведомлений и preview extraction не должны останавливать эфир/готовую запись.

## Карта кода

- `apps/api/src/stream` — CRUD Stream, ingest paths, webhook lifecycle, recording controls, live reconciliation.
- `apps/api/src/recording` — live/archive HLS endpoints, VOD-сборка, cron cleanup/retry/glue timeout.
- `apps/api/src/mediamtx` — MediaMTX control API и динамические paths.
- `apps/api/src/public` — публичный каталог, watch/archive DTO, thumbnails.
- `apps/api/src/auth`, `admin`, `org`, `ads` — роли и закрытые API.
- `apps/api/src/storage` — S3 и изображения.
- `apps/api/src/stats`, `capacity` — ingest/FFmpeg/nginx/QoE метрики и алерты.
- `apps/api/src/seo`, `search` — sitemap/meta/indexing и публичный поиск.
- `apps/api/src/chat` — Socket.io namespace `/chat`, комнаты по Stream.
- `apps/web/src/app` — App Router pages/layouts/route handlers.
- `apps/web/src/components/MatPlayer.tsx` — основной HLS player и canvas crop.
- `apps/web/src/components/WatchView.tsx` — live/archive UX и управление плеером.
- `apps/web/src/lib/api.ts` — cookie-aware API client с одним refresh-retry.
- `apps/web/src/lib/sections.ts` + `apps/web/src/middleware.ts` — матрица ролей закрытых разделов.

## Безопасность и связанные изменения

- Никогда не коммить `.env`, credentials, private keys, реальные пароли/токены или медиафайлы. Новые переменные документируй в `.env.example` пустым значением либо явным placeholder.
- Не хардкодь роль в `AuthService.login`: роль берётся из `User.role`.
- Host-only auth cookies и разделение `admin.<domain>` / `ads.<domain>` — часть модели безопасности и независимых сессий. Топология живёт в nginx, не переносить её в клиент без необходимости.
- `/admin/ads` доступен `superadmin` и `ad_manager`, но видимость данных различается в `AdsService.seesEverything`.
- При добавлении закрытого frontend-раздела синхронизируй `SECTIONS` и статический `middleware.config.matcher`; backend `@Roles(...)` всё равно обязателен.
- При добавлении upload проверяй тип, размер, декодирование содержимого, tenant ownership и безопасный S3 key.
- Для путей к HLS/recordings сохраняй path-traversal checks и используй POSIX paths для S3 keys.
- Новые зависимости допустимы только с совместимой лицензией (MIT, Apache-2.0, BSD, ISC). GPL/AGPL/LGPL требуют предварительного письменного согласования.

Связанные пары, которые легко разъехать:

- `apps/api/src/capacity/nginx-log.ts` ↔ `log_format capacity` в `infra/deploy/nginx-streamservice.conf`.
- default IndexNow key в `apps/api/src/seo/indexnow.service.ts` ↔ одноимённый `.txt` в `apps/web/public`.
- `apps/web/src/lib/sections.ts` ↔ matcher в `apps/web/src/middleware.ts` ↔ backend roles.
- Prisma schema ↔ новая migration ↔ сгенерированный Prisma client.
- новые env vars ↔ `.env.example` ↔ нужные services/build args в Compose.
- `NEXT_PUBLIC_*`, `SITE_URL` и verification vars, нужные при build, требуют пересборки web image.

## Правила изменений

- Сначала найди существующий паттерн и тест рядом; не вводи второй способ решать ту же задачу.
- Делай минимальный цельный diff. Не рефактори соседний код без связи с задачей.
- Сохраняй пользовательские и несвязанные изменения в dirty worktree.
- Соблюдай `.editorconfig`: UTF-8, LF, 2 пробела, финальный перевод строки.
- Проектские комментарии и UI-тексты преимущественно на русском; имена API/типов — на английском. Комментарии объясняют причину и инвариант, а не повторяют код.
- В API валидируй вход на границе controller/service и возвращай Nest exceptions с понятным сообщением.
- Все org-scoped запросы должны включать `orgId` в lookup; не сначала загружать объект глобально, а потом раскрывать его существование.
- Prisma schema меняется только вместе с новой migration. Не редактируй уже применённые migrations.
- Миграции выполняются на старте API в production: избегай долгих блокировок и планируй backward-compatible переходы.
- Для фоновых операций явно решай, что фатально. Не оставляй сущность в `processing`, если retry выбирает только `failed`.
- Для filesystem/S3 операций сохраняй порядок «внешний результат подтверждён → DB ready → cleanup» либо документируй компенсирующий retry.
- На frontend используй относительные `/api/...` URL через существующий client; не зашивай внутренние Docker hostnames.
- Проверяй mobile/tablet layout, loading/error/empty states и анонимный режим публичных страниц.
- Не добавляй несуществующие Event/multistream/layout abstractions ради предполагаемого будущего.

## Команды

Установка и локальная разработка из корня:

```bash
pnpm install
pnpm dev:api
pnpm dev:web
```

Prisma schema находится в корне, но команды настроены в workspace API:

```bash
pnpm --filter api exec prisma generate
pnpm --filter api prisma:migrate
pnpm --filter api prisma:push   # только локальная разработка
```

Узкий цикл для backend-теста:

```bash
pnpm --filter api test -- --testPathPattern=<name>
```

Полная проверка, эквивалентная CI:

```bash
pnpm install --frozen-lockfile
pnpm --filter api exec prisma generate
pnpm --filter api build
pnpm --filter api test
pnpm --filter web exec tsc --noEmit
pnpm --filter web build
```

После любого изменения сначала запускай самые узкие релевантные проверки, затем полный набор по затронутой области. Для документации достаточно проверить diff/ссылки и выполнить `git diff --check`; отсутствие code tests укажи в отчёте. Frontend test suite не настроен, поэтому для UI обязательны `tsc`, build и по возможности browser smoke test.

## Production safety и Git

- Не запускай `docker compose up`, `down`, `restart` или production deploy только ради проверки. На production checkout это управляет живым сервисом.
- Любой diff в `infra/mediamtx/*` или `docker-compose.yml` требует рестарта MediaMTX и может оборвать ingest у всех стримеров. Отмечай это явно до merge.
- Обычный deploy перезапускает только `api` и `web` с `--no-deps`; MediaMTX, FFmpeg, PostgreSQL и MinIO не трогаются.
- Merge в `main` автоматически запускает production deploy. Не пушь напрямую в `main`.
- Этот checkout — изолированный Codex worktree; detached `HEAD` до создания рабочей ветки нормален. Не переключай и не изменяй основной пользовательский checkout.
- Для задач на изменение/реализацию по умолчанию выполняй полный автономный pipeline: рабочая ветка в текущем worktree → реализация → self-check → commit → push → PR в `main` → ожидание CI → squash merge → наблюдение за production deploy до финального результата.
- Для веток Codex по умолчанию используй `codex/<short-kebab-description>`, если пользователь не указал точное имя.
- После открытия PR подпишись на завершение checks (`gh pr checks <N> --watch` или эквивалент), не проси отдельного подтверждения на merge после зелёного CI.
- После merge найди workflow run для merge commit/main и дождись завершения deploy job (`gh run watch ...` или эквивалент). Задача с автодеплоем не считается полностью завершённой, пока итог выкатки не проверен.
- Явные указания пользователя «не пушить», «оставить PR на review», «не мержить» или «не ждать deploy» переопределяют соответствующую часть pipeline.
- Read-only задачи — анализ, ревью, объяснение, диагностика без просьбы исправить — не запускают commit/PR/merge pipeline.
- Красный CI, конфликт/неактуальный PR или live-safety FAIL — жёсткая остановка: не мержить, сначала диагностировать и исправить либо сообщить точный блокер.
- Не используй `force_mediamtx` и не перезапускай MediaMTX под эфиром без отдельного явного разрешения пользователя. Штатный deploy script должен сам закрыто обработать live-state.
- Если deploy после merge упал, изучи логи и сообщи фактическое состояние production. Не маскируй ошибку повторным ручным рестартом; безопасное исправление оформляй новым PR через тот же pipeline.
- Не добавляй `Co-Authored-By`, подписи Codex/Claude или attribution в commit/PR.
- Репозиторий использует squash merge. Не смешивай несколько независимых задач в один PR.
- `AGENTS.md` намеренно указан в `.gitignore`: это локальная инструкция Codex. Не форсируй его добавление в git без отдельной просьбы.

Файлы `.claude/agents/*`, `.claude/skills/*` и slash-команды описывают workflow Claude Code. Их проверки полезны как чек-лист, но отсутствие соответствующих Claude sub-agent инструментов не блокирует Codex: воспроизведи проверку непосредственно доступными командами и ревью diff.
