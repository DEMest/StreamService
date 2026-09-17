# AGENTS.md — StreamService

NestJS, Next.js, Prisma, and MediaMTX power a production live-streaming
service. A merge to `main` deploys production.

## Controlled delivery

For every code change, read `docs/agents/guarded-delivery.md` before the first
write. The agent implements, reviews, publishes a PR, and enables auto-merge;
GitHub waits for required approval from a privileged reviewer. A failed review,
failed or unknown CI, or unsafe live deploy blocks publication and merge.

## Project constraints

Read `CLAUDE.md` for architecture, product constraints, test commands, and
live-deploy behaviour. Never push directly to `main`; use a feature branch and
a PR. Do not run Docker Compose lifecycle commands from this checkout.
