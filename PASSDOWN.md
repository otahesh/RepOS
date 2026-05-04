# RepOS — Engineering Passdown

**Date:** 2026-05-03  
**Status:** v1 deployed and live — CF Access whole-host auth on, iOS Shortcut + Personal Automation in production, non-v1 placeholder UI stripped, pg DeprecationWarning resolved  
**Repo:** `otahesh/RepOS` (GitHub, public)

---

## What RepOS Is

A fitness tracking app. v1 scope is **Apple Health bodyweight sync**: an iOS Shortcut pushes the user's morning weight to the API once daily; a web dashboard charts it over time with trend stats and a sync status pill. A Settings page lets users manage the device tokens that authenticate the Shortcut.

The design reference (`RepOS.html` + 6 JSX files at the repo root) is a Figma-style prototype — static, hardcoded data, no build step. It served as the visual spec during development. Don't touch it; use it as the reference if you're modifying UI.

---

## What's Built (v1)

| Area | State |
|---|---|
| Postgres schema (6 migrations) | ✅ Applied to production DB |
| Backend API (4 endpoints + auth) | ✅ 14 tests passing (added calendar-invalid date case) |
| Auth middleware (argon2id, prefix-indexed) | ✅ Index now uses `text_pattern_ops` for LIKE-prefix |
| Security hardening | ✅ helmet, log redaction, ADMIN_API_KEY guard, pg pool limits, token-revoke owner check, calendar-valid dates — all shipped |
| Frontend — design system, layout, charts | ✅ Build clean, zero TS errors |
| Frontend — Settings / token management UI | ✅ |
| Production deployment (Unraid + Cloudflare) | ✅ Single `RepOS` container, br0 macvlan at `192.168.88.65`, public via Cloudflare Tunnel as `repos.jpmtech.com`, **whole host** gated by Cloudflare Access (`RepOS` app, AUD `49200ae5...`) with a Bypass app on `/api/health/*` for the iOS Shortcut bearer flow |
| Postgres backup | ✅ s6 longrun → daily `pg_dump` 03:15 UTC → `/config/backups/repos-*.dump.gz`, 14-day retention, restore runbook below |
| Log rotation | ✅ s6-log per service for postgres/api/nginx, 100 MB × 7 archives, gzipped — at `/config/log/{postgres,api,nginx}` |
| CI (GitHub Actions) | ✅ `.github/workflows/test.yml` (typecheck on PR) + `docker.yml` (build + push to `ghcr.io/otahesh/repos` on main) |
| Frontend URL routing | ✅ `VITE_API_URL=` (empty) — `/api/foo` resolved via same-origin nginx (was `VITE_API_URL=/api` which produced `/api/api/foo` 404s) |
| iOS Shortcut build recipe | ✅ `docs/shortcuts/health-weight-sync.md` — verified against iOS 26.4.2 (Calculate × 2.20462 for kg→lb, inline JSON in Get Contents of URL, `is not empty` for the If condition). Some action labels marked "iOS 26 spot-check" for future builders to confirm. |
| iOS Shortcut Personal Automation | ✅ Time-of-Day 7:30 AM Daily, Run Immediately, runs `RepOS Daily Weight Sync`. (Apple does NOT expose a Health-event trigger in current iOS — Time-of-Day is the only path.) |
| User login / session system | ✅ CF Access whole-host auth live. `/api/me` derives identity from `Cf-Access-Jwt-Assertion` JWT email claim; auto-provisions on first hit. Frontend `useCurrentUser()` + `AuthGate` in `frontend/src/auth.tsx`; sidebar pill renders the resolved user. |
| iOS Shortcut `.shortcut` bundle | ❌ Not published — users build from the recipe locally |

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
│   │   │   └── migrations/ — 001–006 SQL files (006 = token prefix index)
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
| Server | Unraid NAS at `192.168.88.2` (hostname `Tower`) |
| SSH | `ssh unraid` (alias on dev Mac; key at `~/.ssh/unraid`, root user) |
| Production container | `RepOS` — single image built from `docker/Dockerfile`, pushed to `ghcr.io/otahesh/repos:{latest,sha-<short>}` by GitHub Actions on every push to `main` |
| Container network | `br0` macvlan, pinned IP `192.168.88.65`, MAC `02:42:c0:a8:58:41` |
| Persistent volume | `/mnt/user/appdata/repos/config` → `/config` inside container |
| Env file (secrets) | `/mnt/user/appdata/repos/.env` (root-owned, 600) — `POSTGRES_PASSWORD`, `ADMIN_API_KEY`, etc. |
| Internal services | postgres on `127.0.0.1:5432` (loopback only), Fastify API on `127.0.0.1:3001`, nginx on `:80` |
| Public ingress | Cloudflare Tunnel (`CloudflaredTunnel` container, host netns) → `repos.jpmtech.com` → `http://192.168.88.65:80` |
| Edge auth | Cloudflare Access app `RepOS Admin Tokens` gates `/api/tokens` to a single email (defense in depth on top of `ADMIN_API_KEY`). Will be folded into a new whole-host CF Access app when auth lands; retire the old app once the whole-host app is verified to avoid serving two AUDs to the browser. |
| Build context | `/mnt/user/appdata/repos/build/` (rsynced from dev Mac); rebuild with `docker build -t repos:latest -f docker/Dockerfile .` |
| Docker restart | `unless-stopped` |

**Build + redeploy cycle (CI-driven, preferred):**
```bash
# 1. Push commits to main. CI runs .github/workflows/docker.yml,
#    builds the image, and pushes ghcr.io/otahesh/repos:{latest,sha-<short>}.
git push origin main
# Watch: https://github.com/otahesh/RepOS/actions

# 2. After CI is green, pull + redeploy on Unraid:
ssh unraid '
  docker pull ghcr.io/otahesh/repos:latest && \
  docker stop RepOS && docker rm RepOS && \
  docker run -d --name RepOS --network br0 --ip 192.168.88.65 \
    --mac-address 02:42:c0:a8:58:41 --restart unless-stopped \
    --env-file /mnt/user/appdata/repos/.env \
    -e PUID=99 -e PGID=100 \
    -v /mnt/user/appdata/repos/config:/config \
    ghcr.io/otahesh/repos:latest
'
```

To roll back, substitute `:latest` with a previous `:sha-<short>` tag in both `pull` and `run`.

**One-time GHCR setup (after the first green CI run):** the package is created `private` by default. Make it `public` so Unraid can pull without auth:
GitHub → your profile → Packages → `repos` → Package settings → Danger Zone → Change visibility → Public.

**Legacy / emergency rebuild path (when GHCR is unreachable):**
```bash
# from dev Mac, repo root:
rsync -av --delete \
  --exclude=.git --exclude=node_modules --exclude=dist \
  --exclude=.env --exclude=.env.local --exclude=.DS_Store \
  --exclude=.vscode --exclude=coverage --exclude='*.log' \
  /Users/jasonmeyer.ict/Projects/RepOS/ \
  unraid:/mnt/user/appdata/repos/build/

ssh unraid 'cd /mnt/user/appdata/repos/build && docker build -t repos:latest -f docker/Dockerfile .'
# (same docker stop/rm/run cycle as above, but with the local repos:latest tag)
```

The `/config` volume persists postgres data across container recreations — your DB survives a rebuild.

**Restore from backup:**
```bash
docker exec -it RepOS ls -lt /config/backups/                                    # pick newest
docker exec -it RepOS s6-rc -d change api                                        # quiesce writes
docker exec -it RepOS s6-setuidgid postgres psql -h /tmp -U postgres -d postgres \
  -c "DROP DATABASE IF EXISTS repos WITH (FORCE); CREATE DATABASE repos OWNER repos;"
docker exec -it RepOS sh -c "gunzip -c /config/backups/repos-<timestamp>.dump.gz \
  | s6-setuidgid postgres pg_restore -h /tmp -U postgres -d repos --no-owner --role=repos --exit-on-error"
docker exec -it RepOS s6-rc -u change api
```

**Local dev DB:** the standalone `repos-postgres` container that previously held dev data has been retired. To run `npm test` locally now, either spin up a separate dev Postgres on your machine (any container with `repos`/`repos`/`repos_dev_pw`/`repos`) or accept that tests run only inside the production container path.

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

Six migrations in `api/src/db/migrations/` (`001`–`006`, where `006` adds the `text_pattern_ops` index for `LIKE 'prefix:%'`), tracked in a `_migrations` table. The runner is idempotent — `npm run migrate` is safe to re-run.

Auth migration `007_users_auth.sql` (CF Access whole-host) is in flight — adds `display_name`, `last_seen_at`, and a UNIQUE index on `lower(email)`.

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

The catch-all route redirects everything else to `/`. Non-v1 nav items (Program, Library, Progress, Cardio) and the `START SESSION` / Week-selector / Mesocycle scaffolding from the original prototype have been stripped from the live UI — only Today + Settings remain.

Auth: `frontend/src/auth.tsx` exposes `apiFetch`, `AuthProvider`, `useCurrentUser`, and `AuthGate`. `AuthGate` blocks render until `/api/me` resolves. With `CF_ACCESS_ENABLED=true` in production the app loads the auto-provisioned user (display_name, email, timezone). The transitional `PLACEHOLDER_USER_ID` constant remains in `auth.tsx` only as the `disabled`-status fallback for cf-access-disabled deploys; remove it when CF Access is permanent.

Sync pill on the topbar polls `GET /api/health/sync/status` via `apiFetch` (cookie-bearing same-origin) every 60s — it'll show `SYNC ERROR` only on a real network failure, not on auth issues, since the cookie carries CF Access through.

---

## Security: What Was Fixed and What's Open

Full findings in `tasks/security-report.md`. Summary:

**Fixed (shipped in alpha-prep + monolithic-container deploy):**
- C-1: Unauthenticated token minting → `X-Admin-Key` guard on all token routes
- H-1: O(n) argon2 full-table-scan auth → prefix-indexed token format
- H-2: Unbounded backfill array → 500-item hard cap
- H-3: Rate-limit counter leaked outside transactions → explicit `PoolClient` for backfill
- L-1: `NaN`/`Infinity` bypassed weight validation → `!isFinite()` guard
- M-2: Sync status cache lacked `private` directive → fixed
- M-1: ✅ `@fastify/helmet` registered + log redaction for `Authorization` / `X-Admin-Key`
- M-3: ✅ `DELETE /api/tokens/:id` requires `user_id` query param (UPDATE matches both)
- L-2: ✅ Calendar-invalid dates (`2026-13-01`) now return clean 400 via UTC round-trip
- L-3: ✅ pg Pool bounded (max=20, connection/idle timeouts, per-session `statement_timeout=5s` set as native Pool option in `client.ts` — was previously an unawaited `db.on('connect', ...)` SET that fired the `client.query() when client is already executing` DeprecationWarning on every concurrent-pool path; fix sends statement_timeout in the connection startup parameters before the client is checked out). `migrate.ts` was simultaneously refactored to pin a single client across BEGIN/sql/COMMIT (transactions weren't actually wrapping anything before — Pool-level `db.query` calls may use different clients) and to clear `statement_timeout` for the migration session so future long-running migrations aren't capped by the runtime 5s.
- H-1 follow-up: ✅ Migration 006 adds `text_pattern_ops` index on `device_tokens.token_hash` for the `LIKE 'prefix:%'` access pattern
- Public exposure new gates: ✅ `ADMIN_API_KEY` startup guard refuses to boot in production if unset; nginx-in-container enforces 256k body cap, per-IP rate limits (`/api/` 10r/s, `/api/tokens` 2r/s); Cloudflare Access on `/api/tokens/*`

**Open (v2 hardening):**
- Move token minting out-of-band (CLI) to eliminate the admin HTTP surface entirely
- Frontend bundle code-splitting (588 kb chunk, dominated by Recharts)
- Postgres WAL archiving / point-in-time recovery — current daily logical backup is sufficient for alpha; revisit if RPO < 24h becomes a real requirement
- Backup off-box destination — currently lives on the same Unraid box as the source DB; mirror to NAS share or remote target before declaring Release

**CF Access whole-host auth — operator runbook (already live; kept here for future re-enablement / disaster recovery):**

1. Zero Trust → Access → Applications → **Add an application** → Self-hosted, domain `repos.jpmtech.com` (no path), session 24h, identity provider One-Time PIN, policy Allow with `jason@jpmtech.com` (extend allowlist over time). Copy the **Application Audience (AUD) Tag**.
2. Add a second application: domain `repos.jpmtech.com`, **path** `api/health/*`, policy **Bypass** with selector Everyone. The bearer-only Shortcut path needs this so origin-side JWT verification doesn't fire on machine traffic.
3. Append to `/mnt/user/appdata/repos/.env` (root:root, 600): `CF_ACCESS_ENABLED=true`, `CF_ACCESS_TEAM_DOMAIN=jpmtech.cloudflareaccess.com`, `CF_ACCESS_AUD=<paste from step 1>`, optionally `CF_ACCESS_ALLOWED_EMAILS=jason@jpmtech.com` (defense-in-depth allowlist at the origin).
4. Restart container: `ssh unraid 'docker restart RepOS'`.
5. Verify in incognito browser: hit `https://repos.jpmtech.com` → CF challenge → enter email → PIN → app loads → DevTools shows `/api/me` returns 200 with your email.
6. ~~**Retire the old `RepOS Admin Tokens` Access app**~~ ✅ Done 2026-05-03. The legacy path-scoped app has been deleted; the whole-host `RepOS` app is the only AUD issuer (verified by AUD probe on `/`, `/api/tokens`, `/settings/integrations` — all `49200ae5...`).

**Break-glass — merge two user rows by email (when allowlist email changes):**
```sql
-- Suppose 'old@x.com' has user_id A and 'new@x.com' has user_id B; you
-- want to migrate A's data onto B and delete A.
BEGIN;
UPDATE health_weight_samples  SET user_id = 'B' WHERE user_id = 'A';
UPDATE device_tokens          SET user_id = 'B' WHERE user_id = 'A';
UPDATE health_sync_status     SET user_id = 'B' WHERE user_id = 'A';
UPDATE weight_write_log       SET user_id = 'B' WHERE user_id = 'A';
DELETE FROM users WHERE id = 'A';
COMMIT;
```
Note: `health_weight_samples` has UNIQUE(user_id, sample_date, source); if both A and B have a row for the same (date, source), the UPDATE fails on the duplicate. Resolve case-by-case before running.

**Production checklist (status):**
- [x] `ADMIN_API_KEY` set to a 64-hex-char secret in `/mnt/user/appdata/repos/.env`
- [x] TLS terminated at Cloudflare's edge (nginx-in-container is plain HTTP on the LAN — that's correct for a tunnel)
- [x] `VITE_API_URL=` (empty) baked into the frontend build for same-origin (set to `/api` would double the prefix and produce `/api/api/...` 404s)
- [x] `api/.env` is `.gitignore`d (verified)
- [x] Postgres bound to `127.0.0.1` only (verified: `nc -zv 192.168.88.65 5432` from LAN → connection refused)
- [x] Whole-host gated by Cloudflare Access; `/api/health/*` correctly bypassed (verified by AUD probe + 401 on no-bearer POST)
- [x] CF Access startup guard refuses boot when `CF_ACCESS_ENABLED=true` && (`CF_ACCESS_AUD` || `CF_ACCESS_TEAM_DOMAIN`) is missing
- [x] CI green on `main` (`.github/workflows/{test,docker}.yml`); GHCR package `ghcr.io/otahesh/repos` is public (verified by anonymous `docker pull` from Unraid)
- [x] Legacy `RepOS Admin Tokens` Access app deleted — single AUD `49200ae5...` served on every gated path
- [x] Pino DeprecationWarning resolved (no `client.query() ... already executing` after deploy of `4fcad6c4...`)
- [x] iOS Shortcut Personal Automation set up on iPhone (Time of Day 7:30 AM Daily)
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
