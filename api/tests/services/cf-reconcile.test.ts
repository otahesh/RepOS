// W9 Q31/Q35 — reconcile the DB against the live Cloudflare Access policy, at
// cutover and again on every restore.
//
// Ephemeral DB: reconciliation reads and rewrites the WHOLE users table, so
// this suite cannot share the dev database.
import 'dotenv/config';
import { describe, it, expect, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createEphemeralDb } from '../helpers/ephemeral-db.js';
import { runMigrations } from '../../src/db/runMigrations.js';
import pg from 'pg';

const eph = await createEphemeralDb('reconcile');
{
  const bootstrap = new pg.Pool({ connectionString: eph.url, max: 2 });
  await runMigrations(bootstrap);
  await bootstrap.end();
}
process.env.DATABASE_URL = eph.url;

// Every one of these pulls in src/db/client.js transitively, so they must be
// dynamic imports AFTER DATABASE_URL is repointed — including membershipLock,
// which the plan listed as a static import.
const { db } = await import('../../src/db/client.js');
const policy = await import('../../src/services/cfAccessPolicy.js');
const { reconcileCfBaseline } = await import('../../src/services/cfReconcile.js');
const { withMembershipLock, MEMBERSHIP_LOCK_KEY } = await import(
  '../../src/services/membershipLock.js'
);

let policyEmails: string[];
let fetchPolicyImpl: () => Promise<unknown>;
// Exposed so the "does not grant access" case can assert on the PUT itself
// rather than on its side effect.
let putSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.restoreAllMocks();
  policyEmails = [];
  fetchPolicyImpl = async () => ({
    emails: [...policyEmails],
    name: 'Owner Only',
    decision: 'allow',
    config: {
      name: 'Owner Only',
      decision: 'allow',
      include: policyEmails.map((e) => ({ email: { email: e } })),
      exclude: [],
      require: [],
    },
  });
  vi.spyOn(policy, 'fetchPolicy').mockImplementation(() => fetchPolicyImpl() as never);
  putSpy = vi.spyOn(policy, 'putPolicyEmails').mockImplementation(async (emails: string[]) => {
    policyEmails = [...emails];
  }) as never;
});

afterAll(async () => {
  await db.end();
  await eph.drop();
});

function freshEmail(tag: string) {
  return `rc-${tag}-${randomUUID().slice(0, 8)}@repos.test`;
}

async function seed(email: string, status: string, stamp: Date | null): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO users (email, status, cf_synced_at) VALUES ($1,$2,$3) RETURNING id`,
    [email, status, stamp],
  );
  return rows[0].id;
}

async function stampOf(id: string) {
  const { rows } = await db.query<{ cf_synced_at: Date | null }>(
    'SELECT cf_synced_at FROM users WHERE id=$1',
    [id],
  );
  return rows[0].cf_synced_at;
}

// Ask Postgres directly rather than trusting an in-process flag, which is the
// whole point of using an advisory lock.
async function membershipLockIsHeld(): Promise<boolean> {
  const { rows } = await db.query<{ c: number }>(
    `SELECT count(*)::int c FROM pg_locks
      WHERE locktype = 'advisory' AND objid = $1 AND granted`,
    [MEMBERSHIP_LOCK_KEY],
  );
  return rows[0].c > 0;
}

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
    // Deviation from the plan: its version seeded the row FIRST, so `imported`
    // was [] on both runs and the assertion could not tell a working
    // already-known check from a missing one. Importing on run 1 and asserting
    // run 2 imports nothing is what makes the case discriminating — without
    // the `known` filter run 2 raises a unique violation on users.email.
    const email = freshEmail('idem');
    policyEmails = [email];
    const first = await reconcileCfBaseline('cutover');
    expect(first.imported).toEqual([email]);
    const { rows } = await db.query<{ id: string }>(`SELECT id FROM users WHERE email=$1`, [email]);
    const id = rows[0].id;
    const firstStamp = await stampOf(id);
    expect(firstStamp).not.toBeNull();

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
      status: string;
      cf_synced_at: Date | null;
      invited_at: Date | null;
      invited_by: string | null;
      invite_sent_at: Date | null;
    }>(
      `SELECT status, cf_synced_at, invited_at, invited_by, invite_sent_at
         FROM users WHERE email=$1`,
      [email],
    );
    expect(rows[0].status).toBe('invited'); // first sign-in emits user_activated like any invitee
    expect(rows[0].cf_synced_at).not.toBeNull();
    expect(rows[0].invited_at).not.toBeNull(); // Q30's key derives from this
    expect(rows[0].invited_by).toBeNull();
    expect(rows[0].invite_sent_at).toBeNull(); // granted out of band; already told
  });

  it('writes exactly one user_imported event with the SYSTEM actor, in the same txn as the row', async () => {
    const email = 'imported.actor@repos.test';
    policyEmails = [email];
    await reconcileCfBaseline('cutover');
    const {
      rows: [u],
    } = await db.query<{ id: string }>(`SELECT id FROM users WHERE email=$1`, [email]);
    const ev = await db.query<{ kind: string; meta: Record<string, unknown> }>(
      `SELECT kind, meta FROM account_events WHERE user_id=$1`,
      [u.id],
    );
    expect(ev.rows).toHaveLength(1);
    expect(ev.rows[0].kind).toBe('user_imported'); // distinct kind: no invitation was sent
    expect(ev.rows[0].meta).toMatchObject({
      actor_kind: 'system',
      actor_name: 'cf_reconciliation',
      source: 'cutover',
    });
    expect(ev.rows[0].meta.actor_user_id).toBeUndefined();
  });

  it('a run during RESTORE records source=restore, not cutover (Q23 round 7)', async () => {
    const email = 'restore.sourced@repos.test';
    policyEmails = [email];
    await reconcileCfBaseline('restore');
    const {
      rows: [u],
    } = await db.query<{ id: string }>(`SELECT id FROM users WHERE email=$1`, [email]);
    const ev = await db.query<{ meta: Record<string, unknown> }>(
      `SELECT meta FROM account_events WHERE user_id=$1`,
      [u.id],
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
    // The happy-path row/event pair proves nothing about atomicity: moving
    // COMMIT ahead of recordAccountEventTx left all fifteen original cases
    // green, because both rows exist either way. Rejecting the event AT THE
    // DATABASE is what forces the question — the imported row must not survive
    // a missing audit record.
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
    // Cloudflare's include[] has no uniqueness constraint and toSnapshot
    // flattens it in policy order without deduplicating. Nine existing cohort
    // rows is the discriminating fixture: off the raw array the cap check read
    // 9 + 2 = 11 and aborted, and with the cap lifted the second INSERT broke
    // on users_email_key instead.
    await db.query(`DELETE FROM users`);
    for (let i = 0; i < 9; i++) {
      await db.query(`INSERT INTO users (email, status) VALUES ($1,'active')`, [
        freshEmail(`c${i}`),
      ]);
    }
    const email = 'dupe.selector@repos.test';
    policyEmails = [email, email];

    const r = await reconcileCfBaseline('cutover');

    expect(r.imported).toEqual([email]);
    const { rows } = await db.query(`SELECT id FROM users WHERE email=$1`, [email]);
    expect(rows).toHaveLength(1);
    const {
      rows: [c],
    } = await db.query<{ c: number }>(
      `SELECT count(*)::int c FROM users WHERE status IN ('active','invited','deleting')`,
    );
    expect(c.c).toBe(10); // nine existing plus exactly one import — not an abort at 11
  });
});

describe('it aborts rather than importing from a broadened policy', () => {
  it('Q10: app_count !== 1', async () => {
    fetchPolicyImpl = async () => {
      throw new policy.CfPolicyError('app_count_not_one', 'two');
    };
    await expect(reconcileCfBaseline('cutover')).rejects.toMatchObject({
      code: 'app_count_not_one',
    });
  });

  it('Q22: a non-email selector', async () => {
    fetchPolicyImpl = async () => {
      throw new policy.CfPolicyError('non_email_selector', 'everyone');
    };
    await expect(reconcileCfBaseline('cutover')).rejects.toMatchObject({
      code: 'non_email_selector',
    });
  });

  it('Q12: the import would carry the cohort past the cap — nothing is imported', async () => {
    await db.query(`DELETE FROM users`);
    for (let i = 0; i < 10; i++) {
      await db.query(`INSERT INTO users (email, status) VALUES ($1,'active')`, [
        freshEmail(`f${i}`),
      ]);
    }
    policyEmails = ['overflow@repos.test'];
    await expect(reconcileCfBaseline('cutover')).rejects.toMatchObject({
      code: 'cohort_cap_reached',
    });
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
        emails: [...policyEmails],
        name: 'p',
        decision: 'allow',
        config: {
          name: 'p',
          decision: 'allow',
          include: policyEmails.map((e) => ({ email: { email: e } })),
          exclude: [],
          require: [],
        },
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
    const acquired = new Promise<void>((r) => {
      signalAcquired = r;
    });
    let release!: () => void;
    const releaseHolder = new Promise<void>((r) => {
      release = r;
    });

    const holder = withMembershipLock(async () => {
      signalAcquired();
      await releaseHolder;
    });
    await acquired; // deterministic: the holder owns the lock before we race it

    let started = false;
    const run = reconcileCfBaseline('cutover').then(() => {
      started = true;
    });

    await new Promise((r) => setTimeout(r, 150));
    expect(started).toBe(false); // still waiting on the lock

    release();
    await holder;
    await run;
    expect(started).toBe(true);
  });
});
