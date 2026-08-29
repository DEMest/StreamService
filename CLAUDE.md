# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack

- **Monorepo**: pnpm workspaces (`pnpm-workspace.yaml` → `apps/*`)
- **Frontend** (`apps/web`): Next.js 14 (App Router) + TypeScript + hls.js + React Query + Socket.io client
- **Backend** (`apps/api`): NestJS 10 + TypeScript + Prisma + JWT auth + Socket.io + `@nestjs/schedule` (cron)
- **Database**: PostgreSQL (via Prisma, schema at repo root `/prisma/schema.prisma`)
- **Media server**: MediaMTX (Docker) — SRT/RTMP in → FFmpeg-generated HLS on disk → served by the API
- **Media tooling**: FFmpeg / ffprobe (HLS generation, recording post-processing, downloads), `sharp` (thumbnails)
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
                          • record: yes  → fmp4 segments to /recordings/%path
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
                          • serves archive HLS-VOD from /recordings/archive/...
                          • REST + WebSocket (/chat, /studio)
                               ↕
                          PostgreSQL
```

**Core principle**: zero server-side video transcoding of the *primary* feed. The streamer pushes either one composite frame (e.g. a 2×2 mosaic) or N independent camera feeds; the browser composes the final view on a `<canvas>` via `requestAnimationFrame` + `drawImage`. (The only transcode is an optional 540p **LQ** rendition for mobile, gated by `HLS_LQ_ENABLED`, and AAC audio remux — see `on-ready.sh`.)

### The `Stream` is the central entity (not the Organization)

The schema was refactored so that **`Stream`** — not `Organization` — owns the ingest key, mode, slots, layout, live state, and recordings. An org is now a tenant that contains one or more Streams.

- Every **Organization** gets a **default Stream** with `slug = ''` created atomically in `AdminService.createOrg` (and protected from deletion). Its MediaMTX path stays `live/<orgSlug>` for vMix backward-compat.
- Orgs may have additional **named Streams** (`slug != ''`), created/deleted via `StreamController` (`/v1/org/streams`).
- Each Stream has a `mode`:
  - **`composite`** — one ingest feed, `slotCount = 1`. Path `live/<org>[/<streamSlug>]`. The browser crops quadrants (legacy 2×2) or shows it whole.
  - **`multistream`** — N independent feeds (`slotCount` 1–4), one MediaMTX path **per slot**: `live/<org>[/<streamSlug>]/<n>`. The browser composes slots onto the canvas using a **layout preset**.
- Per-Stream fields: `ingestKey` (SRT passphrase / RTMP key, rotatable), `slots` (Json), `slotOrder` (Json), `layoutPreset`, `fallbackLayouts` (Json), `isPublic` + `previewKey`, `previewMode`, `isLive`, `currentBroadcastId`, `recordingEnabled`, `recordingMode` (`auto`|`manual`), `autoStartMode` (`public`|`test`).

**Tenancy**: all `/v1/org/*` endpoints filter by `user.orgId`; cross-tenant access returns **404** (existence is not leaked). `StreamController`, `EventController`, etc. all follow this.

### Prisma schema (`/prisma/schema.prisma`, at repo root)
- `User` — superadmin accounts (login/passwordHash/role).
- `Organization` — tenant; holds `passwordHash`, `isActive`, `chatTtlMinutes`, `chatEnabled` (chat settings are still **org-level**).
- `Stream` — the core streaming unit (see above). `@@unique([orgId, slug])`, `ingestKey` unique.
- `Event` — belongs to org; M:N to Streams via `EventStream`. Lifecycle is timestamp-driven: **active = `startedAt != null && endedAt == null`** (there is no `status` enum / `isLive` column on Event).
- `EventStream` — join table (eventId + streamId).
- `Broadcast` — one live session of a Stream; created on first publish, closed on last unpublish. Optionally linked to the Stream's active Event. Owns `Recording[]`.
- `Recording` — per-slot recording of a Broadcast (`@@unique([broadcastId, slotIndex])`), with `status`, `manifestPath`, `expiresAt`.
- `ChatMessage` — scoped by `streamId` and/or `eventId`. `orgId` is **deprecated/nullable** (kept during the chat→stream data migration; final DROP is a later migration).
- `ContactRequest` — landing-page lead form submissions.

The `prisma` field in `apps/api/package.json` points the schema at the repo root.

### Ingest → HLS pipeline (the non-obvious core)

MediaMTX's built-in HLS server is **disabled** (`hls: false` in `infra/mediamtx/mediamtx.yml`). Live HLS is produced by FFmpeg launched from **`infra/mediamtx/on-ready.sh`** (`runOnReady`), and **served by the NestJS API**, not by MediaMTX:

1. **Auth** — MediaMTX calls `POST /v1/internal/mediamtx/auth` (`MediamtxWebhookController`). SRT publishes are accepted (passphrase is enforced by the SRT transport itself). **RTMP** publishes are validated against the Stream's `ingestKey` via `StreamService.verifyIngestKey`.
2. **on-ready.sh** (runs per published path): fires the `publish` webhook, then spawns FFmpeg to pull `rtsp://localhost:8554/<path>` and write HLS into `/hls/<path>` on the shared `hls_data` volume.
   - composite path → `master.m3u8` + `hd/` (+ optional `lq/` 540p `libx264` rendition when `HLS_LQ_ENABLED=true`).
   - multistream slot path (numeric last segment) → a single rendition directly in the slot dir (client composes slots).
3. **on-not-ready.sh** fires the `unpublish` webhook and `rm -rf /hls/<path>`.
4. **Webhook handler** — `POST /v1/internal/mediamtx/webhook` → `StreamService.handleWebhook(path, action)`. It resolves the path to `{stream, slotIndex}` (`resolvePathToStream`), updates in-memory `SlotState`, and on the **first** publishing slot creates a `Broadcast` (+ auto-enables recording if `recordingMode='auto'`); on the **last** unpublish it closes the Broadcast. Concurrent webhooks per Stream are serialized by an in-process **per-streamId mutex** to avoid double-Broadcast races.
5. **Live HLS serving** — `RecordingController` serves `/v1/public/orgs/:orgSlug[/streams/:streamSlug]/live/hls/*` by streaming files from `/hls/live/...` on disk, enforcing `isPublic`/`previewKey` and path-traversal protection (`Cache-Control: no-store` because live segments rotate).

> The Next.js `/hls/*` → `mediamtx:8888` rewrite still exists in `next.config.mjs` but is effectively legacy now that MediaMTX's HLS muxer is off; the watch UI fetches live HLS through `/api/v1/public/...`.

### Recording pipeline (`recording/`)
- MediaMTX records natively (`record: yes`, `recordFormat: fmp4`, 3h segments) to `/recordings/%path/...`.
- On Broadcast end, `RecordingService.onStreamEnded` runs **without any transcode**: it moves fmp4 segments into `/recordings/archive/<path>/<broadcastId>/slot-<n>/`, probes durations with **ffprobe**, and builds HLS-VOD playlists (`buildHlsVodPlaylist` / `buildMasterPlaylist` in `hls-vod.ts`). Composite → 1 slot; multistream → one slot dir per published slot, all referenced from a shared `master.m3u8`.
- Archive HLS is served by `RecordingController` (`.../broadcasts/:broadcastId/recording/hls/*`). Download (`/v1/org/broadcasts/:id/recording/download`) concatenates slot-1 segments with FFmpeg `-c copy` into a streamed MP4.
- Cron (`@nestjs/schedule`): `cleanupExpired` at 03:00 (7-day `expiresAt`), `retryFailed` at 03:30; orphan archive dirs are swept on boot.

### API modules (`apps/api/src/`)

| Module | Route prefix | Auth |
|--------|-------------|------|
| `health` | `GET /health` | none |
| `auth` | `/v1/auth/*` (login, refresh, logout, me, verify) | none / JWT |
| `admin` | `/v1/admin/*` (orgs, contact-requests) | superadmin JWT |
| `org` | `/v1/org/*` (profile, ingest-config, broadcasts, chat, preview upload) | org_admin JWT |
| `stream` | `/v1/org/streams/*` (CRUD, rotate-key, stop, recording) | org_admin JWT |
| `event` | `/v1/org/events/*` (CRUD, start/end, attach/detach streams) | org_admin JWT |
| `public` | `/v1/public/*` (catalog, watch, broadcasts, thumbnail, event landing, contact) | none |
| `recording` | live + archive HLS serving, download | none (HLS) / org_admin JWT (download) |
| `mediamtx` (webhook) | `/v1/internal/mediamtx/{auth,webhook}` | shared secret (`MEDIAMTX_WEBHOOK_SECRET`) |
| `seo` | `/v1/public/seo/{sitemap,page-meta}` | none |
| `chat` | WebSocket `/chat` namespace | none |
| `studio` | WebSocket `/studio` namespace | org_admin JWT cookie |
| `thumbnail`, `contact`, `prisma` | (internal services) | — |

**Auth tokens & cookies** (`auth.controller.ts`):
- JWT payload: `{ sub, role: 'superadmin'|'org_admin', orgId?, orgSlug? }`.
- Cookies: `access_token` (HttpOnly, 1h) + `refresh_token` (HttpOnly, 90d). `POST /v1/auth/refresh` rotates both. `JwtAuthGuard` reads the access cookie; `apps/web/src/lib/api.ts` auto-refreshes once on a 401 and otherwise redirects to `/login`.
- `AuthService.login` tries `User` (superadmin) first, then `Organization` by slug (org_admin).
- On HTTP test stands set `COOKIE_SECURE=false`, otherwise the browser drops the cookie and `/v1/org/me` returns 401.

### Studio gateway + SlotState (`studio/`, `stream/slot-state.service.ts`)
- `StudioGateway` (`/studio` namespace, org_admin only via JWT cookie) powers the streamer's live console. Client emits `join { streamId }`; server validates org ownership, joins room `studio:<streamId>`, sends a snapshot, then forwards live `slotState` events.
- `SlotStateService` is an **in-memory** `EventEmitter` map of per-slot `{ isPublishing, bitrate, lastPublishAt, ... }`. It is written by the publish/unpublish webhook handler. On API boot it **reconciles** from MediaMTX (`listActivePublishers` checks `paths/list` + runtime `srtconns/list`/`rtspsessions/list`/`rtmpconns/list`) so a mid-broadcast restart doesn't blank the Studio UI. It has a circular dependency with `StreamService`, broken with `forwardRef`.

### Chat (`chat/`) — scope-based rooms
- `/chat` Socket.io namespace. Client emits `join { orgSlug, streamSlug? }`; `ChatService.resolveScope` returns either an **event scope** (`event:<eventId>` — all Streams of an *active* Event share one room) or a **stream scope** (`stream:<streamId>` — standalone Stream or Stream in an ended Event).
- The scope is **re-resolved on every `message`** (not just at join) because an `Event.start`/`end` mid-session changes which room a Stream belongs to; the gateway migrates the socket between rooms accordingly.
- Server emits `history`, `chat_ttl`, `chat_enabled`, `viewers`. `chatEnabled`/`chatTtlMinutes` remain org-level. Nickname is stored client-side (`NicknameModal` / localStorage).

### Layout presets (`stream/layout-presets.ts` + `apps/web/src/lib/layout-presets.ts`)
The set of multistream layouts (`solo`, `side-by-side`, `stacked`, `pip-main`, `pyramid`, `left-main`, `row`, `grid-2x2`, `main-right-3`, `main-pip-3`) is defined on **both** backend and frontend. `pickLayout({ layoutPreset, fallbackLayouts, activeCount })` chooses a preset for the current number of *active* slots (streamer choice → configured fallback → system default by count). Backend uses it for validation; `MatPlayer` uses it to position slots on the canvas. **Keep the two copies in sync** when adding/changing presets.

### MatPlayer — canvas compositing (`apps/web/src/components/MatPlayer.tsx`)
A hidden `<video>` (or several) decodes HLS via hls.js (native on iOS); a visible `<canvas>` is painted each frame via `requestAnimationFrame` + `drawContain` (letterboxed crop). Three prop shapes:
- **legacy/composite** — single composite feed; `QUAD` map crops a quadrant (`cam1`–`cam4`) or draws the whole frame (`multicam`).
- **multistream** — N feeds + `slots` + `layoutPreset`/`fallbackLayouts`; positions come from `pickLayout`. Only `activeSlotIndexes` are drawn, so the layout adapts to how many cameras are actually live.

iOS fullscreen captures the canvas via `captureStream(30)` into a temporary `<video>` and calls `webkitEnterFullscreen`.

### Next.js frontend routes (`apps/web/src/app/`)

| Route | Page |
|-------|------|
| `/` | Landing / public catalog of live orgs |
| `/login` | Login (superadmin + org_admin) |
| `/admin`, `/admin/requests` | Superadmin: orgs/users, contact requests |
| `/dashboard` | Org dashboard (streams, events, broadcasts) |
| `/dashboard/streams/[id]/studio` | Streamer Studio console (uses `/studio` WS) |
| `/streams`, `/organizations`, `/archive` | Public listings |
| `/watch/[orgSlug]` | Watch default Stream |
| `/watch/[orgSlug]/[streamSlug]` | Watch a named Stream |
| `/watch/[orgSlug]/archive`, `/watch/[orgSlug]/[streamSlug]/archive` | Archive playback |
| `/event/[orgSlug]/[eventSlug]` | Public Event landing |

HTTP calls go through `apps/web/src/lib/api.ts` (relative URLs, proxied by Next.js; cookie auth + auto-refresh). Some `streamSlug` values are **reserved** (see `RESERVED_STREAM_SLUGS` in `stream.service.ts`) because they collide with frontend routes; purely numeric slugs are also rejected (they collide with slot path segments).

### Next.js proxy rewrites (`apps/web/next.config.mjs`)
- `/api/*` → `API_UPSTREAM` (default `http://api:3001`)
- `/hls/*` → `HLS_UPSTREAM` (default `http://mediamtx:8888`) — legacy; live HLS now flows through `/api/v1/public/...`.

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
- `HLS_UPSTREAM`, `API_UPSTREAM` — internal Docker URLs for the Next.js proxy.
- `MEDIAMTX_API_URL`, `MEDIAMTX_API_USER`, `MEDIAMTX_API_PASS` — MediaMTX control API.
- `MEDIAMTX_WEBHOOK_SECRET` — shared bearer secret for the publish/unpublish webhook.
- `HLS_LQ_ENABLED` — `true` (default) adds a 540p LQ rendition via `libx264` (~7 cores on 4K input); set `false` on dev/weak stands for HD-copy only.
- `CORS_ORIGIN` — comma-separated allowed origins for the API (also used by the WS gateways).
- `COOKIE_SECURE` — override Secure flag for auth cookies (`false` on HTTP test stands).
- `NEXT_PUBLIC_*` (`SOCKET_URL`, `DEMO_VIDEO_URL`) — baked into the web bundle at build time.
- `INGEST_HOST` — host shown to streamers in the dashboard's SRT/RTMP instructions. **Leave empty** unless ingest is on a different host than the site: empty means the dashboard uses `window.location.hostname`, so moving to another domain needs no config change and no rebuild. Ports come from `MEDIAMTX_SRT_PORT` / `MEDIAMTX_RTMP_PORT`, which the `api` service also reads. Served at runtime via `GET /v1/org/ingest-config` (`apps/api/src/org/ingest-config.ts`) — deliberately *not* `NEXT_PUBLIC_*`, which would re-introduce the rebuild-on-move problem.
- `SUPERADMIN_LOGIN`, `SUPERADMIN_PASSWORD` — used by `prisma:seed` and auto-create on API boot.
- `SMTP_HOST`, `SMTP_PORT` (default `587`), `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`,
  `MAIL_FROM`, `MAIL_TO` — feedback-form notification email (`MailService`,
  `apps/api/src/notify/mail.service.ts`). Empty `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS`/`MAIL_TO` — feedback
  still saved to `/admin/feedback`, no email sent. `~/ops/notify.py` (server-side,
  outside the repo — sends deploy notifications) reads the same variable names
  from its own `~/ops/notify.env`, not from this `.env`.
- `MAIL_DOMAIN` (default `liga-live.ru`), `MAIL_HOSTNAME` (default
  `relay.liga-live.ru`), `DKIM_SELECTOR` (default `mail`) — config for the
  self-hosted outbound-only SMTP relay (`postfix` service, `infra/postfix/`).
  `SMTP_USER` for this relay must be an email on `MAIL_DOMAIN` (e.g.
  `notify@liga-live.ru`) — the relay's SASL realm is `MAIL_DOMAIN`, and a
  mismatched domain in `SMTP_USER` fails auth with `535`.
- `SMTP_RELAY_PORT` (default `2587`) — host-side (`127.0.0.1` only, like
  `MINIO_API_PORT`) port mapping to the `postfix` relay's submission port, so
  `~/ops/notify.py` on the host (outside the docker network) can also send
  through it.
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

- **Single ingest per Stream, client-side compositing only.** Either one composite feed (`composite` mode) or N per-camera feeds (`multistream` mode); never re-split or transcode the primary feed server-side. The browser canvas does the final composition.
- The **default Stream** (`slug=''`) of every org is created with the org and cannot be deleted on its own (only via org deletion).
- A Stream that is currently live cannot be deleted — stop the broadcast first (`POST /v1/org/streams/:id/stop`).
- Private Streams use `previewKey`; watchers/HLS access them via `?key=<previewKey>`.
- Stream slugs are validated: lowercase alphanumeric + single dashes, ≤32 chars, not reserved, not purely numeric.
- Keep `layout-presets.ts` in sync between `apps/api` and `apps/web`.

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
