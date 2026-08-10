// Q35 — every schema-entry path must yield exactly one active admin, with no
// Cloudflare dependency. Round-6 review finding 1: a genuinely EMPTY database
// has nothing to promote, so clause (3) inserts the founding row.
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, afterAll } from 'vitest';
import pg from 'pg';
import { createEphemeralDb } from '../helpers/ephemeral-db.js';
import { unwindToPreW9 } from '../helpers/migration-unwind.js';
import { runMigrations } from '../../src/db/runMigrations.js';
import { FOUNDING_ADMIN_EMAIL } from '../../src/constants/users.js';

const cleanups: Array<() => Promise<void>> = [];
afterAll(async () => {
  for (const c of cleanups) await c();
});

describe('the founding-admin literal is not duplicated by hand', () => {
  // The constant and the SQL each hold their own copy of the address, and
  // "keep them in sync" lived only in a comment. On 2026-08-09 they drifted:
  // the founding identity moved and 080 still named the old address, so on a
  // database without the old row clause (3) INSERTED a second admin rather
  // than promoting the real one. Every other case in this file runs the
  // migration and asserts against the CONSTANT, so all of them stayed green
  // through that drift — they cannot see it by construction. This one reads
  // the .sql text itself, which is the only thing that can.
  it('080_users_roles_status.sql declares exactly FOUNDING_ADMIN_EMAIL', () => {
    const sql = readFileSync(
      fileURLToPath(new URL('../../src/db/migrations/080_users_roles_status.sql', import.meta.url)),
      'utf8',
    );
    const declared = sql.match(/founding_email\s+CONSTANT\s+TEXT\s*:=\s*'([^']+)'/);
    expect(declared, 'the founding_email declaration was not found in 080').not.toBeNull();
    expect(declared![1]).toBe(FOUNDING_ADMIN_EMAIL);
  });
});

async function freshPool(tag: string): Promise<pg.Pool> {
  const eph = await createEphemeralDb(tag);
  const pool = new pg.Pool({ connectionString: eph.url, max: 3 });
  cleanups.push(async () => {
    await pool.end();
    await eph.drop();
  });
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
    const { rows } = await pool.query<{
      column_name: string;
      column_default: string | null;
      is_nullable: string;
    }>(
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
    const { rows } = await pool.query<{
      email: string;
      role: string;
      status: string;
      cf_synced_at: Date | null;
    }>(
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
    await pool.query(`INSERT INTO users (email) VALUES ($1), ('someone.else@repos.test')`, [
      FOUNDING_ADMIN_EMAIL,
    ]);

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
    await pool.query(
      `INSERT INTO users (email) VALUES ('beta.one@repos.test'), ('beta.two@repos.test')`,
    );

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
      `SELECT count(*)::int n FROM users WHERE lower(email)=$1`,
      [FOUNDING_ADMIN_EMAIL],
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
