# Session Handoff — 2026-05-02

> **RECONSTITUTION NOTICE:** After reading this file to restore session context,
> delete it immediately: `rm /home/jason/Projects/RepOS/HANDOFF.md`
> Reason: stale handoffs mislead future sessions. Memory files are the durable record.

## What We Were Doing

RepOS v1 is now complete. This session picked up with an empty `api/tests/` directory and no frontend, and shipped: the full 13-test Vitest suite (all passing against real Postgres), a security audit that fixed 1 Critical + 3 High vulnerabilities, a Vite + React + TypeScript frontend (P1–P5), an engineering passdown document for the incoming team, and a clean git history with 4 commits on `main`.

## Completed This Session

- `api/tests/weight.test.ts` — all 13 spec test cases, real Postgres, isolated test user
- `api/src/db/migrations/005_weight_write_log.sql` — rate-limit counter table
- `api/src/app.ts` — `buildApp()` factory extracted for testability
- `api/src/routes/weight.ts` — rate limit fixed (atomic write-log), backfill capped at 500, `!isFinite` guard added
- `api/src/middleware/auth.ts` — O(1) prefix-indexed token auth (replaces full-table argon2 scan)
- `api/src/routes/tokens.ts` — admin key guard, new prefix.secret token format, `GET /api/tokens` listing endpoint added
- `api/src/routes/sync.ts` — `Cache-Control: private, max-age=60`
- `api/vitest.config.ts` — 30s hook/test timeouts
- `frontend/` — full Vite + React + TypeScript app (design system, layout, chart, settings)
- `tasks/security-report.md` — full audit with all findings
- `.gitignore` — excludes `.env`, `node_modules`, `dist`
- `PASSDOWN.md` — engineering handoff for new team

## In Progress / Not Done

- **NginxProxyManager config** — API is not publicly reachable yet; needs a proxy rule on Unraid pointing `api.repos.app` → `localhost:3001`
- **User auth / login system** — frontend uses `PLACEHOLDER_USER_ID` hardcoded in `frontend/src/tokens.ts`; sync pill and sync status page show "SYNC ERROR" until Bearer tokens are wired in
- **iOS Shortcut file** — `.shortcut` bundle not published; spec is in `Engineering Handoff.md §9`
- **Open security items** — `@fastify/helmet`, stricter date validation, pg pool limits, functional index on token prefix — all documented in `tasks/security-report.md`

## Next Action

Configure NginxProxyManager on Unraid to proxy `api.repos.app` → the API container port, then build the user login system so the frontend can obtain and store a Bearer token — that unblocks the sync pill, all authenticated chart data, and real token management.

## Critical Files

| File | Why It Matters |
|------|---------------|
| `PASSDOWN.md` | Full handoff doc — setup, API ref, schema, security checklist, v2 scope |
| `Engineering Handoff.md` | Authoritative product spec — 13 test cases, API contract, dedupe/rate-limit rules |
| `api/src/routes/weight.ts` | Core write/read logic — dedupe, rate limit, upsert |
| `api/src/middleware/auth.ts` | Auth — prefix.secret format; note LIKE query needs index at scale |
| `api/src/routes/tokens.ts` | Token mint/list/revoke — admin key pattern; `ADMIN_API_KEY` must be set in prod |
| `api/tests/weight.test.ts` | 13 tests — run before every merge |
| `frontend/src/tokens.ts` | `PLACEHOLDER_USER_ID` lives here — remove when auth is built |
| `api/.env` | DB connection string — not in git; must be present to run or test |
| `tasks/security-report.md` | Open security items for v2 |

## Key Context

- **Token format** changed this session: `<16-hex-prefix>.<64-hex-secret>`, stored as `<prefix>:<argon2hash>`. Old tokens minted with the previous format (plain 64-hex) will not authenticate — any tokens minted before this session are invalid.
- **Fastify v5 preHandlers must be async** — a sync hook silently hangs the request. This burned us with the security agent's `requireAdminKey` and is now fixed.
- **Rate limit** uses `weight_write_log` table (migration 005), not a count of DB rows. The original count-rows approach was unreachable since 4 valid sources = max 4 rows per day, never ≥ 5.
- **`ADMIN_API_KEY` unset = open in dev** — the guard is intentionally bypassed when the env var is absent. Production MUST set it.
- **Sync endpoints require Bearer auth** — the frontend's topbar and Settings page call these without a token (no login system yet), so they show error states gracefully. This is expected until auth is built.
- **Unraid SSH**: `ssh unraid` (key at `~/.ssh/unraid`, alias in `~/.ssh/config`)

## Resume Prompt

```
I'm resuming work on RepOS. Please read /home/jason/Projects/RepOS/HANDOFF.md and my memory files to get up to speed. After reading HANDOFF.md, delete it. The immediate next step is configuring NginxProxyManager on Unraid to expose the API, then starting the user login system.
```
