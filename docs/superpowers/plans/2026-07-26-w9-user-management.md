# W9 — User Management + Invites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move RepOS user management out of container env vars and into the database, so an admin can invite, suspend, reinstate, and delete Beta users from `/settings/users` with no container recreate.

**Architecture:** `users.status` + `users.role` become the authoritative access gate, checked on every request by both auth paths (CF Access JWT and opaque bearer). The Cloudflare Access policy is kept in sync as an edge pre-filter, never as the security boundary — grants take effect last, revocations first. Every membership transition serializes on a session-level `pg_advisory_lock` held on a dedicated pooled connection, outside any transaction, so the Cloudflare HTTP round-trip never sits inside a DB transaction.

**Tech Stack:** Fastify 5, TypeScript (ESM, `.js` import specifiers), `pg` 8 Pool, zod 4, vitest 4, React 18 + Vite 5, Cloudflare Access API, Resend API.

**Source spec:** [docs/superpowers/specs/2026-07-26-user-management-design.md](../specs/2026-07-26-user-management-design.md) — commit `fab968d`. Every `Qnn` reference below points at a locked decision in that spec. Deviations require re-opening the spec.

## Global Constraints

- **Migration range:** `080–089`. **Three** migrations are added by this plan: `080_users_roles_status.sql` (Task 2), `081_invite_request.sql` (the frozen invite request, Q30 — listed under Task 11), and `082_cf_sync_stamp_guard.sql` (Q24 as a trigger, Task 15b). Any harness that reconstructs a pre-W9 database must unwind **all three**, or it silently proves nothing about the ones it left applied — which has now happened twice, to 081 and then to 082. There is exactly one unwind: `unwindToPreW9` in `api/tests/helpers/migration-unwind.ts`. Do not write a second; extend that one, and note it drops 082's trigger and function **before** the columns they depend on.
- **Founding admin email constant:** `jason.meyer1@gmail.com` (Q35). Hard-coded in migration 080 and exported from `api/src/constants/users.ts`.
- **Cohort cap:** `10`, counted as `status IN ('active','invited','deleting')` (Q12). Applies to invite **and** reinstate.
- **Cloudflare account id:** `400d0b4a35d63a32b86ab774b9feb4ab`. **Access policy id:** `b4a92a15-27d5-477b-ad36-f78fcdae931c`.
- **New env vars (set-once):** `CF_API_TOKEN`, `CF_ACCOUNT_ID`, `CF_ACCESS_POLICY_ID`, `RESEND_API_KEY`, `INVITE_FROM_EMAIL`. All advisory at boot — missing credentials fail at use time, never at boot.
- **Removed env vars:** `CF_ACCESS_ALLOWED_EMAILS`, `REPOS_ADMIN_EMAILS`. Every read of either must be gone by Task 16.
- **ESM:** all relative imports inside `api/src` end in `.js` even though the source is `.ts`.
- **Fastify v5:** every hook and preHandler MUST be `async`. A non-async hook that doesn't call `done()` hangs the request.
- **Audit actor shape (Q23):** every lifecycle `account_events` row carries exactly one of — human `{actor_kind:'user', actor_user_id, actor_email}` or system `{actor_kind:'system', actor_name, source:'cutover'|'restore'}`. Never both, never partial.
- **`cf_synced_at` semantics (Q24, Q36):** "this row's intent is reflected in the CF policy." NULL means *sync state unknown*, **not** *divergent*. Any status change that alters CF membership NULLs it first; only a successful sync stamps it.
- **No Cloudflare session-revocation call (Q17a).** `CF_API_TOKEN` must never be granted `Access: Organizations Revoke`.
- **Commit style:** Conventional Commits, one commit per task minimum. Co-author trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Design system:** Inter Tight (UI) / JetBrains Mono (data). Accent `#4D8DFF`, good `#6BE28B`, warn `#F5B544`, danger `#FF6A6A`, surface `#10141C`, bg `#0A0D12`. All-caps CTAs, verbs first.

## Prerequisite: a reachable Postgres

Verified 2026-07-26: **no Postgres is currently reachable** from this workstation. `127.0.0.1:5432` and the retired `192.168.88.2:5432` both refuse connections, and `psql` is not installed. `podman` is available. Before Task 1, bring one up and point `api/.env` at it:

```bash
podman run -d --name repos-pg -p 5432:5432 \
  -e POSTGRES_USER=repos -e POSTGRES_PASSWORD=repos_dev_pw -e POSTGRES_DB=repos_test \
  docker.io/library/postgres:16
```

Then point `api/.env` at it: `DATABASE_URL=postgres://repos:repos_dev_pw@127.0.0.1:5432/repos_test`. It currently names the old `192.168.88.2` host — that is **known and deferred**, not a defect to re-litigate; `.env` is local untracked config and is not authoritative on topology. It just has to name a reachable database for the test suite to run. Run `cd /var/home/jason/Projects/RepOS/api && npm run migrate` once to confirm the baseline schema applies. **No task in this plan can be verified without this.**

## File Structure

**Created — API**

| Path | Responsibility |
|---|---|
| `api/src/constants/users.ts` | `FOUNDING_ADMIN_EMAIL`, `COHORT_CAP`, `UserStatus`, `UserRole` types |
| `api/src/db/runMigrations.ts` | Importable migration runner (extracted from `migrate.ts`) |
| `api/src/db/migrations/080_users_roles_status.sql` | Schema + the Q35 admin-guarantee data step |
| `api/src/services/membershipLock.ts` | Session-level advisory lock on a dedicated pooled connection (Q16, Q38) |
| `api/src/services/cfAccessPolicy.ts` | Cloudflare Access policy HTTP client + fail-closed assertions (Q10, Q19, Q22, Q38) |
| `api/src/services/cfAccessSync.ts` | Status→policy reconciliation primitives (Q7, Q36) |
| `api/src/services/inviteMailer.ts` | Resend client, invite template, idempotency keys (Q5, Q30, Q38) |
| `api/src/services/userLifecycle.ts` | invite / resend / suspend / reinstate / changeRole / retrySync (Q12, Q17, Q26–Q29, Q34) |
| `api/src/services/deleteUser.ts` | The single deletion state machine used by both delete paths (Q33) |
| `api/src/services/cfReconcile.ts` | Status-aware baseline stamping + CF-only import (Q31) |
| `api/src/services/cfReconcile-cli.ts` | CLI entry — `--source=cutover|restore` |
| `api/src/schemas/adminUsers.ts` | zod request/response schemas |
| `api/src/routes/adminUsers.ts` | The six admin routes |
| `scripts/cutover/002-w9-cf-baseline.sh` | Numbered cutover wrapper around the reconcile CLI |

**Modified — API**

| Path | Change |
|---|---|
| `api/src/db/migrate.ts` | Reduced to a thin CLI over `runMigrations` |
| `api/src/middleware/cfAccess.ts` | Deny-by-default gate, activation, role checks, `requireCfAccessAdmin` |
| `api/src/middleware/auth.ts:43-48` | JOIN `users`, reject non-`active` |
| `api/src/services/accountEvents.ts:4-7` | Eight new kinds + actor helpers |
| `api/src/routes/account.ts:314-365` | `DELETE /api/me` delegates to `deleteUser` |
| `api/src/app.ts:112` | `is_admin` from `users.role` |
| `api/src/bootstrap-guards.ts:39-47` | Drop `allowListCount`, add two advisory lines |
| `scripts/run-restore.sh:118` | Invoke CF reconciliation after migrations |

**Created — Frontend**

| Path | Responsibility |
|---|---|
| `frontend/src/lib/api/adminUsers.ts` | Typed client for the six routes |
| `frontend/src/components/settings/UsersTable.tsx` | Table + drift banner + row actions |
| `frontend/src/components/settings/InviteUserModal.tsx` | Email + role form |
| `frontend/src/pages/SettingsUsersPage.tsx` | Page shell, load/refresh, confirm dialogs |

**Created — Docs**

| Path | Responsibility |
|---|---|
| `docs/runbooks/admin-break-glass.md` | Q11 first-admin / total-lockout recovery |

---

### Task 1: Importable migration runner + ephemeral-DB test harness

Migration 080 carries a data step whose correctness depends on the state of a **fresh** database (Q35 clause 3), and the cohort-cap tests (Q18) count rows across the whole `users` table — neither is testable against the shared dev database. Both need a throwaway database per test file. `migrate.ts` is currently a top-level-await script that calls `process.exit` and `db.end()`, so it cannot be imported. Extract the logic first.

**Files:**
- Create: `api/src/db/runMigrations.ts`
- Modify: `api/src/db/migrate.ts` (whole file)
- Create: `api/tests/helpers/ephemeral-db.ts`
- Test: `api/tests/db/ephemeral-db.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `runMigrations(pool: pg.Pool): Promise<string[]>` — applies pending migrations, returns applied filenames.
  - `createEphemeralDb(tag: string): Promise<EphemeralDb>` where `EphemeralDb = { url: string; name: string; drop: () => Promise<void> }`.

- [ ] **Step 1: Write the failing test**

Create `api/tests/db/ephemeral-db.test.ts`:

```ts
// Proves the ephemeral-DB harness that Tasks 2, 10, 11, 15 and 17 depend on:
// a throwaway database, migrations applied into it, and a clean drop.
import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import pg from 'pg';
import { createEphemeralDb } from '../helpers/ephemeral-db.js';
import { runMigrations } from '../../src/db/runMigrations.js';

const created: Array<{ drop: () => Promise<void> }> = [];
afterAll(async () => { for (const c of created) await c.drop(); });

describe('ephemeral-db harness', () => {
  it('creates an empty database, applies every migration, and reports them', async () => {
    const eph = await createEphemeralDb('harness');
    created.push(eph);
    const pool = new pg.Pool({ connectionString: eph.url, max: 2 });
    try {
      const applied = await runMigrations(pool);
      expect(applied).toContain('001_users.sql');
      const { rows } = await pool.query<{ n: number }>(
        `SELECT count(*)::int n FROM information_schema.tables
          WHERE table_schema='public' AND table_name='users'`,
      );
      expect(rows[0].n).toBe(1);
    } finally {
      await pool.end();
    }
  });

  it('is idempotent — a second run applies nothing', async () => {
    const eph = await createEphemeralDb('idem');
    created.push(eph);
    const pool = new pg.Pool({ connectionString: eph.url, max: 2 });
    try {
      const first = await runMigrations(pool);
      expect(first.length).toBeGreaterThan(0);
      const second = await runMigrations(pool);
      expect(second).toEqual([]);
    } finally {
      await pool.end();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/db/ephemeral-db.test.ts`
Expected: FAIL — `Cannot find module '../helpers/ephemeral-db.js'`

- [ ] **Step 3: Extract the runner**

Create `api/src/db/runMigrations.ts`:

```ts
import { readdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, 'migrations');

/**
 * Apply every pending .sql migration against `pool`, in filename order, each
 * in its own transaction. Returns the filenames actually applied (empty on a
 * fully-migrated database).
 *
 * Pins one client for the run so BEGIN/sql/COMMIT share a session, and clears
 * the per-session 5s statement_timeout the Pool sets for runtime queries —
 * migrations may legitimately do long CREATE INDEX or backfill UPDATEs.
 *
 * Throws on the first failing migration (after ROLLBACK) rather than calling
 * process.exit, so tests and run-restore.sh can both handle the failure.
 */
export async function runMigrations(pool: pg.Pool): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SET statement_timeout = 0');
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    const already = new Set(
      (await client.query('SELECT filename FROM _migrations')).rows.map(
        (r: { filename: string }) => r.filename,
      ),
    );
    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (already.has(file)) continue;
      const sql = await readFile(join(migrationsDir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
        console.log(`✓ ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`✗ ${file}`, err);
        throw err;
      }
    }
  } finally {
    client.release();
  }
  return applied;
}
```

Replace the whole of `api/src/db/migrate.ts` with the CLI shim — the `dist/db/migrate.js` path stays valid for `npm run migrate:prod`, the Dockerfile, and `scripts/run-restore.sh:118`:

```ts
import { db } from './client.js';
import { runMigrations } from './runMigrations.js';

try {
  await runMigrations(db);
  console.log('Migrations complete.');
} catch {
  process.exit(1);
} finally {
  await db.end();
}
```

- [ ] **Step 4: Write the harness**

Create `api/tests/helpers/ephemeral-db.ts`:

```ts
// Throwaway per-test-file databases.
//
// Why: migration 080's data step (Q35) and the cohort-cap tests (Q12/Q18)
// assert on WHOLE-TABLE state. Running them against the shared dev database
// makes them depend on rows other test files leaked. Each caller gets its own
// database, created from the maintenance connection derived from DATABASE_URL.
//
// This module MUST NOT import src/db/client.js — callers set
// process.env.DATABASE_URL from `url` and then dynamically import the app, so
// the shared pool must not have been constructed yet.
import { randomUUID } from 'node:crypto';
import pg from 'pg';

export interface EphemeralDb {
  /** Connection string for the new database. */
  url: string;
  /** The generated database name. */
  name: string;
  /** DROP the database. Safe to call twice. */
  drop: () => Promise<void>;
}

function maintenanceUrl(base: string): string {
  const u = new URL(base);
  u.pathname = '/postgres';
  return u.toString();
}

export async function createEphemeralDb(tag: string): Promise<EphemeralDb> {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL must be set to create an ephemeral database');
  const name = `repos_t_${tag.replace(/[^a-z0-9]/gi, '').toLowerCase()}_${randomUUID().slice(0, 8)}`;
  const admin = new pg.Client({ connectionString: maintenanceUrl(base), connectionTimeoutMillis: 5_000 });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  const u = new URL(base);
  u.pathname = `/${name}`;
  const url = u.toString();

  let dropped = false;
  const drop = async (): Promise<void> => {
    if (dropped) return;
    dropped = true;
    const a = new pg.Client({ connectionString: maintenanceUrl(base), connectionTimeoutMillis: 5_000 });
    await a.connect();
    try {
      await a.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [name],
      );
      await a.query(`DROP DATABASE IF EXISTS ${name}`);
    } finally {
      await a.end();
    }
  };

  return { url, name, drop };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/db/ephemeral-db.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Confirm nothing else broke**

Run: `cd /var/home/jason/Projects/RepOS/api && npm run build && npm test`
Expected: build clean; the existing suite passes exactly as it did before this task.

- [ ] **Step 7: Commit**

```bash
cd /var/home/jason/Projects/RepOS && git add api/src/db/runMigrations.ts api/src/db/migrate.ts api/tests/helpers/ephemeral-db.ts api/tests/db/ephemeral-db.test.ts
git commit -m "$(cat <<'EOF'
refactor(w9): make the migration runner importable + add ephemeral-DB harness

Migration 080's admin-guarantee data step (Q35) and the cohort-cap tests
(Q12/Q18) assert on whole-table state, which the shared dev database cannot
provide. Extract runMigrations() out of the migrate.ts top-level script and
add a per-test-file throwaway database helper. dist/db/migrate.js keeps its
path so run-restore.sh and the Dockerfile are untouched.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Migration 080 — role, status, and the admin guarantee

**Files:**
- Create: `api/src/constants/users.ts`
- Create: `api/src/db/migrations/080_users_roles_status.sql`
- Test: `api/tests/db/migration-080.test.ts`

**Interfaces:**
- Consumes: `runMigrations`, `createEphemeralDb` (Task 1).
- Produces:
  - `FOUNDING_ADMIN_EMAIL = 'jason.meyer1@gmail.com'`, `COHORT_CAP = 10`
  - `type UserStatus = 'invited' | 'active' | 'suspended' | 'deleting'`
  - `type UserRole = 'member' | 'admin'`
  - `users` columns: `role`, `status`, `invited_by`, `invited_at`, `activated_at`, `cf_synced_at`, `invite_sent_at`, `invite_message_id`.

- [ ] **Step 1: Write the failing test**

Create `api/tests/db/migration-080.test.ts`:

```ts
// Q35 — every schema-entry path must yield exactly one active admin, with no
// Cloudflare dependency. Round-6 review finding 1: a genuinely EMPTY database
// has nothing to promote, so clause (3) inserts the founding row.
import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import pg from 'pg';
import { createEphemeralDb } from '../helpers/ephemeral-db.js';
import { unwindToPreW9 } from '../helpers/migration-unwind.js';
import { runMigrations } from '../../src/db/runMigrations.js';
import { FOUNDING_ADMIN_EMAIL } from '../../src/constants/users.js';

const cleanups: Array<() => Promise<void>> = [];
afterAll(async () => { for (const c of cleanups) await c(); });

async function freshPool(tag: string): Promise<pg.Pool> {
  const eph = await createEphemeralDb(tag);
  const pool = new pg.Pool({ connectionString: eph.url, max: 3 });
  cleanups.push(async () => { await pool.end(); await eph.drop(); });
  return pool;
}

/**
 * Applies the FULL migration set — there is no partial runner. Callers that
 * need a pre-080 database follow this with the explicit unwind below (drop the
 * 080 columns and its _migrations row), which is what actually re-arms the
 * data step. Named for the state the caller is working toward, not for what
 * this call alone does.
 */
async function migrateTo079(pool: pg.Pool): Promise<void> {
  await runMigrations(pool);
}

// The unwind lives in tests/helpers/migration-unwind.ts so this file and the DR
// restore harness (Task 17) share ONE definition — a per-file copy is how 081
// and then 082 got left applied.

describe('migration 080 — schema', () => {
  it('adds every column with the documented defaults and CHECKs', async () => {
    const pool = await freshPool('m080cols');
    await runMigrations(pool);
    const { rows } = await pool.query<{ column_name: string; column_default: string | null; is_nullable: string }>(
      `SELECT column_name, column_default, is_nullable
         FROM information_schema.columns
        WHERE table_name='users'
          AND column_name IN ('role','status','invited_by','invited_at',
                              'activated_at','cf_synced_at','invite_sent_at','invite_message_id')`,
    );
    const byName = new Map(rows.map((r) => [r.column_name, r]));
    expect(byName.size).toBe(8);
    expect(byName.get('role')!.column_default).toContain("'member'");
    expect(byName.get('status')!.column_default).toContain("'active'");
    expect(byName.get('cf_synced_at')!.is_nullable).toBe('YES');

    const idx = await pool.query<{ n: number }>(
      `SELECT count(*)::int n FROM pg_indexes WHERE tablename='users' AND indexname='users_status_idx'`,
    );
    expect(idx.rows[0].n).toBe(1);
  });

  it('rejects an out-of-enum role and an out-of-enum status', async () => {
    const pool = await freshPool('m080check');
    await runMigrations(pool);
    await expect(
      pool.query(`INSERT INTO users (email, role) VALUES ('a@repos.test','superuser')`),
    ).rejects.toThrow();
    await expect(
      pool.query(`INSERT INTO users (email, status) VALUES ('b@repos.test','reinstating')`),
    ).rejects.toThrow();
  });

  it('is idempotent when the whole runner is re-invoked', async () => {
    const pool = await freshPool('m080idem');
    await runMigrations(pool);
    const second = await runMigrations(pool);
    expect(second).toEqual([]);
  });
});

describe('migration 080 — Q35 admin guarantee', () => {
  it('clause 3: INSERTs the founding admin into a genuinely empty database', async () => {
    const pool = await freshPool('m080empty');
    await runMigrations(pool);
    const { rows } = await pool.query<{ email: string; role: string; status: string; cf_synced_at: Date | null }>(
      `SELECT email, role, status, cf_synced_at FROM users WHERE role='admin' AND status='active'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe(FOUNDING_ADMIN_EMAIL);
    expect(rows[0].cf_synced_at).toBeNull();
  });

  it('clause 2: promotes an existing founding row rather than inserting a second', async () => {
    const pool = await freshPool('m080promote');
    await migrateTo079(pool);
    // Simulate a pre-080 dump: wipe what 080 just did, re-seed, re-apply.
    await unwindToPreW9(pool);
    await pool.query(`DROP INDEX IF EXISTS users_status_idx`);
    await pool.query(`INSERT INTO users (email) VALUES ($1), ('someone.else@repos.test')`, [FOUNDING_ADMIN_EMAIL]);

    await runMigrations(pool);

    const admins = await pool.query<{ email: string }>(
      `SELECT email FROM users WHERE role='admin' AND status='active'`,
    );
    expect(admins.rows.map((r) => r.email)).toEqual([FOUNDING_ADMIN_EMAIL]);
    const total = await pool.query<{ n: number }>(`SELECT count(*)::int n FROM users`);
    expect(total.rows[0].n).toBe(2); // promoted, not inserted
  });

  it('clause 3 on a populated dump: never promotes an arbitrary existing user', async () => {
    const pool = await freshPool('m080noarb');
    await migrateTo079(pool);
    await unwindToPreW9(pool);
    await pool.query(`DROP INDEX IF EXISTS users_status_idx`);
    await pool.query(`INSERT INTO users (email) VALUES ('beta.one@repos.test'), ('beta.two@repos.test')`);

    await runMigrations(pool);

    const admins = await pool.query<{ email: string }>(
      `SELECT email FROM users WHERE role='admin'`,
    );
    // Round-6: round-5's "promote the oldest active row" would have handed
    // admin to beta.one. The founding identity is inserted instead.
    expect(admins.rows.map((r) => r.email)).toEqual([FOUNDING_ADMIN_EMAIL]);
  });

  it('clause 1: no-ops when an active admin already exists — no second admin, no founding insert', async () => {
    const pool = await freshPool('m080noop');
    await runMigrations(pool);
    // Set up the state clause 1 exists for: an active admin who is NOT the
    // founding identity. The columns must already exist for that to be
    // expressible, so re-arm 080 by deleting its _migrations row — the
    // ADD COLUMN IF NOT EXISTS statements make re-application safe.
    await pool.query(`DELETE FROM users`);
    await pool.query(
      `INSERT INTO users (email, role, status) VALUES ('someone.promoted@repos.test','admin','active')`,
    );
    await pool.query(`DELETE FROM _migrations WHERE filename='080_users_roles_status.sql'`);

    const applied = await runMigrations(pool);
    expect(applied).toContain('080_users_roles_status.sql'); // the data step really ran

    const { rows } = await pool.query<{ email: string }>(
      `SELECT email FROM users WHERE role='admin' AND status='active' ORDER BY email`,
    );
    expect(rows.map((r) => r.email)).toEqual(['someone.promoted@repos.test']);
    const founding = await pool.query<{ n: number }>(
      `SELECT count(*)::int n FROM users WHERE lower(email)=$1`, [FOUNDING_ADMIN_EMAIL],
    );
    expect(founding.rows[0].n).toBe(0); // clause 3 must NOT have fired
  });

  it('pre-existing rows keep access — every legacy row becomes member/active', async () => {
    const pool = await freshPool('m080legacy');
    await migrateTo079(pool);
    await unwindToPreW9(pool);
    await pool.query(`DROP INDEX IF EXISTS users_status_idx`);
    await pool.query(`INSERT INTO users (email) VALUES ('legacy@repos.test')`);
    await runMigrations(pool);
    const { rows } = await pool.query<{ role: string; status: string }>(
      `SELECT role, status FROM users WHERE email='legacy@repos.test'`,
    );
    expect(rows[0]).toEqual({ role: 'member', status: 'active' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/db/migration-080.test.ts`
Expected: FAIL — `Cannot find module '../../src/constants/users.js'`

- [ ] **Step 3: Write the constants module**

Create `api/src/constants/users.ts`:

```ts
// W9 — user-management constants shared by the migration's TypeScript-side
// tests, the lifecycle service, and the reconciliation script.

/**
 * Q35 — the identity migration 080 guarantees admin for. Deliberately a
 * constant and not an env var: a BOOTSTRAP_ADMIN_EMAIL env var would
 * reintroduce exactly the redeploy-coupled config W9 removes (Q11).
 * Keep in sync with the literal inside 080_users_roles_status.sql.
 */
export const FOUNDING_ADMIN_EMAIL = 'jason.meyer1@gmail.com';

/**
 * Q12 — the G14 cohort cap, enforced in code rather than left as prose.
 * The counted set is status IN ('active','invited','deleting'): a `deleting`
 * row has not released its slot until the cascade completes.
 */
export const COHORT_CAP = 10;

export const COUNTED_STATUSES = ['active', 'invited', 'deleting'] as const;

export type UserStatus = 'invited' | 'active' | 'suspended' | 'deleting';
export type UserRole = 'member' | 'admin';
```

- [ ] **Step 4: Write the migration**

Create `api/src/db/migrations/080_users_roles_status.sql`:

```sql
-- Beta W9 — user management + invites.
-- Numbering: W7 reserved 070–079; W9 claims 080–089. Only 080 is used.
--
-- Replaces two redeploy-coupled env vars with columns:
--   CF_ACCESS_ALLOWED_EMAILS -> users.status   (Q4)
--   REPOS_ADMIN_EMAILS       -> users.role     (Q3)
--
-- The comment at cfAccess.ts:265 claimed "Migration 063 reserves users.role".
-- It never existed (migrations run 060-062 then jump to 070). This builds it.
--
-- Defaults are chosen so the ALTER is safe on its own: every pre-existing row
-- becomes member/active, preserving access for everyone who already has a row.
-- IF NOT EXISTS on each ADD COLUMN keeps a partially-applied run re-runnable.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role   TEXT NOT NULL DEFAULT 'member'
    CHECK (role IN ('member','admin')),
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('invited','active','suspended','deleting')),
  -- ON DELETE SET NULL, not CASCADE: deleting the inviter must never cascade
  -- into the people they invited.
  ADD COLUMN IF NOT EXISTS invited_by        UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invited_at        TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS activated_at      TIMESTAMPTZ NULL,
  -- Q24: "this row's intent is reflected in the CF policy." NULL means sync
  -- state UNKNOWN, not divergent (Q36).
  ADD COLUMN IF NOT EXISTS cf_synced_at      TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS invite_sent_at    TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS invite_message_id TEXT NULL;

-- The gate reads by email; the admin list and the cohort count read by status.
CREATE INDEX IF NOT EXISTS users_status_idx ON users (status);

-- Q35 — guarantee an active admin exists, WITHOUT consulting Cloudflare.
--
-- Runs once, when 080 is applied (_migrations is filename-tracked, see
-- runMigrations.ts) — a one-shot conditional evaluated against the database
-- state at apply time, not a continuously-enforced invariant.
--
-- Why here and not in the cutover script: run-restore.sh runs migrations and
-- nothing else. Restoring a pre-080 dump would default everyone to
-- member/active and leave ZERO admins, while the API sits in maintenance mode
-- that only an admin can clear, and step 6 of that script revokes every
-- device_token. Total lockout, recoverable only by break-glass SQL.
--
-- Resolution order is fixed:
--   (1) an active admin already exists            -> no-op
--   (2) a row matching the founding email exists  -> promote it
--   (3) otherwise                                 -> INSERT the founding row
--
-- Clause (3) exists because migration 001 creates no rows: a genuinely empty
-- database has nothing to promote (round-6 review finding 1). It never
-- promotes an arbitrary existing user — on a dump lacking the founding email,
-- "promote the oldest row" would hand admin to a random Beta user.
DO $$
DECLARE
  founding_email CONSTANT TEXT := 'jason.meyer1@gmail.com';
  target_id UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE role = 'admin' AND status = 'active') THEN
    RETURN;
  END IF;

  SELECT id INTO target_id FROM users WHERE lower(email) = founding_email;

  IF target_id IS NOT NULL THEN
    UPDATE users SET role = 'admin', status = 'active' WHERE id = target_id;
  ELSE
    -- cf_synced_at stays NULL: this row's CF membership is unknown until the
    -- reconciliation script (Q31) reads the live policy.
    INSERT INTO users (email, role, status) VALUES (founding_email, 'admin', 'active');
  END IF;
END $$;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/db/migration-080.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Apply to the dev database and confirm the whole suite still passes**

Run: `cd /var/home/jason/Projects/RepOS/api && npm run migrate && npm test`
Expected: `✓ 080_users_roles_status.sql`; existing suite green (every fixture user defaults to `member`/`active`, so no gate behavior changes yet).

- [ ] **Step 7: Commit**

```bash
cd /var/home/jason/Projects/RepOS && git add api/src/constants/users.ts api/src/db/migrations/080_users_roles_status.sql api/tests/db/migration-080.test.ts
git commit -m "$(cat <<'EOF'
feat(w9): migration 080 — users.role, users.status, and the admin guarantee

Adds the eight lifecycle columns and users_status_idx. The data step (Q35)
guarantees an active admin on every schema-entry path — fresh deploy, cutover,
and pre-080 restore — with no Cloudflare dependency: no-op if one exists,
promote the founding row if present, otherwise insert it. Clause (3) covers a
genuinely empty database, which has nothing to promote.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Account-event kinds and the discriminated actor shape

**Files:**
- Modify: `api/src/services/accountEvents.ts:4-15`
- Test: `api/tests/services/account-event-actor.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type EventActor = { actor_kind: 'user'; actor_user_id: string; actor_email: string } | { actor_kind: 'system'; actor_name: string; source: 'cutover' | 'restore' }`
  - `humanActor(userId: string, email: string): EventActor`
  - `systemActor(name: string, source: 'cutover' | 'restore'): EventActor`
  - `AccountEventKind` extended with `user_invited | user_activated | user_suspended | user_reinstated | role_changed | user_delete_requested | user_deleted | user_imported`

- [ ] **Step 1: Write the failing test**

Create `api/tests/services/account-event-actor.test.ts`:

```ts
// Q23 — audit rows carry both actor and target. user_id is ALWAYS the target
// (so the event lands in that user's AccountEventsTimeline); the actor lives
// in meta under a discriminated shape. Round 7 unified three competing
// formats into these two.
import { describe, it, expect } from 'vitest';
import { humanActor, systemActor } from '../../src/services/accountEvents.js';

describe('event actor shapes (Q23)', () => {
  it('human actor carries kind, id and email — and nothing else', () => {
    const a = humanActor('11111111-1111-1111-1111-111111111111', 'admin@repos.test');
    expect(a).toEqual({
      actor_kind: 'user',
      actor_user_id: '11111111-1111-1111-1111-111111111111',
      actor_email: 'admin@repos.test',
    });
  });

  it('system actor carries kind, name and the run source', () => {
    expect(systemActor('cf_reconciliation', 'restore')).toEqual({
      actor_kind: 'system',
      actor_name: 'cf_reconciliation',
      source: 'restore',
    });
  });

  it('the two shapes never mix — a system actor has no actor_user_id', () => {
    const s = systemActor('cf_reconciliation', 'cutover') as Record<string, unknown>;
    expect(s.actor_user_id).toBeUndefined();
    expect(s.actor_email).toBeUndefined();
    const h = humanActor('x', 'y@z.test') as Record<string, unknown>;
    expect(h.actor_name).toBeUndefined();
    expect(h.source).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/services/account-event-actor.test.ts`
Expected: FAIL — `humanActor is not a function`

- [ ] **Step 3: Extend the service**

In `api/src/services/accountEvents.ts`, replace lines 4–7 (the `AccountEventKind` union) with:

```ts
export type AccountEventKind =
  | 'profile_changed' | 'token_minted' | 'token_revoked' | 'signout_everywhere' | 'delete_initiated'
  | 'par_q_acknowledged' | 'onboarding_completed'
  | 'restore_replayed'
  // W9 lifecycle kinds. No migration needed: account_events.kind has no CHECK
  // constraint by design (C-ACCOUNT-EVENTS-ENUM) — new kinds extend this union.
  | 'user_invited' | 'user_activated' | 'user_suspended' | 'user_reinstated'
  | 'role_changed' | 'user_delete_requested' | 'user_deleted'
  // Q31b — distinct from user_invited because no invitation was actually sent;
  // the identity was granted out of band and imported from the CF policy.
  | 'user_imported';

/**
 * Q23 — the discriminated actor recorded in account_events.meta. Every W9
 * lifecycle event carries exactly ONE of these shapes, never a partial or a
 * mix. `meta` is intentionally permissive (see 060_account_events.sql) so this
 * needs no migration.
 */
export type EventActor =
  | { actor_kind: 'user'; actor_user_id: string; actor_email: string }
  | { actor_kind: 'system'; actor_name: string; source: 'cutover' | 'restore' };

/** A real admin (or the user themselves, for user_activated) took the action. */
export function humanActor(userId: string, email: string): EventActor {
  return { actor_kind: 'user', actor_user_id: userId, actor_email: email };
}

/**
 * The reconciliation script took the action. `source` keeps the run's origin
 * accurate: the same code path runs at cutover and inside run-restore.sh, and
 * a hard-coded 'system:cutover' would simply lie in the restore case.
 */
export function systemActor(
  actor_name: string,
  source: 'cutover' | 'restore',
): EventActor {
  return { actor_kind: 'system', actor_name, source };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/services/account-event-actor.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
cd /var/home/jason/Projects/RepOS && git add api/src/services/accountEvents.ts api/tests/services/account-event-actor.test.ts
git commit -m "$(cat <<'EOF'
feat(w9): add lifecycle event kinds + the discriminated actor shape (Q23)

Eight new AccountEventKind values and the human/system actor discriminator.
No migration: account_events.kind has no CHECK constraint by design and meta
is permissive. The system shape carries `source` so a reconciliation run
during a restore is not mislabelled as the cutover.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: The membership lock

Every membership transition — invite, reinstate, suspend, delete (Q26) — serializes on one session-level advisory lock held on a **dedicated pooled connection with no open transaction**, because the Cloudflare round-trip happens inside the critical section and Q7 forbids an HTTP call inside a DB transaction. `pg_advisory_xact_lock` is the wrong primitive: it releases at commit, so it serializes nothing once the transaction closes.

**Files:**
- Create: `api/src/services/membershipLock.ts`
- Test: `api/tests/services/membership-lock.test.ts`

**Interfaces:**
- Consumes: `db` from `api/src/db/client.js`.
- Produces:
  - `MEMBERSHIP_LOCK_KEY: number`
  - `ADMIN_COUNT_LOCK_KEY: number`
  - `class LockTimeoutError extends Error { code: 'lock_timeout' }`
  - `withMembershipLock<T>(fn: () => Promise<T>, opts?: { timeoutMs?: number }): Promise<T>`

- [ ] **Step 1: Write the failing test**

Create `api/tests/services/membership-lock.test.ts`:

```ts
// Q16 + Q38 — a session-scoped advisory lock on a dedicated pooled connection,
// released in a finally on EVERY path including throw and timeout.
import 'dotenv/config';
import { describe, it, expect } from 'vitest';
import { db } from '../../src/db/client.js';
import {
  withMembershipLock,
  LockTimeoutError,
  MEMBERSHIP_LOCK_KEY,
} from '../../src/services/membershipLock.js';

async function heldLockCount(): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int n FROM pg_locks
      WHERE locktype='advisory' AND objid=$1 AND granted`,
    [MEMBERSHIP_LOCK_KEY],
  );
  return rows[0].n;
}

describe('withMembershipLock', () => {
  it('serializes two concurrent critical sections', async () => {
    const order: string[] = [];
    const slow = withMembershipLock(async () => {
      order.push('a:enter');
      await new Promise((r) => setTimeout(r, 150));
      order.push('a:exit');
    });
    // Give A time to actually acquire before B contends.
    await new Promise((r) => setTimeout(r, 30));
    const fast = withMembershipLock(async () => {
      order.push('b:enter');
      order.push('b:exit');
    });
    await Promise.all([slow, fast]);
    expect(order).toEqual(['a:enter', 'a:exit', 'b:enter', 'b:exit']);
  });

  it('runs OUTSIDE any transaction — the critical section sees no open txn', async () => {
    const inTxn = await withMembershipLock(async () => {
      const { rows } = await db.query<{ t: string }>(`SELECT txid_current_if_assigned()::text t`);
      return rows[0].t;
    });
    expect(inTxn).toBeNull();
  });

  it('releases the lock when the body throws', async () => {
    await expect(
      withMembershipLock(async () => { throw new Error('boom'); }),
    ).rejects.toThrow('boom');
    expect(await heldLockCount()).toBe(0);
  });

  it('releases the lock on the happy path', async () => {
    await withMembershipLock(async () => 'ok');
    expect(await heldLockCount()).toBe(0);
  });

  it('fails fast with LockTimeoutError rather than blocking the pool', async () => {
    let release!: () => void;
    const holder = withMembershipLock(async () => {
      await new Promise<void>((r) => { release = r; });
    });
    await new Promise((r) => setTimeout(r, 30));
    await expect(
      withMembershipLock(async () => 'never', { timeoutMs: 100 }),
    ).rejects.toBeInstanceOf(LockTimeoutError);
    release();
    await holder;
    expect(await heldLockCount()).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/services/membership-lock.test.ts`
Expected: FAIL — `Cannot find module '../../src/services/membershipLock.js'`

- [ ] **Step 3: Write the implementation**

Create `api/src/services/membershipLock.ts`:

```ts
import { db } from '../db/client.js';

/**
 * Q16 — serialization for every transition that affects cohort membership.
 *
 * Session-level (pg_advisory_lock), NOT transaction-level. pg_advisory_xact_lock
 * releases at COMMIT, so it would serialize nothing once the transaction closes
 * — and keeping a transaction open across the Cloudflare HTTP call is exactly
 * what Q7 forbids. A session lock holds across statements without a transaction.
 *
 * Crash safety is free: session end releases the lock (Q16).
 *
 * Arbitrary but stable key: 0x5245504f == 'REPO'.
 */
export const MEMBERSHIP_LOCK_KEY = 0x5245504f;

/**
 * Q26 — role changes and last-admin checks additionally take a
 * TRANSACTION-level lock covering the count-and-mutate, because those are
 * read-then-write and race exactly like the cohort cap did.
 *
 * Lock order is fixed and single: session mutation lock -> BEGIN -> this.
 * 0x41444d4e == 'ADMN'.
 */
export const ADMIN_COUNT_LOCK_KEY = 0x41444d4e;

export class LockTimeoutError extends Error {
  readonly code = 'lock_timeout';
  constructor(message = 'membership lock acquisition timed out') {
    super(message);
    this.name = 'LockTimeoutError';
  }
}

const DEFAULT_TIMEOUT_MS = 5_000;
const POLL_MS = 25;

/**
 * Run `fn` while holding the global membership lock.
 *
 * Acquisition is bounded (Q16) so a wedged holder fails fast with 503 instead
 * of blocking the pool. Both the lock and its pooled connection are released
 * in a `finally` on every path — happy, throw, and timeout (Q38). `db` is a
 * Pool with max:20, so one held connection is acceptable at Beta volume, and
 * statement_timeout:5000 is per-statement so it never fires on an idle held
 * connection.
 *
 * We poll pg_try_advisory_lock rather than blocking in pg_advisory_lock
 * because a blocking acquire would sit inside a single statement and be killed
 * by statement_timeout with no way to distinguish it from a real failure.
 */
export async function withMembershipLock<T>(
  fn: () => Promise<T>,
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  const deadline = Date.now() + (opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const client = await db.connect();
  let held = false;
  try {
    for (;;) {
      const { rows } = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock($1) AS locked',
        [MEMBERSHIP_LOCK_KEY],
      );
      if (rows[0].locked) { held = true; break; }
      if (Date.now() >= deadline) throw new LockTimeoutError();
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    return await fn();
  } finally {
    if (held) {
      await client
        .query('SELECT pg_advisory_unlock($1)', [MEMBERSHIP_LOCK_KEY])
        .catch(() => { /* connection already dead — session end released it */ });
    }
    client.release();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/services/membership-lock.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
cd /var/home/jason/Projects/RepOS && git add api/src/services/membershipLock.ts api/tests/services/membership-lock.test.ts
git commit -m "$(cat <<'EOF'
feat(w9): session-scoped membership lock with bounded acquisition (Q16, Q38)

pg_advisory_lock on a dedicated pooled connection with no open transaction,
so the Cloudflare round-trip in the critical section never sits inside a DB
transaction. Acquisition is bounded so a wedged holder fails fast; the lock
and the connection are released in a finally on every path.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Cloudflare Access policy client

> **SHIPPED** as `8ea91c0`, hardened by `601e3ba` and `33e073c`. `api/src/services/cfAccessPolicy.ts` is authoritative; the code below is kept in sync with it. Two corruption paths were found in review *after* the first commit and are now encoded here — do not re-derive this module from an older revision of this plan.

The fail-closed layer. Every refusal here surfaces as drift rather than a silent partial write.

**Two rules this module exists to enforce, both learned the hard way:**

1. **Validate, never default.** Coercing an absent field to a plausible value (`[]`, `'allow'`, `''`) makes a truncated-but-2xx response degrade *identically on both reads*, so the Q19 compare passes and the PUT writes the degraded values back — stripping `exclude[]`/`require[]` and rewriting the name and decision.
2. **Echo the whole writable config back.** Verified against the Cloudflare OpenAPI spec on 2026-07-27: the reusable-policy PUT accepts **thirteen** writable properties and is a **full replace**. Sending only `name`/`decision`/`include`/`exclude`/`require` silently reset `session_duration`, `approval_required`, `approval_groups`, `mfa_config`, `isolation_required`, `connection_rules` and both `purpose_justification_*` fields — on *every* membership change, not just when a dashboard edit raced us.

**Files:**
- Create: `api/src/services/cfAccessPolicy.ts`
- Test: `api/tests/services/cf-access-policy.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `interface CfPolicySnapshot { emails: string[]; name: string; decision: string; config: Record<string, unknown> }`
    `config` holds every writable field **exactly as returned** — nothing defaulted, absent keys left absent. It is both what the PUT echoes back and what the Q19 fingerprint covers. There are deliberately no top-level `exclude`/`require` fields: two sources of truth for the same data is what let the fingerprint drift from the payload.
  - `class CfPolicyError extends Error { code: CfPolicyErrorCode }`
  - `type CfPolicyErrorCode = 'cf_not_configured' | 'cf_http_error' | 'cf_timeout' | 'app_count_not_one' | 'non_email_selector' | 'malformed_policy' | 'policy_changed'`
  - `fetchPolicy(): Promise<CfPolicySnapshot>`
  - `putPolicyEmails(desiredEmails: string[], snapshot: CfPolicySnapshot): Promise<void>`
  - `__setFetchForTesting(f: typeof fetch | null): void`

- [ ] **Step 1: Write the failing test**

Create `api/tests/services/cf-access-policy.test.ts`:

```ts
// Q10, Q19, Q22, Q38 — the fail-closed Cloudflare policy client.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  fetchPolicy,
  putPolicyEmails,
  CfPolicyError,
  __setFetchForTesting,
} from '../../src/services/cfAccessPolicy.js';

const ACCOUNT = '400d0b4a35d63a32b86ab774b9feb4ab';
const POLICY = 'b4a92a15-27d5-477b-ad36-f78fcdae931c';

function policyResult(over: Record<string, unknown> = {}) {
  return {
    success: true,
    errors: [],
    result: {
      id: POLICY,
      name: 'Owner Only',
      decision: 'allow',
      app_count: 1,
      include: [
        { email: { email: 'a@repos.test' } },
        { email: { email: 'b@repos.test' } },
      ],
      exclude: [],
      require: [],
      ...over,
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

let calls: Array<{ url: string; init: RequestInit }>;
// Queue entries receive the request's AbortSignal so a response can model a
// body that stalls until the deadline fires (see the stalled-body test).
let queue: Array<(signal?: AbortSignal | null) => Promise<Response>>;

beforeEach(() => {
  process.env.CF_API_TOKEN = 'test-token';
  process.env.CF_ACCOUNT_ID = ACCOUNT;
  process.env.CF_ACCESS_POLICY_ID = POLICY;
  calls = [];
  queue = [];
  __setFetchForTesting(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    const next = queue.shift();
    if (!next) throw new Error(`unexpected fetch: ${String(input)}`);
    // The double MUST honour init.signal the way a real fetch does. A double
    // that ignores it makes the Q38 deadline test pass vacuously: the abort
    // fires, nothing observes it, and the slow response resolves normally —
    // so the assertion would be testing nothing.
    return abortable(next(init.signal), init.signal);
  });
});

/** Reject with an AbortError as soon as `signal` aborts. */
function abortable(p: Promise<Response>, signal?: AbortSignal | null): Promise<Response> {
  if (!signal) return p;
  return Promise.race([
    p,
    new Promise<Response>((_, reject) => {
      const fail = () =>
        reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
      if (signal.aborted) fail();
      else signal.addEventListener('abort', fail, { once: true });
    }),
  ]);
}

afterEach(() => {
  __setFetchForTesting(null);
  delete process.env.CF_API_TOKEN;
  delete process.env.CF_ACCOUNT_ID;
  delete process.env.CF_ACCESS_POLICY_ID;
});

describe('fetchPolicy', () => {
  it('returns the email set and hits the account-scoped policy URL', async () => {
    queue.push(async () => jsonResponse(policyResult()));
    const snap = await fetchPolicy();
    expect(snap.emails).toEqual(['a@repos.test', 'b@repos.test']);
    expect(calls[0].url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/access/policies/${POLICY}`,
    );
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
  });

  it('Q10: refuses when app_count !== 1', async () => {
    queue.push(async () => jsonResponse(policyResult({ app_count: 2 })));
    await expect(fetchPolicy()).rejects.toMatchObject({ code: 'app_count_not_one' });
  });

  it('Q10: refuses when app_count is absent — fail closed, never assume 1', async () => {
    const r = policyResult();
    delete (r.result as Record<string, unknown>).app_count;
    queue.push(async () => jsonResponse(r));
    await expect(fetchPolicy()).rejects.toMatchObject({ code: 'app_count_not_one' });
  });

  it('Q22: refuses an `everyone` selector rather than preserving it', async () => {
    queue.push(async () => jsonResponse(policyResult({ include: [{ everyone: {} }] })));
    await expect(fetchPolicy()).rejects.toMatchObject({ code: 'non_email_selector' });
  });

  it('Q22: refuses email_domain, group and service_token selectors', async () => {
    for (const bad of [{ email_domain: { domain: 'repos.test' } }, { group: { id: 'g' } }, { service_token: { token_id: 't' } }]) {
      queue.push(async () => jsonResponse(policyResult({ include: [bad] })));
      await expect(fetchPolicy()).rejects.toMatchObject({ code: 'non_email_selector' });
    }
  });

  it('surfaces a non-2xx as cf_http_error', async () => {
    queue.push(async () => jsonResponse({ success: false, errors: [{ message: 'bad token' }] }, 403));
    await expect(fetchPolicy()).rejects.toMatchObject({ code: 'cf_http_error' });
  });

  it('throws cf_not_configured when CF_API_TOKEN is unset', async () => {
    delete process.env.CF_API_TOKEN;
    await expect(fetchPolicy()).rejects.toMatchObject({ code: 'cf_not_configured' });
  });

  it('Q38: aborts on deadline and reports cf_timeout', async () => {
    queue.push(async () => { await new Promise((r) => setTimeout(r, 200)); return jsonResponse(policyResult()); });
    await expect(fetchPolicy({ timeoutMs: 40 })).rejects.toMatchObject({ code: 'cf_timeout' });
  });

  it('Q38: the deadline covers the RESPONSE BODY, not just the headers', async () => {
    // Round-7 finding: clearing the abort timer once headers arrive would let a
    // stalled body hold the pooled connection AND the global membership lock
    // indefinitely — exactly what the deadline exists to prevent. Headers here
    // arrive immediately; the body never does.
    queue.push(async (signal) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          signal?.addEventListener(
            'abort',
            () => controller.error(Object.assign(new Error('aborted'), { name: 'AbortError' })),
            { once: true },
          );
          // deliberately never enqueue and never close
        },
      });
      return new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } });
    });
    await expect(fetchPolicy({ timeoutMs: 40 })).rejects.toMatchObject({ code: 'cf_timeout' });
  });
});

describe('putPolicyEmails', () => {
  it('re-fetches and compares immediately before PUT, then writes include[]', async () => {
    queue.push(async () => jsonResponse(policyResult()));                       // fetchPolicy
    queue.push(async () => jsonResponse(policyResult()));                       // pre-PUT re-fetch
    queue.push(async () => jsonResponse(policyResult({ include: [] })));        // the PUT
    const snap = await fetchPolicy();
    await putPolicyEmails(['a@repos.test', 'b@repos.test', 'c@repos.test'], snap);

    const put = calls[2];
    expect(put.init.method).toBe('PUT');
    const body = JSON.parse(String(put.init.body));
    expect(body.include).toEqual([
      { email: { email: 'a@repos.test' } },
      { email: { email: 'b@repos.test' } },
      { email: { email: 'c@repos.test' } },
    ]);
    // Q22: exclude[] and require[] are never touched — echoed back verbatim.
    expect(body.exclude).toEqual([]);
    expect(body.require).toEqual([]);
    expect(body.name).toBe('Owner Only');
    expect(body.decision).toBe('allow');
  });

  it('Q19: aborts when the dashboard changed the policy between GET and PUT', async () => {
    queue.push(async () => jsonResponse(policyResult()));                                          // fetchPolicy
    queue.push(async () => jsonResponse(policyResult({                                             // re-fetch: changed!
      include: [{ email: { email: 'a@repos.test' } }, { email: { email: 'intruder@repos.test' } }],
    })));
    const snap = await fetchPolicy();
    await expect(
      putPolicyEmails(['a@repos.test', 'b@repos.test', 'c@repos.test'], snap),
    ).rejects.toMatchObject({ code: 'policy_changed' });
    expect(calls).toHaveLength(2); // no PUT was issued
  });

  it('Q19: aborts on a decision flip, even though include[] is untouched', async () => {
    // We echo `decision` back from the fresh read, so a compare that only
    // looked at emails would silently re-write a policy a human just changed.
    queue.push(async () => jsonResponse(policyResult()));
    queue.push(async () => jsonResponse(policyResult({ decision: 'deny' })));
    const snap = await fetchPolicy();
    await expect(putPolicyEmails(['a@repos.test'], snap)).rejects.toMatchObject({
      code: 'policy_changed',
    });
    expect(calls).toHaveLength(2);
  });

  it('Q19: aborts on a rename', async () => {
    queue.push(async () => jsonResponse(policyResult()));
    queue.push(async () => jsonResponse(policyResult({ name: 'Owner Only (edited)' })));
    const snap = await fetchPolicy();
    await expect(putPolicyEmails(['a@repos.test'], snap)).rejects.toMatchObject({
      code: 'policy_changed',
    });
  });

  it('Q19: aborts on a new exclude[] rule', async () => {
    queue.push(async () => jsonResponse(policyResult()));
    queue.push(async () => jsonResponse(policyResult({ exclude: [{ email: { email: 'banned@repos.test' } }] })));
    const snap = await fetchPolicy();
    await expect(putPolicyEmails(['a@repos.test'], snap)).rejects.toMatchObject({
      code: 'policy_changed',
    });
  });

  it('Q19: aborts on a new require[] rule', async () => {
    queue.push(async () => jsonResponse(policyResult()));
    queue.push(async () => jsonResponse(policyResult({ require: [{ email_domain: { domain: 'repos.test' } }] })));
    const snap = await fetchPolicy();
    await expect(putPolicyEmails(['a@repos.test'], snap)).rejects.toMatchObject({
      code: 'policy_changed',
    });
  });

  it('Q10/Q22 are re-asserted on the pre-PUT re-fetch, not just the first read', async () => {
    queue.push(async () => jsonResponse(policyResult()));
    queue.push(async () => jsonResponse(policyResult({ app_count: 3 })));
    const snap = await fetchPolicy();
    await expect(putPolicyEmails(['a@repos.test'], snap)).rejects.toMatchObject({
      code: 'app_count_not_one',
    });
    expect(calls).toHaveLength(2);
  });
});

describe('CfPolicyError', () => {
  it('is the error type every refusal uses', async () => {
    queue.push(async () => jsonResponse(policyResult({ app_count: 9 })));
    await expect(fetchPolicy()).rejects.toBeInstanceOf(CfPolicyError);
  });
});

// A 2xx response is not the same thing as a well-formed one. Defaulting an
// absent field to a plausible value ([], 'allow', '') makes BOTH reads degrade
// identically, so the Q19 compare passes and the PUT then writes the degraded
// values back — stripping exclude[]/require[] and rewriting name and decision.
describe('malformed policy responses fail closed rather than defaulting', () => {
  it('refuses a result carrying only app_count and name', async () => {
    queue.push(async () => jsonResponse({
      success: true, errors: [], result: { app_count: 1, name: 'Owner Only' },
    }));
    await expect(fetchPolicy()).rejects.toMatchObject({ code: 'malformed_policy' });
  });

  it('refuses a missing include[] instead of treating it as empty', async () => {
    const r = policyResult();
    delete (r.result as Record<string, unknown>).include;
    queue.push(async () => jsonResponse(r));
    await expect(fetchPolicy()).rejects.toMatchObject({ code: 'malformed_policy' });
  });

  it('refuses a missing decision instead of assuming allow', async () => {
    const r = policyResult();
    delete (r.result as Record<string, unknown>).decision;
    queue.push(async () => jsonResponse(r));
    await expect(fetchPolicy()).rejects.toMatchObject({ code: 'malformed_policy' });
  });

  it('refuses a missing name instead of blanking it', async () => {
    const r = policyResult();
    delete (r.result as Record<string, unknown>).name;
    queue.push(async () => jsonResponse(r));
    await expect(fetchPolicy()).rejects.toMatchObject({ code: 'malformed_policy' });
  });

  it('refuses a non-array exclude[]', async () => {
    queue.push(async () => jsonResponse(policyResult({ exclude: 'nope' })));
    await expect(fetchPolicy()).rejects.toMatchObject({ code: 'malformed_policy' });
  });

  // Every one of these threw a raw TypeError before. That matters beyond
  // tidiness: callers map CfPolicyError.code onto a sync_error and render it as
  // drift, so an unclassified throw escapes that path and becomes a 500.
  it('refuses a null result rather than throwing TypeError', async () => {
    queue.push(async () => jsonResponse({ success: true, errors: [], result: null }));
    const err = await fetchPolicy().catch((e) => e);
    expect(err).toBeInstanceOf(CfPolicyError);
    expect(err.code).toBe('malformed_policy');
  });

  it('refuses a non-object result rather than reporting app_count_not_one', async () => {
    queue.push(async () => jsonResponse({ success: true, errors: [], result: 'nope' }));
    await expect(fetchPolicy()).rejects.toMatchObject({ code: 'malformed_policy' });
  });

  it('refuses an array result', async () => {
    queue.push(async () => jsonResponse({ success: true, errors: [], result: [] }));
    await expect(fetchPolicy()).rejects.toMatchObject({ code: 'malformed_policy' });
  });

  it('refuses a null envelope rather than throwing TypeError', async () => {
    queue.push(async () => jsonResponse(null));
    const err = await fetchPolicy().catch((e) => e);
    expect(err).toBeInstanceOf(CfPolicyError);
    expect(err.code).toBe('cf_http_error');
  });

  it('refuses a null include[] entry rather than throwing TypeError', async () => {
    queue.push(async () => jsonResponse(policyResult({ include: [null] })));
    const err = await fetchPolicy().catch((e) => e);
    expect(err).toBeInstanceOf(CfPolicyError);
    expect(err.code).toBe('malformed_policy');
  });

  it('refuses a scalar include[] entry', async () => {
    queue.push(async () => jsonResponse(policyResult({ include: ['a@repos.test'] })));
    await expect(fetchPolicy()).rejects.toMatchObject({ code: 'malformed_policy' });
  });

  it('still reports a null nested email object as a non-email selector', async () => {
    queue.push(async () => jsonResponse(policyResult({ include: [{ email: null }] })));
    await expect(fetchPolicy()).rejects.toMatchObject({ code: 'non_email_selector' });
  });

  it('no malformed shape ever escapes as something other than CfPolicyError', async () => {
    const shapes: unknown[] = [
      null,
      { success: true, errors: [], result: null },
      { success: true, errors: [], result: [] },
      { success: true, errors: [], result: 42 },
      policyResult({ include: [null] }),
      policyResult({ include: [[]] }),
      policyResult({ include: [{ email: 'flat@repos.test' }] }),
      policyResult({ exclude: null }),
      policyResult({ require: 7 }),
    ];
    for (const body of shapes) {
      queue.push(async () => jsonResponse(body));
      const err = await fetchPolicy().catch((e) => e);
      expect(err, `shape ${JSON.stringify(body)?.slice(0, 60)}`).toBeInstanceOf(CfPolicyError);
    }
  });

  it('an absent optional field stays absent — the PUT never invents one', async () => {
    const withoutExclude = () => {
      const r = policyResult();
      delete (r.result as Record<string, unknown>).exclude;
      return r;
    };
    queue.push(async () => jsonResponse(withoutExclude()));
    queue.push(async () => jsonResponse(withoutExclude()));
    queue.push(async () => jsonResponse(policyResult()));
    const snap = await fetchPolicy();
    await putPolicyEmails(['a@repos.test'], snap);
    const body = JSON.parse(String(calls[2].init.body));
    expect('exclude' in body).toBe(false);
    expect('require' in body).toBe(true); // it WAS present, so it is echoed
  });
});

// The PUT is a full replace (Cloudflare OpenAPI, verified 2026-07-27: it
// accepts 13 writable properties). Anything not echoed back is reset to its
// default, so a membership change must not double as a reconfiguration.
describe('the whole writable policy is preserved and compared', () => {
  const configured = (over: Record<string, unknown> = {}) =>
    policyResult({
      session_duration: '24h',
      approval_required: true,
      approval_groups: [{ approvals_needed: 1, email_addresses: ['boss@repos.test'] }],
      isolation_required: false,
      purpose_justification_required: true,
      purpose_justification_prompt: 'Why do you need access?',
      mfa_config: { mode: 'required' },
      connection_rules: { ssh: { usernames: ['jason'] } },
      ...over,
    });

  it('echoes every writable field back on PUT, replacing only include[]', async () => {
    queue.push(async () => jsonResponse(configured()));
    queue.push(async () => jsonResponse(configured()));
    queue.push(async () => jsonResponse(policyResult()));
    const snap = await fetchPolicy();
    await putPolicyEmails(['a@repos.test'], snap);

    const body = JSON.parse(String(calls[2].init.body));
    expect(body.session_duration).toBe('24h');
    expect(body.approval_required).toBe(true);
    expect(body.approval_groups).toEqual([{ approvals_needed: 1, email_addresses: ['boss@repos.test'] }]);
    expect(body.isolation_required).toBe(false);
    expect(body.purpose_justification_required).toBe(true);
    expect(body.purpose_justification_prompt).toBe('Why do you need access?');
    expect(body.mfa_config).toEqual({ mode: 'required' });
    expect(body.connection_rules).toEqual({ ssh: { usernames: ['jason'] } });
    // ...and include[] IS replaced.
    expect(body.include).toEqual([{ email: { email: 'a@repos.test' } }]);
    // Read-only fields are never sent back.
    expect('app_count' in body).toBe(false);
    expect('id' in body).toBe(false);
  });

  it('Q19: aborts when session_duration changed between the reads', async () => {
    queue.push(async () => jsonResponse(configured()));
    queue.push(async () => jsonResponse(configured({ session_duration: '1h' })));
    const snap = await fetchPolicy();
    await expect(putPolicyEmails(['a@repos.test'], snap)).rejects.toMatchObject({
      code: 'policy_changed',
    });
    expect(calls).toHaveLength(2); // no PUT was issued
  });

  it('Q19: aborts when approval_required was turned off between the reads', async () => {
    queue.push(async () => jsonResponse(configured()));
    queue.push(async () => jsonResponse(configured({ approval_required: false })));
    const snap = await fetchPolicy();
    await expect(putPolicyEmails(['a@repos.test'], snap)).rejects.toMatchObject({
      code: 'policy_changed',
    });
  });

  it('Q19: aborts when mfa_config changed between the reads', async () => {
    queue.push(async () => jsonResponse(configured()));
    queue.push(async () => jsonResponse(configured({ mfa_config: { mode: 'optional' } })));
    const snap = await fetchPolicy();
    await expect(putPolicyEmails(['a@repos.test'], snap)).rejects.toMatchObject({
      code: 'policy_changed',
    });
  });

  it('key ORDER alone is not a change — the compare is canonical', async () => {
    queue.push(async () => jsonResponse(policyResult()));
    // Same content, different property order in the JSON body.
    queue.push(async () => jsonResponse({
      success: true,
      errors: [],
      result: {
        require: [], exclude: [], app_count: 1,
        include: [{ email: { email: 'a@repos.test' } }, { email: { email: 'b@repos.test' } }],
        decision: 'allow', name: 'Owner Only', id: POLICY,
      },
    }));
    queue.push(async () => jsonResponse(policyResult()));
    const snap = await fetchPolicy();
    await expect(putPolicyEmails(['a@repos.test'], snap)).resolves.toBeUndefined();
    expect(calls).toHaveLength(3); // the PUT DID happen
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/services/cf-access-policy.test.ts`
Expected: FAIL — `Cannot find module '../../src/services/cfAccessPolicy.js'`

- [ ] **Step 3: Write the implementation**

Create `api/src/services/cfAccessPolicy.ts`:

```ts
// W9 — the Cloudflare Access policy client. Every assertion here is
// fail-closed: a refusal surfaces as drift on /settings/users rather than a
// silent partial write (Q9).
//
// Scope: this module writes ONLY to the `Owner Only` policy identified by
// CF_ACCESS_POLICY_ID, and only its include[] array. exclude[] and require[]
// are echoed back verbatim, and the app's second policy (the post-deploy-smoke
// service token) is never touched (Q22).
//
// It deliberately makes NO session-revocation call (Q17a): that endpoint
// revokes access across ALL applications in the org — suspending a RepOS user
// would also sign them out of ha.jpmtech.com and jellyseerr.jpmtech.com — and
// it needs the account-level `Access: Organizations Revoke` permission that
// Q15's narrow-token goal exists to avoid.

export type CfPolicyErrorCode =
  | 'cf_not_configured'
  | 'cf_http_error'
  | 'cf_timeout'
  | 'app_count_not_one'
  | 'non_email_selector'
  | 'malformed_policy'
  | 'policy_changed';

/**
 * Every property the reusable-policy PUT accepts, verified against the
 * Cloudflare OpenAPI spec on 2026-07-27. `name`, `decision` and `include` are
 * required; the rest are optional but MEANINGFUL — the PUT is a full replace,
 * so any writable field we fail to echo back is reset to its default.
 *
 * Sending only name/decision/include/exclude/require, as this client
 * originally did, meant every suspend or invite silently cleared
 * session_duration, approval_required, mfa_config, isolation_required and the
 * purpose-justification settings. Membership changes must not reconfigure the
 * application.
 */
const POLICY_WRITABLE_FIELDS = [
  'name',
  'decision',
  'include',
  'exclude',
  'require',
  'approval_groups',
  'approval_required',
  'connection_rules',
  'isolation_required',
  'mfa_config',
  'purpose_justification_prompt',
  'purpose_justification_required',
  'session_duration',
] as const;

export class CfPolicyError extends Error {
  readonly code: CfPolicyErrorCode;
  readonly detail?: string;
  constructor(code: CfPolicyErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'CfPolicyError';
    this.code = code;
    this.detail = detail;
  }
}

export interface CfPolicySnapshot {
  /** include[] flattened to lowercase emails, in policy order. */
  emails: string[];
  name: string;
  decision: string;
  /**
   * Every writable field exactly as the API returned it — nothing defaulted,
   * nothing invented, absent keys left absent. This is both what gets echoed
   * back on PUT (Q22) and what the Q19 compare fingerprints, so "any
   * difference aborts" covers the whole policy rather than a hand-picked five.
   */
  config: Record<string, unknown>;
}

const DEFAULT_TIMEOUT_MS = 8_000;

/** typeof null === 'object' and arrays are objects — neither is a policy. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Injection seam so tests never reach the network. Production leaves this null
// and uses the global fetch.
let fetchImpl: typeof fetch | null = null;
export function __setFetchForTesting(f: typeof fetch | null): void {
  fetchImpl = f;
}
function doFetch(url: string, init: RequestInit): Promise<Response> {
  return (fetchImpl ?? fetch)(url, init);
}

function policyUrl(): string {
  const token = process.env.CF_API_TOKEN;
  const account = process.env.CF_ACCOUNT_ID;
  const policy = process.env.CF_ACCESS_POLICY_ID;
  if (!token || !account || !policy) {
    throw new CfPolicyError(
      'cf_not_configured',
      'CF_API_TOKEN, CF_ACCOUNT_ID and CF_ACCESS_POLICY_ID must all be set',
    );
  }
  return `https://api.cloudflare.com/client/v4/accounts/${account}/access/policies/${policy}`;
}

async function cfRequest(
  method: 'GET' | 'PUT',
  body: unknown,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const url = policyUrl(); // throws cf_not_configured before any I/O
  // Q38 — every external call carries a finite abort deadline. A hung request
  // would otherwise hold both the pooled connection and the global membership
  // lock indefinitely.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  // The deadline must cover the RESPONSE BODY, not just the headers. Clearing
  // the timer at headers-received would let a stalled body hold the pooled
  // connection and the global membership lock indefinitely — precisely the
  // failure this deadline exists to prevent. Hence one try/finally around
  // both the request and the body read.
  try {
    let res: Response;
    try {
      res = await doFetch(url, {
        method,
        signal: ac.signal,
        headers: {
          Authorization: `Bearer ${process.env.CF_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') {
        throw new CfPolicyError('cf_timeout', `Cloudflare ${method} timed out after ${timeoutMs}ms`);
      }
      throw new CfPolicyError('cf_http_error', `Cloudflare ${method} failed`, String(err));
    }

    let text: string;
    try {
      text = await res.text();
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') {
        throw new CfPolicyError(
          'cf_timeout',
          `Cloudflare ${method} body stalled past ${timeoutMs}ms`,
        );
      }
      throw new CfPolicyError('cf_http_error', `Cloudflare ${method} body read failed`, String(err));
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new CfPolicyError('cf_http_error', `Cloudflare ${method} returned non-JSON`, text.slice(0, 200));
    }
    // Validate before ANY property access. A raw TypeError escaping this module
    // is not merely untidy: callers map CfPolicyError.code onto a sync_error and
    // surface it as drift, so an unclassified throw becomes a 500 instead.
    if (!isPlainObject(parsed)) {
      throw new CfPolicyError(
        'cf_http_error',
        `Cloudflare ${method} returned a non-object envelope`,
        text.slice(0, 200),
      );
    }
    if (!res.ok || parsed.success !== true) {
      throw new CfPolicyError(
        'cf_http_error',
        `Cloudflare ${method} returned HTTP ${res.status}`,
        JSON.stringify(parsed.errors ?? parsed).slice(0, 300),
      );
    }
    if (!isPlainObject(parsed.result)) {
      throw new CfPolicyError(
        'malformed_policy',
        `Cloudflare ${method} succeeded but returned no policy object`,
        `result was ${JSON.stringify(parsed.result)?.slice(0, 80) ?? 'undefined'}`,
      );
    }
    return parsed.result;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Q10 — assert the policy is attached to exactly one application before we
 * are willing to write to it. `Owner Only` is reusable:true; verified
 * app_count:1 on 2026-07-26, but if it is ever attached to a second
 * application, RepOS would silently start granting access to that app.
 * Encoded in code, not just documented. Absent field => refuse (fail closed).
 *
 * Q22 — refuse unless EVERY include[] element is an email selector. Blind
 * array manipulation could drop a group selector or, worse, preserve an
 * `everyone` rule while appearing to work.
 */
function toSnapshot(result: Record<string, unknown>): CfPolicySnapshot {
  const appCount = result.app_count;
  if (typeof appCount !== 'number' || appCount !== 1) {
    throw new CfPolicyError(
      'app_count_not_one',
      `policy app_count is ${String(appCount)}, refusing to write`,
    );
  }

  // Validate, never default. Coercing a missing field to a plausible-looking
  // value (`[]`, `'allow'`, `''`) turns a truncated-but-2xx response into a
  // DESTRUCTIVE write: both reads degrade identically, the Q19 fingerprints
  // match, and the PUT then strips exclude[]/require[] and rewrites the name
  // and decision. A malformed policy must fail closed like every other refusal
  // here.
  const malformed = (field: string, saw: unknown): never => {
    throw new CfPolicyError(
      'malformed_policy',
      `policy field \`${field}\` is missing or the wrong type — refusing to write`,
      `saw ${typeof saw}: ${JSON.stringify(saw)?.slice(0, 80)}`,
    );
  };

  if (typeof result.name !== 'string') malformed('name', result.name);
  if (typeof result.decision !== 'string') malformed('decision', result.decision);
  if (!Array.isArray(result.include)) malformed('include', result.include);
  for (const k of ['exclude', 'require'] as const) {
    if (k in result && !Array.isArray(result[k])) malformed(k, result[k]);
  }

  const emails: string[] = [];
  for (const sel of result.include as unknown[]) {
    // Structurally invalid entries are malformed, not merely the wrong kind of
    // selector — and Object.keys(null) would throw a raw TypeError.
    if (!isPlainObject(sel)) {
      malformed('include[] entry', sel);
      continue; // unreachable; keeps the narrowing honest
    }
    const keys = Object.keys(sel);
    const emailObj = sel.email;
    if (
      keys.length !== 1 ||
      keys[0] !== 'email' ||
      !isPlainObject(emailObj) ||
      typeof emailObj.email !== 'string'
    ) {
      throw new CfPolicyError(
        'non_email_selector',
        `policy include[] contains a non-email selector (${keys.join(',') || 'empty'})`,
      );
    }
    emails.push(emailObj.email.toLowerCase());
  }

  // Copy writable fields verbatim, and only the ones actually present. An
  // absent key stays absent so the PUT does not assert a value Cloudflare
  // never told us about.
  const config: Record<string, unknown> = {};
  for (const k of POLICY_WRITABLE_FIELDS) {
    if (k in result) config[k] = result[k];
  }

  return {
    emails,
    name: result.name as string,
    decision: result.decision as string,
    config,
  };
}

/** Key-order-independent so a reserialized response is not read as a change. */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, canonical(o[k])]));
  }
  return v;
}

/**
 * A stable, total serialization of everything we observed about the policy.
 * Used for the Q19 compare-before-write: "any difference aborts" has to mean
 * any difference, including the fields we echo back rather than compute.
 *
 * Fingerprinting `config` rather than a hand-picked subset is what makes that
 * true. A five-field fingerprint missed every other mutable setting — flipping
 * session_duration from 24h to 1h, or turning off approval_required, between
 * the read and the write compared equal and the PUT went ahead.
 */
function fingerprint(s: CfPolicySnapshot): string {
  return JSON.stringify(canonical(s.config));
}

export async function fetchPolicy(
  opts: { timeoutMs?: number } = {},
): Promise<CfPolicySnapshot> {
  const result = await cfRequest('GET', undefined, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  return toSnapshot(result);
}

/**
 * Replace include[] with exactly `desiredEmails`.
 *
 * Q19 — immediately before the PUT the policy is re-fetched and compared
 * against `snapshot`. Any difference aborts the write and surfaces as drift.
 * The advisory lock serializes RepOS against itself, not against a human
 * editing the Cloudflare dashboard between our GET and PUT. Verified against
 * the Cloudflare OpenAPI spec: the Access policy PUT supports no ETag,
 * If-Match, or version field, so true optimistic concurrency is unavailable.
 * Re-fetch-and-compare narrows the window to the compare->PUT gap; it does not
 * eliminate it. Accepted residual risk (single-operator account,
 * admin-initiated, low frequency).
 */
export async function putPolicyEmails(
  desiredEmails: string[],
  snapshot: CfPolicySnapshot,
  opts: { timeoutMs?: number } = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // Re-assert Q10 and Q22 on the fresh read, not just the original one.
  const current = await fetchPolicy({ timeoutMs });
  // Q19 says ANY difference aborts, so compare the WHOLE snapshot — not just
  // the email list. A dashboard edit that flipped `decision` to deny, renamed
  // the policy, or added an exclude[] rule would otherwise pass the compare
  // and then be silently overwritten by our PUT, since we echo those fields
  // back from `current`.
  if (fingerprint(current) !== fingerprint(snapshot)) {
    throw new CfPolicyError(
      'policy_changed',
      'the Cloudflare policy changed between read and write — aborting',
      `expected ${fingerprint(snapshot)}, found ${fingerprint(current)}`.slice(0, 300),
    );
  }
  // Echo the ENTIRE observed writable config back, replacing only include[].
  // The PUT is a full replace: anything omitted here is reset to its default,
  // so a membership change would otherwise silently reconfigure the
  // application (session_duration, approval, MFA, isolation, justification).
  await cfRequest(
    'PUT',
    {
      ...current.config,
      include: desiredEmails.map((e) => ({ email: { email: e } })),
    },
    timeoutMs,
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/services/cf-access-policy.test.ts`
Expected: PASS, 36 tests.

- [ ] **Step 5: Commit**

```bash
git add api/src/services/cfAccessPolicy.ts api/tests/services/cf-access-policy.test.ts
git commit -m "$(cat <<'EOF'
feat(w9): fail-closed Cloudflare Access policy client (Q10, Q19, Q22, Q38)

Refuses to write unless app_count is exactly 1 and every include[] element is
an email selector, re-asserting both on the pre-PUT re-fetch. Compares against
the operation's opening snapshot and aborts on any dashboard edit. exclude[]
and require[] are echoed back untouched. Every call carries an abort deadline.
No session-revocation endpoint is used.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Status-aware CF sync primitives

`retry-sync` must reconcile Cloudflare **to the row's current status**, never blindly re-add — a retry that always adds would silently restore CF access to a suspended user, turning the repair operation into a security regression (Q36).

**Files:**
- Create: `api/src/services/cfAccessSync.ts`
- Test: `api/tests/services/cf-access-sync.test.ts`

**Interfaces:**
- Consumes: `fetchPolicy`, `putPolicyEmails`, `CfPolicyError` (Task 5); `UserStatus` (Task 2).
- Produces:
  - `desiredPresence(status: UserStatus): 'present' | 'absent'`
  - `syncEmail(email: string, desired: 'present' | 'absent'): Promise<{ changed: boolean }>`
  - `syncEmailToStatus(email: string, status: UserStatus): Promise<{ changed: boolean }>`

- [ ] **Step 1: Write the failing test**

Create `api/tests/services/cf-access-sync.test.ts`:

```ts
// Q36 — reconcile TO the row's status. Never blindly re-add.
import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import * as policy from '../../src/services/cfAccessPolicy.js';
import { desiredPresence, syncEmail, syncEmailToStatus } from '../../src/services/cfAccessSync.js';

function snap(emails: string[]) {
  // `config` mirrors what fetchPolicy would have observed. Task 5's snapshot
  // carries the WHOLE writable policy; there are no top-level exclude/require.
  return {
    emails, name: 'Owner Only', decision: 'allow',
    config: { name: 'Owner Only', decision: 'allow', include: emails.map((e) => ({ email: { email: e } })), exclude: [], require: [] },
  };
}

let fetchSpy: MockInstance<typeof policy.fetchPolicy>;
let putSpy: MockInstance<typeof policy.putPolicyEmails>;

beforeEach(() => {
  // Belt and braces. These tests assert on spies attached to the module
  // namespace; if that interop ever stops taking effect, the REAL client would
  // run — and its PUT would land on the live `Owner Only` policy. Today the
  // local `.env` carries no CF_* vars so it would fail closed on
  // cf_not_configured, but that is an accident of configuration, not a
  // guarantee. Deny the network outright instead of relying on it.
  policy.__setFetchForTesting((() => {
    throw new Error('cf-access-sync tests must never issue a real HTTP request');
  }) as unknown as typeof fetch);
  fetchSpy = vi.spyOn(policy, 'fetchPolicy');
  putSpy = vi.spyOn(policy, 'putPolicyEmails').mockResolvedValue(undefined);
});
afterEach(() => {
  policy.__setFetchForTesting(null);
  vi.restoreAllMocks();
});

describe('desiredPresence', () => {
  it('grants for invited and active; revokes for suspended and deleting', () => {
    expect(desiredPresence('invited')).toBe('present');
    expect(desiredPresence('active')).toBe('present');
    expect(desiredPresence('suspended')).toBe('absent');
    expect(desiredPresence('deleting')).toBe('absent');
  });
});

describe('syncEmail', () => {
  it('adds a missing email, preserving the existing entries', async () => {
    fetchSpy.mockResolvedValue(snap(['a@repos.test']));
    const r = await syncEmail('New@Repos.test', 'present');
    expect(r.changed).toBe(true);
    expect(putSpy).toHaveBeenCalledWith(['a@repos.test', 'new@repos.test'], expect.anything());
  });

  it('is a no-op when the email is already present — no PUT at all', async () => {
    fetchSpy.mockResolvedValue(snap(['a@repos.test', 'b@repos.test']));
    const r = await syncEmail('b@repos.test', 'present');
    expect(r.changed).toBe(false);
    expect(putSpy).not.toHaveBeenCalled();
  });

  it('removes a present email', async () => {
    fetchSpy.mockResolvedValue(snap(['a@repos.test', 'b@repos.test']));
    const r = await syncEmail('a@repos.test', 'absent');
    expect(r.changed).toBe(true);
    expect(putSpy).toHaveBeenCalledWith(['b@repos.test'], expect.anything());
  });

  it('is a no-op when the email is already absent', async () => {
    fetchSpy.mockResolvedValue(snap(['a@repos.test']));
    const r = await syncEmail('gone@repos.test', 'absent');
    expect(r.changed).toBe(false);
    expect(putSpy).not.toHaveBeenCalled();
  });

  it('propagates a policy refusal untouched so it can surface as drift', async () => {
    fetchSpy.mockRejectedValue(new policy.CfPolicyError('app_count_not_one', 'nope'));
    await expect(syncEmail('x@repos.test', 'present')).rejects.toMatchObject({
      code: 'app_count_not_one',
    });
  });

  it('propagates a WRITE-side refusal too — the Q19 abort must not be swallowed', async () => {
    // The read succeeds and a change is genuinely needed, so the PUT is
    // attempted and it is putPolicyEmails' own compare-before-write that
    // aborts. Callers translate this into "sync pending"/drift; a syncEmail
    // that caught it and reported { changed: true } would report success for a
    // membership change Cloudflare never accepted.
    fetchSpy.mockResolvedValue(snap(['a@repos.test']));
    putSpy.mockRejectedValue(new policy.CfPolicyError('policy_changed', 'dashboard edit'));
    await expect(syncEmail('b@repos.test', 'present')).rejects.toMatchObject({
      code: 'policy_changed',
    });
  });
});

describe('syncEmailToStatus (Q36)', () => {
  it('REMOVES the email for a suspended row — never re-adds it', async () => {
    fetchSpy.mockResolvedValue(snap(['sus@repos.test', 'other@repos.test']));
    await syncEmailToStatus('sus@repos.test', 'suspended');
    expect(putSpy).toHaveBeenCalledWith(['other@repos.test'], expect.anything());
  });

  it('REMOVES the email for a deleting row', async () => {
    fetchSpy.mockResolvedValue(snap(['del@repos.test']));
    await syncEmailToStatus('del@repos.test', 'deleting');
    expect(putSpy).toHaveBeenCalledWith([], expect.anything());
  });

  it('ADDS the email for an invited row whose provisioning failed', async () => {
    fetchSpy.mockResolvedValue(snap([]));
    await syncEmailToStatus('inv@repos.test', 'invited');
    expect(putSpy).toHaveBeenCalledWith(['inv@repos.test'], expect.anything());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/services/cf-access-sync.test.ts`
Expected: FAIL — `Cannot find module '../../src/services/cfAccessSync.js'`

- [ ] **Step 3: Write the implementation**

Create `api/src/services/cfAccessSync.ts`:

```ts
// W9 — status-aware reconciliation of one email against the CF policy.
//
// Callers MUST already hold the membership lock (Q26): read-modify-write on
// include[] is not safe concurrently, and putPolicyEmails' compare-and-write
// only narrows the dashboard-edit window, not the RepOS-vs-RepOS one.
import type { UserStatus } from '../constants/users.js';
import { fetchPolicy, putPolicyEmails } from './cfAccessPolicy.js';

/**
 * Q36 — what the CF policy should contain for a row in this status.
 *
 * The point of this function is that `retry-sync` is NOT a reinstate. A
 * retry-sync that always added would silently restore CF access to a suspended
 * user: the operation meant to repair drift would create a security
 * regression. Explicit Reinstate is the operation that retries a failed add.
 */
export function desiredPresence(status: UserStatus): 'present' | 'absent' {
  return status === 'invited' || status === 'active' ? 'present' : 'absent';
}

/**
 * Drive the policy toward `desired` for exactly one email. Returns
 * `{ changed: false }` — with no PUT issued at all — when the policy already
 * agrees, so a redundant retry costs one GET and cannot clobber a concurrent
 * dashboard edit.
 *
 * Throws CfPolicyError untouched; callers translate that into "sync pending"
 * or drift rather than rolling back the DB (Q8, Q17).
 */
export async function syncEmail(
  email: string,
  desired: 'present' | 'absent',
): Promise<{ changed: boolean }> {
  const target = email.toLowerCase();
  const snapshot = await fetchPolicy();
  const present = snapshot.emails.includes(target);
  if ((desired === 'present') === present) return { changed: false };

  const next =
    desired === 'present'
      ? [...snapshot.emails, target]
      : snapshot.emails.filter((e) => e !== target);

  await putPolicyEmails(next, snapshot);
  return { changed: true };
}

/** Convenience wrapper: reconcile an email to whatever its row's status expects. */
export async function syncEmailToStatus(
  email: string,
  status: UserStatus,
): Promise<{ changed: boolean }> {
  return syncEmail(email, desiredPresence(status));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/services/cf-access-sync.test.ts`
Expected: PASS, 10 tests.

> **Note for the implementer:** `vi.spyOn` on an ESM namespace import works in vitest only when the consuming module imports the same binding at runtime. `cfAccessSync.ts` imports `{ fetchPolicy, putPolicyEmails }` directly, which vitest's ESM interop makes spyable — verified working on vitest 4.1.5. If the spies do not take effect, switch the test to `vi.mock('../../src/services/cfAccessPolicy.js', ...)` with an explicit factory — do **not** change the production import style to work around it.
>
> The `__setFetchForTesting` guard in `beforeEach` is not redundant with the spies; it is what makes an ineffective spy *safe*. Without it, spies that stopped intercepting would run the real client, and its PUT would land on the live `Owner Only` policy. That it currently fails closed on `cf_not_configured` instead is only because the local `.env` happens to carry no `CF_*` vars.
>
> The write-side propagation test (`propagates a WRITE-side refusal too`) covers a gap the read-side one does not: mutation-testing confirmed that wrapping `putPolicyEmails` in a swallowing `try/catch` is caught by *only* that test. Without it, `syncEmail` could report `{ changed: true }` for a membership change Cloudflare rejected.

- [ ] **Step 5: Commit**

```bash
cd /var/home/jason/Projects/RepOS && git add api/src/services/cfAccessSync.ts api/tests/services/cf-access-sync.test.ts
git commit -m "$(cat <<'EOF'
feat(w9): status-aware CF sync primitives (Q36)

desiredPresence maps invited/active to present and suspended/deleting to
absent, so retry-sync repairs drift in the correct direction instead of
re-granting access to a suspended user. A policy that already agrees issues
no PUT.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: The bearer gate enforces status

Verified at `api/src/middleware/auth.ts:43-48`: the lookup selects from `device_tokens` alone with **no join to `users`**. A suspended user's iOS Shortcut token would keep working indefinitely — the gate would exist on only one of the two authentication paths (Q25).

**Files:**
- Modify: `api/src/middleware/auth.ts:43-75`
- Test: `api/tests/middleware/bearer-status-gate.test.ts`

**Interfaces:**
- Consumes: `users.status` (Task 2).
- Produces: no new exports. `requireAuth` now 401s for any non-`active` user.

- [ ] **Step 1: Write the failing test**

Create `api/tests/middleware/bearer-status-gate.test.ts`:

```ts
// Q25 — the bearer path enforces users.status. Suspension must not be
// enforceable on only one of the two authentication paths.
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/client.js';
import { mkUser, cleanupUser } from '../helpers/program-fixtures.js';

let app: Awaited<ReturnType<typeof buildApp>>;
let userId: string;
let token: string;

beforeAll(async () => {
  app = await buildApp();
  const u = await mkUser({ prefix: 'vitest.bearer-status' });
  userId = u.id;
  const mint = await app.inject({
    method: 'POST',
    url: '/api/tokens',
    body: { user_id: userId, label: 't', scopes: ['health:weight:write'] },
  });
  token = mint.json<{ token: string }>().token;
});

afterAll(async () => {
  await cleanupUser(userId);
  await app.close();
});

async function probe(): Promise<number> {
  const r = await app.inject({
    method: 'GET',
    url: '/api/account/sessions',
    headers: { authorization: `Bearer ${token}` },
  });
  return r.statusCode;
}

async function setStatus(status: string): Promise<void> {
  await db.query(`UPDATE users SET status=$2 WHERE id=$1`, [userId, status]);
}

describe('requireAuth status enforcement (Q25)', () => {
  it('allows an active user', async () => {
    await setStatus('active');
    expect(await probe()).toBe(200);
  });

  it('401s a suspended user on the VERY NEXT request', async () => {
    await setStatus('suspended');
    expect(await probe()).toBe(401);
  });

  it('401s a deleting user', async () => {
    await setStatus('deleting');
    expect(await probe()).toBe(401);
  });

  it('401s an invited-but-unactivated user', async () => {
    await setStatus('invited');
    expect(await probe()).toBe(401);
  });

  it('restores access on reinstatement — asserted through the bearer path', async () => {
    await setStatus('active');
    expect(await probe()).toBe(200);
  });

  it('does not stamp last_used_at for a rejected request', async () => {
    // The status check sits before the last_used_at UPDATE. Without this the
    // ordering is only a comment: a suspended user's token would keep showing
    // fresh activity on the sessions surface every time their Shortcut retried,
    // which is exactly the signal an admin would use to judge whether a
    // suspension took effect.
    await setStatus('active');
    expect(await probe()).toBe(200);
    const { rows: before } = await db.query<{ last_used_at: Date | null }>(
      `SELECT last_used_at FROM device_tokens WHERE user_id=$1`,
      [userId],
    );
    await setStatus('suspended');
    expect(await probe()).toBe(401);
    const { rows: after } = await db.query<{ last_used_at: Date | null }>(
      `SELECT last_used_at FROM device_tokens WHERE user_id=$1`,
      [userId],
    );
    expect(after[0].last_used_at).toEqual(before[0].last_used_at);
  });

  it('still 401s a garbage token (no status leak on the miss path)', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/account/sessions',
      headers: { authorization: 'Bearer deadbeefdeadbeef.' + 'f'.repeat(64) },
    });
    expect(r.statusCode).toBe(401);
  });
});

// The cases above probe a READ route. Q25's actual concern is the iOS Shortcut,
// which WRITES. `POST /api/health/weight` runs the same requireAuth via
// requireBearerOrCfAccess, so the gate covers it by construction — but "by
// construction" is exactly what stops holding when a route is later registered
// with a different auth preHandler. Assert the ingest path directly: a
// suspended user's Shortcut must not be able to write, and the pairing with the
// active case proves the 401 comes from the status gate rather than from a
// missing scope or a malformed body.
describe('the iOS Shortcut ingest path (the Q25 attack path)', () => {
  async function ingest(): Promise<number> {
    const r = await app.inject({
      method: 'POST',
      url: '/api/health/weight',
      headers: { authorization: `Bearer ${token}` },
      body: { weight_lbs: 185.5, date: '2026-03-14', time: '07:30:00', source: 'Apple Health' },
    });
    return r.statusCode;
  }

  it('accepts the write while the user is active', async () => {
    await setStatus('active');
    expect(await ingest()).toBe(201);
  });

  it('401s the write once the user is suspended', async () => {
    await setStatus('suspended');
    expect(await ingest()).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/middleware/bearer-status-gate.test.ts`
Expected: FAIL — the suspended / deleting / invited cases return 200.

- [ ] **Step 3: Join `users` in the lookup**

In `api/src/middleware/auth.ts`, replace the query at lines 43–48 and the post-verify block:

```ts
  // Look up by prefix — at most one row; no table scan. `scopes` is pulled
  // alongside id/user_id so requireScope (api/src/middleware/scope.ts) can
  // gate writes without a second DB round-trip.
  //
  // W9 Q25: JOIN users and pull status. Before this join, a suspended user's
  // iOS Shortcut token kept working indefinitely — the DB gate existed on the
  // CF Access path only. Suspension is only a real revocation if BOTH paths
  // check it on every request.
  const { rows } = await db.query(
    `SELECT dt.id, dt.user_id, dt.token_hash, dt.scopes, u.status
       FROM device_tokens dt
       JOIN users u ON u.id = dt.user_id
      WHERE dt.token_hash LIKE $1 AND dt.revoked_at IS NULL`,
    [`${prefix}:%`],
  );
```

Then, immediately after the existing `argon2.verify` failure check (currently line 62–64) and **before** the `last_used_at` UPDATE, insert:

```ts
  // Status is checked AFTER the secret verifies, so an attacker probing
  // prefixes learns nothing about account state from the response code —
  // every failure is an indistinguishable bare 401. It is checked BEFORE the
  // last_used_at UPDATE so a rejected request does not make a suspended
  // user's token look freshly used on the sessions surface.
  if (row.status !== 'active') {
    req.log.warn({ userId: row.user_id, status: row.status }, 'bearer_rejected_inactive_user');
    return reply.code(401).send();
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/middleware/bearer-status-gate.test.ts`
Expected: PASS, 9 tests.

> **Note for the implementer:** the test block above adds three cases beyond the six originally planned, each of which mutation-testing showed nothing else covered.
>
> - **The ingest path.** The six planned cases all probe `GET /api/account/sessions`, but Q25's actual concern is the iOS Shortcut, which *writes*. `POST /api/health/weight` reaches the same `requireAuth` via `requireBearerOrCfAccess`, so it is covered by construction — and "by construction" stops holding the moment a route is registered with a different auth preHandler. Before the fix, the suspended write returned **200**, not 401.
> - **`last_used_at` ordering.** Placing the check before the UPDATE is otherwise only a comment. Moving the check after the UPDATE passes all six planned tests.
> - Note the ingest body needs `time` as `HH:MM:SS`; `'07:30'` is rejected with a 400 by `WeightSampleSchema`. Pairing the suspended assertion with an active one is what catches that — a lone 401 assertion passes for the wrong reason on a malformed body.
>
> Two things worth knowing about this task's environment: `POST /api/tokens` is gated by `requireAdminKeyOrCfAccess`, which is an open path when `ADMIN_API_KEY` is unset, so the header-less mint above works locally and matches how `tests/weight.test.ts` already mints. And the new INNER JOIN means any test inserting a `device_tokens` row for a `user_id` with no `users` row now 401s instead of authenticating; a full-suite run at Task 7 found no such test.

- [ ] **Step 5: Run the full suite — every bearer-authenticated test now depends on `status='active'`**

Run: `cd /var/home/jason/Projects/RepOS/api && npm test`
Expected: PASS. `mkUser` inserts with the `status` column default `'active'`, so no fixture change is needed. If any test fails here it is because it inserts a `users` row by hand with an explicit column list — fix those by letting the default apply, not by removing the status check.

- [ ] **Step 6: Commit**

```bash
git add api/src/middleware/auth.ts api/tests/middleware/bearer-status-gate.test.ts
git commit -m "$(cat <<'EOF'
feat(w9): enforce users.status on the bearer path (Q25)

auth.ts selected from device_tokens alone, so a suspended user's iOS Shortcut
token kept working indefinitely. JOIN users and 401 any non-active status,
checked after the argon2 verify so failures stay indistinguishable.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Deny-by-default CF Access gate + activation

The highest-regression-risk task in the plan. Existing tests assert that auto-provisioning works; locating and flipping those assertions matters more than any new test.

`cfAccess.ts:128` currently INSERTs a `users` row for any email that clears CF Access. Auto-provisioning is the opposite of a gate — without this flip the DB cannot be authoritative (Q2).

**Files:**
- Modify: `api/src/middleware/cfAccess.ts:105-153`
- Modify: `api/tests/helpers/program-fixtures.ts` (add `mkUserWithEmail`)
- Modify: `api/tests/helpers/cf-access-jwt.ts` (drop the `CF_ACCESS_ALLOWED_EMAILS` plumbing)
- Test: `api/tests/middleware/cf-access-gate.test.ts`
- Flip: every test listed in Step 5

**Interfaces:**
- Consumes: `users.status`/`role`/`cf_synced_at` (Task 2); `recordAccountEvent`, `humanActor` (Task 3).
- Produces:
  - `req.userRole: 'member' | 'admin'` stamped on the CF Access path.
  - Gate responses: `403 not_invited`, `403 not_provisioned`, `403 access_suspended`.
  - `mkUserWithEmail(email: string, opts?: { role?: UserRole; status?: UserStatus; cfSyncedAt?: Date | null }): Promise<{ id: string; email: string }>`

- [ ] **Step 1: Write the failing test**

Create `api/tests/middleware/cf-access-gate.test.ts`:

```ts
// Q2, Q17b, Q21 — the CF Access gate is deny-by-default, and activation is a
// conditional UPDATE that also requires provisioning.
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/client.js';
import * as events from '../../src/services/accountEvents.js';
import { setupTestJwks, type TestJwksHandle } from '../helpers/cf-access-jwt.js';
import { mkUserWithEmail, cleanupUser } from '../helpers/program-fixtures.js';

let app: Awaited<ReturnType<typeof buildApp>>;
let jwks: TestJwksHandle;
const created: string[] = [];

beforeAll(async () => {
  jwks = await setupTestJwks();
  app = await buildApp();
});

afterAll(async () => {
  for (const id of created) await cleanupUser(id);
  await app.close();
  await jwks.teardown();
});

async function me(email: string) {
  return app.inject({
    method: 'GET',
    url: '/api/me',
    headers: { 'cf-access-jwt-assertion': await jwks.mintJwt(email) },
  });
}

function freshEmail(tag: string): string {
  return `vitest.gate-${tag}-${randomUUID().slice(0, 8)}@repos.test`;
}

describe('deny-by-default (Q2)', () => {
  it('403 not_invited for an email with no users row', async () => {
    const email = freshEmail('unknown');
    const r = await me(email);
    expect(r.statusCode).toBe(403);
    expect(r.json<{ error: string }>().error).toBe('not_invited');
  });

  it('the middleware creates NO row — auto-provisioning is gone', async () => {
    const email = freshEmail('norow');
    await me(email);
    const { rows } = await db.query(`SELECT id FROM users WHERE lower(email)=$1`, [email]);
    expect(rows).toHaveLength(0);
  });
});

describe('status gating', () => {
  it('allows an active user and stamps identity', async () => {
    const email = freshEmail('active');
    const u = await mkUserWithEmail(email, { status: 'active' });
    created.push(u.id);
    const r = await me(email);
    expect(r.statusCode).toBe(200);
    expect(r.json<{ email: string }>().email).toBe(email);
  });

  it('403 access_suspended for a suspended user', async () => {
    const email = freshEmail('susp');
    const u = await mkUserWithEmail(email, { status: 'suspended' });
    created.push(u.id);
    const r = await me(email);
    expect(r.statusCode).toBe(403);
    expect(r.json<{ error: string }>().error).toBe('access_suspended');
  });

  it('403 access_suspended for a deleting user (Q17b)', async () => {
    const email = freshEmail('del');
    const u = await mkUserWithEmail(email, { status: 'deleting' });
    created.push(u.id);
    const r = await me(email);
    expect(r.statusCode).toBe(403);
    expect(r.json<{ error: string }>().error).toBe('access_suspended');
  });
});

describe('activation (Q21 + Q17b)', () => {
  it('403 not_provisioned for invited + cf_synced_at NULL, and does NOT activate', async () => {
    const email = freshEmail('unprov');
    const u = await mkUserWithEmail(email, { status: 'invited', cfSyncedAt: null });
    created.push(u.id);
    const r = await me(email);
    expect(r.statusCode).toBe(403);
    expect(r.json<{ error: string }>().error).toBe('not_provisioned');
    const { rows } = await db.query<{ status: string }>(`SELECT status FROM users WHERE id=$1`, [u.id]);
    expect(rows[0].status).toBe('invited');
  });

  it('flips invited + stamped -> active, sets activated_at, emits ONE user_activated', async () => {
    const email = freshEmail('activate');
    const u = await mkUserWithEmail(email, { status: 'invited', cfSyncedAt: new Date() });
    created.push(u.id);
    const r = await me(email);
    expect(r.statusCode).toBe(200);
    const { rows } = await db.query<{ status: string; activated_at: Date | null }>(
      `SELECT status, activated_at FROM users WHERE id=$1`, [u.id],
    );
    expect(rows[0].status).toBe('active');
    expect(rows[0].activated_at).not.toBeNull();
    const ev = await db.query<{ n: number }>(
      `SELECT count(*)::int n FROM account_events WHERE user_id=$1 AND kind='user_activated'`, [u.id],
    );
    expect(ev.rows[0].n).toBe(1);
  });

  it('the user_activated event carries the human actor shape (Q23)', async () => {
    const email = freshEmail('actor');
    const u = await mkUserWithEmail(email, { status: 'invited', cfSyncedAt: new Date() });
    created.push(u.id);
    await me(email);
    const { rows } = await db.query<{ meta: Record<string, unknown> }>(
      `SELECT meta FROM account_events WHERE user_id=$1 AND kind='user_activated'`, [u.id],
    );
    expect(rows[0].meta.actor_kind).toBe('user');
    expect(rows[0].meta.actor_user_id).toBe(u.id);
    expect(rows[0].meta.actor_email).toBe(email);
  });

  it('Q27: a failing event write rolls the activation back — no mutation without its event', async () => {
    const email = freshEmail('atomic');
    const u = await mkUserWithEmail(email, { status: 'invited', cfSyncedAt: new Date() });
    created.push(u.id);
    const spy = vi
      .spyOn(events, 'recordAccountEventTx')
      .mockRejectedValueOnce(new Error('audit write failed'));
    try {
      const r = await me(email);
      expect(r.statusCode).toBe(403);
    } finally {
      spy.mockRestore();
    }
    const { rows } = await db.query<{ status: string; activated_at: Date | null }>(
      `SELECT status, activated_at FROM users WHERE id=$1`, [u.id],
    );
    expect(rows[0].status).toBe('invited');
    expect(rows[0].activated_at).toBeNull();
    const ev = await db.query<{ n: number }>(
      `SELECT count(*)::int n FROM account_events WHERE user_id=$1 AND kind='user_activated'`, [u.id],
    );
    expect(ev.rows[0].n).toBe(0);
  });

  it('activation race: two concurrent first requests both succeed, exactly ONE event', async () => {
    const email = freshEmail('race');
    const u = await mkUserWithEmail(email, { status: 'invited', cfSyncedAt: new Date() });
    created.push(u.id);
    const [a, b] = await Promise.all([me(email), me(email)]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    const ev = await db.query<{ n: number }>(
      `SELECT count(*)::int n FROM account_events WHERE user_id=$1 AND kind='user_activated'`, [u.id],
    );
    expect(ev.rows[0].n).toBe(1);
  });

  it('a lost conditional UPDATE re-reads real state — a concurrently suspended row stays DENIED', async () => {
    // Round-4 review finding 3: treating zero rows as "someone else activated
    // me" is a security hole — the update may equally have lost because an
    // admin concurrently suspended the row.
    const email = freshEmail('lostrace');
    const u = await mkUserWithEmail(email, { status: 'invited', cfSyncedAt: new Date() });
    created.push(u.id);
    // NOTE: this suspends the row BEFORE the request, so the gate's opening
    // SELECT already sees 'suspended' and the activation block is never
    // entered — it does not reach the re-read at all. Kept because it is a
    // legitimate case, but the interleaving one below is what actually covers
    // the zero-row re-read.
    await db.query(`UPDATE users SET status='suspended' WHERE id=$1`, [u.id]);
    const r = await me(email);
    expect(r.statusCode).toBe(403);
    expect(r.json<{ error: string }>().error).toBe('access_suspended');
  });

  it('a row suspended BETWEEN the read and the conditional UPDATE stays denied', async () => {
    // This is the case round-4 finding 3 is actually about: the gate reads the
    // row as invited + provisioned, and only then does an admin suspend it, so
    // the conditional UPDATE matches zero rows. Assuming that means "someone
    // else activated me" would admit a suspended user.
    //
    // Hook the gate's own identity SELECT: let it resolve, then suspend the row
    // before returning. That lands the mutation strictly between the SELECT and
    // the conditional UPDATE — deterministic, not a timing race. (Hooking
    // db.connect instead does not work: pool.query() acquires a client
    // internally, so the first connect is the SELECT's own.)
    const email = freshEmail('interleave');
    const u = await mkUserWithEmail(email, { status: 'invited', cfSyncedAt: new Date() });
    created.push(u.id);
    const realQuery = db.query.bind(db);
    const spy = vi.spyOn(db, 'query').mockImplementation(async (...args: unknown[]) => {
      const res = await (realQuery as (...a: unknown[]) => Promise<unknown>)(...args);
      const sql = typeof args[0] === 'string' ? args[0] : '';
      if (sql.includes('FROM users WHERE lower(email)')) {
        await (realQuery as (...a: unknown[]) => Promise<unknown>)(
          `UPDATE users SET status='suspended' WHERE id=$1`,
          [u.id],
        );
      }
      return res;
    });
    try {
      const r = await me(email);
      expect(r.statusCode).toBe(403);
      expect(r.json<{ error: string }>().error).toBe('access_suspended');
    } finally {
      spy.mockRestore();
    }
    // And it must not have activated on the way past.
    const { rows } = await db.query<{ status: string; activated_at: Date | null }>(
      `SELECT status, activated_at FROM users WHERE id=$1`, [u.id],
    );
    expect(rows[0].status).toBe('suspended');
    expect(rows[0].activated_at).toBeNull();
  });

  it('a concurrently deleted row also stays denied', async () => {
    const email = freshEmail('lostdel');
    const u = await mkUserWithEmail(email, { status: 'invited', cfSyncedAt: new Date() });
    created.push(u.id);
    await db.query(`UPDATE users SET status='deleting' WHERE id=$1`, [u.id]);
    const r = await me(email);
    expect(r.statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/middleware/cf-access-gate.test.ts`
Expected: FAIL — `mkUserWithEmail is not a function`, and the deny-by-default cases return 200 with a freshly auto-provisioned row.

- [ ] **Step 3: Add the fixture helper**

Append to `api/tests/helpers/program-fixtures.ts`:

```ts
/**
 * W9 — a users row at a caller-chosen email, role and status. Needed because
 * the CF Access gate is deny-by-default (Q2): a test that mints a JWT for a
 * fixed address must pre-create the row, since the middleware no longer
 * auto-provisions one.
 */
export async function mkUserWithEmail(
  email: string,
  opts: {
    role?: 'member' | 'admin';
    status?: 'invited' | 'active' | 'suspended' | 'deleting';
    cfSyncedAt?: Date | null;
  } = {},
): Promise<{ id: string; email: string }> {
  const { rows: [u] } = await db.query<{ id: string; email: string }>(
    `INSERT INTO users (email, role, status, cf_synced_at)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email`,
    [email, opts.role ?? 'member', opts.status ?? 'active', opts.cfSyncedAt ?? null],
  );
  return u;
}
```

- [ ] **Step 4: Rewrite the gate**

In `api/src/middleware/cfAccess.ts`:

Update the file header comment — replace `resolves the email claim to a users row (auto-provisioning on first sight)` with `resolves the email claim to a users row. Deny-by-default per W9 Q2: no row means 403, never an INSERT.`

Add to the imports:

```ts
import { recordAccountEventTx, humanActor } from '../services/accountEvents.js';
```

Delete the `CF_ACCESS_ALLOWED_EMAILS` block (lines 108–114) entirely — `users.status` replaces it (Q4).

Replace the row-resolution block (lines 116–153) with:

```ts
  const displayNameClaim = typeof payload.name === 'string' ? payload.name : null;

  // Deny-by-default (Q2). cfAccess.ts previously INSERTed a users row for any
  // email that cleared CF Access; auto-provisioning is the opposite of a gate,
  // and without this flip the DB cannot be authoritative.
  const { rows } = await db.query<{
    id: string;
    display_name: string | null;
    timezone: string;
    last_seen_at: Date | null;
    status: string;
    role: string;
    cf_synced_at: Date | null;
  }>(
    `SELECT id, display_name, timezone, last_seen_at, status, role, cf_synced_at
     FROM users WHERE lower(email) = $1`,
    [rawEmail],
  );

  if (rows.length === 0) {
    req.log.warn({ email: rawEmail }, 'cf_access_not_invited');
    return reply.code(403).send({ error: 'not_invited' });
  }

  const user = rows[0];
  let status = user.status;

  if (status === 'invited') {
    // Q17b — an invited row may not activate unless its CF provisioning
    // actually landed. Without this precondition a row whose CF step failed
    // would be activatable the moment anything put a session in front of it.
    if (user.cf_synced_at === null) {
      req.log.warn({ email: rawEmail }, 'cf_access_not_provisioned');
      return reply.code(403).send({ error: 'not_provisioned' });
    }

    // Q21 — the conditional UPDATE picks exactly one winner among concurrent
    // first requests, so user_activated is emitted at most once.
    //
    // Q27 — the UPDATE and its audit row commit TOGETHER. Doing the update on
    // the pool and then recording the event separately would leave an
    // activated account with no user_activated row if the process died or the
    // insert failed in between: a mutation without its event, which is exactly
    // the lost-intent case invariant I3 forbids. Only the transaction that
    // actually won the race writes the event, so the race test's
    // "exactly one event" assertion still holds.
    const client = await db.connect();
    let won = false;
    try {
      await client.query('BEGIN');
      const upd = await client.query<{ id: string }>(
        `UPDATE users SET status='active', activated_at=now()
          WHERE id=$1 AND status='invited' AND cf_synced_at IS NOT NULL
          RETURNING id`,
        [user.id],
      );
      won = upd.rowCount === 1;
      if (won) {
        await recordAccountEventTx(client, {
          userId: user.id,
          userEmail: rawEmail,
          kind: 'user_activated',
          ip: req.ip,
          meta: { ...humanActor(user.id, rawEmail) },
        });
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      req.log.error({ err, userId: user.id }, 'activation_failed');
      // Fail closed: an activation we could not commit must not admit anyone.
      return reply.code(403).send({ error: 'not_provisioned' });
    } finally {
      client.release();
    }

    if (won) {
      status = 'active';
    } else {
      // A zero-row result is NEVER treated as "someone else activated me"
      // (round-4 review finding 3). The update may equally have lost because
      // an admin concurrently suspended or deleted the row — assuming the
      // benign case would let a suspended user straight through. Re-read and
      // branch on the row's ACTUAL current status.
      const re = await db.query<{ status: string; cf_synced_at: Date | null }>(
        `SELECT status, cf_synced_at FROM users WHERE id=$1`,
        [user.id],
      );
      status = re.rows[0]?.status ?? 'deleting';
      if (status === 'invited') {
        return reply.code(403).send({ error: 'not_provisioned' });
      }
    }
  }

  if (status !== 'active') {
    // 'suspended' and 'deleting' share one response: a deleting row must not
    // reveal that a deletion is under way.
    req.log.warn({ email: rawEmail, status }, 'cf_access_inactive');
    return reply.code(403).send({ error: 'access_suspended' });
  }

  const last = user.last_seen_at;
  if (!last || Date.now() - last.getTime() > 60_000) {
    // Debounce last_seen_at writes to once per minute per user.
    await db.query(`UPDATE users SET last_seen_at = now() WHERE id = $1`, [user.id]);
  }

  (req as any).userId = user.id;
  (req as any).userEmail = rawEmail;
  (req as any).userDisplayName = user.display_name ?? displayNameClaim;
  (req as any).userTimezone = user.timezone;
  (req as any).userRole = user.role;
```

- [ ] **Step 5: Flip the tests that depended on auto-provisioning**

Run this to find every one of them:

```bash
cd /var/home/jason/Projects/RepOS/api && grep -rln "mintJwt\|cf-access-jwt-assertion\|CF_Authorization" tests/
```

**The 2026-07-26 survey list was wrong in both directions — this is the corrected set, verified at Task 8 by running both suites and reading each file.** Exactly five files fail, each needing a pre-created `users` row via `mkUserWithEmail`:

- `tests/integration/jwks-rotation.test.ts:72` — delete the `CF_ACCESS_ALLOWED_EMAILS = TEST_EMAIL` line and pre-create `TEST_EMAIL` as `active`
- `tests/integration/scope-enforcement.test.ts`
- `tests/integration/admin-feedback.test.ts` — **two** describe blocks, each needing both `boss@` and `peon@`
- `tests/middleware/require-cf-access-only.test.ts`
- `tests/middleware/admin-emails.test.ts` — **omitted from the original survey.** Four cases, all of which stop at `403 not_invited` and never reach the admin-check branch they exist to test. Its header comment documented the auto-provisioning reliance outright. The `grep` above does find it; only the hand-written list missed it.

**Needs no flip** — each already pre-creates a `users` row with the *same* email it mints, and `status` takes migration 080's `DEFAULT 'active'`:

- `tests/integration/signout-everywhere.test.ts`
- `tests/integration/account-deletion-cascade.test.ts`
- `tests/integration/contamination/account-deletion-contamination.test.ts`
- `tests/integration/contamination/signout-everywhere-contamination.test.ts`

**Not on the CF Access path at all** — both build a bare Fastify instance and authenticate with `x-admin-key`/`origin` headers only, never minting a JWT, so there is nothing to flip:

- `tests/integration/csrf-origin.test.ts`
- `tests/integration/admin-gate.test.ts`

None of the five needs an *assertion* changed. Every failure is the same shape — the row does not exist, so the response is `not_invited` — so pre-creating the row is the whole fix. No test in the repo positively asserts that auto-provisioning works.

Note `src/bootstrap-guards.ts` also reads `CF_ACCESS_ALLOWED_EMAILS` and `tests/unit/startup-guards.test.ts` asserts on its allow-list count. Both are deliberately **out of scope here** — a later task owns them (see the `bootstrap-guards.ts:39-47` row in the impact table). Leaving them means the env var survives as vestigial config until then, which is expected, not an oversight.

Also strip the `CF_ACCESS_ALLOWED_EMAILS` save/restore plumbing from `tests/helpers/cf-access-jwt.ts` (the `SavedEnv` field, the two assignments, and the `allowedEmails` option) — the env var no longer exists.

**Do not** re-add auto-provisioning to make a test pass. If a test needs a user, the test creates it.

- [ ] **Step 6: Run the gate tests, then the full suite**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/middleware/cf-access-gate.test.ts`
Expected: PASS, 13 tests.

> **Note for the implementer — the round-4 re-read fix was untested as originally planned.** Replacing the entire zero-row re-read block with a bare `status = 'active'` (exactly the hole finding 3 identified) passed all 12 original tests. The `lostrace` case suspends the row *before* the request, so the gate's opening SELECT already reads `suspended`, `status === 'invited'` is false, and the activation block — including the re-read — is never entered; it passes through the ordinary inactive-status branch instead. Its comment claiming a "statement-level advisory hook" described something the test did not do.
>
> The added `BETWEEN the read and the conditional UPDATE` case forces the interleaving deterministically by hooking the gate's own identity SELECT via `vi.spyOn(db, 'query')`, letting it resolve, then suspending the row before returning. Note that hooking `db.connect` instead does **not** work — `pool.query()` acquires a client internally, so the first `connect` of the request is the SELECT's own, and the request times out.
>
> Also verified: dropping the `cf_synced_at === null` early check is *not* detectable by any test, and that is correct rather than a gap. The conditional UPDATE's `AND cf_synced_at IS NOT NULL` carries the same precondition, so an invited+NULL row yields `403 not_provisioned` by either route. The early check is defence in depth, not the enforcement point.

Run: `cd /var/home/jason/Projects/RepOS/api && npm test && npm run test:integration`
Expected: PASS. Every remaining failure is a test that assumed auto-provisioning; fix the test.

- [ ] **Step 7: Commit**

```bash
cd /var/home/jason/Projects/RepOS && git add \
  api/src/middleware/cfAccess.ts \
  api/tests/middleware/cf-access-gate.test.ts \
  api/tests/helpers/program-fixtures.ts \
  api/tests/helpers/cf-access-jwt.ts \
  api/tests/middleware/require-cf-access-only.test.ts \
  api/tests/middleware/admin-emails.test.ts \
  api/tests/integration/scope-enforcement.test.ts \
  api/tests/integration/admin-feedback.test.ts \
  api/tests/integration/jwks-rotation.test.ts
git commit -m "$(cat <<'EOF'
feat(w9)!: deny-by-default CF Access gate with provisioned activation

Removes the auto-provisioning INSERT (Q2) and the CF_ACCESS_ALLOWED_EMAILS
allow-list (Q4). An unknown email is 403 not_invited; an invited row with a
NULL cf_synced_at is 403 not_provisioned (Q17b); activation is a conditional
UPDATE whose zero-row result re-reads actual status rather than assuming a
benign race (Q21). Existing tests that relied on auto-provisioning now create
their own rows.

BREAKING CHANGE: CF_ACCESS_ALLOWED_EMAILS is no longer read.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: `users.role` replaces `REPOS_ADMIN_EMAILS`

The comment at `cfAccess.ts:265` claims "Migration 063 reserves `users.role`" — that migration was never written. Task 2 actually built it; this task consumes it.

**Files:**
- Modify: `api/src/middleware/cfAccess.ts` (`isAdminEmail` → role check, new `requireCfAccessAdmin`)
- Modify: `api/src/app.ts` (the `isAdminEmail` import and the `is_admin` field)
- Delete: `api/tests/middleware/admin-emails.test.ts`
- Test: `api/tests/middleware/admin-role.test.ts`

> **Line numbers in this task are stale — locate by content.** Task 8 rewrote the middle of `cfAccess.ts`, shifting everything below it by ~70 lines. As executed: `isAdminEmail` was at 245 (not 173), `rejectIfNotAdminEmail` at 258 (not 185), its two call sites at 306 and 335 (not 236 and 267), the stale `Migration 063` comment at 335-336, and the `app.ts` targets at 26 and 112 (those two were still correct).

**Interfaces:**
- Consumes: `req.userRole` (Task 8).
- Produces:
  - `isAdminRequest(req: FastifyRequest): boolean`
  - `requireCfAccessAdmin(opts?: { rejectBearer?: boolean }): preHandler`
  - `/api/me` returns `is_admin` derived from `users.role` (contract unchanged for the frontend).

- [ ] **Step 1: Write the failing test**

Create `api/tests/middleware/admin-role.test.ts`:

```ts
// Q3 + Q20 — role, not an env allow-list. And user-management routes reject
// the X-Admin-Key path outright: requireAdminKeyOrCfAccess returns on the
// admin-key branch WITHOUT setting req.userId or req.userEmail, so there is no
// actor — self-lockout guards have no "self" and audit rows have no attribution.
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { requireCfAccessAdmin } from '../../src/middleware/cfAccess.js';
import { setupTestJwks, type TestJwksHandle } from '../helpers/cf-access-jwt.js';
import { mkUserWithEmail, cleanupUser } from '../helpers/program-fixtures.js';

let jwks: TestJwksHandle;
let app: Awaited<ReturnType<typeof buildProbe>>;
const created: string[] = [];
let adminEmail: string;
let memberEmail: string;

async function buildProbe() {
  const a = Fastify({ logger: false });
  a.get('/probe', { preHandler: requireCfAccessAdmin() }, async () => ({ ok: true }));
  a.delete('/probe-strict', { preHandler: requireCfAccessAdmin({ rejectBearer: true }) }, async () => ({ ok: true }));
  await a.ready();
  return a;
}

beforeAll(async () => {
  jwks = await setupTestJwks();
  app = await buildProbe();
  adminEmail = `vitest.role-admin-${randomUUID().slice(0, 8)}@repos.test`;
  memberEmail = `vitest.role-member-${randomUUID().slice(0, 8)}@repos.test`;
  created.push((await mkUserWithEmail(adminEmail, { role: 'admin', status: 'active' })).id);
  created.push((await mkUserWithEmail(memberEmail, { role: 'member', status: 'active' })).id);
});

afterAll(async () => {
  for (const id of created) await cleanupUser(id);
  await app.close();
  await jwks.teardown();
});

describe('requireCfAccessAdmin (Q3, Q20)', () => {
  it('allows role=admin', async () => {
    const r = await app.inject({
      method: 'GET', url: '/probe',
      headers: { 'cf-access-jwt-assertion': await jwks.mintJwt(adminEmail) },
    });
    expect(r.statusCode).toBe(200);
  });

  it('403s role=member', async () => {
    const r = await app.inject({
      method: 'GET', url: '/probe',
      headers: { 'cf-access-jwt-assertion': await jwks.mintJwt(memberEmail) },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json<{ error: string }>().error).toBe('not_an_admin');
  });

  it('rejects the X-Admin-Key path even with a valid key', async () => {
    const saved = process.env.ADMIN_API_KEY;
    process.env.ADMIN_API_KEY = 'valid-key';
    try {
      const r = await app.inject({
        method: 'GET', url: '/probe',
        headers: { 'x-admin-key': 'valid-key' },
      });
      expect(r.statusCode).toBe(403);
      expect(r.json<{ error: string }>().error).toBe('cf_access_required');
    } finally {
      if (saved === undefined) delete process.env.ADMIN_API_KEY;
      else process.env.ADMIN_API_KEY = saved;
    }
  });

  it('401s with no CF Access JWT at all', async () => {
    const r = await app.inject({ method: 'GET', url: '/probe' });
    expect(r.statusCode).toBe(401);
  });

  it('rejectBearer:true 403s an Authorization: Bearer header before JWT validation', async () => {
    const r = await app.inject({
      method: 'DELETE', url: '/probe-strict',
      headers: { authorization: 'Bearer whatever' },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json<{ error: string }>().error).toBe('cf_access_required');
  });

  // NOTE: there is deliberately NO "the gate ignores the old admin-emails env
  // var" test here. Writing one means writing an env read for that variable,
  // and Task 19's sweep matches raw file text — it cannot tell a real reader
  // from one inside a test or a comment, so this file would become the sweep's
  // only remaining offender and fail it deterministically. The sweep is also
  // the strictly stronger statement: "no file reads it anywhere" subsumes
  // "setting it changes nothing here". This comment names no variable for the
  // same reason.
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/middleware/admin-role.test.ts`
Expected: FAIL — `requireCfAccessAdmin is not exported`

- [ ] **Step 3: Replace the email check with a role check**

In `api/src/middleware/cfAccess.ts`, delete `isAdminEmail` (lines 173–183) and `rejectIfNotAdminEmail` (lines 185–201). Replace with:

```ts
// Q3 — users.role replaces REPOS_ADMIN_EMAILS. The comment that used to live
// at line 265 claimed "Migration 063 reserves users.role"; that migration was
// never written (060-062 then a jump to 070). Migration 080 actually builds it.
//
// Fail-closed: the role is only ever read from a row the gate already
// resolved, so an unauthenticated request can never be admin.
export function isAdminRequest(req: FastifyRequest): boolean {
  return (req as { userRole?: string }).userRole === 'admin';
}

/** Returns true if the reply was already sent (caller must short-circuit). */
function rejectIfNotAdminRole(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!isAdminRequest(req)) {
    req.log.warn(
      { userEmail: (req as { userEmail?: string }).userEmail },
      'admin_check_rejected',
    );
    reply.code(403).send({ error: 'not_an_admin' });
    return true;
  }
  return false;
}
```

Inside `requireAdminKeyOrCfAccess`, replace **both** calls to `rejectIfNotAdminEmail(req, reply)` (lines 236 and 267) with `rejectIfNotAdminRole(req, reply)`, and delete the stale `Migration 063` comment block at lines 263–266, replacing it with:

```ts
      // Per D10 as re-based by W9 Q3: authorization is users.role, resolved by
      // requireCfAccess above. There is no env allow-list any more.
```

Then append the new gate:

```ts
/**
 * Q20 — the user-management gate. CF Access JWT + role='admin', with the
 * X-Admin-Key path rejected outright.
 *
 * Why reject the admin key: requireAdminKeyOrCfAccess returns on its admin-key
 * branch WITHOUT setting req.userId or req.userEmail, so there is no actor —
 * the self-lockout guards (Q13) have no "self" to compare against and audit
 * rows have no attribution. Precedent already exists at account.ts:298, which
 * gates DELETE /api/me with requireCfAccessOnly on identical reasoning. No
 * operator automation needs to manage users.
 *
 * Q32 — this is NOT `requireFreshCfAccess`. It performs no token-age check and
 * makes no re-authentication guarantee; it requires a valid CF Access JWT and
 * the admin role, nothing more. Renaming the existing misleading flag is a
 * follow-up, out of scope for W9.
 *
 * `rejectBearer` is used by DELETE: a stolen bearer must never delete a user.
 */
export function requireCfAccessAdmin(opts: { rejectBearer?: boolean } = {}) {
  return async function cfAccessAdminGate(req: FastifyRequest, reply: FastifyReply) {
    if (opts.rejectBearer) {
      const auth = req.headers.authorization;
      if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
        req.log.warn({ path: req.url }, 'bearer_rejected_on_admin_users_route');
        return reply.code(403).send({ error: 'cf_access_required' });
      }
    }
    const adminKeyHeader = req.headers['x-admin-key'];
    if (typeof adminKeyHeader === 'string' && adminKeyHeader.length > 0) {
      req.log.warn({ path: req.url }, 'admin_key_rejected_on_user_management_route');
      return reply.code(403).send({ error: 'cf_access_required' });
    }
    await requireCfAccess(req, reply);
    if (reply.sent) return;
    if (rejectIfNotAdminRole(req, reply)) return;
    // Stamp authMode so the chained csrfOrigin preHandler enforces the Origin
    // guard — a stolen JWT replayed cross-origin must still be blocked.
    (req as any).authMode = 'cf_access';
  };
}
```

- [ ] **Step 4: Re-derive `is_admin` in `/api/me`**

In `api/src/app.ts` line 26, change the import to `import { requireCfAccess, isAdminRequest } from './middleware/cfAccess.js';`, and line 112 to:

```ts
      // Q3 — re-derived from users.role. The response field name is unchanged
      // so the frontend contract does not break.
      is_admin: isAdminRequest(req),
```

- [ ] **Step 5: Delete the obsolete test and fix its dependents**

```bash
cd /var/home/jason/Projects/RepOS/api && git rm tests/middleware/admin-emails.test.ts
```

`tests/integration/admin-feedback.test.ts` sets `REPOS_ADMIN_EMAILS='boss@repos.test'` across its two describe blocks. Replace that plumbing with a `mkUserWithEmail('boss@repos.test', { role: 'admin' })` fixture created in `beforeAll` and cleaned up in `afterAll`.

> **As executed, Task 8 had already added those fixtures** (it needed the rows to exist at all under the deny-by-default gate) and created `boss@` with `role: 'admin'`. So this step was pure deletion of the eight `REPOS_ADMIN_EMAILS` references — no fixture had to be written. The upside is that its two `/api/me` `is_admin` assertions now genuinely exercise `users.role`: mutating `isAdminRequest` to return `true` fails both `returns is_admin=false for a non-admin email` and `403s a non-admin CF Access email`. Without that coverage the `is_admin` re-derivation in Step 4 would be unguarded, and a regression would show the admin UI to every user.

Grep for any remaining reader — run from the repo root, and it must return nothing:

```bash
cd /var/home/jason/Projects/RepOS && grep -rnE "process\.env\.(REPOS_ADMIN_EMAILS|CF_ACCESS_ALLOWED_EMAILS)|isAdminEmail" api/src api/tests
```

**Match env READS, not the names.** A bare-name grep is unsatisfiable by
construction: this wave deliberately writes the old names into prose that has
to survive — migration 080's mapping header (`CF_ACCESS_ALLOWED_EMAILS ->
users.status`), the replacement comment in `cfAccess.ts`, and the boot-guard
and runbook text all cite them to explain what was removed. Deleting that
documentation to satisfy a grep would be the tail wagging the dog. The
invariant that actually matters is that **no code reads them**, which is what
`process\.env\.` anchors. `isAdminEmail` stays a bare match because it is an
identifier, not prose, and Task 9 deletes it outright.

`api/tests` is in scope on purpose, and this grep is only satisfiable once the
four existing test readers above are gone: `admin-emails.test.ts` (deleted),
`admin-feedback.test.ts` (fixture instead of env), `jwks-rotation.test.ts:72`,
and the `CF_ACCESS_ALLOWED_EMAILS` plumbing in `helpers/cf-access-jwt.ts`. Do
not add a new test that writes either variable to prove the gate ignores it —
Task 19's sweep asserts the stronger property statically.

- [ ] **Step 6: Run tests**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/middleware/admin-role.test.ts && npm test && npm run test:integration`
Expected: PASS throughout.

- [ ] **Step 7: Commit**

```bash
cd /var/home/jason/Projects/RepOS && git add \
  api/src/middleware/cfAccess.ts \
  api/src/app.ts \
  api/tests/middleware/admin-role.test.ts \
  api/tests/middleware/admin-emails.test.ts \
  api/tests/integration/admin-feedback.test.ts
git commit -m "$(cat <<'EOF'
feat(w9)!: users.role replaces REPOS_ADMIN_EMAILS (Q3, Q20)

isAdminEmail collapses to isAdminRequest reading req.userRole, and
requireCfAccessAdmin gates the user-management routes: CF Access JWT +
role=admin, X-Admin-Key rejected because that branch sets no actor. /api/me
keeps returning is_admin, now re-derived from the column, so the frontend
contract is unchanged. Q32: this makes no re-authentication guarantee.

BREAKING CHANGE: REPOS_ADMIN_EMAILS is no longer read.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Invite mailer (Resend)

**Files:**
- Create: `api/src/services/inviteMailer.ts`
- Test: `api/tests/services/invite-mailer.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `initialIdempotencyKey(userId: string, invitedAt: Date): string`
  - `resendIdempotencyKey(userId: string): string`
  - `renderInviteHtml(input: InviteCopyInput): string`, `renderInviteText(input: InviteCopyInput): string`
  - `buildInviteRequest(input: InviteCopyInput): InviteRequest` — render ONCE, persist, replay
  - `sendInviteRequest(request: InviteRequest, idempotencyKey: string, opts?): Promise<{ messageId: string }>`
  - `class MailerError extends Error { code: 'mail_not_configured' | 'mail_http_error' | 'mail_timeout' }`
  - `__setMailFetchForTesting(f: typeof fetch | null): void`
  - `SUPPORT_CONTACT = 'jason.meyer1@gmail.com'`, `APP_URL = 'https://repos.jpmtech.com'`

- [ ] **Step 1: Write the failing test**

Create `api/tests/services/invite-mailer.test.ts`:

```ts
// Q5, Q30, Q38 + the G14 email-content requirements.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildInviteRequest,
  sendInviteRequest,
  serializeInviteRequest,
  parseInviteRequest,
  renderInviteHtml,
  renderInviteText,
  initialIdempotencyKey,
  resendIdempotencyKey,
  __setMailFetchForTesting,
  APP_URL,
} from '../../src/services/inviteMailer.js';

let calls: Array<{ url: string; init: RequestInit }>;
let respond: () => Promise<Response>;

beforeEach(() => {
  process.env.RESEND_API_KEY = 'test-key';
  process.env.INVITE_FROM_EMAIL = 'repos@send.jpmtech.com';
  calls = [];
  respond = async () =>
    new Response(JSON.stringify({ id: 'msg_123' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  __setMailFetchForTesting(async (input, init = {}) => {
    calls.push({ url: String(input), init });
    // Honour init.signal — a double that ignores it makes the Q38 deadline
    // test pass vacuously (the abort fires, nothing observes it).
    return abortable(respond(), init.signal);
  });
});

/** Reject with an AbortError as soon as `signal` aborts. */
function abortable(p: Promise<Response>, signal?: AbortSignal | null): Promise<Response> {
  if (!signal) return p;
  return Promise.race([
    p,
    new Promise<Response>((_, reject) => {
      const fail = () =>
        reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
      if (signal.aborted) fail();
      else signal.addEventListener('abort', fail, { once: true });
    }),
  ]);
}

afterEach(() => {
  __setMailFetchForTesting(null);
  delete process.env.RESEND_API_KEY;
  delete process.env.INVITE_FROM_EMAIL;
});

describe('idempotency keys (Q30)', () => {
  it('the initial key is stable for the same user + invited_at', () => {
    const at = new Date('2026-07-26T12:00:00Z');
    const a = initialIdempotencyKey('u1', at);
    const b = initialIdempotencyKey('u1', new Date('2026-07-26T12:00:00Z'));
    expect(a).toBe(b);
  });

  it('a different user or a different invited_at yields a different key', () => {
    const at = new Date('2026-07-26T12:00:00Z');
    expect(initialIdempotencyKey('u1', at)).not.toBe(initialIdempotencyKey('u2', at));
    expect(initialIdempotencyKey('u1', at)).not.toBe(
      initialIdempotencyKey('u1', new Date('2026-07-26T12:00:01Z')),
    );
  });

  it('an explicit resend is a FRESH key every time — a deliberate second delivery', () => {
    expect(resendIdempotencyKey('u1')).not.toBe(resendIdempotencyKey('u1'));
  });

  it('both key forms fit Resend’s 1–256 character limit', () => {
    // Verified against Resend’s idempotency docs on 2026-07-30: the header
    // accepts 1–256 characters and rejects anything else with a 400
    // invalid_idempotency_key. Both generators are derived, so a future change
    // to either format could silently cross that line and turn every invite
    // into a hard failure. Pin the external constraint here rather than
    // discovering it in production.
    const uuid = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
    for (const key of [initialIdempotencyKey(uuid, new Date()), resendIdempotencyKey(uuid)]) {
      expect(key.length).toBeGreaterThanOrEqual(1);
      expect(key.length).toBeLessThanOrEqual(256);
    }
  });
});

describe('copy (G14)', () => {
  const input = { toEmail: 'new@repos.test', invitedByEmail: 'admin@repos.test' };

  it('names the inviter, carries the Beta disclaimer, the Google instruction, a contact path and the link', () => {
    for (const body of [renderInviteHtml(input), renderInviteText(input)]) {
      expect(body).toContain('admin@repos.test');
      expect(body.toLowerCase()).toContain('beta');
      // The repos Access application allows ONLY the Google IdP; an invitee
      // trying a non-Google address is bounced with no in-app explanation.
      expect(body).toContain('Sign in with the Google account for this exact address');
      expect(body).toContain('new@repos.test');
      expect(body).toContain(APP_URL);
    }
  });

  it('the HTML uses inline styles and a table layout, and declares no @font-face', () => {
    const html = renderInviteHtml(input);
    expect(html).toContain('<table');
    expect(html).toContain('style=');
    expect(html).not.toContain('@font-face');
    expect(html).toContain('#4D8DFF');
    expect(html).toContain('#10141C');
  });

  it('renders deterministically across a large jump in wall-clock time', () => {
    // Q30 is protected by persisting the request, not by this — a
    // non-deterministic renderer would simply be frozen at first render. But a
    // template that embedded the date would still make the SAME invite read
    // differently to a reader than to anyone reasoning about it later, so pin
    // purity anyway.
    //
    // Rendering twice back-to-back does not test this: a timestamp rounded to
    // seconds, minutes or days — and often even a millisecond one — lands on
    // the same tick. Move the clock instead.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      const html1 = renderInviteHtml(input);
      const text1 = renderInviteText(input);
      vi.setSystemTime(new Date('2027-06-15T13:45:12.500Z'));
      expect(renderInviteHtml(input)).toBe(html1);
      expect(renderInviteText(input)).toBe(text1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('the plain-text alternative contains no markup', () => {
    expect(renderInviteText(input)).not.toMatch(/<[a-z]/i);
  });

  it('escapes both addresses into the HTML instead of interpolating them raw', () => {
    // Both addresses are admin-supplied and land inside markup. A local part
    // may legally be a quoted string, so `"a<b"@example.test` is a valid
    // address that would otherwise open a tag mid-document and corrupt the
    // email — and the same hole lets an admin inject markup into a message
    // delivered to someone else.
    const html = renderInviteHtml({
      toEmail: '"a<b"@example.test',
      invitedByEmail: '<script>x</script>@evil.test',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;b&quot;@example.test');
  });
});

describe('buildInviteRequest / sendInviteRequest', () => {
  const TO = 'new@repos.test';
  const copy = { toEmail: TO, invitedByEmail: 'admin@repos.test' };

  it('POSTs the built request with the from address, both parts and the key', async () => {
    const r = await sendInviteRequest(buildInviteRequest(copy), 'k-1', TO);
    expect(r.messageId).toBe('msg_123');
    expect(calls[0].url).toBe('https://api.resend.com/emails');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-key');
    expect(headers['Idempotency-Key']).toBe('k-1');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.from).toContain('repos@send.jpmtech.com');
    expect(body.to).toEqual(['new@repos.test']);
    expect(body.html).toBeTruthy();
    expect(body.text).toBeTruthy();
  });

  it('Q30: replaying a persisted request is byte-identical even after the config and copy change', async () => {
    // The whole point. Build once, then change everything the renderer reads —
    // this is what a redeploy inside Resend's 24h window looks like. The replay
    // must still produce the SAME key and the SAME bytes, so Resend collapses
    // it into the original delivery instead of sending a second one.
    const persisted = buildInviteRequest(copy);
    await sendInviteRequest(persisted, 'k-1', TO);

    process.env.INVITE_FROM_EMAIL = 'somewhere-else@send.jpmtech.com';
    // Round-trip through storage exactly as the real path does: serialized to
    // the TEXT column `users.invite_request` (migration 081) and parsed back.
    // TEXT, not jsonb — jsonb canonicalises key order, which is why the
    // canonical field order lives in serializeInviteRequest.
    const replayed = parseInviteRequest(serializeInviteRequest(persisted), TO);
    await sendInviteRequest(replayed, 'k-1', TO);

    const h = calls.map((c) => (c.init.headers as Record<string, string>)['Idempotency-Key']);
    expect(h[1]).toBe(h[0]);
    expect(String(calls[1].init.body)).toBe(String(calls[0].init.body));
  });

  it('a rebuilt request DOES drift when config changes — which is why it is persisted', async () => {
    // The negative control for the case above: rebuilding is exactly what
    // cannot be done on a retry.
    const a = buildInviteRequest(copy);
    process.env.INVITE_FROM_EMAIL = 'somewhere-else@send.jpmtech.com';
    const b = buildInviteRequest(copy);
    expect(b.from).not.toBe(a.from);
  });

  it.each([
    ['null', null],
    ['a non-object', 'nope'],
    ['an array', []],
    ['a missing html part', { from: 'a', to: ['b'], subject: 'c', text: 'd' }],
    ['an empty recipient list', { from: 'a', to: [], subject: 'c', html: 'd', text: 'e' }],
  ])('refuses to send a persisted request that is %s', async (_label, bad) => {
    await expect(
      sendInviteRequest(bad as never, 'k-1', TO),
    ).rejects.toMatchObject({ code: 'mail_request_invalid' });
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['two recipients', ['a@x.test', 'b@x.test']],
    ['the wrong recipient', ['someone-else@x.test']],
    ['no recipients', []],
  ])('refuses a persisted request addressed to %s', async (_label, to) => {
    const req = { ...buildInviteRequest(copy), to: to as string[] };
    await expect(sendInviteRequest(req, 'k-1', TO)).rejects.toMatchObject({
      code: 'mail_request_invalid',
    });
    // Being wrong about the recipient is the one corruption that actively
    // harms a third party, so nothing may reach the wire.
    expect(calls).toHaveLength(0);
  });

  it('serializes in a fixed field order, so a storage round-trip cannot change the bytes', async () => {
    // PostgreSQL jsonb sorts keys by length then bytewise, rewriting
    // {from,to,subject,html,text} as {to,from,html,text,subject}. A replay
    // rebuilt from that ordering must still produce identical bytes.
    const original = buildInviteRequest(copy);
    const pgOrdered = JSON.parse(
      JSON.stringify({
        to: original.to, from: original.from, html: original.html,
        text: original.text, subject: original.subject,
      }),
    );
    expect(Object.keys(pgOrdered)).not.toEqual(Object.keys(original));
    expect(serializeInviteRequest(pgOrdered)).toBe(serializeInviteRequest(original));

    await sendInviteRequest(original, 'k-1', TO);
    await sendInviteRequest(pgOrdered, 'k-1', TO);
    expect(String(calls[1].init.body)).toBe(String(calls[0].init.body));
  });

  it('parseInviteRequest fails closed on unparseable or mis-addressed storage', () => {
    const good = serializeInviteRequest(buildInviteRequest(copy));
    expect(parseInviteRequest(good, TO).to).toEqual([TO]);
    expect(() => parseInviteRequest('not json', TO)).toThrow(/valid JSON/);
    expect(() => parseInviteRequest(good, 'other@x.test')).toThrow(/exactly the invited user/);
  });

  it('throws mail_not_configured when RESEND_API_KEY is unset — never at boot', async () => {
    delete process.env.RESEND_API_KEY;
    await expect(sendInviteRequest(buildInviteRequest(copy), 'k', TO)).rejects.toMatchObject({
      code: 'mail_not_configured',
    });
  });

  it('buildInviteRequest throws when INVITE_FROM_EMAIL is unset', () => {
    delete process.env.INVITE_FROM_EMAIL;
    expect(() => buildInviteRequest(copy)).toThrow(/INVITE_FROM_EMAIL/);
  });

  it('surfaces a non-2xx as mail_http_error', async () => {
    respond = async () => new Response(JSON.stringify({ message: 'nope' }), { status: 422 });
    await expect(sendInviteRequest(buildInviteRequest(copy), 'k', TO)).rejects.toMatchObject({
      code: 'mail_http_error',
    });
  });

  // A malformed 2xx is a refusal, not a success with a blank id. Defaulting
  // here would let Task 11 stamp invite_sent_at with an empty
  // invite_message_id — the invite recorded as delivered with no handle on the
  // actual message — and the `null` body would escape as a raw TypeError that
  // callers classify as an unknown error rather than a mail failure.
  for (const [label, payload] of [
    ['an empty object', '{}'],
    ['a bare null', 'null'],
    ['an empty id', '{"id":""}'],
    ['a non-string id', '{"id":123}'],
    ['an array', '[]'],
  ] as const) {
    it(`rejects a 200 carrying ${label}`, async () => {
      respond = async () =>
        new Response(payload, { status: 200, headers: { 'content-type': 'application/json' } });
      await expect(sendInviteRequest(buildInviteRequest(copy), 'k', TO)).rejects.toMatchObject({
        code: 'mail_http_error',
      });
    });
  }

  it('Q38: aborts on deadline', async () => {
    respond = async () => { await new Promise((r) => setTimeout(r, 200)); return new Response('{}', { status: 200 }); };
    await expect(
      sendInviteRequest(buildInviteRequest(copy), 'k', TO, { timeoutMs: 40 }),
    ).rejects.toMatchObject({ code: 'mail_timeout' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/services/invite-mailer.test.ts`
Expected: FAIL — `Cannot find module '../../src/services/inviteMailer.js'`

- [ ] **Step 3: Write the implementation**

Create `api/src/services/inviteMailer.ts`:

```ts
// W9 — the invite email (Q5, Q30).
//
// Resend, sending from the send.jpmtech.com subdomain: the subdomain keeps
// root-domain SPF/DKIM untouched, so a misconfiguration here cannot break
// Proton-hosted mail on jpmtech.com.
//
// There is NO invite token and no magic link (Q6). The email links to the app;
// authentication is CF Access + Google, authorization is the pre-created row.
// A token would be a second, weaker credential path into the same app.
import { createHash, randomUUID } from 'node:crypto';

export const APP_URL = 'https://repos.jpmtech.com';
/** G14 requires a documented contact path in every Beta user's invite. */
export const SUPPORT_CONTACT = 'jason.meyer1@gmail.com';

const DEFAULT_TIMEOUT_MS = 10_000;

export const INVITE_SUBJECT = 'You have been invited to RepOS (Beta)';

export type MailerErrorCode =
  | 'mail_not_configured'
  | 'mail_http_error'
  | 'mail_timeout'
  /** A persisted request is missing, unparseable, or addressed to the wrong user. */
  | 'mail_request_invalid';

export class MailerError extends Error {
  readonly code: MailerErrorCode;
  readonly detail?: string;
  constructor(code: MailerErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'MailerError';
    this.code = code;
    this.detail = detail;
  }
}

let mailFetch: typeof fetch | null = null;
export function __setMailFetchForTesting(f: typeof fetch | null): void {
  mailFetch = f;
}

/**
 * Q30 — derived from the user id + invited_at, so a transport timeout that is
 * retried cannot double-send.
 */
export function initialIdempotencyKey(userId: string, invitedAt: Date): string {
  return `invite-${createHash('sha256')
    .update(`${userId}:${invitedAt.toISOString()}`)
    .digest('hex')
    .slice(0, 32)}`;
}

/**
 * Q30 — an explicit admin "resend" is a DELIBERATE second delivery, so it must
 * defeat Resend's idempotency window rather than ride it.
 */
export function resendIdempotencyKey(userId: string): string {
  return `resend-${userId}-${randomUUID()}`;
}

export interface InviteCopyInput {
  toEmail: string;
  invitedByEmail: string;
}

// Gmail strips @font-face, so Inter Tight / JetBrains Mono cannot be relied on.
// System-font stack + the brand palette + inline CSS + table layout.
/**
 * Both addresses are admin-supplied and land inside markup. A local part may
 * legally be a quoted string, so `"a<b"@example.test` is a valid address that
 * would otherwise open a tag mid-document — and the same hole lets an admin
 * inject markup into a message delivered to someone else. The text part needs
 * no equivalent.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function renderInviteHtml(input: InviteCopyInput): string {
  const toEmail = escapeHtml(input.toEmail);
  const invitedByEmail = escapeHtml(input.invitedByEmail);
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#0A0D12;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0A0D12;padding:24px 0;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="max-width:520px;background:#10141C;border-radius:12px;padding:28px;font-family:${FONT_STACK};color:#E6EAF2;">
      <tr><td style="font-size:20px;font-weight:700;padding-bottom:12px;">You're in.</td></tr>
      <tr><td style="font-size:14px;line-height:22px;padding-bottom:16px;">
        <strong>${invitedByEmail}</strong> invited you to RepOS — a training log that tracks your
        lifts, your bodyweight, and whether your program is actually working.
      </td></tr>
      <tr><td style="font-size:13px;line-height:20px;padding-bottom:16px;color:#F5B544;">
        This is a Beta. Expect rough edges, occasional downtime, and changes without notice.
        Your data is backed up nightly, but do not treat it as your only copy.
      </td></tr>
      <tr><td style="font-size:14px;line-height:22px;padding-bottom:16px;">
        <strong>Sign in with the Google account for this exact address</strong> —
        <span style="font-family:monospace;">${toEmail}</span>. Any other address will be turned
        away at the door with no explanation.
      </td></tr>
      <tr><td style="padding-bottom:18px;">
        <a href="${APP_URL}" style="display:inline-block;background:#4D8DFF;color:#0A0D12;
           text-decoration:none;font-weight:700;font-size:14px;padding:12px 20px;border-radius:8px;">
           OPEN REPOS</a>
      </td></tr>
      <tr><td style="font-size:12px;line-height:18px;color:#8A93A6;">
        Link: <a href="${APP_URL}" style="color:#4D8DFF;">${APP_URL}</a><br/>
        Stuck? Reply to this email or write to ${SUPPORT_CONTACT}.
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

export function renderInviteText({ toEmail, invitedByEmail }: InviteCopyInput): string {
  return [
    "You're in.",
    '',
    `${invitedByEmail} invited you to RepOS — a training log that tracks your lifts,`,
    'your bodyweight, and whether your program is actually working.',
    '',
    'THIS IS A BETA. Expect rough edges, occasional downtime, and changes without',
    'notice. Your data is backed up nightly, but do not treat it as your only copy.',
    '',
    `Sign in with the Google account for this exact address: ${toEmail}`,
    'Any other address will be turned away at the door with no explanation.',
    '',
    `Open RepOS: ${APP_URL}`,
    '',
    `Stuck? Reply to this email or write to ${SUPPORT_CONTACT}.`,
  ].join('\n');
}

/**
 * The exact Resend request body. Q30 requires that a retry after a lost
 * acknowledgement cannot deliver twice, and Resend deduplicates only
 * BYTE-IDENTICAL requests sharing a key — so the request has to be frozen the
 * first time and replayed verbatim, not re-rendered.
 *
 * Re-rendering cannot satisfy Q30: `INVITE_FROM_EMAIL` is read from the
 * environment and the copy ships with the deployment, so either the retry's
 * body drifts (409, invite blocked for 24h) or the key is recomputed to match
 * it (a second delivery — exactly what Q30 forbids). Callers therefore build
 * this once, persist it, and replay it on every attempt.
 */
export interface InviteRequest {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
}

/** Render the request. Call ONCE per invite, persist the result, then replay. */
export function buildInviteRequest(input: InviteCopyInput): InviteRequest {
  const from = process.env.INVITE_FROM_EMAIL;
  if (!from) {
    throw new MailerError(
      'mail_not_configured',
      'INVITE_FROM_EMAIL must be set to build an invite',
    );
  }
  return {
    from: `RepOS <${from}>`,
    to: [input.toEmail],
    subject: INVITE_SUBJECT,
    html: renderInviteHtml(input),
    text: renderInviteText(input),
  };
}

/**
 * The canonical wire form. Byte-identity is the whole point, so the body is
 * serialized in a FIXED field order rather than relying on the object's own
 * key order — which does not survive storage. (PostgreSQL's jsonb sorts keys
 * by length then bytewise: PG16 rewrites {from,to,subject,html,text} as
 * {to,from,html,text,subject}. A replay reconstructed from such a round-trip
 * would stringify differently and Resend would treat it as a new request.)
 */
export function serializeInviteRequest(request: InviteRequest): string {
  return JSON.stringify({
    from: request.from,
    to: request.to,
    subject: request.subject,
    html: request.html,
    text: request.text,
  });
}

/**
 * Validate a persisted request before replaying it. It has round-tripped
 * through storage, so it is untrusted input by the time it comes back:
 * validate, never default — sending a half-shaped body under the original key
 * is how a "replay" quietly becomes a different request.
 *
 * `expectedTo` is required because the recipient is the one field where being
 * wrong is actively harmful: a corrupted or mismatched row must never mail a
 * third party. Exactly one recipient, and it must be the lifecycle target.
 */
export function assertInviteRequest(
  r: unknown,
  expectedTo: string,
): asserts r is InviteRequest {
  const o = r as Record<string, unknown> | null;
  const shaped =
    o !== null && typeof o === 'object' && !Array.isArray(o) &&
    typeof o.from === 'string' && o.from !== '' &&
    typeof o.subject === 'string' && o.subject !== '' &&
    typeof o.html === 'string' && o.html !== '' &&
    typeof o.text === 'string' && o.text !== '' &&
    Array.isArray(o.to);
  if (!shaped) {
    throw new MailerError(
      'mail_request_invalid',
      'the persisted invite request is missing or malformed — refusing to send',
      JSON.stringify(r)?.slice(0, 200),
    );
  }
  const to = o.to as unknown[];
  if (to.length !== 1 || to[0] !== expectedTo) {
    throw new MailerError(
      'mail_request_invalid',
      'the persisted invite request does not address exactly the invited user',
      `expected [${expectedTo}], found ${JSON.stringify(to)?.slice(0, 120)}`,
    );
  }
}

/** Parse a request frozen as TEXT, failing closed on anything unusable. */
export function parseInviteRequest(stored: string, expectedTo: string): InviteRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    throw new MailerError(
      'mail_request_invalid',
      'the persisted invite request is not valid JSON',
      stored.slice(0, 200),
    );
  }
  assertInviteRequest(parsed, expectedTo);
  return parsed;
}

/**
 * POST a previously built request under `idempotencyKey`. The body is sent
 * verbatim: nothing here reads the environment or the templates, which is what
 * makes a retry byte-identical to the original and lets Resend collapse the
 * two into one delivery (Q30).
 */
export async function sendInviteRequest(
  request: InviteRequest,
  idempotencyKey: string,
  expectedTo: string,
  opts: { timeoutMs?: number } = {},
): Promise<{ messageId: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    // Missing credentials fail at USE time with a specific error, never at
    // boot — matching the Healthchecks and feedback-webhook precedent.
    throw new MailerError(
      'mail_not_configured',
      'RESEND_API_KEY must be set to send invites',
    );
  }
  assertInviteRequest(request, expectedTo);

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  // As in cfAccessPolicy.ts, the deadline covers the response BODY too: this
  // call runs inside the membership lock's critical section, so a stalled body
  // would wedge every user-management operation.
  try {
    let res: Response;
    try {
      res = await (mailFetch ?? fetch)('https://api.resend.com/emails', {
        method: 'POST',
        signal: ac.signal,
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          // Q30 — transport retry protection, scoped to this exact body.
          'Idempotency-Key': idempotencyKey,
        },
        body: serializeInviteRequest(request),
      });
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') {
        throw new MailerError('mail_timeout', `Resend send timed out after ${timeoutMs}ms`);
      }
      throw new MailerError('mail_http_error', 'Resend send failed', String(err));
    }

    let text: string;
    try {
      text = await res.text();
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') {
        throw new MailerError('mail_timeout', `Resend body stalled past ${timeoutMs}ms`);
      }
      throw new MailerError('mail_http_error', 'Resend body read failed', String(err));
    }

    if (!res.ok) {
      throw new MailerError(
        'mail_http_error',
        `Resend returned HTTP ${res.status}`,
        text.slice(0, 300),
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new MailerError('mail_http_error', 'Resend returned non-JSON', text.slice(0, 200));
    }
    // Validate, never default — the same rule cfAccessPolicy.ts learned the
    // hard way. Coercing a malformed 2xx to `messageId: ''` would record the
    // invite as delivered with an empty provider id, destroying the only
    // handle on the actual message; reading `.id` off a bare `null` body would
    // throw a raw TypeError that callers classify as an unknown error rather
    // than a mail failure. Resend documents a non-empty id on every success,
    // so anything else is a refusal.
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      typeof (parsed as { id?: unknown }).id !== 'string' ||
      (parsed as { id: string }).id === ''
    ) {
      throw new MailerError(
        'mail_http_error',
        'Resend returned 2xx without a message id',
        text.slice(0, 200),
      );
    }
    return { messageId: (parsed as { id: string }).id };
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/services/invite-mailer.test.ts`
Expected: PASS, 31 tests. (Runtime count. A static grep for `it(` under-reports this
file — the malformed-2xx and malformed-request cases are generated by a loop and by
`it.each`.)

> **Resend contract verified against the live docs on 2026-07-30, before writing the client** (the Task 5 lesson). Everything this task assumed is correct: `POST https://api.resend.com/emails`, `Authorization: Bearer`, the `Idempotency-Key` header, `{from, to, subject, html, text}` with `from` accepting `Name <addr>`, and `{ "id": "<uuid>" }` on success. No client changes were needed — recorded here so a future run does not re-litigate it.
>
> Two constraints the docs add that the original tests did not cover, hence the two extra cases:
>
> - **Idempotency keys must be 1–256 characters**; outside that Resend returns a 400 `invalid_idempotency_key`. Both generators are derived (39 and ~80 chars today), so a format change could silently cross the limit and turn every invite into a hard failure. The added test pins the external constraint.
> - **Keys expire after 24 hours.** That is fine for `initialIdempotencyKey` even though it is stable forever: within the window a transport retry dedupes, and beyond it a genuinely later re-send *should* deliver. Worth knowing rather than assuming the key protects indefinitely. Note also that reusing one key with a *different* payload yields 409 `invalid_idempotent_request`, which this client surfaces as the generic `mail_http_error` — acceptable fail-closed behaviour, but it is not distinguishable from a transport failure.
>
> **The request is frozen and replayed, which is the only shape that satisfies Q30.** An earlier revision scoped the key to a fingerprint of the rendered body. That is self-consistent but *violates Q30*: if v1 was accepted and its acknowledgement lost, a later config or copy change computes a different key and Resend delivers a second time — precisely the double-send Q30 forbids. Re-rendering can only ever pick between drifting the body (409, invite blocked for a day) and drifting the key (a duplicate); neither is acceptable, so the body must not be re-rendered at all.
>
> `buildInviteRequest` therefore renders once and the caller (Task 11) persists the result in `users.invite_request`, a **TEXT** column added by migration `081_invite_request.sql` beside `invite_sent_at`/`invite_message_id`. Two stores were rejected and both rejections matter: **not** `account_events.meta`, because `060` declares that table append-only ("no UPDATE") and a frozen payload is operational state rather than an audit event; and **not** `jsonb`, because PostgreSQL 16 canonicalises key order — it rewrites `{from,to,subject,html,text}` as `{to,from,html,text,subject}` — so the round-trip would itself destroy the byte-identity the freeze exists to preserve. `serializeInviteRequest` writes the five fields in one fixed order, so the stored text is canonical regardless of the object's own key order, and `sendInviteRequest` POSTs exactly those bytes while reading neither the environment nor the templates — that is what makes a retry byte-identical. `parseInviteRequest` validates the stored text rather than defaulting it, since a half-shaped replay under the original key is just a different request wearing the same name.
>
> Separately, `renderInviteHtml` escapes both addresses rather than interpolating them raw. A local part may legally be a quoted string, so `"a<b"@example.test` is a valid address that would open a tag mid-document, and the same hole lets an admin inject markup into a message delivered to someone else. The text part needs no equivalent.

- [ ] **Step 5: Commit**

```bash
git add api/src/services/inviteMailer.ts api/tests/services/invite-mailer.test.ts
git commit -m "$(cat <<'EOF'
feat(w9): Resend invite mailer with G14 copy and split idempotency keys

No token, no magic link (Q6) — the email links to the app and authorization is
the pre-created row. Copy carries the inviter, the Beta disclaimer, the
Google-account instruction that cost a live debugging session on 2026-07-26,
a contact path and a plain link. Initial sends derive their key from user id +
invited_at so a timeout retry cannot double-send; an explicit resend gets a
fresh key (Q30).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Invite — service, cap, and the duplicate matrix

The full grant path: count under the lock, insert non-activatable, CF add, stamp, mail. Grants take effect **last** (Q17).

**Files:**
- Create: `api/src/db/migrations/081_invite_request.sql` (the frozen-request column, Q30)
- Create: `api/src/services/userLifecycle.ts`
- Create: `api/src/schemas/adminUsers.ts`
- Create: `api/src/routes/adminUsers.ts`
- Modify: `api/src/app.ts` (register the plugin)
- Test: `api/tests/routes/admin-users-invite.test.ts`

**Interfaces:**
- Consumes: `withMembershipLock` (T4), `syncEmail`/`syncEmailToStatus` (T6), `buildInviteRequest`/`sendInviteRequest`/`initialIdempotencyKey`/`resendIdempotencyKey` (T10), `recordAccountEventTx`/`humanActor` (T3), `COHORT_CAP` (T2), `requireCfAccessAdmin` (T9).
- Produces:
  - `interface Actor { userId: string; email: string; ip: string | null }`
  - `class LifecycleError extends Error { statusCode: number; code: string; details?: Record<string, unknown> }`
  - `inviteUser(email: string, role: UserRole, actor: Actor): Promise<InviteOutcome>`
  - `resendInvite(targetId: string, actor: Actor): Promise<InviteOutcome>`
  - `type InviteOutcome = { id: string; email: string; status: UserStatus; created: boolean; cf_synced: boolean; invite_sent: boolean; sync_error: string | null; mail_error: string | null; resent?: boolean; resynced?: boolean }`

    `created` is an explicit discriminator, set true **only** on the path that
    INSERTs a row. The route previously inferred freshness as
    `resent !== true && resynced === undefined`, which silently misclassifies
    any duplicate-invite branch that reports `resent: false` — the synced but
    never-delivered case returns exactly that and would have been sent as 201.
    Do not reintroduce inference here: `created` is the only thing that
    actually distinguishes "a user row came into existence" from "we tried
    again", and every other field is about delivery, not creation.
  - Routes `POST /api/admin/users/invite`, `POST /api/admin/users/:id/resend-invite`.

- [ ] **Step 1: Write the failing test**

Create `api/tests/routes/admin-users-invite.test.ts`. It runs against an **ephemeral database** because the cohort cap counts whole-table rows.

```ts
// Q7, Q8, Q12, Q17, Q18, Q27, Q29, Q30 — the invite path.
//
// Ephemeral DB: the cohort cap counts every row in `users`, so this suite
// cannot share the dev database with other test files.
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createEphemeralDb } from '../helpers/ephemeral-db.js';
import { runMigrations } from '../../src/db/runMigrations.js';
import pg from 'pg';

const eph = await createEphemeralDb('invite');
{
  const bootstrap = new pg.Pool({ connectionString: eph.url, max: 2 });
  await runMigrations(bootstrap);
  await bootstrap.end();
}
process.env.DATABASE_URL = eph.url;

const { buildApp } = await import('../../src/app.js');
const { db } = await import('../../src/db/client.js');
const policy = await import('../../src/services/cfAccessPolicy.js');
const mailer = await import('../../src/services/inviteMailer.js');
const { initialIdempotencyKey, SUPPORT_CONTACT } = mailer;
const { humanActor, systemActor } = await import('../../src/services/accountEvents.js');
const { withMembershipLock } = await import('../../src/services/membershipLock.js');
const { setupTestJwks } = await import('../helpers/cf-access-jwt.js');

let app: Awaited<ReturnType<typeof buildApp>>;
let jwks: Awaited<ReturnType<typeof setupTestJwks>>;
const ADMIN = 'admin.invite@repos.test';
let adminId: string;

let policyEmails: string[];
let fetchPolicyImpl: () => Promise<unknown>;
let sentMail: Array<{
  request: { to: string[]; from: string; html: string; text: string };
  idempotencyKey: string;
}>;
let mailImpl: () => Promise<{ messageId: string }>;

// Two env vars this suite cannot run without, neither of which is in api/.env:
//
//   PUBLIC_ORIGIN — csrfOrigin fails CLOSED when it is unset (403
//     csrf_origin_misconfigured) and it does that BEFORE looking at the
//     X-RepOS-CSRF header, so every request below would 403 for a reason that
//     has nothing to do with the invite path.
//   INVITE_FROM_EMAIL — buildInviteRequest throws mail_not_configured without
//     it, so every happy path would report invite_sent:false. The
//     missing-from case deletes it deliberately and restores it.
const savedEnv: Record<string, string | undefined> = {};
function setEnv(key: string, value: string): void {
  savedEnv[key] = process.env[key];
  process.env[key] = value;
}

beforeAll(async () => {
  setEnv('PUBLIC_ORIGIN', 'https://repos.invite.test');
  setEnv('INVITE_FROM_EMAIL', 'repos@send.jpmtech.com');
  jwks = await setupTestJwks();
  app = await buildApp();
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO users (email, role, status) VALUES ($1,'admin','active') RETURNING id`, [ADMIN],
  );
  adminId = rows[0].id;
});

afterAll(async () => {
  await app.close();
  await jwks.teardown();
  await db.end();
  await eph.drop();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

beforeEach(() => {
  vi.restoreAllMocks();
  policyEmails = [ADMIN];
  fetchPolicyImpl = async () => ({
    emails: [...policyEmails], name: 'Owner Only', decision: 'allow',
    config: { name: 'Owner Only', decision: 'allow', include: policyEmails.map((e) => ({ email: { email: e } })), exclude: [], require: [] },
  });
  vi.spyOn(policy, 'fetchPolicy').mockImplementation(() => fetchPolicyImpl() as never);
  vi.spyOn(policy, 'putPolicyEmails').mockImplementation(async (emails: string[]) => {
    policyEmails = [...emails];
  });
  sentMail = [];
  mailImpl = async () => ({ messageId: 'msg_x' });
  vi.spyOn(mailer, 'sendInviteRequest').mockImplementation(
    async (request: never, idempotencyKey: never, _expectedTo: never) => {
      sentMail.push({
        request: request as unknown as { to: string[]; from: string; html: string; text: string },
        idempotencyKey: idempotencyKey as unknown as string,
      });
      return mailImpl();
    },
  );
});

async function invite(email: string, role: 'member' | 'admin' = 'member') {
  return app.inject({
    method: 'POST', url: '/api/admin/users/invite',
    headers: {
      'cf-access-jwt-assertion': await jwks.mintJwt(ADMIN),
      'x-repos-csrf': '1',
    },
    payload: { email, role },
  });
}

function freshEmail(tag: string) { return `inv-${tag}-${randomUUID().slice(0, 8)}@repos.test`; }

async function seed(
  email: string, status: string, cfSynced: Date | null, sentAt: Date | null = null,
  // Defaults to ADMIN because the real INSERT always stamps invited_by. The
  // replayed sender does NOT come from this column, though — it comes from the
  // audit snapshot written below.
  invitedBy: string | null = adminId,
  // Every real `invited` row carries exactly one user_invited or user_imported
  // event, committed with the row (Q27), and originalSender() FAILS CLOSED
  // without one. Seeding it here is therefore not incidental setup — a fixture
  // missing it does not model any state the system can actually produce. A
  // string writes the human shape naming that address; null writes the Q31b
  // system-actor import shape.
  inviterEmail: string | null = ADMIN,
) {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO users (email, status, cf_synced_at, invited_at, invite_sent_at, invited_by)
     VALUES ($1,$2,$3, now(), $4, $5) RETURNING id`,
    [email, status, cfSynced, sentAt, invitedBy],
  );
  const id = rows[0].id;
  await db.query(
    `INSERT INTO account_events (user_id, user_email_at_event, kind, meta)
     VALUES ($1,$2,$3,$4::jsonb)`,
    inviterEmail === null
      ? [id, email, 'user_imported', JSON.stringify(systemActor('cf_reconciliation', 'cutover'))]
      : [id, email, 'user_invited', JSON.stringify(humanActor(invitedBy ?? adminId, inviterEmail))],
  );
  return id;
}

describe('POST /api/admin/users/invite — happy path', () => {
  it('creates an invited row, syncs CF, stamps, and mails — in that order', async () => {
    const email = freshEmail('ok');
    const r = await invite(email);
    expect(r.statusCode).toBe(201);
    const body = r.json<{ id: string; status: string; cf_synced: boolean; invite_sent: boolean }>();
    expect(body.status).toBe('invited');
    expect(body.cf_synced).toBe(true);
    expect(body.invite_sent).toBe(true);

    const { rows } = await db.query<{ status: string; cf_synced_at: Date | null; invited_by: string; invite_sent_at: Date | null; invite_message_id: string | null; invited_at: Date }>(
      `SELECT status, cf_synced_at, invited_by, invite_sent_at, invite_message_id, invited_at
         FROM users WHERE id=$1`, [body.id],
    );
    expect(rows[0].status).toBe('invited');
    expect(rows[0].cf_synced_at).not.toBeNull();
    expect(rows[0].invited_by).toBe(adminId);
    expect(rows[0].invite_sent_at).not.toBeNull();
    expect(rows[0].invite_message_id).toBe('msg_x');
    expect(policyEmails).toContain(email);
  });

  it('Q27: user_invited commits with the INSERT and carries the human actor', async () => {
    const email = freshEmail('audit');
    const r = await invite(email);
    const id = r.json<{ id: string }>().id;
    const { rows } = await db.query<{ meta: Record<string, unknown> }>(
      `SELECT meta FROM account_events WHERE user_id=$1 AND kind='user_invited'`, [id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].meta).toMatchObject({
      actor_kind: 'user', actor_user_id: adminId, actor_email: ADMIN,
    });
  });

  it('Q27: a Resend failure still leaves the user_invited event committed', async () => {
    mailImpl = async () => { throw new mailer.MailerError('mail_http_error', 'nope'); };
    const email = freshEmail('mailfail');
    const r = await invite(email);
    // 201 even though the mail failed — `created` tracks the row INSERT, not
    // delivery. That separation is the whole reason it exists.
    expect(r.statusCode).toBe(201);
    expect(r.json<{ created: boolean }>().created).toBe(true);
    const id = r.json<{ id: string; invite_sent: boolean }>().id;
    expect(r.json<{ invite_sent: boolean }>().invite_sent).toBe(false);
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int n FROM account_events WHERE user_id=$1 AND kind='user_invited'`, [id],
    );
    expect(rows[0].n).toBe(1);
    // Row keeps invite_sent_at NULL; the user is already in the policy and CAN sign in.
    const u = await db.query<{ invite_sent_at: Date | null; cf_synced_at: Date | null }>(
      `SELECT invite_sent_at, cf_synced_at FROM users WHERE id=$1`, [id],
    );
    expect(u.rows[0].invite_sent_at).toBeNull();
    expect(u.rows[0].cf_synced_at).not.toBeNull();
  });
});

describe('CF sync failure on a grant (Q7, Q8)', () => {
  it('leaves the row sync-pending, does NOT roll back, and sends NO email', async () => {
    fetchPolicyImpl = async () => { throw new policy.CfPolicyError('cf_http_error', 'down'); };
    const email = freshEmail('syncfail');
    const r = await invite(email);
    expect(r.statusCode).toBe(201);
    const body = r.json<{ id: string; cf_synced: boolean; invite_sent: boolean; sync_error: string }>();
    expect(body.cf_synced).toBe(false);
    expect(body.invite_sent).toBe(false);
    expect(body.sync_error).toBe('cf_http_error');
    expect(sentMail).toHaveLength(0);

    const { rows } = await db.query<{ status: string; cf_synced_at: Date | null }>(
      `SELECT status, cf_synced_at FROM users WHERE id=$1`, [body.id],
    );
    // Q17b — the row exists and is NOT activatable.
    expect(rows[0].status).toBe('invited');
    expect(rows[0].cf_synced_at).toBeNull();
  });

  it('an app_count breach refuses the same way', async () => {
    fetchPolicyImpl = async () => { throw new policy.CfPolicyError('app_count_not_one', 'two apps'); };
    const r = await invite(freshEmail('appcount'));
    expect(r.json<{ sync_error: string }>().sync_error).toBe('app_count_not_one');
    expect(sentMail).toHaveLength(0);
  });
});

describe('duplicate invite — all five cases (Q29)', () => {
  it('invited + cf_synced_at NULL -> retries the sync, mails only on success, 200 resynced', async () => {
    const email = freshEmail('unsynced');
    await seed(email, 'invited', null);
    const r = await invite(email);
    expect(r.statusCode).toBe(200);
    expect(r.json<{ resynced: boolean }>().resynced).toBe(true);
    expect(policyEmails).toContain(email);
    expect(sentMail).toHaveLength(1);
  });

  it('invited + unsynced + the retry ALSO fails -> no mail at all', async () => {
    const email = freshEmail('unsynced2');
    await seed(email, 'invited', null);
    fetchPolicyImpl = async () => { throw new policy.CfPolicyError('cf_timeout', 'slow'); };
    const r = await invite(email);
    expect(r.statusCode).toBe(200);
    expect(r.json<{ resynced: boolean }>().resynced).toBe(false);
    expect(sentMail).toHaveLength(0);
  });

  it('invited + synced + already delivered -> intentional resend with a FRESH key, 200 resent', async () => {
    const email = freshEmail('synced');
    // invite_sent_at NON-NULL: a delivery is already known to have succeeded,
    // so every further invite is a deliberate second delivery.
    const id = await seed(email, 'invited', new Date(), new Date());
    policyEmails.push(email);
    const first = await invite(email);
    const second = await invite(email);
    expect(first.statusCode).toBe(200);
    expect(first.json<{ resent: boolean }>().resent).toBe(true);
    expect(sentMail).toHaveLength(2);
    expect(sentMail[0].idempotencyKey).not.toBe(sentMail[1].idempotencyKey);
    expect(second.statusCode).toBe(200);
    expect(id).toBeTruthy();
  });

  // Q30's real failure mode: Resend ACCEPTED the initial send but the response
  // never came back, so the row is invited + CF-synced + invite_sent_at NULL.
  // Retrying must reuse the deterministic initial key — that is the only thing
  // that lets Resend collapse the two requests into one delivery.
  it('invited + synced + NEVER delivered -> reuses the INITIAL key, not a fresh one', async () => {
    const email = freshEmail('lostack');
    const id = await seed(email, 'invited', new Date(), null);
    policyEmails.push(email);

    const { rows } = await db.query<{ invited_at: Date }>(
      `SELECT invited_at FROM users WHERE id=$1`, [id],
    );
    const expected = initialIdempotencyKey(id, rows[0].invited_at);

    const r = await invite(email);
    // 200, not 201: nothing was created. This is the case that broke when the
    // route inferred freshness from `resent`/`resynced` instead of `created`.
    expect(r.statusCode).toBe(200);
    expect(r.json<{ created: boolean }>().created).toBe(false);
    expect(sentMail).toHaveLength(1);
    expect(sentMail[0].idempotencyKey).toBe(expected);
    // Not a resend — this is the initial delivery finally completing.
    expect(r.json<{ resent: boolean }>().resent).toBe(false);

    // ...and only NOW does a further invite become a genuine resend.
    const again = await invite(email);
    expect(again.json<{ resent: boolean }>().resent).toBe(true);
    expect(sentMail[1].idempotencyKey).not.toBe(expected);
  });

  it('a lost-ack retry by a DIFFERENT admin renders the ORIGINAL inviter', async () => {
    // Admin A invites; Resend ACCEPTS the send but the response is lost, so
    // the row is left invited + synced + invite_sent_at NULL. Admin B then
    // retries. Reusing A's deterministic key with a body naming B is precisely
    // what Resend rejects with 409 invalid_idempotent_request — the key would
    // be dead for 24h and the invite could not complete. The retry must
    // reproduce A's payload, recovered from the durable audit snapshot.
    const adminA = `inv-origadmin-${randomUUID().slice(0, 8)}@repos.test`;
    const { rows: aRows } = await db.query<{ id: string }>(
      `INSERT INTO users (email, role, status) VALUES ($1,'admin','active') RETURNING id`,
      [adminA],
    );
    const email = freshEmail('crossadmin');
    // seed() writes the user_invited snapshot naming Admin A. The sender is
    // replayed from that frozen row, not from invited_by — which is why
    // deleting Admin A below must not change the outcome.
    const id = await seed(email, 'invited', new Date(), null, aRows[0].id, adminA);
    policyEmails.push(email);
    mailImpl = async () => { throw new mailer.MailerError('mail_timeout', 'ack lost'); };
    const { rows } = await db.query<{ invited_at: Date }>(
      `SELECT invited_at FROM users WHERE id=$1`, [id],
    );

    await invite(email); // performed by ADMIN — i.e. Admin B

    expect(sentMail).toHaveLength(1);
    expect(sentMail[0].idempotencyKey).toBe(initialIdempotencyKey(id, rows[0].invited_at));
    // The key and the body must belong to the same request.
    expect(sentMail[0].request.html).toContain(adminA);
    expect(sentMail[0].request.html).not.toContain(ADMIN);

    // Deleting the inviter nulls invited_by but cannot touch the audit
    // snapshot, so a later attempt still replays A.
    await db.query(`DELETE FROM users WHERE id=$1`, [aRows[0].id]);
    await invite(email);
    expect(sentMail[1].idempotencyKey).toBe(sentMail[0].idempotencyKey);
    // Byte-identical, not merely "same sender" — that is what Resend collapses.
    expect(sentMail[1].request).toEqual(sentMail[0].request);
  });

  it('an IMPORTED row replays an identical key AND payload on every attempt', async () => {
    // Q31b creates imported rows as invited + synced + invite_sent_at NULL,
    // invited_by NULL, with a SYSTEM-actor user_imported event — so there is
    // no original sender to recover. That is the designed steady state of
    // every imported row, not a deleted-inviter edge case.
    //
    // Two attempts, because one cannot catch the bug this guards: if a lost
    // ack leaves the row untouched, attempt two must still produce the SAME
    // key and the SAME body, or Resend treats it as a new request and delivers
    // a second time.
    const email = freshEmail('imported');
    const id = await seed(email, 'invited', new Date(), null, null, null);
    policyEmails.push(email);
    // The lost ACK has to be simulated, not assumed: Resend accepts the send
    // but the response never arrives, so invite_sent_at is never stamped and
    // the row is byte-for-byte what it was. With the default success stub the
    // first attempt STAMPS invite_sent_at and the second becomes an
    // intentional resend on a fresh key — a different branch that proves
    // nothing about replay.
    mailImpl = async () => { throw new mailer.MailerError('mail_timeout', 'ack lost'); };

    await invite(email);
    const mid = await db.query<{ invite_sent_at: Date | null }>(
      `SELECT invite_sent_at FROM users WHERE id=$1`, [id],
    );
    expect(mid.rows[0].invite_sent_at).toBeNull();

    await invite(email); // the retry: nothing about the row changed

    expect(sentMail).toHaveLength(2);
    expect(sentMail[1].idempotencyKey).toBe(sentMail[0].idempotencyKey);
    expect(sentMail[1].request).toEqual(sentMail[0].request);
    // Stable across attempts precisely because it is a constant, not the
    // current admin — who could differ between the two.
    expect(sentMail[0].request.html).toContain(SUPPORT_CONTACT);
  });

  it('an ordinary lost-ack retry also replays identically across two attempts', async () => {
    // The same property for the human-actor shape: the sender comes from the
    // frozen user_invited meta, so repeated attempts cannot drift.
    const email = freshEmail('replay');
    const id = await seed(email, 'invited', new Date(), null);
    policyEmails.push(email);
    mailImpl = async () => { throw new mailer.MailerError('mail_timeout', 'ack lost'); };

    await invite(email);
    const mid = await db.query<{ invite_sent_at: Date | null }>(
      `SELECT invite_sent_at FROM users WHERE id=$1`, [id],
    );
    expect(mid.rows[0].invite_sent_at).toBeNull();

    await invite(email);

    expect(sentMail[1].idempotencyKey).toBe(sentMail[0].idempotencyKey);
    expect(sentMail[1].request).toEqual(sentMail[0].request);
  });

  it('Q30: the replay survives a config change between attempts', async () => {
    // The case that forced freezing rather than re-rendering. Attempt one is
    // accepted but its acknowledgement is lost; the deployment then changes
    // INVITE_FROM_EMAIL — a redeploy inside Resend's 24h window. Attempt two
    // must still send byte-identical bytes under the same key, or Resend
    // treats it as a new request and the invitee gets a second email.
    const email = freshEmail('redeploy');
    const id = await seed(email, 'invited', new Date(), null);
    policyEmails.push(email);
    mailImpl = async () => { throw new mailer.MailerError('mail_timeout', 'ack lost'); };

    await invite(email);

    const savedFrom = process.env.INVITE_FROM_EMAIL;
    process.env.INVITE_FROM_EMAIL = 'rotated@send.jpmtech.com';
    try {
      await invite(email);
    } finally {
      if (savedFrom === undefined) delete process.env.INVITE_FROM_EMAIL;
      else process.env.INVITE_FROM_EMAIL = savedFrom;
    }

    expect(sentMail[1].idempotencyKey).toBe(sentMail[0].idempotencyKey);
    expect(sentMail[1].request).toEqual(sentMail[0].request);
    // And the frozen copy is the one that was persisted, not the new config.
    expect(sentMail[1].request.from).not.toContain('rotated@');
    const { rows } = await db.query<{ invite_request: string }>(
      `SELECT invite_request FROM users WHERE id=$1`, [id],
    );
    // Stored as TEXT so the bytes survive verbatim — jsonb would reorder keys.
    expect(JSON.parse(rows[0].invite_request)).toEqual(sentMail[0].request);
    // And the audit row is untouched: 060 declares account_events append-only.
    const ev = await db.query<{ meta: Record<string, unknown> }>(
      `SELECT meta FROM account_events WHERE user_id=$1 AND kind='user_invited'`, [id],
    );
    expect(ev.rows[0].meta.invite_request).toBeUndefined();
  });

  it('a missing INVITE_FROM_EMAIL leaves the invitation DURABLE and PROVISIONED', async () => {
    // Freezing the request can fail on a config gap, and that failure must
    // cost the invitee nothing but the email. Two orderings are asserted here
    // because getting either one wrong is invisible in the other's assertions:
    //
    //   1. Freezing happens outside the creation transaction, so the row
    //      survives — building it inside would unwind the invitation and
    //      discard admin intent over a config gap.
    //   2. Freezing happens AFTER the CF add and the stamp, so the row is
    //      provisioned — building it before provisionAndMail would return
    //      mail_not_configured with cf_synced_at NULL and the invitee absent
    //      from the policy, unable to sign in over a mail-side failure. Q7
    //      orders this sync → stamp → email, and Q29 leans on it: the retry
    //      branch keys off cf_synced_at, so a stranded NULL also mislabels the
    //      next attempt as a re-provision.
    const email = freshEmail('nofrom');
    // This case needs the INSERT path, so it needs headroom under the cohort
    // cap. Every fresh invite above adds a counted row and the seeds add more,
    // so by this point the table is well past 10 and the request would 409 on
    // the cap before it ever reached the freeze — asserting the config gap
    // against a cap breach that never exercises it. Same prune idiom the cap
    // describe uses.
    await db.query(`DELETE FROM users WHERE email <> $1`, [ADMIN]);
    const savedFrom = process.env.INVITE_FROM_EMAIL;
    delete process.env.INVITE_FROM_EMAIL;
    let r;
    try {
      r = await invite(email);
    } finally {
      if (savedFrom !== undefined) process.env.INVITE_FROM_EMAIL = savedFrom;
    }

    expect(r.statusCode).toBe(201);
    const body = r.json<{ invite_sent: boolean; mail_error: string | null; cf_synced: boolean }>();
    expect(body.invite_sent).toBe(false);
    expect(body.mail_error).toBe('mail_not_configured');
    expect(sentMail).toHaveLength(0);
    // The CF add ran to completion before the freeze was even attempted.
    expect(body.cf_synced).toBe(true);
    expect(policyEmails).toContain(email);

    const { rows } = await db.query<{ status: string; invite_sent_at: Date | null; cf_synced_at: Date | null }>(
      `SELECT status, invite_sent_at, cf_synced_at FROM users WHERE lower(email)=$1`, [email],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('invited');
    expect(rows[0].invite_sent_at).toBeNull();
    expect(rows[0].cf_synced_at).not.toBeNull();
  });

  it('fails closed when the durable provenance is missing entirely', async () => {
    // Q27 guarantees exactly one user_invited/user_imported event per invited
    // row. If it is absent the original body cannot be reproduced, so reusing
    // the original key would pair it with a guessed payload — the 409 this
    // machinery exists to avoid, hidden behind a plausible send. Refuse.
    const email = freshEmail('noprov');
    const id = await seed(email, 'invited', new Date(), null);
    await db.query(`DELETE FROM account_events WHERE user_id=$1`, [id]);
    policyEmails.push(email);

    const r = await invite(email);
    expect(r.statusCode).toBe(500);
    expect(r.json<{ error: string }>().error).toBe('invite_provenance_invalid');
    expect(sentMail).toHaveLength(0);
  });

  it('fails closed on a user_invited carrying the wrong actor shape', async () => {
    // A system-shaped user_invited has no actor_email. Defaulting it to the
    // support constant would send a body that never matches the original.
    const email = freshEmail('badshape');
    const id = await seed(email, 'invited', new Date(), null);
    await db.query(
      `UPDATE account_events SET meta=$2::jsonb WHERE user_id=$1`,
      [id, JSON.stringify(systemActor('cf_reconciliation', 'cutover'))],
    );
    policyEmails.push(email);

    const r = await invite(email);
    expect(r.statusCode).toBe(500);
    expect(sentMail).toHaveLength(0);
  });

  it('an unsynced retry whose mail never landed also reuses the INITIAL key', async () => {
    const email = freshEmail('unsyncedkey');
    const id = await seed(email, 'invited', null, null);
    const { rows } = await db.query<{ invited_at: Date }>(
      `SELECT invited_at FROM users WHERE id=$1`, [id],
    );
    await invite(email);
    expect(sentMail[0].idempotencyKey).toBe(initialIdempotencyKey(id, rows[0].invited_at));
  });

  it('active -> 409 already_active', async () => {
    const email = freshEmail('active');
    await seed(email, 'active', new Date());
    const r = await invite(email);
    expect(r.statusCode).toBe(409);
    expect(r.json<{ error: string }>().error).toBe('already_active');
  });

  it('suspended -> 409 suspended_use_reinstate', async () => {
    const email = freshEmail('susp');
    await seed(email, 'suspended', new Date());
    const r = await invite(email);
    expect(r.statusCode).toBe(409);
    expect(r.json<{ error: string }>().error).toBe('suspended_use_reinstate');
  });

  it('deleting -> 409 deletion_in_progress', async () => {
    const email = freshEmail('del');
    await seed(email, 'deleting', null);
    const r = await invite(email);
    expect(r.statusCode).toBe(409);
    expect(r.json<{ error: string }>().error).toBe('deletion_in_progress');
  });

  it('never surfaces a raw UNIQUE violation as a 500', async () => {
    const email = freshEmail('uniq');
    await seed(email, 'active', new Date());
    const r = await invite(email);
    expect(r.statusCode).not.toBe(500);
  });
});

describe('cohort cap (Q12, Q18)', () => {
  async function fillTo(n: number): Promise<void> {
    const { rows } = await db.query<{ c: number }>(
      `SELECT count(*)::int c FROM users WHERE status IN ('active','invited','deleting')`,
    );
    for (let i = rows[0].c; i < n; i++) {
      await db.query(`INSERT INTO users (email, status) VALUES ($1,'active')`, [freshEmail(`fill${i}`)]);
    }
  }

  it('409 with the current count, counted as active+invited+deleting', async () => {
    await db.query(`DELETE FROM users WHERE email <> $1`, [ADMIN]);
    await fillTo(10);
    const r = await invite(freshEmail('over'));
    expect(r.statusCode).toBe(409);
    const body = r.json<{ error: string; count: number; cap: number }>();
    expect(body.error).toBe('cohort_cap_reached');
    expect(body.count).toBe(10);
    expect(body.cap).toBe(10);
  });

  it('a deleting row still occupies its slot', async () => {
    await db.query(`DELETE FROM users WHERE email <> $1`, [ADMIN]);
    await fillTo(9);
    await db.query(`INSERT INTO users (email, status) VALUES ($1,'deleting')`, [freshEmail('pending')]);
    const r = await invite(freshEmail('blocked'));
    expect(r.statusCode).toBe(409);
  });

  it('a suspended row does NOT occupy a slot', async () => {
    await db.query(`DELETE FROM users WHERE email <> $1`, [ADMIN]);
    await fillTo(9);
    await db.query(`INSERT INTO users (email, status) VALUES ($1,'suspended')`, [freshEmail('susp')]);
    const r = await invite(freshEmail('allowed'));
    expect(r.statusCode).toBe(201);
  });

  it('the 10th and 11th fired concurrently yield exactly one 201 and one 409', async () => {
    await db.query(`DELETE FROM users WHERE email <> $1`, [ADMIN]);
    await fillTo(9);
    const [a, b] = await Promise.all([invite(freshEmail('c1')), invite(freshEmail('c2'))]);
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([201, 409]);
    const { rows } = await db.query<{ c: number }>(
      `SELECT count(*)::int c FROM users WHERE status IN ('active','invited','deleting')`,
    );
    expect(rows[0].c).toBe(10);
  });
});

describe('auth (Q20)', () => {
  it('rejects X-Admin-Key', async () => {
    const saved = process.env.ADMIN_API_KEY;
    process.env.ADMIN_API_KEY = 'k';
    try {
      const r = await app.inject({
        method: 'POST', url: '/api/admin/users/invite',
        headers: { 'x-admin-key': 'k', 'x-repos-csrf': '1' },
        payload: { email: freshEmail('key'), role: 'member' },
      });
      expect(r.statusCode).toBe(403);
    } finally {
      if (saved === undefined) delete process.env.ADMIN_API_KEY; else process.env.ADMIN_API_KEY = saved;
    }
  });

  it('403s a CF-Access member', async () => {
    const member = freshEmail('member');
    await seed(member, 'active', new Date());
    const r = await app.inject({
      method: 'POST', url: '/api/admin/users/invite',
      headers: { 'cf-access-jwt-assertion': await jwks.mintJwt(member), 'x-repos-csrf': '1' },
      payload: { email: freshEmail('x'), role: 'member' },
    });
    expect(r.statusCode).toBe(403);
  });

  it('400s an invalid email', async () => {
    const r = await invite('not-an-email');
    expect(r.statusCode).toBe(400);
  });
});

describe('POST /api/admin/users/:id/resend-invite (Q29)', () => {
  async function resend(id: string) {
    return app.inject({
      method: 'POST', url: `/api/admin/users/${id}/resend-invite`,
      headers: {
        'cf-access-jwt-assertion': await jwks.mintJwt(ADMIN),
        'x-repos-csrf': '1',
      },
    });
  }

  it('completes a never-delivered invite under the INITIAL key', async () => {
    const email = freshEmail('resendok');
    const id = await seed(email, 'invited', new Date(), null);
    policyEmails.push(email);
    const { rows } = await db.query<{ invited_at: Date }>(
      `SELECT invited_at FROM users WHERE id=$1`, [id],
    );

    const r = await resend(id);
    expect(r.statusCode).toBe(200);
    const body = r.json<{ id: string; created: boolean; invite_sent: boolean }>();
    // Resend can NEVER create — that is the whole point of the branch it takes.
    expect(body.created).toBe(false);
    expect(body.id).toBe(id);
    expect(body.invite_sent).toBe(true);
    expect(sentMail).toHaveLength(1);
    expect(sentMail[0].idempotencyKey).toBe(initialIdempotencyKey(id, rows[0].invited_at));
  });

  it('404s an unknown id without creating anything', async () => {
    const before = await db.query<{ c: number }>(`SELECT count(*)::int c FROM users`);
    const r = await resend(randomUUID());
    expect(r.statusCode).toBe(404);
    expect(r.json<{ error: string }>().error).toBe('user_not_found');
    expect(sentMail).toHaveLength(0);
    const after = await db.query<{ c: number }>(`SELECT count(*)::int c FROM users`);
    expect(after.rows[0].c).toBe(before.rows[0].c);
  });

  it('cannot resurrect a user deleted while it waited for the membership lock', async () => {
    // The resurrection window. Resolving the id to an email OUTSIDE the lock
    // and then handing that email to the creation-capable invite path means a
    // deletion that commits while the resend is queued is undone by it: the
    // in-lock lookup finds no row for that address, falls through to the cap
    // check, and INSERTs a NEW row for the deleted identity — provisioned in
    // Cloudflare and mailed, under a fresh id the admin never asked for.
    //
    // The lock is what makes this deterministic rather than a timing test:
    // hold it, let the resend block in acquisition, delete the row, release.
    // Whatever the resend reads, it reads after the deletion has committed.
    // Headroom under the cohort cap. Without it the resurrecting INSERT is
    // refused by the cap instead of the fix, so the test would pass for a
    // reason that has nothing to do with resolving the id inside the lock.
    await db.query(`DELETE FROM users WHERE email <> $1`, [ADMIN]);
    const email = freshEmail('resurrect');
    const id = await seed(email, 'invited', new Date(), null);
    policyEmails.push(email);

    let release!: () => void;
    const holding = new Promise<void>((r) => { release = r; });
    const lockHeld = withMembershipLock(async () => { await holding; });
    await new Promise((r) => setTimeout(r, 60));

    const pending = resend(id);
    await new Promise((r) => setTimeout(r, 60));
    await db.query(`DELETE FROM users WHERE id=$1`, [id]);
    release();
    await lockHeld;

    const r = await pending;
    expect(r.statusCode).toBe(404);
    expect(sentMail).toHaveLength(0);
    // The identity stays deleted, and no replacement row wears its address.
    // (No assertion on policyEmails: this test seeds the address into the
    // policy itself, to model a row whose cf_synced_at is set, so
    // `not.toContain` would be false by construction and `toContain` true
    // regardless of the outcome. The row count is what actually discriminates.)
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM users WHERE lower(email)=$1`, [email],
    );
    expect(rows).toHaveLength(0);
  });
});

describe('invite_at provenance (Q30)', () => {
  it('a null invited_at fails closed on BOTH attempts instead of minting a key each time', async () => {
    // invited_at is nullable, so this row is representable. The initial key is
    // derived from it, and defaulting a missing one to `new Date()` mints a
    // DIFFERENT key per attempt — which is the unbounded-resend failure Q30
    // forbids, not a graceful degradation: a lost ack leaves the row
    // untouched, so every retry looks new to Resend and delivers again.
    //
    // Two attempts, because one cannot see it. A single attempt succeeds
    // either way; only the second reveals that the "retry" was a fresh
    // delivery under a fresh key.
    const email = freshEmail('noinvitedat');
    const id = await seed(email, 'invited', new Date(), null);
    await db.query(`UPDATE users SET invited_at = NULL WHERE id=$1`, [id]);
    policyEmails.push(email);

    const first = await invite(email);
    expect(first.statusCode).toBe(500);
    expect(first.json<{ error: string }>().error).toBe('invite_provenance_invalid');

    const second = await invite(email);
    expect(second.statusCode).toBe(500);
    expect(second.json<{ error: string }>().error).toBe('invite_provenance_invalid');

    // Nothing reached the wire on either attempt. Under the defaulting
    // behaviour this would be two sends carrying two different keys.
    expect(sentMail).toHaveLength(0);
    const { rows } = await db.query<{ invite_sent_at: Date | null }>(
      `SELECT invite_sent_at FROM users WHERE id=$1`, [id],
    );
    expect(rows[0].invite_sent_at).toBeNull();
  });

  it('a deliberate resend of an already-delivered row does NOT need invited_at', async () => {
    // The guard is scoped to the replay path on purpose. Once a delivery has
    // succeeded the key comes from the id alone, so a null invited_at cannot
    // affect it — refusing here would block a legitimate resend for a value
    // the operation never reads.
    const email = freshEmail('nullsent');
    const id = await seed(email, 'invited', new Date(), new Date());
    await db.query(`UPDATE users SET invited_at = NULL WHERE id=$1`, [id]);
    policyEmails.push(email);

    const r = await invite(email);
    expect(r.statusCode).toBe(200);
    expect(r.json<{ resent: boolean }>().resent).toBe(true);
    expect(sentMail).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/routes/admin-users-invite.test.ts`
Expected: FAIL — the route 404s.

- [ ] **Step 3: Write the schemas**

Create `api/src/schemas/adminUsers.ts`:

```ts
import { z } from 'zod';

export const InviteRequestSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    role: z.enum(['member', 'admin']).default('member'),
  })
  .strict();
export type InviteRequest = z.infer<typeof InviteRequestSchema>;

/**
 * Q28 — the transition matrix is CLOSED, and **the service owns it, not the
 * schema.** The enum below deliberately accepts all four lifecycle statuses so
 * that `-> invited` and `-> deleting` reach `patchUser` and are refused there
 * with **409 `invalid_transition`**. Narrowing the enum to
 * `['active','suspended']` would reject them at parse time with a 400, which
 * contradicts Q28's contract that *every* rejected transition returns 409
 * (spec line 247) and makes a forbidden transition indistinguishable from a
 * malformed body.
 */
export const UserPatchSchema = z
  .object({
    role: z.enum(['member', 'admin']).optional(),
    status: z.enum(['active', 'suspended', 'invited', 'deleting']).optional(),
  })
  .strict()
  .refine((v) => v.role !== undefined || v.status !== undefined, {
    message: 'at least one of role or status must be present',
  });
export type UserPatch = z.infer<typeof UserPatchSchema>;
```

- [ ] **Step 4: Write the lifecycle service (invite half)**

Create `api/src/services/userLifecycle.ts`:

```ts
// W9 — the user lifecycle state machine.
//
// One rule governs the ordering of every operation here (Q17):
//   GRANTS TAKE EFFECT LAST, REVOCATIONS TAKE EFFECT FIRST,
// where "takes effect" means *at the layer checked on every request*. Only the
// DB is that layer. Removing an email from the CF policy does NOT revoke
// access: Access evaluates policy at AUTHENTICATION, and an issued session
// remains valid for its duration — 24h on this app's policy.
//
// Every membership transition runs under the same session-level advisory lock
// (Q26), and the Cloudflare call never happens inside a DB transaction (Q7).
import { db } from '../db/client.js';
import { COHORT_CAP } from '../constants/users.js';
import type { UserRole, UserStatus } from '../constants/users.js';
import { withMembershipLock } from './membershipLock.js';
import { syncEmail, syncEmailToStatus } from './cfAccessSync.js';
import { CfPolicyError } from './cfAccessPolicy.js';
import {
  buildInviteRequest,
  sendInviteRequest,
  serializeInviteRequest,
  parseInviteRequest,
  initialIdempotencyKey,
  resendIdempotencyKey,
  MailerError,
  SUPPORT_CONTACT,
  type InviteRequest,
} from './inviteMailer.js';
import { recordAccountEventTx, humanActor } from './accountEvents.js';

export interface Actor {
  userId: string;
  email: string;
  ip: string | null;
}

export class LifecycleError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: Record<string, unknown>;
  constructor(
    statusCode: number,
    code: string,
    details: Record<string, unknown> = {},
    // `cause` carries the underlying fault when this wraps one. Only the code
    // and details reach the client; the cause exists so wrapping a raw error
    // to give the CLIENT a usable contract does not cost the OPERATOR the
    // stack trace they need — see deleteUser's finalization catch.
    options?: { cause?: unknown },
  ) {
    super(code, options);
    this.name = 'LifecycleError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export interface InviteOutcome {
  id: string;
  email: string;
  status: UserStatus;
  /**
   * True ONLY on the path that INSERTs a users row — the single thing that
   * makes the response a 201. Required, not optional: an optional flag lets a
   * new return site forget it and silently fall back to 200, which is the
   * class of bug that made the route's old `resent`/`resynced` inference wrong
   * in the first place. Every exit from inviteUser must state it.
   */
  created: boolean;
  cf_synced: boolean;
  invite_sent: boolean;
  sync_error: string | null;
  mail_error: string | null;
  resent?: boolean;
  resynced?: boolean;
}

function syncErrorCode(err: unknown): string {
  return err instanceof CfPolicyError ? err.code : 'cf_unknown_error';
}
function mailErrorCode(err: unknown): string {
  return err instanceof MailerError ? err.code : 'mail_unknown_error';
}

/** Q12 — the counted set is active + invited + deleting. */
export async function countCohort(): Promise<number> {
  const { rows } = await db.query<{ c: number }>(
    `SELECT count(*)::int c FROM users WHERE status IN ('active','invited','deleting')`,
  );
  return rows[0].c;
}

/**
 * The address the invite body must name, recovered from state that was
 * committed BEFORE any I/O, so every retry of a never-delivered invite renders
 * byte-identical content and can therefore safely share one idempotency key.
 *
 * `user_invited` and `user_imported` are both written in the same transaction
 * as the row they describe (Q27), so exactly one exists for every `invited`
 * row and neither can be lost to a later mutation. `meta.actor_email` is a
 * frozen snapshot: unlike a join through `invited_by` (which is
 * ON DELETE SET NULL) it survives the inviting admin being deleted, so the
 * replay stays stable even then.
 *
 * Q31b imports carry the Q23 SYSTEM actor shape and therefore have no
 * actor_email at all — that is the designed state of every imported row, not
 * an edge case, since the cutover creates them `invited` with `invited_by
 * NULL` and `invite_sent_at NULL`. They resolve to a constant, which is
 * equally stable across attempts.
 */
async function originalSender(userId: string): Promise<string> {
  const { rows } = await db.query<{ kind: string; meta: Record<string, unknown> | null }>(
    `SELECT kind, meta FROM account_events
      WHERE user_id=$1 AND kind IN ('user_invited','user_imported')
      ORDER BY id ASC`,
    [userId],
  );
  // Validate, never default. Collapsing "no event", "null meta" or "a
  // user_invited carrying the wrong actor shape" onto the support constant
  // would silently pair the ORIGINAL key with a DIFFERENT body — recreating
  // the 409 this function exists to prevent — while hiding a broken Q27
  // invariant behind a plausible-looking send. Exactly one event must exist,
  // and its shape must match its kind.
  if (rows.length !== 1) {
    throw new LifecycleError(500, 'invite_provenance_invalid', {
      reason: rows.length === 0 ? 'no_user_invited_or_imported_event' : 'multiple_events',
      count: rows.length,
    });
  }
  const { kind, meta } = rows[0];
  if (kind === 'user_invited') {
    // Q23 human shape. The address is the payload, so it must be present.
    if (
      !meta || meta.actor_kind !== 'user' ||
      typeof meta.actor_email !== 'string' || meta.actor_email === ''
    ) {
      throw new LifecycleError(500, 'invite_provenance_invalid', { reason: 'malformed_human_actor' });
    }
    return meta.actor_email;
  }
  // Q31b import: the Q23 SYSTEM shape carries no actor_email by design, so the
  // constant IS the durable answer here — but only for a correctly shaped
  // system event, never as a catch-all.
  if (!meta || meta.actor_kind !== 'system') {
    throw new LifecycleError(500, 'invite_provenance_invalid', { reason: 'malformed_system_actor' });
  }
  return SUPPORT_CONTACT;
}

/**
 * Load the frozen request for this invite, minting one on first use.
 *
 * Q30 says a retry after a lost acknowledgement must not deliver twice, and
 * Resend collapses two sends only when they are BYTE-IDENTICAL under one key.
 * Re-rendering cannot meet that bar: INVITE_FROM_EMAIL is environment-supplied
 * and the copy ships with the deployment, so a redeploy inside the 24h window
 * would either drift the body (409, invite stuck for a day) or force a new key
 * (a second delivery — the thing Q30 forbids). Freeze once, replay thereafter.
 *
 * Stored as TEXT on `users` (migration 081), NOT as jsonb and NOT in
 * account_events:
 *   - jsonb canonicalises key order — PG16 rewrites {from,to,subject,html,text}
 *     as {to,from,html,text,subject} — so a jsonb round-trip would itself
 *     destroy the byte-identity the column exists to preserve.
 *   - 060 declares account_events append-only ("no UPDATE"), and a frozen
 *     payload is operational state, not an audit event: it has no business in
 *     a user's visible timeline.
 *
 * Called OUTSIDE the creation transaction, on the send path. A missing
 * INVITE_FROM_EMAIL therefore surfaces as a mail failure on a durable invited
 * row rather than rolling back the invitation — the frozen error contract says
 * a mail-side failure leaves the row with invite_sent_at NULL and a retry
 * affordance, and discarding admin intent over a config gap would break it.
 */
async function frozenInviteRequest(userId: string, email: string): Promise<InviteRequest> {
  const { rows } = await db.query<{ invite_request: string | null }>(
    `SELECT invite_request FROM users WHERE id=$1`,
    [userId],
  );
  const stored = rows[0]?.invite_request;
  if (stored !== null && stored !== undefined) return parseInviteRequest(stored, email);

  const request = buildInviteRequest({
    toEmail: email,
    invitedByEmail: await originalSender(userId),
  });
  // Commit the freeze before any I/O, so a crash between here and the send
  // replays these exact bytes rather than re-rendering them.
  await db.query(
    `UPDATE users SET invite_request=$2 WHERE id=$1 AND invite_request IS NULL`,
    [userId, serializeInviteRequest(request)],
  );
  // Re-read: if a concurrent attempt won the freeze, replay ITS bytes, not ours.
  const { rows: after } = await db.query<{ invite_request: string | null }>(
    `SELECT invite_request FROM users WHERE id=$1`,
    [userId],
  );
  return parseInviteRequest(after[0].invite_request as string, email);
}

/**
 * Attempt the CF add, then freeze-and-mail. Shared by the fresh-invite and the
 * retry-then-send branch of Q29. Never throws for a sync or mail failure —
 * both are recorded on the outcome so the row survives with a retry
 * affordance (Q8). Rollback would discard admin intent and race the email.
 *
 * `makeRequest` is a THUNK, evaluated here after the stamp, and deliberately
 * not a value the caller has already computed. Q7 fixes the order as
 * sync → stamp → email, which means a mail-side failure must leave the invitee
 * PROVISIONED. Building the request first inverts that: an unset
 * INVITE_FROM_EMAIL, or an unusable frozen row, would return a mail_error with
 * `cf_synced_at` still NULL — an invitee absent from the CF policy, unable to
 * sign in, over a failure that had nothing to do with Cloudflare. Freezing is
 * mail-side work and belongs after the boundary that makes the row usable.
 *
 * A LifecycleError propagates rather than being flattened into `mail_error`: a
 * broken Q27 provenance is a server fault (500), not a delivery outcome, and
 * reporting it as a mail failure would offer a retry affordance for something
 * no retry can fix.
 */
async function provisionAndMail(
  userId: string,
  email: string,
  makeRequest: () => Promise<InviteRequest>,
  idempotencyKey: string,
): Promise<{ cf_synced: boolean; invite_sent: boolean; sync_error: string | null; mail_error: string | null }> {
  try {
    await syncEmail(email, 'present');
  } catch (err) {
    return { cf_synced: false, invite_sent: false, sync_error: syncErrorCode(err), mail_error: null };
  }
  // Q7 — stamp only after a successful sync. The row becomes activatable here
  // and not one instruction earlier.
  await db.query(`UPDATE users SET cf_synced_at = now() WHERE id=$1`, [userId]);

  let request: InviteRequest;
  try {
    request = await makeRequest();
  } catch (err) {
    if (err instanceof LifecycleError) throw err;
    // Provisioned, not mailed — the row is durable and the invitee can sign in.
    return { cf_synced: true, invite_sent: false, sync_error: null, mail_error: mailErrorCode(err) };
  }

  try {
    const { messageId } = await sendInviteRequest(request, idempotencyKey, email);
    await db.query(
      `UPDATE users SET invite_sent_at = now(), invite_message_id = $2 WHERE id=$1`,
      [userId, messageId],
    );
    return { cf_synced: true, invite_sent: true, sync_error: null, mail_error: null };
  } catch (err) {
    // The user is already in the CF policy and CAN sign in; the admin resends.
    return { cf_synced: true, invite_sent: false, sync_error: null, mail_error: mailErrorCode(err) };
  }
}

/** The columns every duplicate/resend decision reads. */
interface InviteRow {
  id: string;
  email: string;
  status: UserStatus;
  cf_synced_at: Date | null;
  invited_at: Date | null;
  invite_sent_at: Date | null;
}
const INVITE_ROW_COLUMNS = 'id, email, status, cf_synced_at, invited_at, invite_sent_at';

/**
 * Q29's duplicate-invite half, shared by `inviteUser` (email already resolves
 * to this row) and `resendInvite` (id resolves to it).
 *
 * **This function cannot create a user, and that is a security property, not a
 * refactor.** `resendInvite` used to resolve its id to an email and hand that
 * string to the creation-capable `inviteUser`, which re-looked-it-up by
 * address. A deletion committing in between — the moment the resend spends
 * queued on the membership lock is exactly such a window — left the second
 * lookup finding nothing, so the resend fell through to the cap check and
 * INSERTed a fresh row: a deleted identity resurrected, provisioned in
 * Cloudflare and mailed, under an id nobody asked for. Resolving inside the
 * lock closes the window; having no INSERT on this path closes the class.
 *
 * Callers MUST hold the membership lock.
 */
async function resendExisting(row: InviteRow, actor: Actor): Promise<InviteOutcome> {
  const target = row.email.toLowerCase();
  if (row.status === 'active') throw new LifecycleError(409, 'already_active');
  if (row.status === 'suspended') throw new LifecycleError(409, 'suspended_use_reinstate');
  if (row.status === 'deleting') throw new LifecycleError(409, 'deletion_in_progress');

  {
      // Q30 — the key is chosen by whether a delivery has ever SUCCEEDED, not
      // by which retry branch we are in. `invite_sent_at` is the only durable
      // record of that, and it is written only after sendInviteRequest resolves.
      //
      // The case that forces this: Resend ACCEPTS the initial send but the
      // response times out. The row is left invited + CF-synced +
      // invite_sent_at NULL, so a retry lands in the "already provisioned"
      // branch below — which used to mint a FRESH key and deliver the same
      // initial invite a second time. Resend only deduplicates retries that
      // reuse the same key, so the deterministic initial key is the only thing
      // that collapses them. A fresh key is correct exclusively when a prior
      // delivery is known-successful, which is what Q30 means by "a deliberate
      // second delivery".
      // Reusing the deterministic key OBLIGES us to reproduce the original
      // request body, because Resend deduplicates only IDENTICAL requests
      // sharing a key and returns 409 invalid_idempotent_request otherwise.
      // Rendering the retry with the CURRENT admin's address breaks that:
      // Admin A's send is accepted, the response is lost, Admin B retries, and
      // the body now names B against A's key.
      //
      // So the sender is resolved from durable state rather than from the
      // caller — see originalSender(). Both the key and the body are then pure
      // functions of the row, which is what makes the retry a true replay.
      // There is deliberately NO fresh-key fallback on this branch: a fresh key
      // per attempt would defeat Q30 outright, since a lost ack leaves the row
      // untouched and the next attempt would deliver again.
      const neverDelivered = row.invite_sent_at === null;
      let idempotencyKey: string;
      if (neverDelivered) {
        // The initial key is derived from invited_at, so a NULL one cannot
        // produce it. Defaulting to `new Date()` does not degrade gracefully:
        // it mints a DIFFERENT key on every attempt, which is precisely the
        // unbounded-resend failure Q30 forbids — a lost ack leaves the row
        // untouched, so each retry looks like a new request to Resend and
        // delivers again. `invited_at` is nullable in the schema, so this row
        // is representable; refuse it as broken provenance rather than
        // synthesizing mutable key material. (A CHECK constraint asserting
        // status='invited' ⇒ invited_at IS NOT NULL would also close it, but
        // that is a new migration and a schema decision, not this task's.)
        if (row.invited_at === null) {
          throw new LifecycleError(500, 'invite_provenance_invalid', {
            reason: 'missing_invited_at',
          });
        }
        idempotencyKey = initialIdempotencyKey(row.id, row.invited_at);
      } else {
        // A deliberate second delivery keys off the id alone, so it never reads
        // invited_at — guarding it here would block a legitimate resend over a
        // value the operation does not use.
        idempotencyKey = resendIdempotencyKey(row.id);
      }
      // A never-delivered invite REPLAYS its frozen request; a known-successful
      // prior delivery is a deliberate new one, so it renders fresh under a
      // fresh key and has no earlier request to match. Either can fail on a
      // missing INVITE_FROM_EMAIL, which is a MAIL failure on a durable row —
      // never a reason to unwind the invitation, and (on the unsynced branch
      // below) never a reason to skip provisioning. Hence a thunk rather than a
      // value: provisionAndMail evaluates it only after the CF add and the
      // stamp, so a config gap cannot strand the row with cf_synced_at NULL.
      const makeRequest = async (): Promise<InviteRequest> =>
        neverDelivered
          ? await frozenInviteRequest(row.id, target)
          : buildInviteRequest({ toEmail: target, invitedByEmail: actor.email });

      if (row.cf_synced_at === null) {
        // Provisioning failed last time: retry the sync FIRST and send only if
        // it succeeds. Mailing unconditionally would send a link the invitee
        // cannot use, contradicting Q7 and Q17b.
        const r = await provisionAndMail(row.id, target, makeRequest, idempotencyKey);
        return {
          id: row.id, email: target, status: 'invited', created: false,
          ...r, resynced: r.cf_synced,
        };
      }
      // Already provisioned, so there is no sync to order the freeze against —
      // building the request here cannot strand the row. Whether this is a
      // resend or the completion of an initial delivery is decided by
      // `neverDelivered`, not by this branch.
      let invite_sent = false;
      let mail_error: string | null = null;
      try {
        // `target`, not `email`: the frozen request was rendered against the
        // lower-cased address, and sendInviteRequest compares expectedTo to
        // request.to[0] EXACTLY. Passing the raw input would reject every
        // replay of an invite whose address was typed with capitals.
        const { messageId } = await sendInviteRequest(
          await makeRequest(), idempotencyKey, target,
        );
        await db.query(
          `UPDATE users SET invite_sent_at = now(), invite_message_id=$2 WHERE id=$1`,
          [row.id, messageId],
        );
        invite_sent = true;
      } catch (err) {
        if (err instanceof LifecycleError) throw err;
        mail_error = mailErrorCode(err);
      }
      return {
        id: row.id, email: target, status: 'invited', created: false,
        cf_synced: true, invite_sent, sync_error: null, mail_error,
        // Only a genuine second delivery is a resend; finishing an initial
        // send whose response was lost is not. This is exactly the branch that
        // returns resent:false WITHOUT having created anything, which is why
        // the route keys 201 off `created` and not off this field.
        resent: !neverDelivered,
      };
  }
}

export async function inviteUser(
  email: string,
  role: UserRole,
  actor: Actor,
): Promise<InviteOutcome> {
  const target = email.toLowerCase();
  // Q18 — the cap check and the insert happen inside the SAME critical section
  // as the CF sync. A bare count-then-insert races: two admins each observe 9
  // and both insert, yielding 11.
  return withMembershipLock(async () => {
    const existing = await db.query<InviteRow>(
      `SELECT ${INVITE_ROW_COLUMNS} FROM users WHERE lower(email)=$1`,
      [target],
    );

    // Q29 — duplicate invite is explicit per current status. users.email is
    // UNIQUE, so the un-specified path was a raw constraint violation
    // surfacing as a 500.
    if (existing.rows.length > 0) return resendExisting(existing.rows[0], actor);

    const count = await countCohort();
    if (count >= COHORT_CAP) {
      throw new LifecycleError(409, 'cohort_cap_reached', { count, cap: COHORT_CAP });
    }

    // Q27 — the audit row commits with the users INSERT, not after the email.
    // The round-1 ordering wrote user_invited after Resend, so a mail failure
    // left a real user row and a live CF grant with no audit record.
    const client = await db.connect();
    let userId: string;
    let invitedAt: Date;
    try {
      await client.query('BEGIN');
      const ins = await client.query<{ id: string; invited_at: Date }>(
        `INSERT INTO users (email, role, status, invited_by, invited_at, cf_synced_at)
         VALUES ($1, $2, 'invited', $3, now(), NULL)
         RETURNING id, invited_at`,
        [target, role, actor.userId],
      );
      userId = ins.rows[0].id;
      invitedAt = ins.rows[0].invited_at;
      await recordAccountEventTx(client, {
        userId,
        userEmail: target,
        kind: 'user_invited',
        ip: actor.ip,
        // Q30's frozen request is deliberately NOT built here. buildInviteRequest
        // throws mail_not_configured when INVITE_FROM_EMAIL is unset, and inside
        // this transaction that exception reaches the catch below and rolls the
        // invitation back — discarding admin intent over a config gap, which the
        // error contract forbids. It is frozen on the send path instead, where a
        // failure leaves a durable invited row with invite_sent_at NULL.
        meta: { ...humanActor(actor.userId, actor.email), role },
      });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    // Freezing happens inside provisionAndMail, AFTER the row and its audit
    // event are committed AND after the CF add and stamp. Committing first is
    // what makes a config gap yield a durable invited row rather than a
    // rolled-back invitation; deferring past the stamp is what makes that row
    // PROVISIONED, so the invitee can sign in even though no mail went out
    // (Q7). Freezing between the two would satisfy the first and break the
    // second.
    const r = await provisionAndMail(
      userId, target,
      () => frozenInviteRequest(userId, target),
      initialIdempotencyKey(userId, invitedAt),
    );
    // The only path that INSERTs, so the only one that is a 201.
    return { id: userId, email: target, status: 'invited', created: true, ...r };
  });
}

/**
 * Q29 — POST /:id/resend-invite enforces the identical precondition.
 *
 * The row is resolved BY ID and INSIDE the lock, and the outcome comes from
 * `resendExisting`, which has no INSERT. The earlier shape — read the email on
 * the pool, then call `inviteUser` with that string — had a resurrection
 * window: the resend can sit queued on the membership lock for as long as the
 * holder runs, and a deletion committing in that interval means `inviteUser`'s
 * own lookup finds nothing and takes the creation path, recreating the deleted
 * identity with a new id, a Cloudflare grant and an email. Reading by id under
 * the lock means whatever we read is the post-deletion truth, and a deleted row
 * is simply a 404.
 */
export async function resendInvite(targetId: string, actor: Actor): Promise<InviteOutcome> {
  return withMembershipLock(async () => {
    const { rows } = await db.query<InviteRow>(
      `SELECT ${INVITE_ROW_COLUMNS} FROM users WHERE id=$1`,
      [targetId],
    );
    if (rows.length === 0) throw new LifecycleError(404, 'user_not_found');
    return resendExisting(rows[0], actor);
  });
}
```

> `provisionAndMail` takes no `invitedAt`: the initial-send key is derived at the call site and the body never read the value. Keeping the parameter meant the resend path had to synthesize a `new Date()` purely to fill it — manufacturing exactly the kind of mutable value the `invited_at` guard below exists to reject. It and the earlier revision's dead `void invitedAt;` line are both gone.

- [ ] **Step 5: Write the route plugin**

Create `api/src/routes/adminUsers.ts`:

```ts
// W9 — user management. Q20: CF Access + role='admin'; the X-Admin-Key path is
// rejected because it sets no actor.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireCfAccessAdmin } from '../middleware/cfAccess.js';
import { csrfOrigin } from '../middleware/csrfOrigin.js';
import { InviteRequestSchema } from '../schemas/adminUsers.js';
import {
  inviteUser, resendInvite, LifecycleError, type Actor,
} from '../services/userLifecycle.js';
import { LockTimeoutError } from '../services/membershipLock.js';

function actorOf(req: FastifyRequest): Actor {
  return {
    userId: (req as { userId?: string }).userId!,
    email: (req as { userEmail?: string }).userEmail!,
    ip: req.ip ?? null,
  };
}

/** Translate service errors into HTTP without leaking internals. */
export function sendLifecycleError(reply: import('fastify').FastifyReply, err: unknown): unknown {
  if (err instanceof LifecycleError) {
    return reply.code(err.statusCode).send({ error: err.code, ...err.details });
  }
  if (err instanceof LockTimeoutError) {
    // A wedged holder fails fast rather than blocking the pool (Q16).
    return reply
      .code(503)
      .send({ error: 'lock_timeout', retry_after_seconds: 2 });
  }
  throw err;
}

export async function adminUsersRoutes(app: FastifyInstance) {
  app.post(
    '/admin/users/invite',
    { preHandler: [requireCfAccessAdmin(), csrfOrigin] },
    async (req, reply) => {
      const parsed = InviteRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
      }
      const actor = actorOf(req);
      // Q13 — no operation may target yourself from the admin list.
      if (parsed.data.email === actor.email.toLowerCase()) {
        return reply.code(409).send({ error: 'self_target_forbidden' });
      }
      try {
        const out = await inviteUser(parsed.data.email, parsed.data.role, actor);
        // 201 ONLY when a row was created. Inferring this from `resent` /
        // `resynced` breaks as soon as a duplicate-invite branch legitimately
        // reports resent:false, which the synced-but-never-delivered retry
        // does.
        return reply.code(out.created ? 201 : 200).send(out);
      } catch (err) {
        return sendLifecycleError(reply, err);
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/admin/users/:id/resend-invite',
    { preHandler: [requireCfAccessAdmin(), csrfOrigin] },
    async (req, reply) => {
      try {
        return reply.code(200).send(await resendInvite(req.params.id, actorOf(req)));
      } catch (err) {
        return sendLifecycleError(reply, err);
      }
    },
  );
}
```

Register it in `api/src/app.ts` next to `adminFeedbackRoutes`:

```ts
import { adminUsersRoutes } from './routes/adminUsers.js';
// ...
  await app.register(adminUsersRoutes, { prefix: '/api' });
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/routes/admin-users-invite.test.ts`
Expected: PASS, 33 tests. (Measured from the block itself. The originally stated 18 was
already stale before any of the replay cases were added — trust the measured count, not the prose.
28 of these were the original matrix; five more came from the review round below.)

> **Three deviations found while executing this task, all already folded into the blocks above.**
>
> - **The suite must set `PUBLIC_ORIGIN` and `INVITE_FROM_EMAIL` itself.** Neither is in `api/.env`. `csrfOrigin` fails **closed** when `PUBLIC_ORIGIN` is unset — and it does so *before* it looks at the `X-RepOS-CSRF` header — so every request in the file 403s with `csrf_origin_misconfigured`, for a reason that has nothing to do with the invite path. Without `INVITE_FROM_EMAIL`, `buildInviteRequest` throws `mail_not_configured` and every happy path reports `invite_sent: false`. Both are saved and restored in `afterAll`.
> - **The missing-`INVITE_FROM_EMAIL` case has to prune first.** It is the only later case that needs the INSERT path, and by the time it runs the earlier invites and seeds have pushed the counted set past `COHORT_CAP`, so the request 409s on the cap and never reaches the freeze at all. It reuses the cap describe's `DELETE FROM users WHERE email <> ADMIN` idiom. This is exactly the class of thing the measured-not-stated rule exists for: the case *passed* review as written and still could not run.
> - **`void invitedAt;` is gone**, per the note under Step 4.
>
> **Mutation-tested, seven mutations, each killing only its intended cases:** freezing the request *before* the sync fails only the missing-from case (which is why that case asserts `cf_synced`, not just durability); re-rendering from the current admin instead of replaying fails the cross-admin, config-change and both fail-closed cases; forcing `neverDelivered = false` fails all eight replay cases; stamping `cf_synced_at` before the sync succeeds fails only the sync-failure case; inferring 201 from `resent`/`resynced` instead of `created` fails only the synced-but-never-delivered case — the precise bug that discriminator exists to prevent; and the two restorations described below.

> **The resurrection window, and why `resendInvite` owns its lookup (review round, post-ship).** The original `resendInvite` resolved its id to an email **on the pool, outside the lock**, then handed that string to the creation-capable `inviteUser`, which looked it up again *by address*. Between those two reads sits the entire time the resend spends queued on the membership lock — and once Task 13's locked deletion exists, that is exactly when a deletion commits. The second lookup then finds nothing, falls through to the cap check, and **INSERTs a fresh row for the deleted identity**: provisioned in Cloudflare, mailed, under a new id nobody asked for, and returned as a `200`. Demonstrated before fixing — the pre-fix run returns 200 with a recreated row.
>
> Two changes, because closing the window is not the same as closing the class. The lookup moved **inside** the lock and became a lookup **by id**, so whatever it reads is the post-deletion truth; and the duplicate-invite logic moved into `resendExisting`, which **has no INSERT at all**, so no future caller can re-enter creation through this door. `inviteUser` keeps the INSERT and calls the same helper for its duplicate branch, which is what keeps the two paths from drifting.
>
> The test holds the lock itself, lets the resend block in acquisition, deletes the row, then releases — so the ordering is enforced by the real lock rather than by sleeps racing each other. It asserts 404, no mail, and **no row wearing that address**. It deliberately asserts nothing about `policyEmails`: the case seeds the address into the policy to model a synced row, so both `toContain` and `not.toContain` are true by construction and neither can discriminate.
>
> **A NULL `invited_at` is broken provenance, not a defaultable value.** `row.invited_at ?? new Date()` looked like a harmless fallback and was the same bug as the round-2 fresh-key fallback: the initial key is *derived from* `invited_at`, so defaulting mints a **different key on every attempt**, and a lost ack — which by definition leaves the row untouched — therefore delivers again, unbounded. `invited_at` is nullable in the schema, so the row is representable. It now fails closed as `invite_provenance_invalid`. The guard is scoped to the replay path only: a deliberate resend keys off the id alone and never reads `invited_at`, so refusing there would block a legitimate operation over a value it does not use. A `CHECK (status <> 'invited' OR invited_at IS NOT NULL)` would also close it and is worth considering, but it is a new migration and a schema decision — deliberately not taken unilaterally here. Task 16's importer already sets `invited_at`, so no production path creates such a row today; the fix guards a state nothing is *supposed* to reach.

> **Why the retry replays its sender from the audit snapshot.** Reusing the deterministic key obliges us to reproduce the original request body: Resend deduplicates only *identical* requests sharing a key, and returns **409 `invalid_idempotent_request`** otherwise. Rendering the retry with the *current* admin's address breaks the cross-admin lost-ack case — A's send accepted, response lost, B retries — by pairing A's key with a body naming B.
>
> **A fresh-key fallback is not an acceptable escape.** An earlier revision of this task fell back to a random key whenever the sender could not be resolved, which defeats Q30 entirely on that path: a lost ack leaves the row untouched, so the next attempt mints *another* fresh key and delivers again, forever. The key and the body must both be pure functions of the row.
>
> `originalSender()` reads `meta.actor_email` from the `user_invited` / `user_imported` event, which Q27 requires be committed in the same transaction as the row — i.e. before any I/O — and which is a frozen snapshot rather than a live join. That is strictly better than `invited_by`: the column is `ON DELETE SET NULL`, so a join through it would start returning a *different* sender the moment the inviting admin is deleted, which is the same 409 by another route. The audit snapshot cannot drift.
>
> **Q31b imports are the main case here, not a rare one.** The cutover creates every CF-only identity as `invited`, `invited_by NULL`, `invite_sent_at NULL`, with a `user_imported` event carrying the Q23 *system* actor shape — so no `actor_email` exists to recover, by design. Those rows resolve to the `SUPPORT_CONTACT` constant, which is equally stable across attempts. Both tests therefore make **two** attempts and assert an identical key *and* payload; a single-attempt test cannot observe this class of bug at all.

- [ ] **Step 7: Commit**

```bash
cd /var/home/jason/Projects/RepOS && git add api/src/services/userLifecycle.ts api/src/schemas/adminUsers.ts api/src/routes/adminUsers.ts api/src/app.ts api/tests/routes/admin-users-invite.test.ts
git commit -m "$(cat <<'EOF'
feat(w9): invite path — cap, ordering, audit atomicity, duplicate matrix

Count, insert and CF sync all run inside one critical section (Q18) so two
admins observing nine cannot both insert. The row is written non-activatable
with cf_synced_at NULL and only becomes activatable after a successful sync
(Q7, Q17b); a sync failure leaves it pending with no email sent and does not
roll back (Q8). user_invited commits with the INSERT (Q27). All five duplicate
cases return their specified code — no raw UNIQUE violation reaches the client.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Suspend, reinstate, and role change

Three transitions, one route. Revocations take effect **first** (DB then CF); reinstatement is a grant and takes effect **last** (Q17). Reinstatement clears `cf_synced_at` before the CF call and gets no `reinstating` status (Q34).

**Files:**
- Modify: `api/src/services/userLifecycle.ts` (append)
- Modify: `api/src/routes/adminUsers.ts` (append the PATCH route)
- Test: `api/tests/routes/admin-users-patch.test.ts`

**Interfaces:**
- Consumes: `withMembershipLock`, `ADMIN_COUNT_LOCK_KEY` (T4); `syncEmail` (T6); `LifecycleError`, `Actor`, `countCohort` (T11).
- Produces:
  - `patchUser(targetId: string, patch: UserPatch, actor: Actor): Promise<PatchOutcome>`
  - `type PatchOutcome = { id: string; email: string; role: UserRole; status: UserStatus; cf_synced: boolean; sync_error: string | null }`
  - Route `PATCH /api/admin/users/:id`.

- [ ] **Step 1: Write the failing test**

Create `api/tests/routes/admin-users-patch.test.ts`. Reuse the ephemeral-DB preamble from `admin-users-invite.test.ts` verbatim (ephemeral db, `runMigrations`, `process.env.DATABASE_URL`, dynamic imports of `app.js`/`client.js`/`cfAccessPolicy.js`/`cf-access-jwt.js`, the `policyEmails` spy harness), with tag `'patch'`, then:

```ts
async function patch(id: string, body: Record<string, unknown>, asEmail = ADMIN) {
  return app.inject({
    method: 'PATCH', url: `/api/admin/users/${id}`,
    headers: { 'cf-access-jwt-assertion': await jwks.mintJwt(asEmail), 'x-repos-csrf': '1' },
    payload: body,
  });
}

async function seed(email: string, status: string, role = 'member', cfSynced: Date | null = new Date()) {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO users (email, status, role, cf_synced_at) VALUES ($1,$2,$3,$4) RETURNING id`,
    [email, status, role, cfSynced],
  );
  if (status === 'active' || status === 'invited') policyEmails.push(email);
  return rows[0].id;
}

describe('suspend — revocation takes effect FIRST (Q17, Q24)', () => {
  it('commits suspended + NULL stamp, then removes from the policy, then stamps', async () => {
    const email = freshEmail('susp');
    const id = await seed(email, 'active');
    const r = await patch(id, { status: 'suspended' });
    expect(r.statusCode).toBe(200);
    const { rows } = await db.query<{ status: string; cf_synced_at: Date | null }>(
      `SELECT status, cf_synced_at FROM users WHERE id=$1`, [id],
    );
    expect(rows[0].status).toBe('suspended');
    expect(rows[0].cf_synced_at).not.toBeNull();
    expect(policyEmails).not.toContain(email);
  });

  it('with CF removal mocked to FAIL, the DB revocation has ALREADY committed', async () => {
    const email = freshEmail('suspfail');
    const id = await seed(email, 'active');
    fetchPolicyImpl = async () => { throw new policy.CfPolicyError('cf_http_error', 'down'); };
    const r = await patch(id, { status: 'suspended' });
    expect(r.statusCode).toBe(200);
    expect(r.json<{ sync_error: string }>().sync_error).toBe('cf_http_error');
    const { rows } = await db.query<{ status: string; cf_synced_at: Date | null }>(
      `SELECT status, cf_synced_at FROM users WHERE id=$1`, [id],
    );
    // The opposite of what the round-2 draft asserted: the DB change stands.
    expect(rows[0].status).toBe('suspended');
    expect(rows[0].cf_synced_at).toBeNull();
  });

  it('denies the suspended user on the VERY NEXT request, with CF still failing', async () => {
    const email = freshEmail('nextreq');
    const id = await seed(email, 'active');
    fetchPolicyImpl = async () => { throw new policy.CfPolicyError('cf_http_error', 'down'); };
    await patch(id, { status: 'suspended' });
    const me = await app.inject({
      method: 'GET', url: '/api/me',
      headers: { 'cf-access-jwt-assertion': await jwks.mintJwt(email) },
    });
    expect(me.statusCode).toBe(403);
    expect(me.json<{ error: string }>().error).toBe('access_suspended');
  });

  it('emits user_suspended with the human actor', async () => {
    const id = await seed(freshEmail('suspev'), 'active');
    await patch(id, { status: 'suspended' });
    const { rows } = await db.query<{ meta: Record<string, unknown> }>(
      `SELECT meta FROM account_events WHERE user_id=$1 AND kind='user_suspended'`, [id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].meta).toMatchObject({ actor_kind: 'user', actor_email: ADMIN });
  });

  it('suspends an invited row too (invited -> suspended is permitted)', async () => {
    const id = await seed(freshEmail('invsusp'), 'invited');
    expect((await patch(id, { status: 'suspended' })).statusCode).toBe(200);
  });
});

describe('reinstate — grant takes effect LAST (Q34)', () => {
  it('clears the stamp, adds to CF, then flips to active with a fresh stamp', async () => {
    const email = freshEmail('reinst');
    const id = await seed(email, 'suspended', 'member', new Date());
    const r = await patch(id, { status: 'active' });
    expect(r.statusCode).toBe(200);
    const { rows } = await db.query<{ status: string; cf_synced_at: Date | null }>(
      `SELECT status, cf_synced_at FROM users WHERE id=$1`, [id],
    );
    expect(rows[0].status).toBe('active');
    expect(rows[0].cf_synced_at).not.toBeNull();
    expect(policyEmails).toContain(email);
    const ev = await db.query<{ n: number }>(
      `SELECT count(*)::int n FROM account_events WHERE user_id=$1 AND kind='user_reinstated'`, [id],
    );
    expect(ev.rows[0].n).toBe(1);
  });

  it('CF add fails -> row stays suspended with a NULL stamp; policy untouched', async () => {
    const email = freshEmail('reinstfail');
    const id = await seed(email, 'suspended', 'member', new Date());
    fetchPolicyImpl = async () => { throw new policy.CfPolicyError('cf_timeout', 'slow'); };
    const r = await patch(id, { status: 'active' });
    expect(r.statusCode).toBe(502);
    expect(r.json<{ error: string }>().error).toBe('cf_sync_failed');
    const { rows } = await db.query<{ status: string; cf_synced_at: Date | null }>(
      `SELECT status, cf_synced_at FROM users WHERE id=$1`, [id],
    );
    // Q34: an interrupted reinstate has a correct, safe resting state. The
    // NULL stamp reads as sync-UNKNOWN, not confirmed drift (Q36) — the policy
    // was never modified, so a live read shows agreement.
    expect(rows[0].status).toBe('suspended');
    expect(rows[0].cf_synced_at).toBeNull();
    expect(policyEmails).not.toContain(email);
  });

  it('the failed-reinstate user is still denied on BOTH auth paths', async () => {
    const email = freshEmail('reinstboth');
    const id = await seed(email, 'suspended', 'member', new Date());
    const mint = await app.inject({
      method: 'POST', url: '/api/tokens',
      body: { user_id: id, label: 't', scopes: ['health:weight:write'] },
    });
    const token = mint.json<{ token: string }>().token;
    fetchPolicyImpl = async () => { throw new policy.CfPolicyError('cf_timeout', 'slow'); };
    await patch(id, { status: 'active' });

    const cf = await app.inject({
      method: 'GET', url: '/api/me',
      headers: { 'cf-access-jwt-assertion': await jwks.mintJwt(email) },
    });
    expect(cf.statusCode).toBe(403);
    const bearer = await app.inject({
      method: 'GET', url: '/api/account/sessions',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(bearer.statusCode).toBe(401);
  });

  it('reinstatement contends for the cohort cap (Q12, Q26)', async () => {
    await db.query(`DELETE FROM users WHERE email <> $1`, [ADMIN]);
    const id = await seed(freshEmail('capreinst'), 'suspended', 'member', new Date());
    for (let i = 0; i < 9; i++) {
      await db.query(`INSERT INTO users (email, status) VALUES ($1,'active')`, [freshEmail(`f${i}`)]);
    }
    // ADMIN + 9 fills = 10 counted; the suspended row is not counted, and
    // reinstating it would make 11.
    const r = await patch(id, { status: 'active' });
    expect(r.statusCode).toBe(409);
    expect(r.json<{ error: string }>().error).toBe('cohort_cap_reached');
  });
});

describe('transition matrix is closed (Q28)', () => {
  // Q28 says EVERY rejected transition is a 409 (spec line 247). These are
  // recognized lifecycle values that the schema accepts and the SERVICE
  // refuses — a 400 here would mean the enum was narrowed again, collapsing
  // "forbidden transition" into "malformed body".
  it('rejects anything -> invited with 409, not a schema 400', async () => {
    const id = await seed(freshEmail('toinv'), 'active');
    const r = await patch(id, { status: 'invited' });
    expect(r.statusCode).toBe(409);
    expect(r.json<{ error: string }>().error).toBe('invalid_transition');
  });

  it('rejects anything -> deleting with 409 — delete owns that transition', async () => {
    const id = await seed(freshEmail('todel'), 'active');
    const r = await patch(id, { status: 'deleting' });
    expect(r.statusCode).toBe(409);
    expect(r.json<{ error: string }>().error).toBe('invalid_transition');
  });

  it('rejects a role change on an invited row — Q28 allows role edits only on active/suspended', async () => {
    const id = await seed(freshEmail('invrole'), 'invited', 'member', null);
    const r = await patch(id, { role: 'admin' });
    expect(r.statusCode).toBe(409);
    expect(r.json<{ error: string }>().error).toBe('invalid_transition');
    const { rows } = await db.query<{ role: string }>(`SELECT role FROM users WHERE id=$1`, [id]);
    expect(rows[0].role).toBe('member');
  });

  // Deliberately strict: `invited -> suspended` is permitted on its own, but
  // Q28 scopes role edits by the row's CURRENT status, and that is `invited`.
  // Rejecting keeps the matrix closed rather than letting a role edit ride in
  // on a permitted status change.
  it('rejects a combined invited -> suspended + role change', async () => {
    const id = await seed(freshEmail('invboth'), 'invited', 'member', null);
    const r = await patch(id, { status: 'suspended', role: 'admin' });
    expect(r.statusCode).toBe(409);
  });

  it('still permits invited -> suspended on its own', async () => {
    const id = await seed(freshEmail('invsusp'), 'invited', 'member', null);
    expect((await patch(id, { status: 'suspended' })).statusCode).toBe(200);
  });

  it('rejects an unrecognized status with 400 — the schema still guards garbage', async () => {
    const id = await seed(freshEmail('garbage'), 'active');
    expect((await patch(id, { status: 'banana' } as never)).statusCode).toBe(400);
  });

  it('rejects deleting -> anything with 409', async () => {
    const id = await seed(freshEmail('fromdel'), 'deleting', 'member', null);
    const r = await patch(id, { status: 'active' });
    expect(r.statusCode).toBe(409);
    expect(r.json<{ error: string }>().error).toBe('invalid_transition');
  });

  it('rejects invited -> active — activation happens only through first sign-in (Q21)', async () => {
    const id = await seed(freshEmail('invact'), 'invited');
    const r = await patch(id, { status: 'active' });
    expect(r.statusCode).toBe(409);
    expect(r.json<{ error: string }>().error).toBe('invalid_transition');
  });

  it('rejects an empty patch', async () => {
    const id = await seed(freshEmail('empty'), 'active');
    expect((await patch(id, {})).statusCode).toBe(400);
  });
});

describe('the one invariant: at least one active admin (Q13, I2)', () => {
  it('rejects self-targeting outright — manage yourself in /settings/account', async () => {
    const r = await patch(adminId, { status: 'suspended' });
    expect(r.statusCode).toBe(409);
    expect(r.json<{ error: string }>().error).toBe('self_target_forbidden');
  });

  it('a SEQUENTIAL demotion can never be the last admin — the self-target guard sees to that', async () => {
    // Why there is no single-request `last_admin` case to write: the actor must
    // be an ACTIVE ADMIN to reach this route at all (requireCfAccessAdmin), and
    // self-targeting is refused before the service runs. So on any one request
    // the actor is an active admin who is NOT the target, and
    // assertAdminRemains — which counts active admins EXCLUDING the target —
    // can never see zero. The invariant is unreachable sequentially and bites
    // only in the concurrent case below, which is why that one is the real
    // coverage for it.
    //
    // This case pins the two halves of that reasoning rather than the
    // invariant: self-target is refused, and a fellow admin stepping down while
    // two exist is allowed.
    const other = await seed(freshEmail('other'), 'active', 'admin');
    const otherEmail = await emailOf(other);

    const selfTarget = await patch(adminId, { role: 'member' }, ADMIN);
    expect(selfTarget.statusCode).toBe(409);
    expect(selfTarget.json<{ error: string }>().error).toBe('self_target_forbidden');

    // `other` demotes ADMIN: two active admins exist, so one may step down.
    const stepDown = await patch(adminId, { role: 'member' }, otherEmail);
    expect(stepDown.statusCode).toBe(200);
    expect(stepDown.json<{ role: string }>().role).toBe('member');

    // `other` is now the only active admin — and cannot demote itself.
    const soloSelf = await patch(other, { role: 'member' }, otherEmail);
    expect(soloSelf.statusCode).toBe(409);
    expect(soloSelf.json<{ error: string }>().error).toBe('self_target_forbidden');
    const { rows } = await db.query<{ c: number }>(
      `SELECT count(*)::int c FROM users WHERE role='admin' AND status='active'`,
    );
    expect(rows[0].c).toBe(1);
  });

  it('409 last_admin when suspending the last active admin from another admin account', async () => {
    await db.query(`UPDATE users SET role='member' WHERE email <> $1`, [ADMIN]);
    const other = await seed(freshEmail('admin2'), 'active', 'admin');
    const otherEmail = await emailOf(other);
    // other demotes ADMIN -> ok (other remains). Then ADMIN (now member) cannot act.
    expect((await patch(adminId, { role: 'member' }, otherEmail)).statusCode).toBe(200);
    await db.query(`UPDATE users SET role='admin' WHERE id=$1`, [adminId]);
    // Now suspend `other` from ADMIN: two admins, allowed.
    expect((await patch(other, { status: 'suspended' }, ADMIN)).statusCode).toBe(200);
    // ADMIN is now the only active admin. A second admin account cannot exist
    // to suspend them, which is precisely the invariant holding.
    const solo = await db.query<{ c: number }>(
      `SELECT count(*)::int c FROM users WHERE role='admin' AND status='active'`,
    );
    expect(solo.rows[0].c).toBe(1);
  });

  it('two admins concurrently demoting each other: exactly one succeeds (Q26)', async () => {
    await db.query(`UPDATE users SET role='member' WHERE email <> $1`, [ADMIN]);
    await db.query(`UPDATE users SET role='admin', status='active' WHERE email=$1`, [ADMIN]);
    const b = await seed(freshEmail('adminb'), 'active', 'admin');
    const bEmail = await emailOf(b);
    // This is the ONLY place the last-admin invariant can actually fire, so it
    // is the only place that can prove it works. Both requests authenticate
    // while both callers are still admins, then serialize on the membership
    // lock; the loser's locked re-count sees the winner's commit and finds zero
    // other active admins. Without assertAdminRemains both succeed and the
    // deployment is left with no admin at all — recoverable only by SSH.
    const [r1, r2] = await Promise.all([
      patch(b, { role: 'member' }, ADMIN),
      patch(adminId, { role: 'member' }, bEmail),
    ]);
    const codes = [r1.statusCode, r2.statusCode].sort();
    expect(codes).toEqual([200, 409]);
    // Specifically last_admin — a bare 409 would also match self_target or the
    // cohort cap, neither of which has anything to do with this invariant.
    const loser = r1.statusCode === 409 ? r1 : r2;
    expect(loser.json<{ error: string }>().error).toBe('last_admin');
    const { rows } = await db.query<{ c: number }>(
      `SELECT count(*)::int c FROM users WHERE role='admin' AND status='active'`,
    );
    expect(rows[0].c).toBe(1);
    // restore for later tests
    await db.query(`UPDATE users SET role='admin', status='active' WHERE email=$1`, [ADMIN]);
  });
});

describe('lock order (Q26)', () => {
  it('a combined role-and-status PATCH runs concurrently with a pure role change without deadlock', async () => {
    await db.query(`UPDATE users SET role='admin', status='active' WHERE email=$1`, [ADMIN]);
    const a = await seed(freshEmail('lo-a'), 'active');
    const b = await seed(freshEmail('lo-b'), 'active');
    const [r1, r2] = await Promise.all([
      patch(a, { role: 'admin', status: 'suspended' }),
      patch(b, { role: 'admin' }),
    ]);
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
  });
});
```

Add this helper alongside `seed`:

```ts
async function emailOf(id: string): Promise<string> {
  const { rows } = await db.query<{ email: string }>(`SELECT email FROM users WHERE id=$1`, [id]);
  return rows[0].email;
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/routes/admin-users-patch.test.ts`
Expected: FAIL — the route 404s.

- [ ] **Step 3: Append the service functions**

Add to `api/src/services/userLifecycle.ts`:

```ts
import { withMembershipLock, ADMIN_COUNT_LOCK_KEY } from './membershipLock.js';
// (extend the existing membershipLock import rather than adding a second one)

export interface PatchOutcome {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  cf_synced: boolean;
  sync_error: string | null;
}

interface UserRow {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  cf_synced_at: Date | null;
}

async function readUser(targetId: string): Promise<UserRow> {
  const { rows } = await db.query<UserRow>(
    `SELECT id, email, role, status, cf_synced_at FROM users WHERE id=$1`,
    [targetId],
  );
  if (rows.length === 0) throw new LifecycleError(404, 'user_not_found');
  return rows[0];
}

/**
 * I2 / Q13 — the ONE invariant every path shares: at least one `active` admin
 * must always remain. Deny-by-default makes admin lockout unrecoverable except
 * by SSH break-glass.
 *
 * The caller MUST already hold pg_advisory_xact_lock(ADMIN_COUNT_LOCK_KEY) in
 * this transaction: this is a read-then-write check and races exactly like the
 * cohort cap did — two admins can otherwise concurrently demote each other
 * after each observes two admins, yielding zero.
 */
async function assertAdminRemains(
  client: import('pg').PoolClient,
  targetId: string,
  next: { role: UserRole; status: UserStatus },
): Promise<void> {
  if (next.role === 'admin' && next.status === 'active') return; // still an admin
  const { rows } = await client.query<{ c: number }>(
    `SELECT count(*)::int c FROM users
      WHERE role='admin' AND status='active' AND id <> $1`,
    [targetId],
  );
  if (rows[0].c === 0) throw new LifecycleError(409, 'last_admin');
}

/**
 * Lock order is fixed and single (Q26): session mutation lock -> BEGIN ->
 * transaction-level admin-count lock. Every path that needs both takes them in
 * exactly this order, so no two operations can deadlock.
 */
async function inAdminLockedTxn<T>(
  fn: (client: import('pg').PoolClient) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [ADMIN_COUNT_LOCK_KEY]);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function patchUser(
  targetId: string,
  patch: { role?: UserRole; status?: UserStatus },
  actor: Actor,
): Promise<PatchOutcome> {
  return withMembershipLock(async () => {
    const cur = await readUser(targetId);

    // Q28 — the matrix is closed. `deleting` is terminal here; delete owns it.
    if (cur.status === 'deleting') {
      throw new LifecycleError(409, 'invalid_transition', { from: 'deleting' });
    }

    const nextRole: UserRole = patch.role ?? cur.role;
    const nextStatus: UserStatus = patch.status ?? cur.status;

    if (patch.status !== undefined && patch.status !== cur.status) {
      const permitted =
        (cur.status === 'active' && patch.status === 'suspended') ||
        (cur.status === 'suspended' && patch.status === 'active') ||
        (cur.status === 'invited' && patch.status === 'suspended');
      if (!permitted) {
        // Notably invited -> active: activation happens ONLY through first
        // sign-in (Q21). Hand-setting it would re-arm an activation that the
        // conditional update assumes happens once. `-> invited` and
        // `-> deleting` also land here rather than at schema validation, so
        // they return 409 like every other rejected transition.
        throw new LifecycleError(409, 'invalid_transition', {
          from: cur.status,
          to: patch.status,
        });
      }
    }

    // Q28 permits role changes on `active`/`suspended` ONLY. An `invited` row
    // has no confirmed human behind it yet — its role is set at invite time
    // and settles at first sign-in (Q21). Without this guard a role-only PATCH
    // on an invited row falls straight through to the role branch below,
    // because the status check above is skipped when `patch.status` is absent.
    if (patch.role !== undefined && patch.role !== cur.role &&
        cur.status !== 'active' && cur.status !== 'suspended') {
      throw new LifecycleError(409, 'invalid_transition', {
        from: cur.status,
        role_change: true,
      });
    }

    const roleChanged = nextRole !== cur.role;
    const becomingSuspended = nextStatus === 'suspended' && cur.status !== 'suspended';
    const becomingActive = nextStatus === 'active' && cur.status === 'suspended';

    // ---- REINSTATE: a grant, so it takes effect LAST (Q17, Q34) ----
    if (becomingActive) {
      // Q26 — reinstating also grows the counted set: suspend one of ten,
      // invite a replacement, reinstate the original -> eleven.
      const count = await countCohort();
      if (count >= COHORT_CAP) {
        throw new LifecycleError(409, 'cohort_cap_reached', { count, cap: COHORT_CAP });
      }

      // Clear the stamp BEFORE the CF call. With the round-3 ordering a CF
      // success followed by a DB failure left the email in the policy while
      // the row kept a cf_synced_at earned while *suspended*, so it read as
      // synced when it was not.
      await db.query(`UPDATE users SET cf_synced_at = NULL WHERE id=$1`, [targetId]);

      try {
        await syncEmail(cur.email, 'present');
      } catch (err) {
        // Q8 is explicitly narrowed to grants that CREATE a row. An interrupted
        // reinstate has a correct and safe resting state — still suspended,
        // still denied on both paths — so it is simply retried, not modelled
        // with a fifth status.
        throw new LifecycleError(502, 'cf_sync_failed', { sync_error: syncErrorCode(err) });
      }

      return inAdminLockedTxn(async (client) => {
        await client.query(
          `UPDATE users SET status='active', role=$2, cf_synced_at=now() WHERE id=$1`,
          [targetId, nextRole],
        );
        await recordAccountEventTx(client, {
          userId: targetId, userEmail: cur.email, kind: 'user_reinstated',
          ip: actor.ip, meta: { ...humanActor(actor.userId, actor.email) },
        });
        if (roleChanged) {
          await recordAccountEventTx(client, {
            userId: targetId, userEmail: cur.email, kind: 'role_changed',
            ip: actor.ip,
            meta: { ...humanActor(actor.userId, actor.email), from: cur.role, to: nextRole },
          });
        }
        return {
          id: targetId, email: cur.email, role: nextRole, status: 'active' as UserStatus,
          cf_synced: true, sync_error: null,
        };
      });
    }

    // ---- SUSPEND: a revocation, so it takes effect FIRST (Q17) ----
    if (becomingSuspended) {
      await inAdminLockedTxn(async (client) => {
        await assertAdminRemains(client, targetId, { role: nextRole, status: 'suspended' });
        // Q24 — any status change that alters CF membership clears the stamp
        // first; it is re-stamped only after a successful sync.
        await client.query(
          `UPDATE users SET status='suspended', role=$2, cf_synced_at=NULL WHERE id=$1`,
          [targetId, nextRole],
        );
        await recordAccountEventTx(client, {
          userId: targetId, userEmail: cur.email, kind: 'user_suspended',
          ip: actor.ip, meta: { ...humanActor(actor.userId, actor.email) },
        });
        if (roleChanged) {
          await recordAccountEventTx(client, {
            userId: targetId, userEmail: cur.email, kind: 'role_changed',
            ip: actor.ip,
            meta: { ...humanActor(actor.userId, actor.email), from: cur.role, to: nextRole },
          });
        }
      });

      // The DB revocation has already committed and already denies access on
      // every request. Policy removal only prevents NEW sessions; a live CF
      // session may persist until it expires and is harmless (Q17a).
      let cf_synced = false;
      let sync_error: string | null = null;
      try {
        await syncEmail(cur.email, 'absent');
        await db.query(`UPDATE users SET cf_synced_at = now() WHERE id=$1`, [targetId]);
        cf_synced = true;
      } catch (err) {
        sync_error = syncErrorCode(err);
      }
      return {
        id: targetId, email: cur.email, role: nextRole,
        status: 'suspended' as UserStatus, cf_synced, sync_error,
      };
    }

    // ---- ROLE ONLY: no CF membership change, so cf_synced_at is untouched ----
    if (!roleChanged) {
      return {
        id: targetId, email: cur.email, role: cur.role, status: cur.status,
        cf_synced: cur.cf_synced_at !== null, sync_error: null,
      };
    }

    return inAdminLockedTxn(async (client) => {
      await assertAdminRemains(client, targetId, { role: nextRole, status: cur.status });
      await client.query(`UPDATE users SET role=$2 WHERE id=$1`, [targetId, nextRole]);
      await recordAccountEventTx(client, {
        userId: targetId, userEmail: cur.email, kind: 'role_changed',
        ip: actor.ip,
        meta: { ...humanActor(actor.userId, actor.email), from: cur.role, to: nextRole },
      });
      return {
        id: targetId, email: cur.email, role: nextRole, status: cur.status,
        cf_synced: cur.cf_synced_at !== null, sync_error: null,
      };
    });
  });
}
```

Export `countCohort` from the module (change `async function countCohort` to `export async function countCohort`) — Task 14 reads it for the list response.

- [ ] **Step 4: Append the route**

Add to `api/src/routes/adminUsers.ts`, and extend the import to pull in `UserPatchSchema` and `patchUser`:

```ts
  app.patch<{ Params: { id: string } }>(
    '/admin/users/:id',
    { preHandler: [requireCfAccessAdmin(), csrfOrigin] },
    async (req, reply) => {
      const parsed = UserPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
      }
      const actor = actorOf(req);
      // Q13 — the admin list rejects self-targeting outright. This is a UX
      // policy, not the invariant: manage yourself in /settings/account. The
      // invariant itself ("at least one active admin remains") is enforced
      // inside the service and applies to every path including /api/me.
      if (req.params.id === actor.userId) {
        return reply.code(409).send({ error: 'self_target_forbidden' });
      }
      try {
        return reply.code(200).send(await patchUser(req.params.id, parsed.data, actor));
      } catch (err) {
        return sendLifecycleError(reply, err);
      }
    },
  );
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/routes/admin-users-patch.test.ts`
Expected: PASS, 23 tests.

> **`last_admin` is unreachable through this route in a single request — and the test that claimed to prove it proved nothing.** The case originally named *"409 last_admin when demoting the only active admin"* asserted `self_target_forbidden` twice and one successful demotion; it never asserted `last_admin` at all, and its own comment trailed off mid-sentence (`then have other... no:`). Disabling `assertAdminRemains` entirely left it **passing**.
>
> The reason no such single-request case can be written: the actor must be an **active admin** to clear `requireCfAccessAdmin`, and self-targeting is refused *before* the service runs — so on any one request there is always an active admin who is not the target, and a count that excludes the target can never reach zero. The invariant bites **only** in the concurrent case, where both callers authenticate while both are still admins and then serialize on the membership lock: the loser's locked re-count sees the winner's commit. That case is therefore the sole real coverage, and it now asserts the error is specifically `last_admin` — a bare 409 would equally match `self_target_forbidden` or `cohort_cap_reached`, neither of which involves this invariant. With `assertAdminRemains` disabled it returns `[200, 200]`: **zero admins, recoverable only by SSH break-glass.** The vacuous case was rewritten to pin what is actually true (self-target refused; a fellow admin may step down while two exist).
>
> **One preamble deviation, same as Task 11:** the suite must set `PUBLIC_ORIGIN` itself. It is not in `api/.env` and `csrfOrigin` fails closed without it, *before* checking `X-RepOS-CSRF`, so every PATCH would 403 for a reason unrelated to the transition matrix. `INVITE_FROM_EMAIL` is not needed here — no path mails. A `beforeEach` also restores ADMIN to `role='admin', status='active'`, because several cases deliberately demote or suspend admins and test order is not worth depending on.
>
> **Mutation-tested, five mutations, each killing only its intended cases:** disabling the last-admin invariant fails only the concurrent demotion; removing the CF call from after the DB commit (revoking in Cloudflare *first*) fails both "DB revocation already committed" and "denied on the very next request"; dropping the `cf_synced_at = NULL` that precedes the reinstate sync fails the failed-reinstate resting-state case; removing the Q28 role-scope guard fails both invited-row role cases; and skipping the reinstate cohort-cap check fails the cap case.
>
> **Note on the shipped file vs. this block:** Step 3's `import` line is the one intentional difference — Task 11 ships `import { withMembershipLock }` and this task extends it to add `ADMIN_COUNT_LOCK_KEY`, exactly as Step 3 instructs. `countCohort` is exported in the Task 11 block itself so both blocks stay byte-identical to the shipped file.

- [ ] **Step 6: Commit**

```bash
git add api/src/services/userLifecycle.ts api/src/routes/adminUsers.ts api/tests/routes/admin-users-patch.test.ts
git commit -m "$(cat <<'EOF'
feat(w9): suspend, reinstate and role change (Q13, Q17, Q26, Q28, Q34)

Suspension commits the DB revocation first and removes from the policy after,
so a CF failure still denies on the very next request. Reinstatement clears
cf_synced_at, adds to CF, then flips to active last; a failed add leaves an
ordinary suspended row with an unknown stamp. Role changes and last-admin
checks take a transaction-level lock under the fixed order session -> BEGIN ->
xact, so two admins cannot concurrently demote each other to zero.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Unified deletion

Verified at `account.ts:316-338`: `DELETE /api/me` deletes the row directly with no status transition, no CF removal, no lock, no role check, and no `account_events` row. Two deletion paths with different security semantics is the defect — the last-admin guard is trivially bypassed by an admin deleting themselves, and the deleted user's email is orphaned in the CF policy forever (Q33).

**Files:**
- Create: `api/src/services/deleteUser.ts`
- Modify: `api/src/routes/adminUsers.ts` (append DELETE)
- Modify: `api/src/routes/account.ts:314-365`
- Test: `api/tests/routes/admin-users-delete.test.ts`

**Interfaces:**
- Consumes: `withMembershipLock` (T4), `syncEmail` (T6), `LifecycleError`/`Actor`/`inAdminLockedTxn` (T11/T12).
- Produces: `deleteUser(targetId: string, actor: Actor): Promise<{ id: string; previous_token_count: number }>`

> **`inAdminLockedTxn` is EXPORTED from `userLifecycle.ts`, not re-implemented here.** Task 12 left
> it module-private and the first draft of this task hand-rolled a byte-identical
> `BEGIN` → `pg_advisory_xact_lock` → `COMMIT` / `ROLLBACK` / `release` copy inside `deleteUser`.
> Two copies of the lock ORDER is exactly the thing Q26 exists to make single: a later change to
> the order would have to be found twice. Step 3 flips the `async function` to
> `export async function` and imports it.
>
> It deliberately does **not** reuse `assertAdminRemains`. That helper throws whenever no OTHER
> active admin exists, which is right for a demotion and wrong here: deleting a **member** removes
> no admin, so refusing it because the installation happens to have zero active admins would block
> an unrelated user's self-deletion. Only a target who IS currently an active admin can breach I2,
> which is what the `cur.role === 'admin' && cur.status === 'active'` guard says.

- [ ] **Step 1: Write the failing test**

Create `api/tests/routes/admin-users-delete.test.ts` with the same ephemeral-DB preamble (tag `'delete'`), then:

```ts
describe('admin delete — the full state machine (Q17, Q17b, Q27, Q33)', () => {
  it('sets deleting first, removes from CF, stamps, then cascades', async () => {
    const email = freshEmail('del');
    const id = await seed(email, 'active');
    const r = await del(id);
    expect(r.statusCode).toBe(204);
    const { rows } = await db.query(`SELECT id FROM users WHERE id=$1`, [id]);
    expect(rows).toHaveLength(0);
    expect(policyEmails).not.toContain(email);
  });

  it('emits BOTH user_delete_requested and user_deleted, and they survive the cascade', async () => {
    const email = freshEmail('delev');
    const id = await seed(email, 'active');
    await del(id);
    const { rows } = await db.query<{ kind: string; user_id: string | null; user_id_at_event: string; user_email_at_event: string }>(
      `SELECT kind, user_id, user_id_at_event, user_email_at_event
         FROM account_events WHERE user_id_at_event=$1 ORDER BY occurred_at`, [id],
    );
    const kinds = rows.map((r) => r.kind);
    expect(kinds).toContain('user_delete_requested');
    expect(kinds).toContain('user_deleted');
    // FK is ON DELETE SET NULL; the snapshot columns preserve attribution.
    expect(rows.every((r) => r.user_id === null)).toBe(true);
    expect(rows.every((r) => r.user_email_at_event === email)).toBe(true);
  });

  it('CF removal fails -> status=deleting, every cascaded row still intact, resumable', async () => {
    const email = freshEmail('delfail');
    const id = await seed(email, 'active');
    await db.query(
      `INSERT INTO health_weight_samples (user_id, sample_date, sample_time, weight_lbs, source)
       VALUES ($1, '2026-07-01', '08:00', 180.0, 'Manual')`, [id],
    );
    fetchPolicyImpl = async () => { throw new policy.CfPolicyError('cf_http_error', 'down'); };
    const r = await del(id);
    expect(r.statusCode).toBe(502);

    const u = await db.query<{ status: string; cf_synced_at: Date | null }>(
      `SELECT status, cf_synced_at FROM users WHERE id=$1`, [id],
    );
    expect(u.rows[0].status).toBe('deleting');
    expect(u.rows[0].cf_synced_at).toBeNull();
    // Asserted by ROW COUNTS, not just a status code.
    const child = await db.query<{ n: number }>(
      `SELECT count(*)::int n FROM health_weight_samples WHERE user_id=$1`, [id],
    );
    expect(child.rows[0].n).toBe(1);
    const ev = await db.query<{ n: number }>(
      `SELECT count(*)::int n FROM account_events
        WHERE user_id_at_event=$1 AND kind='user_delete_requested'`, [id],
    );
    expect(ev.rows[0].n).toBe(1);
  });

  it('a second admin resumes an interrupted delete without a duplicate request event', async () => {
    const email = freshEmail('resume');
    const id = await seed(email, 'active');
    fetchPolicyImpl = async () => { throw new policy.CfPolicyError('cf_http_error', 'down'); };
    await del(id);
    // CF recovers; a different admin finishes the job.
    fetchPolicyImpl = async () => ({
      emails: [...policyEmails], name: 'Owner Only', decision: 'allow',
      config: { name: 'Owner Only', decision: 'allow', include: policyEmails.map((e) => ({ email: { email: e } })), exclude: [], require: [] },
    });
    const r = await del(id);
    expect(r.statusCode).toBe(204);
    const ev = await db.query<{ n: number }>(
      `SELECT count(*)::int n FROM account_events
        WHERE user_id_at_event=$1 AND kind='user_delete_requested'`, [id],
    );
    expect(ev.rows[0].n).toBe(1); // the original requester is preserved
  });

  it('Q27: with the cascade blocked, user_deleted is rolled back with it', async () => {
    const email = freshEmail('cascfail');
    const id = await seed(email, 'active');
    // A NO ACTION child row makes the DELETE inside the final transaction
    // raise, deterministically, with no mocking of the db layer.
    await db.query(`INSERT INTO w9_block (user_id) VALUES ($1)`, [id]);
    const r = await del(id);
    expect(r.statusCode).toBe(500);
    const ev = await db.query<{ n: number }>(
      `SELECT count(*)::int n FROM account_events
        WHERE user_id_at_event=$1 AND kind='user_deleted'`, [id],
    );
    expect(ev.rows[0].n).toBe(0); // no event describing a mutation that did not happen
    await db.query(`DELETE FROM w9_block WHERE user_id=$1`, [id]);
  });

  it('rejects self-targeting on the admin route (Q13)', async () => {
    const r = await del(adminId);
    expect(r.statusCode).toBe(409);
    expect(r.json<{ error: string }>().error).toBe('self_target_forbidden');
  });

  it('rejects an Authorization: Bearer header (Q20)', async () => {
    const id = await seed(freshEmail('bearerdel'), 'active');
    const r = await app.inject({
      method: 'DELETE', url: `/api/admin/users/${id}`,
      headers: { authorization: 'Bearer whatever', 'x-repos-csrf': '1' },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json<{ error: string }>().error).toBe('cf_access_required');
  });

  it('a deleting row occupies a cohort slot until the cascade completes (Q12)', async () => {
    await db.query(`DELETE FROM users WHERE email <> $1`, [ADMIN]);
    const id = await seed(freshEmail('slot'), 'active');
    fetchPolicyImpl = async () => { throw new policy.CfPolicyError('cf_http_error', 'down'); };
    await del(id);
    const { rows } = await db.query<{ c: number }>(
      `SELECT count(*)::int c FROM users WHERE status IN ('active','invited','deleting')`,
    );
    expect(rows[0].c).toBe(2); // ADMIN + the deleting row
  });
});

describe('DELETE /api/me shares the same service (Q33)', () => {
  async function selfDelete(email: string) {
    return app.inject({
      method: 'DELETE', url: '/api/me',
      headers: { 'cf-access-jwt-assertion': await jwks.mintJwt(email), 'x-repos-csrf': '1' },
      payload: { confirm: 'DELETE my account' },
    });
  }

  it('a member self-deletes: same end state as the admin route', async () => {
    const email = freshEmail('selfmem');
    const id = await seed(email, 'active');
    const r = await selfDelete(email);
    expect(r.statusCode).toBe(204);
    const { rows } = await db.query(`SELECT id FROM users WHERE id=$1`, [id]);
    expect(rows).toHaveLength(0);
    expect(policyEmails).not.toContain(email);
    const ev = await db.query<{ kind: string }>(
      `SELECT kind FROM account_events WHERE user_id_at_event=$1`, [id],
    );
    expect(ev.rows.map((r) => r.kind)).toEqual(
      expect.arrayContaining(['user_delete_requested', 'user_deleted']),
    );
  });

  it('a NON-LAST admin may self-delete (Q13, correcting the round-4 blanket ban)', async () => {
    await db.query(`UPDATE users SET role='admin', status='active' WHERE email=$1`, [ADMIN]);
    const email = freshEmail('selfadmin');
    await seed(email, 'active', 'admin');
    expect((await selfDelete(email)).statusCode).toBe(204);
  });

  it('the LAST active admin is refused with 409 before ANY mutation', async () => {
    await db.query(`UPDATE users SET role='member' WHERE email <> $1`, [ADMIN]);
    const r = await selfDelete(ADMIN);
    expect(r.statusCode).toBe(409);
    expect(r.json<{ error: string }>().error).toBe('last_admin');
    const { rows } = await db.query<{ status: string }>(
      `SELECT status FROM users WHERE email=$1`, [ADMIN],
    );
    expect(rows[0].status).toBe('active'); // no mutation happened
  });

  it('still rejects a Bearer header and a wrong confirm phrase', async () => {
    const email = freshEmail('selfguard');
    await seed(email, 'active');
    const bearer = await app.inject({
      method: 'DELETE', url: '/api/me',
      headers: { authorization: 'Bearer x', 'x-repos-csrf': '1' },
      payload: { confirm: 'DELETE my account' },
    });
    expect(bearer.statusCode).toBe(403);
    const wrong = await app.inject({
      method: 'DELETE', url: '/api/me',
      headers: { 'cf-access-jwt-assertion': await jwks.mintJwt(email), 'x-repos-csrf': '1' },
      payload: { confirm: 'delete it' },
    });
    expect(wrong.statusCode).toBe(400);
  });

  it('Q37: an interrupted self-delete cannot be resumed by the user, only by an admin', async () => {
    const email = freshEmail('interrupt');
    const id = await seed(email, 'active');
    const mint = await app.inject({
      method: 'POST', url: '/api/tokens',
      body: { user_id: id, label: 't', scopes: ['health:weight:write'] },
    });
    const token = mint.json<{ token: string }>().token;

    fetchPolicyImpl = async () => { throw new policy.CfPolicyError('cf_http_error', 'down'); };
    const failed = await selfDelete(email);
    expect(failed.statusCode).toBe(502);
    // The Q37 contract, asserted rather than assumed: this is the response the
    // user is left holding, and it is the only thing that tells them the
    // account is already disabled and who can finish the job. It rides on the
    // `disabled` flag now, so nothing else pins it down.
    const failedBody = failed.json<{ disabled?: boolean; message?: string }>();
    expect(failedBody.disabled).toBe(true);
    expect(failedBody.message).toContain(SUPPORT_CONTACT);

    // Both auth paths now reject them.
    const cf = await app.inject({
      method: 'GET', url: '/api/me',
      headers: { 'cf-access-jwt-assertion': await jwks.mintJwt(email) },
    });
    expect(cf.statusCode).toBe(403);
    const bearer = await app.inject({
      method: 'GET', url: '/api/account/sessions',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(bearer.statusCode).toBe(401);
    // They cannot call /api/me again — the gate stops them before the handler.
    expect((await selfDelete(email)).statusCode).toBe(403);

    // An admin completes it.
    fetchPolicyImpl = async () => ({
      emails: [...policyEmails], name: 'Owner Only', decision: 'allow',
      config: { name: 'Owner Only', decision: 'allow', include: policyEmails.map((e) => ({ email: { email: e } })), exclude: [], require: [] },
    });
    expect((await del(id)).statusCode).toBe(204);

    // The bearer this user held is recorded on the audit row before the
    // cascade wipes device_tokens — the count is unrecoverable afterwards, so
    // reading it late would silently always be 0. This case is the only one
    // that mints a token, so it is the only place the field is falsifiable.
    const ev = await db.query<{ meta: { previous_token_count?: number } }>(
      `SELECT meta FROM account_events
        WHERE user_id_at_event=$1 AND kind='user_deleted'`, [id],
    );
    expect(ev.rows[0].meta.previous_token_count).toBe(1);
  });

  it('Q37: a cascade failure AFTER the disable also returns the contact path', async () => {
    // The CF-failure case above is not the only way to strand a self-deleting
    // user. Phase 1 has already committed status='deleting' by the time the
    // cascade runs, so ANY finalization failure leaves them denied on both
    // auth paths with no way to retry. Q37 owes them the same message, which
    // means it must key on that STATE, not on one error code.
    const email = freshEmail('selffinal');
    const id = await seed(email, 'active');
    await db.query(`INSERT INTO w9_block (user_id) VALUES ($1)`, [id]);

    const r = await selfDelete(email);
    expect(r.statusCode).toBe(500);
    const body = r.json<{ error: string; disabled?: boolean; resumable?: boolean; message?: string }>();
    expect(body.error).toBe('delete_finalize_failed');
    expect(body.disabled).toBe(true);
    expect(body.resumable).toBe(true);
    expect(body.message).toContain(SUPPORT_CONTACT);

    // Durably disabled, and no event describing a deletion that did not happen.
    const u = await db.query<{ status: string }>(
      `SELECT status FROM users WHERE id=$1`, [id],
    );
    expect(u.rows[0].status).toBe('deleting');
    const ev = await db.query<{ n: number }>(
      `SELECT count(*)::int n FROM account_events
        WHERE user_id_at_event=$1 AND kind='user_deleted'`, [id],
    );
    expect(ev.rows[0].n).toBe(0);

    await db.query(`DELETE FROM w9_block WHERE user_id=$1`, [id]);
  });
});
```

Add the `del` helper next to `patch`:

```ts
async function del(id: string, asEmail = ADMIN) {
  return app.inject({
    method: 'DELETE', url: `/api/admin/users/${id}`,
    headers: { 'cf-access-jwt-assertion': await jwks.mintJwt(asEmail), 'x-repos-csrf': '1' },
  });
}
```

> Delete the abandoned `vi.spyOn(db, 'connect')` fragment in the cascade-failure test when writing the file — the `w9_block` NO ACTION child row is the deterministic mechanism. Create it once in `beforeAll` (it FKs `users`, so it must outlive every case that seeds one) and `DROP TABLE IF EXISTS w9_block` in `afterAll`, before `db.end()`.

> **An assertion added to the Q37 case after mutation-testing: `previous_token_count`.** The 13
> cases above never assert it. Replacing `tok.rows[0]?.n ?? 0` with a literal `0` leaves **all 13
> passing** — the
> field is on the service's return type AND in the `user_deleted` audit meta, and nothing
> falsifies it. The Q37 case is the only one that mints a token, so it is the only place the value
> can be anything but zero; it now re-reads the `user_deleted` row and asserts
> `meta.previous_token_count === 1`. This matters beyond coverage: `device_tokens` is CASCADE-wiped
> by Phase 3, so the count is unrecoverable afterwards — a late read would silently always be 0.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/routes/admin-users-delete.test.ts`
Expected: FAIL — the admin DELETE route 404s and `/api/me` deletes without a status transition.

- [ ] **Step 3: Write the shared service**

This step makes **two edits to `api/src/services/userLifecycle.ts`** that Task 13's code depends
on, so a run that regenerates Task 11 or 12 from the plan without them will not compile:

1. `async function inAdminLockedTxn` → `export async function inAdminLockedTxn` (see the
   Interfaces note above for why it is reused rather than copied).
2. `LifecycleError`'s constructor gains an optional 4th `options?: { cause?: unknown }` forwarded
   to `super(code, options)`. Task 13's finalization catch wraps a raw driver error to give the
   client a usable contract; without a cause the operator loses the stack trace that wrapping
   discarded. The Task 11 block above already shows the updated class.

Create `api/src/services/deleteUser.ts`:

```ts
// W9 Q33 — the SINGLE deletion state machine. Both DELETE /api/admin/users/:id
// and DELETE /api/me call this; neither path deletes a row directly.
//
// Before this, account.ts:338 deleted the row outright: no status transition,
// no CF removal, no lock, no role check, no account_events row. Two deletion
// paths with different security semantics is the defect — an admin could
// bypass the last-admin guard by deleting themselves through /api/me, causing
// exactly the zero-admin lockout Q13 exists to prevent, and the deleted user's
// email was orphaned in the CF policy forever.
//
// Framing the rule as "at least one active admin must remain" rather than "no
// self-delete" is what makes the two paths reconcilable: the self-action bans
// were a cruder proxy for it.
import { db } from '../db/client.js';
import { withMembershipLock } from './membershipLock.js';
import { syncEmail } from './cfAccessSync.js';
import { CfPolicyError } from './cfAccessPolicy.js';
import { recordAccountEventTx, humanActor } from './accountEvents.js';
import { LifecycleError, inAdminLockedTxn, type Actor } from './userLifecycle.js';

export async function deleteUser(
  targetId: string,
  actor: Actor,
): Promise<{ id: string; previous_token_count: number }> {
  return withMembershipLock(async () => {
    const { rows } = await db.query<{ email: string; status: string; role: string }>(
      `SELECT email, status, role FROM users WHERE id=$1`,
      [targetId],
    );
    if (rows.length === 0) throw new LifecycleError(404, 'user_not_found');
    const cur = rows[0];

    const tok = await db.query<{ n: number }>(
      `SELECT count(*)::int n FROM device_tokens WHERE user_id=$1`,
      [targetId],
    );
    const previous_token_count = tok.rows[0]?.n ?? 0;

    // ---- Phase 1: durable intent (Q17b) ----
    // Skipped when the row is ALREADY deleting: an interrupted delete may be
    // resumed by a different admin, and re-emitting user_delete_requested
    // would attribute the whole operation to whoever finished it and lose the
    // original requester (Q27).
    if (cur.status !== 'deleting') {
      // Lock order (Q26): session lock -> BEGIN -> transaction lock. This is
      // the SAME helper patchUser uses rather than a second hand-rolled copy,
      // so the order cannot drift between the two files.
      await inAdminLockedTxn(async (client) => {
        const remaining = await client.query<{ c: number }>(
          `SELECT count(*)::int c FROM users
            WHERE role='admin' AND status='active' AND id <> $1`,
          [targetId],
        );
        // I2 — refused BEFORE any mutation.
        //
        // Deliberately NOT assertAdminRemains(): that helper throws whenever no
        // other active admin exists, which is right for a demotion but wrong
        // here. Deleting a MEMBER removes no admin, so refusing it because the
        // installation happens to have zero active admins would block an
        // unrelated user's self-deletion. Only a target who IS currently an
        // active admin can breach the invariant.
        if (cur.role === 'admin' && cur.status === 'active' && remaining.rows[0].c === 0) {
          throw new LifecycleError(409, 'last_admin');
        }
        // Q24 — the stamp is cleared because CF membership is about to change.
        await client.query(
          `UPDATE users SET status='deleting', cf_synced_at=NULL WHERE id=$1`,
          [targetId],
        );
        await recordAccountEventTx(client, {
          userId: targetId,
          userEmail: cur.email,
          kind: 'user_delete_requested',
          ip: actor.ip,
          meta: { ...humanActor(actor.userId, actor.email) },
        });
      });
    }

    // ---- Phase 2: CF policy removal ----
    // The DB already denies this user on both auth paths, so a failure here is
    // recoverable: the intent is durable and any admin can resume.
    try {
      await syncEmail(cur.email, 'absent');
      await db.query(`UPDATE users SET cf_synced_at = now() WHERE id=$1`, [targetId]);
    } catch (err) {
      throw new LifecycleError(502, 'cf_sync_failed', {
        sync_error: err instanceof CfPolicyError ? err.code : 'cf_unknown_error',
        // `disabled` is the fact the caller has to act on: Phase 1 has already
        // committed status='deleting', so this identity is refused on both auth
        // paths whatever happens next. It is a property of WHERE the failure
        // landed, not of the error code — patchUser's reinstate branch throws
        // the same `cf_sync_failed` and is NOT disabled by it (the row stays
        // suspended, exactly as it was). Routes must therefore branch on this,
        // never on the code.
        disabled: true,
        resumable: true,
      });
    }

    // ---- Phase 3: the cascade (Q27) ----
    // user_deleted is written immediately before the DELETE, in the SAME
    // transaction, so its user_id_at_event + user_email_at_event snapshot
    // survives the FK ON DELETE SET NULL. If the cascade fails, the event
    // rolls back with it — no event describing a mutation that did not happen.
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await recordAccountEventTx(client, {
        userId: targetId,
        userEmail: cur.email,
        kind: 'user_deleted',
        ip: actor.ip,
        meta: { ...humanActor(actor.userId, actor.email), previous_token_count },
      });
      await client.query('DELETE FROM users WHERE id=$1', [targetId]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      if (err instanceof LifecycleError) throw err;
      // A raw rethrow here reaches the routes as an unrecognised error and
      // becomes a bare 500 `delete_failed` — which strands a self-deleting
      // user. Phase 1 committed status='deleting' before this transaction ran
      // (or found it already committed on the resume path), so the account is
      // ALREADY disabled on both auth paths: the user cannot sign in to retry
      // and cannot discover who has to finish it. Q37 owes them the same
      // "already disabled, here is the contact" response as a CF failure, so
      // this failure has to arrive at the route carrying the same facts.
      throw new LifecycleError(
        500,
        'delete_finalize_failed',
        { disabled: true, resumable: true },
        { cause: err },
      );
    } finally {
      client.release();
    }

    return { id: targetId, previous_token_count };
  });
}
```

- [ ] **Step 4: Wire both routes**

Append to `api/src/routes/adminUsers.ts` (import `deleteUser`):

```ts
  app.delete<{ Params: { id: string } }>(
    '/admin/users/:id',
    // Q20 + Q32: CF Access + role='admin', X-Admin-Key rejected, and a bearer
    // rejected before JWT validation. This makes NO re-authentication
    // guarantee — it performs no token-age check.
    { preHandler: [requireCfAccessAdmin({ rejectBearer: true }), csrfOrigin] },
    async (req, reply) => {
      const actor = actorOf(req);
      if (req.params.id === actor.userId) {
        return reply.code(409).send({ error: 'self_target_forbidden' });
      }
      try {
        await deleteUser(req.params.id, actor);
        return reply.code(204).send();
      } catch (err) {
        return sendLifecycleError(reply, err);
      }
    },
  );
```

Replace the body of `DELETE /me` in `api/src/routes/account.ts` (lines 314–365), keeping the preHandler chain, the confirm-phrase check, the cookie clear and the 204:

```ts
  // DELETE /api/me — full-cascade account deletion (Task 9).
  //
  // Auth: CF-Access-JWT-only (per C-SIGNOUT-CFACCESS-ONLY) — a stolen bearer
  // must NEVER be able to delete a user's account. requireCfAccessOnly 403s
  // any Authorization: Bearer header before JWT validation and stamps
  // authMode='cf_access' so the chained csrfOrigin guard runs.
  //
  // Body: { confirm: "DELETE my account" } — exact-match typed-confirm phrase
  // (per I-CONFIRM-PHRASE-CONST) so a misclicked DELETE without the dialog
  // never lands.
  //
  // Cascade: DB-level ON DELETE CASCADE on users.id (per D8 + the migration
  // FK shapes — every per-user table FKs back to users with CASCADE) does the
  // wipe. account_events FK is ON DELETE SET NULL with user_id_at_event +
  // user_email_at_event preserved — forensic survival.
  //
  // Atomicity: W9 Q33 moved the mechanism into services/deleteUser.ts. This
  // handler no longer opens a transaction of its own; the service runs the
  // whole state machine (lock -> deleting + user_delete_requested -> CF
  // removal -> user_deleted + cascade in one txn) and this route only maps its
  // errors. The structured log still fires AFTER the cascade commits (per
  // I-DELETE-COMPLETED) — never claim deleted on a half-committed state.
  app.delete(
    '/me',
    { preHandler: [requireCfAccessOnly, csrfOrigin] },
    async (req, reply) => {
      const userId = (req as { userId?: string }).userId;
      const userEmail = (req as { userEmail?: string }).userEmail;
      if (!userId || !userEmail) return reply.code(500).send({ error: 'auth_state_missing' });

      const parsed = DeleteMeRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: 'invalid_confirm', expected: CONFIRM_DELETE_ACCOUNT_PHRASE });
      }

      // W9 Q33: this no longer deletes the row itself. It delegates to the ONE
      // deleteUser service so the self-service and admin paths produce
      // identical end state — same events, same CF removal, same cascade — and
      // so the "at least one active admin remains" invariant cannot be
      // bypassed here.
      //
      // W6's own path recorded account_deleted only as a log line with no
      // account_events row; the service does not inherit that gap.
      //
      // Q37: once status='deleting' commits, both auth paths reject this user,
      // so they cannot call this route again. A failed self-delete tells them
      // the account is already disabled and gives the contact path from the
      // invite email. Letting a `deleting` user re-authenticate to finish
      // deleting themselves would punch a hole through the gate for the one
      // status that most needs it shut.
      let previousTokenCount = 0;
      try {
        const out = await deleteUser(userId, { userId, email: userEmail, ip: req.ip ?? null });
        previousTokenCount = out.previous_token_count;
      } catch (err) {
        if (err instanceof LifecycleError) {
          // Q37 keys on the STATE, not on one error code. Any failure past the
          // status='deleting' commit leaves this user denied on both auth
          // paths with no way to retry, so every such failure — a CF removal
          // that failed, a cascade that failed, an audit insert that failed —
          // owes them the same "already disabled, here is who can finish it"
          // response. Matching `cf_sync_failed` instead covered exactly the
          // one failure the tests happened to inject; `last_admin` and the
          // other pre-mutation refusals correctly carry no `disabled` flag
          // because they roll back and the account still works.
          const disabled = err.details.disabled === true;
          if (disabled) {
            // The client contract is now typed, but the operator still needs
            // the underlying fault — LifecycleError carries it as `cause`.
            req.log.error({ err, userId }, 'account_delete_finalize_failed');
          }
          return reply.code(err.statusCode).send({
            error: err.code,
            ...err.details,
            ...(disabled
              ? { message: `Your account is already disabled and cannot be used. Contact ${SUPPORT_CONTACT} to finish removing it.` }
              : {}),
          });
        }
        if (err instanceof LockTimeoutError) {
          return reply.code(503).send({ error: 'lock_timeout', retry_after_seconds: 2 });
        }
        req.log.error({ err, userId }, 'account_delete_failed');
        return reply.code(500).send({ error: 'delete_failed' });
      }

      // Fires AFTER the cascade commits (per I-DELETE-COMPLETED) — never claim
      // deleted on a half-committed state.
      req.log.info(
        {
          event: 'account_deleted',
          userId,
          userEmail,
          previous_token_count: previousTokenCount,
          ip: req.ip,
        },
        'account_deleted',
      );

      reply.header(
        'Set-Cookie',
        'CF_Authorization=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax',
      );
      return reply.code(204).send();
    },
  );
```

Add to the imports at the top of `account.ts`:

```ts
import { deleteUser } from '../services/deleteUser.js';
import { LifecycleError } from '../services/userLifecycle.js';
import { LockTimeoutError } from '../services/membershipLock.js';
import { SUPPORT_CONTACT } from '../services/inviteMailer.js';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/routes/admin-users-delete.test.ts`
Expected: PASS, **14** tests. (The `previous_token_count` note above adds an assertion to the
existing Q37 case rather than a new case; the 14th is the post-disable finalization case below.)

> **P1 from review, and the reason it is the same shape as every other finding in this wave.**
> The first shipped version reported the Q37 "already disabled, contact X" message only when
> `err.code === 'cf_sync_failed'`. But Phase 1 commits `status='deleting'` **before** Phase 2 runs,
> so EVERY later failure leaves the user disabled — and Phase 3 rethrew its driver error raw, which
> the `/api/me` handler did not recognise and answered with a bare 500 `delete_failed`. That user is
> refused on both auth paths, cannot retry, and is told nothing about who can finish the deletion:
> the exact outcome Q37 exists to prevent, reachable through the cascade instead of through
> Cloudflare.
>
> The fix is not another error code in the condition. `disabled` is a property of **where the
> failure landed**, not of what failed, so the service states it and the route branches on it:
> Phase 2's `cf_sync_failed` and Phase 3's new `delete_finalize_failed` both carry
> `{ disabled: true, resumable: true }`, and `/api/me` keys the message on
> `err.details.disabled === true`. Pre-mutation refusals like `last_admin` correctly carry neither,
> because they roll back and the account still works. **This is why keying on the code was wrong in
> principle and not just incomplete: `patchUser`'s reinstate branch throws the very same
> `cf_sync_failed` and is NOT disabled by it** — the row stays suspended, exactly as it was. One
> code, two states; only the state is safe to branch on.
>
> Two test lessons came with it. The new case uses the existing `w9_block` mechanism on the
> `/api/me` path and asserts the message, the durable `deleting` status, and the rolled-back
> `user_deleted` event. And moving the condition from the code to the flag **silently un-covered the
> CF path** — the message had been guaranteed by the shape of the `if`, and afterwards depended on a
> flag nothing asserted. Confirmed by mutation: dropping `disabled` from `cf_sync_failed` broke
> nothing until the interrupted-self-delete case was extended to assert the body it had only ever
> status-checked. **A refactor that replaces a structural guarantee with a data-carried one moves
> the burden of proof onto the tests; check what the old shape was silently proving.**

Run: `cd /var/home/jason/Projects/RepOS/api && npm run test:integration -- tests/integration/account-deletion-cascade.test.ts tests/integration/contamination/account-deletion-contamination.test.ts`
(The integration suite needs `--config vitest.integration.config.ts`, which the `test:integration`
script supplies; a bare `npx vitest run` on those paths uses the unit config.)

**Both W6 suites DO break, and not for the reason predicted.** The earlier text said to update them
"only where they assert the *absence* of `account_events` rows" — neither file contains such an
assertion. The actual break is the CF step: `deleteUser` Phase 2 calls `syncEmail`, `fetchPolicy`
calls `policyUrl()`, and that throws `cf_not_configured` **before any I/O** when `CF_API_TOKEN` /
`CF_ACCOUNT_ID` / `CF_ACCESS_POLICY_ID` are unset — none of which is in `api/.env`. So both suites
return **502 instead of 204** on a fail-closed policy client that is behaving exactly as Q19/Q22
specify. Fix the tests, not the client:

- Both files gain `import * as policy from '.../cfAccessPolicy.js'` plus `vi` and, in `beforeAll`
  after `buildApp()`, the same `fetchPolicy` / `putPolicyEmails` spies the W9 route suites use,
  backed by a mutable `policyEmails` seeded with the suite's addresses.
- Seeding the address in means the stub is falsifiable rather than decorative, so each file also
  gains one assertion: the cascade suite asserts `policyEmails` no longer contains `TEST_EMAIL`
  (Q33 — the address is removed, not orphaned), and the contamination suite asserts A is gone from
  `include[]` while **B is still in it** — the G2 boundary applied to the CF policy.

**Generalisable:** a task that inserts an external call into an existing path breaks every test that
already covered that path, in the *transport* layer, regardless of what those tests assert about the
domain. Predicting the fallout from the assertions alone missed it entirely; running them found it
in one command.

- [ ] **Step 6: Commit**

```bash
cd /var/home/jason/Projects/RepOS && git add \
  api/src/services/deleteUser.ts api/src/services/userLifecycle.ts \
  api/src/routes/adminUsers.ts api/src/routes/account.ts \
  api/tests/routes/admin-users-delete.test.ts \
  api/tests/integration/account-deletion-cascade.test.ts \
  api/tests/integration/contamination/account-deletion-contamination.test.ts \
  docs/superpowers/plans/2026-07-26-w9-user-management.md
git commit -m "$(cat <<'EOF'
feat(w9): one deletion service for both paths (Q33, Q37)

DELETE /api/me no longer deletes the row directly — it delegates to the same
state machine the admin route uses: lock, status='deleting' with its
user_delete_requested event, CF removal, then user_deleted immediately before
the cascade in one transaction. The last-active-admin invariant now applies to
self-deletion, closing the zero-admin lockout that the old direct DELETE
allowed, and no deleted user's email is left orphaned in the CF policy.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: List with drift, and retry-sync

Drift is **surfaced, never auto-healed** (Q9) — auto-healing would silently revert a deliberate dashboard edit. And the banner distinguishes *unknown* (stamp missing) from *confirmed divergent* (a live comparison disagrees), because Q34 deliberately leaves a failed reinstate with a NULL stamp and an unchanged policy: that is pending, not drift (Q36).

**Files:**
- Modify: `api/src/services/userLifecycle.ts` (append `listUsers`, `retrySync`)
- Modify: `api/src/routes/adminUsers.ts` (append GET and retry-sync)
- Test: `api/tests/routes/admin-users-list.test.ts`

**Interfaces:**
- Produces:
  - `listUsers(): Promise<UserListResponse>` where
    `UserListResponse = { users: UserListRow[]; cohort: { count: number; cap: number }; drift: DriftReport }`,
    `UserListRow = { id, email, display_name, role, status, invited_at, activated_at, last_seen_at, cf_synced_at, invite_sent_at, invited_by_email }`,
    `DriftReport = { checked: boolean; policy_error: string | null; divergent: Array<{ email: string; reason: 'in_policy_unexpected' | 'missing_from_policy' | 'in_policy_no_row' }>; unknown: string[] }`
  - `retrySync(targetId: string, actor: Actor): Promise<{ id: string; cf_synced: boolean; sync_error: string | null; direction: 'present' | 'absent' }>`
  - Routes `GET /api/admin/users`, `POST /api/admin/users/:id/retry-sync`.

- [ ] **Step 1: Write the failing test**

Create `api/tests/routes/admin-users-list.test.ts` with the ephemeral-DB preamble (tag `'list'`):

```ts
describe('GET /api/admin/users', () => {
  it('returns rows, the cohort count and the cap', async () => {
    const r = await list();
    expect(r.statusCode).toBe(200);
    const body = r.json<{ users: Array<{ email: string }>; cohort: { count: number; cap: number } }>();
    expect(body.cohort.cap).toBe(10);
    // Named, not merely non-empty: `length > 0` would pass on any row at all.
    expect(body.users.map((u) => u.email)).toContain(ADMIN);
    const { rows } = await db.query<{ c: number }>(
      `SELECT count(*)::int c FROM users WHERE status IN ('active','invited','deleting')`,
    );
    expect(body.cohort.count).toBe(rows[0].c);
  });

  it('resolves invited_by to an email', async () => {
    const invited = freshEmail('by');
    await db.query(
      `INSERT INTO users (email, status, invited_by, invited_at) VALUES ($1,'invited',$2, now())`,
      [invited, adminId],
    );
    const body = (await list()).json<{ users: Array<{ email: string; invited_by_email: string | null }> }>();
    expect(body.users.find((u) => u.email === invited)!.invited_by_email).toBe(ADMIN);
  });

  it('Q36: a NULL stamp whose membership AGREES is UNKNOWN, not divergence', async () => {
    const email = freshEmail('unknown');
    // suspended + absent from the policy = what we want; only the stamp is
    // outstanding, so there is nothing for an operator to act on but a retry.
    await db.query(`INSERT INTO users (email, status, cf_synced_at) VALUES ($1,'suspended',NULL)`, [email]);
    const body = (await list()).json<{ drift: { unknown: string[]; divergent: Array<{ email: string }> } }>();
    expect(body.drift.unknown).toContain(email);
    expect(body.drift.divergent.map((d) => d.email)).not.toContain(email);
  });

  // The regression this pair guards: a NULL stamp used to suppress the live
  // comparison entirely, so a half-applied suspend — DB committed, CF removal
  // failed — reported "sync pending" while the user was still in the policy.
  it('a NULL stamp does NOT hide real divergence: suspended but still in policy', async () => {
    const email = freshEmail('nullsuspdiv');
    await db.query(`INSERT INTO users (email, status, cf_synced_at) VALUES ($1,'suspended',NULL)`, [email]);
    policyEmails.push(email);
    const body = (await list()).json<{ drift: { unknown: string[]; divergent: Array<{ email: string; reason: string }> } }>();
    expect(body.drift.divergent).toContainEqual({ email, reason: 'in_policy_unexpected' });
    expect(body.drift.unknown).not.toContain(email);
  });

  it('a NULL stamp does NOT hide real divergence: active but missing from policy', async () => {
    const email = freshEmail('nullactdiv');
    // Exactly the Q34 failed-reinstate resting state, which Q34 says should
    // "surface as drift" rather than read as merely pending.
    await db.query(`INSERT INTO users (email, status, cf_synced_at) VALUES ($1,'active',NULL)`, [email]);
    const body = (await list()).json<{ drift: { unknown: string[]; divergent: Array<{ email: string; reason: string }> } }>();
    expect(body.drift.divergent).toContainEqual({ email, reason: 'missing_from_policy' });
    expect(body.drift.unknown).not.toContain(email);
  });

  it('reports a suspended row still present in the policy as divergent', async () => {
    const email = freshEmail('div');
    await db.query(`INSERT INTO users (email, status, cf_synced_at) VALUES ($1,'suspended', now())`, [email]);
    policyEmails.push(email);
    const body = (await list()).json<{ drift: { divergent: Array<{ email: string; reason: string }> } }>();
    expect(body.drift.divergent).toContainEqual({ email, reason: 'in_policy_unexpected' });
  });

  it('reports an active row missing from the policy as divergent', async () => {
    const email = freshEmail('missing');
    await db.query(`INSERT INTO users (email, status, cf_synced_at) VALUES ($1,'active', now())`, [email]);
    const body = (await list()).json<{ drift: { divergent: Array<{ email: string; reason: string }> } }>();
    expect(body.drift.divergent).toContainEqual({ email, reason: 'missing_from_policy' });
  });

  it('reports a policy email with no users row', async () => {
    policyEmails.push('stranger@repos.test');
    const body = (await list()).json<{ drift: { divergent: Array<{ email: string; reason: string }> } }>();
    expect(body.drift.divergent).toContainEqual({
      email: 'stranger@repos.test', reason: 'in_policy_no_row',
    });
  });

  it('never auto-heals — the policy is untouched by a list call (Q9)', async () => {
    // Seed BOTH directions of divergence first, so the call has something it
    // could plausibly "fix". Against an already-correct policy this assertion
    // would hold for a service that auto-heals too.
    const stale = freshEmail('autoheal');
    await db.query(`INSERT INTO users (email, status, cf_synced_at) VALUES ($1,'suspended',NULL)`, [stale]);
    policyEmails.push(stale, 'ghost@repos.test');
    const before = [...policyEmails];
    const body = (await list()).json<{ drift: { divergent: unknown[] } }>();
    expect(body.drift.divergent.length).toBeGreaterThan(0);
    expect(policyEmails).toEqual(before);
    expect(putSpy).not.toHaveBeenCalled();
  });

  it('a policy refusal degrades to checked:false with the code, not a 500', async () => {
    fetchPolicyImpl = async () => { throw new policy.CfPolicyError('app_count_not_one', 'two'); };
    const r = await list();
    expect(r.statusCode).toBe(200);
    const body = r.json<{ drift: { checked: boolean; policy_error: string; unknown: string[]; divergent: unknown[] } }>();
    expect(body.drift.checked).toBe(false);
    expect(body.drift.policy_error).toBe('app_count_not_one');
    // Unreadable policy means membership is unknown for EVERY row, stamped or
    // not — and nothing may be claimed divergent without ground truth. ADMIN is
    // stamped and would otherwise be neither unknown nor divergent.
    expect(body.drift.unknown).toContain(ADMIN);
    expect(body.drift.divergent).toEqual([]);
  });
});

describe('POST /api/admin/users/:id/retry-sync (Q36)', () => {
  it('REMOVES the email for a suspended row — asserted against the recorded CF calls', async () => {
    const email = freshEmail('retrysusp');
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO users (email, status, cf_synced_at) VALUES ($1,'suspended',NULL) RETURNING id`, [email],
    );
    policyEmails.push(email);
    const r = await retrySync(rows[0].id);
    expect(r.statusCode).toBe(200);
    expect(r.json<{ direction: string }>().direction).toBe('absent');
    expect(policyEmails).not.toContain(email);
    // It must NEVER re-add. Check the actual PUT payload, not just the status.
    expect(putSpy).toHaveBeenCalled();
    for (const call of putSpy.mock.calls) {
      expect(call[0]).not.toContain(email);
    }
  });

  it('ADDS the email for an invited row whose provisioning failed', async () => {
    const email = freshEmail('retryinv');
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO users (email, status, cf_synced_at, invited_at) VALUES ($1,'invited',NULL, now()) RETURNING id`, [email],
    );
    const r = await retrySync(rows[0].id);
    expect(r.json<{ direction: string }>().direction).toBe('present');
    expect(policyEmails).toContain(email);
    const u = await db.query<{ cf_synced_at: Date | null }>(
      `SELECT cf_synced_at FROM users WHERE id=$1`, [rows[0].id],
    );
    expect(u.rows[0].cf_synced_at).not.toBeNull();
  });

  it('is idempotent — a second call with the policy already correct issues no PUT', async () => {
    const email = freshEmail('idem');
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO users (email, status, cf_synced_at, invited_at) VALUES ($1,'invited',NULL, now()) RETURNING id`, [email],
    );
    await retrySync(rows[0].id);
    putSpy.mockClear();
    const r = await retrySync(rows[0].id);
    expect(r.statusCode).toBe(200);
    expect(putSpy).not.toHaveBeenCalled();
  });

  it('a failure CLEARS an existing stamp — it must not survive as stale (Q24, Q17b)', async () => {
    const email = freshEmail('retryfail');
    // Seeded NON-NULL deliberately. Starting from NULL, this case passes
    // against a service that never clears the stamp at all: the column is
    // already NULL and "did not stamp on failure" is indistinguishable from
    // "cleared before trying". The stale-stamp bug lives entirely in the gap.
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO users (email, status, cf_synced_at, invited_at)
       VALUES ($1,'invited', now() - interval '1 day', now()) RETURNING id`, [email],
    );
    fetchPolicyImpl = async () => { throw new policy.CfPolicyError('cf_timeout', 'slow'); };
    const r = await retrySync(rows[0].id);
    expect(r.json<{ cf_synced: boolean; sync_error: string }>()).toMatchObject({
      cf_synced: false, sync_error: 'cf_timeout',
    });
    // cf_synced_at means "this row's intent IS reflected in the policy" (Q24).
    // After a failed reconciliation that claim is false, and leaving it set
    // also re-satisfies Q17b's activation precondition
    // (status='invited' AND cf_synced_at IS NOT NULL) for a row Cloudflare may
    // not have.
    const u = await db.query<{ cf_synced_at: Date | null }>(
      `SELECT cf_synced_at FROM users WHERE id=$1`, [rows[0].id],
    );
    expect(u.rows[0].cf_synced_at).toBeNull();
  });

  it('Q13: rejects self-targeting, and does no CF work at all', async () => {
    const r = await retrySync(adminId);
    expect(r.statusCode).toBe(409);
    expect(r.json<{ error: string }>().error).toBe('self_target_forbidden');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(putSpy).not.toHaveBeenCalled();
  });

  it('does NOT change users.status — retry-sync is not a reinstate', async () => {
    const email = freshEmail('notreinstate');
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO users (email, status, cf_synced_at) VALUES ($1,'suspended',NULL) RETURNING id`, [email],
    );
    // The 200 is load-bearing: without it this case passes against a service
    // that has no retry-sync at all, since a 404 also leaves the status alone.
    const r = await retrySync(rows[0].id);
    expect(r.statusCode).toBe(200);
    const u = await db.query<{ status: string }>(`SELECT status FROM users WHERE id=$1`, [rows[0].id]);
    expect(u.rows[0].status).toBe('suspended');
  });
});
```

Helpers:

```ts
async function list() {
  return app.inject({
    method: 'GET', url: '/api/admin/users',
    headers: { 'cf-access-jwt-assertion': await jwks.mintJwt(ADMIN) },
  });
}

async function retrySync(id: string) {
  return app.inject({
    method: 'POST', url: `/api/admin/users/${id}/retry-sync`,
    headers: { 'cf-access-jwt-assertion': await jwks.mintJwt(ADMIN), 'x-repos-csrf': '1' },
  });
}
```

The harness must expose `putSpy` (the `vi.spyOn(policy, 'putPolicyEmails')` handle) **and `fetchSpy`** (the `fetchPolicy` handle) as module-level `let`s so these tests can inspect `mock.calls`. `beforeEach` **re-creates** both after `vi.restoreAllMocks()`, so the calls are always scoped to the current case and the Q9 assertion means what it says. `fetchSpy` exists for the Q13 self-target case: proving "no CF work occurred" means proving the policy was never even **read**, since a guard that ran after `fetchPolicy` would still return 409 while having touched Cloudflare.

> **Three cases were strengthened after mutation-testing; the count is 15, not 13.**
>
> 1. `does NOT change users.status` passed against a service with **no retry-sync route at all** — a
>    404 also leaves the status alone. It now asserts the `200` first. A case whose subject is "X is
>    unchanged" must prove the operation ran.
> 2. `returns rows, the cohort count and the cap` asserted only `users.length > 0`, which holds for
>    any row whatsoever. It now asserts ADMIN is present **by name** and that `cohort.count` equals a
>    directly-computed count of the counted statuses.
> 3. `never auto-heals` compared `policyEmails` before and after against a policy the test never made
>    divergent. It now seeds **both** directions (a suspended row still in the policy, and a policy
>    address with no row) and asserts `divergent.length > 0` before asserting no PUT — so the call
>    demonstrably had something it could have "fixed".
>
> On (3), one thing checked rather than assumed: the original form **does** kill a real auto-healer,
> but only because migration 080 *inserts* the founding admin (Q35.3), whose address is active and
> absent from the stubbed policy — so a divergence always exists incidentally. Seeding it explicitly
> makes the guarantee the case's own rather than a side effect of another task's migration.
>
> Also worth recording: the first auto-heal mutation attempted — healing `rows[0]` — **survived**,
> and the test was not at fault. `ORDER BY u.status` puts an `active` row first, that row already
> agreed with the policy, and `syncEmail` issues no PUT when the policy already agrees. *A surviving
> mutation is a question about the mutation before it is a question about the test.*

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/routes/admin-users-list.test.ts`
Expected: FAIL — both routes 404.

- [ ] **Step 3: Append the service functions**

Add to `api/src/services/userLifecycle.ts`:

```ts
export interface UserListRow {
  id: string;
  email: string;
  display_name: string | null;
  role: UserRole;
  status: UserStatus;
  invited_at: string | null;
  activated_at: string | null;
  last_seen_at: string | null;
  cf_synced_at: string | null;
  invite_sent_at: string | null;
  invited_by_email: string | null;
}

export interface DriftReport {
  /** false when the live policy could not be read at all. */
  checked: boolean;
  policy_error: string | null;
  divergent: Array<{
    email: string;
    reason: 'in_policy_unexpected' | 'missing_from_policy' | 'in_policy_no_row';
  }>;
  /** Q36 — sync state UNKNOWN (stamp missing), which is NOT divergence. */
  unknown: string[];
}

export interface UserListResponse {
  users: UserListRow[];
  cohort: { count: number; cap: number };
  drift: DriftReport;
}

/**
 * Q9 — drift is SURFACED, never auto-healed. Auto-healing would silently
 * revert a deliberate dashboard edit; showing it lets a human decide.
 */
export async function listUsers(): Promise<UserListResponse> {
  const { rows } = await db.query<UserListRow>(
    `SELECT u.id::text, u.email, u.display_name, u.role, u.status,
            to_char(u.invited_at   AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS invited_at,
            to_char(u.activated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS activated_at,
            to_char(u.last_seen_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_seen_at,
            to_char(u.cf_synced_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS cf_synced_at,
            to_char(u.invite_sent_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS invite_sent_at,
            inv.email AS invited_by_email
       FROM users u
       LEFT JOIN users inv ON inv.id = u.invited_by
      ORDER BY u.status, u.email`,
  );

  const cohort = { count: await countCohort(), cap: COHORT_CAP };

  const drift: DriftReport = { checked: false, policy_error: null, divergent: [], unknown: [] };

  let snapshot;
  try {
    snapshot = await fetchPolicy();
    drift.checked = true;
  } catch (err) {
    // The policy could not be read, so membership is genuinely unknown for
    // EVERY row — not just the unstamped ones.
    drift.policy_error = syncErrorCode(err);
    for (const r of rows) drift.unknown.push(r.email);
    return { users: rows, cohort, drift };
  }

  // Once the policy HAS been read we hold ground truth, and live membership
  // decides. `cf_synced_at` records our confidence in our own last write; it
  // says nothing about what Cloudflare currently contains. Skipping unstamped
  // rows here hid real divergence behind "sync pending" — e.g. a suspend whose
  // DB half committed and whose CF removal failed leaves a `suspended` row with
  // a NULL stamp still sitting in the policy. Q34 asks for precisely the
  // opposite: it clears the stamp first so the row "surfaces as drift (policy
  // contains an email for a non-active user)".
  //
  // So: disagreement is ALWAYS divergent. A missing stamp downgrades to
  // `unknown` only when membership already agrees — there the stamp is the
  // only thing outstanding and there is nothing for an operator to fix beyond
  // a retry.
  //
  // Deliberate consequence: an `invited` row whose CF add failed (the Q8
  // sync-pending case) now reaches the drift banner instead of only the
  // per-row SYNC PENDING chip. That is correct and not a Q8 violation — Q8
  // governs whether the invite ROLLS BACK, not whether the resulting gap is
  // shown, and Q9 says drift is surfaced. The invitee genuinely cannot sign
  // in until Cloudflare has them, so it is actionable, not noise. The chip
  // itself is unaffected: it renders off `cf_synced_at`, not off this report.
  const inPolicy = new Set(snapshot.emails);
  const seen = new Set<string>();
  for (const r of rows) {
    const email = r.email.toLowerCase();
    seen.add(email);
    const expected = desiredPresence(r.status);
    const present = inPolicy.has(email);
    if (expected === 'present' && !present) {
      drift.divergent.push({ email: r.email, reason: 'missing_from_policy' });
    } else if (expected === 'absent' && present) {
      drift.divergent.push({ email: r.email, reason: 'in_policy_unexpected' });
    } else if (r.cf_synced_at === null) {
      drift.unknown.push(r.email);
    }
  }
  for (const email of snapshot.emails) {
    if (!seen.has(email)) drift.divergent.push({ email, reason: 'in_policy_no_row' });
  }

  return { users: rows, cohort, drift };
}

/**
 * Q36 — reconcile Cloudflare TO the row's current status. This is NOT a
 * reinstate: it never changes users.status, and for a suspended or deleting
 * row it REMOVES the email rather than adding it. A retry-sync that always
 * added would silently restore CF access to a suspended user — the operation
 * meant to repair drift would create a security regression.
 *
 * `actor` is accepted but unused, and deliberately so: retry-sync is NOT a
 * lifecycle transition, and Q23 enumerates the lifecycle kinds. Auditing
 * reconciliation is not a missing line here — it needs its own Q settling
 * whether attempts, successes and failures are each recorded, and how such an
 * event relates atomically to the stamp this function writes outside any
 * transaction. Until that exists, emitting something would be inventing
 * semantics. The parameter stays so the route matches every other targeted
 * admin operation.
 */
export async function retrySync(
  targetId: string,
  actor: Actor,
): Promise<{ id: string; cf_synced: boolean; sync_error: string | null; direction: 'present' | 'absent' }> {
  void actor;
  return withMembershipLock(async () => {
    const cur = await readUser(targetId);
    const direction = desiredPresence(cur.status);
    // Q24 — clear BEFORE the call, re-stamp only after success. Stamping only
    // on success is not the same rule: a retry that fails leaves whatever
    // timestamp was already there, so the row keeps asserting "intent IS
    // reflected in the policy" immediately after we failed to establish that.
    // It also re-satisfies Q17b's activation precondition
    // (status='invited' AND cf_synced_at IS NOT NULL) for a row Cloudflare may
    // not actually hold. The stamp is a claim about the last CONFIRMED sync,
    // and an attempted-and-failed reconciliation retires the old confirmation
    // — the honest resting state is "unknown", which is exactly what the drift
    // report is built to show. Same order patchUser's reinstate already uses.
    await db.query(`UPDATE users SET cf_synced_at = NULL WHERE id=$1`, [targetId]);
    try {
      await syncEmailToStatus(cur.email, cur.status);
      await db.query(`UPDATE users SET cf_synced_at = now() WHERE id=$1`, [targetId]);
      return { id: targetId, cf_synced: true, sync_error: null, direction };
    } catch (err) {
      return { id: targetId, cf_synced: false, sync_error: syncErrorCode(err), direction };
    }
  });
}
```

Extend the module's imports with `fetchPolicy` from `./cfAccessPolicy.js` and `desiredPresence` from `./cfAccessSync.js`.

> **`retrySync` accepts `actor` and does not use it. Settled at review: do NOT add an event in this
> task.** Retry-sync is not a lifecycle transition, and Q23 enumerates the *lifecycle* kinds, so
> there is deliberately no value for a reconciliation. Auditing it is not a missing line — it
> requires a new Q defining whether attempts, successes and failures are each recorded, and how such
> an event relates **atomically** to the `cf_synced_at` stamp, which this function writes on the pool
> outside any transaction. Emitting something before those semantics exist would be inventing them.
> The retained parameter is harmless and keeps the route uniform with every other targeted admin
> operation. (The earlier claim here that adding it later would be "a one-line change" was wrong,
> for the atomicity reason above.)

- [ ] **Step 4: Append the routes**

```ts
  app.get(
    '/admin/users',
    // No csrfOrigin: this is a GET and mutates nothing. Q9's guarantee that a
    // list never heals drift is what makes that safe to say.
    { preHandler: requireCfAccessAdmin() },
    async (req, reply) => {
      try {
        return reply.code(200).send(await listUsers());
      } catch (err) {
        return sendLifecycleError(reply, err);
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/admin/users/:id/retry-sync',
    { preHandler: [requireCfAccessAdmin(), csrfOrigin] },
    async (req, reply) => {
      const actor = actorOf(req);
      // Q13 — the admin list rejects self-targeting outright, on EVERY targeted
      // operation and not only the ones that mutate status. Reconciling your
      // own row is a Cloudflare write performed on yourself from the user list,
      // which is the surface Q13 closes; manage yourself in /settings/account.
      // Refused before the service runs, so no policy read or write occurs.
      if (req.params.id === actor.userId) {
        return reply.code(409).send({ error: 'self_target_forbidden' });
      }
      try {
        return reply.code(200).send(await retrySync(req.params.id, actor));
      } catch (err) {
        return sendLifecycleError(reply, err);
      }
    },
  );
```

- [ ] **Step 5: Run tests and the whole API suite**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/routes/admin-users-list.test.ts && npm test && npm run test:integration`
Expected: PASS, **16** new tests plus a green suite. (Ten list cases plus six retry-sync cases; the
stated 13 was a miscount of the block above, and the 16th is the Q13 self-target case added at
review.)

> **Two P1s from review, both in `retrySync`, and both invisible to the planned tests.**
>
> **1. A failed retry preserved a stale stamp (Q24, Q17b).** The planned service stamped
> `cf_synced_at` on success and simply did not stamp on failure — which is NOT the same rule as
> clearing it first. A retry that failed left whatever timestamp was already there, so the row went
> on asserting "intent IS reflected in the policy" immediately after we failed to establish that,
> and an `invited` row kept satisfying Q17b's activation precondition
> (`status='invited' AND cf_synced_at IS NOT NULL`) for an identity Cloudflare may not hold. Fixed by
> clearing to NULL **before** the CF call and re-stamping only after success — the order
> `patchUser`'s reinstate branch already uses.
>
> **The planned test could not see it: it seeded `cf_synced_at NULL`.** Starting from NULL, "never
> cleared" and "cleared before trying" are indistinguishable, because the column is already NULL
> either way. The case now seeds a non-null stamp, which strictly dominates — it still catches a
> wrongly-written stamp AND catches the stale one. **Generalisable: a test asserting a field ends at
> its DEFAULT value proves nothing about the code path that is supposed to reset it. Start from the
> other value.**
>
> **2. retry-sync permitted self-targeting (Q13).** Every other targeted admin-list operation
> compares `req.params.id` to `actor.userId` and returns `409 self_target_forbidden`; this route
> went straight to the service, and an admin retrying their own id got a 200 and a live Cloudflare
> write. Q13 says the admin list rejects self-targeting **outright** — it is not scoped to
> operations that mutate status. Fixed at the route, before the service runs.
>
> The case asserts `fetchSpy` and `putSpy` were **not called**, not merely that the status is 409.
> Mutation-checked: moving the guard to after the service call still returns 409 and still fails the
> case, which is the point — Q13 is about not performing the operation, not about the response code.

- [ ] **Step 6: Commit**

```bash
cd /var/home/jason/Projects/RepOS && git add api/src/services/userLifecycle.ts api/src/routes/adminUsers.ts api/tests/routes/admin-users-list.test.ts docs/superpowers/plans/2026-07-26-w9-user-management.md
git commit -m "$(cat <<'EOF'
feat(w9): user list with drift reporting, and status-aware retry-sync

Drift is surfaced and never auto-corrected (Q9), and the report distinguishes
sync-unknown (missing stamp) from confirmed divergence (a live comparison
disagrees) — a failed reinstate leaves the former, not the latter (Q36).
retry-sync reconciles toward the row's status, so invoking it on a suspended
row removes the email and can never re-grant access.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: Configuration, boot guards, and runbooks

Five new env vars, all **set-once infrastructure identity** — none of them change when users change, so none reintroduce the redeploy coupling this wave removes.

**Files:**
- Modify: `api/src/bootstrap-guards.ts:38-42`
- Modify: `api/tests/unit/startup-guards.test.ts`
- Modify: `docs/runbooks/secret-rotation.md`
- Create: `docs/runbooks/admin-break-glass.md`

**Interfaces:**
- Consumes: nothing.
- Produces: boot INFO lines `cf_api_token_unset` / `resend_api_key_unset`; the `allowListCount` INFO line is gone.

- [ ] **Step 1: Write the failing test**

First **delete** the three now-obsolete cases in `api/tests/unit/startup-guards.test.ts`
— `emits an info log entry for allow-list count`, `emits 0 allow-list count when
CF_ACCESS_ALLOWED_EMAILS unset`, and `emits 0 allow-list count when
CF_ACCESS_ALLOWED_EMAILS is whitespace-only`. All three assert
`toContainEqual({ allowListCount: N })`, which Step 3 stops emitting; leaving them
makes Step 6 fail. Also drop the now-dead `CF_ACCESS_ALLOWED_EMAILS: 'a@b.c'` key
from the `envBase` fixture — no code reads it after this task.

Then add to `api/tests/unit/startup-guards.test.ts`:

```ts
describe('W9 credential advisories', () => {
  const base = { DATABASE_URL: 'postgres://x/y' } as NodeJS.ProcessEnv;

  it('no longer reports allowListCount — CF_ACCESS_ALLOWED_EMAILS is gone', () => {
    const r = validateStartupEnv({ ...base, CF_ACCESS_ALLOWED_EMAILS: 'a@b.c,d@e.f' });
    expect(r.info.some((i) => 'allowListCount' in i)).toBe(false);
  });

  it('INFO (not fatal) when CF_API_TOKEN is unset', () => {
    const r = validateStartupEnv({ ...base });
    expect(r.fatal).toEqual([]);
    expect(JSON.stringify(r.info)).toContain('CF_API_TOKEN unset');
  });

  it('INFO (not fatal) when RESEND_API_KEY is unset', () => {
    const r = validateStartupEnv({ ...base });
    expect(r.fatal).toEqual([]);
    expect(JSON.stringify(r.info)).toContain('RESEND_API_KEY unset');
  });

  it('silent when both are configured', () => {
    const r = validateStartupEnv({ ...base, CF_API_TOKEN: 't', RESEND_API_KEY: 'k' });
    expect(JSON.stringify(r.info)).not.toContain('CF_API_TOKEN unset');
    expect(JSON.stringify(r.info)).not.toContain('RESEND_API_KEY unset');
  });

  it('missing credentials never block boot — the API must start and serve reads', () => {
    const r = validateStartupEnv({ ...base, NODE_ENV: 'production', ADMIN_API_KEY: 'k' });
    expect(r.fatal).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/unit/startup-guards.test.ts`
Expected: FAIL — precisely **3 of the 5 new cases**, 12 passed: `allowListCount` is
still emitted and neither advisory exists. The other two pass *before* the fix and
are regression guards, not red-to-green cases — `silent when both are configured`
holds trivially while the strings are absent, and `missing credentials never block
boot` asserts `fatal` stays at its empty default. Both were mutation-checked
(making the advisory `fatal.push` kills the boot guard plus `passes a fully-valid
prod env`; dropping the `if` kills only the silence case), so neither is vacuous.

- [ ] **Step 3: Update the guards**

In `api/src/bootstrap-guards.ts`, delete the `allowList` block (lines 38–42 — locate
it by content, not line number) and add:

```ts
  // W9 — user management credentials. Advisory, not fatal, matching the
  // Healthchecks and feedback-webhook precedent: missing credentials fail at
  // USE time with a specific error rather than preventing boot. An API that
  // refuses to start because it cannot send invites is strictly worse than one
  // that starts and reports the invite failure.
  if (!env.CF_API_TOKEN) {
    info.push({ msg: 'CF_API_TOKEN unset — Cloudflare Access policy sync disabled' });
  }
  if (!env.RESEND_API_KEY) {
    info.push({ msg: 'RESEND_API_KEY unset — invite email delivery disabled' });
  }
```

Update the file header comment: replace `plus one info log (CF_ACCESS_ALLOWED_EMAILS count at boot)` with `plus advisory info logs for optional integrations (W9 removed the CF_ACCESS_ALLOWED_EMAILS count — the allow-list is now users.status)`.

- [ ] **Step 4: Document the new secrets**

Insert into `docs/runbooks/secret-rotation.md` **immediately before its trailing
`## After any rotation` section** — not appended at the end, which would leave two
per-secret procedures stranded below the file's general wrap-up:

```markdown
## CF_API_TOKEN (W9 — Access policy sync)

**Scope (Q15, amended 2026-08-02):** account-scoped `Access: Apps and Policies
Edit` — that is the label in the token dashboard; the endpoint docs sometimes
call the same permission *Write*. There is no narrower option: the permission
group is account-scoped only, with no per-policy variant. "Cloudflare Access
Policy Admin" is a **member role** granted to account members — it is not
offered when minting an API token, so do not go looking for it under My Profile
→ API Tokens. (The policy this token drives is
`b4a92a15-27d5-477b-ad36-f78fcdae931c`.)

**Never grant `Access: Organizations Revoke`.** RepOS makes no
session-revocation call (Q17a) — that endpoint revokes access across *all*
applications in the org, so using it here would also sign users out of
`ha.jpmtech.com` and `jellyseerr.jpmtech.com`.

**Set a 180-day expiry (`notAfter`) on the token when you create it.** That is
the one restriction that actually bounds this token, and it makes the rotation
cadence below self-enforcing instead of procedural.

**The blast radius is accepted, and it is account-wide.** The permission also
grants edit over `ha.jpmtech.com` and `jellyseerr.jpmtech.com`, so anyone
holding a stolen `CF_API_TOKEN` has a path into home automation. **Do not think
RepOS's fail-closed policy guards contain this.** Those guards (Q10/Q19/Q22/Q38)
constrain *this application's* client — the compare-before-write, the abort
deadline, the refusal to act on an unverifiable read. A stolen token is
presented straight to Cloudflare's API with RepOS nowhere in the path, so it
carries the token's full account scope and every one of those guards is
irrelevant to it. Cloudflare offers no narrower Access permission, so the real
controls are expiry, the cadence below, and immediate rotation on any suspected
container compromise. IP restriction would narrow it further but is not used:
the Unraid host's address is residential and dynamic.

**Rotation cadence:** every 180 days, or immediately on any suspected
container compromise.

**Procedure:**
1. Create the replacement token in the Cloudflare dashboard (My Profile → API
   Tokens) with the scope above, and set its **expiry 180 days out**.
2. Update `CF_API_TOKEN` in `/mnt/user/appdata/repos/.env` on Unraid.
3. Recreate the container (env vars are fixed at create time — stop + rm + run,
   not restart; see the redeploy recipe).
4. Verify: `/settings/users` loads and shows **no policy-error advisory** —
   i.e. the response carries `drift.checked === true` and
   `drift.policy_error === null`. There is deliberately no "in sync" banner to
   look for: the UI renders a banner only for confirmed divergence, and a
   separate advisory when `drift.checked === false` (Q36 — sync-pending is not
   divergence, and a banner for the healthy case would train the operator to
   ignore the signal).
5. Delete the old token in the dashboard.

**Blast radius if leaked:** see the paragraph above — it is account-wide edit
over every Cloudflare Access application, not just RepOS's policy. The DB gate
is worth one clarification and no more: it means an attacker who adds their own
address to the *RepOS* policy still gets `403 not_invited`, because Cloudflare
is not RepOS's security boundary (Q17). It does nothing for
`ha.jpmtech.com` or `jellyseerr.jpmtech.com`, which have no such gate — so it
narrows the consequences for this one application and leaves the account-wide
exposure untouched. Treat a leak as a compromise of all three.

## RESEND_API_KEY / INVITE_FROM_EMAIL (W9 — invite delivery)

**Scope:** a Resend sending key restricted to the `send.jpmtech.com` domain.
The subdomain keeps root-domain SPF/DKIM untouched, so a misconfiguration here
cannot break Proton-hosted mail on `jpmtech.com`.

**Rotation cadence:** every 180 days.

**Procedure:** create a new key in the Resend dashboard, update the `.env`,
recreate the container, send a test invite to a disposable address, confirm
delivery, then **delete that test user from `/settings/users`** before revoking
the old key.

Do not skip the cleanup. A verification invite is not free: it leaves a durable
`users` row, a real address added to the Cloudflare Access policy, and a
consumed slot against `COHORT_CAP`. Deleting through `/settings/users` runs the
Q33 deletion path, which removes the Cloudflare grant as well as the row —
deleting the row directly in SQL would leave the address in the policy.

**Blast radius if leaked:** an attacker can send mail as
`repos@send.jpmtech.com`. It grants no access to RepOS — there is no invite
token and no magic link (Q6); authorization is the pre-created `users` row.
```

- [ ] **Step 5: Write the break-glass runbook**

Create `docs/runbooks/admin-break-glass.md`. Three claims in it were verified against
the code rather than assumed, and should stay that way on any rewrite: the `'"'"'`
one-liner does parse (it delivers exactly three argv entries — connection string,
`-c`, and the whole statement as one argument; the `\` inside the single-quoted
string is consumed by the *inner* shell); the bare `INSERT INTO users (email, role,
status)` is valid because every other column has a default (`001_users.sql`) and
migration 080 line 71 already uses that exact form; and an `active` row with NULL
`cf_synced_at` really can sign in, because `cfAccess.ts:137` gates the
`cf_synced_at IS NOT NULL` precondition on `status === 'invited'` and line 205
rejects only non-`active`. If that gate is ever restructured, this runbook stops
working — it is the recovery path, so re-verify it.

Two further corrections from the review of `fc1c2c5`, both of which made the
first version of this runbook unusable in the case it exists for. **The UPDATEs
must set `cf_synced_at=NULL`** — Q24 requires clearing on any status change that
alters CF membership, and a promotion from `suspended`/`deleting` to `active`
does; reproduced a 3-day-old stamp surviving the promotion verbatim. And
**retry-sync cannot be recommended to the recovered admin**: `adminUsers.ts`
refuses self-targeting with `409 self_target_forbidden` before any policy access
(Q13, the Task 14 fix), so during a total lockout Cloudflare membership must be
added in the dashboard. **When a runbook tells the operator to use a route,
check that route's guards against the runbook's own scenario** — here the
scenario is "you are the only admin", which is exactly the case the guard
refuses.

```markdown
# Break-glass: recovering admin access

W9 removed `REPOS_ADMIN_EMAILS`, so there is no env var that can grant admin.
There is deliberately no `BOOTSTRAP_ADMIN_EMAIL` either — a bootstrap env var
would reintroduce exactly the redeploy-coupled config W9 removed (Q11).

Deny-by-default (Q2) makes admin lockout unrecoverable except by this
procedure, which is why the invariant "at least one `active` admin must always
remain" (Q13, I2) is enforced on every route and by migration 080's data step
(Q35).

## When you need this

- Every admin was suspended or deleted despite the invariant (a bug).
- A restore landed a dump whose admin identity no longer matches reality.
- You need to promote a second admin and cannot sign in to do it.

You do **not** need this after a routine restore: migration 080 guarantees an
active admin on every schema-entry path with no Cloudflare dependency.

## Procedure

SSH to Unraid, then:

Note the `sh -c` wrapper and the **single** outer quotes. `DATABASE_URL` must be
expanded by the shell *inside* the container; writing `docker exec repos psql
"$DATABASE_URL"` makes the Unraid host expand it first, and since the host has
no such variable psql receives an empty connection string and silently falls
back to libpq defaults instead of the container's configured database.

```bash
docker exec -it repos sh -c 'psql "$DATABASE_URL" -c \
  "UPDATE users SET role='"'"'admin'"'"', status='"'"'active'"'"', cf_synced_at=NULL WHERE lower(email)='"'"'<email>'"'"';"'
```

If quoting that densely is uncomfortable, the equivalent heredoc form is easier
to get right and is what the runbook prefers:

```bash
docker exec -i repos sh -c 'psql "$DATABASE_URL"' <<'SQL'
UPDATE users SET role='admin', status='active', cf_synced_at=NULL WHERE lower(email)='<email>';
SQL
```

`cf_synced_at=NULL` is not optional. Q24 defines the stamp as "this row's intent
is reflected in the CF policy", and it must be cleared by **any** status change
that alters CF membership. Promoting a `suspended` or `deleting` row to `active`
does exactly that: the row should now be *present* in the policy, and nothing
here has put it there. Without the clear, a stamp from before the suspension
survives the promotion and `/settings/users` reports the row as synced when its
membership is in fact unverified — the same stale-stamp defect fixed in
`retrySync` (Q17b/Q24).

If the identity has no row at all (deny-by-default means it cannot sign in to
create one):

```bash
docker exec -i repos sh -c 'psql "$DATABASE_URL"' <<'SQL'
INSERT INTO users (email, role, status) VALUES ('<email>','admin','active');
SQL
```

Either way the row ends with `cf_synced_at` NULL — cleared by the UPDATE, or
never set on the INSERT. That is the honest state: its Cloudflare membership is
unknown until something establishes it. The row is `active`, not `invited`, so
the `cf_synced_at IS NOT NULL` activation precondition (Q17b) does not apply —
it gates activation of `invited` rows only, so a NULL stamp does not stop the
recovered admin signing in.

**Do not expect to fix the sync state with Retry sync during a total lockout.**
`POST /api/admin/users/:id/retry-sync` refuses self-targeting outright (Q13) and
returns `409 self_target_forbidden` *before* any policy read or write — so the
sole recovered admin cannot reconcile their own row. Retry sync is only
available when a *second* operational admin targets the recovered row. In a
total lockout, add the address to the Cloudflare Access policy in the dashboard
(next section); the reconciliation script can stamp agreement afterwards, once
dashboard membership exists.

## Then

1. Confirm the email is in the Cloudflare Access policy — the DB gate will
   admit them, but Cloudflare must issue a JWT first. **Add it in the
   dashboard**: during a total lockout this is the only route, since retry-sync
   cannot target your own row (Q13). If another admin is still operational,
   they can use **Retry sync** against the recovered row instead.
2. Sign in and verify `/settings/users` loads.
3. Record what happened in `docs/runbooks/beta-triage.md`; if the invariant was
   violated by code rather than by a manual DB edit, that is a bug worth a test.
```

- [ ] **Step 6: Run tests and commit**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/unit/startup-guards.test.ts && npm test`
Expected: PASS.

```bash
git add api/src/bootstrap-guards.ts api/tests/unit/startup-guards.test.ts docs/runbooks/secret-rotation.md docs/runbooks/admin-break-glass.md
git commit -m "$(cat <<'EOF'
feat(w9): boot advisories for the new credentials + rotation and break-glass runbooks

Drops the allowListCount INFO line and adds advisory (never fatal) lines for
CF_API_TOKEN and RESEND_API_KEY — missing credentials fail at use time with a
specific error rather than preventing boot. Documents the deliberately narrow
CF token scope and the fact that RepOS must never hold Organizations Revoke.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---
### Task 15b: Q24 as a database invariant (migration 082)

**Added 2026-08-02, from the review of `88ed01f`.** The stale-stamp defect appeared **three times** in this wave — `retrySync` preserving a stamp after a failed reconcile (Task 14), and both break-glass UPDATEs promoting without clearing (Task 15). A finding that recurs that often means the rule is not encoded anywhere a writer is forced to pass; per the fix-the-layer rule, Q24 moves into the schema.

**Why not a static grep over `SET status=`.** That was the first proposal and it is both unsatisfiable and imprecise: `invited -> active` must **preserve** the stamp (both statuses require policy presence), migration 080 promotes while the column it just added is still NULL, fixtures set status without modelling Cloudflare, and multiline/reordered/dynamically-built SQL evades text matching. The invariant is about **membership groups**, so the database enforces those.

```
presence group: active, invited      -- address SHOULD be in the CF policy
absence  group: suspended, deleting  -- address should NOT be
```

Crossing between groups changes membership intent and must clear `cf_synced_at` in the same statement; moving within a group must **not** be disturbed.

**Files:**
- Create: `api/src/db/migrations/082_cf_sync_stamp_guard.sql`
- Create: `api/tests/db/migration-082.test.ts`
- Modify: `api/src/services/userLifecycle.ts` (reinstate split into two statements)
- Create: `api/tests/helpers/migration-unwind.ts` (the single shared unwind)
- Modify: `api/tests/db/migration-080.test.ts` (drop its private unwind, import the shared one)

**Interfaces:**
- Consumes: `createEphemeralDb`/`runMigrations` (T1), migration 080's columns (T2).
- Produces: trigger `users_cf_stamp_guard` and function of the same name; SQLSTATE `23514` on violation.

- [ ] **Step 1: Write the failing test** — `api/tests/db/migration-082.test.ts`, 14 cases: seven cross-group REJECT cases (both directions, seeded with a **non-NULL** stamp — seeding NULL would make "never cleared" and "cleared first" indistinguishable), the crossing-that-clears ALLOW, the break-glass command verbatim, and four controls the guard must **not** catch: `invited -> active` preserving its stamp, `suspended -> deleting`, a role-only change, and the two-statement re-stamp shape. Plus one asserting SQLSTATE `23514` rather than a bare raise.

Expected red: **8 of 14** — the seven rejections and the SQLSTATE case. The six ALLOW cases pass before the trigger exists; they are there to catch an **over-broad** trigger, which is the real risk.

- [ ] **Step 2: Create migration 082**

`BEFORE UPDATE OF status ... FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)`, raising with `ERRCODE = 'check_violation'` when the group membership flips and `NEW.cf_synced_at IS NOT NULL`. The `WHEN` clause matters: `UPDATE OF status` fires whenever `status` appears in the SET list, so without it a no-op rewrite of the same status would trip the guard.

- [ ] **Step 3: Split reinstate into two statements**

`patchUser`'s reinstate branch does `SET status='active', role=$2, cf_synced_at=now()` in one statement — a `suspended -> active` crossing carrying a stamp, which the trigger now refuses. Split it inside the **existing** transaction: cross with `cf_synced_at=NULL`, then stamp. The commit stays atomic, so Q7's "the grant takes effect last" is unchanged and no reader observes the intermediate NULL. Suspend (Task 12) and delete (Task 13) already clear in-statement and need no change.

- [ ] **Step 4: Fix the 080 unwind harness**

`migration-080.test.ts` unwinds to a pre-080 schema by dropping 080's columns; the trigger depends on `users.status`, so the DROP now fails with `cannot drop column status ... other objects depend on it`.

Do **not** fix this by patching that file's private copy — Task 17 needs the same unwind, and a per-file copy is exactly how 081 and then 082 got left applied. Extract `api/tests/helpers/migration-unwind.ts` exporting `unwindToPreW9` plus the `W9_MIGRATIONS` and `W9_USER_COLUMNS` lists, covering **all three** migrations, **all nine** columns, the trigger and function (dropped *before* the columns they depend on), and `users_status_idx`. Import it in `migration-080.test.ts` now and in Task 17's DR harness later.

Add the assertion that makes the helper self-policing — and **derive its expected set independently of the helper**. The obvious version is circular and silently useless: `unwindToPreW9` deletes the `_migrations` rows named by `W9_MIGRATIONS`, so a test that then requires exactly those names back shrinks its own requirement whenever the constant loses an entry. Verified — removing `081_invite_request.sql` from the constant left that version **15/15 green**, and an unlisted future `083` would have been equally invisible. **A list the subject also reads cannot audit the subject.**

Instead: capture the first fresh-database `runMigrations()` result, filter it to `/^08\d_/`, and assert that discovered set **equals** `W9_MIGRATIONS` — that pins the constant against what the runner actually applies. Then unwind, confirm every W9 column is gone, re-run, and require every *discovered* filename back in the applied list, plus a schema round-trip (`users` columns after == before, which depends on neither constant) and a live-trigger check proving re-application rather than mere recording.

Two mutations, both of which must fail: delete one filename from `W9_MIGRATIONS`, and drop a stray `083_*.sql` into `src/db/migrations/` without listing it. The second is the case this assertion exists for.

- [ ] **Step 5: Mutation-test, then full verification**

Three mutations, each of which must kill only its own cases: drop `invited` from the presence group (kills the `invited -> active` control plus the three `invited` rejections); guard only the presence→absence direction (kills the three absence→presence rejections); and revert the reinstate split (kills `clears the stamp, adds to CF, then flips to active with a fresh stamp` in `admin-users-patch.test.ts` — this is the one that proves the invariant reaches **production** code and not just synthetic rows).

Run `npm run migrate` against the local dev DB before the integration suite: `restore-migration-failure.test.ts` compares the dump's schema rev against the code's max migration number, so a dev DB still at 81 fails on an unmigrated database rather than a defect.

```bash
git add api/src/db/migrations/082_cf_sync_stamp_guard.sql api/tests/db/migration-082.test.ts \
        api/src/services/userLifecycle.ts api/tests/db/migration-080.test.ts
git commit -m "$(cat <<'EOF'
feat(w9): enforce Q24 in the schema — cf_synced_at must clear when CF membership changes

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 16: CF reconciliation — cutover and restore

The `ALTER TABLE` alone leaves every existing row `cf_synced_at NULL`, which the drift banner would read as "nothing is synced" on day one — a false alarm that trains the operator to ignore the signal. And `thesugardog@gmail.com` is in the CF policy today with **no `users` row**, granted access on 2026-07-26 without yet signing in, so deny-by-default would lock out a deliberately-invited user at cutover (Q31).

This step consults live Cloudflare state, which is why it is a script rather than a migration — but the **same module** runs from `run-restore.sh`, or a restore silently re-creates that lockout.

**Files:**
- Create: `api/src/services/cfReconcile.ts`
- Create: `api/src/services/cfReconcile-cli.ts`
- Create: `scripts/cutover/002-w9-cf-baseline.sh`
- Modify: `scripts/run-restore.sh` (after step 5)
- Test: `api/tests/services/cf-reconcile.test.ts`

**Interfaces:**
- Consumes: `fetchPolicy` (T5), `desiredPresence` (T6), `systemActor`/`recordAccountEventTx` (T3), `COHORT_CAP` (T2), `withMembershipLock` (T4).
- Produces:
  - `reconcileCfBaseline(source: 'cutover' | 'restore'): Promise<ReconcileResult>`
  - `ReconcileResult = { stamped: string[]; cleared: string[]; imported: string[]; divergent: string[] }`
  - `class ReconcileAbort extends Error { code: 'app_count_not_one' | 'non_email_selector' | 'cohort_cap_reached' | 'cf_unavailable' }`

- [ ] **Step 1: Write the failing test**

Create `api/tests/services/cf-reconcile.test.ts` with the ephemeral-DB preamble (tag `'reconcile'`), spying on `fetchPolicy` only. The preamble additionally needs `withMembershipLock` and `MEMBERSHIP_LOCK_KEY` for the lock assertions at the end — as a **dynamic** `await import('../../src/services/membershipLock.js')` alongside the others, **not** a static top-level import: `membershipLock.ts` pulls in `src/db/client.js`, so a static import binds the pool to the dev `DATABASE_URL` before the preamble repoints it at the ephemeral DB, and the lock assertions then query a different database than the one the run locks.

```ts
describe('baseline stamping is STATUS-AWARE (Q31a)', () => {
  it('stamps an active row present in the policy', async () => {
    const email = freshEmail('act');
    const id = await seed(email, 'active', null);
    policyEmails = [email];
    await reconcileCfBaseline('cutover');
    expect(await stampOf(id)).not.toBeNull();
  });

  it('stamps a SUSPENDED row that is ABSENT from the policy — absence is what it expects', async () => {
    const email = freshEmail('susabs');
    const id = await seed(email, 'suspended', null);
    policyEmails = [];
    await reconcileCfBaseline('cutover');
    expect(await stampOf(id)).not.toBeNull();
  });

  it('leaves a SUSPENDED row still present in the policy UNSTAMPED and reports it divergent', async () => {
    // Round-6 review: round-5 stamped by presence alone, which is backwards
    // for revocation states — a post-W9 restore would have marked a suspended
    // row still in the policy as healthy, hiding real divergence behind a
    // green marker.
    const email = freshEmail('suspres');
    const id = await seed(email, 'suspended', null);
    policyEmails = [email];
    const r = await reconcileCfBaseline('cutover');
    expect(await stampOf(id)).toBeNull();
    expect(r.divergent).toContain(email);
  });

  it('leaves an active row missing from the policy unstamped and divergent', async () => {
    const email = freshEmail('actmiss');
    const id = await seed(email, 'active', null);
    policyEmails = [];
    const r = await reconcileCfBaseline('cutover');
    expect(await stampOf(id)).toBeNull();
    expect(r.divergent).toContain(email);
  });

  it('ACTIVELY NULLs a stale non-null stamp whose membership contradicts its status (Q36)', async () => {
    // The case that arises after restoring a POST-080 backup: the row arrives
    // carrying a stamp earned before the divergence. "Left NULL" only
    // describes rows already NULL; the stamp must be actively cleared.
    const email = freshEmail('stale');
    const id = await seed(email, 'suspended', new Date());
    policyEmails = [email]; // contradicts 'suspended'
    const r = await reconcileCfBaseline('restore');
    expect(await stampOf(id)).toBeNull();
    expect(r.cleared).toContain(email);
  });

  it('is idempotent — a second run re-imports nothing and leaves the stamp in place', async () => {
    // Execution deviation: the original version seeded the row FIRST, so the
    // email was already `known` on run one and `imported` was [] on BOTH runs.
    // The assertion could not distinguish a working already-known filter from
    // a missing one — it would have passed with the filter deleted entirely.
    // Importing on run one and asserting run two imports nothing is what makes
    // the case discriminating: without the filter, run two raises a unique
    // violation on users.email. Mutation-checked (`toImport = [...emails]`).
    const email = freshEmail('idem');
    policyEmails = [email];
    const first = await reconcileCfBaseline('cutover');
    expect(first.imported).toEqual([email]);
    const { rows } = await db.query<{ id: string }>(`SELECT id FROM users WHERE email=$1`, [email]);
    const id = rows[0].id;
    expect(await stampOf(id)).not.toBeNull();

    const second = await reconcileCfBaseline('cutover');
    expect(second.imported).toEqual([]);
    expect(await stampOf(id)).not.toBeNull();
    const { rows: after } = await db.query(`SELECT id FROM users WHERE email=$1`, [email]);
    expect(after).toHaveLength(1);
  });
});

describe('CF-only import (Q31b)', () => {
  it('creates a users row as invited, stamped, with invited_at set and NO mail', async () => {
    const email = 'thesugardog@repos.test';
    policyEmails = [email];
    const r = await reconcileCfBaseline('cutover');
    expect(r.imported).toEqual([email]);
    const { rows } = await db.query<{
      status: string; cf_synced_at: Date | null; invited_at: Date | null;
      invited_by: string | null; invite_sent_at: Date | null;
    }>(
      `SELECT status, cf_synced_at, invited_at, invited_by, invite_sent_at
         FROM users WHERE email=$1`, [email],
    );
    expect(rows[0].status).toBe('invited');       // first sign-in emits user_activated like any invitee
    expect(rows[0].cf_synced_at).not.toBeNull();
    expect(rows[0].invited_at).not.toBeNull();     // Q30's key derives from this
    expect(rows[0].invited_by).toBeNull();
    expect(rows[0].invite_sent_at).toBeNull();     // granted out of band; already told
  });

  it('writes exactly one user_imported event with the SYSTEM actor, in the same txn as the row', async () => {
    const email = 'imported.actor@repos.test';
    policyEmails = [email];
    await reconcileCfBaseline('cutover');
    const { rows: [u] } = await db.query<{ id: string }>(`SELECT id FROM users WHERE email=$1`, [email]);
    const ev = await db.query<{ kind: string; meta: Record<string, unknown> }>(
      `SELECT kind, meta FROM account_events WHERE user_id=$1`, [u.id],
    );
    expect(ev.rows).toHaveLength(1);
    expect(ev.rows[0].kind).toBe('user_imported'); // distinct kind: no invitation was sent
    expect(ev.rows[0].meta).toMatchObject({
      actor_kind: 'system', actor_name: 'cf_reconciliation', source: 'cutover',
    });
    expect(ev.rows[0].meta.actor_user_id).toBeUndefined();
  });

  it('a run during RESTORE records source=restore, not cutover (Q23 round 7)', async () => {
    const email = 'restore.sourced@repos.test';
    policyEmails = [email];
    await reconcileCfBaseline('restore');
    const { rows: [u] } = await db.query<{ id: string }>(`SELECT id FROM users WHERE email=$1`, [email]);
    const ev = await db.query<{ meta: Record<string, unknown> }>(
      `SELECT meta FROM account_events WHERE user_id=$1`, [u.id],
    );
    expect(ev.rows[0].meta.source).toBe('restore');
  });

  it('does NOT push DB-only users into the policy', async () => {
    const email = freshEmail('dbonly');
    await seed(email, 'active', null);
    policyEmails = [];
    await reconcileCfBaseline('cutover');
    // Granting access as a side effect of a maintenance script is exactly what
    // this must not do.
    expect(putSpy).not.toHaveBeenCalled();
    expect(policyEmails).toEqual([]);
  });

  it('rolls the users row back when its audit event cannot be written (Q27)', async () => {
    // Added by review: the happy-path row/event pair proves nothing about
    // atomicity. Moving COMMIT ahead of recordAccountEventTx left all fifteen
    // original cases green, because both rows exist either way. Rejecting the
    // event AT THE DATABASE is what forces the question.
    const email = 'atomic.import@repos.test';
    policyEmails = [email];
    await db.query(`
      CREATE FUNCTION reject_user_imported() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'audit rejected: user_imported'; END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER reject_user_imported_trg
        BEFORE INSERT ON account_events
        FOR EACH ROW WHEN (NEW.kind = 'user_imported')
        EXECUTE FUNCTION reject_user_imported();
    `);
    try {
      await expect(reconcileCfBaseline('cutover')).rejects.toThrow(/audit rejected/);
      const { rows } = await db.query(`SELECT id FROM users WHERE email=$1`, [email]);
      expect(rows).toHaveLength(0);
    } finally {
      // Dropped even on failure, or every later case inherits the rejection.
      await db.query(`DROP TRIGGER reject_user_imported_trg ON account_events`);
      await db.query(`DROP FUNCTION reject_user_imported()`);
    }
  });

  it('imports ONE row for a policy naming the same selector twice, and counts it once (Q12)', async () => {
    // Added by review. Cloudflare's include[] has no uniqueness constraint and
    // toSnapshot flattens it in policy order without deduplicating. NINE
    // existing cohort rows is the discriminating fixture: off the raw array
    // the cap check read 9 + 2 = 11 and aborted, and with the cap lifted the
    // second INSERT broke on users_email_key instead.
    await db.query(`DELETE FROM users`);
    for (let i = 0; i < 9; i++) {
      await db.query(`INSERT INTO users (email, status) VALUES ($1,'active')`, [freshEmail(`c${i}`)]);
    }
    const email = 'dupe.selector@repos.test';
    policyEmails = [email, email];

    const r = await reconcileCfBaseline('cutover');

    expect(r.imported).toEqual([email]);
    const { rows } = await db.query(`SELECT id FROM users WHERE email=$1`, [email]);
    expect(rows).toHaveLength(1);
    const { rows: [c] } = await db.query<{ c: number }>(
      `SELECT count(*)::int c FROM users WHERE status IN ('active','invited','deleting')`,
    );
    expect(c.c).toBe(10); // nine existing plus exactly one import — not an abort at 11
  });
});

describe('it aborts rather than importing from a broadened policy', () => {
  it('Q10: app_count !== 1', async () => {
    fetchPolicyImpl = async () => { throw new policy.CfPolicyError('app_count_not_one', 'two'); };
    await expect(reconcileCfBaseline('cutover')).rejects.toMatchObject({ code: 'app_count_not_one' });
  });

  it('Q22: a non-email selector', async () => {
    fetchPolicyImpl = async () => { throw new policy.CfPolicyError('non_email_selector', 'everyone'); };
    await expect(reconcileCfBaseline('cutover')).rejects.toMatchObject({ code: 'non_email_selector' });
  });

  it('Q12: the import would carry the cohort past the cap — nothing is imported', async () => {
    await db.query(`DELETE FROM users`);
    for (let i = 0; i < 10; i++) {
      await db.query(`INSERT INTO users (email, status) VALUES ($1,'active')`, [freshEmail(`f${i}`)]);
    }
    policyEmails = ['overflow@repos.test'];
    await expect(reconcileCfBaseline('cutover')).rejects.toMatchObject({ code: 'cohort_cap_reached' });
    const { rows } = await db.query(`SELECT id FROM users WHERE email='overflow@repos.test'`);
    expect(rows).toHaveLength(0);
  });
});

describe('reconciliation runs under the Q16/Q26 membership lock', () => {
  // The cutover runs against a live API, so the cap check and the import must
  // not interleave with a concurrent invite. Q16's lock is a session-level
  // pg_advisory_lock, so this also holds across the CLI/API process boundary.
  it('holds the lock across the policy fetch, the cap check and the imports', async () => {
    await db.query(`DELETE FROM users`);
    policyEmails = ['locked@repos.test'];

    let heldDuringFetch = false;
    fetchPolicyImpl = async () => {
      heldDuringFetch = await membershipLockIsHeld();
      return {
        emails: [...policyEmails], name: 'p', decision: 'allow',
        config: { name: 'p', decision: 'allow', include: policyEmails.map((e) => ({ email: { email: e } })), exclude: [], require: [] },
      };
    };

    const res = await reconcileCfBaseline('cutover');

    expect(heldDuringFetch).toBe(true);
    expect(res.imported).toContain('locked@repos.test');
    // ...and it is released when the run finishes, or the next lifecycle
    // operation would block forever.
    expect(await membershipLockIsHeld()).toBe(false);
  });

  it('a concurrent lock holder blocks the run rather than racing it', async () => {
    await db.query(`DELETE FROM users`);
    policyEmails = ['serialized@repos.test'];

    // The holder must NOT await the reconciliation from inside its callback:
    // withMembershipLock keeps the lock until the callback settles, and the
    // reconciliation is waiting on that same lock from another pooled
    // connection. Awaiting it there deadlocks until the 60s acquisition
    // timeout, which Vitest's 30s limit kills first. Start the run OUTSIDE
    // the holder and release the holder through a latch.
    let signalAcquired!: () => void;
    const acquired = new Promise<void>((r) => { signalAcquired = r; });
    let release!: () => void;
    const releaseHolder = new Promise<void>((r) => { release = r; });

    const holder = withMembershipLock(async () => {
      signalAcquired();
      await releaseHolder;
    });
    await acquired; // deterministic: the holder owns the lock before we race it

    let started = false;
    const run = reconcileCfBaseline('cutover').then(() => { started = true; });

    await new Promise((r) => setTimeout(r, 150));
    expect(started).toBe(false); // still waiting on the lock

    release();
    await holder;
    await run;
    expect(started).toBe(true);
  });
});
```

Helper — `membershipLockIsHeld()` asks Postgres directly rather than trusting
an in-process flag, which is the whole point of using an advisory lock:

```ts
async function membershipLockIsHeld(): Promise<boolean> {
  const { rows } = await db.query<{ c: number }>(
    `SELECT count(*)::int c FROM pg_locks
      WHERE locktype = 'advisory' AND objid = $1 AND granted`,
    [MEMBERSHIP_LOCK_KEY],
  );
  return rows[0].c > 0;
}
```

Helper: `async function stampOf(id: string) { const { rows } = await db.query<{ cf_synced_at: Date | null }>('SELECT cf_synced_at FROM users WHERE id=$1', [id]); return rows[0].cf_synced_at; }`

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/services/cf-reconcile.test.ts`
Expected: FAIL — `Cannot find module '../../src/services/cfReconcile.js'`

- [ ] **Step 3: Write the service**

Create `api/src/services/cfReconcile.ts`:

```ts
// W9 Q31 — reconcile the DB against the live Cloudflare Access policy.
//
// Runs from two places with identical logic and a different `source`:
//   - scripts/cutover/002-w9-cf-baseline.sh, once, at cutover
//   - scripts/run-restore.sh, after migrations, on every restore
//
// It is NOT migration 080: it consults live Cloudflare state, and a migration
// that depends on an external HTTP call is a migration that cannot be applied
// offline. Founding-admin promotion deliberately lives in 080 instead (Q35),
// so every schema-entry path yields a working admin with no CF dependency.
import { db } from '../db/client.js';
import { COHORT_CAP } from '../constants/users.js';
import type { UserStatus } from '../constants/users.js';
import { fetchPolicy, CfPolicyError } from './cfAccessPolicy.js';
import { desiredPresence } from './cfAccessSync.js';
import { recordAccountEventTx, systemActor } from './accountEvents.js';
import { withMembershipLock } from './membershipLock.js';

export type ReconcileAbortCode =
  | 'app_count_not_one'
  | 'non_email_selector'
  | 'cohort_cap_reached'
  | 'cf_unavailable';

export class ReconcileAbort extends Error {
  readonly code: ReconcileAbortCode;
  constructor(code: ReconcileAbortCode, message: string) {
    super(message);
    this.name = 'ReconcileAbort';
    this.code = code;
  }
}

export interface ReconcileResult {
  /** Rows whose membership matched their status and were stamped. */
  stamped: string[];
  /** Rows whose stamp was ACTIVELY set to NULL because membership contradicts status. */
  cleared: string[];
  /** Policy emails that had no users row and were imported as `invited`. */
  imported: string[];
  /** Every email whose membership contradicts its status. */
  divergent: string[];
}

export const RECONCILE_ACTOR_NAME = 'cf_reconciliation';

export async function reconcileCfBaseline(
  source: 'cutover' | 'restore',
): Promise<ReconcileResult> {
  // Q26 — reconciliation IMPORTS rows as `invited`, and `invited` is inside
  // the Q12 counted set, so this is a cohort-membership transition and takes
  // the Q16 mutation lock like every other one. The cutover runs against a
  // LIVE API (Deployment step 5 is after the container is back up), so without
  // the lock a concurrent invite and this import each observe room under the
  // cap independently and the cohort lands at 11; the same window also lets a
  // concurrent suspend/reinstate stamp rows from a policy snapshot that went
  // stale mid-run.
  //
  // Holding it across the fetchPolicy round-trip is the sanctioned pattern,
  // not a violation of Q7: Q16 is a session-level `pg_advisory_lock` on a
  // dedicated pooled connection with NO open transaction, precisely so a CF
  // HTTP call can happen inside it. Being a database lock, it also serializes
  // correctly across processes — this runs as its own `cfReconcile-cli.js`
  // process, not inside the API.
  //
  // Lock order stays Q26's single order: session lock -> BEGIN -> txn lock.
  // The per-import transactions below open inside this lock, never around it.
  //
  // The timeout is generous relative to the API's default: this fetches the
  // policy and then walks every row, and a cutover that fails on lock
  // acquisition is far more disruptive than one that waits.
  return withMembershipLock(() => reconcileLocked(source), { timeoutMs: 60_000 });
}

async function reconcileLocked(
  source: 'cutover' | 'restore',
): Promise<ReconcileResult> {
  // Q10 + Q22 are enforced by fetchPolicy itself: it refuses a policy attached
  // to more than one application, or one containing any non-email selector.
  // Abort rather than reconcile against a policy that has been broadened.
  let snapshot;
  try {
    snapshot = await fetchPolicy();
  } catch (err) {
    if (err instanceof CfPolicyError) {
      if (err.code === 'app_count_not_one' || err.code === 'non_email_selector') {
        throw new ReconcileAbort(err.code, err.message);
      }
      throw new ReconcileAbort('cf_unavailable', err.message);
    }
    throw err;
  }
  const inPolicy = new Set(snapshot.emails);

  const { rows } = await db.query<{ id: string; email: string; status: UserStatus; cf_synced_at: Date | null }>(
    `SELECT id, email, status, cf_synced_at FROM users`,
  );

  const result: ReconcileResult = { stamped: [], cleared: [], imported: [], divergent: [] };
  const known = new Set<string>();

  // (a) Stamp the baseline ACCORDING TO WHAT EACH ROW'S STATUS EXPECTS.
  // For active/invited, presence is synchronized; for suspended/deleting,
  // ABSENCE is synchronized and presence is divergence.
  for (const r of rows) {
    const email = r.email.toLowerCase();
    known.add(email);
    const matches = (desiredPresence(r.status) === 'present') === inPolicy.has(email);
    if (matches) {
      await db.query(`UPDATE users SET cf_synced_at = now() WHERE id=$1`, [r.id]);
      result.stamped.push(r.email);
    } else {
      // Actively NULL, not merely "leave NULL": a restored post-080 row can
      // arrive carrying a stale non-null stamp that must be cleared, or the
      // drift banner shows a green marker over a real divergence.
      if (r.cf_synced_at !== null) {
        await db.query(`UPDATE users SET cf_synced_at = NULL WHERE id=$1`, [r.id]);
        result.cleared.push(r.email);
      }
      result.divergent.push(r.email);
    }
  }

  // (b) Import every policy email that has no row.
  //
  // From `inPolicy`, NOT from snapshot.emails: Cloudflare's include[] is an
  // array of rules with no uniqueness constraint, and toSnapshot flattens it
  // in policy order without deduplicating, so one address listed twice arrives
  // as two entries. Off the raw array the first INSERT committed and the
  // second broke on users_email_key; worse, at a cohort of nine the cap check
  // read 9 + 2 = 11 and aborted the whole run indefinitely. The Set preserves
  // policy order, so the imported list is unchanged for a well-formed policy.
  const toImport = [...inPolicy].filter((e) => !known.has(e));
  if (toImport.length > 0) {
    const { rows: countRows } = await db.query<{ c: number }>(
      `SELECT count(*)::int c FROM users WHERE status IN ('active','invited','deleting')`,
    );
    if (countRows[0].c + toImport.length > COHORT_CAP) {
      throw new ReconcileAbort(
        'cohort_cap_reached',
        `importing ${toImport.length} CF-only identities would carry the cohort to ` +
          `${countRows[0].c + toImport.length}, past the cap of ${COHORT_CAP}`,
      );
    }
  }

  for (const email of toImport) {
    // Imported as `invited`, not `active`, so first sign-in emits
    // user_activated like any other invitee. NO email is sent — these
    // identities were granted out of band and were already told.
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const ins = await client.query<{ id: string }>(
        `INSERT INTO users (email, status, cf_synced_at, invited_at, invited_by, invite_sent_at)
         VALUES ($1, 'invited', now(), now(), NULL, NULL)
         RETURNING id`,
        [email],
      );
      // Q27 — the audit row commits in the SAME transaction as the row it
      // describes. Q23 — the system actor shape, with `source` keeping the
      // run's origin accurate in both invocation paths.
      await recordAccountEventTx(client, {
        userId: ins.rows[0].id,
        userEmail: email,
        kind: 'user_imported',
        ip: null,
        meta: { ...systemActor(RECONCILE_ACTOR_NAME, source) },
      });
      await client.query('COMMIT');
      result.imported.push(email);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  // It deliberately does NOT push DB-only users into the policy — that would
  // grant access as a side effect of a maintenance script.
  return result;
}
```

Create `api/src/services/cfReconcile-cli.ts`:

```ts
// CLI wrapper. Invoked by scripts/cutover/002-w9-cf-baseline.sh with
// --source=cutover and by scripts/run-restore.sh with --source=restore.
import { db } from '../db/client.js';
import { reconcileCfBaseline, ReconcileAbort } from './cfReconcile.js';

const arg = process.argv.find((a) => a.startsWith('--source='));
const source = arg?.slice('--source='.length);
if (source !== 'cutover' && source !== 'restore') {
  console.error('usage: cfReconcile-cli --source=cutover|restore');
  process.exit(2);
}

try {
  const r = await reconcileCfBaseline(source);
  console.log(JSON.stringify({ source, ...r }, null, 2));
  if (r.divergent.length > 0) {
    console.warn(`⚠ ${r.divergent.length} row(s) diverge from the CF policy — see /settings/users`);
  }
} catch (err) {
  if (err instanceof ReconcileAbort) {
    console.error(`✗ reconciliation aborted (${err.code}): ${err.message}`);
  } else {
    console.error('✗ reconciliation failed', err);
  }
  process.exit(1);
} finally {
  await db.end();
}
```

- [ ] **Step 4: Write the cutover script**

Create `scripts/cutover/002-w9-cf-baseline.sh` (`chmod +x`):

```bash
#!/usr/bin/env bash
# W9 cutover step 2 — stamp the CF sync baseline and import CF-only identities.
#
# Run ONCE, after migration 080 has been applied, from inside the container so
# CF_API_TOKEN / CF_ACCOUNT_ID / CF_ACCESS_POLICY_ID and DATABASE_URL are set:
#
#   docker exec -it repos /scripts/cutover/002-w9-cf-baseline.sh
#
# NOTE the path: the Dockerfile does `COPY scripts /scripts` (docker/Dockerfile:57).
# `/app/scripts` is the LOCAL-dev default only — see api/.env.example's
# REPOS_SCRIPTS_DIR=/scripts note. Using /app/scripts here fails "file not found"
# and silently leaves CF-only identities unimported.
#
# It is idempotent: re-running re-stamps rows that still match and imports
# nothing that already exists. It aborts rather than importing when the policy
# is attached to more than one application (Q10), contains a non-email selector
# (Q22), or when the import would carry the cohort past the cap (Q12).
#
# Founding-admin promotion is NOT here — it lives in migration 080 (Q35), so a
# restore that never runs this script still yields a working admin.
set -euo pipefail

# REPOS_API_DIR, not API_DIR: run-restore.sh:37 already reads that name for the
# same directory, and two sibling scripts honouring different overrides for one
# path is a trap for whoever relocates it.
API_DIR="${REPOS_API_DIR:-/app/api}"
cd "${API_DIR}"
exec node dist/services/cfReconcile-cli.js --source=cutover
```

- [ ] **Step 5: Wire the restore path**

Verified: `scripts/run-restore.sh:118` runs `node dist/db/migrate.js` and nothing else. Insert a new step immediately after it (before the step-6 `device_tokens` wipe):

```bash
# 5b. W9 Q35 — reconcile the CF policy after migrations and BEFORE maintenance
#     is cleared. A restore of a pre-080 dump has no row for any identity that
#     was granted CF access out of band, so without this the restore silently
#     re-creates the deny-by-default lockout that Q31b exists to prevent. It
#     also clears stale cf_synced_at stamps carried in by a post-080 dump.
#
#     A reconciliation failure is SURFACED, NOT FATAL: the data restore itself
#     is valid, and migration 080 has already guaranteed an active admin with
#     no Cloudflare dependency, so the operator can clear maintenance and fix
#     the sync from /settings/users.
if ! (cd "${API_DIR}" && node dist/services/cfReconcile-cli.js --source=restore); then
  echo "⚠ CF reconciliation failed after restore — data is valid; fix sync from /settings/users" >&2
fi
```

- [ ] **Step 6: Run tests, build, and commit**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/services/cf-reconcile.test.ts && npm run build`
Expected: PASS, 17 tests; `dist/services/cfReconcile-cli.js` exists. (15 as planned, plus the two review-added cases above: audit-rollback atomicity and the duplicate policy selector.)

Run: `bash -n /var/home/jason/Projects/RepOS/scripts/run-restore.sh && bash -n /var/home/jason/Projects/RepOS/scripts/cutover/002-w9-cf-baseline.sh`
Expected: no output (both parse).

```bash
cd /var/home/jason/Projects/RepOS && chmod +x scripts/cutover/002-w9-cf-baseline.sh
git add api/src/services/cfReconcile.ts api/src/services/cfReconcile-cli.ts scripts/cutover/002-w9-cf-baseline.sh scripts/run-restore.sh api/tests/services/cf-reconcile.test.ts
git commit -m "$(cat <<'EOF'
feat(w9): status-aware CF reconciliation for cutover and restore (Q31, Q35)

Stamps the sync baseline by what each row's STATUS expects — presence for
active/invited, absence for suspended/deleting — and actively NULLs a stale
stamp whose membership contradicts its status, the case a post-080 restore
produces. Imports CF-only identities as invited with a user_imported event
carrying the system actor and the run's real source, and sends no mail.
run-restore.sh now invokes it after migrations; a failure is surfaced, not
fatal, because the data restore is valid regardless.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 17: DR-level restore test

**Round-5 review finding 1 was a cross-wave blocker.** Restoring a pre-080 dump would apply 080, default everyone to `member`/`active`, never run the cutover, and leave **zero admins** — while the API sits in maintenance mode that only an admin can clear, and step 6 of the same script revokes every `device_tokens` row. Total lockout, recoverable only by break-glass SQL. This test is the regression guard.

**Files:**
- Create: `api/tests/dr/restore-admin-guarantee.test.ts`

**Interfaces:**
- Consumes: `createEphemeralDb`/`runMigrations` (T1), `reconcileCfBaseline` (T16), `FOUNDING_ADMIN_EMAIL` (T2).
- Produces: no exports.

> **Unwind note (Task 15b, 2026-08-02):** do not inline an unwind here. Import `unwindToPreW9` from `api/tests/helpers/migration-unwind.ts` — the single shared definition, which drops 082's trigger and function *before* the nine columns they depend on and re-arms all three W9 migrations. The version originally written into this task unwound 080 and 081 only and would fail on `DROP COLUMN status` while the trigger existed. `migration-082.test.ts` asserts the helper stays complete, so extending the 080–089 range means extending the helper, not forking it.

> **Adaptation note:** the spec calls for restoring a real pre-080 dump into an ephemeral Postgres. `pg_dump`/`pg_restore`/`psql` are **not installed on this workstation** (verified 2026-07-26), so this test reconstructs a pre-080 database structurally — apply all migrations, then drop the 080 columns and its `_migrations` row — which exercises the same code path 080 takes on a real dump. Add the binary-level `pg_restore` variant to `tests/integration/restore.test.ts` when running in CI, where the Postgres client tools are present.

- [ ] **Step 1: Write the failing test**

Create `api/tests/dr/restore-admin-guarantee.test.ts`:

```ts
// Q35 — DR-level. Every schema-entry path must yield a working admin.
import 'dotenv/config';
import { describe, it, expect, afterAll, vi } from 'vitest';
import pg from 'pg';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEphemeralDb } from '../helpers/ephemeral-db.js';
import { unwindToPreW9 } from '../helpers/migration-unwind.js';
import { runMigrations } from '../../src/db/runMigrations.js';
import { FOUNDING_ADMIN_EMAIL } from '../../src/constants/users.js';

const cleanups: Array<() => Promise<void>> = [];
// LIFO, not FIFO. preO80Database registers `pool.end(); eph.drop()` first, and
// cases (b)–(d) later register the app / singleton-db teardown against that
// same database. Draining in registration order would DROP DATABASE while the
// app's pool still holds connections to it, which Postgres refuses with
// "database is being accessed by other users".
afterAll(async () => { for (const c of cleanups.reverse()) await c(); });

/**
 * Reconstruct a pre-W9 database: full schema, then unwind EVERY migration this
 * wave adds — 080, 081 and 082.
 *
 * The unwind itself lives in `tests/helpers/migration-unwind.ts` and is shared
 * with `tests/db/migration-080.test.ts`. It was a per-file copy twice and was
 * incomplete both times: the first left 081's `_migrations` row applied, the
 * second left 082's. Either way the re-run skips that file and the test quietly
 * stops covering it, while still reading as though it covered everything. A
 * real pre-080 dump contains none of the three, and the whole point of this
 * harness is to be indistinguishable from one.
 *
 * `migration-082.test.ts` asserts the helper is complete — it unwinds, re-runs,
 * and requires all three filenames back in the applied list. Extend the helper
 * when the range grows; do not fork it.
 *
 * Returns the URL alongside the pool because cases (b)–(d) must point
 * `DATABASE_URL` at THIS database before importing the singleton db client.
 */
async function preO80Database(tag: string): Promise<{ pool: pg.Pool; url: string }> {
  const eph = await createEphemeralDb(tag);
  const pool = new pg.Pool({ connectionString: eph.url, max: 3 });
  cleanups.push(async () => { await pool.end(); await eph.drop(); });
  await runMigrations(pool);
  // The ONE unwind (tests/helpers/migration-unwind.ts) — do not inline a copy.
  // It drops 082's trigger and function before the columns they depend on, and
  // re-arms all three W9 migrations; an inlined 080/081-only version fails on
  // `DROP COLUMN status` because the trigger still references it.
  await unwindToPreW9(pool);
  return { pool, url: eph.url };
}

describe('restore of a pre-080 dump (Q35)', () => {
  it('(a) migrations alone, with NO Cloudflare, yield an active admin', async () => {
    const { pool } = await preO80Database('dr-a');
    await pool.query(`INSERT INTO users (email) VALUES ('beta.user@repos.test')`);
    // No CF_API_TOKEN is set anywhere in this test — that is the point.
    await runMigrations(pool);
    const { rows } = await pool.query<{ email: string }>(
      `SELECT email FROM users WHERE role='admin' AND status='active'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe(FOUNDING_ADMIN_EMAIL);

    // BOTH W9 migrations re-applied, not just 080. Without this the harness
    // could silently stop unwinding 081 — the restore would still yield an
    // admin, the test would still pass, and the invite path would come back up
    // missing the column its Q30 replay depends on.
    const cols = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name='users' AND column_name IN ('status','invite_request')`,
    );
    expect(cols.rows.map((r) => r.column_name).sort()).toEqual(['invite_request', 'status']);
  });

  it('(b) that admin can clear maintenance — the lockout scenario is closed', async () => {
    // This is the whole point of the wave's DR story, so it EXERCISES the
    // endpoint. Asserting role/status off a SELECT only restates migration
    // 080; it cannot catch a gate that rejects the row for some other reason
    // (a stale allowlist read, the Q17b precondition applied too broadly, a
    // non-async preHandler that hangs). Boot the app and clear the flag.
    const { pool, url } = await preO80Database('dr-b');
    await runMigrations(pool);

    // Capture BEFORE overwriting. Reading it after the assignment below just
    // hands back the temp path, so cleanup would "restore" the env to a flag
    // file that the negative case leaves on disk — every later suite in this
    // process would then boot into maintenance mode.
    const savedFlagPath = process.env.MAINTENANCE_FLAG_PATH;

    const flag = join(await mkdtemp(join(tmpdir(), 'repos-dr-')), 'maintenance.flag');
    await writeFile(flag, 'restore in progress');
    process.env.MAINTENANCE_FLAG_PATH = flag;

    // Fresh module registry so app.js and client.js bind to THIS database
    // rather than a pool cached by an earlier case.
    vi.resetModules();
    process.env.DATABASE_URL = url;
    const { buildApp } = await import('../../src/app.js');
    const { db } = await import('../../src/db/client.js');
    const { setupTestJwks } = await import('../helpers/cf-access-jwt.js');

    const jwks = await setupTestJwks();
    const app = await buildApp();

    // CRITICAL: requireAdminKeyOrCfAccess short-circuits to authMode='admin'
    // and returns WITHOUT looking at the JWT whenever ADMIN_API_KEY is unset
    // (api/src/middleware/cfAccess.ts — the "dev / test: open admin path"
    // branch). Leaving it unset makes this test pass for a database with no
    // admin at all, which is precisely the regression it exists to catch.
    // Set it, send NO x-admin-key, and the gate is forced down the CF Access
    // path where the founding admin's role is actually resolved.
    const savedAdminKey = process.env.ADMIN_API_KEY;
    process.env.ADMIN_API_KEY = 'dr-guard-key';
    cleanups.push(async () => {
      if (savedAdminKey === undefined) delete process.env.ADMIN_API_KEY;
      else process.env.ADMIN_API_KEY = savedAdminKey;
      // Restore the ORIGINAL path (captured before the overwrite) and delete
      // the temp flag the negative case deliberately left in place, so no
      // later suite can pick up either.
      if (savedFlagPath === undefined) delete process.env.MAINTENANCE_FLAG_PATH;
      else process.env.MAINTENANCE_FLAG_PATH = savedFlagPath;
      await rm(flag, { force: true });
      await app.close();
      await db.end();
      await jwks.teardown();
    });

    const r = await app.inject({
      method: 'POST', url: '/api/maintenance/clear',
      headers: {
        'cf-access-jwt-assertion': await jwks.mintJwt(FOUNDING_ADMIN_EMAIL),
        'x-repos-csrf': '1',
      },
    });
    expect(r.statusCode).toBe(204);
    expect(existsSync(flag)).toBe(false);

    // Prove the gate was really exercised rather than bypassed: the same
    // request from a non-admin identity must be refused. If ADMIN_API_KEY
    // were unset, this would also return 204 and the assertion above would be
    // meaningless.
    await writeFile(flag, 'restore in progress');
    await db.query(
      `INSERT INTO users (email, role, status) VALUES ('member.dr@repos.test','member','active')`,
    );
    const denied = await app.inject({
      method: 'POST', url: '/api/maintenance/clear',
      headers: {
        'cf-access-jwt-assertion': await jwks.mintJwt('member.dr@repos.test'),
        'x-repos-csrf': '1',
      },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json<{ error: string }>().error).toBe('not_an_admin');
    expect(existsSync(flag)).toBe(true);

    // No Cloudflare was consulted to get here — the row is unstamped and the
    // clear still worked. That is the property the lockout regression needs.
    const { rows } = await db.query<{ cf_synced_at: Date | null }>(
      `SELECT cf_synced_at FROM users WHERE lower(email)=$1`, [FOUNDING_ADMIN_EMAIL],
    );
    expect(rows[0].cf_synced_at).toBeNull();
  });

  it('(c) the CF reconciliation reconstructs the CF-only invite', async () => {
    const eph = await createEphemeralDb('dr-c');
    const pool = new pg.Pool({ connectionString: eph.url, max: 3 });
    cleanups.push(async () => { await pool.end(); await eph.drop(); });
    await runMigrations(pool);

    // vi.resetModules() BEFORE setting DATABASE_URL and importing: db/client.js
    // is a singleton that reads the URL once at module evaluation. Without a
    // registry reset the dynamic import below returns whatever pool an earlier
    // case already built, so this case would silently reconcile the WRONG
    // database while asserting against this one.
    vi.resetModules();
    process.env.DATABASE_URL = eph.url;
    const policy = await import('../../src/services/cfAccessPolicy.js');
    const { reconcileCfBaseline } = await import('../../src/services/cfReconcile.js');
    const { db } = await import('../../src/db/client.js');
    cleanups.push(async () => { await db.end(); });

    // `emails` is DERIVED from config.include by toSnapshot, so a fixture must
    // keep the two agreeing — an empty include[] beside a populated emails[] is
    // a shape fetchPolicy can never return, and would hide a bug in any code
    // that reads config instead of emails.
    const restoredEmails = [FOUNDING_ADMIN_EMAIL, 'thesugardog@repos.test'];
    vi.spyOn(policy, 'fetchPolicy').mockResolvedValue({
      emails: restoredEmails,
      name: 'Owner Only', decision: 'allow',
      config: {
        name: 'Owner Only', decision: 'allow',
        include: restoredEmails.map((e) => ({ email: { email: e } })),
        exclude: [], require: [],
      },
    } as never);

    const r = await reconcileCfBaseline('restore');
    expect(r.imported).toEqual(['thesugardog@repos.test']);
    const { rows } = await db.query<{ status: string; cf_synced_at: Date | null }>(
      `SELECT status, cf_synced_at FROM users WHERE email='thesugardog@repos.test'`,
    );
    expect(rows[0].status).toBe('invited');
    expect(rows[0].cf_synced_at).not.toBeNull();
    const ev = await db.query<{ meta: Record<string, unknown> }>(
      `SELECT ae.meta FROM account_events ae
         JOIN users u ON u.id = ae.user_id
        WHERE u.email='thesugardog@repos.test' AND ae.kind='user_imported'`,
    );
    expect(ev.rows[0].meta).toMatchObject({ actor_kind: 'system', source: 'restore' });
    vi.restoreAllMocks();
  });

  it('(d) a reconciliation failure leaves the restored data valid and the failure visible', async () => {
    const eph = await createEphemeralDb('dr-d');
    const pool = new pg.Pool({ connectionString: eph.url, max: 3 });
    cleanups.push(async () => { await pool.end(); await eph.drop(); });
    await runMigrations(pool);
    await pool.query(`INSERT INTO users (email, status) VALUES ('kept@repos.test','active')`);

    // Same reason as case (c): without the reset this would run against dr-c's
    // cached pool and pass vacuously while asserting against dr-d.
    vi.resetModules();
    process.env.DATABASE_URL = eph.url;
    const policy = await import('../../src/services/cfAccessPolicy.js');
    const { reconcileCfBaseline, ReconcileAbort } = await import('../../src/services/cfReconcile.js');
    const { db } = await import('../../src/db/client.js');
    cleanups.push(async () => { await db.end(); });
    vi.spyOn(policy, 'fetchPolicy').mockRejectedValue(
      new policy.CfPolicyError('app_count_not_one', 'attached to two apps'),
    );

    await expect(reconcileCfBaseline('restore')).rejects.toBeInstanceOf(ReconcileAbort);

    // The data restore itself is valid — nothing was rolled back or dropped.
    const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int n FROM users`);
    expect(rows[0].n).toBe(2); // founding admin + kept@
    const admin = await pool.query<{ n: number }>(
      `SELECT count(*)::int n FROM users WHERE role='admin' AND status='active'`,
    );
    expect(admin.rows[0].n).toBe(1);
    vi.restoreAllMocks();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/dr/restore-admin-guarantee.test.ts`
Expected: FAIL if any of Tasks 2 or 16 regressed; PASS once both are correct. Run it before touching anything to confirm it is meaningful — if it passes trivially, the `preO80Database` unwind is not actually removing the columns.

- [ ] **Step 3: Confirm the guard is real**

Temporarily comment out the `DO $$ ... $$` data step in `080_users_roles_status.sql`, re-run the test, and confirm case (a) **fails** with zero admins. Restore the block.

- [ ] **Step 4: Commit**

```bash
cd /var/home/jason/Projects/RepOS && git add api/tests/dr/restore-admin-guarantee.test.ts
git commit -m "$(cat <<'EOF'
test(w9): DR guard for the pre-080 restore lockout (Q35)

Restoring a pre-080 dump would have applied 080, defaulted everyone to
member/active, never run the cutover and left zero admins — while the API sat
in maintenance mode only an admin can clear and every device token had been
revoked. Asserts an active admin exists with no Cloudflare involvement, that
reconciliation reconstructs the CF-only invite with source=restore, and that a
reconciliation failure leaves the restored data valid.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 18: `/settings/users`

**Files:**
- Create: `frontend/src/lib/api/adminUsers.ts`
- Create: `frontend/src/components/settings/UsersTable.tsx`
- Create: `frontend/src/components/settings/InviteUserModal.tsx`
- Create: `frontend/src/pages/SettingsUsersPage.tsx`
- Modify: `frontend/src/components/settings/SettingsSidebar.tsx`
- Modify: `frontend/src/components/settings/SettingsSidebar.test.tsx`
- Modify: `frontend/src/components/layout/Sidebar.tsx` (filter admin-only entries)
- Modify: `frontend/src/App.tsx` (route)
- Test: `frontend/src/pages/SettingsUsersPage.test.tsx`

**Interfaces:**
- Consumes: the six routes from Tasks 11–14; `apiFetch` + `jsonOrThrow` + `ApiError`; `useCurrentUser` for `is_admin`.
- Produces:
  - `listUsers()`, `inviteUser(email, role)`, `patchUser(id, patch)`, `deleteUser(id)`, `resendInvite(id)`, `retrySync(id)` in `lib/api/adminUsers.ts`
  - `SETTINGS_SECTIONS` gains `{ label: 'Users', to: '/settings/users', disabled: false, ownerWave: 'W9', adminOnly: true }`
  - `SettingsSection` gains `adminOnly?: boolean`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/pages/SettingsUsersPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import SettingsUsersPage from './SettingsUsersPage';
import * as api from '../lib/api/adminUsers';
import * as auth from '../auth';

const baseResponse = {
  users: [
    { id: '1', email: 'admin@repos.test', display_name: 'Admin', role: 'admin', status: 'active',
      invited_at: null, activated_at: '2026-07-01T00:00:00Z', last_seen_at: '2026-07-26T00:00:00Z',
      cf_synced_at: '2026-07-26T00:00:00Z', invite_sent_at: null, invited_by_email: null },
    { id: '2', email: 'pending@repos.test', display_name: null, role: 'member', status: 'invited',
      invited_at: '2026-07-25T00:00:00Z', activated_at: null, last_seen_at: null,
      cf_synced_at: null, invite_sent_at: null, invited_by_email: 'admin@repos.test' },
  ],
  cohort: { count: 2, cap: 10 },
  drift: { checked: true, policy_error: null, divergent: [], unknown: ['pending@repos.test'] },
};

beforeEach(() => vi.restoreAllMocks());

// The page reads `useCurrentUser()` for `is_admin` and for the Q13 self-action
// rule (`row.id !== currentUserId`). `AuthContext`'s default value is
// `{ status:'loading', user:null }`, so rendering without a provider or a mock
// leaves `currentUserId` undefined — every row then compares unequal, the
// signed-in admin's row grows a full action set, and both the self-action test
// and the delete test (which indexes [0] of the DELETE buttons) fail.
// `renderPage` mocks the hook so the signed-in user is row id '1'.
function renderPage(user: Partial<auth.User> = {}) {
  vi.spyOn(auth, 'useCurrentUser').mockReturnValue({
    status: 'authenticated',
    user: {
      id: '1',                       // matches baseResponse's admin row
      email: 'admin@repos.test',
      display_name: 'Admin',
      timezone: 'America/New_York',
      is_admin: true,
      ...user,
    },
    error: null,
  });
  return render(<MemoryRouter><SettingsUsersPage /></MemoryRouter>);
}

describe('SettingsUsersPage', () => {
  it('renders email, status, role, last seen, invited by and sync state', async () => {
    vi.spyOn(api, 'listUsers').mockResolvedValue(baseResponse as never);
    renderPage();
    expect(await screen.findByText('admin@repos.test')).toBeInTheDocument();
    expect(screen.getByText('pending@repos.test')).toBeInTheDocument();
    expect(screen.getAllByText(/invited/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/2 \/ 10/)).toBeInTheDocument();
  });

  it('shows SYNC PENDING for a row with no stamp, not a drift error', async () => {
    vi.spyOn(api, 'listUsers').mockResolvedValue(baseResponse as never);
    renderPage();
    expect(await screen.findByText(/sync pending/i)).toBeInTheDocument();
    expect(screen.queryByText(/diverge/i)).not.toBeInTheDocument();
  });

  it('shows the drift banner only for CONFIRMED divergence', async () => {
    vi.spyOn(api, 'listUsers').mockResolvedValue({
      ...baseResponse,
      drift: { checked: true, policy_error: null, unknown: [],
        divergent: [{ email: 'ghost@repos.test', reason: 'in_policy_no_row' }] },
    } as never);
    renderPage();
    expect(await screen.findByText(/ghost@repos.test/)).toBeInTheDocument();
    expect(screen.getByText(/diverge/i)).toBeInTheDocument();
  });

  it('surfaces a policy read failure without hiding the table', async () => {
    vi.spyOn(api, 'listUsers').mockResolvedValue({
      ...baseResponse,
      drift: { checked: false, policy_error: 'app_count_not_one', divergent: [], unknown: [] },
    } as never);
    renderPage();
    expect(await screen.findByText('admin@repos.test')).toBeInTheDocument();
    expect(screen.getByText(/app_count_not_one/)).toBeInTheDocument();
  });

  it('403 renders "Not authorized" rather than an empty table', async () => {
    vi.spyOn(api, 'listUsers').mockRejectedValue({ status: 403 });
    renderPage();
    expect(await screen.findByText(/not authorized/i)).toBeInTheDocument();
  });

  it('invite modal posts the email and role, then refreshes', async () => {
    const list = vi.spyOn(api, 'listUsers').mockResolvedValue(baseResponse as never);
    const invite = vi.spyOn(api, 'inviteUser').mockResolvedValue({ id: '3' } as never);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /invite user/i }));
    await userEvent.type(screen.getByLabelText(/email/i), 'new@repos.test');
    await userEvent.click(screen.getByRole('button', { name: /^send invite$/i }));
    await waitFor(() => expect(invite).toHaveBeenCalledWith('new@repos.test', 'member'));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });

  it('surfaces a 409 cohort_cap_reached with the count', async () => {
    vi.spyOn(api, 'listUsers').mockResolvedValue(baseResponse as never);
    vi.spyOn(api, 'inviteUser').mockRejectedValue({ status: 409, body: { error: 'cohort_cap_reached', count: 10, cap: 10 } });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /invite user/i }));
    await userEvent.type(screen.getByLabelText(/email/i), 'new@repos.test');
    await userEvent.click(screen.getByRole('button', { name: /^send invite$/i }));
    expect(await screen.findByText(/10 \/ 10/)).toBeInTheDocument();
  });

  it('delete requires typed confirmation (heavy action)', async () => {
    vi.spyOn(api, 'listUsers').mockResolvedValue(baseResponse as never);
    const del = vi.spyOn(api, 'deleteUser').mockResolvedValue(undefined as never);
    renderPage();
    await userEvent.click((await screen.findAllByRole('button', { name: /^delete$/i }))[0]);
    const confirmBtn = screen.getByRole('button', { name: /delete user/i });
    expect(confirmBtn).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/type the email/i), 'pending@repos.test');
    expect(confirmBtn).toBeEnabled();
    await userEvent.click(confirmBtn);
    await waitFor(() => expect(del).toHaveBeenCalledWith('2'));
  });

  it('offers no row action that targets the signed-in admin', async () => {
    vi.spyOn(api, 'listUsers').mockResolvedValue(baseResponse as never);
    renderPage();
    await screen.findByText('admin@repos.test');
    // Self-management lives in /settings/account (Q13).
    const row = screen.getByText('admin@repos.test').closest('tr')!;
    expect(row.querySelectorAll('button')).toHaveLength(0);
  });
});
```

Update `frontend/src/components/settings/SettingsSidebar.test.tsx`:

```tsx
  it('ships the W6 lineup plus W2 Health and the W9 admin-only Users entry', () => {
    expect(SETTINGS_SECTIONS.map((s) => s.label)).toEqual([
      'Account','Health','Equipment','Integrations','Program prefs','Backups','Feedback','Users','Storage','Injuries',
    ]);
  });

  it('Users is admin-only and every other entry is not', () => {
    const users = SETTINGS_SECTIONS.find((s) => s.label === 'Users');
    expect(users?.adminOnly).toBe(true);
    expect(users?.ownerWave).toBe('W9');
    expect(SETTINGS_SECTIONS.filter((s) => s.adminOnly).map((s) => s.label)).toEqual(['Users']);
  });
```

The `useCurrentUser` mock in that suite is not needed — `SETTINGS_SECTIONS` is data. The filtering test belongs to `Sidebar`, so add to `frontend/src/__smoke__/navigation.smoke.test.tsx`: a member sees 9 sub-nav entries, an admin sees 10.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/pages/SettingsUsersPage.test.tsx src/components/settings/SettingsSidebar.test.tsx`
Expected: FAIL — the page module does not exist and the label list has no `Users`.

- [ ] **Step 3: Write the API client**

Create `frontend/src/lib/api/adminUsers.ts`:

```ts
// frontend/src/lib/api/adminUsers.ts
// Beta W9 — typed client for /api/admin/users. Every state-changing call
// carries X-RepOS-CSRF:1 (csrfOrigin requires it on the CF Access path).
import { apiFetch } from '../../auth';
import { jsonOrThrow } from './_http';

export type UserStatus = 'invited' | 'active' | 'suspended' | 'deleting';
export type UserRole = 'member' | 'admin';

export interface AdminUserRow {
  id: string;
  email: string;
  display_name: string | null;
  role: UserRole;
  status: UserStatus;
  invited_at: string | null;
  activated_at: string | null;
  last_seen_at: string | null;
  cf_synced_at: string | null;
  invite_sent_at: string | null;
  invited_by_email: string | null;
}

export interface DriftReport {
  checked: boolean;
  policy_error: string | null;
  divergent: Array<{ email: string; reason: 'in_policy_unexpected' | 'missing_from_policy' | 'in_policy_no_row' }>;
  unknown: string[];
}

export interface AdminUserList {
  users: AdminUserRow[];
  cohort: { count: number; cap: number };
  drift: DriftReport;
}

export async function listUsers(): Promise<AdminUserList> {
  return jsonOrThrow<AdminUserList>(await apiFetch('/api/admin/users'));
}

export async function inviteUser(email: string, role: UserRole): Promise<{ id: string }> {
  const res = await apiFetch('/api/admin/users/invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-RepOS-CSRF': '1' },
    body: JSON.stringify({ email, role }),
  });
  return jsonOrThrow<{ id: string }>(res);
}

export async function patchUser(
  id: string,
  patch: { role?: UserRole; status?: 'active' | 'suspended' },
): Promise<AdminUserRow> {
  const res = await apiFetch(`/api/admin/users/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-RepOS-CSRF': '1' },
    body: JSON.stringify(patch),
  });
  return jsonOrThrow<AdminUserRow>(res);
}

export async function resendInvite(id: string): Promise<{ id: string }> {
  const res = await apiFetch(`/api/admin/users/${id}/resend-invite`, {
    method: 'POST', headers: { 'X-RepOS-CSRF': '1' },
  });
  return jsonOrThrow<{ id: string }>(res);
}

export async function retrySync(id: string): Promise<{ cf_synced: boolean; sync_error: string | null }> {
  const res = await apiFetch(`/api/admin/users/${id}/retry-sync`, {
    method: 'POST', headers: { 'X-RepOS-CSRF': '1' },
  });
  return jsonOrThrow<{ cf_synced: boolean; sync_error: string | null }>(res);
}

export async function deleteUser(id: string): Promise<void> {
  const res = await apiFetch(`/api/admin/users/${id}`, {
    method: 'DELETE', headers: { 'X-RepOS-CSRF': '1' },
  });
  if (!res.ok) await jsonOrThrow(res); // throws ApiError with the parsed body
}
```

- [ ] **Step 4: Build the surfaces**

Create `frontend/src/components/settings/UsersTable.tsx` — a table of `email · status · role · last seen · invited by · sync state`, with per-row actions rendered only when `row.id !== currentUserId` (Q13). Follow `AdminFeedbackPage.tsx` for styling conventions: `TOKENS`/`FONTS` from `../../tokens`, inline styles, `JetBrains Mono` for data columns and `Inter Tight` for labels. Action weights per the architecture diagram — light: `RESEND` / `RETRY SYNC` (plain buttons); medium: `SUSPEND` / `REINSTATE` (confirm dialog, warn colour `#F5B544`); heavy: `DELETE` (typed-confirmation dialog, danger colour `#FF6A6A`). Sync state cell: `cf_synced_at === null` renders `SYNC PENDING` in warn, otherwise `SYNCED` in good `#6BE28B`.

Create `frontend/src/components/settings/InviteUserModal.tsx` — an email input (`<label htmlFor>` wired so `getByLabelText(/email/i)` finds it), a `member`/`admin` role select, and a `SEND INVITE` submit. On `ApiError` with status 409 and `body.error === 'cohort_cap_reached'`, render `Cohort is full — {count} / {cap}.`; on 409 `already_active` / `suspended_use_reinstate` / `deletion_in_progress`, render the matching plain-English line.

Create `frontend/src/pages/SettingsUsersPage.tsx` — loads on mount, renders `denied` for 401/403, an actionable retry for anything else, the cohort chip `{count} / {cap}`, the drift banner (only when `drift.divergent.length > 0`, or a distinct advisory line when `drift.checked === false` showing `drift.policy_error`), `<InviteUserModal>` and `<UsersTable>`. Refresh by re-calling `listUsers()` after every successful mutation.

**Do not** render a drift banner for `drift.unknown` — that is sync-pending, not divergence (Q36), and conflating them is the false alarm that trains the operator to ignore the signal.

- [ ] **Step 5: Wire navigation**

In `frontend/src/components/settings/SettingsSidebar.tsx`, extend the interface and the array:

```ts
export interface SettingsSection {
  label: string;
  to: string;
  disabled: boolean;
  ownerWave: 'W6' | 'W1' | 'W2' | 'W3' | 'W4' | 'W5' | 'W7' | 'W9';
  /** W9 — rendered only when /api/me reports is_admin. The API enforces it server-side regardless. */
  adminOnly?: boolean;
}
```

Insert after `Feedback` (keeping Storage and Injuries last per D7):

```ts
  { label: 'Users',         to: '/settings/users',         disabled: false, ownerWave: 'W9', adminOnly: true },
```

In `frontend/src/components/layout/Sidebar.tsx`, filter where `SETTINGS_SECTIONS` is mapped:

```tsx
  const visibleSections = SETTINGS_SECTIONS.filter((s) => !s.adminOnly || user?.is_admin)
```

and map `visibleSections` instead.

In `frontend/src/App.tsx`, add the import and the route alongside the other settings routes:

```tsx
import SettingsUsersPage from './pages/SettingsUsersPage'
// ...
            <Route path="settings/users" element={<SettingsUsersPage />} />
```

- [ ] **Step 6: Run tests**

Run: `cd /var/home/jason/Projects/RepOS/frontend && npx vitest run && npm run build`
Expected: PASS across the frontend suite; build clean.

- [ ] **Step 7: Commit**

```bash
cd /var/home/jason/Projects/RepOS && git add frontend/
git commit -m "$(cat <<'EOF'
feat(w9): /settings/users — invite, suspend, reinstate, delete, retry sync

Admin-only settings entry with a table of email, status, role, last seen,
inviter and sync state. The drift banner fires only on CONFIRMED divergence;
a missing stamp renders as SYNC PENDING, because conflating the two is the
false alarm that teaches an operator to ignore the signal. No row action
targets the signed-in admin — self-management lives in /settings/account.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 19: Contamination matrix, reachability, and the final env sweep

**Files:**
- Create: `api/tests/integration/contamination/admin-users-contamination.test.ts`
- Modify: `docs/superpowers/goals/beta.md` (G2 count, G7 row, G14 mechanization)
- Modify: `api/.env.example` and `CLAUDE.md` scope section

  There is **no env template under `docker/`** — that directory holds only
  `Dockerfile`, `nginx/` and `root/`. The single tracked template is
  `api/.env.example`, and it is stale in three ways: line 12 still advertises
  `CF_ACCESS_ALLOWED_EMAILS`, line 19 still advertises `REPOS_ADMIN_EMAILS`
  (both removed by this wave), and lines 17–18 carry the same "Migration 063
  reserves `users.role`" comment that Task 9 deletes from `cfAccess.ts`.
  Replace all three with the five new set-once vars: `CF_API_TOKEN`,
  `CF_ACCOUNT_ID`, `CF_ACCESS_POLICY_ID`, `RESEND_API_KEY`,
  `INVITE_FROM_EMAIL` — commented out, each noted as advisory at boot and
  failing at use time, never at boot.
- Test: `api/tests/integration/w9-env-sweep.test.ts`

**Interfaces:**
- Consumes: everything.
- Produces: six contamination rows toward G2's ≥35.

- [ ] **Step 1: Write the failing tests**

Create `api/tests/integration/contamination/admin-users-contamination.test.ts` — a non-admin receives 403 on **all six** routes:

```ts
// G2 contamination matrix — six rows. A CF-Access-authenticated `member` must
// be refused on every user-management route, and the X-Admin-Key escape hatch
// must not work on any of them (Q20).
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../../../src/app.js';
import { setupTestJwks, type TestJwksHandle } from '../../helpers/cf-access-jwt.js';
import { mkUserWithEmail, cleanupUser } from '../../helpers/program-fixtures.js';

let app: Awaited<ReturnType<typeof buildApp>>;
let jwks: TestJwksHandle;
let memberEmail: string;
let victimId: string;
const created: string[] = [];

beforeAll(async () => {
  jwks = await setupTestJwks();
  app = await buildApp();
  memberEmail = `w9.contam-member-${randomUUID().slice(0, 8)}@repos.test`;
  created.push((await mkUserWithEmail(memberEmail, { role: 'member', status: 'active' })).id);
  const victim = await mkUserWithEmail(`w9.contam-victim-${randomUUID().slice(0, 8)}@repos.test`, {
    role: 'member', status: 'active',
  });
  victimId = victim.id;
  created.push(victimId);
});

afterAll(async () => {
  for (const id of created) await cleanupUser(id).catch(() => {});
  await app.close();
  await jwks.teardown();
});

const ROUTES: Array<{ name: string; method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; url: (id: string) => string; payload?: unknown }> = [
  { name: 'GET /api/admin/users',                    method: 'GET',    url: () => '/api/admin/users' },
  { name: 'POST /api/admin/users/invite',            method: 'POST',   url: () => '/api/admin/users/invite', payload: { email: 'x@repos.test', role: 'member' } },
  { name: 'POST /api/admin/users/:id/resend-invite', method: 'POST',   url: (id) => `/api/admin/users/${id}/resend-invite` },
  { name: 'PATCH /api/admin/users/:id',              method: 'PATCH',  url: (id) => `/api/admin/users/${id}`, payload: { status: 'suspended' } },
  { name: 'DELETE /api/admin/users/:id',             method: 'DELETE', url: (id) => `/api/admin/users/${id}` },
  { name: 'POST /api/admin/users/:id/retry-sync',    method: 'POST',   url: (id) => `/api/admin/users/${id}/retry-sync` },
];

describe('W9 contamination matrix — six rows toward G2', () => {
  for (const r of ROUTES) {
    it(`${r.name}: a CF-Access member gets 403`, async () => {
      const res = await app.inject({
        method: r.method, url: r.url(victimId),
        headers: { 'cf-access-jwt-assertion': await jwks.mintJwt(memberEmail), 'x-repos-csrf': '1' },
        ...(r.payload ? { payload: r.payload } : {}),
      });
      expect(res.statusCode).toBe(403);
      expect(res.json<{ error: string }>().error).toBe('not_an_admin');
    });

    it(`${r.name}: the X-Admin-Key path is rejected`, async () => {
      const saved = process.env.ADMIN_API_KEY;
      process.env.ADMIN_API_KEY = 'contam-key';
      try {
        const res = await app.inject({
          method: r.method, url: r.url(victimId),
          headers: { 'x-admin-key': 'contam-key', 'x-repos-csrf': '1' },
          ...(r.payload ? { payload: r.payload } : {}),
        });
        expect(res.statusCode).toBe(403);
        expect(res.json<{ error: string }>().error).toBe('cf_access_required');
      } finally {
        if (saved === undefined) delete process.env.ADMIN_API_KEY;
        else process.env.ADMIN_API_KEY = saved;
      }
    });
  }

  it('the victim is untouched by every rejected attempt', async () => {
    const { rows } = await (await import('../../../src/db/client.js')).db.query<{ status: string; role: string }>(
      `SELECT status, role FROM users WHERE id=$1`, [victimId],
    );
    expect(rows[0]).toEqual({ status: 'active', role: 'member' });
  });
});
```

Create `api/tests/integration/w9-env-sweep.test.ts`:

```ts
// The two env vars W9 removes must be read NOWHERE. A stale reader would
// reintroduce exactly the redeploy coupling this wave exists to remove.
import { describe, it, expect } from 'vitest';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  for (const e of await readdir(dir)) {
    if (e === 'node_modules' || e === 'dist' || e === '.git') continue;
    const p = join(dir, e);
    if ((await stat(p)).isDirectory()) await walk(p, out);
    else if (/\.(ts|tsx|sql|sh|md|yml|yaml)$/.test(e)) out.push(p);
  }
  return out;
}

describe('W9 env-var removal is complete', () => {
  it('no source file READS CF_ACCESS_ALLOWED_EMAILS or REPOS_ADMIN_EMAILS', async () => {
    const roots = ['api/src', 'api/tests', 'frontend/src', 'docker', 'scripts'];
    const offenders: string[] = [];
    for (const root of roots) {
      for (const f of await walk(join(process.cwd(), '..', root)).catch(() => [])) {
        const body = await readFile(f, 'utf8');
        if (/process\.env\.(CF_ACCESS_ALLOWED_EMAILS|REPOS_ADMIN_EMAILS)/.test(body)) {
          offenders.push(f);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  // The reader sweep above matches `process.env.X` in code files, so it can
  // never catch the tracked env template — `.env.example` has no scanned
  // extension and declares rather than reads. Assert it separately or the
  // template keeps advertising both removed vars to every future operator.
  it('api/.env.example advertises the five new vars and neither removed one', async () => {
    const tpl = await readFile(join(process.cwd(), '.env.example'), 'utf8');
    expect(tpl).not.toMatch(/CF_ACCESS_ALLOWED_EMAILS/);
    expect(tpl).not.toMatch(/REPOS_ADMIN_EMAILS/);
    for (const v of [
      'CF_API_TOKEN', 'CF_ACCOUNT_ID', 'CF_ACCESS_POLICY_ID',
      'RESEND_API_KEY', 'INVITE_FROM_EMAIL',
    ]) {
      expect(tpl).toContain(v);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail (or pass meaningfully)**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/integration/contamination/admin-users-contamination.test.ts tests/integration/w9-env-sweep.test.ts --config vitest.integration.config.ts`
Expected: the contamination suite passes if Tasks 9–14 are correct — run it and read the failures rather than assuming. The env sweep fails if any reader survives; delete the reader, never the assertion.

- [ ] **Step 3: Fix whatever the sweep finds**

Remove every surviving reader, plus `api/.env.example` (there is no template under `docker/` — see the Files list above) and any documentation that instructs an operator to *set* these variables. Replace those doc lines with a pointer to `/settings/users`. Documentation that merely records what the variables *were*, and what replaced them, stays — the greps above are anchored on `process.env.` precisely so that history survives.

- [ ] **Step 4: Update the Beta dashboard and scope docs**

In `docs/superpowers/goals/beta.md`:
- G2: add 6 to the contamination-matrix count and name `admin-users-contamination.test.ts`.
- G7: add the reachability row — `/settings/users` is reachable in 2 clicks from `/` (Settings → Users), inside the ≤3 budget.
- G14: mark the cohort cap, the Beta disclaimer and the documented contact path as **mechanized in code and email copy** by W9, replacing the prose-only statement.
- Add a W9 row to the wave table noting it sits outside the original W0–W8 arc and is **not gate-blocking** (per user direction on 2026-07-26: Beta is an active development period, not a feature freeze).

In `CLAUDE.md`, update the Scope section: move user management from the implicit env-var workflow into Beta's shipped list, and update the "Beta (in-flight)" pointer to name this plan.

Add a reachability assertion to the existing G7 test file so the claim is enforced, not asserted in prose only.

- [ ] **Step 5: Full verification**

Run, in order:

```bash
cd /var/home/jason/Projects/RepOS/api && npm run build && npm test && npm run test:integration
cd /var/home/jason/Projects/RepOS/frontend && npx vitest run && npm run build
cd /var/home/jason/Projects/RepOS && grep -rnE "process\.env\.(REPOS_ADMIN_EMAILS|CF_ACCESS_ALLOWED_EMAILS)|isAdminEmail" api/src frontend/src docker scripts
```

Expected: all green; the final grep returns **nothing**.

Same reasoning as Task 9's grep: this matches **reads**, not the names. Migration
080's mapping header and the `cfAccess.ts` replacement comment both cite the
removed variables on purpose, to record what they were replaced by. A
bare-name grep would force deleting that history to go green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
test(w9): contamination matrix, env sweep, and dashboard updates

Six contamination rows toward G2 — every user-management route refuses a
CF-Access member and the X-Admin-Key path. A repo-wide sweep asserts neither
removed env var is read anywhere, so the redeploy coupling cannot creep back.
Marks G14 mechanized and adds the /settings/users reachability row to G7.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Deployment (after all tasks merge)

Not a task — the operator runs this once, and it is the only redeploy this wave requires.

1. Add the five env vars to `/mnt/user/appdata/repos/.env` on Unraid; remove `CF_ACCESS_ALLOWED_EMAILS` and `REPOS_ADMIN_EMAILS`.
2. Add the Resend SPF and DKIM records on **`send.jpmtech.com`** via the Cloudflare API. Root SPF (`v=spf1 include:_spf.protonmail.ch mx ~all`) and the root Proton DKIM CNAMEs stay **unmodified**; root DMARC `p=quarantine` covers the subdomain by inheritance and Resend's signature aligns.
3. Recreate the container (env vars are fixed at create time — stop + rm + run, not restart).
4. Migration 080 applies on boot. Confirm an active admin exists.
5. Run the cutover: `docker exec -it repos /scripts/cutover/002-w9-cf-baseline.sh` (the Dockerfile COPYs `scripts` to `/scripts`, not `/app/scripts`). Expect `thesugardog@gmail.com` in `imported`.
6. Open `/settings/users`, confirm no drift (no policy-error advisory; a banner appears only for confirmed divergence), and send one real invite to a disposable address to verify delivery end to end.
7. **Delete that test user from `/settings/users`.** The verification invite is not free — it leaves a durable `users` row, a real address in the Cloudflare Access policy, and a consumed slot against `COHORT_CAP`. Delete through the UI so the Q33 path also removes the Cloudflare grant; deleting the row in SQL would strand the address in the policy. Same rule as the `RESEND_API_KEY` rotation in `docs/runbooks/secret-rotation.md`.

**After this, no user-lifecycle change requires a container recreate.** That is the whole point of the wave.

---

## Self-Review

**Spec coverage.** Every locked decision maps to a task: Q1/Q2 → T8; Q3/Q20/Q32 → T9; Q4 → T2+T8; Q5/Q6/Q30 → T10; Q7/Q8/Q12/Q18/Q27/Q29 → T11; Q9/Q36 → T14; Q10/Q19/Q22/Q38 → T5; Q11 → T15; Q13/Q26/Q28/Q34 → T12; Q14/Q17/Q17a/Q24 → T12; Q15 → T15; Q16 → T4; Q17b/Q33/Q37 → T13; Q21 → T8; Q23 → T3; Q25 → T7; Q31/Q35 → T16+T17. Schema → T2; Configuration → T15; DNS → Deployment; Email content → T10; Error-handling table → T11–T14; Testing bullets → the task each belongs to; Invariant matrix → T2, T8, T11–T14, T16, T17.

**Known gaps, stated rather than hidden:**
- **The DR test is structural, not binary.** `pg_dump`/`pg_restore`/`psql` are absent on this workstation, so T17 reconstructs a pre-080 database by unwinding the migration instead of restoring a real dump. The binary-level variant belongs in CI. Flagged inline in T17.
- **No Postgres is currently running.** Every task's verification step is blocked until the Prerequisite section is satisfied.
- **`api/.env` names the old `192.168.88.2` host.** Known and deferred — local untracked config, not authoritative on topology. Repointing it is part of the Prerequisite purely so the suite has a reachable database, not a defect to fix.
- Invite expiry, Resend delivery webhooks, auto-healing drift, Access Groups, self-service signup and per-user permissions are all explicitly out of scope per the spec and appear in no task.

**Type consistency.** `Actor`, `LifecycleError`, `UserStatus`, `UserRole`, `EventActor`, `CfPolicySnapshot`, `DriftReport` and `UserListRow` are each defined once and referenced by the same name everywhere. `desiredPresence` is the single source of the status→membership mapping and is consumed by `syncEmailToStatus` (T6), `listUsers` (T14) and `reconcileCfBaseline` (T16), so the three cannot drift apart.

**Ordering.** T1→T2 (harness before migration), T2/T3→everything, T4/T5/T6→T11, T10→T11, T11→T12→T13→T14 (shared service file grows in that order), T16→T17, T7/T8/T9 independent of the service chain but required before T19's sweep.
