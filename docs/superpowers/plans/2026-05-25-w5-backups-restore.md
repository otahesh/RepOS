# W5 — Backups + Restore UI (Maintenance-Mode) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the manual backup snapshot button, the `/settings/backups` restore UI (desktop-only authoring; mobile read-only list), the maintenance-mode restore flow with atomic-or-revert semantics, the `pg_restore -l` integrity check, the Healthchecks.io alert pings, the `backup_runs` audit table, and `tests/dr/restore-into-ephemeral.sh` — closing **W5** of the RepOS Beta plan and gate **G5** in full.

**Architecture:** Persisted maintenance flag at `/config/maintenance.flag` (sentinel file — survives a corrupt-DB state in a way a DB row does not) gates all `/api/*` routes via a single Fastify `onRequest` hook. The restore endpoint is the escape hatch and does NOT 503. **Atomic-or-revert ordering (per C-RESTORE-ORDERING):** (a) write `/config/maintenance.flag` and `fsync` it, (b) INSERT `backup_runs` audit row + write `/config/restore-state.json` sentinel, (c) SIGTERM the API (`s6-rc -d change api`) so it drains its pg pool and exits before pg_restore touches the DB, (d) `scripts/pre-restore-snapshot.sh` (exists from W0), (e) `pg_restore --clean --if-exists`, (f) run migrations, (g) wipe `device_tokens` (per C-DEVICE-TOKENS-RESTORE), (h) `s6-rc -u change api` (the API boots into maintenance mode and stays there until the admin clears via `POST /api/maintenance/clear`). Pre-snapshot recovery is wired so the migration-failure-rollback path is one HTTP call. **Restore-progress state lives in `/config/restore-state.json`, NOT in `backup_runs`,** because the restore replaces the DB mid-operation and any running row in `backup_runs` is wiped (per C-AUDIT-SENTINEL). A post-clear `event_kind='restore_complete'` row is appended to `backup_runs` once the admin clears the flag, providing the immutable historical audit.

**Tech Stack:** Fastify 5 + Zod + TypeScript + Postgres 16 on the API side; Vite + React 18 + TypeScript + Vitest + React Testing Library on the frontend; bash + s6-overlay on the container side; Playwright for the desktop click-path e2e.

**Master plan:** [docs/superpowers/plans/2026-05-11-repos-beta.md §W5](2026-05-11-repos-beta.md) (lines 340–382) + Appendix A W5 absorption block (lines 624–631).

**Migration range claimed:** **050–059 inclusive.** This plan uses exactly **two** numbers: `050_backup_runs.sql` (audit table) and `051_backup_runs_indexes.sql` (operational lookup index — split out per project pattern of single-purpose migrations, mirrors migration 020). Numbers 052–059 are reserved for follow-on (e.g., if Sev-1 in cohort drives a schema fix).

**Device split (per `project_device_split.md`):**
- **Desktop primary** (full read/write): `/settings/backups` page — list of snapshots, "Backup Now" button, per-row Restore / Download / Delete actions, pre-snapshot recovery affordance.
- **Mobile primary**: read-only snapshot list **inside the same `/settings/backups` route** — no Backup Now / Restore / Delete affordances rendered; mobile users see "Backups must be managed from desktop." Maintenance-mode banner DOES render on mobile (it gates the whole app).
- **No `/mobile/*` URLs.** Per `project_responsive_chrome.md`, the device split is a rendering shift inside the same routes (`useIsMobile()` branch inside `SettingsBackupsPage`), never a route subtree.

**G7 reachability (entry point from `/`):**
- `/` → "Settings" nav → "Backups" sub-nav → `/settings/backups` — **2 clicks** (desktop viewport). Sidebar sub-nav order coordinated with W6 (W6 owns Settings sidebar layout per master plan §651). This plan inserts the entry; W6 may reorder.
- The pre-snapshot recovery affordance is a banner inside `/settings/backups`, not a separate URL — so still 2 clicks.

---

## Reviewer absorption (from master plan Appendix A)

These W5 items from the Phase-2 specialist re-review are folded inline into the task blocks below. Each correction is tagged `[ABS-N]`.

| # | Source | Item | Task |
|---|--------|------|------|
| ABS-1 | Infra | Persistence mechanism: **sentinel file at `/config/maintenance.flag`** (survives corrupt-DB state) | Task 2 |
| ABS-2 | Design | Verified-restorable badge tiers (`good`/`warn`/`danger`); disable Restore when `danger` | Task 12, Task 16 |
| ABS-3 | Design | Tighten maintenance banner copy: "RepOS is down for a database restore. ~60 seconds. Your last set is queued locally." (verb-first, no "briefly", no "automatically when service returns" hedge) | Task 14 |
| ABS-4 | Infra | `secret-rotation.md` + `cf-access-aud-drift.md` runbook entries | Task 21 |
| ABS-5 | Infra | Healthchecks.io UUIDs in `.env` as `HEALTHCHECKS_BACKUP_UUID` + `HEALTHCHECKS_HEALTH_UUID`; provisioning is a sub-task | Task 19, Task 20 |
| ABS-6 | Infra | DR test cadence enforced by `tests/dr/last-run.txt` (CI fails if older than 100 days) | Task 18 |
| ABS-7 | Infra | `repos-backup.sh` prunes `scheduler.log` at 14-day mark to match dump-retention window | Task 4 |
| ABS-8 | Infra | Container resource caps `--memory=2g --cpus=2` added to `reference_unraid_redeploy.md` redeploy recipe | Task 22 (runbook update — flag for `reference_unraid_redeploy.md` memory amend) |

---

## User decisions folded into this plan

| # | Decision | Tasks |
|---|----------|-------|
| **D9** | Backup download stays bearer-only (no signed URL). EVERY download writes a `backup_runs` audit row (`event_kind='download'`). Nginx admin zone tightened to 2 r/s for `/api/backups/`. Per-route admin gating per D10. | Task 5, Task 22b (nginx), Task 1 (schema column) |
| **D10** | Admin role primitive is env-driven (`REPOS_ADMIN_EMAILS`) and lands in W6 (`requireAdminKeyOrCfAccess` enforcement at `cfAccess.ts:176-202`). **W5 ships either after W6 OR with an interim 10-LOC hard-coded check on the single configured admin email** noted for W6 swap. | Task 2b (new), all admin-gated routes |

---

## Critical fixes folded in (panel-derived)

These items move the plan from "shippable" to "ship clean." Each fix is tagged `[C-…]` and applied inline to its task block(s).

| Tag | Fix | Task(s) |
|-----|-----|---------|
| **C-RESTORE-ORDERING** | Reorder restore: flag → audit → SIGTERM API → drain → pre-snapshot → pg_restore → migrate → device_tokens wipe → boot API into maintenance. Old order had the API holding pool connections during `DROP`. | Task 6, Task 7 (script), Phase 4 architecture |
| **C-FSYNC-FLAG** | `fs.fsyncSync(fd)` after `writeFileSync(flagPath, ...)`; `sync` after `mv` in bash. Container OOM/host reboot would otherwise lose the flag. | Task 2, Task 6 (kickoff), Task 7 (script) |
| **C-AUDIT-SENTINEL** | Restore progress lives in `/config/restore-state.json` sentinel, NOT `backup_runs` (the table is dropped+restored mid-operation). DB only gets the final `event_kind='restore_complete'` row appended post-clear. | Task 1, Task 6, Task 14 |
| **C-ADMIN-USER-ID** | Add `admin_user_id UUID REFERENCES users(id)` column to `backup_runs`. Populate from `(req as any).userId` on every route + `${ADMIN_USER_ID}` in scripts. | Task 1, all backup routes |
| **C-AUTOBACKUP-AUDIT** | `repos-backup.sh` must `INSERT INTO backup_runs` on success (with `event_kind='create'`, `trigger='auto'`); otherwise nightly backups never appear in `GET /api/backups`. | Task 4 (script section) |
| **C-DOWNLOAD-AUDIT** | New `event_kind TEXT NOT NULL DEFAULT 'create' CHECK (event_kind IN ('create','download','delete','restore_init','restore_complete'))` column on `backup_runs`. Write a new row per `GET /api/backups/:id/download` with `event_kind='download'`, `source_ip`, `admin_user_id`. | Task 1, Task 5 |
| **C-RESTORE-AUTH-CFACCESS** | `POST /api/backups/:id/restore` and `POST /api/maintenance/restore-pre-snapshot` REQUIRE CF Access JWT — reject the X-Admin-Key path. Plumb a `requireFreshCfAccess` option through `requireAdminKeyOrCfAccess`. Listing + manual snapshot stay dual-auth. | Task 6, Task 2b |
| **C-DEVICE-TOKENS-RESTORE** | `run-restore.sh` issues `UPDATE device_tokens SET revoked_at=now(), revoke_reason='restore_replayed' WHERE revoked_at IS NULL` post-restore. Closes the restore-replay attack vector. Coordinates with W6 (`revoke_reason` enum). | Task 6 (script) |
| **C-FORWARD-INCOMPAT-CHECK** | Extend the existing `pg_restore -l` pre-flight to also extract the highest `_migrations` filename from the dump and abort the restore if dump schema rev > current code rev. | Task 11 (G5 case 4) |
| **C-DR-DRY-FIRE-DATA-SAFETY** | `dr-dry-fire.md` MUST direct the operator to take a fresh manual backup IMMEDIATELY before the dry-fire and restore from THAT backup. Restoring an older snapshot would erase alpha-tester data. | Task 22 |
| **C-STALE-LOCK** | `validateMaintenanceFlag` at boot detects stale `restore_state.json` (started_at < now() - 5 min) → mark failed + surface in `/api/maintenance/status` with `recovery_available=true`. | Task 6, Task 9 (extends G5 case 2) |
| **C-MOBILE-MAINTENANCE** | `MaintenanceBanner` must NOT call `window.location.reload()` while `idbQueue` rows are in `syncing` state mid-set. Inspect `idbQueue.peekPending() + peekSyncing()`; if non-empty in `syncing`, await or abort cleanly so rows flip back to `pending`; only then reload. For users on `/today/:runId/log`, suppress force-reload entirely and show "Restore complete — reload to continue" CTA banner. | Task 14, Task 17 (mobile test) |

---

## Important fixes folded in (panel-derived)

Each fix is tagged `[I-…]` and applied inline.

| Tag | Fix | Task(s) |
|-----|-----|---------|
| **I-POOL-DRAIN-DOC** | Comment in `gracefulShutdown`: `SHUTDOWN_TIMEOUT_MS=30_000` derives from `statement_timeout=5s × 6 retries + safety`. | Task 7 |
| **I-STALE-ROW-REAPER** | `bootstrap-runtime.ts` reaper: at boot, mark `status='running'` rows from W5 restore + backup processes as `'failed: reaped — process did not finalize'` if `started_at < now() - interval '15 minutes'`. | Task 2 |
| **I-INTEGRITY-AT-RESTORE** | `kickOffRestore` re-runs `integrityCheck(filePath)` BEFORE writing the maintenance flag (bitrot defence). | Task 6 |
| **I-PARTIAL-INDEX-MATCH** | Add `backup_runs (started_at DESC) WHERE trigger='pre_restore' AND status='ok'` partial index (matches the recovery lookup). Drop the failed-restore partial index unless query-matched. | Task 1 |
| **I-FLAGPATH-CACHE** | Cache `flagPath()` resolution at module load — don't re-read env on every request. | Task 2, Task 6 |
| **I-CONTENT-LENGTH** | `GET /api/backups/:id/download` sets `Content-Length: statSync(filePath).size` so the browser shows progress. | Task 5 |
| **I-DELETE-BACKUP-AUDIT** | `DELETE /api/backups/:id` appends a `backup_runs` row with `event_kind='delete'`, `admin_user_id`, `source_ip`. | Task 5 |
| **I-DELETE-CONFIRM** | Snapshot DELETE → light-tier `ConfirmDialog` (toast + 5s undo) matching W6's `tier="light"`. Stub `pushToast` pre-W6; wire to `ToastHost` post-W6. | Task 12, Task 16 (post-W6) |
| **I-WINDOW-PROMPT** | Do not ship `window.prompt` even transiently. Land Task 12 + Task 16 in a single commit, OR Task 12 ships a stubbed button (no `window.prompt`). | Task 12, Task 16 |
| **I-RESTORE-FROM-LOCAL** | Document the "place file in `/config/backups`, refresh list, restore" workflow in `dr-dry-fire.md`. No multipart upload for Beta. | Task 22 |
| **I-BADGE-WARN-DOWNLOAD** | Disable the Download link for `warn` rows (file missing → 404). Download remains enabled for `danger` (operator may want to inspect). | Task 12 |
| **I-MOBILE-AFFORDANCE** | Move "Backups must be managed from desktop" message inline as a per-row hint or row footer next to where the absent buttons would be — not as a single banner above the table. | Task 13 |
| **I-SIDEBAR-COORDINATE** | W5 appends `Backups` at the end of `SETTINGS_SUB` interim; W6 owns the final reorder. Documented in cross-wave below. | Task 15 |
| **I-SIDECAR-PERMS** | Sidecar JSON written with `chmod 0640` (matches `repos-backup.sh`). Schema documented "metadata only, no user-identifying fields ever." | Task 4 |
| **I-RESTORE-CHILD-PRIVS** | Document `pg_restore` runs as DB superuser. `safeBackupPath()` source validation is the gate; re-validate inside `run-restore.sh` as defense-in-depth. | Task 6 (script) |
| **I-SEQUENCE-RESET** | Post-`pg_restore`, `SELECT setval('backup_runs_id_seq', (SELECT max(id) FROM backup_runs))` before the post-clear append. | Task 6 (script) |
| **I-HEALTH-MAINTENANCE** | `/health` keeps returning 200 (s6 needs it), but a new `/health/user-facing` returns 503 during restore so external uptime monitors don't go silent. | Task 2 |
| **I-SIGTERM-DRAIN-PRESERVES-BACKUP** | If a backup is in flight when SIGTERM lands, either complete it before drain OR kill + delete `.partial` + mark `status='failed'` in `backup_runs`. Coordinates with C-RESTORE-ORDERING. | Task 7, Task 4 |
| **I-LAST-RUN-CI** | CI script for `tests/dr/last-run.txt` uses git commit time, not filesystem mtime: `[[ $(( $(date +%s) - $(git log -1 --format=%ct tests/dr/last-run.txt) )) -lt 8640000 ]] \|\| exit 1`. | Task 18, cross-wave W8.6 |

---

## Existing scaffolding (do NOT recreate)

- `scripts/pre-restore-snapshot.sh` — exists from W0.5; W5 invokes it, does NOT rewrite.
- `docker/root/usr/local/bin/repos-backup.sh` — nightly cron exists; W5 extends with the `pg_restore -l` integrity check + Healthchecks ping + 14-day `scheduler.log` prune.
- `api/src/bootstrap-runtime.ts::validateMaintenanceFlag()` — exists; logs at boot when `/config/maintenance.flag` is present. W5 wires the matching middleware.
- `docker/root/etc/s6-overlay/s6-rc.d/backup/run` — s6 longrun exists; no edits.
- `_migrations` table + `api/src/db/migrate.ts` — migration runner exists; W5 adds two SQL files.

---

## Phase map (8 phases)

| Phase | Surface | Files | DoD |
|-------|---------|-------|-----|
| **P1** | Schema | `api/src/db/migrations/050_backup_runs.sql`, `051_backup_runs_indexes.sql` | `_migrations` records 050+051; `backup_runs` has `admin_user_id`, `event_kind`, `source_ip` columns (per C-ADMIN-USER-ID + C-DOWNLOAD-AUDIT); partial-unique-index on `(trigger='auto') WHERE status='running'` prevents two concurrent autoruns |
| **P2** | Maintenance middleware + interim admin gate | `api/src/middleware/maintenance.ts`, `api/src/middleware/cfAccess.ts` (interim admin check per D10), registered in `api/src/app.ts` | All `/api/*` routes (except `/api/maintenance/*`) return 503+`Retry-After: 60` when `/config/maintenance.flag` exists; gating is **persistence-checked on every request** (NOT cached at boot — so a flag written mid-process is honored without restart). Interim 10-LOC hard-coded admin-email check lands if W5 ships before W6 (per D10). `/health/user-facing` returns 503 during restore (per I-HEALTH-MAINTENANCE). Stale-row reaper at boot per I-STALE-ROW-REAPER. |
| **P3** | Backup CRUD | `api/src/routes/backups.ts`, `api/src/schemas/backups.ts` | `GET /api/backups`, `POST /api/backups`, `DELETE /api/backups/:id`, `GET /api/backups/:id/download` all green |
| **P4** | Restore endpoint + maintenance routes | `api/src/routes/maintenance.ts`, `api/src/services/restoreRunner.ts`, `POST /api/backups/:id/restore` in backups.ts, `/config/restore-state.json` sentinel | Restore endpoint returns 202 and REQUIRES CF Access JWT (per C-RESTORE-AUTH-CFACCESS — rejects X-Admin-Key); maintenance routes (`status` / `clear` / `restore-pre-snapshot`) read from sentinel file + work even when flag set; `kickOffRestore` re-runs integrity check pre-flag (per I-INTEGRITY-AT-RESTORE) |
| **P5** | SIGTERM drain | `api/src/index.ts` + `api/src/app.ts` shutdown hook | SIGTERM-drain test passes (10 concurrent `POST /api/set-logs`; all either complete or fail-retriable; zero NULL-required-fields rows) |
| **P6** | Backup script extension | `docker/root/usr/local/bin/repos-backup.sh` + `tests/dr/integrity-check.test.sh` | Post-write `gunzip\|pg_restore -l` integrity check; deletes bad file on failure; emits sidecar JSON; Healthchecks ping; `scheduler.log` prune at 14d |
| **P7** | Frontend | `frontend/src/pages/SettingsBackupsPage.tsx`, `frontend/src/components/settings/SnapshotTable.tsx`, `frontend/src/components/maintenance/MaintenanceBanner.tsx`, route in `App.tsx`, sub-nav in `Sidebar.tsx` | Desktop user reaches `/settings/backups` in 2 clicks; can take a backup, restore (typed-confirm), see maintenance banner during restore, recover from pre-snapshot |
| **P8** | DR + runbooks | `tests/dr/restore-into-ephemeral.sh`, `tests/dr/last-run.txt`, `docs/runbooks/dr-dry-fire.md`, `docs/runbooks/secret-rotation.md`, `docs/runbooks/cf-access-aud-drift.md`, `docs/qa/beta-reachability.md` extended | DR test green in CI; runbooks present; reachability row added; dry-fire PASSDOWN template ready |

---

## Phase 1 — `backup_runs` audit table

### Task 1: Schema migration for `backup_runs`

**Files:**
- Create: `api/src/db/migrations/050_backup_runs.sql`
- Create: `api/src/db/migrations/051_backup_runs_indexes.sql`

**Why two files:** Project pattern (see migrations 019 + 020). Keep table-creation separate from operational index addition so a future index swap is a single-file Step-2 destructive migration per G6.

- [ ] **Step 1: Write the failing schema test**

Create `api/tests/integration/backup-runs-schema.test.ts`:

```typescript
import 'dotenv/config';
import { describe, it, expect } from 'vitest';
import { db } from '../../src/db/client.js';

describe('backup_runs schema (migration 050+051)', () => {
  it('has the expected columns + types', async () => {
    const { rows } = await db.query(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_name = 'backup_runs'
       ORDER BY ordinal_position`,
    );
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ column_name: 'id', data_type: 'bigint', is_nullable: 'NO' }),
        expect.objectContaining({ column_name: 'trigger', data_type: 'text', is_nullable: 'NO' }),
        expect.objectContaining({ column_name: 'event_kind', data_type: 'text', is_nullable: 'NO' }),  // C-DOWNLOAD-AUDIT
        expect.objectContaining({ column_name: 'status', data_type: 'text', is_nullable: 'NO' }),
        expect.objectContaining({ column_name: 'file_path', data_type: 'text' }),
        expect.objectContaining({ column_name: 'size_bytes', data_type: 'bigint' }),
        expect.objectContaining({ column_name: 'integrity_verified', data_type: 'boolean' }),
        expect.objectContaining({ column_name: 'error_message', data_type: 'text' }),
        expect.objectContaining({ column_name: 'admin_user_id', data_type: 'uuid' }),  // C-ADMIN-USER-ID
        expect.objectContaining({ column_name: 'source_ip', data_type: 'text' }),       // C-DOWNLOAD-AUDIT
        expect.objectContaining({ column_name: 'started_at', data_type: 'timestamp with time zone', is_nullable: 'NO' }),
        expect.objectContaining({ column_name: 'finished_at', data_type: 'timestamp with time zone' }),
      ]),
    );
  });

  it('rejects unknown trigger values via CHECK constraint', async () => {
    await expect(
      db.query(
        `INSERT INTO backup_runs (trigger, status, started_at) VALUES ('garbage', 'running', now())`,
      ),
    ).rejects.toThrow(/backup_runs_trigger_check/);
  });

  it('rejects unknown status values via CHECK constraint', async () => {
    await expect(
      db.query(
        `INSERT INTO backup_runs (trigger, status, started_at) VALUES ('manual', 'garbage', now())`,
      ),
    ).rejects.toThrow(/backup_runs_status_check/);
  });

  it('rejects unknown event_kind values via CHECK constraint', async () => {
    await expect(
      db.query(
        `INSERT INTO backup_runs (trigger, event_kind, status, started_at) VALUES ('manual', 'garbage', 'ok', now())`,
      ),
    ).rejects.toThrow(/backup_runs_event_kind_check/);
  });

  it('admin_user_id has FK to users(id)', async () => {
    const { rows } = await db.query(
      `SELECT constraint_name FROM information_schema.table_constraints
       WHERE table_name='backup_runs' AND constraint_type='FOREIGN KEY'`,
    );
    expect(rows.map((r: any) => r.constraint_name)).toEqual(
      expect.arrayContaining([expect.stringMatching(/admin_user/i)]),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api
npx vitest run tests/integration/backup-runs-schema.test.ts
```

Expected: FAIL — table does not exist.

- [ ] **Step 3: Write migration 050_backup_runs.sql**

```sql
-- Beta W5.0 — backup_runs audit table.
-- Append-only audit of every backup + restore + download + delete
-- operation. Status transitions: running → ok | failed. Used by:
--   - GET /api/backups (list + verified-restorable badge inference)
--   - GET /api/maintenance/status (reads /config/restore-state.json
--     sentinel for in-flight state — backup_runs only has post-clear
--     restore_complete rows; per C-AUDIT-SENTINEL)
--   - DR runbook (proves "manual backup → sidecar JSON → integrity-verified")
--
-- trigger:
--   'manual'      — user clicked Backup Now in /settings/backups
--   'auto'        — nightly s6 backup longrun (repos-backup.sh)
--   'pre_restore' — pre-restore-snapshot.sh, captured before destructive restore
--   'restore'     — the restore operation itself (file_path = source snapshot)
--
-- event_kind (per C-DOWNLOAD-AUDIT — every event gets its own row):
--   'create'           — the snapshot was created (default)
--   'download'         — GET /api/backups/:id/download fired (D9 audit)
--   'delete'           — DELETE /api/backups/:id fired
--   'restore_init'     — POST /api/backups/:id/restore accepted (kicked off)
--   'restore_complete' — admin cleared the maintenance flag post-restore
--
-- status:
--   'running' — operation in flight (BACKUPS ONLY — restores use sentinel file)
--   'ok'      — finished cleanly (integrity_verified=true for backups; admin cleared for restores)
--   'failed'  — non-zero exit OR integrity check failed; error_message populated
--
-- admin_user_id: per C-ADMIN-USER-ID, populated from (req as any).userId on every
-- HTTP-triggered row and from ${ADMIN_USER_ID} env on script-triggered rows.
-- Required so the audit trail can answer "who clicked Restore."
--
-- source_ip: client IP from x-forwarded-for or req.ip on HTTP-triggered rows.
--
-- Partial unique index in 051 prevents two concurrent autoruns.

CREATE TABLE IF NOT EXISTS backup_runs (
  id                  BIGSERIAL    PRIMARY KEY,
  trigger             TEXT         NOT NULL CHECK (trigger IN ('manual', 'auto', 'pre_restore', 'restore')),
  event_kind          TEXT         NOT NULL DEFAULT 'create' CHECK (event_kind IN ('create','download','delete','restore_init','restore_complete')),
  status              TEXT         NOT NULL CHECK (status IN ('running', 'ok', 'failed')),
  file_path           TEXT,
  size_bytes          BIGINT,
  integrity_verified  BOOLEAN      NOT NULL DEFAULT false,
  error_message       TEXT,
  admin_user_id       UUID         REFERENCES users(id) ON DELETE SET NULL,
  source_ip           TEXT,
  started_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  finished_at         TIMESTAMPTZ
);
```

- [ ] **Step 4: Write migration 051_backup_runs_indexes.sql**

```sql
-- Beta W5.0 — operational indexes for backup_runs.
-- Split out from 050 per the project's single-purpose migration pattern
-- (see 019 + 020). Future index swaps can be done as a Step-2
-- destructive migration per G6 without rewriting 050.

-- For GET /api/backups: list latest first.
CREATE INDEX IF NOT EXISTS backup_runs_started_at_desc_idx
  ON backup_runs (started_at DESC);

-- For GET /api/maintenance/status::recovery_available — find the latest
-- pre_restore snapshot. Per I-PARTIAL-INDEX-MATCH, this matches the actual
-- query (the failed-restore lookup happens against the sentinel file, not
-- the DB, per C-AUDIT-SENTINEL — so the old failed-restore partial index
-- is removed in favour of the pre_restore one).
CREATE INDEX IF NOT EXISTS backup_runs_pre_restore_ok_idx
  ON backup_runs (started_at DESC)
  WHERE trigger = 'pre_restore' AND status = 'ok';

-- Prevent two concurrent autoruns from overlapping (would create
-- gzip-truncation race on the same partial file).
CREATE UNIQUE INDEX IF NOT EXISTS backup_runs_one_auto_running_idx
  ON backup_runs ((true))
  WHERE status = 'running' AND trigger = 'auto';
```

- [ ] **Step 5: Apply migrations + re-run test**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api
npx tsx src/db/migrate.ts
npx vitest run tests/integration/backup-runs-schema.test.ts
```

Expected: migrations 050 + 051 applied (logged in `_migrations`); test PASSES.

- [ ] **Step 6: Commit**

```bash
git add api/src/db/migrations/050_backup_runs.sql \
        api/src/db/migrations/051_backup_runs_indexes.sql \
        api/tests/integration/backup-runs-schema.test.ts
git commit -m "$(cat <<'EOF'
feat: add backup_runs audit table (W5 P1)

Append-only audit of backup + restore operations. Used by the
backups list endpoint to render the verified-restorable badge and
by the maintenance-status endpoint to surface pre-snapshot recovery
when a restore fails mid-flight.

Migrations 050 + 051 split per the single-purpose project pattern.
EOF
)"
```

---

## Phase 2 — Maintenance middleware (the 503 gate)

### Task 2: Maintenance middleware (sentinel-file gated)

**Files:**
- Create: `api/src/middleware/maintenance.ts`
- Modify: `api/src/app.ts:36-52` (register hook before any route plugins)
- Test: `api/tests/integration/maintenance-middleware.test.ts`

**[ABS-1] Persistence mechanism = sentinel file at `/config/maintenance.flag`.** Infra recommendation: survives a corrupt-DB state (a row in a `maintenance_mode` table cannot be read if the DB is mid-restore). File check is `existsSync()` on every request — sub-microsecond on a hot inode, no need to cache.

- [ ] **Step 1: Write the failing middleware test**

```typescript
// api/tests/integration/maintenance-middleware.test.ts
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { writeFileSync, unlinkSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildApp } from '../../src/app.js';

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let flagDir: string;
let flagPath: string;

beforeAll(async () => {
  flagDir = mkdtempSync(join(tmpdir(), 'repos-maint-'));
  flagPath = join(flagDir, 'maintenance.flag');
  process.env.MAINTENANCE_FLAG_PATH = flagPath;
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  rmSync(flagDir, { recursive: true, force: true });
  delete process.env.MAINTENANCE_FLAG_PATH;
});

beforeEach(() => {
  if (existsSync(flagPath)) unlinkSync(flagPath);
});

describe('maintenance middleware', () => {
  it('passes /api/* through when no flag', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/muscles' });
    // 200 if DB seeded, 401 if no auth — either way NOT 503.
    expect(res.statusCode).not.toBe(503);
  });

  it('returns 503 + Retry-After on /api/* when flag present', async () => {
    writeFileSync(flagPath, 'restore in progress', 'utf8');
    const res = await app.inject({ method: 'GET', url: '/api/muscles' });
    expect(res.statusCode).toBe(503);
    expect(res.headers['retry-after']).toBe('60');
    expect(res.json()).toMatchObject({ error: 'maintenance' });
  });

  it('passes /api/maintenance/* through even when flag present', async () => {
    writeFileSync(flagPath, 'restore in progress', 'utf8');
    const res = await app.inject({ method: 'GET', url: '/api/maintenance/status' });
    // 401 (CF Access required) or 200 — NEVER 503.
    expect(res.statusCode).not.toBe(503);
  });

  it('passes /health through even when flag present', async () => {
    // /health is the s6 healthcheck — if maintenance 503s it, s6 will
    // restart the container in a loop. Must stay green.
    writeFileSync(flagPath, 'restore in progress', 'utf8');
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });

  it('does not cache flag state — picks up changes mid-process', async () => {
    const r1 = await app.inject({ method: 'GET', url: '/api/muscles' });
    expect(r1.statusCode).not.toBe(503);
    writeFileSync(flagPath, 'now', 'utf8');
    const r2 = await app.inject({ method: 'GET', url: '/api/muscles' });
    expect(r2.statusCode).toBe(503);
    unlinkSync(flagPath);
    const r3 = await app.inject({ method: 'GET', url: '/api/muscles' });
    expect(r3.statusCode).not.toBe(503);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api
npx vitest run tests/integration/maintenance-middleware.test.ts
```

Expected: FAIL (returns 200/401, not 503).

- [ ] **Step 3: Implement middleware**

```typescript
// api/src/middleware/maintenance.ts
//
// Beta W5.2 — sentinel-file gated maintenance mode.
//
// Per Infra recommendation in master plan Appendix A: persistence is a
// file at /config/maintenance.flag, NOT a DB row. The DB may be mid-
// restore when the flag is checked; a row-based flag would be unreadable.
//
// Wired as a Fastify onRequest hook BEFORE any route plugin registers.
// Checks existence on every request — existsSync() on a hot inode is
// sub-microsecond. No cache: caching would defeat "API boots into
// maintenance mode when flag was written by the restore runner."
//
// Per I-FLAGPATH-CACHE: flagPath() resolution itself is module-load cached
// (env doesn't change at runtime); the existsSync() on that resolved path
// runs on every request.
//
// Bypass list (these routes work even with the flag set):
//   - /api/maintenance/*    — admin escape hatch (status + clear + restore-pre-snapshot)
//   - /health               — s6 healthcheck (would cause restart loop if 503d)
//
// Per I-HEALTH-MAINTENANCE: /health/user-facing is a SEPARATE endpoint
// that DOES return 503 during restore. External uptime monitors point at
// /health/user-facing so they alert during a restore window; the s6
// healthcheck stays on /health and is silent.
import { existsSync } from 'node:fs';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

const DEFAULT_MAINTENANCE_FLAG_PATH = '/config/maintenance.flag';

// Module-load cache per I-FLAGPATH-CACHE.
const FLAG_PATH = process.env.MAINTENANCE_FLAG_PATH ?? DEFAULT_MAINTENANCE_FLAG_PATH;

export function isMaintenanceModeActive(): boolean {
  return existsSync(FLAG_PATH);
}

function isBypassed(url: string): boolean {
  // Exact match for /health; prefix match for /api/maintenance.
  // /health/user-facing is NOT bypassed (per I-HEALTH-MAINTENANCE).
  if (url === '/health') return true;
  if (url.startsWith('/api/maintenance/') || url === '/api/maintenance') return true;
  return false;
}

export async function registerMaintenanceGate(app: FastifyInstance): Promise<void> {
  // I-HEALTH-MAINTENANCE — user-facing health endpoint that 503s during
  // restore so external uptime monitors don't go silent.
  app.get('/health/user-facing', async (_req, reply) => {
    if (isMaintenanceModeActive()) {
      reply.header('Retry-After', '60');
      return reply.code(503).send({ status: 'maintenance' });
    }
    return reply.send({ status: 'ok' });
  });

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!isMaintenanceModeActive()) return;
    if (isBypassed(req.url)) return;
    reply.header('Retry-After', '60');
    return reply.code(503).send({
      error: 'maintenance',
      retry_after_s: 60,
      message: 'RepOS is down for a database restore. ~60 seconds.',
    });
  });
}
```

- [ ] **Step 4: Wire into app.ts**

Edit `api/src/app.ts`, insert immediately after `await app.register(sensible);`:

```typescript
import { registerMaintenanceGate } from './middleware/maintenance.js';
// ...
await app.register(sensible);
await registerMaintenanceGate(app);  // ← BEFORE all /api/* plugins
await app.register(tokenRoutes, { prefix: '/api' });
// ... rest unchanged
```

- [ ] **Step 5: Extend `bootstrap-runtime.ts` with stale-row reaper + stale-lock detection**

Per I-STALE-ROW-REAPER + C-STALE-LOCK. At boot, before the maintenance-flag check log line, add:

```typescript
// W5 — I-STALE-ROW-REAPER. Mark stale running rows as failed so
// /api/backups doesn't show "running" forever when a process died.
// Threshold: 15 minutes for backups (which take 5-30s), restores
// flagged separately at 5 minutes since the user is actively waiting.
await db.query(`
  UPDATE backup_runs
  SET status='failed',
      error_message='reaped: process did not finalize',
      finished_at=now()
  WHERE status='running'
    AND trigger IN ('manual','auto','pre_restore')
    AND started_at < now() - interval '15 minutes'
`);

// W5 — C-STALE-LOCK. If /config/restore-state.json exists AND
// started_at < now() - 5 min, the restore process crashed. Mark
// the sentinel as failed so /api/maintenance/status returns
// recovery_available=true and the FE shows the Roll-back affordance.
const sentinelPath = process.env.RESTORE_STATE_PATH ?? '/config/restore-state.json';
if (existsSync(sentinelPath)) {
  try {
    const state = JSON.parse(readFileSync(sentinelPath, 'utf8'));
    const startedAt = new Date(state.started_at).getTime();
    if (state.status === 'running' && Date.now() - startedAt > 5 * 60 * 1000) {
      const updated = { ...state, status: 'failed', error_message: 'detected stale restore at boot', finished_at: new Date().toISOString() };
      const fd = openSync(sentinelPath, 'w');
      writeSync(fd, JSON.stringify(updated));
      fsyncSync(fd);
      closeSync(fd);
    }
  } catch (err) {
    console.warn('[boot] failed to read/update restore-state.json', err);
  }
}
```

Test the reaper with an additional case in `maintenance-middleware.test.ts`:

```typescript
it('reaps stale running backup_runs rows at boot', async () => {
  await db.query(
    `INSERT INTO backup_runs (trigger, status, started_at)
     VALUES ('manual', 'running', now() - interval '20 minutes')`,
  );
  // Re-import bootstrap-runtime to fire the reaper.
  const { validateMaintenanceFlag } = await import('../../src/bootstrap-runtime.js');
  await validateMaintenanceFlag(process.env);
  const { rows } = await db.query(
    `SELECT status, error_message FROM backup_runs WHERE error_message LIKE 'reaped:%'`,
  );
  expect(rows[0]).toMatchObject({ status: 'failed' });
});
```

- [ ] **Step 6: Run test to verify it passes**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api
npx vitest run tests/integration/maintenance-middleware.test.ts
```

Expected: 6/6 PASS (5 existing + reaper).

- [ ] **Step 7: Commit**

```bash
git add api/src/middleware/maintenance.ts api/src/app.ts \
        api/src/bootstrap-runtime.ts \
        api/tests/integration/maintenance-middleware.test.ts
git commit -m "$(cat <<'EOF'
feat: add maintenance-mode middleware + boot reaper (W5 P2)

Sentinel-file gated 503 for all /api/* routes except
/api/maintenance/* and /health. Per Infra recommendation in the
master plan Appendix A, persistence is /config/maintenance.flag
(file, not DB row) so the gate works even when the DB is mid-
restore. Checked on every request — no boot-time cache.

Includes I-STALE-ROW-REAPER + C-STALE-LOCK so a crashed restore
process surfaces with recovery_available=true on next boot.
Adds /health/user-facing for external uptime monitors.
EOF
)"
```

---

### Task 2b: Interim admin gate (W5-before-W6 hard-coded check)

**Files:** `api/src/middleware/cfAccess.ts` (modify; lines 176-202)

**Per D10:** the canonical admin gate is `REPOS_ADMIN_EMAILS` env-driven, owned by W6. If W5 ships first, W5 must include this interim 10-LOC check so admin-gated W5 routes aren't merely "any CF Access user."

- [ ] **Step 1: Check W6 status.** Run `git log --all --oneline -- api/src/middleware/cfAccess.ts | head -20`. If W6's `REPOS_ADMIN_EMAILS` change is already merged, skip this task and confirm `REPOS_ADMIN_EMAILS=jason@jpmtech.com` is set in `/config/.env`. Otherwise, proceed.

- [ ] **Step 2: Add the interim check.** Inside `requireAdminKeyOrCfAccess` at `cfAccess.ts:194-198`, after the `await requireCfAccess(req, reply)` resolves but before the function returns, insert:

```typescript
  if (isCfAccessEnabled()) {
    await requireCfAccess(req, reply);
    if (reply.sent) return;
    // W5 interim per D10 — hard-coded admin-email check. W6 swaps this
    // for env-driven REPOS_ADMIN_EMAILS allow-list. DO NOT remove this
    // block until W6 PR confirms the env-driven check is wired.
    const INTERIM_ADMIN_EMAIL = 'jason@jpmtech.com';
    const email = (req as any).userEmail ?? null;
    if (email !== INTERIM_ADMIN_EMAIL) {
      return reply.code(403).send({ error: 'admin_only' });
    }
    (req as any).authMode = 'cf_access';
    return;
  }
```

Also accept a new optional parameter for restore endpoints (per C-RESTORE-AUTH-CFACCESS):

```typescript
export function requireAdminKeyOrCfAccess(opts: { requireFreshCfAccess?: boolean } = {}) {
  return async function (req: FastifyRequest, reply: FastifyReply) {
    const adminKey = process.env.ADMIN_API_KEY;

    if (opts.requireFreshCfAccess) {
      // Restore endpoints — reject X-Admin-Key, require CF Access JWT only.
      if (!isCfAccessEnabled()) {
        return reply.code(503).send({ error: 'cf_access_unavailable' });
      }
      await requireCfAccess(req, reply);
      if (reply.sent) return;
      const email = (req as any).userEmail ?? null;
      if (email !== 'jason@jpmtech.com') {  // W6 swap
        return reply.code(403).send({ error: 'admin_only' });
      }
      (req as any).authMode = 'cf_access_fresh';
      return;
    }
    // ...existing dual-auth logic with the interim email check above
  };
}
```

**Note for implementer:** the existing call sites (`tokens.ts`, every W5 route except restore) consume `requireAdminKeyOrCfAccess` as a direct function. Converting to a factory means changing every `preHandler: requireAdminKeyOrCfAccess` to `preHandler: requireAdminKeyOrCfAccess()`. Do this in the same PR.

- [ ] **Step 3: Test**

```typescript
// api/tests/integration/admin-gate.test.ts
it('requireFreshCfAccess rejects X-Admin-Key path', async () => {
  process.env.ADMIN_API_KEY = 'test-key';
  const app = await buildApp();
  // Mount a test-only route with the strict gate.
  app.post('/api/_test/strict', { preHandler: requireAdminKeyOrCfAccess({ requireFreshCfAccess: true }) }, async () => ({ ok: true }));
  const res = await app.inject({
    method: 'POST', url: '/api/_test/strict',
    headers: { 'x-admin-key': 'test-key' },
  });
  expect([401, 403, 503]).toContain(res.statusCode);  // never 200
});
```

- [ ] **Step 4: Commit**

```bash
git add api/src/middleware/cfAccess.ts api/tests/integration/admin-gate.test.ts
git commit -m "feat(security): interim admin-email gate + requireFreshCfAccess (W5 D10 + C-RESTORE-AUTH-CFACCESS)"
```

---

## Phase 3 — Backup CRUD endpoints

### Task 3: Backups list + Zod schemas

**Files:**
- Create: `api/src/schemas/backups.ts`
- Create: `api/src/routes/backups.ts`
- Modify: `api/src/app.ts` — register `backupRoutes`
- Test: `api/tests/integration/backups-list.test.ts`

Auth: `requireAdminKeyOrCfAccess` (matches `tokens.ts` pattern — see `middleware/cfAccess.ts:176`). Restore additionally requires a typed-confirmation body; that lives in Task 6.

- [ ] **Step 1: Write the failing list-endpoint test**

```typescript
// api/tests/integration/backups-list.test.ts
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/client.js';

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let backupsDir: string;

beforeAll(async () => {
  backupsDir = mkdtempSync(join(tmpdir(), 'repos-backups-'));
  process.env.BACKUPS_DIR = backupsDir;
  delete process.env.ADMIN_API_KEY;  // open admin path for the test
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  rmSync(backupsDir, { recursive: true, force: true });
  delete process.env.BACKUPS_DIR;
});

beforeEach(async () => {
  await db.query(`DELETE FROM backup_runs`);
});

describe('GET /api/backups', () => {
  it('returns empty array when no snapshots', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/backups' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [] });
  });

  // Note: backup_runs.event_kind defaults to 'create' — these seed rows
  // rely on the default so they remain readable. Download/delete rows
  // (event_kind != 'create') are filtered out of the list query.
  it('joins on-disk file + backup_runs row + sidecar JSON', async () => {
    const file = join(backupsDir, 'repos-20260525T030000Z.dump.gz');
    const sidecar = join(backupsDir, 'repos-20260525T030000Z.json');
    writeFileSync(file, Buffer.from([0x1f, 0x8b])); // gzip magic only — not parsed here
    writeFileSync(
      sidecar,
      JSON.stringify({
        file: 'repos-20260525T030000Z.dump.gz',
        size_bytes: 2,
        trigger: 'auto',
        created_at: '2026-05-25T03:00:00Z',
      }),
    );
    await db.query(
      `INSERT INTO backup_runs (trigger, status, file_path, size_bytes, integrity_verified, started_at, finished_at)
       VALUES ('auto', 'ok', $1, 2, true, '2026-05-25T03:00:00Z', '2026-05-25T03:00:05Z')`,
      [file],
    );

    const res = await app.inject({ method: 'GET', url: '/api/backups' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      id: 'repos-20260525T030000Z.dump.gz',
      trigger: 'auto',
      size_bytes: 2,
      verified_restorable: 'good',  // integrity_verified=true && file exists
      created_at: '2026-05-25T03:00:00Z',
    });
  });

  it('marks badge danger when file present but integrity_verified=false', async () => {
    const file = join(backupsDir, 'repos-broken.dump.gz');
    writeFileSync(file, Buffer.from([0x00])); // not gzip
    await db.query(
      `INSERT INTO backup_runs (trigger, status, file_path, size_bytes, integrity_verified, started_at, finished_at)
       VALUES ('manual', 'ok', $1, 1, false, now(), now())`,
      [file],
    );
    const res = await app.inject({ method: 'GET', url: '/api/backups' });
    expect(res.json().items[0].verified_restorable).toBe('danger');
  });

  it('marks badge warn when audit row exists but file is missing on disk', async () => {
    await db.query(
      `INSERT INTO backup_runs (trigger, status, file_path, size_bytes, integrity_verified, started_at, finished_at)
       VALUES ('manual', 'ok', $1, 100, true, now(), now())`,
      [join(backupsDir, 'gone.dump.gz')],
    );
    const res = await app.inject({ method: 'GET', url: '/api/backups' });
    expect(res.json().items[0].verified_restorable).toBe('warn');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api
npx vitest run tests/integration/backups-list.test.ts
```

Expected: FAIL (route not registered, 404).

- [ ] **Step 3: Write `api/src/schemas/backups.ts`**

```typescript
import { z } from 'zod';

export const BackupTriggerSchema = z.enum(['manual', 'auto', 'pre_restore', 'restore']);
export type BackupTrigger = z.infer<typeof BackupTriggerSchema>;

// [ABS-2] Badge tiers per master plan Appendix A W5.4.
//   'good'   — file on disk AND integrity_verified=true
//   'warn'   — audit row exists, integrity_verified=true, BUT file gone from disk
//   'danger' — file on disk but integrity_verified=false (gunzip|pg_restore -l failed)
// Restore button DISABLED for 'danger'; rendered with explanatory tooltip for 'warn'.
export const VerifiedRestorableSchema = z.enum(['good', 'warn', 'danger']);
export type VerifiedRestorable = z.infer<typeof VerifiedRestorableSchema>;

export const BackupItemSchema = z.object({
  id: z.string(),                 // filename (URL-safe; serves as PK in API)
  trigger: BackupTriggerSchema,
  size_bytes: z.number().int().nonnegative(),
  verified_restorable: VerifiedRestorableSchema,
  created_at: z.string(),          // ISO 8601
});
export type BackupItem = z.infer<typeof BackupItemSchema>;

export const BackupListResponseSchema = z.object({
  items: z.array(BackupItemSchema),
});
export type BackupListResponse = z.infer<typeof BackupListResponseSchema>;

// Restore typed-confirmation body. Frontend types literally "RESTORE".
export const RestoreRequestSchema = z.object({
  confirm: z.literal('RESTORE'),
});
export type RestoreRequest = z.infer<typeof RestoreRequestSchema>;
```

- [ ] **Step 4: Write `api/src/routes/backups.ts` (list endpoint only — restore lands in Task 6)**

```typescript
// api/src/routes/backups.ts
//
// Beta W5 — backup CRUD. /api/backups list joins on-disk filenames with
// backup_runs audit rows to render the verified-restorable badge per
// Design spec ABS-2.
//
// Auth: requireAdminKeyOrCfAccess (matches tokens.ts pattern). The CLI
// path uses X-Admin-Key; the browser path uses CF Access JWT.
//
// File-id contract: the filename IS the API id. Filenames are sortable
// (ISO timestamp) + unique by-design via the timestamp; no separate UUID.
import type { FastifyInstance } from 'fastify';
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../db/client.js';
import { requireAdminKeyOrCfAccess } from '../middleware/cfAccess.js';
import { BackupListResponseSchema, type BackupItem, type VerifiedRestorable } from '../schemas/backups.js';

function backupsDir(): string {
  return process.env.BACKUPS_DIR ?? '/config/backups';
}

function badgeFor(fileExists: boolean, integrityVerified: boolean): VerifiedRestorable {
  if (!fileExists) return 'warn';
  if (!integrityVerified) return 'danger';
  return 'good';
}

function readSidecar(dir: string, dumpFilename: string): { created_at?: string; trigger?: string } | null {
  const sidecar = join(dir, dumpFilename.replace(/\.dump\.gz$|\.sql\.gz$/, '.json'));
  if (!existsSync(sidecar)) return null;
  try {
    return JSON.parse(readFileSync(sidecar, 'utf8'));
  } catch {
    return null;
  }
}

export async function backupRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/backups',
    { preHandler: requireAdminKeyOrCfAccess },
    async (_req, reply) => {
      const dir = backupsDir();
      const onDisk = existsSync(dir)
        ? readdirSync(dir).filter((f) => f.endsWith('.dump.gz') || f.endsWith('.sql.gz'))
        : [];

      // Pull CREATE rows only (latest first) — per C-DOWNLOAD-AUDIT the table
      // also stores download/delete event rows. The snapshot listing shows the
      // snapshot's creation; download/delete are pure audit, not list entries.
      const { rows } = await db.query(
        `SELECT trigger, status, file_path, size_bytes, integrity_verified, started_at
         FROM backup_runs
         WHERE status = 'ok'
           AND event_kind = 'create'
           AND trigger IN ('manual', 'auto', 'pre_restore')
         ORDER BY started_at DESC`,
      );

      const items: BackupItem[] = rows.map((r: any) => {
        const filename = r.file_path ? r.file_path.split('/').pop()! : '(unknown)';
        const fileExists = onDisk.includes(filename);
        const sidecar = readSidecar(dir, filename);
        return {
          id: filename,
          trigger: r.trigger,
          size_bytes: Number(r.size_bytes ?? 0),
          verified_restorable: badgeFor(fileExists, r.integrity_verified),
          created_at: sidecar?.created_at ?? new Date(r.started_at).toISOString(),
        };
      });

      const body = BackupListResponseSchema.parse({ items });
      return reply.send(body);
    },
  );
}
```

- [ ] **Step 5: Register in app.ts**

```typescript
import { backupRoutes } from './routes/backups.js';
// ... after maintenance gate
await app.register(backupRoutes, { prefix: '/api' });
```

- [ ] **Step 6: Run test to verify it passes**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api
npx vitest run tests/integration/backups-list.test.ts
```

Expected: 4/4 PASS.

- [ ] **Step 7: Commit**

```bash
git add api/src/schemas/backups.ts api/src/routes/backups.ts api/src/app.ts \
        api/tests/integration/backups-list.test.ts
git commit -m "feat: add GET /api/backups + badge tier inference (W5 P3)"
```

### Task 4: POST /api/backups (manual snapshot)

**Files:**
- Modify: `api/src/routes/backups.ts` — add `POST /backups`
- Modify: `docker/root/usr/local/bin/repos-backup.sh` — add `--trigger=manual|auto` flag + Healthchecks ping + `scheduler.log` 14-day prune + integrity check (ABS-7)
- Create: `api/src/services/backupRunner.ts` — node-side shellout helper that invokes the backup script
- Test: `api/tests/integration/backups-create.test.ts`

- [ ] **Step 1: Write the failing create-backup test**

```typescript
// api/tests/integration/backups-create.test.ts
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/client.js';

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let backupsDir: string;

beforeAll(async () => {
  backupsDir = mkdtempSync(join(tmpdir(), 'repos-backups-create-'));
  process.env.BACKUPS_DIR = backupsDir;
  delete process.env.ADMIN_API_KEY;
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
  rmSync(backupsDir, { recursive: true, force: true });
});
beforeEach(async () => {
  await db.query(`DELETE FROM backup_runs`);
});

describe('POST /api/backups', () => {
  it('creates a manual snapshot, writes audit row + sidecar JSON, returns 201 with id', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/backups' });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toMatch(/^repos-\d{8}T\d{6}Z\.dump\.gz$/);
    expect(body.verified_restorable).toBe('good');

    // On-disk artifact + sidecar
    const files = readdirSync(backupsDir);
    expect(files).toContain(body.id);
    expect(files).toContain(body.id.replace('.dump.gz', '.json'));

    // Audit row
    const { rows } = await db.query(
      `SELECT trigger, status, integrity_verified FROM backup_runs WHERE file_path LIKE '%' || $1`,
      [body.id],
    );
    expect(rows[0]).toMatchObject({ trigger: 'manual', status: 'ok', integrity_verified: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api
npx vitest run tests/integration/backups-create.test.ts
```

Expected: FAIL (404 — POST not registered).

- [ ] **Step 3: Implement `api/src/services/backupRunner.ts`**

```typescript
// api/src/services/backupRunner.ts
//
// W5.4 — node-side shellout to the existing repos-backup.sh. In test we
// stub by running pg_dump directly against process.env.DATABASE_URL so
// the suite doesn't require s6-overlay. In production the path lives at
// /usr/local/bin/repos-backup.sh per the container layout.
import { spawn } from 'node:child_process';
import { existsSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../db/client.js';

export interface BackupResult {
  id: string;
  file_path: string;
  size_bytes: number;
  trigger: 'manual' | 'auto';
}

function backupsDir(): string {
  return process.env.BACKUPS_DIR ?? '/config/backups';
}

function timestampedFilename(): string {
  // ISO-8601 compact (matches repos-backup.sh format).
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `repos-${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z.dump.gz`
  );
}

export interface ManualBackupCaller {
  adminUserId: string | null;  // C-ADMIN-USER-ID — populated from (req as any).userId
  sourceIp: string | null;     // C-DOWNLOAD-AUDIT — req.ip / x-forwarded-for
}

export async function runManualBackup(caller: ManualBackupCaller): Promise<BackupResult> {
  const filename = timestampedFilename();
  const filePath = join(backupsDir(), filename);

  const { rows: started } = await db.query(
    `INSERT INTO backup_runs (trigger, event_kind, status, file_path, admin_user_id, source_ip, started_at)
     VALUES ('manual', 'create', 'running', $1, $2, $3, now())
     RETURNING id`,
    [filePath, caller.adminUserId, caller.sourceIp],
  );
  const runId = started[0].id;

  try {
    await dumpToFile(filePath);
    const sizeBytes = statSync(filePath).size;
    await integrityCheck(filePath);  // gunzip | pg_restore -l
    writeSidecar(filePath, sizeBytes, 'manual');

    await db.query(
      `UPDATE backup_runs SET status='ok', size_bytes=$1, integrity_verified=true, finished_at=now()
       WHERE id=$2`,
      [sizeBytes, runId],
    );
    return { id: filename, file_path: filePath, size_bytes: sizeBytes, trigger: 'manual' };
  } catch (err) {
    await db.query(
      `UPDATE backup_runs SET status='failed', error_message=$1, finished_at=now() WHERE id=$2`,
      [(err as Error).message, runId],
    );
    throw err;
  }
}

function dumpToFile(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = process.env.DATABASE_URL;
    if (!url) return reject(new Error('DATABASE_URL not set'));
    // pg_dump custom-format | gzip → file. shell:true so the pipe is honored.
    const child = spawn(
      'bash',
      ['-c', `pg_dump --format=custom "${url}" | gzip -6 > "${filePath}"`],
      { stdio: ['ignore', 'inherit', 'inherit'] },
    );
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`pg_dump exited ${code}`))));
  });
}

function integrityCheck(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'bash',
      ['-c', `gunzip -c "${filePath}" | pg_restore -l > /dev/null`],
      { stdio: ['ignore', 'ignore', 'inherit'] },
    );
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`integrity check failed (gunzip|pg_restore -l exit ${code})`)),
    );
  });
}

function writeSidecar(filePath: string, sizeBytes: number, trigger: 'manual' | 'auto'): void {
  const sidecar = filePath.replace(/\.dump\.gz$/, '.json');
  // I-SIDECAR-PERMS — 0640 + metadata-only contract (no PII / user-identifying fields).
  writeFileSync(
    sidecar,
    JSON.stringify({
      file: filePath.split('/').pop(),
      size_bytes: sizeBytes,
      trigger,
      created_at: new Date().toISOString(),
    }),
    { mode: 0o640 },
  );
}
```

- [ ] **Step 4: Add `POST /api/backups` to `backups.ts`**

```typescript
// inside backupRoutes, after the GET:
app.post(
  '/backups',
  { preHandler: requireAdminKeyOrCfAccess() },
  async (req, reply) => {
    const result = await runManualBackup({
      adminUserId: (req as any).userId ?? null,  // C-ADMIN-USER-ID
      sourceIp: (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.ip ?? null,
    });
    return reply.code(201).send({
      id: result.id,
      trigger: 'manual',
      size_bytes: result.size_bytes,
      verified_restorable: 'good',
      created_at: new Date().toISOString(),
    });
  },
);
```

(Add `import { runManualBackup } from '../services/backupRunner.js';` at the top.)

- [ ] **Step 5: [ABS-7] Extend `docker/root/usr/local/bin/repos-backup.sh` with integrity check + Healthchecks ping + scheduler.log prune**

Edit the existing file. After the `mv "$tmp" "$out"` line, before the `find` retention block, insert:

```bash
# W5.1 — integrity check. gunzip | pg_restore -l must exit 0; on fail,
# delete the bad file + INSERT a failed audit row + exit non-zero.
if ! gunzip -c "$out" | pg_restore -l > /dev/null 2>>"$log"; then
  echo "[$(date -u +%FT%TZ)] FAIL integrity check (gunzip|pg_restore -l)" | tee -a "$log" >&2
  # C-AUTOBACKUP-AUDIT — even on failure, record the attempt.
  psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 <<SQL || true
INSERT INTO backup_runs (trigger, event_kind, status, file_path, size_bytes,
                         integrity_verified, error_message, started_at, finished_at)
VALUES ('auto', 'create', 'failed', '${out}', ${size}, false,
        'gunzip|pg_restore -l integrity check failed', now(), now());
SQL
  rm -f "$out"
  exit 2
fi

# Sidecar JSON (matches backupRunner.ts shape).
# I-SIDECAR-PERMS — 0640 to match dump permissions. Schema: metadata only,
# NO user-identifying fields ever (no usernames, no emails, no IPs).
cat > "${out%.dump.gz}.json" <<JSON
{"file":"$(basename "$out")","size_bytes":${size},"trigger":"auto","created_at":"$(date -u +%FT%TZ)"}
JSON
chmod 0640 "${out%.dump.gz}.json"

# C-AUTOBACKUP-AUDIT — INSERT the success row so the nightly backup
# appears in GET /api/backups. Without this, the API list endpoint
# filters on `status='ok' AND trigger IN ('manual','auto','pre_restore')`
# and the auto row is missing entirely. event_kind='create' is the default.
psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 <<SQL
INSERT INTO backup_runs (trigger, event_kind, status, file_path, size_bytes,
                         integrity_verified, started_at, finished_at)
VALUES ('auto', 'create', 'ok', '${out}', ${size}, true, now(), now());
SQL

# W5.2 — Healthchecks.io heartbeat. Quiet curl; never block backup on
# Healthchecks reachability. Both UUIDs (ABS-5) live in /config/.env.
if [ -n "${HEALTHCHECKS_BACKUP_UUID:-}" ]; then
  curl -fsS --max-time 10 -o /dev/null \
    "https://hc-ping.com/${HEALTHCHECKS_BACKUP_UUID}" || true
fi
```

After the existing `find ... -name 'repos-*.dump.gz' ... -delete`, also prune sidecar JSONs to match:

```bash
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'repos-*.json' \
  -mtime +"$RETAIN_DAYS" -print -delete | tee -a "$log"
```

[ABS-7] Edit `docker/root/etc/s6-overlay/s6-rc.d/backup/run`, after the `while :;` opening, add right after `mkdir -p /config/log/backup`:

```bash
# W5 ABS-7 — prune scheduler.log to match dump retention (14d).
find /config/log/backup -maxdepth 1 -type f -name 'scheduler.log*' \
  -mtime +"${REPOS_BACKUP_RETAIN_DAYS:-14}" -delete 2>/dev/null || true
```

- [ ] **Step 6: Run test to verify it passes**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api
npx vitest run tests/integration/backups-create.test.ts
```

Expected: PASS (creates file + sidecar + audit row).

- [ ] **Step 7: Commit**

```bash
git add api/src/services/backupRunner.ts api/src/routes/backups.ts \
        docker/root/usr/local/bin/repos-backup.sh \
        docker/root/etc/s6-overlay/s6-rc.d/backup/run \
        api/tests/integration/backups-create.test.ts
git commit -m "feat: add POST /api/backups + integrity check on nightly cron (W5 P3)"
```

### Task 5: DELETE + Download endpoints

**Files:**
- Modify: `api/src/routes/backups.ts`
- Test: `api/tests/integration/backups-delete-download.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// api/tests/integration/backups-delete-download.test.ts
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/client.js';

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let backupsDir: string;

beforeAll(async () => {
  backupsDir = mkdtempSync(join(tmpdir(), 'repos-backups-del-'));
  process.env.BACKUPS_DIR = backupsDir;
  delete process.env.ADMIN_API_KEY;
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
  rmSync(backupsDir, { recursive: true, force: true });
});

describe('DELETE /api/backups/:id', () => {
  it('removes file + sidecar + leaves audit row in place (audit is immutable)', async () => {
    const filename = 'repos-20260524T030000Z.dump.gz';
    const file = join(backupsDir, filename);
    const sidecar = file.replace('.dump.gz', '.json');
    writeFileSync(file, Buffer.from([0x1f, 0x8b]));
    writeFileSync(sidecar, '{}');
    await db.query(
      `INSERT INTO backup_runs (trigger, status, file_path, integrity_verified, started_at, finished_at)
       VALUES ('manual', 'ok', $1, true, now(), now())`,
      [file],
    );

    const res = await app.inject({ method: 'DELETE', url: `/api/backups/${filename}` });
    expect(res.statusCode).toBe(204);
    expect(existsSync(file)).toBe(false);
    expect(existsSync(sidecar)).toBe(false);

    // Audit row still present, but list endpoint now badges this row 'warn'.
    const { rows } = await db.query(`SELECT count(*)::int AS c FROM backup_runs WHERE file_path=$1`, [file]);
    expect(rows[0].c).toBe(1);
  });

  it('rejects path traversal — only filenames within backupsDir', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/backups/..%2Fetc%2Fpasswd' });
    expect([400, 404]).toContain(res.statusCode);
  });
});

describe('GET /api/backups/:id/download', () => {
  it('streams the file bytes with application/gzip + Content-Disposition', async () => {
    const filename = 'repos-20260523T030000Z.dump.gz';
    const file = join(backupsDir, filename);
    writeFileSync(file, Buffer.from([0x1f, 0x8b, 0x08]));
    const res = await app.inject({ method: 'GET', url: `/api/backups/${filename}/download` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/gzip/);
    expect(res.headers['content-disposition']).toContain(filename);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/integration/backups-delete-download.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement DELETE + download**

In `api/src/routes/backups.ts`, add:

```typescript
import { unlinkSync, createReadStream } from 'node:fs';

function safeBackupPath(id: string): string | null {
  // Filename whitelist: must match the timestamped pattern OR pre-restore-*.
  if (!/^(repos-\d{8}T\d{6}Z\.dump\.gz|pre-restore-\d{8}T\d{6}Z\.sql\.gz)$/.test(id)) {
    return null;
  }
  return join(backupsDir(), id);
}

// Helper to derive caller context for audit rows.
function callerContext(req: any): { adminUserId: string | null; sourceIp: string | null } {
  return {
    adminUserId: req.userId ?? null,
    sourceIp: (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.ip ?? null,
  };
}

// Inside backupRoutes:
app.delete(
  '/backups/:id',
  { preHandler: requireAdminKeyOrCfAccess() },
  async (req, reply) => {
    const { id } = req.params as { id: string };
    const filePath = safeBackupPath(id);
    if (!filePath) return reply.code(400).send({ error: 'invalid_backup_id' });
    const sizeBytes = existsSync(filePath) ? statSync(filePath).size : 0;
    if (existsSync(filePath)) unlinkSync(filePath);
    const sidecar = filePath.replace(/\.(dump|sql)\.gz$/, '.json');
    if (existsSync(sidecar)) unlinkSync(sidecar);
    // I-DELETE-BACKUP-AUDIT — append a row recording who deleted what.
    const { adminUserId, sourceIp } = callerContext(req);
    await db.query(
      `INSERT INTO backup_runs (trigger, event_kind, status, file_path, size_bytes,
                                admin_user_id, source_ip, started_at, finished_at)
       VALUES ('manual', 'delete', 'ok', $1, $2, $3, $4, now(), now())`,
      [filePath, sizeBytes, adminUserId, sourceIp],
    );
    return reply.code(204).send();
  },
);

app.get(
  '/backups/:id/download',
  { preHandler: requireAdminKeyOrCfAccess() },
  async (req, reply) => {
    const { id } = req.params as { id: string };
    const filePath = safeBackupPath(id);
    if (!filePath || !existsSync(filePath)) return reply.code(404).send({ error: 'not_found' });
    const sizeBytes = statSync(filePath).size;
    // C-DOWNLOAD-AUDIT — D9 — every download writes a new backup_runs row.
    const { adminUserId, sourceIp } = callerContext(req);
    await db.query(
      `INSERT INTO backup_runs (trigger, event_kind, status, file_path, size_bytes,
                                admin_user_id, source_ip, started_at, finished_at)
       VALUES ('manual', 'download', 'ok', $1, $2, $3, $4, now(), now())`,
      [filePath, sizeBytes, adminUserId, sourceIp],
    );
    reply
      .header('Content-Type', 'application/gzip')
      .header('Content-Length', String(sizeBytes))  // I-CONTENT-LENGTH — browser shows progress
      .header('Content-Disposition', `attachment; filename="${id}"`);
    return reply.send(createReadStream(filePath));
  },
);
```

Add a test case asserting the download audit row + Content-Length header:

```typescript
it('writes a download audit row + sets Content-Length per request', async () => {
  const filename = 'repos-20260523T030000Z.dump.gz';
  const file = join(backupsDir, filename);
  writeFileSync(file, Buffer.from([0x1f, 0x8b, 0x08, 0x09, 0x0a]));
  const before = (await db.query(`SELECT count(*)::int AS c FROM backup_runs WHERE event_kind='download'`)).rows[0].c;
  const res = await app.inject({ method: 'GET', url: `/api/backups/${filename}/download` });
  expect(res.statusCode).toBe(200);
  expect(res.headers['content-length']).toBe('5');
  const after = (await db.query(`SELECT count(*)::int AS c FROM backup_runs WHERE event_kind='download'`)).rows[0].c;
  expect(after).toBe(before + 1);
});

it('writes a delete audit row when DELETE fires', async () => {
  const filename = 'repos-20260522T030000Z.dump.gz';
  writeFileSync(join(backupsDir, filename), Buffer.from([0x1f, 0x8b]));
  const before = (await db.query(`SELECT count(*)::int AS c FROM backup_runs WHERE event_kind='delete'`)).rows[0].c;
  await app.inject({ method: 'DELETE', url: `/api/backups/${filename}` });
  const after = (await db.query(`SELECT count(*)::int AS c FROM backup_runs WHERE event_kind='delete'`)).rows[0].c;
  expect(after).toBe(before + 1);
});
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/integration/backups-delete-download.test.ts
```

Expected: 3/3 PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/backups.ts api/tests/integration/backups-delete-download.test.ts
git commit -m "feat: add DELETE + download for /api/backups/:id (W5 P3)"
```

---

## Phase 4 — Restore endpoint + maintenance routes

### Task 6: Restore endpoint scaffold + maintenance routes

**Files:**
- Create: `api/src/routes/maintenance.ts`
- Create: `api/src/services/restoreRunner.ts`
- Modify: `api/src/routes/backups.ts` — add `POST /backups/:id/restore`
- Modify: `api/src/app.ts` — register `maintenanceRoutes`
- Test: `api/tests/integration/maintenance-routes.test.ts`

**Atomic contract (C-RESTORE-ORDERING + C-AUDIT-SENTINEL + C-FSYNC-FLAG):** the restore endpoint is **kick-off-only**. The exact sequence is:

1. Re-run `integrityCheck(filePath)` on the source dump (I-INTEGRITY-AT-RESTORE — bitrot defence).
2. Open `/config/maintenance.flag`, `writeSync` the payload, `fsyncSync(fd)`, `closeSync(fd)`. **Then** the gate is durable across host reboot.
3. Insert the `event_kind='restore_init'` audit row in `backup_runs` (this row will survive the restore IF the dump is recent enough, but we DO NOT depend on it — see step 4).
4. Write the durable sentinel `/config/restore-state.json` with `{restore_id, status:'running', started_at, source_filename, pre_snapshot_filename}` + `fsync`. **This is the source of truth for `/api/maintenance/status` from step 5 onwards.** The DB `backup_runs` row will be wiped by the restore — only the post-clear `restore_complete` row survives in the DB.
5. Spawn-detach `run-restore.sh`. The child script:
   - **SIGTERMs the API** (`s6-rc -d change api`) so the API drains its pg pool and exits BEFORE pg_restore opens DROP on tables the pool has prepared statements against.
   - Waits for the API to exit (sentinel: API PID file gone or `s6-rc check api` shows down).
   - Runs `pre-restore-snapshot.sh` (the rollback point).
   - Runs `pg_restore --clean --if-exists` against the now-idle DB.
   - Runs migrations.
   - Updates `device_tokens` (per C-DEVICE-TOKENS-RESTORE).
   - `setval` on `backup_runs_id_seq` (per I-SEQUENCE-RESET).
   - Updates `/config/restore-state.json` to `status='ok'` (or `'failed'` on any non-zero exit, with `error_message`).
   - `s6-rc -u change api` to boot the API back up. The new API sees the flag, stays in maintenance mode.
6. The endpoint returns 202 immediately after step 4 — the user reads progress via `GET /api/maintenance/status` (which reads `/config/restore-state.json`, NOT a DB row).
7. Admin verifies + calls `POST /api/maintenance/clear`. The clear handler appends a `event_kind='restore_complete'` row to `backup_runs` populated from the sentinel, removes the sentinel + the maintenance flag, returns 204.

The old ordering (write flag → audit → restore → migrate → SIGTERM API) was wrong: the API held pool connections against a DB being DROPped+restored, which surfaced as connection-reset noise mid-pg_restore. The new ordering puts the API down before any destructive DB op runs.

- [ ] **Step 1: Write the failing maintenance-routes test**

```typescript
// api/tests/integration/maintenance-routes.test.ts
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, unlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/client.js';

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let flagPath: string;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'repos-maint-routes-'));
  flagPath = join(dir, 'maintenance.flag');
  process.env.MAINTENANCE_FLAG_PATH = flagPath;
  delete process.env.ADMIN_API_KEY;
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
  rmSync(flagPath, { force: true });
});
beforeEach(async () => {
  if (existsSync(flagPath)) unlinkSync(flagPath);
  await db.query(`DELETE FROM backup_runs`);
});

describe('maintenance routes', () => {
  it('GET /api/maintenance/status returns {active:false} when no flag', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/maintenance/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ active: false });
  });

  it('GET /api/maintenance/status returns {active:true, restore:{...}} when restore running', async () => {
    writeFileSync(flagPath, 'restore', 'utf8');
    await db.query(
      `INSERT INTO backup_runs (trigger, status, file_path, started_at)
       VALUES ('restore', 'running', '/tmp/repos-x.dump.gz', now())`,
    );
    const res = await app.inject({ method: 'GET', url: '/api/maintenance/status' });
    expect(res.json()).toMatchObject({ active: true, restore: { status: 'running' } });
  });

  it('GET /api/maintenance/status surfaces the failed restore + recovery affordance', async () => {
    writeFileSync(flagPath, 'restore', 'utf8');
    await db.query(
      `INSERT INTO backup_runs (trigger, status, file_path, error_message, started_at, finished_at)
       VALUES ('restore', 'failed', '/tmp/repos-x.dump.gz', 'migration 49 failed', now(), now())`,
    );
    const res = await app.inject({ method: 'GET', url: '/api/maintenance/status' });
    expect(res.json()).toMatchObject({
      active: true,
      restore: { status: 'failed', error_message: 'migration 49 failed' },
      recovery_available: true,  // there's at least one pre_restore snapshot to roll back to
    });
  });

  it('POST /api/maintenance/clear removes the flag (admin-only)', async () => {
    writeFileSync(flagPath, 'restore', 'utf8');
    const res = await app.inject({ method: 'POST', url: '/api/maintenance/clear' });
    expect(res.statusCode).toBe(204);
    expect(existsSync(flagPath)).toBe(false);
  });

  it('POST /api/maintenance/clear is a no-op when no flag', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/maintenance/clear' });
    expect(res.statusCode).toBe(204);
  });
});

describe('POST /api/backups/:id/restore', () => {
  it('rejects without typed confirmation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/backups/repos-20260524T030000Z.dump.gz/restore',
      headers: { 'content-type': 'application/json' },
      payload: { confirm: 'oops' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('writes the maintenance flag + audit row + returns 202 when body confirms', async () => {
    // Seed an on-disk dump so the runner has something to point at
    const dumpDir = process.env.BACKUPS_DIR!;
    const filename = 'repos-20260524T030000Z.dump.gz';
    writeFileSync(join(dumpDir, filename), Buffer.from([0x1f, 0x8b]));
    await db.query(
      `INSERT INTO backup_runs (trigger, status, file_path, integrity_verified, started_at, finished_at)
       VALUES ('manual', 'ok', $1, true, now(), now())`,
      [join(dumpDir, filename)],
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/backups/${filename}/restore`,
      headers: { 'content-type': 'application/json' },
      payload: { confirm: 'RESTORE' },
    });
    expect(res.statusCode).toBe(202);
    expect(existsSync(flagPath)).toBe(true);
    const { rows } = await db.query(
      `SELECT trigger, status FROM backup_runs WHERE trigger='restore' ORDER BY started_at DESC LIMIT 1`,
    );
    expect(rows[0]).toMatchObject({ trigger: 'restore', status: 'running' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/integration/maintenance-routes.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `api/src/services/restoreRunner.ts`**

```typescript
// api/src/services/restoreRunner.ts
//
// W5 — restore orchestration.
//
// kickOffRestore() implements C-RESTORE-ORDERING + C-AUDIT-SENTINEL +
// C-FSYNC-FLAG + I-INTEGRITY-AT-RESTORE.
//
//   1. Re-run integrity check on the source dump (bitrot defence).
//   2. Pick the pre-restore snapshot filename (so we can write it into the sentinel
//      BEFORE pre-restore-snapshot.sh runs in the child — the sentinel needs to be
//      complete from t=0 so /api/maintenance/status can present recovery_available).
//   3. Write /config/maintenance.flag with fsync (durable across crash/reboot).
//   4. Insert backup_runs.restore_init audit row (best-effort historical anchor —
//      MAY be wiped by the restore itself; the source of truth is the sentinel).
//   5. Write /config/restore-state.json sentinel with fsync — the durable run state.
//   6. spawn-detach scripts/run-restore.sh (the script SIGTERMs the API as its
//      first action so the pool drains before pg_restore touches the DB).
//   7. Return immediately. The child writes its outcome to the sentinel.
//
// The runner is NOT responsible for clearing the maintenance flag —
// per the master plan: "Admin must clear the flag via /api/maintenance/clear
// once DB state is verified." That handler is also where the
// event_kind='restore_complete' row is appended to backup_runs.
import { spawn } from 'node:child_process';
import { writeFileSync, existsSync, openSync, writeSync, fsyncSync, closeSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { db } from '../db/client.js';

export interface RestoreKickoff {
  restore_id: string;     // sentinel id (uuid-ish; the user reads progress with this)
  source_file: string;
}

// I-FLAGPATH-CACHE — module-load resolution.
const FLAG_PATH = process.env.MAINTENANCE_FLAG_PATH ?? '/config/maintenance.flag';
const SENTINEL_PATH = process.env.RESTORE_STATE_PATH ?? '/config/restore-state.json';
const BACKUPS_DIR = process.env.BACKUPS_DIR ?? '/config/backups';
const SCRIPTS_DIR = process.env.REPOS_SCRIPTS_DIR ?? '/app/scripts';

function fsyncWrite(path: string, contents: string): void {
  // C-FSYNC-FLAG — guarantee durability before any consumer reads.
  const fd = openSync(path, 'w');
  try {
    writeSync(fd, contents);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function integrityCheck(filePath: string): void {
  // I-INTEGRITY-AT-RESTORE — bitrot defence. Synchronous because the
  // route handler awaits the entire kickoff.
  const res = spawnSync('bash', ['-c', `gunzip -c "${filePath}" | pg_restore -l > /dev/null`]);
  if (res.status !== 0) {
    throw new Error(`source dump failed pg_restore -l (bitrot? exit ${res.status})`);
  }
}

export async function kickOffRestore(
  sourceFilename: string,
  caller: { adminUserId: string | null; sourceIp: string | null },
): Promise<RestoreKickoff> {
  const sourcePath = `${BACKUPS_DIR}/${sourceFilename}`;
  if (!existsSync(sourcePath)) {
    throw new Error(`source dump not found at ${sourcePath}`);
  }

  // 1. Integrity check pre-flag (I-INTEGRITY-AT-RESTORE).
  integrityCheck(sourcePath);

  // 2. Pre-snapshot filename — we predetermine it so the sentinel is complete.
  const preSnapshotFilename = `pre-restore-${new Date().toISOString().replace(/[-:.]/g, '').replace(/T/, 'T').slice(0, 15)}Z.sql.gz`;
  const restoreId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // 3. Maintenance flag, durable.
  fsyncWrite(FLAG_PATH, `restore ${sourceFilename} ${new Date().toISOString()}\n`);

  // 4. Best-effort historical anchor in backup_runs (may be wiped by restore).
  await db.query(
    `INSERT INTO backup_runs (trigger, event_kind, status, file_path,
                              admin_user_id, source_ip, started_at)
     VALUES ('restore', 'restore_init', 'running', $1, $2, $3, now())`,
    [sourcePath, caller.adminUserId, caller.sourceIp],
  );

  // 5. Durable sentinel — SOURCE OF TRUTH for /api/maintenance/status.
  fsyncWrite(
    SENTINEL_PATH,
    JSON.stringify({
      restore_id: restoreId,
      status: 'running',
      started_at: new Date().toISOString(),
      source_filename: sourceFilename,
      pre_snapshot_filename: preSnapshotFilename,
      admin_user_id: caller.adminUserId,
    }),
  );

  // 6. Detach the actual work. Skipped in NODE_ENV=test (kickoff contract
  //    is tested via inject; the shell flow is exercised by tests/dr/).
  if (process.env.NODE_ENV !== 'test') {
    spawn(
      'bash',
      [`${SCRIPTS_DIR}/run-restore.sh`, sourcePath, restoreId, preSnapshotFilename],
      { detached: true, stdio: 'ignore' },
    ).unref();
  }

  return { restore_id: restoreId, source_file: sourceFilename };
}
```

- [ ] **Step 4: Implement `api/src/routes/maintenance.ts`**

```typescript
// api/src/routes/maintenance.ts
//
// W5 — admin escape hatch for the maintenance-mode flow. These routes are
// bypassed by the maintenance middleware (see middleware/maintenance.ts).
//
// All endpoints are admin-key OR CF-Access gated EXCEPT restore-pre-snapshot
// which (per C-RESTORE-AUTH-CFACCESS) requires CF Access JWT only.
//
// Status reads from /config/restore-state.json (sentinel) per C-AUDIT-SENTINEL:
// the DB backup_runs table is wiped+restored mid-operation, so the in-flight
// state cannot live there.
import type { FastifyInstance } from 'fastify';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { db } from '../db/client.js';
import { requireAdminKeyOrCfAccess } from '../middleware/cfAccess.js';

const FLAG_PATH = process.env.MAINTENANCE_FLAG_PATH ?? '/config/maintenance.flag';
const SENTINEL_PATH = process.env.RESTORE_STATE_PATH ?? '/config/restore-state.json';

interface RestoreSentinel {
  restore_id: string;
  status: 'running' | 'ok' | 'failed';
  started_at: string;
  finished_at?: string;
  source_filename: string;
  pre_snapshot_filename: string;
  error_message?: string;
  admin_user_id?: string | null;
}

function readSentinel(): RestoreSentinel | null {
  if (!existsSync(SENTINEL_PATH)) return null;
  try { return JSON.parse(readFileSync(SENTINEL_PATH, 'utf8')); }
  catch { return null; }
}

export async function maintenanceRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/maintenance/status',
    { preHandler: requireAdminKeyOrCfAccess() },
    async (_req, reply) => {
      const active = existsSync(FLAG_PATH);
      const sentinel = readSentinel();
      const restore = sentinel
        ? {
            status: sentinel.status,
            file_path: sentinel.source_filename,
            error_message: sentinel.error_message ?? null,
            started_at: sentinel.started_at,
            finished_at: sentinel.finished_at ?? null,
          }
        : null;

      // recovery_available = there's a pre_restore snapshot we can roll back to.
      // Reads from backup_runs because pre_restore rows are created by the
      // pre-restore-snapshot.sh script BEFORE pg_restore, so they survive
      // the restore window iff captured pre-DROP.
      const { rows: preRows } = await db.query(
        `SELECT id, file_path FROM backup_runs
         WHERE trigger='pre_restore' AND event_kind='create' AND status='ok'
         ORDER BY started_at DESC LIMIT 1`,
      );
      const recovery_available = preRows.length > 0;

      return reply.send({ active, restore, recovery_available });
    },
  );

  app.post(
    '/maintenance/clear',
    { preHandler: requireAdminKeyOrCfAccess() },
    async (req, reply) => {
      // Append restore_complete row to backup_runs (C-AUDIT-SENTINEL —
      // this is the post-clear historical audit; populated from the sentinel).
      const sentinel = readSentinel();
      if (sentinel) {
        await db.query(
          `INSERT INTO backup_runs (trigger, event_kind, status, file_path,
                                    error_message, admin_user_id, started_at, finished_at)
           VALUES ('restore', 'restore_complete', $1, $2, $3, $4, $5, now())`,
          [
            sentinel.status === 'ok' ? 'ok' : 'failed',
            sentinel.source_filename,
            sentinel.error_message ?? null,
            (req as any).userId ?? sentinel.admin_user_id ?? null,
            sentinel.started_at,
          ],
        );
        if (existsSync(SENTINEL_PATH)) unlinkSync(SENTINEL_PATH);
      }
      if (existsSync(FLAG_PATH)) unlinkSync(FLAG_PATH);
      return reply.code(204).send();
    },
  );

  app.post(
    '/maintenance/restore-pre-snapshot',
    // C-RESTORE-AUTH-CFACCESS — restore endpoints REQUIRE CF Access JWT
    // (reject X-Admin-Key path). The bearer escape hatch is not enough for
    // a destructive admin op.
    { preHandler: requireAdminKeyOrCfAccess({ requireFreshCfAccess: true }) },
    async (req, reply) => {
      const { rows } = await db.query(
        `SELECT file_path FROM backup_runs
         WHERE trigger='pre_restore' AND event_kind='create' AND status='ok'
         ORDER BY started_at DESC LIMIT 1`,
      );
      if (rows.length === 0) {
        return reply.code(409).send({ error: 'no_pre_restore_snapshot' });
      }
      const sourcePath = rows[0].file_path;
      const { kickOffRestore } = await import('../services/restoreRunner.js');
      const filename = sourcePath.split('/').pop()!;
      const result = await kickOffRestore(filename, {
        adminUserId: (req as any).userId ?? null,
        sourceIp: (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.ip ?? null,
      });
      return reply.code(202).send({ restore_id: result.restore_id, source: filename });
    },
  );
}
```

- [ ] **Step 5: Add `POST /backups/:id/restore` to `backups.ts`**

```typescript
import { RestoreRequestSchema } from '../schemas/backups.js';
import { kickOffRestore } from '../services/restoreRunner.js';

// inside backupRoutes:
app.post(
  '/backups/:id/restore',
  // C-RESTORE-AUTH-CFACCESS — destructive admin op REQUIRES CF Access JWT,
  // rejects the X-Admin-Key path. The bearer escape hatch is not enough.
  { preHandler: requireAdminKeyOrCfAccess({ requireFreshCfAccess: true }) },
  async (req, reply) => {
    const parsedBody = RestoreRequestSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return reply.code(400).send({ error: 'invalid_confirm', message: 'body must be {confirm:"RESTORE"}' });
    }
    const { id } = req.params as { id: string };
    const filePath = safeBackupPath(id);
    if (!filePath || !existsSync(filePath)) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const result = await kickOffRestore(id, {
      adminUserId: (req as any).userId ?? null,
      sourceIp: (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.ip ?? null,
    });
    return reply.code(202).send({ restore_id: result.restore_id, source: id });
  },
);
```

- [ ] **Step 6: Register `maintenanceRoutes` in `app.ts`** (BEFORE other route plugins so it's reachable when the flag is set):

```typescript
import { maintenanceRoutes } from './routes/maintenance.js';
// after registerMaintenanceGate(app):
await app.register(maintenanceRoutes, { prefix: '/api' });
```

- [ ] **Step 7: Create `scripts/run-restore.sh`** (the detached child script):

```bash
#!/usr/bin/env bash
# W5 — long-running restore. Invoked detached by restoreRunner.ts.
#
# Args:
#   $1 — source dump path (absolute)
#   $2 — restore_id (sentinel id, matches /config/restore-state.json::restore_id)
#   $3 — pre-snapshot filename (predetermined by restoreRunner.ts)
#
# Implements C-RESTORE-ORDERING + C-DEVICE-TOKENS-RESTORE + I-SEQUENCE-RESET +
# I-RESTORE-CHILD-PRIVS + I-SIGTERM-DRAIN-PRESERVES-BACKUP.
#
# Flow (atomic order):
#   1. Source-path defense-in-depth: reject anything not literally
#      ${BACKUPS_DIR}/repos-*.dump.gz or ${BACKUPS_DIR}/pre-restore-*.sql.gz.
#   2. SIGTERM the API (s6-rc -d change api) and WAIT for it to fully exit.
#      This is the critical reorder — the API must release its pg pool
#      BEFORE pg_restore opens DROP on tables the pool has prepared
#      statements against.
#   3. Run scripts/pre-restore-snapshot.sh — the rollback point. Writes the
#      pre_restore backup_runs row (event_kind='create', trigger='pre_restore').
#   4. pg_restore --clean --if-exists --no-owner --no-privileges → DB.
#      Runs as DB superuser (per the container's DATABASE_URL); the
#      safeBackupPath() check in $SRC was already enforced by the API,
#      but step 1 re-validates as defense-in-depth.
#   5. Run migrations (in case the snapshot pre-dated migrations).
#   6. C-DEVICE-TOKENS-RESTORE — wipe device_tokens to close the
#      restore-replay attack vector (a malicious dump containing
#      attacker-known device_tokens rows with scopes='*' would otherwise
#      grant bearer access on first boot).
#   7. I-SEQUENCE-RESET — fix the backup_runs id sequence after pg_restore
#      (pg_dump doesn't restore sequences to match max(id), so the next
#      INSERT could collide).
#   8. Write restore-state.json status='ok' (or 'failed' on any prior step
#      non-zero exit), with fsync. /api/maintenance/status reads this.
#   9. s6-rc -u change api — boot the API back up. New API sees the flag,
#      stays in maintenance until admin clears.
set -uo pipefail

SRC="$1"
RESTORE_ID="$2"
PRE_SNAPSHOT_FILENAME="${3:-}"

BACKUPS_DIR="${BACKUPS_DIR:-/config/backups}"
SCRIPTS_DIR="${REPOS_SCRIPTS_DIR:-/app/scripts}"
API_DIR="${REPOS_API_DIR:-/app/api}"
SENTINEL_PATH="${RESTORE_STATE_PATH:-/config/restore-state.json}"

# I-RESTORE-CHILD-PRIVS — defense-in-depth source-path validation.
case "$SRC" in
  "${BACKUPS_DIR}"/repos-*.dump.gz) ;;
  "${BACKUPS_DIR}"/pre-restore-*.sql.gz) ;;
  *)
    echo "FATAL: source path ${SRC} outside allow-list" >&2
    exit 99
    ;;
esac

mark_failed() {
  local msg="$1"
  local escaped
  escaped=$(printf '%s' "$msg" | python3 -c 'import json,sys; sys.stdout.write(json.dumps(sys.stdin.read()))')
  # Read current sentinel, merge status+error_message+finished_at, write atomically with fsync.
  python3 - <<PY
import json, os
path = "${SENTINEL_PATH}"
if os.path.exists(path):
    with open(path) as fh:
        state = json.load(fh)
else:
    state = {"restore_id": "${RESTORE_ID}"}
state["status"] = "failed"
state["error_message"] = ${escaped}
import datetime
state["finished_at"] = datetime.datetime.utcnow().isoformat() + "Z"
tmp = path + ".tmp"
with open(tmp, "w") as fh:
    json.dump(state, fh)
    fh.flush()
    os.fsync(fh.fileno())
os.replace(tmp, path)
PY
  sync
  # Bring the API back up so the admin can click Roll back.
  if command -v s6-rc >/dev/null 2>&1; then
    s6-rc -u change api || true
  fi
  exit 1
}

# 2. C-RESTORE-ORDERING — SIGTERM the API FIRST and wait for it to exit.
if command -v s6-rc >/dev/null 2>&1; then
  s6-rc -d change api || true
  # Wait up to 35s for the API to fully exit (SHUTDOWN_TIMEOUT_MS=30s + buffer).
  for i in $(seq 1 35); do
    if ! s6-rc -a list | grep -q '^api$'; then break; fi
    sleep 1
  done
fi

# 3. Pre-restore snapshot (the rollback path). pre-restore-snapshot.sh
#    inserts its own backup_runs row trigger='pre_restore'.
if ! BACKUPS_DIR="${BACKUPS_DIR}" PRE_SNAPSHOT_FILENAME="${PRE_SNAPSHOT_FILENAME}" \
     "${SCRIPTS_DIR}/pre-restore-snapshot.sh"; then
  mark_failed 'pre-restore snapshot failed'
fi

# 4. pg_restore. --clean --if-exists drops existing objects; --no-owner
#    avoids re-asserting the postgres role; --no-privileges skips GRANTs.
if ! gunzip -c "${SRC}" | pg_restore --clean --if-exists --no-owner --no-privileges -d "${DATABASE_URL}"; then
  mark_failed 'pg_restore non-zero exit'
fi

# 5. Run migrations forward (in case the snapshot pre-dated migrations).
if ! (cd "${API_DIR}" && node dist/db/migrate.js); then
  mark_failed 'migrations failed after restore'
fi

# 6. C-DEVICE-TOKENS-RESTORE — wipe device_tokens, close restore-replay vector.
psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 <<SQL
UPDATE device_tokens
SET revoked_at = now(),
    revoke_reason = 'restore_replayed'
WHERE revoked_at IS NULL;
SQL

# 7. I-SEQUENCE-RESET — bump backup_runs_id_seq past max(id) so the
#    post-clear restore_complete INSERT doesn't collide.
psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 <<SQL
SELECT setval('backup_runs_id_seq', COALESCE((SELECT max(id) FROM backup_runs), 1));
SQL

# 8. Mark sentinel ok with fsync.
python3 - <<PY
import json, os, datetime
path = "${SENTINEL_PATH}"
with open(path) as fh:
    state = json.load(fh)
state["status"] = "ok"
state["finished_at"] = datetime.datetime.utcnow().isoformat() + "Z"
tmp = path + ".tmp"
with open(tmp, "w") as fh:
    json.dump(state, fh)
    fh.flush()
    os.fsync(fh.fileno())
os.replace(tmp, path)
PY
sync

# 9. Boot the API back up. New API sees /config/maintenance.flag, stays
#    in maintenance mode until admin clears via POST /api/maintenance/clear.
if command -v s6-rc >/dev/null 2>&1; then
  s6-rc -u change api || true
fi

exit 0
```

Mark executable: `chmod +x scripts/run-restore.sh`.

- [ ] **Step 8: Run tests to verify they pass**

```bash
npx vitest run tests/integration/maintenance-routes.test.ts
```

Expected: 7/7 PASS (5 maintenance + 2 restore-kickoff).

- [ ] **Step 9: Commit**

```bash
git add api/src/routes/maintenance.ts api/src/services/restoreRunner.ts \
        api/src/routes/backups.ts api/src/app.ts \
        scripts/run-restore.sh \
        api/tests/integration/maintenance-routes.test.ts
git commit -m "feat: add /api/maintenance/* + restore kickoff (W5 P4)"
```

---

## Phase 5 — SIGTERM drain

### Task 7: SIGTERM-drain handler on the API process

**Files:**
- Modify: `api/src/index.ts` — wire SIGTERM → app.close() with 30s timeout
- Modify: `api/src/db/client.ts` — expose graceful pool drain
- Test: `api/tests/integration/sigterm-drain.test.ts` (G5 acceptance test #3)

**Spec (master plan §363):** issue 10 concurrent `POST /api/set-logs` requests, send SIGTERM mid-flight, assert all 10 either complete or fail with retriable error (503 / connection-closed), assert no partial writes (no rows with NULL required fields). The idempotency key + (user_id, client_request_id) unique index makes any retried set safe.

- [ ] **Step 1: Write the failing SIGTERM-drain test**

```typescript
// api/tests/integration/sigterm-drain.test.ts
//
// G5 acceptance #3 — SIGTERM drain.
//
// Boots a real Fastify app (NOT inject), fires 10 concurrent set-log POSTs,
// sends SIGTERM mid-flight, and asserts:
//   - every response is either 2xx OR retriable (503 / ECONNRESET)
//   - zero rows landed in set_logs with NULL required fields
//   - the process exited 0 (clean drain, not forced kill)
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/client.js';
import { mkUserWithProgram } from '../helpers/program-fixtures.js';

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let userId: string;
let token: string;
let plannedSetId: string;
let port: number;

beforeAll(async () => {
  app = await buildApp();
  port = 3500 + Math.floor(Math.random() * 100);
  await app.listen({ port, host: '127.0.0.1' });
  const u = await mkUserWithProgram();
  userId = u.userId;
  token = u.token;
  plannedSetId = u.firstPlannedSetId;
});
afterAll(async () => {
  await app.close();
});

describe('SIGTERM drain', () => {
  it('drains in-flight set-log POSTs without partial writes', async () => {
    const responses = await Promise.all(
      Array.from({ length: 10 }, async (_, i) => {
        try {
          const res = await fetch(`http://127.0.0.1:${port}/api/set-logs`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
            body: JSON.stringify({
              planned_set_id: plannedSetId,
              client_request_id: `sigterm-test-${i}`,
              performed_load_lbs: 100 + i,
              performed_reps: 8,
              performed_rir: 2,
            }),
          });
          return { ok: res.ok, status: res.status, retriable: res.status >= 500 };
        } catch (err) {
          return { ok: false, status: 0, retriable: true };
        }
      }),
    );

    // Every response is 2xx OR retriable. No 4xx (those indicate
    // partial-write attempts that violated invariants).
    for (const r of responses) {
      expect(r.ok || r.retriable).toBe(true);
    }

    // No rows in set_logs with NULL required fields.
    const { rows } = await db.query(
      `SELECT count(*)::int AS c FROM set_logs
       WHERE planned_set_id = $1
         AND (performed_load_lbs IS NULL OR performed_reps IS NULL)`,
      [plannedSetId],
    );
    expect(rows[0].c).toBe(0);
  });
});
```

(The test as written here does not actually send SIGTERM — full SIGTERM cycle requires spawning a child process. See Step 3 for the spawn-based version. If the spawn-based version is brittle in CI, the inject-based fallback in Step 4 uses `app.close()` mid-flight to assert the same drain semantics.)

- [ ] **Step 2: Implement SIGTERM drain in `api/src/index.ts`**

```typescript
import 'dotenv/config';
import { validateStartupEnv } from './bootstrap-guards.js';
import { validatePlaceholderPurge, validateMaintenanceFlag } from './bootstrap-runtime.js';
import { buildApp } from './app.js';
import { db } from './db/client.js';

const guards = validateStartupEnv(process.env);
for (const msg of guards.fatal) console.error(`FATAL: ${msg}`);
if (guards.fatal.length > 0) process.exit(1);
for (const entry of guards.info) console.log(`[startup] ${JSON.stringify(entry)}`);

await validatePlaceholderPurge(process.env);
await validateMaintenanceFlag(process.env);

const app = await buildApp({ logger: true });
const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '127.0.0.1';
await app.listen({ port, host });

// W5 — graceful drain on SIGTERM. Fastify's close() stops accepting new
// connections, waits for in-flight requests up to the keep-alive timeout,
// then resolves. Then we close the pg pool so its connections terminate
// cleanly rather than being yanked.
//
// I-POOL-DRAIN-DOC — SHUTDOWN_TIMEOUT_MS defaults to 30s derived from
// statement_timeout=5s × 6 retries (the maximum surface a long-running
// chained query could occupy) plus a small safety margin. Reduce only
// if statement_timeout is lowered in the DB config.
//
// I-SIGTERM-DRAIN-PRESERVES-BACKUP — if a manual backup is in flight when
// SIGTERM lands, the backupRunner's INSERT...status='running' row is on
// disk; the boot reaper (Task 2 Step 5) marks it failed on next boot.
// The .partial file (if pg_dump was streaming) is left in /config/backups;
// a follow-up cleanup pass removes any .partial older than 1 hour.
let shuttingDown = false;
async function gracefulShutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'graceful shutdown begin');
  const timeoutMs = Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 30_000);
  const timeout = setTimeout(() => {
    app.log.error({ timeoutMs }, 'shutdown timed out — forcing exit 1');
    process.exit(1);
  }, timeoutMs);
  timeout.unref();
  try {
    await app.close();
    await db.end();
    app.log.info('graceful shutdown done');
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, 'shutdown error');
    process.exit(1);
  }
}
process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
```

- [ ] **Step 3: Run test** (note: this test requires a real DB + materialized program — if mkUserWithProgram doesn't exist, factor it from `program-fixtures.ts`):

```bash
npx vitest run tests/integration/sigterm-drain.test.ts
```

- [ ] **Step 4: If the spawn-based variant is too heavy, fall back to the inject-based proof:**

The contract being tested is: "Fastify's `close()` is called while requests are in flight; all in-flight requests either complete OR receive a 503 (no half-written rows)." Replace the fetch-based test with:

```typescript
// Use inject + race app.close() against the request burst.
const inFlight = Promise.all(
  Array.from({ length: 10 }, (_, i) =>
    app.inject({
      method: 'POST',
      url: '/api/set-logs',
      headers: { authorization: `Bearer ${token}` },
      payload: { planned_set_id: plannedSetId, client_request_id: `drain-${i}`, performed_load_lbs: 100 + i, performed_reps: 8, performed_rir: 2 },
    }),
  ),
);
// Race app.close() — Fastify waits for in-flight to settle.
setTimeout(() => app.close(), 10);
const results = await inFlight;
// All results 2xx OR 503; never 4xx-with-NULL-state.
```

- [ ] **Step 5: Commit**

```bash
git add api/src/index.ts api/tests/integration/sigterm-drain.test.ts
git commit -m "feat: graceful SIGTERM drain (W5 P5, G5 case 3)"
```

---

## Phase 6 — G5 acceptance tests (the 4 explicit cases)

These tests **are** the G5 DoD. Each one is a discrete file + commit.

### Task 8: G5 Case 1 — Restore happy path

**File:** `api/tests/integration/restore.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// api/tests/integration/restore.test.ts
//
// G5 acceptance #1 — restore happy path.
//
// Flow:
//   1. Seed dataset (user + program + set_logs).
//   2. pg_dump → file.
//   3. Mutate DB (insert new set_log).
//   4. POST /api/backups/:id/restore { confirm: 'RESTORE' }.
//   5. Wait for maintenance flag → present, then absent.
//   6. Assert DB state matches dump (the mutated set_log is gone).
//
// Uses the existing local repos_test DB (per programModel.smoke.test.ts —
// Docker not available; testcontainers-node is master-plan aspirational).
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/client.js';
import { mkUser, cleanupUser } from '../helpers/program-fixtures.js';

type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;
let backupsDir: string;
let flagPath: string;

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), 'repos-restore-'));
  backupsDir = join(root, 'backups');
  require('node:fs').mkdirSync(backupsDir, { recursive: true });
  flagPath = join(root, 'maintenance.flag');
  process.env.BACKUPS_DIR = backupsDir;
  process.env.MAINTENANCE_FLAG_PATH = flagPath;
  process.env.REPOS_SCRIPTS_DIR = `${process.cwd()}/../scripts`;
  delete process.env.ADMIN_API_KEY;
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
  rmSync(backupsDir, { recursive: true, force: true });
  if (existsSync(flagPath)) rmSync(flagPath);
});

describe('G5 case 1 — restore happy path', () => {
  it('restores a dump and the post-dump mutation is reverted', async () => {
    // 1. Seed: user + materialized program + one set_log.
    //    mkUserWithProgram returns { userId, token, firstPlannedSetId, firstExerciseId }.
    //    Adapt from helpers/program-fixtures.ts (the existing mkUser helper
    //    + materializeMesocycle path used by programModel.smoke.test.ts:60–80).
    const u = await mkUserWithProgram({ prefix: 'restore-happy' });
    // Pattern matches programModel.smoke.test.ts:252 — these are the 7 NOT NULL columns.
    await db.query(
      `INSERT INTO set_logs
        (planned_set_id, user_id, exercise_id, client_request_id, performed_reps, performed_load_lbs, performed_rir)
       VALUES ($1, $2, $3, $4, 8, 100.0, 2)`,
      [u.firstPlannedSetId, u.userId, u.firstExerciseId, crypto.randomUUID()],
    );
    const beforeCount = (
      await db.query(`SELECT count(*)::int AS c FROM set_logs WHERE user_id=$1`, [u.userId])
    ).rows[0].c;

    // 2. Take a backup via API (this is also the contract test).
    const r1 = await app.inject({ method: 'POST', url: '/api/backups' });
    expect(r1.statusCode).toBe(201);
    const backupId = r1.json().id;

    // 3. Mutate: insert one more set_log (same shape, different client_request_id).
    await db.query(
      `INSERT INTO set_logs
        (planned_set_id, user_id, exercise_id, client_request_id, performed_reps, performed_load_lbs, performed_rir)
       VALUES ($1, $2, $3, $4, 9, 105.0, 1)`,
      [u.firstPlannedSetId, u.userId, u.firstExerciseId, crypto.randomUUID()],
    );
    const afterMutateCount = (
      await db.query(`SELECT count(*)::int AS c FROM set_logs WHERE user_id=$1`, [u.userId])
    ).rows[0].c;
    expect(afterMutateCount).toBe(beforeCount + 1);

    // 4. Run the restore directly (kickoff path is mocked in NODE_ENV='test';
    //    full shell flow is exercised by tests/dr/restore-into-ephemeral.sh).
    const dumpPath = join(backupsDir, backupId);
    execSync(
      `gunzip -c "${dumpPath}" | pg_restore --clean --if-exists --no-owner --no-privileges -d "${process.env.DATABASE_URL}"`,
      { stdio: 'pipe' },
    );

    // 5. Assert DB matches dump — the post-dump mutation is gone.
    const restoredCount = (
      await db.query(`SELECT count(*)::int AS c FROM set_logs WHERE user_id=$1`, [u.userId])
    ).rows[0].c;
    expect(restoredCount).toBe(beforeCount);

    await cleanupUser(u.userId);
  });
});
```

**Note for implementer:** `mkUserWithProgram` is referenced but may not yet exist in `program-fixtures.ts`. The function should compose: `mkUser({prefix})` → start a real user-program by inserting into `user_programs` + invoking `materializeMesocycle` (or call `POST /api/user-programs/:id/start` via inject). Return `{userId, token, firstPlannedSetId, firstExerciseId}` — `firstPlannedSetId` from `SELECT id FROM planned_sets WHERE user_program_id=... ORDER BY block_idx, set_idx LIMIT 1`; `firstExerciseId` from joining through `planned_sets.exercise_id`. Pattern matches `programModel.smoke.test.ts:60–80`. If extracting the helper feels out-of-scope, inline the materialization in the test itself.

- [ ] **Step 2-3: Run + commit.**

```bash
npx vitest run tests/integration/restore.test.ts
git add api/tests/integration/restore.test.ts
git commit -m "test: G5 case 1 — restore happy path (W5)"
```

### Task 9: G5 Case 2 — Crash-mid-restore recovery

**File:** `api/tests/integration/restore-crash-recovery.test.ts`

- [ ] **Step 1: Write the test (per master plan §362):**

```typescript
// api/tests/integration/restore-crash-recovery.test.ts
//
// G5 acceptance #2 — API crash mid-restore.
//
// Setup: simulate "API died during pg_restore" by leaving the maintenance
// flag in place + audit row stuck at status='running' + DB in a partially-
// restored state.
//
// On the API's next boot (re-built via buildApp here, simulating restart):
//   - bootstrap-runtime.ts::validateMaintenanceFlag detects the flag.
//   - The middleware short-circuits all /api/* to 503 except /api/maintenance/*.
//   - Admin can call POST /api/maintenance/clear (after manual verification)
//     to resume traffic.
//
// This test does NOT actually crash the runner — it asserts the *recovery*
// contract: "if the flag is present at boot, the API must boot into
// maintenance mode."
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, unlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/client.js';

type App = Awaited<ReturnType<typeof buildApp>>;
let flagPath: string;

beforeAll(() => {
  flagPath = join(mkdtempSync(join(tmpdir(), 'repos-crash-')), 'maintenance.flag');
  process.env.MAINTENANCE_FLAG_PATH = flagPath;
});
afterAll(() => {
  if (existsSync(flagPath)) unlinkSync(flagPath);
});

describe('G5 case 2 — crash-mid-restore recovery', () => {
  it('on next boot, API serves only /api/maintenance/* and /health', async () => {
    // Simulate crash: flag was written, sentinel says status='running' but
    // started_at is >5 min ago (so the C-STALE-LOCK reaper flips it to failed).
    writeFileSync(flagPath, 'restore-crash', 'utf8');
    const sentinelPath = `${require('node:path').dirname(flagPath)}/restore-state.json`;
    process.env.RESTORE_STATE_PATH = sentinelPath;
    writeFileSync(
      sentinelPath,
      JSON.stringify({
        restore_id: 'crashed-1',
        status: 'running',
        started_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        source_filename: 'repos-x.dump.gz',
        pre_snapshot_filename: 'pre-restore-x.sql.gz',
      }),
    );

    // Boot a fresh app — simulates the s6 restart after the crash.
    // The boot reaper (Task 2 Step 5) detects the stale sentinel and flips
    // its status to 'failed' so the FE surfaces Roll-back affordance.
    const app: App = await buildApp();

    const r1 = await app.inject({ method: 'GET', url: '/api/muscles' });
    expect(r1.statusCode).toBe(503);
    expect(r1.headers['retry-after']).toBe('60');

    const r2 = await app.inject({ method: 'GET', url: '/api/maintenance/status' });
    expect(r2.statusCode).not.toBe(503);
    const status = r2.json();
    expect(status.active).toBe(true);
    // C-STALE-LOCK — the boot reaper marked the stale sentinel failed.
    expect(status.restore.status).toBe('failed');
    expect(status.restore.error_message).toMatch(/stale/i);

    const r3 = await app.inject({ method: 'GET', url: '/health' });
    expect(r3.statusCode).toBe(200);

    // /health/user-facing 503s (I-HEALTH-MAINTENANCE).
    const rhuf = await app.inject({ method: 'GET', url: '/health/user-facing' });
    expect(rhuf.statusCode).toBe(503);

    // Admin clears the flag (after manually verifying DB state).
    const r4 = await app.inject({ method: 'POST', url: '/api/maintenance/clear' });
    expect(r4.statusCode).toBe(204);

    // Clear appends a restore_complete row to backup_runs.
    const { rows: completeRows } = await db.query(
      `SELECT count(*)::int AS c FROM backup_runs WHERE event_kind='restore_complete'`,
    );
    expect(completeRows[0].c).toBeGreaterThanOrEqual(1);

    // Now /api/* serves traffic again.
    const r5 = await app.inject({ method: 'GET', url: '/api/muscles' });
    expect(r5.statusCode).not.toBe(503);

    await app.close();
  });
});
```

- [ ] **Step 2-3: Run + commit.**

```bash
npx vitest run tests/integration/restore-crash-recovery.test.ts
git add api/tests/integration/restore-crash-recovery.test.ts
git commit -m "test: G5 case 2 — crash-mid-restore recovery (W5)"
```

### Task 10: G5 Case 3 — SIGTERM drain

Already covered by Task 7 (`sigterm-drain.test.ts`). Verify it's wired into the test suite + green.

```bash
npx vitest run tests/integration/sigterm-drain.test.ts
```

### Task 11: G5 Case 4 — Migration-failure rollback

**File:** `api/tests/integration/restore-migration-failure.test.ts`

- [ ] **Step 1: Write the test (per master plan §364):**

```typescript
// api/tests/integration/restore-migration-failure.test.ts
//
// G5 acceptance #4 — migration failure mid-restore rolls back to pre-snapshot.
//
// Setup:
//   - Seed a pre_restore snapshot in backup_runs (status='ok').
//   - Insert a 'restore' audit row with status='failed', error_message
//     mentioning a fake migration error.
//   - Maintenance flag present.
//
// Assertions:
//   - GET /api/maintenance/status returns {active:true, restore:{status:'failed'},
//     recovery_available:true}.
//   - POST /api/maintenance/restore-pre-snapshot returns 202 + audit_id.
//   - A new backup_runs row appears with trigger='restore', status='running'
//     (the kicked-off recovery — full execution exercised by tests/dr/).
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/client.js';

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let backupsDir: string;
let flagPath: string;
let preSnapshotPath: string;

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), 'repos-mig-fail-'));
  backupsDir = join(root, 'backups');
  require('node:fs').mkdirSync(backupsDir, { recursive: true });
  flagPath = join(root, 'maintenance.flag');
  process.env.BACKUPS_DIR = backupsDir;
  process.env.MAINTENANCE_FLAG_PATH = flagPath;
  delete process.env.ADMIN_API_KEY;
  // pre-restore-* file format
  preSnapshotPath = join(backupsDir, 'pre-restore-20260525T120000Z.sql.gz');
  writeFileSync(preSnapshotPath, Buffer.from([0x1f, 0x8b]));  // gzip magic
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
  rmSync(backupsDir, { recursive: true, force: true });
  if (existsSync(flagPath)) unlinkSync(flagPath);
});

describe('G5 case 4 — migration failure rollback to pre-snapshot', () => {
  it('surfaces recovery affordance + kicks off pre-snapshot restore on demand', async () => {
    writeFileSync(flagPath, 'restore-failed', 'utf8');

    // The pre_restore snapshot the failed restore captured beforehand.
    await db.query(
      `INSERT INTO backup_runs (trigger, status, file_path, integrity_verified, started_at, finished_at)
       VALUES ('pre_restore', 'ok', $1, true, now() - interval '5 minutes', now() - interval '5 minutes')`,
      [preSnapshotPath],
    );
    // The restore that failed mid-migration.
    await db.query(
      `INSERT INTO backup_runs (trigger, status, file_path, error_message, started_at, finished_at)
       VALUES ('restore', 'failed', '/tmp/source.dump.gz', 'migrations failed after restore', now(), now())`,
    );

    // 1. Status surfaces the failure + recovery affordance.
    const status = await app.inject({ method: 'GET', url: '/api/maintenance/status' });
    expect(status.statusCode).toBe(200);
    const body = status.json();
    expect(body).toMatchObject({
      active: true,
      restore: { status: 'failed', error_message: 'migrations failed after restore' },
      recovery_available: true,
    });

    // 2. Recovery kickoff.
    const recover = await app.inject({ method: 'POST', url: '/api/maintenance/restore-pre-snapshot' });
    expect(recover.statusCode).toBe(202);
    expect(recover.json().source).toBe('pre-restore-20260525T120000Z.sql.gz');

    // 3. A new 'restore' audit row appears (kicked-off recovery).
    const { rows } = await db.query(
      `SELECT count(*)::int AS c FROM backup_runs WHERE trigger='restore' AND status='running'`,
    );
    expect(rows[0].c).toBeGreaterThanOrEqual(1);
  });

  it('returns 409 when no pre_restore snapshot exists', async () => {
    await db.query(`DELETE FROM backup_runs WHERE trigger='pre_restore'`);
    const res = await app.inject({ method: 'POST', url: '/api/maintenance/restore-pre-snapshot' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('no_pre_restore_snapshot');
  });

  // C-FORWARD-INCOMPAT-CHECK — extend the pg_restore -l preflight to also
  // extract the highest _migrations filename from the dump TOC. If the dump
  // schema rev > current code rev, REJECT the restore (the dump is from
  // a newer version of RepOS than the running code; data shape mismatch
  // is almost certain).
  it('rejects restore when dump schema rev > current code rev', async () => {
    // The integrityCheck (or kickOffRestore) should call a new helper
    // `assertSchemaRevCompatible(dumpPath, codeRev)` that reads the dump's
    // _migrations rows via `pg_restore -l --schema=public --table=_migrations`
    // (or restores into a temp DB) and compares the highest filename to
    // the highest filename in api/src/db/migrations/.
    //
    // Test: seed a stub dump whose TOC mentions migration 999_future.sql;
    // expect kickOffRestore (or its preflight wrapper) to throw 'dump
    // schema rev (999) > current code rev (NNN)'.
    //
    // Implementer note: the simplest expression is to ship a tiny
    // `scripts/assert-restorable.sh` that takes the dump path + current
    // max migration number and exits non-zero on incompatibility; call
    // it from kickOffRestore BEFORE writing the maintenance flag.
    const futureDump = join(backupsDir, 'repos-future.dump.gz');
    // Real implementation will exercise this via tests/dr/; the
    // integration-test variant stubs the schema check by env var.
    writeFileSync(futureDump, Buffer.from([0x1f, 0x8b]));
    await db.query(
      `INSERT INTO backup_runs (trigger, event_kind, status, file_path, integrity_verified, started_at, finished_at)
       VALUES ('manual', 'create', 'ok', $1, true, now(), now())`,
      [futureDump],
    );
    process.env.REPOS_TEST_FORCE_FUTURE_DUMP_REV = '999';
    const res = await app.inject({
      method: 'POST',
      url: `/api/backups/${require('node:path').basename(futureDump)}/restore`,
      payload: { confirm: 'RESTORE' },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('dump_schema_rev_too_new');
    delete process.env.REPOS_TEST_FORCE_FUTURE_DUMP_REV;
  });
});
```

- [ ] **Step 2-3: Run + commit.**

```bash
npx vitest run tests/integration/restore-migration-failure.test.ts
git add api/tests/integration/restore-migration-failure.test.ts
git commit -m "test: G5 case 4 — migration-failure rollback (W5)"
```

---

## Phase 7 — Frontend: `/settings/backups` desktop page + maintenance banner

### Task 12: SnapshotTable + verified-restorable badge

**Files:**
- Create: `frontend/src/lib/api/backups.ts` — typed client
- Create: `frontend/src/components/settings/SnapshotTable.tsx`
- Test: `frontend/src/components/settings/SnapshotTable.test.tsx`

- [ ] **Step 1: Write the failing component test**

```typescript
// frontend/src/components/settings/SnapshotTable.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SnapshotTable } from './SnapshotTable';
import * as api from '../../lib/api/backups';

vi.mock('../../lib/api/backups');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SnapshotTable', () => {
  it('renders the list with verified-restorable badges', async () => {
    (api.listBackups as any).mockResolvedValue({
      items: [
        { id: 'repos-A.dump.gz', trigger: 'manual', size_bytes: 1024, verified_restorable: 'good', created_at: '2026-05-25T10:00:00Z' },
        { id: 'repos-B.dump.gz', trigger: 'auto', size_bytes: 2048, verified_restorable: 'warn', created_at: '2026-05-24T03:00:00Z' },
        { id: 'repos-C.dump.gz', trigger: 'auto', size_bytes: 512, verified_restorable: 'danger', created_at: '2026-05-23T03:00:00Z' },
      ],
    });
    render(<SnapshotTable />);
    await waitFor(() => screen.getByText('repos-A.dump.gz'));
    expect(screen.getByText('repos-A.dump.gz')).toBeInTheDocument();
    expect(screen.getByLabelText('Verified restorable')).toBeInTheDocument();  // good badge a11y label
    expect(screen.getByLabelText('Snapshot file missing on disk')).toBeInTheDocument();  // warn
    expect(screen.getByLabelText('Integrity check failed — not safe to restore')).toBeInTheDocument();  // danger
  });

  it('disables Restore button when badge is danger', async () => {
    (api.listBackups as any).mockResolvedValue({
      items: [
        { id: 'repos-C.dump.gz', trigger: 'auto', size_bytes: 512, verified_restorable: 'danger', created_at: '2026-05-23T03:00:00Z' },
      ],
    });
    render(<SnapshotTable />);
    await waitFor(() => screen.getByText('repos-C.dump.gz'));
    const restoreBtn = screen.getByRole('button', { name: /restore/i });
    expect(restoreBtn).toBeDisabled();
  });
});
```

- [ ] **Step 2: Write `frontend/src/lib/api/backups.ts`**

```typescript
// frontend/src/lib/api/backups.ts
//
// W5 — typed client for /api/backups/*. Mirrors api/src/schemas/backups.ts.
export interface BackupItem {
  id: string;
  trigger: 'manual' | 'auto' | 'pre_restore' | 'restore';
  size_bytes: number;
  verified_restorable: 'good' | 'warn' | 'danger';
  created_at: string;
}
export interface BackupListResponse { items: BackupItem[]; }
export interface MaintenanceStatus {
  active: boolean;
  restore: { status: 'running' | 'ok' | 'failed'; error_message?: string | null; file_path?: string } | null;
  recovery_available: boolean;
}

export async function listBackups(): Promise<BackupListResponse> {
  const res = await fetch('/api/backups', { credentials: 'include' });
  if (!res.ok) throw new Error(`listBackups ${res.status}`);
  return res.json();
}
export async function createBackup(): Promise<BackupItem> {
  const res = await fetch('/api/backups', { method: 'POST', credentials: 'include' });
  if (!res.ok) throw new Error(`createBackup ${res.status}`);
  return res.json();
}
export async function deleteBackup(id: string): Promise<void> {
  const res = await fetch(`/api/backups/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include' });
  if (!res.ok && res.status !== 204) throw new Error(`deleteBackup ${res.status}`);
}
export async function restoreBackup(id: string): Promise<void> {
  const res = await fetch(`/api/backups/${encodeURIComponent(id)}/restore`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ confirm: 'RESTORE' }),
  });
  if (!res.ok && res.status !== 202) throw new Error(`restoreBackup ${res.status}`);
}
export async function getMaintenanceStatus(): Promise<MaintenanceStatus> {
  const res = await fetch('/api/maintenance/status', { credentials: 'include' });
  if (!res.ok) throw new Error(`getMaintenanceStatus ${res.status}`);
  return res.json();
}
export async function restorePreSnapshot(): Promise<void> {
  const res = await fetch('/api/maintenance/restore-pre-snapshot', { method: 'POST', credentials: 'include' });
  if (!res.ok && res.status !== 202) throw new Error(`restorePreSnapshot ${res.status}`);
}
```

- [ ] **Step 3: Write `SnapshotTable.tsx`**

```typescript
// frontend/src/components/settings/SnapshotTable.tsx
//
// W5 — Backups list. Desktop-primary surface (per project memory
// project_device_split.md). Mobile renders a read-only list — no
// Backup Now / Restore / Delete affordances.
//
// [ABS-2] Verified-restorable badge tiers good/warn/danger; Restore
// disabled when badge=danger.
import { useEffect, useState } from 'react';
import { TOKENS, FONTS } from '../../tokens';
import { listBackups, deleteBackup, restoreBackup, type BackupItem } from '../../lib/api/backups';
import { useIsMobile } from '../../lib/useIsMobile';

function Badge({ tier }: { tier: BackupItem['verified_restorable'] }) {
  // tokens.ts ships `good` / `warn` / `danger` as the canonical status colors
  // (see frontend/src/tokens.ts:17–19). No *Glow variants for these — derive
  // the translucent fill inline.
  const palette = {
    good:   { bg: 'rgba(107,226,139,0.15)', fg: TOKENS.good,   label: 'Verified restorable' },
    warn:   { bg: 'rgba(245,181,68,0.15)',  fg: TOKENS.warn,   label: 'Snapshot file missing on disk' },
    danger: { bg: 'rgba(255,106,106,0.15)', fg: TOKENS.danger, label: 'Integrity check failed — not safe to restore' },
  }[tier];
  return (
    <span
      aria-label={palette.label}
      title={palette.label}
      style={{
        display: 'inline-block', padding: '2px 8px', borderRadius: 4,
        background: palette.bg, color: palette.fg,
        fontFamily: FONTS.mono, fontSize: 10, letterSpacing: 1,
      }}>{tier.toUpperCase()}</span>
  );
}

export function SnapshotTable(): JSX.Element {
  const [items, setItems] = useState<BackupItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    listBackups()
      .then((r) => setItems(r.items))
      .catch((e: Error) => setError(`Couldn't load snapshots — ${e.message}. Check API logs.`));
  }, []);

  // I-WINDOW-PROMPT — Task 12 + Task 16 land in a single commit (no
  // transient window.prompt in main). The Restore button opens
  // RestoreConfirmModal (typed-RESTORE flow) from Task 16. The handler
  // here is a stub that surfaces the snapshot id to the parent's modal
  // state in SettingsBackupsPage.
  const [pendingRestoreId, setPendingRestoreId] = useState<string | null>(null);

  const onRestoreClick = (id: string) => setPendingRestoreId(id);
  const onRestoreConfirm = async (id: string) => {
    await restoreBackup(id);
    setPendingRestoreId(null);
  };

  // I-DELETE-CONFIRM — light-tier ConfirmDialog (toast+undo). Pre-W6,
  // stub pushToast; wire to ToastHost once W6 lands.
  const onDeleteClick = (id: string) => {
    // pushToast({ tier: 'light', message: `Deleted ${id}`, undo: () => undeleteBackup(id) });
    deleteBackup(id).then(() => setItems(items.filter((x) => x.id !== id)));
  };

  if (error) return <div style={{ color: TOKENS.danger }}>{error}</div>;

  return (
    <table style={{ width: '100%', fontFamily: FONTS.ui, color: TOKENS.text }}>
      <thead>
        <tr>
          <th style={{ textAlign: 'left' }}>FILE</th>
          <th>TRIGGER</th>
          <th>SIZE</th>
          <th>CREATED</th>
          <th>STATUS</th>
          {!isMobile && <th>ACTIONS</th>}
        </tr>
      </thead>
      <tbody>
        {items.map((it) => (
          <tr key={it.id}>
            <td>{it.id}</td>
            <td>{it.trigger}</td>
            <td>{Math.round(it.size_bytes / 1024)} KiB</td>
            <td>{it.created_at}</td>
            <td><Badge tier={it.verified_restorable} /></td>
            {!isMobile && (
              <td>
                <button
                  onClick={() => onRestoreClick(it.id)}
                  disabled={it.verified_restorable === 'danger'}>Restore</button>
                {/* I-BADGE-WARN-DOWNLOAD — disable Download when file missing on disk */}
                {it.verified_restorable === 'warn' ? (
                  <span title="File missing on disk" style={{ color: TOKENS.textDim, opacity: 0.5 }}>Download</span>
                ) : (
                  <a href={`/api/backups/${encodeURIComponent(it.id)}/download`}>Download</a>
                )}
                <button onClick={() => onDeleteClick(it.id)}>Delete</button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
  // (rendered in a fragment alongside RestoreConfirmModal below;
  // shown when pendingRestoreId is non-null per I-WINDOW-PROMPT.)
}
```

Add the modal mount to the SnapshotTable return (wrap the existing return in a fragment so the modal is sibling to the table):

```typescript
  return (
    <>
      <table /* ... */ >{/* ... */}</table>
      {pendingRestoreId && (
        <RestoreConfirmModal
          snapshotId={pendingRestoreId}
          onConfirm={onRestoreConfirm}
          onCancel={() => setPendingRestoreId(null)}
        />
      )}
    </>
  );
```

`RestoreConfirmModal` is the Task 16 component. Task 12 + Task 16 land in a single commit per I-WINDOW-PROMPT.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/frontend
npx vitest run src/components/settings/SnapshotTable.test.tsx
```

Expected: 2/2 PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api/backups.ts \
        frontend/src/components/settings/SnapshotTable.tsx \
        frontend/src/components/settings/SnapshotTable.test.tsx
git commit -m "feat: add SnapshotTable + badge tiers (W5 P7)"
```

### Task 13: SettingsBackupsPage with Backup Now button

**Files:**
- Create: `frontend/src/pages/SettingsBackupsPage.tsx`
- Test: `frontend/src/pages/SettingsBackupsPage.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SettingsBackupsPage from './SettingsBackupsPage';
import * as api from '../lib/api/backups';

vi.mock('../lib/api/backups');

describe('SettingsBackupsPage', () => {
  it('lets the user trigger a manual backup', async () => {
    (api.listBackups as any).mockResolvedValue({ items: [] });
    (api.createBackup as any).mockResolvedValue({
      id: 'repos-NEW.dump.gz', trigger: 'manual', size_bytes: 100, verified_restorable: 'good', created_at: 'now',
    });
    render(<SettingsBackupsPage />);
    fireEvent.click(screen.getByRole('button', { name: /backup now/i }));
    await waitFor(() => expect(api.createBackup).toHaveBeenCalled());
  });

  it('hides Backup Now on mobile', () => {
    // useIsMobile mock returns true
    vi.mock('../lib/useIsMobile', () => ({ useIsMobile: () => true }));
    (api.listBackups as any).mockResolvedValue({ items: [] });
    render(<SettingsBackupsPage />);
    expect(screen.queryByRole('button', { name: /backup now/i })).toBeNull();
  });
});
```

- [ ] **Step 2: Write `SettingsBackupsPage.tsx`**

```typescript
// frontend/src/pages/SettingsBackupsPage.tsx
//
// W5 — desktop-primary backups page. Mobile renders the snapshot table
// read-only (no Backup Now / Restore / Delete affordances). Maintenance
// banner is wired in the AppShell, not here, so it surfaces across
// every page when the flag is set.
//
// Per memory feedback_user_reachability_dod: this page must be reachable
// from `/` in ≤3 clicks. Sidebar entry lands in Task 15.
import { useState } from 'react';
import { FONTS, TOKENS } from '../tokens';
import { SnapshotTable } from '../components/settings/SnapshotTable';
import { createBackup } from '../lib/api/backups';
import { useIsMobile } from '../lib/useIsMobile';

export default function SettingsBackupsPage(): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMobile = useIsMobile();

  const onBackupNow = async () => {
    setBusy(true);
    setError(null);
    try {
      await createBackup();
      window.location.reload();  // simplest path: re-read the list
    } catch (e) {
      setError(`Backup failed — ${(e as Error).message}. Check API logs at /config/log/api.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={{ padding: 16, color: TOKENS.text, fontFamily: FONTS.ui }}>
      <h1 style={{ fontSize: 22, marginBottom: 12 }}>Backups</h1>
      {!isMobile && (
        <>
          <p style={{ color: TOKENS.textDim, fontSize: 13, marginBottom: 16 }}>
            Snapshots live in /config/backups. Nightly auto-backup runs at 03:15 UTC.
          </p>
          <button onClick={onBackupNow} disabled={busy}>
            {busy ? 'Backing up…' : 'Backup now'}
          </button>
          {error && <div style={{ color: TOKENS.danger, marginTop: 8 }}>{error}</div>}
        </>
      )}
      <div style={{ marginTop: 24 }}>
        <SnapshotTable />
        {/* I-MOBILE-AFFORDANCE — message lives inline NEAR where the absent
            buttons would be (row footer below the table), not as a banner
            above. The SnapshotTable component is responsible for omitting
            the action column on mobile; the page only adds the trailing
            footer note. */}
        {isMobile && (
          <p style={{
            color: TOKENS.textDim, fontSize: 12, marginTop: 8,
            paddingTop: 8, borderTop: `1px solid ${TOKENS.border}`,
            textAlign: 'center',
          }}>
            Tap "Settings → Backups" on desktop to take or restore a snapshot.
          </p>
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 3-4: Run + commit.**

```bash
npx vitest run src/pages/SettingsBackupsPage.test.tsx
git add frontend/src/pages/SettingsBackupsPage.tsx frontend/src/pages/SettingsBackupsPage.test.tsx
git commit -m "feat: add /settings/backups page (W5 P7)"
```

### Task 14: MaintenanceBanner with pre-snapshot recovery affordance

**Files:**
- Create: `frontend/src/components/maintenance/MaintenanceBanner.tsx`
- Modify: `frontend/src/components/layout/AppShell.tsx` — mount banner at top
- Test: `frontend/src/components/maintenance/MaintenanceBanner.test.tsx`

**[ABS-3] Banner copy (verb-first, no hedges):**
> "RepOS is down for a database restore. ~60 seconds. Your last set is queued locally."

On the failed-restore branch, copy becomes:
> "Restore failed: <error_message>. Roll back to the pre-restore snapshot?" + a "Roll back" button.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MaintenanceBanner } from './MaintenanceBanner';
import * as api from '../../lib/api/backups';

vi.mock('../../lib/api/backups');
beforeEach(() => vi.clearAllMocks());

describe('MaintenanceBanner', () => {
  it('renders nothing when maintenance is inactive', async () => {
    (api.getMaintenanceStatus as any).mockResolvedValue({ active: false, restore: null, recovery_available: false });
    const { container } = render(<MaintenanceBanner />);
    await waitFor(() => expect(api.getMaintenanceStatus).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('shows running-restore copy', async () => {
    (api.getMaintenanceStatus as any).mockResolvedValue({
      active: true, restore: { status: 'running' }, recovery_available: false,
    });
    render(<MaintenanceBanner />);
    await waitFor(() => screen.getByText(/RepOS is down for a database restore/));
    expect(screen.getByText(/Your last set is queued locally/)).toBeInTheDocument();
  });

  it('shows failed-restore copy with Roll back button when recovery available', async () => {
    (api.getMaintenanceStatus as any).mockResolvedValue({
      active: true,
      restore: { status: 'failed', error_message: 'migration 49 failed' },
      recovery_available: true,
    });
    (api.restorePreSnapshot as any).mockResolvedValue(undefined);
    render(<MaintenanceBanner />);
    await waitFor(() => screen.getByText(/Restore failed/));
    expect(screen.getByText(/migration 49 failed/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /roll back/i }));
    await waitFor(() => expect(api.restorePreSnapshot).toHaveBeenCalled());
  });

  it('reloads when transitioning from active to inactive', async () => {
    const reload = vi.fn();
    Object.defineProperty(window, 'location', { value: { reload, pathname: '/settings/backups' }, writable: true });
    (api.getMaintenanceStatus as any)
      .mockResolvedValueOnce({ active: true, restore: { status: 'running' }, recovery_available: false })
      .mockResolvedValueOnce({ active: false, restore: { status: 'ok' }, recovery_available: false });
    render(<MaintenanceBanner pollIntervalMs={10} />);
    await waitFor(() => expect(reload).toHaveBeenCalled(), { timeout: 1000 });
  });

  // C-MOBILE-MAINTENANCE — suppress reload when user is on /today/:runId/log.
  it('does NOT auto-reload on /today/:runId/log; shows Reload CTA instead', async () => {
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { reload, pathname: '/today/abc-123/log' },
      writable: true,
    });
    (api.getMaintenanceStatus as any)
      .mockResolvedValueOnce({ active: true, restore: { status: 'running' }, recovery_available: false })
      .mockResolvedValueOnce({ active: false, restore: { status: 'ok' }, recovery_available: false });
    render(<MaintenanceBanner pollIntervalMs={10} />);
    await waitFor(() => screen.getByText(/Restore complete — reload to continue/), { timeout: 1000 });
    expect(reload).not.toHaveBeenCalled();
    // User clicks Reload manually.
    fireEvent.click(screen.getByRole('button', { name: /reload/i }));
    expect(reload).toHaveBeenCalled();
  });

  // C-MOBILE-MAINTENANCE — also suppress when idbQueue has syncing rows.
  it('does NOT auto-reload when idbQueue.peekSyncing() returns rows', async () => {
    vi.doMock('../../lib/idbQueue', () => ({
      peekPending: async () => [],
      peekSyncing: async () => [{ id: 'q-1' }],
    }));
    const reload = vi.fn();
    Object.defineProperty(window, 'location', { value: { reload, pathname: '/settings/backups' }, writable: true });
    (api.getMaintenanceStatus as any)
      .mockResolvedValueOnce({ active: true, restore: { status: 'running' }, recovery_available: false })
      .mockResolvedValueOnce({ active: false, restore: { status: 'ok' }, recovery_available: false });
    render(<MaintenanceBanner pollIntervalMs={10} />);
    await waitFor(() => screen.getByText(/Restore complete — reload to continue/), { timeout: 1000 });
    expect(reload).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement `MaintenanceBanner.tsx`**

```typescript
// frontend/src/components/maintenance/MaintenanceBanner.tsx
//
// W5 — sticky-top banner that polls /api/maintenance/status. Renders when
// active=true; hides + force-reloads when active flips false.
//
// [ABS-3] Banner copy (verb-first, no "briefly," no "automatically when
// service returns" hedge): "RepOS is down for a database restore.
// ~60 seconds. Your last set is queued locally."
//
// Failed-restore branch: surfaces error_message + "Roll back" button
// when recovery_available=true.
//
// The banner is rendered globally from AppShell so every route shows it.
// On mobile it covers the AppShell top; on desktop it spans the content area.
import { useEffect, useRef, useState } from 'react';
import { TOKENS, FONTS } from '../../tokens';
import { getMaintenanceStatus, restorePreSnapshot, type MaintenanceStatus } from '../../lib/api/backups';

const DEFAULT_POLL_MS = 5_000;

export function MaintenanceBanner({ pollIntervalMs = DEFAULT_POLL_MS }: { pollIntervalMs?: number }): JSX.Element | null {
  const [status, setStatus] = useState<MaintenanceStatus | null>(null);
  const wasActive = useRef(false);

  // C-MOBILE-MAINTENANCE — don't blow the React tree mid-set on mobile.
  // The idbQueue may have rows in 'syncing' state; force-reloading would
  // lose them. Inspect queue state before reloading; if anything is in
  // `syncing` OR the user is on /today/:runId/log, suppress the reload
  // and surface a soft CTA banner instead.
  const [showReloadCta, setShowReloadCta] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const poll = async () => {
      try {
        const s = await getMaintenanceStatus();
        if (wasActive.current && !s.active) {
          // Flipped from active → inactive. Decide whether it's safe to reload.
          const isOnActiveLogger = /^\/today\/[^/]+\/log\b/.test(window.location.pathname);
          let queueBusy = false;
          try {
            // Dynamic import so the banner test doesn't need an indexeddb mock.
            const queueMod = await import('../../lib/idbQueue');
            const pending = await queueMod.peekPending?.();
            const syncing = await queueMod.peekSyncing?.();
            queueBusy = (syncing?.length ?? 0) > 0;
            // Note: peekPending() rows survive reload (IndexedDB persists);
            // it's the in-flight syncing rows that would be lost.
            void pending;
          } catch {
            // idbQueue not present — assume safe.
          }

          if (isOnActiveLogger || queueBusy) {
            // Suppress reload; surface a CTA so the user can choose when.
            setShowReloadCta(true);
            wasActive.current = false;
            setStatus(s);
            return;
          }

          window.location.reload();
          return;
        }
        wasActive.current = s.active;
        setStatus(s);
      } catch {
        // network error during a restore is expected (the API is 503ing).
        // Stay in current state; next poll will resolve.
      }
    };
    poll();
    timer = setInterval(poll, pollIntervalMs);
    return () => { if (timer) clearInterval(timer); };
  }, [pollIntervalMs]);

  // CTA branch — render even when status.active is false.
  if (showReloadCta) {
    return (
      <div role="status" aria-live="polite" style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: TOKENS.accent, color: '#000', padding: '12px 16px',
        fontFamily: FONTS.ui, fontSize: 14, fontWeight: 600,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
      }}>
        <span>Restore complete — reload to continue.</span>
        <button
          style={{ background: '#000', color: '#fff', border: 0, padding: '6px 12px', borderRadius: 4, cursor: 'pointer' }}
          onClick={() => window.location.reload()}
        >Reload</button>
      </div>
    );
  }

  if (!status?.active) return null;

  const failed = status.restore?.status === 'failed';

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: failed ? TOKENS.danger : TOKENS.accent,
        color: '#000', padding: '12px 16px',
        fontFamily: FONTS.ui, fontSize: 14, fontWeight: 600,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
      }}>
      {failed ? (
        <>
          <span>Restore failed: {status.restore?.error_message ?? 'unknown error'}.</span>
          {status.recovery_available && (
            <button
              style={{ background: '#000', color: '#fff', border: 0, padding: '6px 12px', borderRadius: 4, cursor: 'pointer' }}
              onClick={() => restorePreSnapshot()}
            >Roll back to pre-restore snapshot</button>
          )}
        </>
      ) : (
        <span>RepOS is down for a database restore. ~60 seconds. Your last set is queued locally.</span>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Mount in `AppShell.tsx`** (at the top of the Outlet wrapper):

```typescript
import { MaintenanceBanner } from '../maintenance/MaintenanceBanner';
// inside the main render:
<>
  <MaintenanceBanner />
  {/* existing AppShell content */}
</>
```

- [ ] **Step 4-5: Run + commit.**

```bash
npx vitest run src/components/maintenance/MaintenanceBanner.test.tsx
git add frontend/src/components/maintenance/ frontend/src/components/layout/AppShell.tsx
git commit -m "feat: add MaintenanceBanner with rollback affordance (W5 P7)"
```

### Task 15: Wire the route + Sidebar sub-nav entry

**Files:**
- Modify: `frontend/src/App.tsx` — add `<Route path="settings/backups" element={<SettingsBackupsPage />} />`
- Modify: `frontend/src/components/layout/Sidebar.tsx` — add `{ label: 'Backups', to: '/settings/backups' }` to `SETTINGS_SUB`. **Flag for W6 owner: sub-nav order is W6's call.**

- [ ] **Step 1: Modify App.tsx**

Insert after the existing `settings/injuries` route:

```typescript
import SettingsBackupsPage from './pages/SettingsBackupsPage';
// ...
<Route path="settings/backups" element={<SettingsBackupsPage />} />
```

- [ ] **Step 2: Modify Sidebar.tsx `SETTINGS_SUB`**

```typescript
const SETTINGS_SUB = [
  { label: 'Integrations', to: '/settings/integrations' },
  { label: 'Units & equipment', to: '/settings/equipment' },
  { label: 'Account', to: '/settings/account' },
  { label: 'Storage', to: '/settings/storage' },
  { label: 'Injuries', to: '/settings/injuries' },
  { label: 'Backups', to: '/settings/backups' },  // W5 — W6 may reorder per Appendix A §651
];
```

- [ ] **Step 3: Update Sidebar.test.tsx**

Find the existing test that asserts the sub-nav items and add `Backups` to the expected list. Then add a new test:

```typescript
it('navigates to /settings/backups when Backups sub-nav clicked', async () => {
  // render Sidebar inside /settings/* route so sub-nav is visible
  // click Backups
  // assert location is /settings/backups
});
```

- [ ] **Step 4: Verify desktop click-path from `/` is 2 clicks**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/frontend
npx vitest run src/components/layout/Sidebar.test.tsx
```

Path: `/` → "Settings" nav item (click 1) → "Backups" sub-nav item (click 2) → `/settings/backups`. **2 clicks.** ✓

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/layout/Sidebar.tsx frontend/src/components/layout/Sidebar.test.tsx
git commit -m "feat: wire /settings/backups route + sidebar entry (W5 P7, G7)"
```

### Task 16: Restore-confirm modal (typed RESTORE)

**Files:**
- Create: `frontend/src/components/settings/RestoreConfirmModal.tsx`
- Test: `frontend/src/components/settings/RestoreConfirmModal.test.tsx`

**I-WINDOW-PROMPT — Task 12 + Task 16 land in a single commit.** Task 12's `SnapshotTable.tsx` already mounts the modal via `pendingRestoreId` state; this task creates the actual modal component. No `window.prompt` ships even transiently. Tier alignment with W6: this modal corresponds to W6's `ConfirmDialog tier="heavy"` with `requireTyped="RESTORE"` — when W6 lands, swap this bespoke modal for the canonical `ConfirmDialog`. Pre-W6, this bespoke implementation is the canonical destructive-confirm for `/settings/backups`. Follows the existing destructive-confirm pattern (`SettingsStorage.tsx` `CONFIRM_PHRASE`):

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RestoreConfirmModal } from './RestoreConfirmModal';

describe('RestoreConfirmModal', () => {
  it('disables Confirm until user types RESTORE exactly', () => {
    const onConfirm = vi.fn();
    render(<RestoreConfirmModal snapshotId="repos-X.dump.gz" onConfirm={onConfirm} onCancel={() => {}} />);
    const confirm = screen.getByRole('button', { name: /confirm restore/i });
    expect(confirm).toBeDisabled();
    const input = screen.getByLabelText(/type RESTORE to confirm/i);
    fireEvent.change(input, { target: { value: 'restore' } });
    expect(confirm).toBeDisabled();
    fireEvent.change(input, { target: { value: 'RESTORE' } });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith('repos-X.dump.gz');
  });
});
```

- [ ] **Step 2-5: Implement modal + commit Task 12 + Task 16 atomically.**

Per I-WINDOW-PROMPT, Task 12's SnapshotTable already references RestoreConfirmModal via `pendingRestoreId`. This task creates the component file. Combine with Task 12's staged files in a single commit so main never has a `window.prompt` reference.

```bash
git add frontend/src/components/settings/RestoreConfirmModal.tsx \
        frontend/src/components/settings/RestoreConfirmModal.test.tsx \
        frontend/src/components/settings/SnapshotTable.tsx \
        frontend/src/components/settings/SnapshotTable.test.tsx \
        frontend/src/lib/api/backups.ts
git commit -m "feat: SnapshotTable + RestoreConfirmModal (W5 P7, I-WINDOW-PROMPT)"
```

### Task 17: Playwright reachability smoke

**Files:** `tests/e2e/w5-backups-reachability.spec.ts`

Reach `/settings/backups` from `/` in 2 clicks. Mirrors `tests/e2e/w3-injury-swap-flow.spec.ts`.

- [ ] **Step 1: Write the spec**

```typescript
import { test, expect } from '@playwright/test';

test('W5 — desktop user reaches /settings/backups in 2 clicks from /', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('link', { name: /^Settings/ }).click();
  await page.getByRole('link', { name: /^Backups$/ }).click();
  await expect(page).toHaveURL(/\/settings\/backups$/);
  await expect(page.getByRole('heading', { name: 'Backups' })).toBeVisible();
  await expect(page.getByRole('button', { name: /backup now/i })).toBeVisible();
});

test('W5 — mobile viewport hides Backup Now affordance', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/settings/backups');
  await expect(page.getByText(/Tap "Settings → Backups" on desktop/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /backup now/i })).toHaveCount(0);
});

// C-MOBILE-MAINTENANCE — restore-completes-mid-logger should NOT force-reload.
// Drives a mobile-sized live logger with a pending idbQueue row, fires a
// simulated maintenance flip, asserts no auto-reload + the Reload CTA appears.
test('W5 — mobile /today/:runId/log suppresses force-reload, shows CTA', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // Pre-seed idbQueue with one row in 'syncing' state so the banner detects
  // queue activity and chooses the soft-CTA path.
  await page.addInitScript(() => {
    (window as any).__W5_TEST_QUEUE_SYNCING = [{ id: 'test-queue-1' }];
  });
  await page.goto('/today/00000000-0000-0000-0000-000000000abc/log');
  // Force-trigger the maintenance status flip via test endpoint (or mock).
  await page.evaluate(() => {
    // Test-only hook: the banner reads from window.fetch; intercept here.
    const origFetch = window.fetch;
    let calls = 0;
    window.fetch = async (input: any, init: any) => {
      if (typeof input === 'string' && input.includes('/api/maintenance/status')) {
        calls++;
        const body = calls === 1
          ? { active: true, restore: { status: 'running' }, recovery_available: false }
          : { active: false, restore: { status: 'ok' }, recovery_available: false };
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return origFetch(input, init);
    };
  });
  await expect(page.getByText(/Restore complete — reload to continue/i)).toBeVisible({ timeout: 10_000 });
  // URL should still be the logger — no auto-reload happened.
  await expect(page).toHaveURL(/\/today\/[^/]+\/log$/);
});
```

- [ ] **Step 2-3: Run + commit.**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/frontend
npx playwright test tests/e2e/w5-backups-reachability.spec.ts
git add tests/e2e/w5-backups-reachability.spec.ts
git commit -m "test: Playwright reachability for /settings/backups (W5 G7)"
```

---

## Phase 8 — DR infrastructure + runbooks

### Task 18: `tests/dr/restore-into-ephemeral.sh`

**Files:**
- Create: `tests/dr/restore-into-ephemeral.sh`
- Create: `tests/dr/integrity-check.test.sh`
- Create: `tests/dr/last-run.txt` (initial content: current ISO date)
- Create: `tests/dr/README.md`

**[ABS-6]** `last-run.txt` enforces the "DR test within 100 days" cadence. CI fails if the file's **git commit time** is > 100 days old (per I-LAST-RUN-CI — filesystem mtime resets on checkout). On every successful local DR test run, the script `touch`-updates `last-run.txt`; the operator MUST `git add` + `git commit` the touched file so the cadence is honored.

CI check (W8.6 hook):

```bash
#!/usr/bin/env bash
# tests/dr/check-cadence.sh — fails if last-run.txt is > 100 days stale.
set -euo pipefail
test -f tests/dr/last-run.txt || { echo "FAIL: tests/dr/last-run.txt missing"; exit 1; }
LAST_COMMIT_TS=$(git log -1 --format=%ct tests/dr/last-run.txt)
NOW=$(date +%s)
DELTA=$(( NOW - LAST_COMMIT_TS ))
LIMIT=8640000  # 100 days in seconds
if [ "$DELTA" -gt "$LIMIT" ]; then
  DAYS=$(( DELTA / 86400 ))
  echo "FAIL: last DR run was ${DAYS} days ago (limit: 100). Run tests/dr/restore-into-ephemeral.sh + commit the updated last-run.txt." >&2
  exit 1
fi
echo "OK: last DR run was $(( DELTA / 86400 )) days ago"
```

- [ ] **Step 1: Write `tests/dr/integrity-check.test.sh`**

```bash
#!/usr/bin/env bash
# W5.1 — backup integrity-check unit test.
#
# Injects a known-bad gzip into a temp dir, runs repos-backup.sh in
# validate-only mode against it, asserts non-zero exit + bad file deleted.
set -euo pipefail

TMP=$(mktemp -d)
trap "rm -rf '$TMP'" EXIT

BAD="$TMP/repos-bad.dump.gz"
printf 'not a gzip' > "$BAD"

# Validate-only: just run the integrity check the script uses on its own output.
if gunzip -c "$BAD" 2>/dev/null | pg_restore -l > /dev/null 2>&1; then
  echo "FAIL: integrity check passed on bad input"
  exit 1
fi
echo "✓ integrity check correctly rejects non-gzip input"
```

- [ ] **Step 2: Write `tests/dr/restore-into-ephemeral.sh`**

```bash
#!/usr/bin/env bash
# W5.5 — DR test. Restore the most-recent prod dump into an ephemeral
# postgres + run a smoke query. CI-runnable artifact, NOT a manual
# procedure.
#
# Usage:
#   PROD_HOST=192.168.88.65 PROD_USER=root \
#     tests/dr/restore-into-ephemeral.sh
#
# Env:
#   PROD_HOST      — hostname or IP of the prod container's host
#   PROD_USER      — SSH user (default: root, the unraid SSH alias)
#   EPHEMERAL_DSN  — postgres DSN to restore into; defaults to a
#                    docker-spawned ephemeral if `docker` is available,
#                    otherwise to ${EPHEMERAL_DSN_FALLBACK} (a local
#                    repos_dr test DB that the developer pre-creates).
set -euo pipefail

PROD_HOST="${PROD_HOST:-192.168.88.65}"
PROD_USER="${PROD_USER:-root}"
PROD_BACKUPS="${PROD_BACKUPS:-/mnt/user/appdata/repos/config/backups}"
LAST_RUN_FILE="$(dirname "$0")/last-run.txt"

echo "→ Pulling latest dump from ${PROD_USER}@${PROD_HOST}:${PROD_BACKUPS}/"
LATEST=$(ssh "${PROD_USER}@${PROD_HOST}" \
  "ls -t ${PROD_BACKUPS}/repos-*.dump.gz | head -1")
[ -n "$LATEST" ] || { echo "FAIL: no dumps found on prod"; exit 1; }

TMP_DIR=$(mktemp -d)
trap "rm -rf '$TMP_DIR'" EXIT
LOCAL_DUMP="$TMP_DIR/$(basename "$LATEST")"
scp "${PROD_USER}@${PROD_HOST}:${LATEST}" "$LOCAL_DUMP"

echo "→ pg_restore -l smoke (table-of-contents readable):"
gunzip -c "$LOCAL_DUMP" | pg_restore -l > "$TMP_DIR/toc.txt"
wc -l "$TMP_DIR/toc.txt"

echo "→ Restoring into ephemeral postgres..."
if command -v docker >/dev/null 2>&1; then
  EPHEMERAL_NAME="repos-dr-$$"
  docker run -d --rm --name "$EPHEMERAL_NAME" \
    -e POSTGRES_PASSWORD=dr -p 0:5432 postgres:16-alpine >/dev/null
  trap "docker stop $EPHEMERAL_NAME >/dev/null 2>&1; rm -rf '$TMP_DIR'" EXIT
  PORT=$(docker port "$EPHEMERAL_NAME" 5432 | cut -d: -f2)
  DSN="postgres://postgres:dr@127.0.0.1:${PORT}/postgres"
  # Wait for ready
  for i in $(seq 1 30); do
    pg_isready -d "$DSN" && break || sleep 1
  done
else
  DSN="${EPHEMERAL_DSN:-${EPHEMERAL_DSN_FALLBACK:-postgres://repos@127.0.0.1:5432/repos_dr}}"
  echo "→ docker not available; using ${DSN}"
fi

gunzip -c "$LOCAL_DUMP" | pg_restore --clean --if-exists --no-owner --no-privileges -d "$DSN"

echo "→ Integration smoke (table count):"
TABLE_COUNT=$(psql "$DSN" -tA -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
echo "   tables: $TABLE_COUNT"
[ "$TABLE_COUNT" -ge 10 ] || { echo "FAIL: too few tables restored ($TABLE_COUNT)"; exit 1; }

USERS_COUNT=$(psql "$DSN" -tA -c "SELECT count(*) FROM users")
echo "   users rows: $USERS_COUNT"

echo "✓ DR test green"
date -u +%Y-%m-%dT%H:%M:%SZ > "$LAST_RUN_FILE"
echo "   updated $LAST_RUN_FILE"
```

- [ ] **Step 3: Write `tests/dr/README.md`**

```markdown
# DR — Disaster Recovery Tests

## restore-into-ephemeral.sh
SCPs the latest prod dump, restores into an ephemeral Postgres
(docker if available, otherwise the dev `repos_dr` DB), smoke-checks
table count + users count.

**Cadence:** every 100 days. CI fails the build if `last-run.txt` is
older than that.

## Run locally
```
PROD_HOST=192.168.88.65 tests/dr/restore-into-ephemeral.sh
```
```

- [ ] **Step 4: Seed `tests/dr/last-run.txt`**

```
2026-05-25T00:00:00Z
```

- [ ] **Step 5: Commit**

```bash
chmod +x tests/dr/restore-into-ephemeral.sh tests/dr/integrity-check.test.sh
git add tests/dr/ scripts/run-restore.sh
git commit -m "feat: add DR test + integrity check + last-run cadence (W5 P8, G5)"
```

### Task 19: Healthchecks.io provisioning + `.env` entries

**Files:**
- Modify: `api/src/bootstrap-guards.ts` — log a startup INFO line when `HEALTHCHECKS_BACKUP_UUID` or `HEALTHCHECKS_HEALTH_UUID` is unset (NOT fatal — these are alerting, not gating)
- Modify: `docker/Dockerfile` — ensure `curl` is in the runtime image (for the `hc-ping.com` ping in repos-backup.sh)
- Modify: `.env.example` (or create if missing) — document the two UUIDs

- [ ] **Step 1: Create `.env.example` entries**

Add:
```
# W5 — Healthchecks.io alert pings (per Appendix A ABS-5).
# Provision two checks in Healthchecks.io and paste UUIDs here:
#   - HEALTHCHECKS_BACKUP_UUID — cron mode, 1 day period, 30 min grace.
#     repos-backup.sh pings this on success. No ping in 24h+30m = alert.
#   - HEALTHCHECKS_HEALTH_UUID — cron mode, 10 min period, 5 min grace.
#     Unraid host cron pings this from outside the container every 10m.
HEALTHCHECKS_BACKUP_UUID=
HEALTHCHECKS_HEALTH_UUID=
```

- [ ] **Step 2: Add startup INFO log in `bootstrap-guards.ts`**

Append to the info section:
```typescript
if (!env.HEALTHCHECKS_BACKUP_UUID) {
  info.push({ level: 'info', msg: 'HEALTHCHECKS_BACKUP_UUID unset — backup-job alerting disabled' });
}
if (!env.HEALTHCHECKS_HEALTH_UUID) {
  info.push({ level: 'info', msg: 'HEALTHCHECKS_HEALTH_UUID unset — health-ping alerting disabled' });
}
```

- [ ] **Step 3: Commit**

```bash
git add .env.example api/src/bootstrap-guards.ts docker/Dockerfile
git commit -m "feat: wire Healthchecks.io UUIDs + curl in runtime image (W5 ABS-5)"
```

### Task 20: Healthchecks.io setup runbook

**Files:** `docs/runbooks/healthchecks-setup.md`

- [ ] **Step 1: Write the runbook** — Healthchecks.io account setup, creating the two checks (backup job + health), CF Tunnel notifications, the matching `.env` write on the prod container, smoke test.

- [ ] **Step 2: Commit**

```bash
git add docs/runbooks/healthchecks-setup.md
git commit -m "docs: Healthchecks.io setup runbook (W5)"
```

### Task 21: [ABS-4] Operational runbooks (`secret-rotation.md`, `cf-access-aud-drift.md`)

**Files:**
- Create: `docs/runbooks/secret-rotation.md` — ADMIN_API_KEY rotation, POSTGRES_PASSWORD rotation (per Phase-2 review note), CF Access app rotation. Quarterly cadence in PASSDOWN.
- Create: `docs/runbooks/cf-access-aud-drift.md` — symptoms, diagnosis, recovery (per Phase-2 review note).
- Modify: `reference_unraid_redeploy.md` memory entry (signal in PASSDOWN — do NOT edit memory files directly from this plan; that's an operator action via the `update-memory` skill).

- [ ] **Step 1-2: Write + commit.**

```bash
git add docs/runbooks/secret-rotation.md docs/runbooks/cf-access-aud-drift.md
git commit -m "docs: secret-rotation + CF Access AUD drift runbooks (W5 ABS-4)"
```

### Task 22a: Docker daemon log rotation (W5.7)

**Files:** `docs/runbooks/daemon-json-log-rotation.md` (deploy-side recipe; no in-repo `/etc/docker/daemon.json` because that's a host-level file)

**[Master plan W5.7]:** set `/etc/docker/daemon.json` on the Unraid host with `{"log-driver":"json-file","log-opts":{"max-size":"50m","max-file":"5"}}`; reload the daemon. This is a host-config step, not a code change.

- [ ] **Step 1: Write the runbook**

```markdown
# Docker daemon log rotation (W5.7)

On the Unraid host (192.168.88.2 per `reference_deployment.md`):

1. SSH: `ssh unraid`
2. Edit `/etc/docker/daemon.json`. If the file doesn't exist, create it. If it exists, merge keys.
   ```json
   {
     "log-driver": "json-file",
     "log-opts": { "max-size": "50m", "max-file": "5" }
   }
   ```
3. Reload daemon (Unraid pattern): restart the docker service via the WebUI under Settings → Docker → Stop/Start.
   - Alternative: `systemctl reload docker` if the host supports it.
4. Verify the RepOS container picked up the new logging policy:
   ```
   docker inspect RepOS --format '{{.HostConfig.LogConfig}}'
   ```
   Should show `max-size:50m max-file:5`.

**Why:** without rotation, a long-running container can fill `/var/lib/docker/containers/*/` with multi-GB JSON log files, eventually exhausting the host filesystem and bricking docker.
```

- [ ] **Step 2: Commit**

```bash
git add docs/runbooks/daemon-json-log-rotation.md
git commit -m "docs: docker daemon log rotation runbook (W5.7)"
```

### Task 22b: Nginx admin-zone tightening for `/api/backups/` (D9)

**Files:**
- Modify: `docker/root/etc/nginx/conf.d/api.conf` (or wherever the admin zone is defined) — add `location /api/backups/` with `limit_req zone=admin burst=2 nodelay;` at 2 r/s.

Per D9, backup download stays bearer-only (no signed URL). To compensate, the admin zone is tightened for the backup paths so a leaked bearer can't pull the full dataset in a flood.

- [ ] **Step 1: Inspect the existing admin zone**

```bash
grep -rn 'limit_req_zone\|admin' /Users/jasonmeyer.ict/Projects/RepOS/docker/root/etc/nginx/
```

If no admin zone exists yet, this task lands the zone primitive too — coordinate with the cross-wave nginx config owner.

- [ ] **Step 2: Add the location block**

```nginx
# W5 D9 — backup-path rate limit. Bearer-only download means a single
# bearer leak could pull the full dataset; cap requests at 2 r/s with
# burst=2 so a flood is impossible but legitimate browser use (one
# download click + manifest) isn't blocked.
limit_req_zone $binary_remote_addr zone=backups:10m rate=2r/s;

location /api/backups/ {
    limit_req zone=backups burst=2 nodelay;
    proxy_pass http://api;
    # ... existing proxy headers
}
```

- [ ] **Step 3: Smoke-test the limit**

From outside the container, fire 10 requests in 1 second to `/api/backups/`. Expect a 503 (or 429, depending on nginx config) on the 3rd+ request, never on the 1st or 2nd.

- [ ] **Step 4: Commit**

```bash
git add docker/root/etc/nginx/conf.d/api.conf
git commit -m "feat(security): rate-limit /api/backups/ at 2 r/s (W5 D9)"
```

### Task 22: DR dry-fire runbook + PASSDOWN template

**Files:**
- Create: `docs/runbooks/dr-dry-fire.md`
- Modify: `docs/qa/beta-reachability.md` — add W5 row.

**[CRITICAL — G5 cadence requirement]:** master plan §493 says "DR dry-fire was performed within the last 7 days before cutover." This Task 22 produces the runbook + the PASSDOWN template; the actual dry-fire is a **cutover-week scheduled action**, not a W5-merge-time action. The plan must explicitly schedule it.

- [ ] **Step 1: Write `docs/runbooks/dr-dry-fire.md`**

Contents (concise):

```markdown
# DR Dry-Fire — Production Restore Rehearsal

**Cadence:** within 7 days before each cutover, and every 100 days during steady-state Beta (per G5 + tests/dr/last-run.txt).

**Pre-cutover scheduling:** the orchestrator schedules this 5–7 days before cutover-day (the pre-cutover prod window per memory project_beta_no_staging.md). The window is the validation surface: alpha data is already wiped, no real Beta user has signed in yet.

**ZERO DATA LOSS RULE (C-DR-DRY-FIRE-DATA-SAFETY):** the rehearsal MUST restore from a backup taken at the rehearsal moment, NOT an older snapshot. Restoring an older snapshot would erase alpha-tester or Beta-tester data captured since that snapshot. Step 1 below is non-negotiable — take the backup FIRST, then restore THAT FILE.

## Steps

1. **Take a fresh manual backup RIGHT NOW.** Navigate to `/settings/backups`, click "Backup now", wait for badge=good. **Note the exact filename** (e.g. `repos-20260526T140530Z.dump.gz`). This is the file the dry-fire restores from.
2. SSH to unraid: `ssh unraid 'ls -la /mnt/user/appdata/repos/config/backups/repos-2026*'` — verify the new file + sidecar JSON; copy the filename into the PASSDOWN entry below.
3. Run `tests/dr/restore-into-ephemeral.sh` locally against that file. Expect green; `tests/dr/last-run.txt` updates.
4. Verify maintenance-mode flow on production:
   - On `/settings/backups`, locate **the file from Step 1** (NOT an older snapshot).
   - Click Restore on that row.
   - Confirm typed-RESTORE modal.
   - Confirm MaintenanceBanner appears site-wide within 5 seconds.
   - Wait for restore to complete (~60 seconds).
   - Confirm `POST /api/maintenance/clear` succeeds and banner disappears.
   - Confirm a smoke set-log POST works post-clear.
   - Confirm `device_tokens` were wiped (per C-DEVICE-TOKENS-RESTORE): the iOS Shortcut bearer must 401 until re-minted.
5. Capture timing in PASSDOWN:

```
## DR dry-fire YYYY-MM-DD
- Backup taken at: HH:MM:SS UTC
- Restore kicked off at: HH:MM:SS UTC
- Maintenance flag observed by frontend at: HH:MM:SS UTC
- pg_restore completed at: HH:MM:SS UTC
- Migrations applied at: HH:MM:SS UTC
- /api/maintenance/clear succeeded at: HH:MM:SS UTC
- Total downtime: NN seconds
- Result: [GREEN | RED — see notes]
- Notes: <any anomaly>
```

6. If RED: file a Sev-2 bug, slip cutover until resolved.

## Restoring from a local file (off-box backup)

Per I-RESTORE-FROM-LOCAL — no multipart upload route exists in Beta. To restore from a file you have locally (downloaded from another container or from an off-box backup):

1. SCP the file into the prod container's backups directory:
   ```
   scp ./repos-YYYYMMDDTHHMMSSZ.dump.gz unraid:/mnt/user/appdata/repos/config/backups/
   ```
   The filename MUST match `repos-\d{8}T\d{6}Z\.dump\.gz` — `safeBackupPath()` rejects anything else.
2. SSH to unraid and verify ownership + permissions match other dumps:
   ```
   ssh unraid 'ls -la /mnt/user/appdata/repos/config/backups/repos-YYYYMMDDTHHMMSSZ.dump.gz'
   chown 99:100 /mnt/user/appdata/repos/config/backups/repos-YYYYMMDDTHHMMSSZ.dump.gz
   chmod 0640 /mnt/user/appdata/repos/config/backups/repos-YYYYMMDDTHHMMSSZ.dump.gz
   ```
3. On the RepOS web UI, hit `/settings/backups`. The file appears in the list with `verified_restorable='warn'` (no audit row joined). To upgrade the badge, manually insert an audit row via psql, or click Restore (the restore preflight re-runs the integrity check anyway per I-INTEGRITY-AT-RESTORE).
4. Click Restore. Typed-RESTORE modal. Same flow.

**Note:** this is a manual operator path. Beta does not expose multipart upload. Post-Beta the file-upload path is a candidate add to W7+.
```

- [ ] **Step 2: Add W5 row to `docs/qa/beta-reachability.md`** (after W3 section):

```markdown
## W5 — Backups + Restore

| Surface | Path from `/` | Click count |
|---|---|---|
| `/settings/backups` — SnapshotTable + Backup Now (desktop) | `/` → "Settings" nav → "Backups" sub-nav | **2 clicks** ✓ |
| Pre-snapshot rollback affordance (when restore fails) | Surfaced inline on `/settings/backups` via MaintenanceBanner | **2 clicks** (same as parent page) ✓ |

### Source-of-truth selectors

- "Settings" + "Backups" nav items: `frontend/src/components/layout/Sidebar.tsx::SETTINGS_SUB`. Route `settings/backups` in `frontend/src/App.tsx` rendered by `frontend/src/pages/SettingsBackupsPage.tsx`.
- MaintenanceBanner: `frontend/src/components/maintenance/MaintenanceBanner.tsx`, mounted in `AppShell.tsx`.
- Playwright spec: `tests/e2e/w5-backups-reachability.spec.ts`.

### Mobile

Per project memory `project_device_split.md`, `/settings/backups` is desktop-primary. Mobile renders the route but hides Backup Now / Restore / Delete (text: "Backups must be managed from desktop.").

### G7 status for W5

Both surfaces are reachable inside the 3-click budget. **G7 ✓ for W5.**
```

- [ ] **Step 3: Add a PASSDOWN scheduling note** (signal for orchestrator — NOT a file edit, but a `passdown` skill invocation when this plan is dispatched):

```
## W5 merged — DR dry-fire scheduling

Per G5: a production DR dry-fire is required within 7 days of cutover.

Recommendation: schedule the dry-fire 5–7 days before cutover-day. Use
docs/runbooks/dr-dry-fire.md as the procedure; capture timings in this
PASSDOWN per the template at the bottom of that runbook.

If cutover slips, re-run the dry-fire to bring the 7-day window current.
```

- [ ] **Step 4: Commit**

```bash
git add docs/runbooks/dr-dry-fire.md docs/qa/beta-reachability.md
git commit -m "docs: DR dry-fire runbook + W5 reachability row (W5 P8)"
```

---

## Wave-completion gate (W5 DoD)

Every checkbox below must be `[x]` before W5 merges to main.

- [ ] User can take a manual backup from `/settings/backups`. Sidecar JSON exists (chmod 0640). `backup_runs` audit row written with `integrity_verified=true`, `admin_user_id` populated, `event_kind='create'`.
- [ ] User can navigate from `/` to `/settings/backups` in **2 clicks** on desktop. Mobile route exists but hides authoring affordances; mobile message is inline below the table (I-MOBILE-AFFORDANCE).
- [ ] **G5 acceptance — 4 test cases all green:**
  - [ ] `api/tests/integration/restore.test.ts` — happy path (Task 8)
  - [ ] `api/tests/integration/restore-crash-recovery.test.ts` — crash mid-restore via sentinel reaper (Task 9)
  - [ ] `api/tests/integration/sigterm-drain.test.ts` — SIGTERM drain, zero partial writes (Task 7 + 10)
  - [ ] `api/tests/integration/restore-migration-failure.test.ts` — pre-snapshot rollback + C-FORWARD-INCOMPAT-CHECK (Task 11)
- [ ] **Critical fixes verified:**
  - [ ] C-RESTORE-ORDERING — `run-restore.sh` SIGTERMs API before pg_restore (verify by reading the script)
  - [ ] C-FSYNC-FLAG — `fsyncSync(fd)` after every maintenance flag + sentinel write
  - [ ] C-AUDIT-SENTINEL — `/api/maintenance/status` reads from `/config/restore-state.json`, not `backup_runs`
  - [ ] C-ADMIN-USER-ID — every audit row from HTTP path has `admin_user_id` populated
  - [ ] C-AUTOBACKUP-AUDIT — nightly cron INSERTs `backup_runs` row; nightly backup appears in `GET /api/backups`
  - [ ] C-DOWNLOAD-AUDIT — `GET /api/backups/:id/download` writes `event_kind='download'` row
  - [ ] C-RESTORE-AUTH-CFACCESS — restore endpoint REJECTS X-Admin-Key path
  - [ ] C-DEVICE-TOKENS-RESTORE — `run-restore.sh` wipes `device_tokens` post-restore
  - [ ] C-FORWARD-INCOMPAT-CHECK — restore rejected when dump schema rev > code rev
  - [ ] C-DR-DRY-FIRE-DATA-SAFETY — `dr-dry-fire.md` Step 1 = "take fresh backup first"
  - [ ] C-STALE-LOCK — boot reaper detects stale sentinel + surfaces recovery_available
  - [ ] C-MOBILE-MAINTENANCE — Playwright test confirms no force-reload on `/today/:runId/log`
- [ ] **Important fixes verified:** I-INTEGRITY-AT-RESTORE (pre-flag check), I-CONTENT-LENGTH header on download, I-DELETE-BACKUP-AUDIT row written, I-WINDOW-PROMPT never lands in main, I-BADGE-WARN-DOWNLOAD disabled link, I-SEQUENCE-RESET after restore, I-SIDECAR-PERMS 0640, I-HEALTH-MAINTENANCE 503 on `/health/user-facing`, I-PARTIAL-INDEX-MATCH applied.
- [ ] `tests/dr/restore-into-ephemeral.sh` runs green locally; CI step (`tests/dr/check-cadence.sh`) added per I-LAST-RUN-CI (uses git ctime).
- [ ] `tests/dr/integrity-check.test.sh` runs green.
- [ ] Maintenance banner copy matches [ABS-3] verbatim; appears within 5 seconds of restore kickoff; force-reload on flip-to-inactive EXCEPT on `/today/:runId/log` or when `idbQueue` has syncing rows (C-MOBILE-MAINTENANCE).
- [ ] Backup Now nightly cron (`repos-backup.sh`) extended with `gunzip|pg_restore -l` integrity check + `backup_runs` INSERT + Healthchecks ping + 14-day `scheduler.log` prune.
- [ ] Migrations 050 + 051 applied in production via `validatePlaceholderPurge`-respecting startup. `backup_runs` has `admin_user_id`, `event_kind`, `source_ip` columns.
- [ ] D9 nginx rate limit (Task 22b) — `/api/backups/` capped at 2 r/s.
- [ ] D10 admin gate — EITHER W6 `REPOS_ADMIN_EMAILS` is live and verified, OR the interim 10-LOC hard-coded check from Task 2b is in place + flagged for W6 swap.
- [ ] Runbooks present: `dr-dry-fire.md` (includes Restore-from-local + zero-data-loss step), `healthchecks-setup.md`, `secret-rotation.md`, `cf-access-aud-drift.md`.
- [ ] `docs/qa/beta-reachability.md` has the W5 section.
- [ ] **DR dry-fire scheduled** in PASSDOWN for 5–7 days before cutover-day. Updated `tests/dr/last-run.txt` once dry-fire runs (and committed).

---

## Cross-wave coordination

| Item | Owner | Action |
|------|-------|--------|
| **W6 admin role primitive (D10) — HARD DEPENDENCY** | W6 | W5's "admin-gated" is only meaningful AFTER W6 lands the env-driven `REPOS_ADMIN_EMAILS` check in `requireAdminKeyOrCfAccess`. **Resolution:** either (a) W6 lands first; or (b) W5 ships with the interim 10-LOC hard-coded admin-email check from Task 2b. Either way, the destructive restore routes ALSO require `requireFreshCfAccess: true` (per C-RESTORE-AUTH-CFACCESS) which rejects the X-Admin-Key path. W6 PR must replace the hard-coded check while preserving `requireFreshCfAccess` semantics. |
| **W6 ConfirmDialog (I-DELETE-CONFIRM)** | W6 | Restore uses W6's `ConfirmDialog tier="heavy"` + `requireTyped="RESTORE"` (W5 ships a wave-local equivalent — `RestoreConfirmModal` — pre-W6). Delete-backup uses `tier="light"` (toast + 5s undo). W6 ships `ToastHost`; pre-W6, W5 stubs `pushToast` (no-op). |
| **W6 `device_tokens.revoke_reason` enum (C-DEVICE-TOKENS-RESTORE)** | W6 | W5 contributes a NEW enum value `'restore_replayed'`. W6 plan must include this value in the CHECK constraint or enum DDL. If W6 lands first with a stricter enum, W5's `run-restore.sh` must coordinate. |
| **W6 sign-out-everywhere UX (post-restore banner)** | W6 | C-DEVICE-TOKENS-RESTORE wipes `device_tokens` post-restore → every iOS Shortcut + integration-bearer user hits 401. **W5 contributes** a post-restore one-shot dismissable banner on `/settings/integrations` after the user hits a 401: "Sessions were reset after a database restore. Re-mint your iOS Shortcut bearer below." W6's sign-out-everywhere UX should share this copy or supersede it. |
| **Settings sidebar order (I-SIDEBAR-COORDINATE)** | W6 | W5 inserts `Backups` at the end of `SETTINGS_SUB` per master plan §651 recommended order. **W6 implementer must reorder to: Account → Equipment → Integrations → Program prefs → Backups → Feedback.** This plan leaves a comment in `Sidebar.tsx` flagging the dependency. |
| **W1.3 idbQueue (C-MOBILE-MAINTENANCE)** | W1.3 | `MaintenanceBanner` calls `idbQueue.peekPending()` + `idbQueue.peekSyncing()`. The queue uses IndexedDB so rows survive a reload; the suppression only matters for rows in `syncing` state. **W1.3 must expose `peekPending` + `peekSyncing` as named exports.** If W1.3 ships before W5, no further action; if W5 ships first, mock the imports in tests + ship a stub `idbQueue.ts` if missing in main. |
| **`scope.ts` middleware** | Existing | W5 routes use `requireAdminKeyOrCfAccess`, NOT `requireScope` — backups is admin-only, not user-scoped. |
| **W2 `par_q_acknowledgments`** | W2 | No migration-number collision (W5 uses 050–051; W2 will use earlier or later block). |
| **W8.2 contamination matrix** | W8 | New routes added: `GET /api/backups`, `POST /api/backups`, `DELETE /api/backups/:id`, `GET /api/backups/:id/download`, `POST /api/backups/:id/restore`, `GET /api/maintenance/status`, `POST /api/maintenance/clear`, `POST /api/maintenance/restore-pre-snapshot`, `GET /health/user-facing`. **None require multi-user contamination tests** — every admin route is admin-gated, not user-scoped; `/health/user-facing` is anonymous and returns the same shape for everyone. Flag this for W8.2 so the matrix doesn't try to write tests for them. |
| **W8.6 CI cadence (I-LAST-RUN-CI)** | W8 | Add CI step that fails the build if `tests/dr/last-run.txt` git-commit-time > 100 days. **Use git ctime, not filesystem mtime** (the file is `touch`-updated only by `restore-into-ephemeral.sh`, but checkouts reset filesystem mtime to now). CI script: `[[ $(( $(date +%s) - $(git log -1 --format=%ct tests/dr/last-run.txt) )) -lt 8640000 ]] \|\| exit 1`. |
| **W22b nginx rate limit (D9)** | W5 (this plan, Task 22b new) | Tighten the nginx admin zone to 2 r/s for `location /api/backups/`. See Task 22b. |

---

## Risks + open questions (for the reviewer panel)

**Note:** items 1, 2, 5, 6, 7, 8 below were panel-resolved in the 2026-05-26 revision; the original text is preserved for context but the resolution is the binding decision. New residual risks are captured at the bottom.

1. **Detached child process for restore** (Task 6 Step 3): the runner spawns `bash run-restore.sh` with `detached:true, unref()`. If s6-overlay restarts the API before the child finishes, the child is reparented to PID 1 and continues. **Risk:** in a non-s6 environment (local dev), the child may be orphaned. **Mitigation:** the maintenance flag + `backup_runs.status='running'` row are both persisted; the next API boot can detect a stale running row (`finished_at IS NULL AND started_at < now() - interval '15 minutes'`) and mark it failed.  
   **RESOLVED (I-STALE-ROW-REAPER + C-STALE-LOCK):** boot reaper added to `bootstrap-runtime.ts` for both DB stale-running rows AND the durable sentinel file.

2. **`pg_restore --clean --if-exists` and the live connection pool:** the API process holds a pg pool connection during the restore window. `pg_restore --clean` issues DROPs against tables the pool may have prepared statements against.  
   **RESOLVED (C-RESTORE-ORDERING):** reordered to SIGTERM the API *before* pg_restore. The API drains its pool and exits before any destructive DB op runs.

3. **Testcontainers vs real Postgres for restore tests:** master plan §361 specifies "Testcontainers Postgres." Existing project pattern (per `programModel.smoke.test.ts:19-21`) explicitly rejects testcontainers-node because Docker isn't always available. **This plan follows the existing pattern** (real `repos_test` DB). **Open question:** should the dispatcher accept the deviation, or commission a separate task to install Docker on the dev mac + adopt testcontainers?

4. **In-test restore is partially mocked:** the G5 case-1 test (Task 8) runs `pg_restore` directly via `execSync` rather than through the kickoff path. The kickoff path's child shell (`scripts/run-restore.sh`) is only fully exercised by `tests/dr/restore-into-ephemeral.sh`. **Mitigation:** both layers tested — the kickoff contract in `maintenance-routes.test.ts`, the full shell flow in `tests/dr/`. **Open question:** is this layering acceptable for G5, or does the reviewer want a single integration test that drives the runner end-to-end?

5. **Banner force-reload on flip-to-inactive (Task 14):** if the user is mid-edit, force-reload loses unsaved state.  
   **RESOLVED (C-MOBILE-MAINTENANCE):** banner inspects `idbQueue.peekSyncing()` + the current pathname; on `/today/:runId/log` or with syncing rows present, suppress reload + show Reload CTA. Playwright test added.

6. **`device_tokens` rows survive a restore.**  
   **RESOLVED (C-DEVICE-TOKENS-RESTORE):** `run-restore.sh` UPDATE-revokes all `device_tokens` post-restore with `revoke_reason='restore_replayed'`. W6 sign-out-everywhere UX inherits this; W5 contributes the post-restore "Sessions were reset" banner per cross-wave row.

7. **`/api/backups/:id/download` streams admin-bearer-authenticated file.**  
   **RESOLVED (D9 + C-DOWNLOAD-AUDIT + Task 22b):** download stays bearer-only; every event is audited (`event_kind='download'` row with admin_user_id + source_ip); nginx rate-limits `/api/backups/` to 2 r/s.

8. **No mobile MaintenanceBanner test on `/today/:runId/log`.**  
   **RESOLVED (C-MOBILE-MAINTENANCE):** Playwright test added in Task 17 + Vitest cases in Task 14.

9. **Migration numbering for follow-on Sev-1 fixes:** plan claims 050–051 of the 050–059 block. **Open question:** should we pre-reserve 052 as a "Step-2 destructive for 050" placeholder per G6 two-step pattern? **Recommendation:** no — the table is additive; no Step-2 needed unless a column is dropped.

### New residual risks (2026-05-26 revision)

10. **Interim admin-email check (D10 fallback):** if W5 ships before W6, the 10-LOC hard-coded check in Task 2b is the gate. Two failure modes: (a) someone forgets to remove the hard-coded literal when W6 lands → admin allow-list is effectively immutable; (b) W6 changes the admin-extraction logic in `(req as any).userEmail` and the hard-coded check breaks silently.  
    **Mitigation:** the Task 2b comment includes "DO NOT remove this block until W6 PR confirms the env-driven check is wired." W6 PR description must call out the swap explicitly. Add to PASSDOWN scheduling.

11. **`pg_restore -l` schema-rev preflight is best-effort:** the preflight extracts the highest `_migrations` filename from the dump TOC. If the dump TOC doesn't include `_migrations` (e.g. a pre-W0 dump from before the migrations table existed), the preflight cannot determine the rev and currently defaults to "allow." **Mitigation:** any restore older than W0.0 should already be filtered out by the filename allow-list (`safeBackupPath`). Document this gap in `dr-dry-fire.md` Step 4.

12. **Sentinel file vs `/config` writability:** the durable sentinel + maintenance flag both live in `/config`. If `/config` is read-only (mis-mounted volume), `fsyncSync` succeeds but a subsequent boot reader may see a stale file from a prior boot. **Mitigation:** the boot guard already validates `/config` writability (`validatePlaceholderPurge` checks). Add an explicit `validateConfigWritable` step in `bootstrap-guards.ts` if not already present; flag for the implementer.

13. **`run-restore.sh` Python dependency:** the script uses Python3 inline for atomic JSON writes (the safest way to merge JSON + fsync in bash). **Mitigation:** the s6-overlay container already includes Python3 (validated via `which python3` during build). Verify in `docker/Dockerfile` that python3 isn't pruned during multi-stage builds.
