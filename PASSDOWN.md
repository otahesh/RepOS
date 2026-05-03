# RepOS — Engineering Passdown

**Date:** 2026-05-02  
**Status:** v1 complete, ready for production deployment  
**Repo:** `otahesh/RepOS` (GitHub, public)

---

## What RepOS Is

A fitness tracking app. v1 scope is **Apple Health bodyweight sync**: an iOS Shortcut pushes the user's morning weight to the API once daily; a web dashboard charts it over time with trend stats and a sync status pill. A Settings page lets users manage the device tokens that authenticate the Shortcut.

The design reference (`RepOS.html` + 6 JSX files at the repo root) is a Figma-style prototype — static, hardcoded data, no build step. It served as the visual spec during development. Don't touch it; use it as the reference if you're modifying UI.

---

## What's Built (v1)

| Area | State |
|---|---|
| Postgres schema (5 migrations) | ✅ Applied to production DB |
| Backend API (4 endpoints + auth) | ✅ All 13 spec tests passing |
| Auth middleware (argon2id, prefix-indexed) | ✅ |
| Security hardening | ✅ See `tasks/security-report.md` |
| Frontend — design system, layout, charts | ✅ Build clean, zero TS errors |
| Frontend — Settings / token management UI | ✅ |
| NginxProxyManager routing (Unraid) | ❌ Not configured — API not yet publicly reachable |
| User login / session system | ❌ Out of scope for v1 |
| iOS Shortcut file (`.shortcut`) | ❌ Not published yet |

---

## Repo Structure

```
RepOS/
├── api/                    — Fastify 5 + TypeScript backend
│   ├── src/
│   │   ├── app.ts          — buildApp() factory
│   │   ├── index.ts        — entry point (listen)
│   │   ├── db/
│   │   │   ├── client.ts   — pg Pool
│   │   │   ├── migrate.ts  — idempotent migration runner
│   │   │   └── migrations/ — 001–005 SQL files
│   │   ├── middleware/
│   │   │   └── auth.ts     — Bearer token auth
│   │   ├── routes/
│   │   │   ├── tokens.ts   — mint / list / revoke
│   │   │   ├── weight.ts   — ingest / backfill / read
│   │   │   └── sync.ts     — sync status pill
│   │   └── services/
│   │       └── stats.ts    — trend deltas, adherence, missed days
│   ├── tests/
│   │   └── weight.test.ts  — 13 spec test cases (Vitest, real Postgres)
│   ├── .env                — NOT in git — see "Environment Variables" below
│   └── package.json
│
├── frontend/               — Vite 5 + React 18 + TypeScript 5
│   ├── src/
│   │   ├── tokens.ts       — design tokens (colors, fonts, API base URL)
│   │   ├── App.tsx         — router root
│   │   ├── components/
│   │   │   ├── layout/     — AppShell, Sidebar, Topbar
│   │   │   ├── dashboard/  — DesktopDashboard, BodyweightChart, TrendStats
│   │   │   ├── settings/   — SettingsIntegrations, TokenTable, GenerateTokenModal
│   │   │   ├── MobileWeightChip.tsx
│   │   │   └── Icon.tsx
│   │   └── index.css
│   ├── .env.example        — copy to .env.local and set VITE_API_URL
│   └── package.json
│
├── tasks/
│   ├── plan.md             — original implementation plan
│   ├── todo.md             — phase checklist
│   └── security-report.md — full audit findings (fixed + open)
│
├── Engineering Handoff.md  — authoritative product spec (DO NOT MODIFY)
├── RepOS.html              — design reference prototype
└── CLAUDE.md               — AI assistant context (repo conventions)
```

---

## Running Locally

### Prerequisites

- Node.js ≥ 20
- Access to the Unraid Postgres instance (see Infrastructure below), **or** a local Postgres 16 database

### Backend

```bash
cd api
cp .env.example .env        # fill in DATABASE_URL
npm install
npm run migrate             # idempotent — safe to re-run
npm run dev                 # starts on :3001 with hot reload
```

**`.env` contents:**
```
DATABASE_URL=postgres://repos:repos_dev_pw@192.168.88.2:5432/repos
PORT=3001
# ADMIN_API_KEY=           # leave unset for local dev; MUST be set in production
```

### Frontend

```bash
cd frontend
cp .env.example .env.local  # set VITE_API_URL=http://localhost:3001
npm install
npm run dev                 # starts on :5173
```

### Tests

```bash
cd api
npm test                    # runs all 13 spec cases against the real Postgres DB
```

All 13 tests must pass before merging to `main`. They use a fresh isolated test user and clean up after themselves — safe to run against the production DB.

---

## Infrastructure

| Component | Details |
|---|---|
| Server | Unraid NAS at `192.168.88.2` |
| SSH | `ssh -i ~/.ssh/unraid root@192.168.88.2` (alias: `ssh unraid`) |
| Postgres | Docker container `repos-postgres` (postgres:16-alpine) |
| DB port | `192.168.88.2:5432` |
| DB name / user / pass | `repos` / `repos` / `repos_dev_pw` |
| Data volume | `/mnt/user/appdata/repos-postgres` |
| Proxy | NginxProxyManager is installed on Unraid — **not yet configured for RepOS** |
| Docker restart | `unless-stopped` |

**To expose the API publicly:** configure NginxProxyManager to proxy `api.repos.app` → `localhost:3001` (the API needs to be running on the Unraid host or in a container with the port exposed). Then set `VITE_API_URL=https://api.repos.app` in the frontend build.

---

## Backend API Reference

All endpoints except `GET /health` require either Bearer auth or the admin key as noted.

### Auth model

Device tokens authenticate the iOS Shortcut and the frontend. Token format: `<16-hex-prefix>.<64-hex-secret>`. Sent as `Authorization: Bearer <token>`. Stored hashed (argon2id) with the prefix prepended so auth is O(1) — no table scan.

The token management endpoints (`POST/GET/DELETE /api/tokens`) are gated by an `X-Admin-Key` header in production. In dev (no `ADMIN_API_KEY` env var), the check is skipped.

### Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | none | Health check → `{"status":"ok"}` |
| `POST` | `/api/tokens` | Admin key | Mint token `{user_id, label?}` → `{id, token, created_at}` — **show `token` once only** |
| `GET` | `/api/tokens?user_id=` | Admin key | List active tokens for a user → `[{id, label, created_at, last_used_at}]` |
| `DELETE` | `/api/tokens/:id` | Admin key | Revoke token → 204 |
| `POST` | `/api/health/weight` | Bearer | Ingest one sample `{weight_lbs, date, time, source}` → 201 new / 200 deduped |
| `POST` | `/api/health/weight/backfill` | Bearer | Bulk ingest `{samples:[...]}` (max 500) → `{created, deduped}` |
| `GET` | `/api/health/weight?range=` | Bearer | Chart data + stats. Range: `7d\|30d\|90d\|1y\|all` |
| `GET` | `/api/health/sync/status` | Bearer | Sync pill: `{source, last_success_at, state}`. `Cache-Control: private, max-age=60` |

**Weight sample fields:**

| Field | Type | Rules |
|---|---|---|
| `weight_lbs` | number | 50.0–600.0, finite, rounded to 1 decimal on store |
| `date` | `YYYY-MM-DD` | User-local date of recording |
| `time` | `HH:MM:SS` | User-local time, stored as display label only |
| `source` | string | `Apple Health` \| `Manual` \| `Withings` \| `Renpho` |

**Dedupe key:** `(user_id, date, source)`. Same-day re-sync updates if weight differs by > 0.05 lb, otherwise returns 200 deduped:true with no write.

**Rate limit:** > 5 writes per `(user_id, date)` per calendar day → 409 `{error:"rate_limited"}`.

**Sync states:**

| State | Condition |
|---|---|
| `fresh` | `last_success_at` within 36h |
| `stale` | 36h – 72h since last success |
| `broken` | > 72h **or** ≥ 3 consecutive failures |

36h (not 24h) absorbs iOS Personal Automation drift without false-positives.

---

## Database Schema

Five migrations in `api/src/db/migrations/`, tracked in a `_migrations` table. The runner is idempotent — `npm run migrate` is safe to re-run.

```sql
-- Core tables (abbreviated)
users                     (id UUID PK, email TEXT UNIQUE, timezone TEXT)
device_tokens             (id BIGSERIAL PK, user_id UUID FK, token_hash TEXT, label TEXT,
                           last_used_at TIMESTAMPTZ, last_used_ip TEXT, revoked_at TIMESTAMPTZ)
health_weight_samples     (id BIGSERIAL PK, user_id UUID FK, sample_date DATE, sample_time TIME,
                           weight_lbs NUMERIC(5,1), source TEXT,
                           UNIQUE(user_id, sample_date, source))
health_sync_status        (user_id UUID PK FK, source TEXT, last_fired_at TIMESTAMPTZ,
                           last_success_at TIMESTAMPTZ, last_error TEXT, consecutive_failures INT)
weight_write_log          (user_id UUID FK, log_date DATE, write_count INT,
                           PRIMARY KEY(user_id, log_date))
```

`health_weight_samples` has an index on `(user_id, sample_date DESC)`.

---

## Frontend Routes

| Path | Component | Notes |
|---|---|---|
| `/` | `DesktopDashboard` | Live chart, fetches `GET /api/health/weight?range=90d` |
| `/settings/integrations` | `SettingsIntegrations` | Token management, sync status |

The frontend currently has **no login system**. All authenticated API calls will return 401 until a user session is wired up. For now, `PLACEHOLDER_USER_ID` in `frontend/src/tokens.ts` is a hardcoded UUID used for token operations. Replace this when you build auth.

The sync pill in the topbar and the sync status on the Settings page call `GET /api/health/sync/status` without a Bearer token — these will show "SYNC ERROR" gracefully until auth is connected.

---

## Security: What Was Fixed and What's Open

Full findings in `tasks/security-report.md`. Summary:

**Fixed (shipped):**
- C-1: Unauthenticated token minting → `X-Admin-Key` guard on all token routes
- H-1: O(n) argon2 full-table-scan auth → prefix-indexed token format
- H-2: Unbounded backfill array → 500-item hard cap
- H-3: Rate-limit counter leaked outside transactions → explicit `PoolClient` for backfill
- L-1: `NaN`/`Infinity` bypassed weight validation → `!isFinite()` guard
- M-2: Sync status cache lacked `private` directive → fixed

**Open (v2 hardening):**
- M-1: No security headers — add `@fastify/helmet`
- M-3: Token revocation scoping — `DELETE /api/tokens/:id` should verify ownership
- L-2: Date regex accepts invalid calendar dates (e.g. `2024-99-99`) → validate with `Date` parse
- L-3: pg Pool has no configured limits or statement timeout
- H-1 follow-up: Add a functional index on `left(token_hash, 16)` for prefix lookup at scale

**Production checklist before going live:**
- [ ] Set `ADMIN_API_KEY` to a high-entropy secret in the production environment
- [ ] Configure NginxProxyManager to terminate TLS — never run the API over plain HTTP
- [ ] Set `VITE_API_URL` in the frontend build to the production API hostname
- [ ] Confirm `api/.env` is not committed (`.gitignore` covers it; double-check)

---

## Test Suite

`api/tests/weight.test.ts` — 13 test cases covering the full spec (§7 of `Engineering Handoff.md`):

1. POST valid sample → 201, row created
2. Same weight re-post → 200, deduped:true, `updated_at` unchanged
3. Different weight re-post → 200, deduped:true, weight updated, `updated_at` bumped
4. `weight_lbs=49.9` → 400, `field=weight_lbs`
5. `weight_lbs=600.1` → 400, `field=weight_lbs`
6. `source="Fitbit"` → 400, `field=source`
7. `date="04/26/2026"` → 400, `field=date`
8. No Bearer token → 401
9. Revoked Bearer → 401
10. 6th write for same `(user,date)` in one day → 409
11. `GET /weight?range=90d` with no data in range → `samples:[]`, stats all null
12. `GET /sync/status` with `last_success_at` > 72h ago → `state:"broken"`
13. Backfill of 30 days, 5 already exist → `{created:25, deduped:5}`

Tests hit the real Postgres DB. They create an isolated test user in `beforeAll` and cascade-delete it in `afterAll`.

---

## v2 Scope (Out of Scope for This Handoff)

Per `Engineering Handoff.md §10`:

- **User auth / login** — no login system exists; the frontend has a hardcoded placeholder user ID
- **Multi-metric ingestion** — body fat %, resting HR
- **Additional sources** — Withings and Renpho direct integration
- **Automated backfill** — Shortcut "Find All Samples Since Last Sync" pattern
- **Source-priority UI** — when Apple Health and Withings report the same date, which wins
- **iOS Shortcut file** — the `.shortcut` bundle for users to import; spec is in `Engineering Handoff.md §9`
- **Security hardening** — items listed in the Open section above
- **Code splitting** — the frontend bundle is 588kb (Recharts dominates); lazy-load the chart if needed

---

## Key Contacts / Context

- Design reference: `RepOS.html` — open in a browser, no build step. All design decisions trace back to this file.
- Product spec: `Engineering Handoff.md` — the authoritative source for API contract, dedup logic, sync thresholds, and test acceptance criteria. Don't change behavior without checking this first.
- The `CLAUDE.md` file at the root contains repo conventions used by the AI assistant during development — useful context for code style decisions.
