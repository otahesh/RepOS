# Beta Scope — Backend

> Specialist: Backend Engineering
> Date: 2026-05-07
> Scope: define what the Fastify+Postgres backend needs before we accept real
> user data ("Beta"). Anything explicitly out-of-scope is tagged Defer.

---

## Current state (verified against `api/src/` 2026-05-07)

The backend is closer to multi-user-ready than the project narrative implies.
Key facts the rest of this spec assumes:

- **CF Access JWT verification is already built** (`api/src/middleware/cfAccess.ts`).
  `requireCfAccess` reads `Cf-Access-Jwt-Assertion` (or the `CF_Authorization`
  cookie), verifies signature against the team JWKS, validates `aud` + `iss`,
  resolves email → `users` row, **auto-provisions** on first sight, and stamps
  `req.userId`. `GET /api/me` already returns the resolved identity.
- **Every protected route uses `requireBearerOrCfAccess`** which derives
  `req.userId` from the verified JWT or the bearer token's `device_tokens.user_id`.
  Routes never accept `user_id` from a request body or query (except `/api/tokens`
  in admin mode, which is correct).
- **`set_logs` table already exists** (migration `022_set_logs.sql`) but is
  minimal: `(planned_set_id, performed_reps, performed_load_lbs, performed_rir,
  performed_at, notes)`. No write route exists yet; the recap-stats route
  (`GET /api/mesocycles/:id/recap-stats`) reads from it.
- **Frontend has `PLACEHOLDER_USER_ID = '00000000-0000-0000-0000-000000000001'`**
  used only as a fallback when `/api/me` returns 503 (`cf_access_disabled`).
  Once `CF_ACCESS_ENABLED=true` in production, the placeholder is dead code on
  the API side — the API never reads `user_id` from the client.
- **Audit of `user_id` scoping in routes/services:** every protected route
  passes `(req as any).userId` into queries with `WHERE user_id = $N` or via
  an ownership-checked join (`mesocycle_runs mr ON ... WHERE mr.user_id=$1`).
  Spot-checked all 11 route files — no leaks. Services never accept `userId`
  from the route body; they take it as an argument.
- **PostgreSQL bound to 127.0.0.1**, pool capped at `max=20` with a 5s
  `statement_timeout`, helmet registered, auth headers redacted from pino logs.

The backend is multi-tenant-safe **as soon as CF Access is flipped on in prod
and the placeholder fallback is removed**. The remaining beta work is data
durability (backups), set-logging surface, schema migrations for live data,
and gap-fill on user-editable settings.

---

## Must-have for Beta (blockers)

These are the items that, if not shipped, mean we cannot accept real users.

### 1. Turn CF Access on in production and remove the placeholder fallback — S
**Rationale:** the JWT verifier is already wired; the only missing pieces are
(a) flipping `CF_ACCESS_ENABLED=true` in `/mnt/user/appdata/repos/.env`, (b)
deleting the `'disabled'` branch in `frontend/src/auth.tsx` and the
`PLACEHOLDER_USER_ID` constant, and (c) verifying the Owner-Only policy is
attached to the whole-host app and the Bypass policy still covers
`/api/health/*` for the iOS Shortcut. Smoke-test from outside the home network
that browser-path requires login and Shortcut path still works with bearer.

### 2. Set-log write API + indices — M
**Rationale:** Two clinical recovery flags (overreaching, stalled-PR) are
deferred until set-logs exist. The mid-session UI also needs a place to push.
Migration 022 created the table but it lacks: (a) a per-user lookup index,
(b) a per-exercise lookup index for PR/stall queries, (c) `created_at` /
`updated_at` for audit, and (d) a write route. **See "set_logs schema spec"
below for the migration + route specification.**

### 3. Backup architecture — L
**Rationale:** memory `project_arr_style_db_recovery.md` flags this as a hard
prereq for Release. Off-box is solved by Unraid's host backups of `appdata/`,
but in-app `pg_dump` snapshots + Settings restore UI are not. **Spec below.**
This is the single largest piece of net-new code for Beta.

### 4. Migration discipline doc + tooling — S
**Rationale:** alpha posture is "drop and recreate"; Beta is "live data, no
loss." Today's `migrate.ts` runs forward-only sequenced files inside `BEGIN`
... `COMMIT` and tracks applied filenames in `_migrations`. That's correct.
What's missing: a **written migration policy** (additive-first, no destructive
DDL without a backfill + verify pass, smoke-test on a copy of prod) and a
`scripts/migrate-dryrun.sh` that restores the latest backup into a scratch
DB and runs pending migrations against it before deploy. **Spec below.**

### 5. Account / user record completeness — S
**Rationale:** `users` has `id, email, timezone, equipment_profile, goal,
display_name, last_seen_at, created_at`. Missing for Beta:
- **Per-user muscle landmarks** override (`MUSCLE_LANDMARKS` is a hardcoded
  constant in `_muscleLandmarks.ts`). Power users adjust MEV/MAV/MRV.
  Add `users.muscle_landmarks JSONB` (default `{}`, sparse — empty object
  means "use canonical defaults"); volumeRollup merges over the constant.
- **Display preferences** — `units` (lbs/kg), `first_day_of_week` (0–6).
  Add as `users.preferences JSONB` to avoid one-column-per-toggle creep.

### 6. Account deletion endpoint (GDPR-shaped) — S
**Rationale:** Beta = real users. We need `DELETE /api/me` that cascades. All
foreign keys to `users(id)` already use `ON DELETE CASCADE` (verified in
migrations 002, 011). Route is ~20 lines; gate behind a typed-confirmation
body field (`confirm: 'DELETE my account'`). Returns 204 and clears the
session by 302-ing the browser to the CF Access logout URL.

### 7. Production startup sanity guards — S
The `NODE_ENV=production && !ADMIN_API_KEY` guard exists. Add parallel guards:
- Refuse to boot if `CF_ACCESS_ENABLED=true` is set without `CF_ACCESS_AUD`
  and `CF_ACCESS_TEAM_DOMAIN`.
- Refuse to boot if `DATABASE_URL` is unset OR `POSTGRES_PASSWORD` is the
  literal `changeme`.
- Log (once, at boot) the configured `CF_ACCESS_ALLOWED_EMAILS` list count —
  not the emails — so we can detect a misconfig that left the gate wide open.

### 8. Apple Health Workouts ingestion — M
**Rationale:** memory `feedback_cardio_first_class.md` — cardio is first-class.
We have weight ingest; we don't have workout ingest. Beta does not need full
HRV/sleep, but **distance + duration + modality** ingest from Apple Health
Workouts via the same Shortcut/bearer pattern is in-scope:
`POST /api/health/workouts` taking `{started_at, ended_at, modality,
distance_m?, duration_sec?, source}` with `(user_id, started_at, source)`
dedupe key. Mirrors the existing `health_weight_samples` shape.

### 9. Rate-limit + log-rotation hygiene — S
nginx already does per-IP rate limiting at the edge of the container. Add an
API-level limit on `POST /api/health/workouts` (analogous to weight's "5
writes per (user, date) per 24h"). Log rotation for `/config/log/{api,nginx,
postgres}` is a deploy concern but **must** ship before Beta — uncapped
container logs will fill the appdata disk. Add `logrotate` to the s6 tree.

---

## Nice-to-have for Beta

### 10. Email/notification service — M
Useful for: backup-failed alert, account-deleted confirmation, the
"deload-recommended" recovery flag. Recommend SMTP via a transactional
provider (Postmark/Resend) wired through a single
`api/src/services/notify.ts` so we can swap providers later. Skip in-app
notifications — the app is interactive enough that a banner suffices for v1.

### 11. Admin observability — S
A read-only `GET /api/admin/healthz` (admin-key gated) returning DB pool
counts, last-migration filename, last-backup age, set_logs row count. We
have `/health` (process liveness) but no signal-rich endpoint for
"is the data layer working." Useful for the s6 `up` probe and for me.

### 12. Per-user equipment-change audit log — S
Today, `PUT /api/equipment/profile` overwrites the JSONB. Useful to know
"user removed dumbbells on 2026-05-04" when investigating a substitution
complaint. Add `equipment_profile_history (user_id, profile JSONB, changed_at)`
with an INSERT trigger or a manual write in the route. Append-only; no read
UI for v1 beyond an admin debug page.

### 13. Honor `?intent=deload` on `POST /api/mesocycles/run-it-back` — S
Currently materializeMesocycle blindly copies the previous run's structure.
A `?intent=deload` query should reduce target sets per block by ~40% and
pin RIR to 3 across the run. Pure server-side; existing route and DB shape
are fine. Spec'd in program-model V1 §5.4 deferred items.

### 14. Stalled-PR + overreaching evaluators — M
With set_logs writes available (Must-have #2), wire the two deferred flags
into the existing `recoveryFlags` registry. Stalled-PR fires when an
exercise's max performed_load_lbs hasn't increased in 3+ weeks. Overreaching
fires when median RPE per session trends up >1.0 over 2 weeks. Both are
service-only (no new tables) once set_logs is writeable.

---

## Defer to GA / post-Beta

### 15. Direct Withings / Renpho integration — Defer
The schema accepts the source enum; nothing else is built. Manual + Apple
Health covers Beta.

### 16. GHCR + CI builds — Defer
Local build on Unraid is fine for Beta. CI is a quality-of-life upgrade,
not a Beta blocker.

### 17. Multi-user invite / share flows — Defer
Beta is "multi-user the user creates by adding emails to the CF Access
allow-list." No in-app invite flow. Single-tenant in spirit, even if the
DB is multi-tenant.

### 18. Postgres logical-replication or PITR — Defer
The `pg_dump` snapshot pattern is sufficient for the user's risk tolerance.
Real PITR is post-GA when we have customers paying for uptime.

### 19. mesocycle_run_events retention / cleanup — Defer
Append-only and uncapped today (program-model plan §10 risk 7). Won't matter
at Beta volumes (single-digit users, dozens of runs per year).

### 20. password reset flows / multi-factor — Defer
CF Access owns identity. We don't store passwords; we have nothing to reset.
MFA is a CF Access policy toggle, not a backend concern.

---

## Auth recommendation

### Primary: Cloudflare Access pass-through (option a)

**Recommendation:** Keep the CF Access JWT model that already exists and
flip `CF_ACCESS_ENABLED=true`. We are 90% of the way there.

**Justification:**

- **Zero new code.** `requireCfAccess` is built and tested. `GET /api/me` is
  built. Frontend `AuthProvider` is built. The remaining work is config
  (allow-list emails) + deletion of the disabled-fallback branch.
- **Zero password storage.** RepOS never sees a credential. All password,
  reset, MFA, lockout policy is owned by Cloudflare Access. This is the
  largest auth-related risk surface and we eliminate it by not having it.
- **Multi-device handled.** Same browser cookie everywhere; Apple Shortcut
  uses the bearer-token path that's already built and bypassed at the edge.
- **Operationally aligned.** `/api/tokens/*` is already CF Access gated;
  adding the whole host costs one Zero Trust policy edit. The user already
  uses CF Access for `RepOS Admin Tokens`. No new identity provider, no new
  email vendor, no new vault.
- **Email is the natural primary key.** Auto-provision on first JWT means
  adding a new user is one Cloudflare dashboard edit, not a database
  migration. Removal is one dashboard edit.

**The trade-off:** users must have a Cloudflare Access account (free) and
do an email-OTP login on first device. For RepOS's audience (the user, his
trainer, possibly a partner) this is acceptable. For a hypothetical
"public-signup SaaS" pivot, it isn't — we'd switch to (c) magic link or
(d) passkeys. That's not Beta.

### Fallback: Magic link (option c)

If CF Access becomes a dealbreaker (most likely cause: user wants to onboard
someone outside his Cloudflare org without inviting them as a Zero Trust
user), magic-link is the next-cheapest. Implementation: `POST /api/auth/login`
emits a one-time link (`/api/auth/verify?token=<jwt>`); GET sets a signed
cookie; we maintain our own session table. Argon2id storage of nothing
(passwordless), one new vendor (transactional email).

**Why not (b) email/password:** password storage is the highest-risk auth
choice for the smallest UX gain. Skip it.

**Why not (d) passkeys:** great UX, but WebAuthn + recovery is non-trivial
in a single-user single-developer shop. Defer to post-Beta.

**Why not (e) OAuth:** we'd be redirecting through Google/Apple to land
back at a CF-Access-gated host, which is comically redundant. Skip.

---

## Migration plan from PLACEHOLDER_USER_ID

Given the audit results (the API never reads user_id from clients in
authenticated routes), this migration is mostly a **frontend** change. The
backend already does the right thing.

**Step 1 — Pre-flight checks (no code).**
- Verify `CF_ACCESS_AUD` and `CF_ACCESS_TEAM_DOMAIN` are present in
  `/mnt/user/appdata/repos/.env`. Reference: `reference_deployment.md`.
- Verify the Owner-Only CF Access policy is attached to the whole-host
  `RepOS` app, not just `/api/tokens`. From outside the home network, hit
  `https://repos.jpmtech.com/` — must redirect to CF Access login.
- Verify the Bypass policy on `/api/health/*` is still in place. From
  outside, `curl -X POST https://repos.jpmtech.com/api/health/weight` with
  no auth → 401 Bearer-required (NOT a CF Access redirect).

**Step 2 — Flip the flag.**
Set `CF_ACCESS_ENABLED=true` in `.env`, recreate the container per the
reference recipe (`docker stop && docker rm && docker run --env-file ...`).
After restart, `curl http://192.168.88.65:80/api/me` from inside the box
returns 401 (no JWT). From a logged-in browser, returns the user record.

**Step 3 — Frontend cleanup PR.**
Delete:
- `PLACEHOLDER_USER_ID` constant in `frontend/src/auth.tsx`.
- `PLACEHOLDER_USER` const + the `'disabled'` branch in `AuthProvider`.
- `'disabled'` from the `AuthStatus` union; `AuthGate` falls through only
  on `'loading' | 'authenticated' | 'error'`.
- The two test fixtures (`AppShell.test.tsx`, `navigation.smoke.test.tsx`)
  that hard-code `PLACEHOLDER_USER_ID`. Replace with a fixture that mocks
  `useCurrentUser()` returning a real-shaped user.

**Step 4 — Add a multi-user smoke test.**
A new playwright (or fetch-based) test that hits `/api/me` with two
distinct CF Access JWTs (mock-signed against a local JWKS) and verifies
each user sees only their own programs / weight samples. **This is the
acceptance gate** for declaring multi-user-safe — the audit is
necessary-but-not-sufficient.

**Step 5 — Remove the `503 cf_access_disabled` response.**
Once enabled in prod, the 503 branch in `requireCfAccess` is no longer
useful and is itself a source of confusion (a misconfigured deploy could
silently swap "auth required" for "auth disabled"). Replace with a hard
500 — fail loud.

**Step 6 — Backfill existing data to a real user.**
The current production DB has rows owned by the placeholder UUID. After
the user logs in for the first time and is auto-provisioned, run:
```sql
UPDATE health_weight_samples
   SET user_id = (SELECT id FROM users WHERE lower(email)='jason@jpmtech.com')
 WHERE user_id = '00000000-0000-0000-0000-000000000001';
-- repeat for: device_tokens, user_programs, mesocycle_runs,
-- weight_write_log, recovery_flag_dismissals, health_sync_status
```
Wrap in a single transaction. **Take a backup first.**

---

## set_logs schema spec

Migration 022 already created the table, minimally. The Beta migration
extends it and adds the write surface.

### Migration 028 (forward-only, additive)

```sql
-- 028_set_logs_beta.sql
-- Adds the columns + indices needed for the writeable set-log API and the
-- two deferred recovery evaluators (overreaching, stalled_pr). No
-- destructive DDL — every column is nullable or has a sensible default.

ALTER TABLE set_logs
  ADD COLUMN IF NOT EXISTS user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS exercise_id UUID REFERENCES exercises(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS rpe         NUMERIC(3,1) CHECK (rpe IS NULL OR (rpe BETWEEN 1.0 AND 10.0)),
  ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ NOT NULL DEFAULT now();

-- Backfill user_id and exercise_id from the planned_set chain so the
-- evaluator queries don't need 4-table joins on every read.
UPDATE set_logs sl
   SET user_id = mr.user_id,
       exercise_id = ps.exercise_id
  FROM planned_sets ps
  JOIN day_workouts dw ON dw.id = ps.day_workout_id
  JOIN mesocycle_runs mr ON mr.id = dw.mesocycle_run_id
 WHERE sl.planned_set_id = ps.id
   AND (sl.user_id IS NULL OR sl.exercise_id IS NULL);

-- Now they're populated, enforce NOT NULL going forward.
ALTER TABLE set_logs
  ALTER COLUMN user_id     SET NOT NULL,
  ALTER COLUMN exercise_id SET NOT NULL;

-- Idempotency: a UI re-submit (network blip) shouldn't double-log a set.
-- Dedupe key: same planned_set + same client-claimed performed_at minute.
-- We use timezone-stamped TIMESTAMPTZ truncated to the minute.
CREATE UNIQUE INDEX IF NOT EXISTS set_logs_dedupe_idx
  ON set_logs (planned_set_id, date_trunc('minute', performed_at));

-- Hot path: stalled-PR per (user, exercise). Pulls last N rows by date.
CREATE INDEX IF NOT EXISTS set_logs_user_exercise_perf_idx
  ON set_logs (user_id, exercise_id, performed_at DESC);

-- Hot path: overreaching per user across recent days.
CREATE INDEX IF NOT EXISTS set_logs_user_perf_idx
  ON set_logs (user_id, performed_at DESC);

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_logs_touch_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_logs_touch_updated_at ON set_logs;
CREATE TRIGGER set_logs_touch_updated_at BEFORE UPDATE ON set_logs
  FOR EACH ROW EXECUTE FUNCTION set_logs_touch_updated_at();
```

### Routes

```
POST   /api/set-logs                — create. body: {planned_set_id, performed_reps,
                                       performed_load_lbs, performed_rir|rpe, notes?,
                                       performed_at?}.  Returns 201 {id, ...}.
                                       Server derives user_id + exercise_id from
                                       planned_set lookup, rejects if planned_set
                                       does not belong to req.userId (404).
                                       Dedupes via the unique index — on conflict,
                                       returns 200 with the existing row.
PATCH  /api/set-logs/:id            — edit. Same ownership check via JOIN. 409 if
                                       performed_at is older than 24h (immutable
                                       audit window).
DELETE /api/set-logs/:id            — delete. Same ownership check.
GET    /api/set-logs?planned_set_id — list logs for a planned set; ownership-checked.
```

All routes preHandler: `requireBearerOrCfAccess`. None accept `user_id` from
the client.

### Recovery evaluator wire-up (out of scope for the migration but tracked here)

Add `stalledPrEvaluator` and `overreachingEvaluator` to `services/recoveryFlags.ts`,
register them next to `bodyweightCrashEvaluator` in `routes/recoveryFlags.ts`.
Definitions follow program-model plan §7.2. No new tables.

---

## Backup architecture spec

Pattern: *arr-style snapshots in `/mnt/user/appdata/repos/backups/`. The
appdata volume is itself off-box-backed by Unraid; this service is for
"undo" and "restore-from-corruption", not disaster recovery.

### Components

**Backup runner (s6 long-run service `backup-cron`):**
- Runs `pg_dump --format=custom --compress=6 --file=/config/backups/repos-YYYYMMDD-HHMMSS.dump` on a cron interval.
- Default schedule: daily at 03:00 local time + on every successful migration run + manual via API.
- Retention: keep last 14 daily + last 4 weekly + last 6 monthly (Sonarr-style). Cleanup runs after each successful new backup.
- Writes a sidecar `.json` per dump with `{schema_version, app_version, row_counts: {users, set_logs, ...}, sha256, size_bytes}` for the Settings UI.
- Failures emit to `/config/log/api/backup.log` and bump a Postgres counter row (`backup_status` table) so the admin healthz endpoint surfaces "last successful backup age."

**Tables / schemas excluded from backup:**
None. The DB is small (estimated <100MB even at year-1 Beta scale). Full
dump every time is correct. Log tables (`weight_write_log`,
`mesocycle_run_events`) are useful forensics — keep them.

**Restore:**
- API: `POST /api/backups/:id/restore` (admin-key gated AND CF-Access gated, same as `/api/tokens`).
- The route does NOT restore in-place. It:
  1. Spawns a child `pg_restore --create --clean -d postgres < /config/backups/<id>.dump` into a **side database** named `repos_restore`.
  2. On success, runs migrations against `repos_restore` to bring it to current schema.
  3. Atomically renames: `repos → repos_old_<ts>`, `repos_restore → repos`. Pool is recycled (Pool.end + reconnect).
  4. Keeps `repos_old_<ts>` for 24h then drops it (gives the user an undo window).
- Pre-flight: route refuses to run if there's any in-flight transaction or active mesocycle write within 5s window.

### API surface

```
GET    /api/backups               — list. CF-Access. Returns sidecar JSON + filename.
POST   /api/backups               — manual snapshot now. CF-Access + admin-key.
POST   /api/backups/:id/restore   — restore from snapshot. CF-Access + admin-key + body confirm field.
DELETE /api/backups/:id           — delete one. CF-Access + admin-key.
GET    /api/backups/:id/download  — stream the .dump file. CF-Access + admin-key. (For off-box copy.)
```

### Settings UI shape

Following *arr conventions:
- `/settings/system/backups` — table with columns (Date, Type [auto|manual], Size, Action: Restore | Delete | Download).
- "Backup Now" button at top.
- Restore confirms in a dialog ("Type RESTORE to confirm. The current DB will be saved as repos_old_<ts> for 24h.")
- "Last successful backup" indicator near the page title.

### RTO / RPO

- **RPO: 24 hours.** Daily backups; manual snapshot before any risky operation. The user is OK losing a day of weight logs in a worst case.
- **RTO: 5 minutes.** `pg_restore` on a sub-100MB dump is seconds; the bottleneck is the API restart + frontend bootstrap.

---

## Migration discipline (forward-only with live data)

**Policy (write into `PASSDOWN.md` as a section):**

1. **Additive-first.** All Beta migrations are `ALTER ADD COLUMN ... IF NOT EXISTS` or `CREATE TABLE IF NOT EXISTS`. No `DROP COLUMN`, no `ALTER COLUMN ... TYPE` without a documented backfill + verify pass. (Migration 025 dropped `device_tokens.scope` after backfilling to `scopes[]` — that's the template for future destructive changes: add new column, backfill, switch reads, switch writes, drop old column in a *later* migration.)
2. **No mid-migration data deletion.** If a migration needs to remove rows, gate behind a feature flag and do it in a separate post-deploy task.
3. **Smoke-test on a copy of prod before cutover.** New script `scripts/migrate-dryrun.sh`:
   - `pg_restore --create --clean -d postgres /config/backups/<latest>.dump`
   - Run pending migrations against the restored copy.
   - Run the test suite (`api/tests/`) against the restored copy with `DATABASE_URL` pointing at it.
   - Fail loud if any step fails.
4. **Migrations run inside a transaction wrapper** (already true — `migrate.ts` does `BEGIN ... COMMIT`/`ROLLBACK`).
5. **Migration files are immutable once committed to main.** Editing an already-applied migration changes its hash but not the `_migrations` row, leaving the DB diverged from source. New corrections go in a new migration.
6. **PR template gets a checkbox: "Tested against a copy of prod" + dump filename.**

The single brittle existing case: migration 027 adds a value to the `program_status` enum. PG 12+ allows that in a transaction, but the value is unusable until the transaction commits. Future enum changes follow the same pattern — they are Beta-safe.

---

## Risks / unknowns in my domain

- **The audit is by inspection, not by automated test.** A new route added by a future change could forget to scope by user_id and pass review. Mitigation: a test helper that, for each protected route, inserts data for two users, calls the route as user A, and asserts the response cannot reference user B's row IDs. Ship as part of Must-have #1.
- **`pg_restore` over a live socket while the API is up may corrupt connections.** The atomic rename trick in the restore route works in theory; needs an integration test against a real Postgres before we trust it. If the rename trick is too brittle, fall back to "stop API → restore in place → start API" with the s6 supervisor cycling.
- **CF Access bypass on `/api/health/*` is a known soft-spot.** Anyone with a valid bearer token can hit those endpoints from anywhere. The bearer is already argon2-hashed and revocable, but the bypass means we never get the second factor of CF Access on the Shortcut path. Acceptable for Beta; document.
- **`set_logs.dedupe_idx` on `(planned_set_id, date_trunc('minute', performed_at))`** assumes a user can't legitimately log two sets of the same exercise within the same minute. That's true for working sets. If the UI lets the user "log warmup + working set" against the same `planned_set_id`, the dedupe key collides. Confirm with Frontend on whether warmups share planned_set_id.
- **Backup-restore round-trip with extension dependencies.** We use `gen_random_uuid()` from `pgcrypto`. If a fresh `repos_restore` DB doesn't have the extension, restore fails. `pg_dump --create` includes `CREATE EXTENSION` lines but only if the extension is in the source — verify on first dry-run.
- **JWKS cache invalidation.** `createRemoteJWKSet` caches forever in-process. If Cloudflare rotates keys, the API will reject valid JWTs until container restart. The `jose` library handles cache TTL, but we haven't tuned it. Confirm before declaring Beta.

---

## Open questions for cross-team review

1. **Frontend** — does the live-logger UI use one `planned_set_id` for warmups + working sets, or distinct ones? Affects the set_logs dedupe key.
2. **Frontend** — are you OK deleting the `'disabled'` AuthStatus branch in one PR, or should we do it in two (first remove the placeholder fallback's effect, then clean up the type)?
3. **QA** — what's the multi-user playwright fixture story? I'll provide the API-level smoke; you own browser-level.
4. **Mobile** — does Apple Health Workouts ingestion need a separate Shortcut-bearer scope (e.g. `health:workouts:write`) or can it reuse `health:weight:write`? Recommendation: new scope, mint a new token.
5. **Product/User** — is the 24h "old DB kept after restore" undo window enough? Could be 7d at the cost of disk.
6. **Product/User** — backups daily at 03:00 local; should manual workout-completion trigger an extra snapshot? Probably overkill.
7. **DevOps/Infra** — log rotation: ship `logrotate` in the s6 tree, or rely on Docker's `json-file` driver with `max-size`? Recommendation: `logrotate` (we already manage one s6 tree; one more service is cheap).
