# Roadmap

## Milestone 1 — Local dev foundation ✅

**Goal:** Developer can clone the repo, run all services locally, and see the stream player UI.

**Deliverables:**
- Monorepo with apps/web and apps/api
- MediaMTX Docker service
- Player UI with quad/focus switching
- API health + event endpoints

**Exit criteria:**
- `pnpm install` completes without errors
- `pnpm dev:web` serves the player on localhost:3000
- `pnpm dev:api` serves `/health` and `/events/current`
- `docker compose up mediamtx` starts the media server
- Pushing a test ffmpeg SRT stream shows video in the browser

---

## Milestone 2 — Live vMix ingest

**Goal:** Connect a real vMix workstation and see the composite 4K stream in the browser.

**Deliverables:**
- MediaMTX running on a reachable server (VPS or LAN)
- vMix SRT push configured to that server
- Browser player confirmed working over LAN

**Exit criteria:**
- vMix streams and MediaMTX shows an active path
- Browser player on a second machine plays the stream with <3 s latency
- No manual server restarts required during a bout

---

## Milestone 3 — Hosted deployment

**Goal:** Platform is reachable on the public internet for tournament day.

**Deliverables:**
- VPS with Docker Compose
- TLS termination for HLS (nginx or Caddy)
- Stable domain name

**Exit criteria:**
- Browser player works over HTTPS
- Stream continues uninterrupted for >30 min in a load test
- MediaMTX API accessible for ops monitoring

---

## Milestone 4 — Viewer experience polish

**Goal:** Viewer-facing features that improve watchability.

**Deliverables:**
- Fullscreen support per mat in focus mode
- Mobile-responsive layout
- Stream status indicator (live / offline)
- Low-latency HLS tuning (LL-HLS)

**Exit criteria:**
- Tested on iOS Safari and Chrome Android
- Latency <2 s end-to-end in LL-HLS mode

---

## Deferred (out of scope until explicitly scoped)

- Authentication / paid access
- Chat / overlay
- Recording / VOD archive
- Analytics dashboard
- Multi-event management
- Kubernetes
