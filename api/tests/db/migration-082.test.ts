// Q24 as a database invariant: `cf_synced_at` means "this row's intent is
// reflected in the CF policy", so any status change that ALTERS CF membership
// must clear it in the same statement.
//
// Why a trigger and not a static grep over `SET status=`: that check is both
// unsatisfiable and imprecise. `invited -> active` must PRESERVE the stamp
// (both statuses require policy presence), migration 080 promotes while the
// column it just added is still NULL, fixtures set status without modelling
// Cloudflare at all, and multiline/reordered/dynamic SQL evades text matching
// anyway. The membership groups are the real invariant, so the database
// enforces them.
//
//   presence group: active, invited    (address SHOULD be in the policy)
//   absence  group: suspended, deleting (address should NOT be)
//
// Crossing between groups changes membership intent; moving within one does not.
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { createEphemeralDb } from '../helpers/ephemeral-db.js';
import { unwindToPreW9, W9_MIGRATIONS, W9_USER_COLUMNS } from '../helpers/migration-unwind.js';
import { runMigrations } from '../../src/db/runMigrations.js';

let pool: pg.Pool;
const cleanups: Array<() => Promise<void>> = [];

beforeAll(async () => {
  const eph = await createEphemeralDb('m082');
  pool = new pg.Pool({ connectionString: eph.url, max: 3 });
  cleanups.push(async () => { await pool.end(); await eph.drop(); });
  await runMigrations(pool);
});

afterAll(async () => { for (const c of cleanups) await c(); });

/** A row whose stamp is already set — the state that makes the guard meaningful. */
async function seed(status: string, stamped = true): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (email, role, status, cf_synced_at)
     VALUES ($1,'member',$2,$3) RETURNING id`,
    [`m082.${randomUUID().slice(0, 8)}@repos.test`, status, stamped ? new Date() : null],
  );
  return rows[0].id;
}

async function stampOf(id: string): Promise<Date | null> {
  const { rows } = await pool.query<{ cf_synced_at: Date | null }>(
    `SELECT cf_synced_at FROM users WHERE id=$1`, [id],
  );
  return rows[0].cf_synced_at;
}

describe('migration 082 — cf_synced_at must be cleared when CF membership changes', () => {
  // presence -> absence
  it.each([
    ['active', 'suspended'],
    ['active', 'deleting'],
    ['invited', 'suspended'],
    ['invited', 'deleting'],
  ])('REJECTS %s -> %s while cf_synced_at is still set', async (from, to) => {
    const id = await seed(from);
    await expect(
      pool.query(`UPDATE users SET status=$2 WHERE id=$1`, [id, to]),
    ).rejects.toThrow(/Q24/);
    // the statement is rejected, so the row is untouched
    const { rows } = await pool.query<{ status: string }>(`SELECT status FROM users WHERE id=$1`, [id]);
    expect(rows[0].status).toBe(from);
  });

  // absence -> presence
  it.each([
    ['suspended', 'active'],
    ['deleting', 'active'],
    ['suspended', 'invited'],
  ])('REJECTS %s -> %s while cf_synced_at is still set', async (from, to) => {
    const id = await seed(from);
    await expect(
      pool.query(`UPDATE users SET status=$2 WHERE id=$1`, [id, to]),
    ).rejects.toThrow(/Q24/);
  });

  it('ALLOWS a crossing transition that clears the stamp in the same statement', async () => {
    const id = await seed('suspended');
    await pool.query(`UPDATE users SET status='active', cf_synced_at=NULL WHERE id=$1`, [id]);
    expect(await stampOf(id)).toBeNull();
  });

  it('ALLOWS the break-glass promotion exactly as the runbook writes it', async () => {
    const id = await seed('deleting');
    const { rows } = await pool.query<{ email: string }>(`SELECT email FROM users WHERE id=$1`, [id]);
    await pool.query(
      `UPDATE users SET role='admin', status='active', cf_synced_at=NULL WHERE lower(email)=$1`,
      [rows[0].email],
    );
    expect(await stampOf(id)).toBeNull();
  });

  // The control the guard must NOT catch. Activation is within the presence
  // group: an invited row is already in the policy, so its stamp stays valid.
  // Getting this wrong would break every first sign-in (Q17b/Q21).
  it('ALLOWS invited -> active and PRESERVES the stamp', async () => {
    const id = await seed('invited');
    const before = await stampOf(id);
    const res = await pool.query(
      `UPDATE users SET status='active', activated_at=now()
        WHERE id=$1 AND status='invited' AND cf_synced_at IS NOT NULL`,
      [id],
    );
    expect(res.rowCount).toBe(1);
    expect(await stampOf(id)).toEqual(before);
  });

  it('ALLOWS suspended -> deleting (both absent from the policy)', async () => {
    const id = await seed('suspended');
    const before = await stampOf(id);
    await pool.query(`UPDATE users SET status='deleting' WHERE id=$1`, [id]);
    expect(await stampOf(id)).toEqual(before);
  });

  it('ALLOWS a role-only change to keep its stamp', async () => {
    const id = await seed('active');
    const before = await stampOf(id);
    await pool.query(`UPDATE users SET role='admin' WHERE id=$1`, [id]);
    expect(await stampOf(id)).toEqual(before);
  });

  it('ALLOWS re-stamping after the crossing has committed (the two-statement shape)', async () => {
    const id = await seed('suspended');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE users SET status='active', cf_synced_at=NULL WHERE id=$1`, [id]);
      await client.query(`UPDATE users SET cf_synced_at=now() WHERE id=$1`, [id]);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    expect(await stampOf(id)).not.toBeNull();
  });

  // The guard on the guard. A partial unwind leaves a `_migrations` row behind,
  // the re-run skips that file, and every test built on the harness then runs
  // against a schema missing something it believes is present — silently. This
  // asserts the unwind is COMPLETE by naming all three W9 migrations and
  // requiring each to re-apply, so adding 083 without extending the helper
  // fails here rather than somewhere unrelated much later.
  it('unwindToPreW9 re-arms every W9 migration, and the trigger comes back live', async () => {
    const eph = await createEphemeralDb('m082unwind');
    const p2 = new pg.Pool({ connectionString: eph.url, max: 3 });
    cleanups.push(async () => { await p2.end(); await eph.drop(); });
    await runMigrations(p2);

    await unwindToPreW9(p2);
    for (const col of W9_USER_COLUMNS) {
      const { rows } = await p2.query<{ n: number }>(
        `SELECT count(*)::int n FROM information_schema.columns
          WHERE table_name='users' AND column_name=$1`, [col],
      );
      expect(rows[0].n, `${col} should be gone after the unwind`).toBe(0);
    }

    const applied = await runMigrations(p2);
    for (const m of W9_MIGRATIONS) expect(applied).toContain(m);

    // Re-applied, not merely recorded: the trigger enforces again.
    const { rows } = await p2.query<{ id: string }>(
      `INSERT INTO users (email, role, status, cf_synced_at)
       VALUES ('m082.unwind@repos.test','member','active',now()) RETURNING id`,
    );
    await expect(
      p2.query(`UPDATE users SET status='suspended' WHERE id=$1`, [rows[0].id]),
    ).rejects.toThrow(/Q24/);
  });

  it('rejects with a check_violation SQLSTATE, not a bare raise', async () => {
    const id = await seed('active');
    await expect(
      pool.query(`UPDATE users SET status='suspended' WHERE id=$1`, [id]),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
