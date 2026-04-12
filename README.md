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

## One-command server start (recommended)

1. Copy `.env.example` to `.env` and adjust ports if needed.
2. Run:

```bash
docker compose up -d --build
```

Services:

- Web UI: `http://<server-ip>:3000`
- API: `http://<server-ip>:3001`
- HLS: `http://<server-ip>:8888/live/stream/index.m3u8`
- SRT ingest from vMix: `srt://<server-ip>:8890?streamid=publish:live/stream`

Stop stack:

```bash
docker compose down
```

## vMix to server pipeline

In vMix stream settings:

- Enable SRT: `on`
- Type: `Caller`
- Hostname: `<server-ip>`
- Port: `8890`
- Stream ID: `publish:live/stream`

Then open `http://<server-ip>:3000` and switch `Quad/Focus`, `Mat 1..4` in UI.

## Environment variables

```bash
cp .env.example .env
```

| Variable | Default | Description |
|---|---|---|
| `WEB_PORT` | `3000` | Port for Next.js web container |
| `API_PORT` | `3001` | Port for NestJS API container |
| `MEDIAMTX_HLS_PORT` | `8888` | HLS output port |
| `MEDIAMTX_SRT_PORT` | `8890` | SRT ingest UDP port |
| `NEXT_PUBLIC_API_URL` | `/api` | Browser API base path (proxied by web) |
| `NEXT_PUBLIC_STREAM_URL` | `/hls/live/stream/index.m3u8` | Browser HLS URL (proxied by web) |

## Legacy local dev (without Docker for web/api)

```bash
corepack pnpm install
corepack pnpm --filter api dev
corepack pnpm --filter web dev
docker compose up -d mediamtx
```

## Implemented now

- pnpm workspace monorepo bootstrap
- Next.js player UI with quad and focus mode placeholders
- NestJS API with `/health` and `/events/current`
- MediaMTX local config for `SRT -> HLS`
- Docker Compose full stack (`web + api + mediamtx`)

## Intentionally deferred

- Authentication and authorization
- Payments and subscriptions
- Chat and overlays
- Recording and archival
- Analytics dashboards
- CI/CD
- Kubernetes
