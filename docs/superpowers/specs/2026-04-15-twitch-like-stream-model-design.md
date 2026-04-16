# Twitch-like Stream Model — Design Spec
Date: 2026-04-15

## Overview

Refactor the multi-event model into a single-stream-per-org model (Twitch-style).
Each organization has one live stream at a time; past streams are archived as `Broadcast` records.
Stream start/end can be automatic (triggered by SRT feed) or manual (dashboard buttons), configurable per org.

---

## 1. Data Model

### Organization — new fields

| Field               | Type     | Default | Description                                      |
|---------------------|----------|---------|--------------------------------------------------|
| `streamTitle`       | String   | `""`    | Title shown on the watch page and saved to archive |
| `streamDescription` | String?  | null    | Optional description                             |
| `streamIsPublic`    | Boolean  | true    | If false, watch page requires `?key=`            |
| `streamPreviewKey`  | String?  | null    | Unique, generated when `streamIsPublic` → false  |
| `isLive`            | Boolean  | false   | True while SRT stream is active                  |
| `autoStream`        | Boolean  | false   | If true: start/end driven by MediaMTX webhook    |
| `currentBroadcastId`| String?  | null    | FK to active Broadcast (unique)                  |

### Broadcast (replaces Event)

| Field         | Type      | Description                                         |
|---------------|-----------|-----------------------------------------------------|
| `id`          | String    | CUID                                                |
| `orgId`       | String    | FK → Organization                                   |
| `title`       | String    | Copied from `streamTitle` at stream start           |
| `description` | String?   | Copied from `streamDescription` at stream start     |
| `startedAt`   | DateTime  | When stream started                                 |
| `endedAt`     | DateTime? | When stream ended (null while live)                 |
| `createdAt`   | DateTime  | Record creation time                                |
| `recording`   | Recording?| One-to-one with Recording                           |

No `status`, `isPublic`, `previewKey` — privacy lives on Organization.

### ChatMessage

- `eventId` → `orgId` (chat is per-org, not per-broadcast)

### Recording

- `eventId` → `broadcastId`

---

## 2. Backend API

### Org module (`/v1/org/*`, requires org_admin JWT)

| Method | Route | Description |
|--------|-------|-------------|
| `PATCH` | `/v1/org/stream` | Update `streamTitle`, `streamDescription`, `streamIsPublic`, `autoStream` |
| `POST` | `/v1/org/stream/start` | Manual start: create Broadcast, set `isLive=true` |
| `POST` | `/v1/org/stream/end` | Manual end: close Broadcast, trigger recording |
| `GET` | `/v1/org/broadcasts` | List archive (all Broadcasts with recordings) |
| `PATCH` | `/v1/org/broadcasts/:id` | Edit `title` / `description` of archived broadcast |
| `DELETE` | `/v1/org/broadcasts/:id` | Delete broadcast (and its recording file) |

### MediaMTX Webhook (`/v1/internal/mediamtx/webhook`)

- `POST` — receives `{ action: 'publish'|'unpublish', path: 'live/<slug>' }`
- Protected by `Authorization: Bearer <MEDIAMTX_WEBHOOK_SECRET>` header
- `publish` + org.autoStream=true → call startStream()
- `unpublish` + org.autoStream=true → call endStream()
- Manual-mode orgs: webhook is ignored (stream on/off is UI-controlled)

### Public module (`/v1/public/*`, no auth)

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/v1/public/orgs` | Catalog: active orgs, include `isLive`, `streamTitle` |
| `GET` | `/v1/public/orgs/:slug` | Watch info: org + `isLive`, `streamTitle`, `streamDescription`, `streamIsPublic` |
| `GET` | `/v1/public/orgs/:slug/stream` | Returns `{ hlsUrl }` if `isLive=true`, else 404 |
| `GET` | `/v1/public/orgs/:slug/broadcasts` | Archive list; private orgs require `?key=` |

### Recording module

- `onStreamEnded(broadcastId, orgSlug)` replaces `onEventEnded(eventId, orgSlug)`
- All internal references updated: `eventId` → `broadcastId`
- Recording streaming endpoint: `GET /v1/public/orgs/:slug/broadcasts/:id/recording/stream`
- Recording download endpoint: `GET /v1/org/broadcasts/:id/recording/download`

### Chat (WebSocket `/chat`)

- Room key: `orgSlug` instead of `eventId`
- `join { orgSlug }` / `message { orgSlug, nickname, content }`
- History and viewer count remain unchanged in behaviour

---

## 3. Frontend

### `/dashboard`

Remove the "Events" section entirely. Replace with:

**Stream settings card:**
- `streamTitle` input (always editable)
- `streamDescription` textarea (always editable)
- `streamIsPublic` toggle; when false: show "Copy link" button
- `autoStream` toggle: `Авто (по SRT)` / `Ручной`

**Stream status / control card:**
- `autoStream=false`: "Начать трансляцию" button (disabled if `isLive`) / "Завершить" button (disabled if not `isLive`)
- `autoStream=true`: read-only status indicator "● LIVE" or "Ожидание SRT..."

**Archive card:**
- Table/list of past Broadcasts
- Inline edit of `title` / `description`
- "Скачать" link for ready recordings
- "Удалить" button per broadcast

### `/watch/[orgSlug]`

- Replace `events[0]` with `org.isLive`, `org.streamTitle`, `org.streamDescription`
- Chat socket joins `orgId` instead of `eventId`
- Replace archive strip with a link → `/watch/[orgSlug]/archive`
- Privacy: `?key=` query param used for `streamPreviewKey` check (unchanged UX)

### `/watch/[orgSlug]/archive` (new page)

- Fetches `GET /v1/public/orgs/:slug/broadcasts`
- Lists past broadcasts: `title`, `startedAt`, `endedAt`, duration
- Clicking a broadcast opens an inline player (MatPlayer in `isArchive` mode)
- Private orgs: requires `?key=` passed through

---

## 4. MediaMTX Configuration

Add webhook to `mediamtx.yml`:

```yaml
runOnPublish: curl -s -X POST http://api:3001/v1/internal/mediamtx/webhook \
  -H "Authorization: Bearer $MEDIAMTX_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"action":"publish","path":"$MTX_PATH"}'
runOnUnpublish: curl -s -X POST http://api:3001/v1/internal/mediamtx/webhook \
  -H "Authorization: Bearer $MEDIAMTX_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"action":"unpublish","path":"$MTX_PATH"}'
```

New env var: `MEDIAMTX_WEBHOOK_SECRET`

---

## 5. Migration

Prisma migration steps (single migration file):
1. Add new fields to `Organization`
2. Create `Broadcast` table
3. Copy `Event` rows (status `live`/`ended`) → `Broadcast` (map `title`, `startedAt`, `endedAt`, `orgId`)
4. Any currently-`live` event → Broadcast with `endedAt=now` (close cleanly)
5. Update `ChatMessage`: add `orgId`, populate from `event.orgId`, drop `eventId`
6. Update `Recording`: rename `eventId` → `broadcastId`, update FK
7. Drop `Event` table

---

## 6. Out of Scope

- No per-broadcast privacy (privacy is org-level only)
- No scheduled broadcasts
- No transcoding or quality selection
- No broadcast chat replay (chat is live-only)
