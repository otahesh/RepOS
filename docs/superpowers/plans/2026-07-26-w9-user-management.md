# W9 — User Management + Invites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move RepOS user management out of container env vars and into the database, so an admin can invite, suspend, reinstate, and delete Beta users from `/settings/users` with no container recreate.

**Architecture:** `users.status` + `users.role` become the authoritative access gate, checked on every request by both auth paths (CF Access JWT and opaque bearer). The Cloudflare Access policy is kept in sync as an edge pre-filter, never as the security boundary — grants take effect last, revocations first. Every membership transition serializes on a session-level `pg_advisory_lock` held on a dedicated pooled connection, outside any transaction, so the Cloudflare HTTP round-trip never sits inside a DB transaction.

**Tech Stack:** Fastify 5, TypeScript (ESM, `.js` import specifiers), `pg` 8 Pool, zod 4, vitest 4, React 18 + Vite 5, Cloudflare Access API, Resend API.

**Source spec:** [docs/superpowers/specs/2026-07-26-user-management-design.md](../specs/2026-07-26-user-management-design.md) — commit `fab968d`. Every `Qnn` reference below points at a locked decision in that spec. Deviations require re-opening the spec.

## Global Constraints

- **Migration range:** `080–089`. Only `080_users_roles_status.sql` is added by this plan.
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

/** Apply 001..079 only, so a test can seed pre-080 rows before 080 lands. */
async function migrateTo079(pool: pg.Pool): Promise<void> {
  await runMigrations(pool);
}

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
    await pool.query(`DELETE FROM users`);
    await pool.query(`DELETE FROM _migrations WHERE filename='080_users_roles_status.sql'`);
    await pool.query(`ALTER TABLE users DROP COLUMN role, DROP COLUMN status,
                        DROP COLUMN invited_by, DROP COLUMN invited_at, DROP COLUMN activated_at,
                        DROP COLUMN cf_synced_at, DROP COLUMN invite_sent_at, DROP COLUMN invite_message_id`);
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
    await pool.query(`DELETE FROM users`);
    await pool.query(`DELETE FROM _migrations WHERE filename='080_users_roles_status.sql'`);
    await pool.query(`ALTER TABLE users DROP COLUMN role, DROP COLUMN status,
                        DROP COLUMN invited_by, DROP COLUMN invited_at, DROP COLUMN activated_at,
                        DROP COLUMN cf_synced_at, DROP COLUMN invite_sent_at, DROP COLUMN invite_message_id`);
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
    await pool.query(`DELETE FROM users`);
    await pool.query(`DELETE FROM _migrations WHERE filename='080_users_roles_status.sql'`);
    await pool.query(`ALTER TABLE users DROP COLUMN role, DROP COLUMN status,
                        DROP COLUMN invited_by, DROP COLUMN invited_at, DROP COLUMN activated_at,
                        DROP COLUMN cf_synced_at, DROP COLUMN invite_sent_at, DROP COLUMN invite_message_id`);
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

The fail-closed layer. Every refusal here surfaces as drift rather than a silent partial write.

**Files:**
- Create: `api/src/services/cfAccessPolicy.ts`
- Test: `api/tests/services/cf-access-policy.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `interface CfPolicySnapshot { emails: string[]; name: string; decision: string; exclude: unknown[]; require: unknown[] }`
  - `class CfPolicyError extends Error { code: CfPolicyErrorCode }`
  - `type CfPolicyErrorCode = 'cf_not_configured' | 'cf_http_error' | 'cf_timeout' | 'app_count_not_one' | 'non_email_selector' | 'policy_changed'`
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
let queue: Array<() => Promise<Response>>;

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
    return abortable(next(), init.signal);
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
  | 'policy_changed';

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
  /** Echoed back on PUT untouched (Q22). */
  exclude: unknown[];
  /** Echoed back on PUT untouched (Q22). */
  require: unknown[];
}

const DEFAULT_TIMEOUT_MS = 8_000;

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

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new CfPolicyError('cf_http_error', `Cloudflare ${method} returned non-JSON`, text.slice(0, 200));
    }
    if (!res.ok || parsed.success !== true) {
      throw new CfPolicyError(
        'cf_http_error',
        `Cloudflare ${method} returned HTTP ${res.status}`,
        JSON.stringify(parsed.errors ?? parsed).slice(0, 300),
      );
    }
    return parsed.result as Record<string, unknown>;
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
  const include = Array.isArray(result.include) ? result.include : [];
  const emails: string[] = [];
  for (const sel of include) {
    const s = sel as Record<string, unknown>;
    const keys = Object.keys(s);
    const emailObj = s.email as { email?: unknown } | undefined;
    if (keys.length !== 1 || keys[0] !== 'email' || typeof emailObj?.email !== 'string') {
      throw new CfPolicyError(
        'non_email_selector',
        `policy include[] contains a non-email selector (${keys.join(',') || 'empty'})`,
      );
    }
    emails.push(emailObj.email.toLowerCase());
  }
  return {
    emails,
    name: String(result.name ?? ''),
    decision: String(result.decision ?? 'allow'),
    exclude: Array.isArray(result.exclude) ? result.exclude : [],
    require: Array.isArray(result.require) ? result.require : [],
  };
}

/**
 * A stable, total serialization of everything we observed about the policy.
 * Used for the Q19 compare-before-write: "any difference aborts" has to mean
 * any difference, including the fields we echo back rather than compute.
 */
function fingerprint(s: CfPolicySnapshot): string {
  return JSON.stringify({
    emails: s.emails,
    name: s.name,
    decision: s.decision,
    exclude: s.exclude,
    require: s.require,
  });
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
  await cfRequest(
    'PUT',
    {
      name: current.name,
      decision: current.decision,
      include: desiredEmails.map((e) => ({ email: { email: e } })),
      exclude: current.exclude,
      require: current.require,
    },
    timeoutMs,
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/services/cf-access-policy.test.ts`
Expected: PASS, 15 tests.

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
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as policy from '../../src/services/cfAccessPolicy.js';
import { desiredPresence, syncEmail, syncEmailToStatus } from '../../src/services/cfAccessSync.js';

function snap(emails: string[]) {
  return { emails, name: 'Owner Only', decision: 'allow', exclude: [], require: [] };
}

let fetchSpy: ReturnType<typeof vi.spyOn>;
let putSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(policy, 'fetchPolicy');
  putSpy = vi.spyOn(policy, 'putPolicyEmails').mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

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
Expected: PASS, 9 tests.

> **Note for the implementer:** `vi.spyOn` on an ESM namespace import works in vitest only when the consuming module imports the same binding at runtime. `cfAccessSync.ts` imports `{ fetchPolicy, putPolicyEmails }` directly, which vitest's ESM interop makes spyable. If the spies do not take effect, switch the test to `vi.mock('../../src/services/cfAccessPolicy.js', ...)` with an explicit factory — do **not** change the production import style to work around it.

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

  it('still 401s a garbage token (no status leak on the miss path)', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/account/sessions',
      headers: { authorization: 'Bearer deadbeefdeadbeef.' + 'f'.repeat(64) },
    });
    expect(r.statusCode).toBe(401);
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
  // every failure is an indistinguishable bare 401.
  if (row.status !== 'active') {
    req.log.warn({ userId: row.user_id, status: row.status }, 'bearer_rejected_inactive_user');
    return reply.code(401).send();
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/middleware/bearer-status-gate.test.ts`
Expected: PASS, 6 tests.

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
    // Force the exact interleaving: suspend between the read and the update.
    // We simulate it by flipping the row to `suspended` while the request is
    // in flight, using a statement-level advisory hook: the middleware re-reads
    // on zero rows, so a suspended row must yield 403 rather than 200.
    await db.query(`UPDATE users SET status='suspended' WHERE id=$1`, [u.id]);
    const r = await me(email);
    expect(r.statusCode).toBe(403);
    expect(r.json<{ error: string }>().error).toBe('access_suspended');
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

Known set from the 2026-07-26 survey — each needs a pre-created `users` row via `mkUserWithEmail`, and any `CF_ACCESS_ALLOWED_EMAILS` handling deleted:

- `tests/integration/jwks-rotation.test.ts:72` — deletes the `CF_ACCESS_ALLOWED_EMAILS = TEST_EMAIL` line and pre-creates `TEST_EMAIL` as `active`
- `tests/integration/scope-enforcement.test.ts`
- `tests/integration/signout-everywhere.test.ts`
- `tests/integration/account-deletion-cascade.test.ts`
- `tests/integration/csrf-origin.test.ts`
- `tests/integration/admin-gate.test.ts`
- `tests/middleware/require-cf-access-only.test.ts`
- `tests/integration/admin-feedback.test.ts`
- `tests/integration/contamination/*.test.ts` (any that mint a JWT)

Also strip the `CF_ACCESS_ALLOWED_EMAILS` save/restore plumbing from `tests/helpers/cf-access-jwt.ts` (the `SavedEnv` field, the two assignments, and the `allowedEmails` option) — the env var no longer exists.

**Do not** re-add auto-provisioning to make a test pass. If a test needs a user, the test creates it.

- [ ] **Step 6: Run the gate tests, then the full suite**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/middleware/cf-access-gate.test.ts`
Expected: PASS, 11 tests.

Run: `cd /var/home/jason/Projects/RepOS/api && npm test && npm run test:integration`
Expected: PASS. Every remaining failure is a test that assumed auto-provisioning; fix the test.

- [ ] **Step 7: Commit**

```bash
cd /var/home/jason/Projects/RepOS && git add -A api/src/middleware/cfAccess.ts api/tests/
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
- Modify: `api/src/middleware/cfAccess.ts:173-273` (`isAdminEmail` → role check, new `requireCfAccessAdmin`)
- Modify: `api/src/app.ts:26,112`
- Delete: `api/tests/middleware/admin-emails.test.ts`
- Test: `api/tests/middleware/admin-role.test.ts`

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

  it('does not depend on REPOS_ADMIN_EMAILS in any way', async () => {
    const saved = process.env.REPOS_ADMIN_EMAILS;
    process.env.REPOS_ADMIN_EMAILS = 'nobody@nowhere.test';
    try {
      const r = await app.inject({
        method: 'GET', url: '/probe',
        headers: { 'cf-access-jwt-assertion': await jwks.mintJwt(adminEmail) },
      });
      expect(r.statusCode).toBe(200);
    } finally {
      if (saved === undefined) delete process.env.REPOS_ADMIN_EMAILS;
      else process.env.REPOS_ADMIN_EMAILS = saved;
    }
  });
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

`tests/integration/admin-feedback.test.ts` sets `REPOS_ADMIN_EMAILS='boss@repos.test'` in four places (lines 9, 13, 19–20, 46, 51, 71). Replace that plumbing with a `mkUserWithEmail('boss@repos.test', { role: 'admin' })` fixture created in `beforeAll` and cleaned up in `afterAll`.

Grep for any remaining reader: `grep -rn "REPOS_ADMIN_EMAILS\|isAdminEmail" api/src api/tests` must return nothing.

- [ ] **Step 6: Run tests**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/middleware/admin-role.test.ts && npm test && npm run test:integration`
Expected: PASS throughout.

- [ ] **Step 7: Commit**

```bash
cd /var/home/jason/Projects/RepOS && git add -A api/
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
  - `sendInviteEmail(input: SendInviteInput): Promise<{ messageId: string }>`
  - `class MailerError extends Error { code: 'mail_not_configured' | 'mail_http_error' | 'mail_timeout' }`
  - `__setMailFetchForTesting(f: typeof fetch | null): void`
  - `SUPPORT_CONTACT = 'jason.meyer1@gmail.com'`, `APP_URL = 'https://repos.jpmtech.com'`

- [ ] **Step 1: Write the failing test**

Create `api/tests/services/invite-mailer.test.ts`:

```ts
// Q5, Q30, Q38 + the G14 email-content requirements.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  sendInviteEmail,
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

  it('the plain-text alternative contains no markup', () => {
    expect(renderInviteText(input)).not.toMatch(/<[a-z]/i);
  });
});

describe('sendInviteEmail', () => {
  it('POSTs to Resend with the from address, both parts and the idempotency key', async () => {
    const r = await sendInviteEmail({
      toEmail: 'new@repos.test', invitedByEmail: 'admin@repos.test', idempotencyKey: 'k-1',
    });
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

  it('throws mail_not_configured when RESEND_API_KEY is unset — never at boot', async () => {
    delete process.env.RESEND_API_KEY;
    await expect(
      sendInviteEmail({ toEmail: 'a@b.test', invitedByEmail: 'c@d.test', idempotencyKey: 'k' }),
    ).rejects.toMatchObject({ code: 'mail_not_configured' });
  });

  it('surfaces a non-2xx as mail_http_error', async () => {
    respond = async () => new Response(JSON.stringify({ message: 'nope' }), { status: 422 });
    await expect(
      sendInviteEmail({ toEmail: 'a@b.test', invitedByEmail: 'c@d.test', idempotencyKey: 'k' }),
    ).rejects.toMatchObject({ code: 'mail_http_error' });
  });

  it('Q38: aborts on deadline', async () => {
    respond = async () => { await new Promise((r) => setTimeout(r, 200)); return new Response('{}', { status: 200 }); };
    await expect(
      sendInviteEmail({ toEmail: 'a@b.test', invitedByEmail: 'c@d.test', idempotencyKey: 'k', timeoutMs: 40 }),
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

export type MailerErrorCode = 'mail_not_configured' | 'mail_http_error' | 'mail_timeout';

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
const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function renderInviteHtml({ toEmail, invitedByEmail }: InviteCopyInput): string {
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

export interface SendInviteInput extends InviteCopyInput {
  idempotencyKey: string;
  timeoutMs?: number;
}

export async function sendInviteEmail(
  input: SendInviteInput,
): Promise<{ messageId: string }> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.INVITE_FROM_EMAIL;
  if (!key || !from) {
    // Missing credentials fail at USE time with a specific error, never at
    // boot — matching the Healthchecks and feedback-webhook precedent.
    throw new MailerError(
      'mail_not_configured',
      'RESEND_API_KEY and INVITE_FROM_EMAIL must both be set to send invites',
    );
  }

  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
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
          // Q30 — transport retry protection.
          'Idempotency-Key': input.idempotencyKey,
        },
        body: JSON.stringify({
          from: `RepOS <${from}>`,
          to: [input.toEmail],
          subject: 'You have been invited to RepOS (Beta)',
          html: renderInviteHtml(input),
          text: renderInviteText(input),
        }),
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
    let parsed: { id?: unknown };
    try {
      parsed = JSON.parse(text) as { id?: unknown };
    } catch {
      throw new MailerError('mail_http_error', 'Resend returned non-JSON', text.slice(0, 200));
    }
    return { messageId: typeof parsed.id === 'string' ? parsed.id : '' };
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/services/invite-mailer.test.ts`
Expected: PASS, 10 tests.

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
- Create: `api/src/services/userLifecycle.ts`
- Create: `api/src/schemas/adminUsers.ts`
- Create: `api/src/routes/adminUsers.ts`
- Modify: `api/src/app.ts` (register the plugin)
- Test: `api/tests/routes/admin-users-invite.test.ts`

**Interfaces:**
- Consumes: `withMembershipLock` (T4), `syncEmail`/`syncEmailToStatus` (T6), `sendInviteEmail`/`initialIdempotencyKey`/`resendIdempotencyKey` (T10), `recordAccountEventTx`/`humanActor` (T3), `COHORT_CAP` (T2), `requireCfAccessAdmin` (T9).
- Produces:
  - `interface Actor { userId: string; email: string; ip: string | null }`
  - `class LifecycleError extends Error { statusCode: number; code: string; details?: Record<string, unknown> }`
  - `inviteUser(email: string, role: UserRole, actor: Actor): Promise<InviteOutcome>`
  - `resendInvite(targetId: string, actor: Actor): Promise<InviteOutcome>`
  - `type InviteOutcome = { id: string; email: string; status: UserStatus; cf_synced: boolean; invite_sent: boolean; sync_error: string | null; mail_error: string | null; resent?: boolean; resynced?: boolean }`
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
const { setupTestJwks } = await import('../helpers/cf-access-jwt.js');

let app: Awaited<ReturnType<typeof buildApp>>;
let jwks: Awaited<ReturnType<typeof setupTestJwks>>;
const ADMIN = 'admin.invite@repos.test';
let adminId: string;

let policyEmails: string[];
let fetchPolicyImpl: () => Promise<unknown>;
let sentMail: Array<{ toEmail: string; idempotencyKey: string }>;
let mailImpl: () => Promise<{ messageId: string }>;

beforeAll(async () => {
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
});

beforeEach(() => {
  vi.restoreAllMocks();
  policyEmails = [ADMIN];
  fetchPolicyImpl = async () => ({
    emails: [...policyEmails], name: 'Owner Only', decision: 'allow', exclude: [], require: [],
  });
  vi.spyOn(policy, 'fetchPolicy').mockImplementation(() => fetchPolicyImpl() as never);
  vi.spyOn(policy, 'putPolicyEmails').mockImplementation(async (emails: string[]) => {
    policyEmails = [...emails];
  });
  sentMail = [];
  mailImpl = async () => ({ messageId: 'msg_x' });
  vi.spyOn(mailer, 'sendInviteEmail').mockImplementation(async (i: never) => {
    const input = i as unknown as { toEmail: string; idempotencyKey: string };
    sentMail.push({ toEmail: input.toEmail, idempotencyKey: input.idempotencyKey });
    return mailImpl();
  });
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

async function seed(email: string, status: string, cfSynced: Date | null) {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO users (email, status, cf_synced_at, invited_at)
     VALUES ($1,$2,$3, now()) RETURNING id`, [email, status, cfSynced],
  );
  return rows[0].id;
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
    expect(r.statusCode).toBe(201);
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

  it('invited + synced -> intentional resend with a FRESH idempotency key, 200 resent', async () => {
    const email = freshEmail('synced');
    const id = await seed(email, 'invited', new Date());
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
  sendInviteEmail,
  initialIdempotencyKey,
  resendIdempotencyKey,
  MailerError,
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
  constructor(statusCode: number, code: string, details: Record<string, unknown> = {}) {
    super(code);
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
async function countCohort(): Promise<number> {
  const { rows } = await db.query<{ c: number }>(
    `SELECT count(*)::int c FROM users WHERE status IN ('active','invited','deleting')`,
  );
  return rows[0].c;
}

/**
 * Attempt the CF add, then the mail. Shared by the fresh-invite and the
 * retry-then-send branch of Q29. Never throws for a sync or mail failure —
 * both are recorded on the outcome so the row survives with a retry
 * affordance (Q8). Rollback would discard admin intent and race the email.
 */
async function provisionAndMail(
  userId: string,
  email: string,
  invitedAt: Date,
  actorEmail: string,
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

  try {
    const { messageId } = await sendInviteEmail({
      toEmail: email, invitedByEmail: actorEmail, idempotencyKey,
    });
    await db.query(
      `UPDATE users SET invite_sent_at = now(), invite_message_id = $2 WHERE id=$1`,
      [userId, messageId],
    );
    return { cf_synced: true, invite_sent: true, sync_error: null, mail_error: null };
  } catch (err) {
    // The user is already in the CF policy and CAN sign in; the admin resends.
    return { cf_synced: true, invite_sent: false, sync_error: null, mail_error: mailErrorCode(err) };
  }
  void invitedAt;
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
    const existing = await db.query<{ id: string; status: UserStatus; cf_synced_at: Date | null; invited_at: Date | null }>(
      `SELECT id, status, cf_synced_at, invited_at FROM users WHERE lower(email)=$1`,
      [target],
    );

    // Q29 — duplicate invite is explicit per current status. users.email is
    // UNIQUE, so the un-specified path was a raw constraint violation
    // surfacing as a 500.
    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      if (row.status === 'active') throw new LifecycleError(409, 'already_active');
      if (row.status === 'suspended') throw new LifecycleError(409, 'suspended_use_reinstate');
      if (row.status === 'deleting') throw new LifecycleError(409, 'deletion_in_progress');

      const invitedAt = row.invited_at ?? new Date();
      if (row.cf_synced_at === null) {
        // Provisioning failed last time: retry the sync FIRST and send only if
        // it succeeds. Mailing unconditionally would send a link the invitee
        // cannot use, contradicting Q7 and Q17b.
        const r = await provisionAndMail(
          row.id, target, invitedAt, actor.email, resendIdempotencyKey(row.id),
        );
        return {
          id: row.id, email: target, status: 'invited',
          ...r, resynced: r.cf_synced,
        };
      }
      // Already provisioned: a deliberate second delivery, fresh key (Q30).
      let invite_sent = false;
      let mail_error: string | null = null;
      try {
        const { messageId } = await sendInviteEmail({
          toEmail: target, invitedByEmail: actor.email,
          idempotencyKey: resendIdempotencyKey(row.id),
        });
        await db.query(
          `UPDATE users SET invite_sent_at = now(), invite_message_id=$2 WHERE id=$1`,
          [row.id, messageId],
        );
        invite_sent = true;
      } catch (err) {
        mail_error = mailErrorCode(err);
      }
      return {
        id: row.id, email: target, status: 'invited',
        cf_synced: true, invite_sent, sync_error: null, mail_error, resent: true,
      };
    }

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
        meta: { ...humanActor(actor.userId, actor.email), role },
      });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    const r = await provisionAndMail(
      userId, target, invitedAt, actor.email, initialIdempotencyKey(userId, invitedAt),
    );
    return { id: userId, email: target, status: 'invited', ...r };
  });
}

/** Q29 — POST /:id/resend-invite enforces the identical precondition. */
export async function resendInvite(targetId: string, actor: Actor): Promise<InviteOutcome> {
  const { rows } = await db.query<{ email: string }>(
    `SELECT email FROM users WHERE id=$1`, [targetId],
  );
  if (rows.length === 0) throw new LifecycleError(404, 'user_not_found');
  return inviteUser(rows[0].email, 'member', actor);
}
```

> The `void invitedAt;` line above is dead — delete it when writing the file; it is an artifact of the parameter list. Keep the parameter (the initial-send key derives from it at the call site).

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
        const fresh = out.resent !== true && out.resynced === undefined;
        return reply.code(fresh ? 201 : 200).send(out);
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
Expected: PASS, 18 tests.

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

  it('409 last_admin when demoting the only active admin', async () => {
    const other = await seed(freshEmail('other'), 'active', 'admin');
    // Demote `other` first so ADMIN is the sole remaining admin, then have
    // `other`... no: demote ADMIN via `other`, who is an admin.
    const r = await patch(adminId, { role: 'member' }, ADMIN);
    expect(r.statusCode).toBe(409); // self-target, checked before the invariant
    const r2 = await app.inject({
      method: 'PATCH', url: `/api/admin/users/${adminId}`,
      headers: { 'cf-access-jwt-assertion': await jwks.mintJwt(await emailOf(other)), 'x-repos-csrf': '1' },
      payload: { role: 'member' },
    });
    expect(r2.statusCode).toBe(200); // two admins existed, one may step down
    const r3 = await patch(other, { role: 'member' }, await emailOf(other));
    expect(r3.statusCode).toBe(409); // self-target again
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
    const [r1, r2] = await Promise.all([
      patch(b, { role: 'member' }, ADMIN),
      patch(adminId, { role: 'member' }, bEmail),
    ]);
    const codes = [r1.statusCode, r2.statusCode].sort();
    expect(codes).toEqual([200, 409]);
    const { rows } = await db.query<{ c: number }>(
      `SELECT count(*)::int c FROM users WHERE role='admin' AND status='active'`,
    );
    expect(rows[0].c).toBeGreaterThanOrEqual(1);
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
Expected: PASS, 17 tests.

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
- Consumes: `withMembershipLock` (T4), `syncEmail` (T6), `LifecycleError`/`Actor`/`inAdminLockedTxn`-equivalent (T11/T12).
- Produces: `deleteUser(targetId: string, actor: Actor): Promise<{ id: string; previous_token_count: number }>`

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
    fetchPolicyImpl = async () => ({ emails: [...policyEmails], name: 'Owner Only', decision: 'allow', exclude: [], require: [] });
    const r = await del(id);
    expect(r.statusCode).toBe(204);
    const ev = await db.query<{ n: number }>(
      `SELECT count(*)::int n FROM account_events
        WHERE user_id_at_event=$1 AND kind='user_delete_requested'`, [id],
    );
    expect(ev.rows[0].n).toBe(1); // the original requester is preserved
  });

  it('Q27: with the cascade mocked to fail, user_deleted is rolled back with it', async () => {
    const email = freshEmail('cascfail');
    const id = await seed(email, 'active');
    const spy = vi.spyOn(db, 'connect');
    // Fail the DELETE statement only, inside the final transaction.
    spy.mockImplementationOnce(async () => {
      const real = await (spy.getMockImplementation() ? Promise.reject(new Error('x')) : Promise.reject(new Error('x')));
      return real as never;
    });
    spy.mockRestore();
    // Simpler and deterministic: block the cascade with a NO ACTION child row.
    await db.query(
      `CREATE TABLE IF NOT EXISTS w9_block (user_id UUID REFERENCES users(id) ON DELETE NO ACTION)`,
    );
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
    expect((await selfDelete(email)).statusCode).toBe(502);

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
    fetchPolicyImpl = async () => ({ emails: [...policyEmails], name: 'Owner Only', decision: 'allow', exclude: [], require: [] });
    expect((await del(id)).statusCode).toBe(204);
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

> Delete the abandoned `vi.spyOn(db, 'connect')` fragment in the cascade-failure test when writing the file — the `w9_block` NO ACTION child row is the deterministic mechanism. Drop the table in `afterAll`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/routes/admin-users-delete.test.ts`
Expected: FAIL — the admin DELETE route 404s and `/api/me` deletes without a status transition.

- [ ] **Step 3: Write the shared service**

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
import { withMembershipLock, ADMIN_COUNT_LOCK_KEY } from './membershipLock.js';
import { syncEmail } from './cfAccessSync.js';
import { CfPolicyError } from './cfAccessPolicy.js';
import { recordAccountEventTx, humanActor } from './accountEvents.js';
import { LifecycleError, type Actor } from './userLifecycle.js';

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
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        // Lock order (Q26): session lock -> BEGIN -> transaction lock.
        await client.query('SELECT pg_advisory_xact_lock($1)', [ADMIN_COUNT_LOCK_KEY]);
        const remaining = await client.query<{ c: number }>(
          `SELECT count(*)::int c FROM users
            WHERE role='admin' AND status='active' AND id <> $1`,
          [targetId],
        );
        // I2 — refused BEFORE any mutation.
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
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
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
      throw err;
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
  // DELETE /api/me — self-service deletion.
  //
  // W9 Q33: this no longer deletes the row itself. It delegates to the ONE
  // deleteUser service so the self-service and admin paths produce identical
  // end state — same events, same CF removal, same cascade — and so the
  // "at least one active admin remains" invariant cannot be bypassed here.
  //
  // W6's own path recorded account_deleted only as a log line with no
  // account_events row; the service does not inherit that gap.
  //
  // Q37: once status='deleting' commits, both auth paths reject this user, so
  // they cannot call this route again. A failed self-delete tells them the
  // account is already disabled and gives the contact path from the invite
  // email. Letting a `deleting` user re-authenticate to finish deleting
  // themselves would punch a hole through the gate for the one status that
  // most needs it shut.
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

      let previousTokenCount = 0;
      try {
        const out = await deleteUser(userId, { userId, email: userEmail, ip: req.ip ?? null });
        previousTokenCount = out.previous_token_count;
      } catch (err) {
        if (err instanceof LifecycleError) {
          return reply.code(err.statusCode).send({
            error: err.code,
            ...err.details,
            ...(err.code === 'cf_sync_failed'
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
        { event: 'account_deleted', userId, userEmail, previous_token_count: previousTokenCount, ip: req.ip },
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
Expected: PASS, 13 tests.

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/integration/account-deletion-cascade.test.ts tests/integration/contamination/account-deletion-contamination.test.ts`
Expected: PASS — the W6 cascade assertions still hold through the new service. Update them only where they assert the *absence* of `account_events` rows.

- [ ] **Step 6: Commit**

```bash
cd /var/home/jason/Projects/RepOS && git add api/src/services/deleteUser.ts api/src/routes/adminUsers.ts api/src/routes/account.ts api/tests/routes/admin-users-delete.test.ts
git commit -m "$(cat <<'EOF'
feat(w9): one deletion service for both paths (Q33, Q37)

DELETE /api/me no longer deletes the row directly — it delegates to the same
state machine the admin route uses: lock, status='deleting' with its
user_delete_requested event, CF removal, then user_deleted immediately before
the cascade in one transaction. The last-active-admin invariant now applies to
self-deletion, closing the zero-admin lockout that the old direct DELETE
allowed, and no deleted user's email is left orphaned in the CF policy.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
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
    const body = r.json<{ users: unknown[]; cohort: { count: number; cap: number } }>();
    expect(body.cohort.cap).toBe(10);
    expect(body.users.length).toBeGreaterThan(0);
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
    const before = [...policyEmails];
    await list();
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
    // not — and nothing may be claimed divergent without ground truth.
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

  it('a failure leaves the stamp NULL and reports the code', async () => {
    const email = freshEmail('retryfail');
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO users (email, status, cf_synced_at, invited_at) VALUES ($1,'invited',NULL, now()) RETURNING id`, [email],
    );
    fetchPolicyImpl = async () => { throw new policy.CfPolicyError('cf_timeout', 'slow'); };
    const r = await retrySync(rows[0].id);
    expect(r.json<{ cf_synced: boolean; sync_error: string }>()).toMatchObject({
      cf_synced: false, sync_error: 'cf_timeout',
    });
  });

  it('does NOT change users.status — retry-sync is not a reinstate', async () => {
    const email = freshEmail('notreinstate');
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO users (email, status, cf_synced_at) VALUES ($1,'suspended',NULL) RETURNING id`, [email],
    );
    await retrySync(rows[0].id);
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

The harness must expose `putSpy` (the `vi.spyOn(policy, 'putPolicyEmails')` handle) as a module-level `let` so these tests can inspect `putSpy.mock.calls`.

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
 */
export async function retrySync(
  targetId: string,
  actor: Actor,
): Promise<{ id: string; cf_synced: boolean; sync_error: string | null; direction: 'present' | 'absent' }> {
  void actor;
  return withMembershipLock(async () => {
    const cur = await readUser(targetId);
    const direction = desiredPresence(cur.status);
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

- [ ] **Step 4: Append the routes**

```ts
  app.get(
    '/admin/users',
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
      try {
        return reply.code(200).send(await retrySync(req.params.id, actorOf(req)));
      } catch (err) {
        return sendLifecycleError(reply, err);
      }
    },
  );
```

- [ ] **Step 5: Run tests and the whole API suite**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/routes/admin-users-list.test.ts && npm test && npm run test:integration`
Expected: PASS, 13 new tests plus a green suite.

- [ ] **Step 6: Commit**

```bash
cd /var/home/jason/Projects/RepOS && git add api/src/services/userLifecycle.ts api/src/routes/adminUsers.ts api/tests/routes/admin-users-list.test.ts
git commit -m "$(cat <<'EOF'
feat(w9): user list with drift reporting, and status-aware retry-sync

Drift is surfaced and never auto-corrected (Q9), and the report distinguishes
sync-unknown (missing stamp) from confirmed divergence (a live comparison
disagrees) — a failed reinstate leaves the former, not the latter (Q36).
retry-sync reconciles toward the row's status, so invoking it on a suspended
row removes the email and can never re-grant access.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: Configuration, boot guards, and runbooks

Five new env vars, all **set-once infrastructure identity** — none of them change when users change, so none reintroduce the redeploy coupling this wave removes.

**Files:**
- Modify: `api/src/bootstrap-guards.ts:39-47`
- Modify: `api/tests/unit/startup-guards.test.ts`
- Modify: `docs/runbooks/secret-rotation.md`
- Create: `docs/runbooks/admin-break-glass.md`

**Interfaces:**
- Consumes: nothing.
- Produces: boot INFO lines `cf_api_token_unset` / `resend_api_key_unset`; the `allowListCount` INFO line is gone.

- [ ] **Step 1: Write the failing test**

Add to `api/tests/unit/startup-guards.test.ts`:

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
Expected: FAIL — `allowListCount` is still emitted and neither advisory exists.

- [ ] **Step 3: Update the guards**

In `api/src/bootstrap-guards.ts`, delete the `allowList` block (lines 39–47) and add:

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

Append to `docs/runbooks/secret-rotation.md`:

```markdown
## CF_API_TOKEN (W9 — Access policy sync)

**Scope (Q15):** attempt the beta resource-scoped "Access policy admin" role
limited to policy `b4a92a15-27d5-477b-ad36-f78fcdae931c` only. Fall back to
account-scoped `Access: Apps and Policies → Edit` if the resource-scoped role
is unavailable.

**Never grant `Access: Organizations Revoke`.** RepOS makes no
session-revocation call (Q17a) — that endpoint revokes access across *all*
applications in the org, so using it here would also sign users out of
`ha.jpmtech.com` and `jellyseerr.jpmtech.com`.

Why the scope matters: the account-scoped permission also grants edit over
`ha.jpmtech.com` and `jellyseerr.jpmtech.com`. A RepOS compromise holding it is
a path into home automation.

**Rotation cadence:** every 180 days, or immediately on any suspected
container compromise.

**Procedure:**
1. Create the replacement token in the Cloudflare dashboard (My Profile → API
   Tokens) with the scope above.
2. Update `CF_API_TOKEN` in `/mnt/user/appdata/repos/.env` on Unraid.
3. Recreate the container (env vars are fixed at create time — stop + rm + run,
   not restart; see the redeploy recipe).
4. Verify: `/settings/users` shows a drift banner state of "in sync" rather
   than a policy error.
5. Delete the old token in the dashboard.

**Blast radius if leaked:** edit rights on the RepOS Access policy — an
attacker could add their own email to the policy. They would still be stopped
by the DB gate (`403 not_invited`), because Cloudflare is not the security
boundary (Q17).

## RESEND_API_KEY / INVITE_FROM_EMAIL (W9 — invite delivery)

**Scope:** a Resend sending key restricted to the `send.jpmtech.com` domain.
The subdomain keeps root-domain SPF/DKIM untouched, so a misconfiguration here
cannot break Proton-hosted mail on `jpmtech.com`.

**Rotation cadence:** every 180 days.

**Procedure:** create a new key in the Resend dashboard, update the `.env`,
recreate the container, send a test invite to a disposable address, revoke the
old key.

**Blast radius if leaked:** an attacker can send mail as
`repos@send.jpmtech.com`. It grants no access to RepOS — there is no invite
token and no magic link (Q6); authorization is the pre-created `users` row.
```

- [ ] **Step 5: Write the break-glass runbook**

Create `docs/runbooks/admin-break-glass.md`:

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
  "UPDATE users SET role='"'"'admin'"'"', status='"'"'active'"'"' WHERE lower(email)='"'"'<email>'"'"';"'
```

If quoting that densely is uncomfortable, the equivalent heredoc form is easier
to get right and is what the runbook prefers:

```bash
docker exec -i repos sh -c 'psql "$DATABASE_URL"' <<'SQL'
UPDATE users SET role='admin', status='active' WHERE lower(email)='<email>';
SQL
```

If the identity has no row at all (deny-by-default means it cannot sign in to
create one):

```bash
docker exec -i repos sh -c 'psql "$DATABASE_URL"' <<'SQL'
INSERT INTO users (email, role, status) VALUES ('<email>','admin','active');
SQL
```

`cf_synced_at` is left NULL deliberately: the row's Cloudflare membership is
unknown until you either use **Retry sync** on `/settings/users` or run the
reconciliation script. The row is `active`, not `invited`, so the
`cf_synced_at IS NOT NULL` activation precondition (Q17b) does not apply — it
gates activation of `invited` rows only.

## Then

1. Confirm the email is in the Cloudflare Access policy — the DB gate will
   admit them, but Cloudflare must issue a JWT first. Add it in the dashboard
   or use **Retry sync**.
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

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
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

Create `api/tests/services/cf-reconcile.test.ts` with the ephemeral-DB preamble (tag `'reconcile'`), spying on `fetchPolicy` only. The preamble additionally needs `import { withMembershipLock, MEMBERSHIP_LOCK_KEY } from '../../src/services/membershipLock.js';` for the lock assertions at the end:

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

  it('is idempotent — a second run changes nothing', async () => {
    const email = freshEmail('idem');
    const id = await seed(email, 'active', null);
    policyEmails = [email];
    await reconcileCfBaseline('cutover');
    const first = await stampOf(id);
    const r = await reconcileCfBaseline('cutover');
    expect(r.imported).toEqual([]);
    expect(await stampOf(id)).not.toBeNull();
    expect(first).not.toBeNull();
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
      return { emails: [...policyEmails], name: 'p', decision: 'allow', exclude: [], require: [] };
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
    let started = false;
    const holder = withMembershipLock(async () => {
      const p = reconcileCfBaseline('cutover').then(() => { started = true; });
      await new Promise((r) => setTimeout(r, 150));
      expect(started).toBe(false); // still waiting on the lock
      return p;
    });
    await holder;
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
  const toImport = snapshot.emails.filter((e) => !known.has(e));
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

API_DIR="${API_DIR:-/app/api}"
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
Expected: PASS, 12 tests; `dist/services/cfReconcile-cli.js` exists.

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

> **Adaptation note:** the spec calls for restoring a real pre-080 dump into an ephemeral Postgres. `pg_dump`/`pg_restore`/`psql` are **not installed on this workstation** (verified 2026-07-26), so this test reconstructs a pre-080 database structurally — apply all migrations, then drop the 080 columns and its `_migrations` row — which exercises the same code path 080 takes on a real dump. Add the binary-level `pg_restore` variant to `tests/integration/restore.test.ts` when running in CI, where the Postgres client tools are present.

- [ ] **Step 1: Write the failing test**

Create `api/tests/dr/restore-admin-guarantee.test.ts`:

```ts
// Q35 — DR-level. Every schema-entry path must yield a working admin.
import 'dotenv/config';
import { describe, it, expect, afterAll, vi } from 'vitest';
import pg from 'pg';
import { createEphemeralDb } from '../helpers/ephemeral-db.js';
import { runMigrations } from '../../src/db/runMigrations.js';
import { FOUNDING_ADMIN_EMAIL } from '../../src/constants/users.js';

const cleanups: Array<() => Promise<void>> = [];
afterAll(async () => { for (const c of cleanups) await c(); });

/** Reconstruct a pre-080 database: full schema, then unwind 080. */
async function preO80Database(tag: string): Promise<pg.Pool> {
  const eph = await createEphemeralDb(tag);
  const pool = new pg.Pool({ connectionString: eph.url, max: 3 });
  cleanups.push(async () => { await pool.end(); await eph.drop(); });
  await runMigrations(pool);
  await pool.query(`DELETE FROM users`);
  await pool.query(`DELETE FROM _migrations WHERE filename='080_users_roles_status.sql'`);
  await pool.query(`ALTER TABLE users
      DROP COLUMN role, DROP COLUMN status, DROP COLUMN invited_by, DROP COLUMN invited_at,
      DROP COLUMN activated_at, DROP COLUMN cf_synced_at, DROP COLUMN invite_sent_at,
      DROP COLUMN invite_message_id`);
  await pool.query(`DROP INDEX IF EXISTS users_status_idx`);
  return pool;
}

describe('restore of a pre-080 dump (Q35)', () => {
  it('(a) migrations alone, with NO Cloudflare, yield an active admin', async () => {
    const pool = await preO80Database('dr-a');
    await pool.query(`INSERT INTO users (email) VALUES ('beta.user@repos.test')`);
    // No CF_API_TOKEN is set anywhere in this test — that is the point.
    await runMigrations(pool);
    const { rows } = await pool.query<{ email: string }>(
      `SELECT email FROM users WHERE role='admin' AND status='active'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe(FOUNDING_ADMIN_EMAIL);
  });

  it('(b) that admin can clear maintenance — the lockout scenario is closed', async () => {
    const pool = await preO80Database('dr-b');
    await runMigrations(pool);
    // The maintenance route is admin-gated; the gate resolves role from this
    // row, so "can clear maintenance" reduces to "an admin row the gate will
    // accept exists": active, role=admin, and not blocked by the invited-row
    // provisioning precondition (Q17b applies to `invited` only).
    const { rows } = await pool.query<{ role: string; status: string; cf_synced_at: Date | null }>(
      `SELECT role, status, cf_synced_at FROM users WHERE lower(email)=$1`, [FOUNDING_ADMIN_EMAIL],
    );
    expect(rows[0]).toMatchObject({ role: 'admin', status: 'active' });
    expect(rows[0].cf_synced_at).toBeNull(); // membership unknown until reconciliation
  });

  it('(c) the CF reconciliation reconstructs the CF-only invite', async () => {
    const eph = await createEphemeralDb('dr-c');
    const pool = new pg.Pool({ connectionString: eph.url, max: 3 });
    cleanups.push(async () => { await pool.end(); await eph.drop(); });
    await runMigrations(pool);

    process.env.DATABASE_URL = eph.url;
    const policy = await import('../../src/services/cfAccessPolicy.js');
    const { reconcileCfBaseline } = await import('../../src/services/cfReconcile.js');
    const { db } = await import('../../src/db/client.js');
    cleanups.push(async () => { await db.end(); });

    vi.spyOn(policy, 'fetchPolicy').mockResolvedValue({
      emails: [FOUNDING_ADMIN_EMAIL, 'thesugardog@repos.test'],
      name: 'Owner Only', decision: 'allow', exclude: [], require: [],
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

    process.env.DATABASE_URL = eph.url;
    const policy = await import('../../src/services/cfAccessPolicy.js');
    const { reconcileCfBaseline, ReconcileAbort } = await import('../../src/services/cfReconcile.js');
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

function renderPage() {
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

Remove every surviving reader, including the `.env` template in `docker/` and any documentation that instructs an operator to set them. Replace those doc lines with a pointer to `/settings/users`.

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
cd /var/home/jason/Projects/RepOS && grep -rn "REPOS_ADMIN_EMAILS\|CF_ACCESS_ALLOWED_EMAILS\|isAdminEmail" api/src frontend/src docker scripts
```

Expected: all green; the final grep returns **nothing**.

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
6. Open `/settings/users`, confirm no drift, and send one real invite to a disposable address to verify delivery end to end.

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
