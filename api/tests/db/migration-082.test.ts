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
  cleanups.push(async () => {
    await pool.end();
    await eph.drop();
  });
  await runMigrations(pool);
});

afterAll(async () => {
  for (const c of cleanups) await c();
});

/** A row whose stamp is already set — the state that makes the guard meaningful. */
async function seed(status: string, stamped = true): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (email, role, status, cf_synced_at)
     VALUES ($1,'member',$2,$3) RETURNING id`,
    [`m082.${randomUUID().slice(0, 8)}@repos.test`, status, stamped ? new Date() : null],
  );
  return rows[0].id;
}

async function userColumns(p: pg.Pool): Promise<string[]> {
  const { rows } = await p.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name='users' ORDER BY column_name`,
  );
  return rows.map((r) => r.column_name);
}

async function stampOf(id: string): Promise<Date | null> {
  const { rows } = await pool.query<{ cf_synced_at: Date | null }>(
    `SELECT cf_synced_at FROM users WHERE id=$1`,
    [id],
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
    await expect(pool.query(`UPDATE users SET status=$2 WHERE id=$1`, [id, to])).rejects.toThrow(
      /Q24/,
    );
    // the statement is rejected, so the row is untouched
    const { rows } = await pool.query<{ status: string }>(`SELECT status FROM users WHERE id=$1`, [
      id,
    ]);
    expect(rows[0].status).toBe(from);
  });

  // absence -> presence
  it.each([
    ['suspended', 'active'],
    ['deleting', 'active'],
    ['suspended', 'invited'],
  ])('REJECTS %s -> %s while cf_synced_at is still set', async (from, to) => {
    const id = await seed(from);
    await expect(pool.query(`UPDATE users SET status=$2 WHERE id=$1`, [id, to])).rejects.toThrow(
      /Q24/,
    );
  });

  it('ALLOWS a crossing transition that clears the stamp in the same statement', async () => {
    const id = await seed('suspended');
    await pool.query(`UPDATE users SET status='active', cf_synced_at=NULL WHERE id=$1`, [id]);
    expect(await stampOf(id)).toBeNull();
  });

  it('ALLOWS the break-glass promotion exactly as the runbook writes it', async () => {
    const id = await seed('deleting');
    const { rows } = await pool.query<{ email: string }>(`SELECT email FROM users WHERE id=$1`, [
      id,
    ]);
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
  // against a schema missing something it believes is present — silently.
  //
  // The expected set is DISCOVERED from the migration runner's own output, not
  // read from W9_MIGRATIONS. An earlier version of this test asserted the
  // constant against itself: `unwindToPreW9` deletes the rows named by
  // W9_MIGRATIONS and the test then required exactly those names back, so
  // removing an entry shrank the requirement in lockstep and the test still
  // passed. Verified — deleting '081_invite_request.sql' from the constant left
  // this file 15/15 green. **A list the subject also reads cannot audit the
  // subject.**
  it('unwindToPreW9 re-arms every W9 migration, and the trigger comes back live', async () => {
    const eph = await createEphemeralDb('m082unwind');
    const p2 = new pg.Pool({ connectionString: eph.url, max: 3 });
    cleanups.push(async () => {
      await p2.end();
      await eph.drop();
    });

    // Independent source of truth: what the runner actually applies in the
    // 080–089 range on a fresh database.
    //
    // The 08x range is NOT W9's alone. W9 was built on a local branch while
    // `main` independently shipped 080_exercise_guides.sql and
    // 081_users_beta_disclaimer.sql, so both numbers exist twice. The range is
    // therefore no longer a proxy for "W9's migrations" and has to be narrowed
    // by an explicit exclusion list rather than by the number.
    //
    // Exclusion, not enumeration (the W9 sweep lesson): anything new in the
    // range lands in `w9Range` by default and fails the equality below, which
    // forces a deliberate choice — extend the unwind helper if it IS W9's, or
    // list it here if it is not. The failure direction is a loud false alarm,
    // never a silent blind spot.
    const NON_W9_08X = ['080_exercise_guides.sql', '081_users_beta_disclaimer.sql'];
    const firstRun = await runMigrations(p2);
    const range08x = firstRun.filter((f) => /^08\d_/.test(f)).sort();
    // The exclusion list must stay honest too: a name that no longer exists
    // means someone renamed a migration and left this list describing nothing.
    for (const f of NON_W9_08X) expect(range08x, `${f} missing from the 08x range`).toContain(f);
    const discovered = range08x.filter((f) => !NON_W9_08X.includes(f));
    expect(discovered.length).toBeGreaterThan(0);
    // Pins the constant against reality. Add 083 without listing it here and
    // this fails, which is the whole point.
    expect(discovered).toEqual([...W9_MIGRATIONS].sort());
    const columnsBefore = await userColumns(p2);

    await unwindToPreW9(p2);
    for (const col of W9_USER_COLUMNS) {
      const { rows } = await p2.query<{ n: number }>(
        `SELECT count(*)::int n FROM information_schema.columns
          WHERE table_name='users' AND column_name=$1`,
        [col],
      );
      expect(rows[0].n, `${col} should be gone after the unwind`).toBe(0);
    }

    const applied = await runMigrations(p2);
    for (const m of discovered) expect(applied).toContain(m);
    // Independent of both constants: unwind + reapply must round-trip the
    // schema exactly, so a column dropped but never restored is caught here.
    expect(await userColumns(p2)).toEqual(columnsBefore);

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
