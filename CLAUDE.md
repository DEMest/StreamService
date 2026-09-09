# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack

- **Monorepo**: pnpm workspaces (`pnpm-workspace.yaml` → `apps/*`)
- **Frontend** (`apps/web`): Next.js 14 (App Router) + TypeScript + hls.js + React Query + Socket.io client
- **Backend** (`apps/api`): NestJS 10 + TypeScript + Prisma + JWT auth + Socket.io + `@nestjs/schedule` (cron)
- **Database**: PostgreSQL (via Prisma, schema at repo root `/prisma/schema.prisma`)
- **Media server**: MediaMTX (Docker) — SRT/RTMP in → FFmpeg-generated HLS on disk → served by the API
- **Media tooling**: FFmpeg / ffprobe (HLS generation, recording post-processing, downloads), `sharp` (thumbnails)
- **Object storage**: S3-compatible — archived recordings, org/stream images (`@aws-sdk/client-s3` + presigned URLs, see `storage/s3.service.ts`)
- **Orchestration**: Docker Compose

## Common Commands

### Local development (without Docker)
```bash
pnpm install          # install all workspace dependencies
pnpm dev:web          # Next.js on :3000 (filter web)
pnpm dev:api          # NestJS on :3001 (filter api; loads ../../.env via dotenv)
```

### Build
```bash
pnpm build:web        # build Next.js
pnpm build:api        # build NestJS (nest build)
```

### Docker (full stack)
```bash
docker compose up -d --build
docker compose logs -f web
docker compose down
```
Note: the `web` container bakes `NEXT_PUBLIC_*` at build time — after changing those env vars you must `docker compose build web`, not just restart. The compose file expects an **external** `edge` network (create it once: `docker network create edge`).

### Database (Prisma — run from `apps/api`, schema is at repo root)
```bash
pnpm prisma:migrate   # apply migrations (prisma migrate deploy)
pnpm prisma:generate  # regenerate client after schema changes
pnpm prisma:push      # db push (dev only, loads ../../.env)
pnpm prisma:seed      # create superadmin (reads SUPERADMIN_LOGIN/PASSWORD)
```
Migrations live in `prisma/migrations/`. One-off **data migrations** (idempotent backfills, separate from schema migrations) live in `prisma/data/` and run via:
```bash
pnpm prisma:migrate-data:populate-streams   # backfill default Stream rows for existing orgs
pnpm prisma:migrate-data:chat-to-stream     # migrate ChatMessage.orgId → streamId
```

### Tests (from `apps/api`, Jest + ts-jest, `rootDir: src`)
```bash
pnpm test                                   # run all *.spec.ts
pnpm test -- --testPathPattern=stream       # run a single test file by name
pnpm test -- --watch                        # watch mode
```
There is no wired lint script; tests are backend-only (no frontend test suite).

## Architecture

```
vMix / OBS ──SRT push (:8890) ─┐
            └─RTMP push (:1935)┤
                               ▼
                          MediaMTX (Docker)
                          • record: no in pathDefaults → включается на
                            конкретный путь через control API; пишет fmp4
                            в /recordings/%path
                          • hls: false   → NO built-in HLS muxer
                          • authMethod: http → POST /v1/internal/mediamtx/auth
                          • runOnReady    → on-ready.sh
                          • runOnNotReady → on-not-ready.sh
                               │
              on-ready.sh ─────┤ 1) POST webhook {action:publish, path}
              (per path)       │ 2) spawn FFmpeg: pull rtsp://localhost:8554/<path>,
                               │    write HLS .ts/.m3u8 into /hls/<path>  (shared volume)
                               ▼
                          /hls/<path>  (hls_data volume, also mounted in api)
                               │
Browser ◄── Next.js (:3000) ◄──┤ /api/* proxy
                               ▼
                          NestJS API (:3001)
                          • serves live HLS from /hls/live/... (with previewKey gating)
                          • redirects archive HLS-VOD to presigned S3 URLs
                          • REST + WebSocket (/chat)
                               ↕
                   PostgreSQL          MinIO / S3
                                       (архив записей, картинки)
```

**Core principle**: the *primary* feed is never re-split or re-composed on the server. The streamer pushes **one** feed — either a composite frame (e.g. a 2×2 mosaic) or a single camera — and the browser paints it onto a `<canvas>` via `requestAnimationFrame` + `drawImage`, cropping a quadrant when the viewer asks for one.

Transcoding exists only in the **delivery ladder**, and only for the copies: one FFmpeg process writes `hd/` as a stream copy (video `-c:v copy`, audio remuxed to AAC) plus `p720`/`p480`/`p240` via `libx264`. The whole ladder is gated by `HLS_LQ_ENABLED` — `false` leaves the `hd` copy alone (~1 core), `true` (default) adds the three x264 renditions (~7 cores on 4K input). Exact filters and flags: `infra/mediamtx/on-ready.sh`.

### The `Stream` is the central entity (not the Organization)

**`Stream`** — not `Organization` — owns the ingest key, live state, recording policy and recordings. An org is a tenant that contains Streams.

- Streams are created and deleted by the org admin through `StreamController` (`/v1/org/streams`). `AdminService.createOrg` creates **only the Organization** — a fresh org has no Streams.
- `slug` is required and non-empty. Legacy Streams with `slug = ''` still exist and keep the MediaMTX path `live/<orgSlug>` for vMix backward-compat; everything else maps to `live/<orgSlug>/<streamSlug>` (`mediamtxPathForStream` in `stream.service.ts`). **One ingest path per Stream** — there are no per-slot paths.
- `feedMode` (`'single' | 'composite'`, default `composite`) says what the single ingested frame contains: one camera, or a 2×2 mosaic the browser can crop. It is handed to the client in the watch DTO; the server never splits or re-composes the frame.
- Per-Stream fields: `ingestKey` (SRT passphrase / RTMP key, rotatable), `feedMode`, `previewMode` (default `multicam`), `isPublic` + `previewKey`, `previewImagePath`, `isLive`, `currentBroadcastId`, `recordingEnabled`, `recordingMode` (`auto`|`manual`).

**Tenancy**: all `/v1/org/*` endpoints filter by `user.orgId`; cross-tenant access returns **404** (existence is not leaked).

### Prisma schema (`/prisma/schema.prisma`, at repo root)
- `User` — superadmin and `ad_manager` accounts (login/passwordHash/role).
- `Organization` — tenant; holds `passwordHash`, `isActive`, `chatTtlMinutes`, `chatEnabled` (chat settings are still **org-level**).
- `Stream` — the core streaming unit (see above). `@@unique([orgId, slug])`, `ingestKey` unique. `autoStartMode` is still a column but nothing reads it — a later migration drops it.
- `Broadcast` — one live session of a Stream; created on publish, closed on unpublish. `pausedAt` marks a gap a following publish can glue onto (manual recording mode); `previewImagePath` is the S3 key of the recording's poster. Owns `Recording[]`.
- `Recording` — recording of a Broadcast (`@@unique([broadcastId, slotIndex])`; `slotIndex` is always `1` today and survives only as an archive/S3 path segment), with `status`, `manifestPath` (an S3 key), `fileSize` (BigInt — an hour at 6 Mbit/s overflows int4), `duration`, `expiresAt`.
- `ChatMessage` — scoped by `streamId`. `orgId` is **deprecated/nullable** (kept during the chat→stream data migration; final DROP is a later migration).
- `ContactRequest` — landing-page lead form submissions; `Feedback` — feedback-form submissions shown at `/admin/feedback`.
- `CapacitySample` / `CapacityIncident` — server capacity samples and detected incidents behind `/admin/capacity`.
- `Ad` / `AdEvent` — рекламные плейсхолдеры и обезличенные счётчики показов.
  `Ad.ownerId` → `User` (`onDelete: SetNull`) определяет, кто увидит
  объявление в `/admin/ads` (см. раздел про роли ниже). NULL — владелец
  удалён; такое объявление остаётся видно только рекламному менеджеру.

The `prisma` field in `apps/api/package.json` points the schema at the repo root.

### Ingest → HLS pipeline (the non-obvious core)

MediaMTX's built-in HLS server is **disabled** (`hls: false` in `infra/mediamtx/mediamtx.yml`). Live HLS is produced by FFmpeg launched from **`infra/mediamtx/on-ready.sh`** (`runOnReady`), and **served by the NestJS API**, not by MediaMTX:

1. **Auth** — MediaMTX calls `POST /v1/internal/mediamtx/auth` (`MediamtxWebhookController`). SRT publishes are accepted (passphrase is enforced by the SRT transport itself). **RTMP** publishes are validated against the Stream's `ingestKey` via `StreamService.verifyIngestKey`.
2. **on-ready.sh** (runs per published path): fires the `publish` webhook, then spawns FFmpeg to pull `rtsp://localhost:8554/<path>` and write HLS into `/hls/<path>` on the shared `hls_data` volume.
   - `master.m3u8` + `hd/` — video `-c:v copy`, audio remuxed to AAC. No transcode of the primary feed.
   - with `HLS_LQ_ENABLED=true` (the default) the **same** FFmpeg process also writes `p720/`, `p480/` and `p240/` via `libx264` (`-preset veryfast`, crf 25/26/28) — ~7 cores on a 4K input. `false` leaves only `hd/` (~1 core). Exact flags: `infra/mediamtx/on-ready.sh`.
3. **on-not-ready.sh** fires the `unpublish` webhook and `rm -rf /hls/<path>`.
4. **Webhook handler** — `POST /v1/internal/mediamtx/webhook` → `StreamService.handleWebhook(path, action)`. It resolves the path to a Stream (`resolvePathToStream`), and on `publish` creates a `Broadcast` (+ auto-enables recording if `recordingMode='auto'`); on `unpublish` it closes or pauses it. Concurrent webhooks per Stream are serialized by an in-process **per-streamId mutex** to avoid double-Broadcast races. The same call fires the SEO ping on an actual live-state change.
5. **Live HLS serving** — `RecordingController` serves `/v1/public/orgs/:orgSlug[/streams/:streamSlug]/live/hls/*` by streaming files from `/hls/live/...` on disk, enforcing `isPublic`/`previewKey` and path-traversal protection (`Cache-Control: no-store` because live segments rotate).


### Recording pipeline (`recording/`)
- Recording is **off** in MediaMTX's `pathDefaults`; the API turns it on for a specific path through the MediaMTX control API when the Stream has recording enabled. Segments are written as fmp4 to `/recordings/%path/...`.
- On Broadcast end, `RecordingService.onStreamEnded` runs **without any video transcode**: it gathers the fmp4 segments into a scratch dir, probes durations with **ffprobe**, builds the HLS-VOD playlist (`buildHlsVodPlaylist` / `buildMasterPlaylist` in `hls-vod.ts`) and a single concatenated `download.mp4` (FFmpeg `-c copy`), then uploads the whole `archive/<basePath>/<broadcastId>/` prefix to **S3** (`S3Service.uploadDirectory`). Local scratch is deleted only *after* a successful upload — otherwise a Recording would be marked ready with no object behind it. `Recording.manifestPath` holds the S3 key.
- Archive playback goes through `RecordingController` (`.../broadcasts/:broadcastId/recording/hls/*`): playlists are rewritten and served by the API, while the heavy bytes (segments, the MP4 download) are handed out as **302 redirects to presigned S3 URLs**, bypassing the API's own bandwidth.
- Cron (`@nestjs/schedule`): `cleanupExpired` at 03:00 (7-day `expiresAt`, drops the S3 prefix), `retryFailed` at 03:30, and `finalizeStaleGlue` every 5 minutes — a manual-mode Broadcast whose stream never came back is closed at the moment it dropped, not at the moment the cron noticed.

### API modules (`apps/api/src/`)

| Module | Route prefix | Auth |
|--------|-------------|------|
| `health` | `GET /health` | none |
| `auth` | `/v1/auth/*` (login, refresh, logout, me) | none / JWT |
| `admin` | `/v1/admin/*` (orgs, contact-requests) | superadmin JWT |
| `org` | `/v1/org/*` (profile, ingest-config, broadcasts, chat, preview upload) | org_admin JWT |
| `stream` | `/v1/org/streams/*` (CRUD, rotate-key, stop, recording) | org_admin JWT |
| `public` | `/v1/public/*` (catalog, watch, broadcasts, thumbnail, previews, contact, feedback) | none |
| `search` | `/v1/public/search` | none |
| `recording` | live + archive HLS serving, download | none (HLS) / org_admin JWT (download) |
| webhook controller (`org/mediamtx-webhook.controller.ts`) | `/v1/internal/mediamtx/{auth,webhook}` | shared secret (`MEDIAMTX_WEBHOOK_SECRET`) |
| `ads` | `/v1/admin/ads/*` (CRUD, баннеры, статистика), `/v1/public/ads/*` (активные объявления, картинки, события) | superadmin+ad_manager JWT / none |
| `seo` | `/v1/public/seo/{sitemap,page-meta}` | none |
| `capacity` | `/v1/admin/capacity` (ёмкость сервера), `/v1/public/qoe` (телеметрия плеера) | superadmin JWT / none |
| `chat` | WebSocket `/chat` namespace | none |
| `storage`, `stats`, `thumbnail`, `contact`, `feedback`, `notify`, `mediamtx` (control-API client), `prisma` | (internal services, no routes of their own) | — |

**Auth tokens & cookies** (`auth.controller.ts`):
- JWT payload: `{ sub, role: 'superadmin'|'org_admin'|'ad_manager', orgId?, orgSlug? }`.
- **Роль `ad_manager`** — рекламный менеджер, не администратор платформы.
  Живёт только на `ads.liga-live.ru` и открывает ровно одну страницу
  `/admin/ads`. Экран у неё **общий с суперадмином**, а выборка разная:
  менеджер видит всю рекламу платформы, суперадмин — только объявления со
  своим `Ad.ownerId`. Это бизнес-требование, а не разграничение прав, и
  решается оно в одном месте — `AdsService.seesEverything`. Чужое
  объявление суперадмину отдаётся как 404, по тому же принципу, что
  межтенантные проверки в `/v1/org/*`.
- Аккаунт менеджера **создаётся сам** при старте API, если его нет
  (`ads/ad-manager.bootstrap.ts`): логин `admanager`, пароль генерируется и
  уходит письмом на `MAIL_TO` плюс баннером в лог. Сброс — удалить строку из
  `User` и перезапустить API. Переменных окружения у этого нет намеренно:
  правка `docker-compose.yml` тянет за собой перезапуск MediaMTX с разрывом
  ингеста, а настраиваемый логин такой цены не стоит.
- Роль читается из строки `User.role`, а не подставляется литералом в
  `AuthService.login`. Зашитая константа там была ровно до тех пор, пока в
  таблице жил один суперадмин; вернув её, вы выдадите менеджеру полный
  доступ к админке.
- Cookies: `access_token` (HttpOnly, 1h) + `refresh_token` (HttpOnly, 90d). `POST /v1/auth/refresh` rotates both. `JwtAuthGuard` reads the access cookie; `apps/web/src/lib/api.ts` auto-refreshes once on a 401 and otherwise redirects to `/login`.
- `AuthService.login` tries `User` (superadmin) first, then `Organization` by slug (org_admin).
- On HTTP test stands set `COOKIE_SECURE=false`, otherwise the browser drops the cookie and `/v1/org/me` returns 401.
- **Админка суперадмина отвечает только на `admin.liga-live.ru`**: на основном
  домене `/admin` уезжает 301-м на поддомен, а `/api/v1/admin` отдаёт 404. Это
  не украшение, а единственный способ держать в одном браузере две сессии
  сразу: cookie ставятся без атрибута `domain`, то есть host-only, и на разных
  именах живут независимо. На одном домене второй вход просто перезаписывал бы
  первый. Обратная сторона того же свойства: перенести уже выданную сессию на
  соседнее имя нельзя. Суперадмин, вошедший на основном домене, доедет по
  редиректу до админки, но войти ему придётся там ещё раз — это цена
  разделения, а не недоработка. Клиентский код про хосты ничего не знает
  намеренно: топология описана только в конфиге nginx.
- **Исключение из правила «мерж = релиз»**: разделение живёт в
  `infra/deploy/nginx-streamservice.conf`, а его `deploy.sh` не копирует и не
  перезагружает. Пока конфиг не применён на сервере руками (порядок — в
  `infra/deploy/DEPLOY.md`), мерж в этой части не меняет ничего. В
  `docker-compose.yml` для поддомена нет ничего намеренно: любая правка compose
  тянет за собой перезапуск MediaMTX с разрывом ингеста.
- `apps/web/src/middleware.ts` проверяет **роль**, а не только валидность
  токена: `/admin` — суперадмин, `/dashboard` — организация, чужой раздел даёт
  редирект. Иначе страница чужого раздела отрисовывалась бы каркасом, сыплющим
  403 из API. Он же знает про топологию хостов: суперадмина с `/dashboard`
  уводит на `/`, а не в `/admin`, которого на этом имени нет.

### Chat (`chat/`) — one room per Stream
- `/chat` Socket.io namespace. Client emits `join { orgSlug, streamSlug? }`; `ChatService.resolveStreamId` maps that to a Stream and the socket joins `stream:<streamId>` (`chatRoomKey`). There is no cross-Stream room.
- Server emits `history`, `chat_ttl`, `chat_enabled`, `viewers`. `chatEnabled`/`chatTtlMinutes` remain org-level. Nickname is stored client-side (`NicknameModal` / localStorage).
- The gateway also owns the **viewer counter** per room, which `StreamService` reads for the dashboard's live stats — the socket count is the only viewer number the system has.

### Canvas layouts (`apps/web/src/lib/canvas-layout-presets.ts`) — frontend only
Laying out N live Streams of one org side by side on the org-overview canvas ("смотреть все вместе"). The backend neither stores nor validates this — it is **pure viewer-side UI state**, so there is no second copy to keep in sync. Every tile is treated as 16:9 and the container adapts its height, so a layout never stretches video into foreign proportions.

### MatPlayer — canvas compositing (`apps/web/src/components/MatPlayer.tsx`)
A hidden `<video>` decodes HLS via hls.js (native on iOS); a visible `<canvas>` is painted via `drawContain` (letterboxed crop). The `viewMode` prop picks what is drawn: `multicam` paints the whole ingested frame, `cam1`–`cam4` crop a quadrant of it through the `QUAD` map — which is what makes `feedMode: 'composite'` work without the server ever splitting the feed.

The player also reports what the delivery ladder is doing: `onRendition` gives the directory name of the current level (`hd`, `p720`…), and `onStall` / `onFragLoad` / `onAlive` feed the capacity metrics.

iOS fullscreen captures the canvas via `captureStream(30)` into a temporary `<video>` and calls `webkitEnterFullscreen`.

The org-overview canvas is a **separate** component (`OrgCanvasPlayer.tsx`), which paints several independent Streams of one org using the canvas layouts above.

### Next.js frontend routes (`apps/web/src/app/`)

| Route | Page |
|-------|------|
| `/` | Landing / public catalog of live orgs |
| `/login` | Login (superadmin + org_admin + ad_manager). Куда вести после входа, решает общая таблица разделов `apps/web/src/lib/sections.ts` — та же, что питает middleware и шапку |
| `/admin`, `/admin/requests`, `/admin/feedback`, `/admin/capacity` | Superadmin: orgs/users, contact requests, feedback, ёмкость сервера. **Отвечают только на `admin.<домен>`** — на основном домене nginx уводит 301-м (см. раздел про cookie выше) |
| `/admin/ads` | Управление рекламой. Единственная страница, отвечающая на **двух** именах: `admin.<домен>` (суперадмину — его объявления) и `ads.<домен>` (рекламному менеджеру — вся реклама платформы) |
| `/dashboard` | Org dashboard (streams, broadcasts, storage) |
| `/dashboard/streams/[id]` | One Stream: ingest instructions, recordings, preview upload |
| `/streams`, `/organizations`, `/archive`, `/search` | Public listings and search |
| `/faq`, `/legal/terms`, `/legal/privacy`, `/legal/copyright` | Static public pages |
| `/watch/[orgSlug]` | Watch default Stream |
| `/watch/[orgSlug]/[streamSlug]` | Watch a named Stream |
| `/watch/[orgSlug]/archive`, `/watch/[orgSlug]/[streamSlug]/archive` | Archive playback |

HTTP calls go through `apps/web/src/lib/api.ts` (relative URLs, proxied by Next.js; cookie auth + auto-refresh). Some `streamSlug` values are **reserved** (see `RESERVED_STREAM_SLUGS` in `stream.service.ts`) because they collide with frontend routes; purely numeric slugs are rejected too.

### Next.js proxy rewrites (`apps/web/next.config.mjs`)
- `/api/*` → `API_UPSTREAM` (default `http://api:3001`) — the only rewrite. Live HLS and archive playback both go through it (`/api/v1/public/...`); MediaMTX's own HLS port is never proxied, its muxer is off.

### SEO (`apps/api/src/seo/` + `apps/web/src/{lib/seo.ts,lib/json-ld.ts}`)

**Один источник правды — бэкенд.** Решение «пускать ли страницу в индекс»
живёт в `seo/popularity.ts` и одинаково питает и `sitemap.xml`, и мета-тег
`robots` на самой странице. Разъехавшись, они дали бы худший из вариантов:
карта сайта зовёт краулера туда, где страница просит его уйти.

- **Что индексируется.** Статика: `/`, `/streams`, `/organizations`,
  `/archive`, `/login` (логин намеренно — по нему ищут вход). Организации и
  стримы — только «живые»: идёт эфир **или** была хотя бы одна завершённая
  публичная трансляция. Пустая организация получает `noindex` и в sitemap не
  попадает: пачка тонких страниц роняет оценку сайта целиком. Приоритет по
  свежести — live 0.9 / эфир за 30 дней 0.7 / давние 0.5, страница стрима на
  0.1 ниже страницы организации.
- **Приватные стримы** (`isPublic=false`) не отдаются даже по имени:
  `/v1/public/seo/page-meta` возвращает для них `found: false`, а `robots.txt`
  закрывает `*?key=`.
- **`robots.txt` и `sitemap.xml`** — route handler'ы (`app/robots.txt/route.ts`,
  `app/sitemap.xml/route.ts`), а не файлы в `public/`: обеим нужен абсолютный
  адрес сайта, который известен только в рантайме. При недоступном API карта
  отдаёт статический минимум, а не 500.
- **Адрес сайта.** `SITE_URL` — основной источник, но `/watch/*` умеет без неё:
  эти страницы рендерятся на каждый запрос, поэтому берут хост из заголовков
  (`siteUrlForPage`) и сами задают `metadataBase`. Забытая переменная лишает
  абсолютных canonical только статические разделы, а не выключает JSON-LD и
  разметку целиком. Для пинга из API заголовков нет — там `SITE_URL`
  обязательна.
- **Метаданные страниц** задаются в `layout.tsx` каждого раздела (страницы
  остаются клиентскими) и в `generateMetadata` у `/watch/*` (там нужны данные
  из БД). Лендинг вынесен в route group `app/(landing)/` ради собственного
  canonical — в корневом `layout.tsx` его держать нельзя, он унаследуется
  всеми страницами без своего.
- **JSON-LD**: `WebSite`+`Organization` на всех страницах, `VideoObject` с
  `publication: BroadcastEvent` на странице трансляции. Это не украшение:
  Google Indexing API принимает только страницы с `BroadcastEvent` или
  `JobPosting`, и именно эта разметка делает пинг легальным.
- **Пинг поисковикам** (`seo-ping.service.ts`) дёргается из
  `StreamService.handleWebhookInternal` при фактической смене состояния эфира.
  IndexNow (Яндекс, Bing) получает страницу трансляции и списки; Google
  Indexing API — только страницу трансляции. Троттлинг 10 минут на URL спасает
  от «мигающего» ингеста и от суточной квоты Google (200 URL). Всё
  fire-and-forget: недоступный поисковик не должен влиять на эфир.
- **Ключ IndexNow** публичен по дизайну протокола и лежит в двух местах:
  константа в `indexnow.service.ts` и файл `apps/web/public/<ключ>.txt`.
  Меняете — меняйте оба.

## Environment Variables

Copy `.env.example` to `.env`. One compose file serves both prod and a test stand — the difference is just this file (ports, `COMPOSE_PROJECT_NAME`, public URLs). Key variables:
- `DATABASE_URL` — PostgreSQL connection string (compose builds it from `POSTGRES_PASSWORD`).
- `JWT_SECRET` — JWT signing secret.
- `WEB_PORT`, `API_PORT`, `POSTGRES_PORT`, `MEDIAMTX_SRT_PORT`, `MEDIAMTX_RTMP_PORT`, `MEDIAMTX_HLS_PORT`, `MEDIAMTX_API_PORT` — host port mappings.
- `API_UPSTREAM` — internal Docker URL for the Next.js proxy.
- `MEDIAMTX_API_URL`, `MEDIAMTX_API_USER`, `MEDIAMTX_API_PASS` — MediaMTX control API.
- `MEDIAMTX_WEBHOOK_SECRET` — shared bearer secret for the publish/unpublish webhook.
- `HLS_LQ_ENABLED` — `true` (default) adds the `p720`/`p480`/`p240` ladder via `libx264` (~7 cores on 4K input); `false` leaves only the `hd` stream copy (~1 core) — use it on dev/weak stands.
- `CORS_ORIGIN` — comma-separated allowed origins for the API (also used by the WS gateways).
- `COOKIE_SECURE` — override Secure flag for auth cookies (`false` on HTTP test stands).
- `NEXT_PUBLIC_*` (`SOCKET_URL`, `DEMO_VIDEO_URL`) — baked into the web bundle at build time.
- `INGEST_HOST` — host shown to streamers in the dashboard's SRT/RTMP instructions. **Leave empty** unless ingest is on a different host than the site: empty means the dashboard uses `window.location.hostname`, so moving to another domain needs no config change and no rebuild. Ports come from `MEDIAMTX_SRT_PORT` / `MEDIAMTX_RTMP_PORT`, which the `api` service also reads. Served at runtime via `GET /v1/org/ingest-config` (`apps/api/src/org/ingest-config.ts`) — deliberately *not* `NEXT_PUBLIC_*`, which would re-introduce the rebuild-on-move problem.
- `SUPERADMIN_LOGIN`, `SUPERADMIN_PASSWORD` — used by `prisma:seed` and auto-create on API boot.
- `SMTP_HOST`, `SMTP_PORT` (default `587`), `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`,
  `MAIL_FROM`, `MAIL_TO` — feedback-form notification email (`MailService`,
  `apps/api/src/notify/mail.service.ts`). Empty `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS`/`MAIL_TO` — feedback
  still saved to `/admin/feedback`, no email sent. `~/ops/notify.py` (server-side,
  outside the repo — шлёт письма о выкатке и недельный отчёт о состоянии
  сервера) reads the same variable names from its own `~/ops/notify.env`, not
  from this `.env`; на сервере обе конфигурации держат один и тот же ящик.

  **Почта домена живёт на почтовом хостинге регистратора — своего MTA в стеке
  нет.** Здесь был `postfix`-релей (`infra/postfix/`), и его убрали: у домена
  уже стоял MX на хостинг, а с ним готовые DKIM и DMARC и прогретая репутация
  отправляющего IP. Свой релей потребовал бы PTR-записи, открытого исходящего
  25 порта (провайдеры режут его по умолчанию) и собственного приёма входящей —
  всё это ради нескольких служебных писем в день. Рабочие значения:
  `SMTP_HOST=mail.hosting.reg.ru`, `SMTP_PORT=587` (STARTTLS; `465` — SSL,
  тогда `SMTP_SECURE=true`), `SMTP_USER` и `MAIL_FROM` — **полный** адрес
  ящика (`notify@liga-live.ru`): логином служит адрес целиком, не локальная
  часть.

  Пароль ящика лежит в `.env`, который разбирает docker compose, поэтому в нём
  **не должно быть `$` и `#`** — первый читается как подстановка переменной,
  второй начинает комментарий, и пароль тихо приедет обрезанным.

  Публичный контакт домена — `info@liga-live.ru` (псевдонимы `postmaster@`,
  `abuse@`, `support@` ведут туда же). Он стоит в правовых документах
  (`apps/web/src/lib/legal.ts`), а копии писем пересылаются на личную почту
  владельца. Настраивается это в панели хостинга, в репозитории следов нет.
- `SITE_URL` — публичный адрес сайта (`https://liga-live.ru`). Нужен трём
  вещам: ссылка в письме обратной связи, абсолютные URL в
  sitemap/robots/canonical и пинг поисковикам. Единственная переменная,
  которую `web` получает **и как build-arg, и в рантайме**: Next.js фиксирует
  `metadataBase` при пререндере статических страниц, поэтому без build-arg
  canonical и og:url у лендинга остались бы относительными. Пусто или
  localhost — SEO-пинг выключен (dev-стенд поисковики не трогает).
- `GOOGLE_SITE_VERIFICATION`, `YANDEX_VERIFICATION` — коды подтверждения прав
  мета-тегом; пусты при подтверждении через DNS. Тоже build-args `web`: тег
  должен попасть в статически отрендеренный HTML.
- `INDEXNOW_KEY` — переопределение ключа IndexNow. Обычно пусто: ключ по
  умолчанию зашит в `seo/indexnow.service.ts` и лежит файлом в
  `apps/web/public/`. Меняя — меняйте оба места.
- `GOOGLE_INDEXING_CREDENTIALS` — JSON сервис-аккаунта Google Cloud (как есть
  или в base64) для Indexing API. Пусто — Google узнаёт о новых страницах
  только из sitemap.xml, остальное продолжает работать.
- `UPLINK_MBPS` — ширина исходящего канала сервера, Мбит/с (по умолчанию 750).
  Единственное число во всей подсистеме метрик, которое неоткуда измерить: от
  него считается и заполнение канала, и потолок по зрителям, поэтому ошибка
  здесь смещает вывод о необходимости CDN целиком.
- `CAPACITY_HEADROOM` — доля канала под ингест, чат и всплески (0.2). Потолок
  считается от остатка.
- `NGINX_LOG_PATH` — лог nginx, размеченный под метрики. Формат задан в
  `apps/api/src/capacity/nginx-log.ts` (`CAPACITY_LOG_FORMAT`) и **обязан
  совпадать** с `log_format capacity` в `infra/deploy/nginx-streamservice.conf`:
  разъехавшись, они молча дадут нулевые метрики без единой ошибки. Том с логом
  общий с внешним стеком nginx — разовая настройка описана в
  `docs/capacity-metrics-setup.md`.
- `CAPACITY_DEMO` — `true` подставляет на экран ёмкости синтетическую
  нагрузку. Только для стенда: выдуманный потолок опаснее отсутствующего,
  поэтому экран помечает такие данные.
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` — дублирование тревог об инцидентах
  в телеграм. Пусто — уходят только письмом через SMTP.

## Frontend Design Skills

> **Note:** the skill files listed below are **not currently in the repository.**
> They were lost under the old blanket `.claude/` ignore rule (now narrowed — see
> `.gitignore`). Until they are restored, treat the overrides underneath as the
> binding part of this section and ignore the file paths.

When working on frontend code (`apps/web`), always apply the design instructions from:
- `.claude/skills/taste-skill.md` — core design framework (typography, color, layout, motion, anti-patterns)
- `.claude/skills/output-skill.md` — complete code output, no truncation or placeholders

**Project-specific overrides** for taste-skill baseline:
- DESIGN_VARIANCE: 6 (functional streaming app, not a creative portfolio)
- MOTION_INTENSITY: 4 (smooth but not distracting — users are watching streams)
- VISUAL_DENSITY: 5 (balanced: dashboard pages can be denser, public/watch pages lighter)

Additional skills are available on request in `.claude/skills/`:
- `redesign-skill.md` — audit and upgrade existing pages
- `soft-skill.md` — luxury soft UI aesthetic
- `minimalist-skill.md` — editorial Notion-inspired style
- `brutalist-skill.md` — Swiss typographic + terminal aesthetic
- `gpt-taste.md` — Awwwards-level GSAP motion
- `stitch-skill.md` — generate DESIGN.md for Google Stitch

## Product Constraints

- **Single ingest per Stream, client-side compositing only.** One feed per Stream — `feedMode` only says whether that frame is a single camera or a mosaic. Never re-split or re-compose the primary feed server-side; the browser canvas crops and lays out. The delivery ladder (`p720`/`p480`/`p240`) transcodes *copies*, never the primary feed.
- A Stream that is currently live cannot be deleted — stop the broadcast first (`POST /v1/org/streams/:id/stop`).
- Private Streams use `previewKey`; watchers/HLS access them via `?key=<previewKey>`.
- Stream slugs are validated: lowercase alphanumeric + single dashes, ≤32 chars, not reserved, not purely numeric.
- Canvas layouts live only in `apps/web` — do not add a backend copy to "validate" them.

## Git flow

- **Never push directly to `main`.** Branch → PR → green CI → merge.
- Branch naming follows what's already in the repo: `feat/`, `fix/`, `chore/`,
  `ci/`, `infra/` + kebab-case description.
- **No `Co-Authored-By` or any Claude signature** in commits or PRs. This is
  already configured in `.claude/settings.json` (`attribution.commit` /
  `attribution.pr` set to `""`) — do not override it by hand.
- **Merging is autonomous.** Once the self-check below passes and the PR is
  open: wait for green CI (`gh pr checks <N> --watch`) and merge it yourself
  (`gh pr merge <N> --squash --delete-branch`). Do not ask "shall I merge?" on
  every task — this is the default for any session in this repository. It is
  overridden by an explicit request in a given session ("don't merge, leave it
  for review") and by the two hard stops below.
- **Hard stop 1 — red CI.** Never merge something broken. Stop and report.
- **Hard stop 2 — `live-safety-auditor` returned FAIL.** See Deployment below.
- Merge PRs **one at a time**, waiting for each deploy to finish before merging
  the next. Two merges in quick succession produce two overlapping deploys.

## Mandatory self-check before considering a task done

No manual checks needed — there are dedicated sub-agents in `.claude/agents/`
for this. After any code change in this project:

1. `task-completion-validator` — always.
2. `qa-browser-tester` — if `apps/web` changed.
3. `claude-md-compliance` — always.
4. `code-quality-pragmatist` — for non-trivial changes.
5. `live-safety-auditor` — **always, before merging.** Merging deploys to a
   production server that is usually mid-broadcast.

A task is not done until every applicable agent returns PASS (a WARN from
`live-safety-auditor` is acceptable — a FAIL is not).

## Deployment

Merging to `main` triggers the `deploy` job in `.github/workflows/ci.yml`,
which reaches this server over Tailscale and runs `infra/deploy/deploy.sh`.

What that means for how you work:

- **A merge is a production release.** There is no separate "deploy" step you
  or the user perform afterwards.
- The deploy rebuilds and restarts **`api` and `web`, with `--no-deps`**.
  MediaMTX is left alone by default, so live ingest, the FFmpeg ABR ladder and
  recording all continue uninterrupted across a deploy.
- The one visible effect is that live HLS delivery pauses for the ~5 s the API
  takes to restart (it serves HLS itself). With 2 s segments and an 80 s
  playlist window, plus nginx serving stale on upstream error, viewers normally
  do not notice and **broadcasts do not end**.
- Changes to `infra/mediamtx/*` or to `docker-compose.yml` (**any** hunk — the
  script matches the filename, not the section) only take effect on a MediaMTX
  restart, which drops every publisher. `mediamtx.yml` is bind-mounted rather
  than baked into the image, so the restart must be `--force-recreate`: a
  config-only change leaves the image ID untouched and plain `up -d` would
  silently skip the container. `deploy.sh` checks the diff on every run that
  has a `.deployed` baseline, and picks one of three branches:
  - **no live streams** → MediaMTX is rebuilt and restarted along with the rest;
  - **streams live, `FORCE_MEDIAMTX=1`** → restarted anyway, ingest is cut,
    publishers must reconnect. Trigger it from Actions → CI → Run workflow →
    `force_mediamtx`, or on the server directly;
  - **streams live, no force** → the deploy **aborts and changes nothing**,
    naming both ways out. The next push retries it.
  On the very first deploy there is no `.deployed` to diff against, so MediaMTX
  is left alone and a warning is logged. `live-safety-auditor` flags the same
  case at PR time.
- Migrations run on API boot (`prisma migrate deploy`), so a slow or locking
  migration directly extends the HLS pause.

## Parallel development (several features at once)

If the user describes several independent tasks in one go — don't wait for a
special command. Decide yourself: if the tasks are small and spinning up
separate worktrees isn't worth it, do them sequentially in this session under
the rules above. If there are several and each is a self-contained piece of
work, start the orchestration:

    /parallel-feature <free-form text: one or several tasks>

Better to run this from a fresh Claude Code session rather than one with a long
history — the whole context budget of the new session goes into orchestration.

The same orchestrator runs both via this explicit command and on its own when a
session decides the task looks like it — but in the second case the model
cannot invoke the slash command programmatically
(`disable-model-invocation: true` on the skill blocks this deliberately):
instead, read `.claude/skills/parallel-feature/SKILL.md` and follow its steps in
the current session. Exception — if your own history is already large: don't
spend it on orchestration, tell the user to run `/parallel-feature` in a fresh
session and wait for their answer.

## Working in this checkout

`/home/rootuser/StreamService` on the production server is not just a source
tree — it is the working directory of the live stack. Never run
`docker compose up / down / restart` from here to "check" something; those
commands hit liga-live.ru and its viewers. Verify with builds and tests, and
leave deployment to the autodeploy job.

Those container-lifecycle denies live in `.claude/settings.local.json`, which
is gitignored and exists **only on the server**, not in `settings.json`. The
reason is that they are a property of this checkout, not of the project: on a
developer machine the same commands are the documented way to run the stack,
and a repo-level `deny` cannot be re-allowed locally. If you clone this repo
onto another host that serves live traffic, copy that file across.
