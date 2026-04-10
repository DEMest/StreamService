# StreamService

Web-based multiview streaming platform for wrestling tournaments.

MVP architecture uses one 4K composite stream (2x2 mats), one MediaMTX pipeline, and one web player experience. The browser switches between quad and focused mat view with CSS transforms. No separate per-mat viewer streams are used.

## Directory structure

```text
apps/
  web/        Next.js + TypeScript player UI
  api/        NestJS + TypeScript API
infra/
  mediamtx/   MediaMTX local config
docs/
  architecture.md
  roadmap.md
docker-compose.yml
.env.example
```

## Prerequisites

- Node.js 20+
- corepack (bundled with modern Node)
- Docker Desktop (for MediaMTX)
- ffmpeg (for local test stream ingest)

## Install dependencies

Use `corepack pnpm` to avoid local PATH issues with `pnpm`:

```bash
corepack pnpm install
```

## Run web app

```bash
corepack pnpm --filter web dev
# http://localhost:3000
```

## Run API

```bash
corepack pnpm --filter api dev
# http://localhost:3001
# GET /health
# GET /events/current
```

## Run MediaMTX

```bash
docker compose up -d mediamtx
docker compose ps
```

Endpoints:

- HLS output: `http://localhost:8888/live/stream/index.m3u8`
- SRT ingest: `srt://localhost:8890`

## Push a local test stream with ffmpeg

```bash
ffmpeg -re -f lavfi -i "testsrc=size=1280x720:rate=30" \
  -f lavfi -i "sine=frequency=1000:sample_rate=48000" \
  -c:v libx264 -preset veryfast -tune zerolatency -pix_fmt yuv420p -g 60 \
  -c:a aac -b:a 128k -f mpegts \
  "srt://localhost:8890?streamid=publish:live/stream"
```

Then open:

- `http://localhost:8888/live/stream/index.m3u8` (playlist reachable)
- `http://localhost:3000` (video visible in player)

## WSL and Windows note

If ffmpeg runs in WSL and web runs on Windows, use the same reachable host for both sides:

- if `localhost:8888` works in Windows browser, keep `NEXT_PUBLIC_STREAM_URL=http://localhost:8888/live/stream/index.m3u8`
- if not, use WSL IP (from `hostname -I` in WSL), for example:
  `NEXT_PUBLIC_STREAM_URL=http://172.x.x.x:8888/live/stream/index.m3u8`

Restart web dev server after changing `NEXT_PUBLIC_STREAM_URL`.

## Environment variables

Copy `.env.example` to `.env` and adjust:

```bash
cp .env.example .env
```

| Variable | Default | Description |
|---|---|---|
| `API_PORT` | `3001` | NestJS API port |
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001` | API base URL for web |
| `NEXT_PUBLIC_STREAM_URL` | `http://localhost:8888/live/stream/index.m3u8` | HLS URL for web player |
| `MEDIAMTX_SRT_PORT` | `8890` | SRT ingest port |
| `MEDIAMTX_HLS_PORT` | `8888` | HLS output port |

## Implemented now

- pnpm workspace monorepo bootstrap
- Next.js player UI with quad and focus mode placeholders
- NestJS API with `/health` and `/events/current`
- MediaMTX local config for `SRT -> HLS`
- Docker Compose local service for MediaMTX

## Intentionally deferred

- Authentication and authorization
- Payments and subscriptions
- Chat and overlays
- Recording and archival
- Analytics dashboards
- CI/CD
- Kubernetes
