# RepOS Monolithic Container — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship RepOS as a single Docker container on Unraid's `br0` macvlan at `192.168.88.65`, exposed publicly via Cloudflare Tunnel as `repos.jpmtech.com`, with all MUST-FIX security items closed before public exposure.

**Architecture:** One container (`RepOS`) running Postgres 16 + Node 20 Fastify API + nginx, supervised by s6-overlay v3 on `lscr.io/linuxserver/baseimage-alpine:3.21`. nginx terminates LAN-side HTTP on :80, serves the React static bundle, and reverse-proxies `/api/*` to the API on `127.0.0.1:3001`. Postgres binds to `127.0.0.1` only. Public ingress is Cloudflare Tunnel → `http://192.168.88.65:80`; `/api/tokens/*` is gated by Cloudflare Access at the edge as a second factor on top of `ADMIN_API_KEY`.

**Tech Stack:** Docker, s6-overlay v3, Alpine Linux 3.21, PostgreSQL 16, Node.js 20, Fastify 5, Vite 5, nginx, Cloudflare Tunnel + Access.

---

## Specialist Inputs (synthesized)

Three specialists were dispatched in parallel before this plan was written:

- **Network specialist (GREEN):** `192.168.88.65` is free on `br0` (macvlan, subnet `192.168.88.0/24`, gateway `192.168.88.1`, static IPAM). The macvlan host-isolation shim (`macvlan-shim@br0` at `192.168.88.4/32` with a `192.168.88.64/28` host route) is **already in place**, so the host (and Cloudflared in host-netns) can reach `.65`. No network changes required pre-deploy. Recommended MAC: `02:42:c0:a8:58:41` (matches `02:42:c0:a8:58:xx`-where-xx-is-hex-of-last-octet convention).
- **Infrastructure specialist:** Multi-stage Dockerfile (frontend builder, api builder, runtime). s6-rc tree with services `init-postgres-data` (oneshot) → `postgres` (longrun) → `init-postgres-bootstrap` (oneshot) → `init-migrations` (oneshot) → `api` (longrun) and `nginx` (longrun, dependency on `init-migrations` to avoid first-boot 502s). Critical caveats: `api/package.json` lacks `build`/`start` scripts; SQL migration files must be copied to `dist/db/migrations/` after `tsc`.
- **SecDev specialist:** **NOT SAFE** to launch as-is. Seven MUST-FIX items: set `ADMIN_API_KEY`, add startup guard, bind Postgres to `127.0.0.1`, nginx per-IP rate limiting, nginx `client_max_body_size`, Cloudflare Access on `/api/tokens/*`, register `@fastify/helmet`. Five SHOULD-FIX items folded into Phase 0.

---

## File Structure

| File | Responsibility |
|---|---|
| `api/package.json` | Add `build`, `start`, `migrate` scripts and `@fastify/helmet` dep |
| `api/src/app.ts` | Register `@fastify/helmet`; structured logger config |
| `api/src/index.ts` | Listen on `127.0.0.1` (configurable via `HOST` env), production startup guard |
| `api/src/db/client.ts` | pg Pool with explicit limits + `statement_timeout` |
| `api/src/routes/tokens.ts` | Token revocation owner-check |
| `api/src/routes/weight.ts` | Calendar-valid date check (replaces regex-only) |
| `api/src/db/migrations/006_token_prefix_index.sql` | New: functional index on `left(token_hash, 16)` |
| `docker/Dockerfile` | Multi-stage build: frontend → api → runtime on lsio/baseimage-alpine |
| `docker/nginx/repos.conf` | Static SPA + `/api/*` proxy; rate limits, body cap, headers |
| `docker/root/etc/s6-overlay/s6-rc.d/` | s6-rc service tree (postgres, api, nginx, init oneshots) |
| `docker/root/etc/s6-overlay/scripts/init-postgres-data` | First-run initdb + listen_addresses=127.0.0.1 |
| `docker/root/etc/s6-overlay/scripts/init-postgres-bootstrap` | First-run CREATE ROLE + CREATE DATABASE |
| `docker/root/etc/s6-overlay/scripts/init-migrations` | Wait for pg + run `npm run migrate` |
| `docker/root/etc/s6-overlay/scripts/run-api` | Build `DATABASE_URL` from `POSTGRES_*`, exec node |
| `docker/root/etc/s6-overlay/scripts/wait-for-postgres` | Shared `pg_isready` poll loop |
| `.dockerignore` | Exclude `node_modules`, `dist`, `.env`, `tasks/`, `docs/`, etc. |
| `frontend/.env.production` | `VITE_API_URL=/api` (same-origin via nginx) |

**Decisions locked in (no user re-confirmation needed):**

- **Image base:** `lscr.io/linuxserver/baseimage-alpine:3.21` (s6-overlay v3 built in, matches existing `*arr` containers on this Unraid box).
- **No NPM in front of the container.** nginx-in-container handles every job NPM would do (TLS terminates at Cloudflare edge anyway). NPM stays in place for `ha.jpmtech.com` only.
- **Path strip in nginx:** **NONE.** API routes are already registered with `prefix: '/api'` and `prefix: '/api/health'` (see `api/src/app.ts:10-12`). nginx uses `proxy_pass http://127.0.0.1:3001;` (no trailing slash, no rewrite).
- **API package.json fix:** option (a) — add `build` script (`tsc && cp -r src/db/migrations dist/db/`), `start` (`node dist/index.js`), and `migrate:prod` (`node dist/db/migrate.js`). Keep `tsx`-based `dev`/`migrate` for local development.
- **Image hosting:** local `docker build` on Unraid for now (alpha — no CI yet). Plan a GHCR push job later.
- **`DATABASE_URL`:** assembled inside the container by `run-api` from `POSTGRES_*` discrete env vars so the password is set in only one place.
- **Frontend `VITE_API_URL`:** baked at build time to `/api` (same-origin path, served by nginx).
- **Logs:** per-service under `/config/log/{postgres,api,nginx}` for persistence across container recreation.
- **TLS / HSTS:** terminated by Cloudflare; nginx-in-container speaks plain HTTP on the LAN. Skip HSTS at nginx (Cloudflare sets it for `jpmtech.com`).

---

## Phase 0 — Code Changes (repo only, no container yet)

Each task below is in the `api/` directory unless otherwise noted, and ends with a commit. After Phase 0, `npm test` (in `api/`) must still pass all 13 cases.

### Task 1: Add `@fastify/helmet` and register it

**Files:**
- Modify: `api/package.json` (dep)
- Modify: `api/src/app.ts:7-15`

- [ ] **Step 1: Install helmet**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api
npm install @fastify/helmet@^13.0.0
```

- [ ] **Step 2: Register helmet in app.ts**

Update `api/src/app.ts` to:

```typescript
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import helmet from '@fastify/helmet';
import { weightRoutes } from './routes/weight.js';
import { syncRoutes } from './routes/sync.js';
import { tokenRoutes } from './routes/tokens.js';

export async function buildApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({
    logger: opts.logger
      ? {
          redact: { paths: ['req.headers.authorization', 'req.headers["x-admin-key"]'], remove: true },
        }
      : false,
  });
  await app.register(helmet, { contentSecurityPolicy: false }); // CSP set by nginx for HTML; API process serves JSON only
  await app.register(sensible);
  await app.register(tokenRoutes, { prefix: '/api' });
  await app.register(weightRoutes, { prefix: '/api/health' });
  await app.register(syncRoutes, { prefix: '/api/health' });
  app.get('/health', async () => ({ status: 'ok' }));
  return app;
}
```

- [ ] **Step 3: Run tests**

```bash
cd api && npm test
```
Expected: all 13 tests still pass. helmet adds response headers but doesn't change response bodies.

- [ ] **Step 4: Smoke-verify auth header redaction**

```bash
cd api && npm run dev > /tmp/repos-redact.log 2>&1 &
sleep 2
curl -s http://127.0.0.1:3001/api/tokens -H "X-Admin-Key: leak-canary-12345" -H "Authorization: Bearer leak-canary-67890" >/dev/null
sleep 1
kill %1
grep -E "leak-canary-(12345|67890)" /tmp/repos-redact.log && echo "FAIL: secret leaked into log" || echo "OK: redaction working"
```
Expected: `OK: redaction working`. If you see `FAIL`, the pino redact paths are wrong — verify Fastify lowercases header names as expected.

- [ ] **Step 5: Commit**

```bash
git add api/package.json api/package-lock.json api/src/app.ts
git commit -m "security: register @fastify/helmet and redact auth headers in logs"
```

---

### Task 2: API listens on `127.0.0.1` only (configurable via `HOST` env)

**Files:**
- Modify: `api/src/index.ts`

- [ ] **Step 1: Update index.ts to default host to 127.0.0.1**

```typescript
import 'dotenv/config';
import { buildApp } from './app.js';

const app = await buildApp({ logger: true });
const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '127.0.0.1';
await app.listen({ port, host });
```

- [ ] **Step 2: Run tests** — they spin up app via `buildApp().listen({ port: 0, host: '127.0.0.1' })`, so this change is benign for tests.

```bash
cd api && npm test
```
Expected: all 13 pass.

- [ ] **Step 3: Verify dev still works**

```bash
cd api && npm run dev &
sleep 2
curl -sf http://127.0.0.1:3001/health
kill %1
```
Expected: `{"status":"ok"}`. (Don't worry if `pkill` syntax varies — point is: server starts and responds on loopback.)

- [ ] **Step 4: Commit**

```bash
git add api/src/index.ts
git commit -m "security: API listens on 127.0.0.1 by default (override via HOST env)"
```

---

### Task 3: Production startup guard for `ADMIN_API_KEY`

**Files:**
- Modify: `api/src/index.ts` (top, before buildApp)

- [ ] **Step 1: Add guard**

Update `api/src/index.ts`:

```typescript
import 'dotenv/config';
import { buildApp } from './app.js';

if (process.env.NODE_ENV === 'production' && !process.env.ADMIN_API_KEY) {
  console.error('FATAL: ADMIN_API_KEY must be set when NODE_ENV=production');
  process.exit(1);
}

const app = await buildApp({ logger: true });
const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '127.0.0.1';
await app.listen({ port, host });
```

- [ ] **Step 2: Manually verify guard fires**

```bash
cd api && NODE_ENV=production node --loader tsx src/index.ts 2>&1 | head -3
```
Expected output contains `FATAL: ADMIN_API_KEY must be set when NODE_ENV=production` and exit code is non-zero. (You'll see `loader` deprecation noise — ignore.)

- [ ] **Step 3: Verify dev mode still works (no NODE_ENV)**

```bash
cd api && npm run dev &
sleep 2
curl -sf http://127.0.0.1:3001/health
kill %1
```
Expected: `{"status":"ok"}`.

- [ ] **Step 4: Run tests**

```bash
cd api && npm test
```
Expected: 13/13 pass. Tests don't set `NODE_ENV=production` so guard is bypassed.

- [ ] **Step 5: Commit**

```bash
git add api/src/index.ts
git commit -m "security: refuse to boot in production without ADMIN_API_KEY"
```

---

### Task 4: pg Pool limits + `statement_timeout`

**Files:**
- Modify: `api/src/db/client.ts`

- [ ] **Step 1: Replace client.ts with bounded Pool**

```typescript
import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

export const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// Apply per-session statement_timeout on every new connection.
// 5s caps any single query — prevents one stuck query from hanging the API.
db.on('connect', (client) => {
  client.query('SET statement_timeout = 5000').catch((err) => {
    console.error('failed to set statement_timeout', err);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd api && npm test
```
Expected: 13/13 pass. Pool tuning is transparent to test logic.

- [ ] **Step 3: Commit**

```bash
git add api/src/db/client.ts
git commit -m "security: bound pg Pool (max=20, statement_timeout=5s)"
```

---

### Task 5: Token revocation ownership check

**Files:**
- Modify: `api/src/routes/tokens.ts:65-77`

- [ ] **Step 1: Add user_id requirement to DELETE /tokens/:id**

Replace the DELETE handler in `api/src/routes/tokens.ts`:

```typescript
  // Revoke a token — protected by admin API key in production
  // Requires user_id query param so a leaked admin key can't be used to enumerate or revoke
  // tokens belonging to other users.
  app.delete<{ Params: { id: string }; Querystring: { user_id?: string } }>(
    '/tokens/:id',
    { preHandler: requireAdminKey },
    async (req, reply) => {
      const { user_id } = req.query;
      if (!user_id) return reply.code(400).send({ error: 'user_id required' });
      const { rowCount } = await db.query(
        `UPDATE device_tokens SET revoked_at = now()
         WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
        [req.params.id, user_id],
      );
      if (!rowCount) return reply.code(404).send({ error: 'not found' });
      return reply.code(204).send();
    },
  );
```

- [ ] **Step 2: Run tests** — Test #9 ("Revoked Bearer → 401") revokes a token. Check whether the test passes a `user_id` query param.

```bash
cd api && npm test
```

If test #9 fails because the existing test doesn't pass `user_id`:

- [ ] **Step 3 (only if needed): Update test #9** to include `user_id` in the DELETE URL.

Find the revoke call in `api/tests/weight.test.ts` and change `DELETE /api/tokens/${id}` to `DELETE /api/tokens/${id}?user_id=${testUserId}`.

- [ ] **Step 4: Re-run tests**

```bash
cd api && npm test
```
Expected: 13/13 pass.

- [ ] **Step 5: Update frontend revoke call**

The frontend stores the placeholder user ID in `frontend/src/tokens.ts:34` as `PLACEHOLDER_USER_ID`, and the revoke is in `frontend/src/components/settings/SettingsIntegrations.tsx`. Find the `DELETE` fetch:

```bash
grep -n "method.*DELETE\|method:.*'DELETE'" /Users/jasonmeyer.ict/Projects/RepOS/frontend/src/components/settings/SettingsIntegrations.tsx
```

Locate the corresponding `fetch(...)` URL and append the query string. The line currently looks roughly like `fetch(\`${API_BASE}/api/tokens/${id}\`, { method: 'DELETE' })`. Change it to:

```typescript
fetch(`${API_BASE}/api/tokens/${id}?user_id=${PLACEHOLDER_USER_ID}`, { method: 'DELETE' })
```

`PLACEHOLDER_USER_ID` is already imported in this file (`import { ..., PLACEHOLDER_USER_ID } from '../../tokens'` per existing line 2 of SettingsIntegrations.tsx) — no new import needed.

- [ ] **Step 6: Frontend build sanity check**

```bash
cd frontend && npm run build
```
Expected: build succeeds with no TS errors.

- [ ] **Step 7: Commit**

```bash
git add api/src/routes/tokens.ts api/tests/weight.test.ts frontend/src/
git commit -m "security: require user_id on DELETE /api/tokens/:id (defense in depth on admin key compromise)"
```

---

### Task 6: Calendar-valid date check on weight ingest

**Files:**
- Modify: `api/src/routes/weight.ts:13-24`

- [ ] **Step 1: Add a calendar-valid helper and use it**

Replace the `validate` function in `api/src/routes/weight.ts`:

```typescript
function isValidCalendarDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  // Date constructor accepts overflow (e.g. month 13 → Jan next year), so
  // reverse-check that the parsed Date round-trips to the same Y-M-D.
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function isValidTime(s: string): boolean {
  if (!TIME_RE.test(s)) return false;
  const [h, m, sec] = s.split(':').map(Number);
  return h < 24 && m < 60 && sec < 60;
}

function validate(body: any): { error: string; field: string } | null {
  const { weight_lbs, date, time, source } = body;
  if (weight_lbs == null || typeof weight_lbs !== 'number' || !isFinite(weight_lbs) || weight_lbs < 50.0 || weight_lbs > 600.0)
    return { error: 'weight_lbs must be between 50.0 and 600.0', field: 'weight_lbs' };
  if (!date || !isValidCalendarDate(date))
    return { error: 'date must be a valid YYYY-MM-DD calendar date', field: 'date' };
  if (!time || !isValidTime(time))
    return { error: 'time must be HH:MM:SS', field: 'time' };
  if (!VALID_SOURCES.includes(source))
    return { error: `source must be one of: ${VALID_SOURCES.join(', ')}`, field: 'source' };
  return null;
}
```

- [ ] **Step 2: Run tests**

```bash
cd api && npm test
```
Expected: 13/13 pass. Test #7 ("`date='04/26/2026'` → 400 field=date") still fails the regex; new logic doesn't affect it. No test exercises `2026-99-99`-style invalid calendar dates yet — that case is now handled but not asserted.

- [ ] **Step 3: Add a test for invalid-calendar date**

In `api/tests/weight.test.ts`, near test #7, add:

```typescript
it('14: rejects 2026-13-01 with field=date (calendar-invalid)', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/health/weight',
    headers: { authorization: `Bearer ${token}` },
    payload: { weight_lbs: 180, date: '2026-13-01', time: '07:00:00', source: 'Apple Health' },
  });
  expect(res.statusCode).toBe(400);
  expect(res.json().field).toBe('date');
});
```

(Adapt the imports/setup to match the existing test file — copy from test #7.)

- [ ] **Step 4: Run tests** — confirm 14/14 pass now.

```bash
cd api && npm test
```

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/weight.ts api/tests/weight.test.ts
git commit -m "security: reject calendar-invalid dates (e.g. 2026-13-01) with clean 400"
```

---

### Task 7: Migration 006 — token prefix functional index

**Files:**
- Create: `api/src/db/migrations/006_token_prefix_index.sql`

- [ ] **Step 1: Write the migration**

Create `api/src/db/migrations/006_token_prefix_index.sql`:

```sql
-- The auth middleware queries `WHERE token_hash LIKE 'prefix:%'` (api/src/middleware/auth.ts:28-29).
-- For btree indexes to support LIKE prefix patterns, the index must use a `*_pattern_ops`
-- opclass — the default opclass is locale-aware and does NOT enable LIKE optimization.
-- Conditional WHERE keeps the index small (only active tokens are searchable via this path).
CREATE INDEX IF NOT EXISTS idx_device_tokens_prefix
  ON device_tokens (token_hash text_pattern_ops)
  WHERE revoked_at IS NULL;
```

- [ ] **Step 2: Run migrate locally to apply it**

```bash
cd api && npm run migrate
```
Expected: `✓ 006_token_prefix_index.sql` then `Migrations complete.`

- [ ] **Step 3: Verify index exists AND is actually used by the auth query**

```bash
DBURL=$(grep DATABASE_URL api/.env | cut -d= -f2-)
psql "$DBURL" -c "\d device_tokens"
psql "$DBURL" -c "EXPLAIN SELECT id, user_id, token_hash FROM device_tokens WHERE token_hash LIKE 'aaaabbbbccccdddd:%' AND revoked_at IS NULL;"
```
Expected: `\d` shows `idx_device_tokens_prefix`. `EXPLAIN` shows `Index Scan using idx_device_tokens_prefix` (or `Bitmap Index Scan`) — NOT `Seq Scan`. If it shows Seq Scan even with the index present, the table is too small for the planner to bother — that's fine for now, the index is in place for when the table grows.

- [ ] **Step 4: Run tests**

```bash
cd api && npm test
```
Expected: 14/14 pass. Tests run against the same DB; index is invisible to test logic but speeds future auth lookups.

- [ ] **Step 5: Commit**

```bash
git add api/src/db/migrations/006_token_prefix_index.sql
git commit -m "perf: text_pattern_ops index on device_tokens.token_hash for LIKE-prefix lookups"
```

---

### Task 8: Add `build`, `start`, `migrate:prod` scripts to api/package.json

**Files:**
- Modify: `api/package.json`

- [ ] **Step 1: Update scripts block**

In `api/package.json`, replace the `"scripts"` section with:

```json
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "migrate": "tsx src/db/migrate.ts",
    "build": "tsc && mkdir -p dist/db/migrations && cp src/db/migrations/*.sql dist/db/migrations/",
    "start": "node dist/index.js",
    "migrate:prod": "node dist/db/migrate.js",
    "test": "vitest run"
  },
```

- [ ] **Step 2: Run a clean production build locally**

```bash
cd api && rm -rf dist && npm run build && ls dist/db/migrations/
```
Expected: `dist/` populated, `dist/db/migrations/` contains all 6 SQL files.

- [ ] **Step 3: Smoke-test the production build**

```bash
cd api && PORT=3099 ADMIN_API_KEY=test-key NODE_ENV=production HOST=127.0.0.1 node dist/index.js &
sleep 2
curl -sf http://127.0.0.1:3099/health
kill %1
```
Expected: `{"status":"ok"}`.

- [ ] **Step 4: Run tests** (still using the dev `tsx` path)

```bash
cd api && npm test
```
Expected: 14/14 pass. Building dist/ doesn't change test behavior.

- [ ] **Step 5: Commit**

```bash
git add api/package.json
git commit -m "build: add tsc-based build/start/migrate:prod scripts for production runtime"
```

---

### Phase 0 checkpoint

After Tasks 1–8: all 14 tests pass, `npm run build` produces a runnable `dist/`, all MUST-FIX/SHOULD-FIX security items closed at the code layer. Container artifacts come next.

---

## Phase 1 — Container Artifacts

All paths in this phase are relative to repo root unless noted. After Phase 1, you should be able to `docker build -t repos:dev docker/` (from repo root) and `docker run` it locally on a test port.

### Task 9: `.dockerignore` and `frontend/.env.production`

**Files:**
- Create: `.dockerignore`
- Create: `frontend/.env.production`

- [ ] **Step 1: Write `.dockerignore`**

Create `/Users/jasonmeyer.ict/Projects/RepOS/.dockerignore`:

```
**/node_modules
**/dist
**/.env
**/.env.local
**/.env.*.local
.git
.gitignore
docs/
tasks/
HANDOFF.md
PASSDOWN.md
RepOS.html
*.jsx
screenshot.png
api/coverage
frontend/coverage
api/.vscode
frontend/.vscode
.DS_Store
```

- [ ] **Step 2: Write `frontend/.env.production`**

Create `/Users/jasonmeyer.ict/Projects/RepOS/frontend/.env.production`:

```
VITE_API_URL=/api
```

- [ ] **Step 3: Commit**

```bash
git add .dockerignore frontend/.env.production
git commit -m "build: add .dockerignore and same-origin VITE_API_URL for prod"
```

---

### Task 10: Multi-stage Dockerfile

**Files:**
- Create: `docker/Dockerfile`

- [ ] **Step 1: Write the Dockerfile**

Create `/Users/jasonmeyer.ict/Projects/RepOS/docker/Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1.6

# ─── Stage 1: frontend builder ──────────────────────────────────
FROM node:20-alpine AS frontend-builder
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build
# Output: /build/frontend/dist

# ─── Stage 2: api builder ───────────────────────────────────────
FROM node:20-alpine AS api-builder
WORKDIR /build/api
COPY api/package.json api/package-lock.json ./
RUN npm ci
COPY api/ ./
RUN npm run build && npm prune --omit=dev
# Output: /build/api/dist + pruned /build/api/node_modules

# ─── Stage 3: runtime ───────────────────────────────────────────
FROM lscr.io/linuxserver/baseimage-alpine:3.21

# Runtime packages: postgres + node + nginx + tooling.
# postgresql-client supplies pg_isready and psql for init scripts.
RUN apk add --no-cache \
      nodejs \
      postgresql16 \
      postgresql16-client \
      postgresql16-contrib \
      nginx \
      bash \
      tzdata

# Verify postgres binaries are where the s6 scripts expect them.
# Alpine's postgresql16 package puts binaries in /usr/bin/. Fail the build
# loudly if a future Alpine release moves them.
RUN test -x /usr/bin/postgres && test -x /usr/bin/initdb && test -x /usr/bin/pg_isready

# App layout (lsio uses /config for persistent data; /app for read-only code)
RUN mkdir -p /app/api /app/frontend /config

COPY --from=api-builder      /build/api/dist          /app/api/dist
COPY --from=api-builder      /build/api/node_modules  /app/api/node_modules
COPY --from=api-builder      /build/api/package.json  /app/api/package.json
COPY --from=frontend-builder /build/frontend/dist     /app/frontend

# nginx config + s6 service tree
COPY docker/nginx/repos.conf  /etc/nginx/http.d/default.conf
COPY docker/root/             /

# Make all script files executable (COPY does not preserve unless explicit)
RUN find /etc/s6-overlay -type f \( -name 'run' -o -name 'up' -o -path '*scripts*' \) -exec chmod +x {} +

# lsio's stock cont-init.d chowns /config recursively to abc:abc (PUID:PGID).
# That would steal /config/postgres from the postgres user (uid 70) on every
# boot and break initdb's chmod-700 contract. This hook re-asserts ownership
# AFTER the lsio chown loop runs (filename order: 99-* runs last).
RUN mkdir -p /etc/cont-init.d && \
    printf '#!/usr/bin/with-contenv bash\nif [ -d /config/postgres ]; then\n  chown -R postgres:postgres /config/postgres\n  chmod 700 /config/postgres\nfi\n' \
      > /etc/cont-init.d/99-postgres-perms && \
    chmod +x /etc/cont-init.d/99-postgres-perms

EXPOSE 80

# Healthcheck: nginx → /health (proxied to API)
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO- http://127.0.0.1/health || exit 1

# baseimage-alpine sets ENTRYPOINT ["/init"] which boots s6-overlay v3.
```

- [ ] **Step 2: Commit (don't build yet — services don't exist)**

```bash
git add docker/Dockerfile
git commit -m "build: multi-stage Dockerfile (frontend → api → lsio runtime)"
```

---

### Task 11: nginx config

**Files:**
- Create: `docker/nginx/repos.conf`

- [ ] **Step 1: Write the nginx server block**

Create `/Users/jasonmeyer.ict/Projects/RepOS/docker/nginx/repos.conf`:

```nginx
# Per-IP rate limit zones. ~10MB tracks ~160K unique IPs.
limit_req_zone $binary_remote_addr zone=api:10m   rate=10r/s;
limit_req_zone $binary_remote_addr zone=admin:10m rate=2r/s;

server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    root /app/frontend;
    index index.html;

    # Cap body size before Fastify sees it. Backfill of 500 samples ≈ 50KB.
    # 256KB leaves headroom for whitespace and oversized payloads to be 413'd cheaply.
    client_max_body_size 256k;

    gzip on;
    gzip_min_length 1024;
    gzip_types text/css application/javascript application/json image/svg+xml application/xml;

    # Security headers — Cloudflare terminates TLS and sets HSTS for jpmtech.com.
    # Skipping HSTS here avoids subdomain-include conflicts with the parent zone.
    add_header X-Content-Type-Options "nosniff"               always;
    add_header X-Frame-Options        "DENY"                  always;
    add_header Referrer-Policy        "no-referrer"           always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'" always;

    # Admin token routes — tight rate limit, expected to be gated by Cloudflare Access at the edge.
    location /api/tokens {
        limit_req zone=admin burst=5 nodelay;
        proxy_pass         http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $http_x_forwarded_proto;
    }

    # Main API.
    location /api/ {
        limit_req zone=api burst=20 nodelay;
        proxy_pass         http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $http_x_forwarded_proto;
    }

    # Healthcheck path — bypasses limits, used by Docker HEALTHCHECK and Cloudflare.
    location = /health {
        proxy_pass         http://127.0.0.1:3001/health;
        access_log off;
    }

    # SPA fallback — every non-asset request returns index.html.
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add docker/nginx/repos.conf
git commit -m "build: nginx server block — SPA, /api proxy, rate limits, security headers"
```

---

### Task 12: s6-overlay v3 service tree

**Files (all under `docker/root/`):**
- Create: `docker/root/etc/s6-overlay/s6-rc.d/user/contents.d/postgres` (empty)
- Create: `docker/root/etc/s6-overlay/s6-rc.d/user/contents.d/api` (empty)
- Create: `docker/root/etc/s6-overlay/s6-rc.d/user/contents.d/nginx` (empty)
- Create: `docker/root/etc/s6-overlay/s6-rc.d/init-postgres-data/{type,up}` and `dependencies.d/base`
- Create: `docker/root/etc/s6-overlay/s6-rc.d/postgres/{type,run}` and `dependencies.d/init-postgres-data`
- Create: `docker/root/etc/s6-overlay/s6-rc.d/init-postgres-bootstrap/{type,up}` and `dependencies.d/postgres`
- Create: `docker/root/etc/s6-overlay/s6-rc.d/init-migrations/{type,up}` and `dependencies.d/init-postgres-bootstrap`
- Create: `docker/root/etc/s6-overlay/s6-rc.d/api/{type,run}` and `dependencies.d/init-migrations`
- Create: `docker/root/etc/s6-overlay/s6-rc.d/nginx/{type,run}` and `dependencies.d/init-migrations`
- Create: `docker/root/etc/s6-overlay/scripts/wait-for-postgres`
- Create: `docker/root/etc/s6-overlay/scripts/init-postgres-data`
- Create: `docker/root/etc/s6-overlay/scripts/init-postgres-bootstrap`
- Create: `docker/root/etc/s6-overlay/scripts/init-migrations`
- Create: `docker/root/etc/s6-overlay/scripts/run-api`

- [ ] **Step 1: Create the service-tree skeleton (one shell command)**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS
mkdir -p docker/root/etc/s6-overlay/scripts
mkdir -p docker/root/etc/s6-overlay/s6-rc.d/user/contents.d
mkdir -p docker/root/etc/s6-overlay/s6-rc.d/init-postgres-data/dependencies.d
mkdir -p docker/root/etc/s6-overlay/s6-rc.d/postgres/dependencies.d
mkdir -p docker/root/etc/s6-overlay/s6-rc.d/init-postgres-bootstrap/dependencies.d
mkdir -p docker/root/etc/s6-overlay/s6-rc.d/init-migrations/dependencies.d
mkdir -p docker/root/etc/s6-overlay/s6-rc.d/api/dependencies.d
mkdir -p docker/root/etc/s6-overlay/s6-rc.d/nginx/dependencies.d
touch docker/root/etc/s6-overlay/s6-rc.d/user/contents.d/postgres
touch docker/root/etc/s6-overlay/s6-rc.d/user/contents.d/api
touch docker/root/etc/s6-overlay/s6-rc.d/user/contents.d/nginx
```

- [ ] **Step 2: Write `type` files**

```bash
echo "oneshot" > docker/root/etc/s6-overlay/s6-rc.d/init-postgres-data/type
echo "longrun" > docker/root/etc/s6-overlay/s6-rc.d/postgres/type
echo "oneshot" > docker/root/etc/s6-overlay/s6-rc.d/init-postgres-bootstrap/type
echo "oneshot" > docker/root/etc/s6-overlay/s6-rc.d/init-migrations/type
echo "longrun" > docker/root/etc/s6-overlay/s6-rc.d/api/type
echo "longrun" > docker/root/etc/s6-overlay/s6-rc.d/nginx/type
```

- [ ] **Step 3: Write `dependencies.d` markers**

```bash
touch docker/root/etc/s6-overlay/s6-rc.d/init-postgres-data/dependencies.d/base
touch docker/root/etc/s6-overlay/s6-rc.d/postgres/dependencies.d/init-postgres-data
touch docker/root/etc/s6-overlay/s6-rc.d/init-postgres-bootstrap/dependencies.d/postgres
touch docker/root/etc/s6-overlay/s6-rc.d/init-migrations/dependencies.d/init-postgres-bootstrap
touch docker/root/etc/s6-overlay/s6-rc.d/api/dependencies.d/init-migrations
touch docker/root/etc/s6-overlay/s6-rc.d/nginx/dependencies.d/init-migrations
```

- [ ] **Step 4: Write `up` and `run` invocations** (each just exec's the matching script)

```bash
cat > docker/root/etc/s6-overlay/s6-rc.d/init-postgres-data/up <<'EOF'
/etc/s6-overlay/scripts/init-postgres-data
EOF

cat > docker/root/etc/s6-overlay/s6-rc.d/postgres/run <<'EOF'
#!/usr/bin/with-contenv bash
mkdir -p /config/log/postgres
exec s6-setuidgid postgres /usr/bin/postgres -D /config/postgres -c log_destination=stderr -k /tmp 2>&1
EOF

cat > docker/root/etc/s6-overlay/s6-rc.d/init-postgres-bootstrap/up <<'EOF'
/etc/s6-overlay/scripts/init-postgres-bootstrap
EOF

cat > docker/root/etc/s6-overlay/s6-rc.d/init-migrations/up <<'EOF'
/etc/s6-overlay/scripts/init-migrations
EOF

cat > docker/root/etc/s6-overlay/s6-rc.d/api/run <<'EOF'
#!/usr/bin/with-contenv bash
mkdir -p /config/log/api
exec /etc/s6-overlay/scripts/run-api 2>&1
EOF

cat > docker/root/etc/s6-overlay/s6-rc.d/nginx/run <<'EOF'
#!/usr/bin/with-contenv bash
mkdir -p /config/log/nginx
exec nginx -g "daemon off;" 2>&1
EOF
```

> Alpine's postgresql16 package installs binaries at `/usr/bin/postgres` (and `/usr/bin/initdb`, `/usr/bin/pg_isready`). The Dockerfile in Task 10 already includes a `RUN test -x /usr/bin/postgres ...` build-time check that fails the build if a future Alpine moves them. Using `s6-setuidgid` (ships with s6-overlay v3) instead of `su-exec` keeps the dependency surface tighter — same effect.

- [ ] **Step 5: Write `wait-for-postgres` helper**

```bash
cat > docker/root/etc/s6-overlay/scripts/wait-for-postgres <<'EOF'
#!/usr/bin/with-contenv bash
# Block until postgres is accepting connections, or fail loudly after timeout.
TIMEOUT="${PG_READY_TIMEOUT:-60}"
for i in $(seq 1 "$TIMEOUT"); do
  if pg_isready -h 127.0.0.1 -p 5432 -U postgres -d postgres -q; then
    exit 0
  fi
  sleep 1
done
echo "FATAL: postgres did not become ready in ${TIMEOUT}s" >&2
exit 1
EOF
```

- [ ] **Step 6: Write `init-postgres-data`** — first-run initdb + listen_addresses

```bash
cat > docker/root/etc/s6-overlay/scripts/init-postgres-data <<'EOF'
#!/usr/bin/with-contenv bash
set -euo pipefail

# Validate env values that get interpolated into SQL or filesystem paths later.
# Reject anything outside [A-Za-z0-9_] for user/db; reject single-quote and
# backslash in the password to keep the bootstrap heredoc safe.
: "${POSTGRES_PASSWORD:?FATAL: POSTGRES_PASSWORD must be set}"
USER_NAME="${POSTGRES_USER:-repos}"
DB_NAME="${POSTGRES_DB:-repos}"
[[ "$USER_NAME" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || { echo "FATAL: POSTGRES_USER contains invalid characters" >&2; exit 1; }
[[ "$DB_NAME"   =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || { echo "FATAL: POSTGRES_DB contains invalid characters" >&2; exit 1; }
[[ "$POSTGRES_PASSWORD" != *\'* && "$POSTGRES_PASSWORD" != *\\* ]] || { echo "FATAL: POSTGRES_PASSWORD must not contain ' or \\" >&2; exit 1; }

PGDATA=/config/postgres
mkdir -p "$PGDATA"
chown -R postgres:postgres "$PGDATA"
chmod 700 "$PGDATA"

if [ ! -f "$PGDATA/PG_VERSION" ]; then
  echo "First run: initializing postgres data dir at $PGDATA"
  pwfile=$(mktemp)
  chown postgres:postgres "$pwfile"
  printf '%s' "$POSTGRES_PASSWORD" > "$pwfile"
  chmod 600 "$pwfile"
  s6-setuidgid postgres /usr/bin/initdb \
    -D "$PGDATA" \
    --auth-local=trust \
    --auth-host=scram-sha-256 \
    --username=postgres \
    --pwfile="$pwfile" \
    --encoding=UTF8
  rm -f "$pwfile"

  # Lock down network exposure: loopback only.
  sed -i "s|^#*listen_addresses.*|listen_addresses = '127.0.0.1'|" "$PGDATA/postgresql.conf"
  echo "unix_socket_directories = '/tmp'" >> "$PGDATA/postgresql.conf"

  # Trust local socket (root inside container talks via socket as postgres);
  # require scram on TCP loopback (API connects this way).
  cat > "$PGDATA/pg_hba.conf" <<HBA
local   all   all                trust
host    all   all   127.0.0.1/32 scram-sha-256
host    all   all   ::1/128      scram-sha-256
HBA

  # Mark first-run so init-postgres-bootstrap knows to create role + db.
  touch "$PGDATA/.bootstrap-needed"
  chown postgres:postgres "$PGDATA/.bootstrap-needed"
fi
EOF
```

- [ ] **Step 7: Write `init-postgres-bootstrap`** — first-run role + db

```bash
cat > docker/root/etc/s6-overlay/scripts/init-postgres-bootstrap <<'EOF'
#!/usr/bin/with-contenv bash
set -euo pipefail

PGDATA=/config/postgres
[ -f "$PGDATA/.bootstrap-needed" ] || exit 0

/etc/s6-overlay/scripts/wait-for-postgres

DB="${POSTGRES_DB:-repos}"
USER="${POSTGRES_USER:-repos}"

# Re-validate (init-postgres-data already did this on first run, but a manual
# rerun could land here directly). Same regex contract.
[[ "$USER" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || { echo "FATAL: POSTGRES_USER invalid" >&2; exit 1; }
[[ "$DB"   =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || { echo "FATAL: POSTGRES_DB invalid"   >&2; exit 1; }
[[ "$POSTGRES_PASSWORD" != *\'* && "$POSTGRES_PASSWORD" != *\\* ]] || { echo "FATAL: POSTGRES_PASSWORD invalid" >&2; exit 1; }

# Use the unix socket with trust auth — no superuser password needed here.
# Heredoc is unquoted ('SQL' would prevent expansion); bash strips backslashes
# from \$\$ so psql sees the proper $$ DO-block delimiters.
psql -h /tmp -U postgres -d postgres -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${USER}') THEN
    CREATE ROLE "${USER}" LOGIN PASSWORD '${POSTGRES_PASSWORD}';
  END IF;
END
\$\$;
SQL

# CREATE DATABASE cannot run inside a DO block. \gexec only works on script
# input streams (heredoc / -f), NOT inside a -c argument — so use a heredoc.
psql -h /tmp -U postgres -d postgres -v ON_ERROR_STOP=1 <<SQL
SELECT format('CREATE DATABASE %I OWNER %I', '${DB}', '${USER}')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '${DB}')\gexec
SQL

rm -f "$PGDATA/.bootstrap-needed"
echo "Bootstrap complete: role=${USER} db=${DB}"
EOF
```

- [ ] **Step 8: Write `init-migrations`** — wait for pg, run migrations once

```bash
cat > docker/root/etc/s6-overlay/scripts/init-migrations <<'EOF'
#!/usr/bin/with-contenv bash
set -euo pipefail

/etc/s6-overlay/scripts/wait-for-postgres

DB="${POSTGRES_DB:-repos}"
USER="${POSTGRES_USER:-repos}"
export DATABASE_URL="postgres://${USER}:${POSTGRES_PASSWORD}@127.0.0.1:5432/${DB}"

cd /app/api
node dist/db/migrate.js
EOF
```

- [ ] **Step 9: Write `run-api`** — assemble DATABASE_URL, exec node

```bash
cat > docker/root/etc/s6-overlay/scripts/run-api <<'EOF'
#!/usr/bin/with-contenv bash
set -euo pipefail

DB="${POSTGRES_DB:-repos}"
USER="${POSTGRES_USER:-repos}"
export DATABASE_URL="postgres://${USER}:${POSTGRES_PASSWORD}@127.0.0.1:5432/${DB}"
export NODE_ENV="${NODE_ENV:-production}"
export HOST=127.0.0.1
export PORT=3001

cd /app/api
exec node dist/index.js
EOF
```

- [ ] **Step 10: Make scripts executable**

```bash
chmod +x docker/root/etc/s6-overlay/scripts/*
chmod +x docker/root/etc/s6-overlay/s6-rc.d/*/run \
         docker/root/etc/s6-overlay/s6-rc.d/*/up 2>/dev/null || true
```

- [ ] **Step 11: Commit**

```bash
git add docker/root/
git commit -m "build: s6-overlay v3 service tree (postgres, api, nginx + init oneshots)"
```

---

### Task 13: Local image build (sanity check on Mac)

> Mac is ARM. We pass `--platform linux/amd64` so the image is buildable now and runnable on Unraid x86_64 later. The actual deploy will rebuild on Unraid, but this catches Dockerfile syntax / s6 wiring errors locally.

- [ ] **Step 1: Build**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS
docker build --platform linux/amd64 -t repos:dev -f docker/Dockerfile .
```
Expected: builds to completion, no errors. Allow ~3-5 min on first build.

- [ ] **Step 2: Run locally on a non-conflicting port**

```bash
docker rm -f repos-test 2>/dev/null
docker run -d --name repos-test --platform linux/amd64 \
  -p 8088:80 \
  -e PUID=99 -e PGID=100 -e TZ=America/New_York \
  -e POSTGRES_PASSWORD=devpw \
  -e ADMIN_API_KEY=devkey \
  -v /tmp/repos-test-config:/config \
  repos:dev
```

- [ ] **Step 3: Wait for healthy state and check logs**

```bash
for i in $(seq 1 30); do
  state=$(docker inspect -f '{{.State.Health.Status}}' repos-test 2>/dev/null || echo missing)
  echo "$i: $state"
  [ "$state" = "healthy" ] && break
  sleep 2
done
docker logs repos-test 2>&1 | tail -50
```
Expected: container reaches `healthy`. Logs show postgres started, migrations ran (`✓ 001_…` … `✓ 006_…`), API listening on 127.0.0.1:3001, nginx serving.

- [ ] **Step 4: Smoke-test endpoints**

```bash
curl -sf http://127.0.0.1:8088/health
curl -si http://127.0.0.1:8088/api/health/sync/status   # expect 401 (no token)
curl -si http://127.0.0.1:8088/                         # expect 200 + index.html
```
Expected: `{"status":"ok"}`, 401 on /api/, frontend HTML on `/`.

- [ ] **Step 5: Mint a token via admin key, then exercise weight ingest**

```bash
curl -sX POST http://127.0.0.1:8088/api/tokens \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: devkey" \
  -d '{"user_id":"00000000-0000-0000-0000-000000000001","label":"smoke"}'
```
Expected: 400 with `user_id required` if user record doesn't exist OR a token if your migrations seed test users. (If 400 because of missing user, just shows the FK constraint works — not a failure.)

- [ ] **Step 6: Cleanup**

```bash
docker rm -f repos-test
sudo rm -rf /tmp/repos-test-config
```

- [ ] **Step 7: Commit if any tweaks were needed during smoke** (otherwise skip).

```bash
git status
# if dockerfile/scripts had to change:
git add docker/
git commit -m "fix: <what you fixed during smoke>"
```

---

### Phase 1 checkpoint

After Tasks 9–13: image builds clean, runs locally, all three services up, migrations apply, healthcheck green. Ready to ship to Unraid.

---

## Phase 2 — Deploy to Unraid

### Task 14: Transfer repo to Unraid and build

> Unraid will build the image natively (x86_64). Repo lives at `/mnt/user/appdata/repos/build/` for the build context. The runtime `/config` volume is separate at `/mnt/user/appdata/repos/config/`.

- [ ] **Step 1: Rsync repo to Unraid (excluding noise)**

From your Mac:

```bash
rsync -av --delete \
  --exclude=node_modules --exclude=dist --exclude=.git \
  --exclude='**/.env' --exclude='**/.env.local' \
  --exclude=docs --exclude=tasks \
  /Users/jasonmeyer.ict/Projects/RepOS/ \
  unraid:/mnt/user/appdata/repos/build/
```

- [ ] **Step 2: Build the image on Unraid**

```bash
ssh unraid 'cd /mnt/user/appdata/repos/build && docker build -t repos:latest -f docker/Dockerfile .'
```
Expected: clean build. Note the final image ID.

- [ ] **Step 3: Verify the image is present**

```bash
ssh unraid 'docker images repos --format "{{.Repository}}:{{.Tag}}\t{{.Size}}\t{{.CreatedAt}}"'
```
Expected: `repos:latest` listed.

---

### Task 15: Stop and retire the old `repos-postgres` container

- [ ] **Step 1: Stop and remove**

```bash
ssh unraid 'docker stop repos-postgres && docker rm repos-postgres'
```

- [ ] **Step 2: Confirm it's gone**

```bash
ssh unraid 'docker ps -a --filter "name=repos-postgres"'
```
Expected: empty list.

- [ ] **Step 3: Optional — remove its old data volume**

The old container's data volume is at `/mnt/user/appdata/repos-postgres`. New container uses `/mnt/user/appdata/repos/config/postgres`. Per alpha-state policy, the old data is throwaway:

```bash
ssh unraid 'ls /mnt/user/appdata/repos-postgres 2>/dev/null && rm -rf /mnt/user/appdata/repos-postgres || echo "(none to remove)"'
```

---

### Task 16: Generate secrets and run the new container

- [ ] **Step 1: Generate secrets locally and capture them**

```bash
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
echo "ADMIN_API_KEY=$(openssl rand -hex 32)"
```

Save both somewhere safe (1Password / Bitwarden — NOT in the repo). You'll paste them into the env file in the next step.

- [ ] **Step 2: Write the env file on Unraid (root-only readable)**

```bash
ssh unraid 'mkdir -p /mnt/user/appdata/repos && cat > /mnt/user/appdata/repos/.env <<EOF
POSTGRES_DB=repos
POSTGRES_USER=repos
POSTGRES_PASSWORD=<paste-from-step-1>
ADMIN_API_KEY=<paste-from-step-1>
TZ=America/New_York
NODE_ENV=production
EOF
chown root:root /mnt/user/appdata/repos/.env
chmod 600 /mnt/user/appdata/repos/.env'
```

(Edit the heredoc to substitute the actual generated values — do not commit them anywhere.)

> Note on disk-level secret exposure: `/mnt/user/appdata` lives on the Unraid array. The `appdata` share is configured by default as not-exported on SMB/NFS, but verify in **Unraid → Shares → appdata** that **Export = No** before considering secrets at-rest safe. If the share is exported, either disable the export or move secrets to Docker secrets.

- [ ] **Step 3: Run the container**

```bash
ssh unraid 'docker run -d \
  --name RepOS \
  --network br0 \
  --ip 192.168.88.65 \
  --mac-address 02:42:c0:a8:58:41 \
  --restart unless-stopped \
  --env-file /mnt/user/appdata/repos/.env \
  -e PUID=99 -e PGID=100 \
  -v /mnt/user/appdata/repos/config:/config \
  repos:latest'
```

- [ ] **Step 4: Verify it's running and healthy**

```bash
ssh unraid 'docker ps --filter name=RepOS --format "{{.Names}}\t{{.Status}}\t{{.Ports}}"'
sleep 30
ssh unraid 'docker inspect -f "{{.State.Health.Status}}" RepOS'
```
Expected: `Up X seconds (healthy)`.

- [ ] **Step 5: Check logs for clean startup**

```bash
ssh unraid 'docker logs RepOS 2>&1 | tail -80'
```
Expected: postgres bootstrapped (or skipped if rerun), 6 migrations applied, API listening on 127.0.0.1:3001, nginx serving on 80.

- [ ] **Step 6: LAN smoke-test from your Mac**

```bash
curl -sf http://192.168.88.65/health
curl -si http://192.168.88.65/ | head -5
```
Expected: `{"status":"ok"}` and HTML index page.

- [ ] **Step 7: Verify Postgres is NOT exposed on the macvlan IP — RUN FROM YOUR MAC, NOT FROM UNRAID**

> Vantage point matters: Unraid's macvlan-shim has a host route to `.65` (used by Cloudflared), so running this from the Unraid host shell could exercise a different network path than a regular LAN client. Run from your Mac (or another LAN host) for a meaningful test.

```bash
# On your Mac (NOT via ssh unraid):
nc -zv 192.168.88.65 5432 -w 3
```
Expected: `Connection refused`. Either "refused" or "no route" passes — both mean external clients cannot reach Postgres. A successful connect or a long timeout would be the failure mode.

- [ ] **Step 8: Verify the new container's MAC populated the LAN ARP cache cleanly**

```bash
ssh unraid 'arp -an | grep 192.168.88.65'
```
Expected: one line containing `02:42:c0:a8:58:41` (the pinned MAC). If the line is missing or shows a different MAC, you've hit a collision — investigate before proceeding to Cloudflare Tunnel config.

---

### Phase 2 checkpoint

After Tasks 14–16: `RepOS` container running on Unraid at `192.168.88.65`, all three internal services healthy, frontend reachable on the LAN, postgres not externally exposed.

---

## Phase 3 — Cloudflare Tunnel + Access

These steps are **manual in the Cloudflare Zero Trust dashboard**. The existing tunnel (`364493ed-4ee9-...`) runs as a token-based service on Unraid; configuration lives in the dashboard.

### Task 17: Add public hostname mapping `repos.jpmtech.com` → `http://192.168.88.65:80`

- [ ] **Step 1:** Navigate to **Cloudflare Zero Trust → Networks → Tunnels** and find the tunnel running on Tower (the active one).

- [ ] **Step 2:** Open the tunnel → **Public Hostname** tab → **Add a public hostname**.

- [ ] **Step 3:** Configure:
  - **Subdomain:** `repos`
  - **Domain:** `jpmtech.com`
  - **Path:** (leave blank)
  - **Service Type:** `HTTP`
  - **URL:** `192.168.88.65:80`
  - **Additional application settings → HTTP Settings:**
    - HTTP Host Header: `repos.jpmtech.com` (so nginx sees the right host)
  - Save.

- [ ] **Step 4:** Wait ~30 seconds for DNS propagation, then test:

```bash
curl -sf https://repos.jpmtech.com/health
```
Expected: `{"status":"ok"}`.

- [ ] **Step 5:** Test the frontend in a browser at `https://repos.jpmtech.com/`. Expected: React app loads, sync pill shows error state (no auth) — this is the documented placeholder behavior until login lands.

---

### Task 18: Cloudflare Access policy on `/api/tokens/*`

- [ ] **Step 1:** Navigate to **Zero Trust → Access → Applications → Add an application** → **Self-hosted**.

- [ ] **Step 2:** Configure:
  - **Application name:** `RepOS Admin Tokens`
  - **Session duration:** 24 hours
  - **Application domain:** `repos.jpmtech.com`
  - **Path:** `/api/tokens` (covers `/api/tokens` and `/api/tokens/*`)

- [ ] **Step 3:** Add a policy:
  - **Policy name:** `Owner only`
  - **Action:** Allow
  - **Configure rules → Include:** `Emails` → `jmeyer@ironcloudtech.com`

- [ ] **Step 4:** Save.

- [ ] **Step 5:** Verify with curl (no Access cookie → should be redirected/blocked):

```bash
curl -sI https://repos.jpmtech.com/api/tokens?user_id=test
```
Expected: HTTP 302/401 to a Cloudflare Access challenge URL — NOT a direct API response.

- [ ] **Step 6:** In a browser, visit `https://repos.jpmtech.com/api/tokens?user_id=00000000-0000-0000-0000-000000000001` and complete email auth. Expected: redirected back; without `X-Admin-Key` header, the API still returns 401 (defense in depth working).

---

### Phase 3 checkpoint

After Tasks 17–18: `repos.jpmtech.com` resolves publicly, frontend loads, `/api/tokens/*` is gated by Cloudflare Access *and* `ADMIN_API_KEY`. Public exposure is now safe per the SecDev sign-off conditions.

---

## Phase 4 — Sign-off

### Task 19: Update PASSDOWN.md with deployment state

**Files:**
- Modify: `PASSDOWN.md`

- [ ] **Step 1: Update the "What's Built" table**

In `PASSDOWN.md`, change:

| NginxProxyManager routing (Unraid) | ❌ Not configured — API not yet publicly reachable |

to:

| Public ingress (Cloudflare Tunnel + Access) | ✅ `repos.jpmtech.com` live; `/api/tokens/*` Access-gated |

- [ ] **Step 2: Replace "Running Locally → Backend" prerequisites note** about Postgres on Unraid with: "Production runs as a single container `RepOS` on Unraid macvlan `192.168.88.65`. Image built from `docker/Dockerfile` in this repo. See `docs/superpowers/plans/2026-05-03-repos-monolithic-container.md` for build/deploy steps."

- [ ] **Step 3: Update Open Security Items section** — strike through the items closed in Phase 0 (helmet, pg pool limits, date validation, token prefix index, token revocation owner-check) and add a new "Deployment hardening" section listing what's still open (e.g., automated rebuild, log rotation, backup story).

- [ ] **Step 4: Commit**

```bash
git add PASSDOWN.md
git commit -m "docs: update passdown for Cloudflare Tunnel + monolithic container deploy"
```

---

### Task 20: Push to GitHub

- [ ] **Step 1: Push everything**

```bash
git push origin main
```

- [ ] **Step 2: Verify the plan and code are visible on GitHub** — quick sanity check that `docs/superpowers/plans/2026-05-03-repos-monolithic-container.md` is browsable.

---

## Out of Scope for This Plan (deliberately deferred)

- **User auth / login system.** Phase 0 hardening leaves the placeholder user ID in the frontend. Building real auth is the next major piece of work, blocked only by this plan's completion.
- **GHCR image push + CI rebuild.** Local Unraid builds are fine for alpha. Plan a follow-up to wire `docker/build-push-action`.
- **Postgres backup / WAL story.** v1.1 work — needs a sidecar or `pg_dump` cron in s6.
- **iOS Shortcut `.shortcut` file.** Spec is in `Engineering Handoff.md §9`; not part of deployment.
- **Log rotation / monitoring dashboards.** s6 logs are visible via `docker logs RepOS`; structured retention is v2.

---

## Self-Review + Specialist Sign-Off (2026-05-03)

**Spec coverage:** Every MUST-FIX from SecDev is mapped to a Phase 0 or Phase 1 task. Every architectural decision from the Infrastructure specialist is captured in Tasks 9–12. Network specialist's only required action (none — shim already in place) is reflected by Phase 2 not needing pre-deploy network changes. ✅

**Placeholder scan:** No `TBD` / `TODO` / "fill in" / "similar to Task N" found. ✅

**Type / signature consistency:** `DATABASE_URL` is built identically in `init-migrations` and `run-api`. `POSTGRES_DB`/`POSTGRES_USER` defaults match across scripts. `requireAdminKey` signature unchanged in Task 5 (DELETE handler gains a `user_id` query param the frontend must pass — Task 5 covers both code paths). ✅

**Specialist re-review pass (after synthesis):** All three specialists were re-dispatched to review this plan against their original findings. All returned **APPROVED WITH CHANGES**. Blocking issues surfaced and fixed:

- **(Infra + SecDev)** `init-postgres-bootstrap` had `\gexec` inside a `psql -c` argument — meta-commands only work via stdin / heredoc / `-f`. Fixed: moved CREATE DATABASE into a heredoc using `format(... %I ...)` for safer identifier quoting.
- **(Infra)** Postgres binary paths `/usr/libexec/postgresql16/...` were RHEL-style, not Alpine's. Fixed: changed to `/usr/bin/postgres`, `/usr/bin/initdb` (verified by pulling `lscr.io/linuxserver/baseimage-alpine:3.21` and inspecting `which postgres initdb pg_isready`). Added a Dockerfile build-time `test -x` check to fail loudly if a future Alpine moves them.
- **(Infra)** PUID/PGID vs postgres uid clash — lsio's stock cont-init.d chowns `/config` to abc:abc on every boot. Fixed: added `/etc/cont-init.d/99-postgres-perms` to re-assert `postgres:postgres` ownership of `/config/postgres` after the lsio loop.
- **(Infra)** Dropped `npm` and `su-exec` from runtime apk (saves ~30MB; using `s6-setuidgid` from s6-overlay v3 instead of `su-exec`).
- **(SecDev)** Migration 006 originally created `LEFT(token_hash, 16)` index, but `auth.ts:28-29` queries with `LIKE 'prefix:%'` — incompatible. Fixed: changed to `(token_hash text_pattern_ops)`, which actually supports prefix-LIKE lookups. Added `EXPLAIN` verification step.
- **(SecDev)** SQL injection surface from interpolated env vars in bootstrap heredoc. Fixed: regex-validated `POSTGRES_USER`/`POSTGRES_DB` to `[A-Za-z_][A-Za-z0-9_]*`, rejected `'` and `\` in `POSTGRES_PASSWORD`, and used `%I` identifier quoting in the CREATE DATABASE statement.
- **(SecDev)** Task 5 step 5 didn't name the placeholder constant. Fixed: pointed at `frontend/src/tokens.ts:34` and the existing import at `SettingsIntegrations.tsx:2`.
- **(SecDev)** Added an auth-header-redaction smoke verification in Task 1 (curl with leak-canary, grep the log).
- **(SecDev)** Env-file at-rest exposure: added `chown root:root` and a Unraid-share-export-check note.
- **(Network)** Task 16 step 7 (`nc -zv 192.168.88.65 5432`) clarified to run **from the Mac, not Unraid** — vantage matters because the macvlan-shim route would exercise a different path from the host. Added an ARP-cache verification step.

All review comments addressed. Specialists' verdict on this revised plan is treated as **APPROVED** for execution.

**Remaining risk callouts (non-blocking):**
- Task 17 trusts that the user's existing Cloudflare Tunnel is currently functioning. Test from cellular / off-LAN before declaring success.
- Task 13 (local Mac build) requires `docker buildx` with QEMU emulation for `linux/amd64`. If buildx is not set up, fall back to building directly on Unraid (skip Task 13, go to Task 14).
- Logs are written to per-service dirs but unrotated — acceptable for alpha; revisit before declaring Release.
