# StreamService - Product Expansion Plan

## Why this file exists
This document captures the next product direction so another agent (for example, Claude) can continue planning and execution with full context.

## Current baseline (already implemented)
- One composite stream architecture: `vMix -> SRT -> MediaMTX -> HLS -> Web`.
- One web player with quad/focus mode on a single stream.
- Minimal API with health and mock event endpoint.
- Dockerized local/server deployment for `web + api + mediamtx`.

## New direction
The product must support multiple organizations and multiple concurrent events/streams, not just one event for one organization.

## Core future requirements
1. Multi-tenant platform:
- Multiple organizations (tenants).
- Multiple events per organization.
- Independent stream ingest credentials per event.

2. Secure ingest access:
- Do not rely on public `IP:port` only.
- Generate credentials automatically per account/event.
- Support credential rotation and revocation.
- Limit publish permissions to allowed paths only.

3. API expansion:
- Replace mock-only flow with real resources:
  - organizations
  - users/accounts
  - events
  - stream sources/paths
  - ingest credentials/tokens
- Add endpoints for lifecycle operations (create, rotate, disable, audit).

4. Viewer-side product improvements:
- Better player UX and event navigation.
- Chat for viewers.
- Lightweight reactions (emoji/quick feedback).
- Basic moderation controls for chat/reactions.

## Non-goals for the next immediate implementation step
- No Kubernetes requirement yet.
- No heavy analytics platform yet.
- No payment implementation unless separately scoped.

## Proposed API surface (draft)
This is a draft direction, not final contract.

- `POST /v1/orgs`
- `GET /v1/orgs/:orgId`
- `POST /v1/orgs/:orgId/events`
- `GET /v1/orgs/:orgId/events/:eventId`
- `POST /v1/orgs/:orgId/events/:eventId/ingest-credentials`
- `POST /v1/orgs/:orgId/events/:eventId/ingest-credentials/:credentialId/rotate`
- `POST /v1/orgs/:orgId/events/:eventId/ingest-credentials/:credentialId/revoke`
- `GET /v1/public/events/:eventSlug`
- `GET /v1/public/events/:eventSlug/stream`
- `GET /v1/public/events/:eventSlug/chat`
- `POST /v1/public/events/:eventSlug/chat/messages`
- `POST /v1/public/events/:eventSlug/reactions`

## Data model direction (draft)
- `Organization`
- `User`
- `Membership` (user <-> organization role)
- `Event`
- `StreamSource`
- `IngestCredential` (hashed secret, status, expiresAt)
- `ChatRoom`
- `ChatMessage`
- `ReactionEvent`
- `AuditLog`

## Security direction
1. Ingest security:
- Per-event credentials.
- Short-lived credentials where possible.
- Rotation and immediate revoke.
- Optional IP allowlist for publisher endpoints.

2. Platform security:
- Role-based access control by organization.
- Rate limiting for chat/reactions APIs.
- Abuse controls (mute/ban/slow-mode for chat).
- Audit logs for privileged operations.

## Suggested phased milestones
1. Milestone A - Domain and contracts:
- Finalize entities, API contracts, and auth model.
- Exit criteria: approved OpenAPI + ERD + threat model.

2. Milestone B - Ingest credential service:
- Implement credential issuance/rotation/revoke.
- Integrate MediaMTX path-level publish policy.
- Exit criteria: only valid credentials can publish.

3. Milestone C - Multi-tenant event management:
- Org/event CRUD and access control.
- Exit criteria: multiple orgs/events isolated correctly.

4. Milestone D - Viewer experience:
- Event pages, stream status, improved player controls.
- Exit criteria: stable UX for live event navigation.

5. Milestone E - Chat and reactions:
- Realtime chat + reactions + moderation basics.
- Exit criteria: chat usable under load with abuse controls.

## Task handoff for Claude
Claude should produce:
1. A concrete architecture proposal for multi-tenant backend + realtime layer.
2. Final API contract (OpenAPI draft) for org/event/ingest/chat/reactions.
3. DB schema proposal with migration plan from current mock API.
4. Security model for ingest credentials and tenant isolation.
5. Incremental implementation plan that preserves current MVP behavior.

## Hard constraint to keep
Primary streaming architecture remains one composite stream per event for MVP progression; do not switch to four independent viewer streams as the default architecture.
