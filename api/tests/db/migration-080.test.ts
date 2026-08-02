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

/**
 * Unwind to a pre-080 schema so the next runMigrations re-arms 080's data step.
 *
 * Every migration that DEPENDS on 080's columns has to be unwound here too, or
 * the DROP fails — and if its `_migrations` row is left behind, the re-run
 * silently skips it and the test proceeds against a schema missing a guard it
 * believes is present. 082's trigger reads `users.status`, so it is dropped and
 * re-armed alongside 080. A partial unwind only ever proves the restore path
 * for the migrations someone remembered to remove.
 */
async function unwindTo079(pool: pg.Pool): Promise<void> {
  await pool.query(`DELETE FROM users`);
  await pool.query(`DROP TRIGGER IF EXISTS users_cf_stamp_guard ON users`);
  await pool.query(`DROP FUNCTION IF EXISTS users_cf_stamp_guard()`);
  await pool.query(
    `DELETE FROM _migrations WHERE filename IN
       ('080_users_roles_status.sql','082_cf_sync_stamp_guard.sql')`,
  );
  await pool.query(`ALTER TABLE users DROP COLUMN role, DROP COLUMN status,
                      DROP COLUMN invited_by, DROP COLUMN invited_at, DROP COLUMN activated_at,
                      DROP COLUMN cf_synced_at, DROP COLUMN invite_sent_at, DROP COLUMN invite_message_id`);
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
    await unwindTo079(pool);
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
    await unwindTo079(pool);
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
    await unwindTo079(pool);
    await pool.query(`DROP INDEX IF EXISTS users_status_idx`);
    await pool.query(`INSERT INTO users (email) VALUES ('legacy@repos.test')`);
    await runMigrations(pool);
    const { rows } = await pool.query<{ role: string; status: string }>(
      `SELECT role, status FROM users WHERE email='legacy@repos.test'`,
    );
    expect(rows[0]).toEqual({ role: 'member', status: 'active' });
  });
});
