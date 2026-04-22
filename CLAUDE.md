# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack

- **Monorepo**: pnpm workspaces (`pnpm-workspace.yaml`)
- **Frontend** (`apps/web`): Next.js 14 + TypeScript + hls.js + React Query + Socket.io client
- **Backend** (`apps/api`): NestJS 10 + TypeScript + Prisma + JWT auth + Socket.io
- **Database**: PostgreSQL (via Prisma, schema at root `/prisma/schema.prisma`)
- **Media server**: MediaMTX (Docker) — SRT in → HLS out, per-org paths
- **Orchestration**: Docker Compose

## Common Commands

### Local development (without Docker)
```bash
pnpm install          # install all workspace dependencies
pnpm dev:web          # Next.js on :3000
pnpm dev:api          # NestJS on :3001
```

### Build
```bash
pnpm build:web        # build Next.js
pnpm build:api        # build NestJS
```

### Docker (full stack)
```bash
docker compose up -d --build
docker compose logs -f web
docker compose down
```

### Database (Prisma — run from `apps/api`)
```bash
pnpm prisma:migrate   # apply migrations (prisma migrate deploy)
pnpm prisma:generate  # regenerate client after schema changes
pnpm prisma:seed      # create superadmin user (reads SUPERADMIN_LOGIN/PASSWORD env)
```

### Tests (from `apps/api`)
```bash
pnpm test                                      # run all *.spec.ts
pnpm test -- --testPathPattern=auth            # run a single test file by name
pnpm test -- --watch                           # watch mode
```

## Architecture

```
vMix → SRT push → MediaMTX (:8890) → HLS (:8888) → /hls/live/<orgSlug>/index.m3u8
                       ↑ per-org path + ingestKey passphrase
                       |
Browser ← Next.js proxy (/hls/* /api/*) ← :3000
                ↕
          NestJS API (:3001) ↔ PostgreSQL
```

**Core principle**: One 4K 2×2 composite SRT stream per organization, zero server-side transcoding. A hidden `<video>` element decodes HLS; a `<canvas>` element renders the selected quadrant via `requestAnimationFrame` + `drawImage`.

### Multi-tenant model

Each **Organization** has:
- A unique `slug` (used as login and as stream path)
- An `ingestKey` (SRT passphrase), rotatable via API
- SRT stream ID: `publish:live/<orgSlug>`
- HLS URL: `/hls/live/<orgSlug>/index.m3u8`
- Multiple **Events** (status: `scheduled` → `live` → `ended`)
- Only one event can be `live` at a time per org

**Users** (only `superadmin` role) are separate from Organizations. Auth service tries `User` first, then `Organization` by slug.

### Prisma schema (`/prisma/schema.prisma`)
- `User` — superadmin accounts
- `Organization` — tenant with `ingestKey`, `passwordHash`, `isActive`
- `Event` — belongs to org; has `status`, `isPublic`, `previewKey` (for private events)
- `ChatMessage` — belongs to event

The schema is at the **repo root** (`/prisma/`), not inside `apps/api`. The `prisma` field in `apps/api/package.json` points there.

### API modules (`apps/api/src/`)

| Module | Route prefix | Auth |
|--------|-------------|------|
| `health` | `GET /health` | none |
| `auth` | `POST /v1/auth/login` | none |
| `admin` | `/v1/admin/*` | superadmin JWT |
| `org` | `/v1/org/*` | org_admin JWT |
| `public` | `/v1/public/*` | none |
| `chat` | WebSocket `/chat` namespace | none |

**JWT payload**: `{ sub, role: 'superadmin'|'org_admin', orgId?, orgSlug? }`
**Cookie**: `access_token` (HttpOnly) — set on login, read via `JwtAuthGuard`

### MediaMTX integration (`mediamtx.service.ts`)
- API base: `MEDIAMTX_API_URL` (default `http://localhost:9997`)
- On org create/key rotate: `POST /v3/config/paths/add/live/<slug>` with `srtPublishPassphrase`
- On org delete: `DELETE /v3/config/paths/delete/live/<slug>`
- MediaMTX API is enabled (unlike older config) — RTMP/RTSP/WebRTC remain disabled

### MatPlayer — canvas-based view switching (`apps/web/src/components/MatPlayer.tsx`)
- Hidden `<video>` (opacity: 0) decodes the HLS stream via hls.js (or native on iOS)
- Visible `<canvas>` renders the desired view each frame via `requestAnimationFrame`
- `drawContain` crops a source rectangle from the video and draws it letterboxed onto the canvas
- `QUAD` map: `{ cam1: [0,0], cam2: [1,0], cam3: [0,1], cam4: [1,1] }` — quadrant column/row offsets
- `multicam` → draws full video; `cam1`–`cam4` → crops the corresponding quarter (`vw/2 × vh/2`)
- `viewMode` is read via `modeRef` inside the draw loop to avoid restarting `rAF` on mode changes
- iOS fullscreen: canvas stream captured via `captureStream(30)` and played in a temporary `<video>` via `webkitEnterFullscreen`

### Next.js frontend routes (`apps/web/src/app/`)

| Route | Page |
|-------|------|
| `/` | Public catalog of live orgs |
| `/login` | Login for superadmin and org_admin |
| `/admin` | Superadmin dashboard (manage orgs/users) |
| `/dashboard` | Org dashboard (manage events, rotate key) |
| `/watch/[orgSlug]` | Public watch page with player and chat |

HTTP calls go through `apps/web/src/lib/api.ts` which uses relative URLs (proxied by Next.js).

### Next.js proxy rewrites (`apps/web/next.config.mjs`)
- `/hls/*` → `HLS_UPSTREAM` (default `http://mediamtx:8888`)
- `/api/*` → `API_UPSTREAM` (default `http://api:3001`)
- Frontend uses relative URLs; no hardcoded ports in browser code

### Chat (WebSocket)
- Socket.io server at `/chat` namespace on the NestJS port
- Client emits `join { eventId }` → receives `history` (recent messages) and `viewers` (count)
- Client emits `message { eventId, nickname, content }` → server broadcasts `message` to room
- Server emits `viewers` count on every join and disconnect
- Nickname stored in localStorage (`MatPlayer` / `NicknameModal`)

## Environment Variables

Copy `.env.example` to `.env`. Key variables:
- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — JWT signing secret
- `WEB_PORT`, `API_PORT` — host port mappings
- `HLS_UPSTREAM`, `API_UPSTREAM` — internal Docker URLs for Next.js proxy
- `MEDIAMTX_API_URL`, `MEDIAMTX_API_USER`, `MEDIAMTX_API_PASS` — MediaMTX control API
- `CORS_ORIGIN` — comma-separated allowed origins for the API
- `SUPERADMIN_LOGIN`, `SUPERADMIN_PASSWORD` — used by `prisma:seed`

## Frontend Design Skills

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

- **Do not** split into separate streams per camera — single composite SRT stream per org, client-side zoom only
- Private events use `previewKey` — watchers access via `?key=<previewKey>` query param
- Only one event per org can be `live` at a time (enforced in `OrgService.updateEvent`)
