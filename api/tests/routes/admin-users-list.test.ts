// Q9, Q34, Q36 — the user list, its drift report, and status-aware retry-sync.
//
// Ephemeral DB: the drift report reads the WHOLE users table and compares it
// against the policy, so this suite cannot share the dev database.
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createEphemeralDb } from '../helpers/ephemeral-db.js';
import { runMigrations } from '../../src/db/runMigrations.js';
import pg from 'pg';

const eph = await createEphemeralDb('list');
{
  const bootstrap = new pg.Pool({ connectionString: eph.url, max: 2 });
  await runMigrations(bootstrap);
  await bootstrap.end();
}
process.env.DATABASE_URL = eph.url;

const { buildApp } = await import('../../src/app.js');
const { db } = await import('../../src/db/client.js');
const policy = await import('../../src/services/cfAccessPolicy.js');
const { setupTestJwks } = await import('../helpers/cf-access-jwt.js');

let app: Awaited<ReturnType<typeof buildApp>>;
let jwks: Awaited<ReturnType<typeof setupTestJwks>>;
const ADMIN = 'admin.list@repos.test';
let adminId: string;

let policyEmails: string[];
let fetchPolicyImpl: () => Promise<unknown>;
// Exposed so the Q9 no-auto-heal case can assert on the PUTs themselves rather
// than on their side effects. beforeEach re-creates it, so `mock.calls` is
// always scoped to the current test.
let putSpy: ReturnType<typeof vi.spyOn>;
// The self-target case proves no CF work happened at all, which means proving
// the policy was never even READ — a guard that ran after fetchPolicy would
// still be a guard, but not the one Q13 asks for.
let fetchSpy: ReturnType<typeof vi.spyOn>;

// PUBLIC_ORIGIN is not in api/.env, and csrfOrigin fails CLOSED without it —
// before it ever looks at the X-RepOS-CSRF header — so every retry-sync below
// would 403 for a reason unrelated to drift. Same trap as the invite, patch and
// delete suites.
const savedEnv: Record<string, string | undefined> = {};
function setEnv(key: string, value: string): void {
  savedEnv[key] = process.env[key];
  process.env[key] = value;
}

beforeAll(async () => {
  setEnv('PUBLIC_ORIGIN', 'https://repos.list.test');
  jwks = await setupTestJwks();
  app = await buildApp();
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO users (email, role, status, cf_synced_at)
     VALUES ($1,'admin','active', now()) RETURNING id`,
    [ADMIN],
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

beforeEach(async () => {
  vi.restoreAllMocks();
  policyEmails = [ADMIN];
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
  fetchSpy = vi
    .spyOn(policy, 'fetchPolicy')
    .mockImplementation(() => fetchPolicyImpl() as never) as never;
  putSpy = vi.spyOn(policy, 'putPolicyEmails').mockImplementation(async (emails: string[]) => {
    policyEmails = [...emails];
  }) as never;
});

function freshEmail(tag: string) {
  return `lt-${tag}-${randomUUID().slice(0, 8)}@repos.test`;
}

async function list() {
  return app.inject({
    method: 'GET',
    url: '/api/admin/users',
    headers: { 'cf-access-jwt-assertion': await jwks.mintJwt(ADMIN) },
  });
}

async function retrySync(id: string) {
  return app.inject({
    method: 'POST',
    url: `/api/admin/users/${id}/retry-sync`,
    headers: { 'cf-access-jwt-assertion': await jwks.mintJwt(ADMIN), 'x-repos-csrf': '1' },
  });
}

describe('GET /api/admin/users', () => {
  it('returns rows, the cohort count and the cap', async () => {
    const r = await list();
    expect(r.statusCode).toBe(200);
    const body = r.json<{
      users: Array<{ email: string }>;
      cohort: { count: number; cap: number };
    }>();
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
    const body = (await list()).json<{
      users: Array<{ email: string; invited_by_email: string | null }>;
    }>();
    expect(body.users.find((u) => u.email === invited)!.invited_by_email).toBe(ADMIN);
  });

  it('Q36: a NULL stamp whose membership AGREES is UNKNOWN, not divergence', async () => {
    const email = freshEmail('unknown');
    // suspended + absent from the policy = what we want; only the stamp is
    // outstanding, so there is nothing for an operator to act on but a retry.
    await db.query(`INSERT INTO users (email, status, cf_synced_at) VALUES ($1,'suspended',NULL)`, [
      email,
    ]);
    const body = (await list()).json<{
      drift: { unknown: string[]; divergent: Array<{ email: string }> };
    }>();
    expect(body.drift.unknown).toContain(email);
    expect(body.drift.divergent.map((d) => d.email)).not.toContain(email);
  });

  // The regression this pair guards: a NULL stamp used to suppress the live
  // comparison entirely, so a half-applied suspend — DB committed, CF removal
  // failed — reported "sync pending" while the user was still in the policy.
  it('a NULL stamp does NOT hide real divergence: suspended but still in policy', async () => {
    const email = freshEmail('nullsuspdiv');
    await db.query(`INSERT INTO users (email, status, cf_synced_at) VALUES ($1,'suspended',NULL)`, [
      email,
    ]);
    policyEmails.push(email);
    const body = (await list()).json<{
      drift: { unknown: string[]; divergent: Array<{ email: string; reason: string }> };
    }>();
    expect(body.drift.divergent).toContainEqual({ email, reason: 'in_policy_unexpected' });
    expect(body.drift.unknown).not.toContain(email);
  });

  it('a NULL stamp does NOT hide real divergence: active but missing from policy', async () => {
    const email = freshEmail('nullactdiv');
    // Exactly the Q34 failed-reinstate resting state, which Q34 says should
    // "surface as drift" rather than read as merely pending.
    await db.query(`INSERT INTO users (email, status, cf_synced_at) VALUES ($1,'active',NULL)`, [
      email,
    ]);
    const body = (await list()).json<{
      drift: { unknown: string[]; divergent: Array<{ email: string; reason: string }> };
    }>();
    expect(body.drift.divergent).toContainEqual({ email, reason: 'missing_from_policy' });
    expect(body.drift.unknown).not.toContain(email);
  });

  it('reports a suspended row still present in the policy as divergent', async () => {
    const email = freshEmail('div');
    await db.query(
      `INSERT INTO users (email, status, cf_synced_at) VALUES ($1,'suspended', now())`,
      [email],
    );
    policyEmails.push(email);
    const body = (await list()).json<{
      drift: { divergent: Array<{ email: string; reason: string }> };
    }>();
    expect(body.drift.divergent).toContainEqual({ email, reason: 'in_policy_unexpected' });
  });

  it('reports an active row missing from the policy as divergent', async () => {
    const email = freshEmail('missing');
    await db.query(`INSERT INTO users (email, status, cf_synced_at) VALUES ($1,'active', now())`, [
      email,
    ]);
    const body = (await list()).json<{
      drift: { divergent: Array<{ email: string; reason: string }> };
    }>();
    expect(body.drift.divergent).toContainEqual({ email, reason: 'missing_from_policy' });
  });

  it('reports a policy email with no users row', async () => {
    policyEmails.push('stranger@repos.test');
    const body = (await list()).json<{
      drift: { divergent: Array<{ email: string; reason: string }> };
    }>();
    expect(body.drift.divergent).toContainEqual({
      email: 'stranger@repos.test',
      reason: 'in_policy_no_row',
    });
  });

  it('never auto-heals — the policy is untouched by a list call (Q9)', async () => {
    // Seed BOTH directions of divergence first, so the call has something it
    // could plausibly "fix". Against an already-correct policy this assertion
    // would hold for a service that auto-heals too.
    const stale = freshEmail('autoheal');
    await db.query(`INSERT INTO users (email, status, cf_synced_at) VALUES ($1,'suspended',NULL)`, [
      stale,
    ]);
    policyEmails.push(stale, 'ghost@repos.test');
    const before = [...policyEmails];
    const body = (await list()).json<{ drift: { divergent: unknown[] } }>();
    expect(body.drift.divergent.length).toBeGreaterThan(0);
    expect(policyEmails).toEqual(before);
    expect(putSpy).not.toHaveBeenCalled();
  });

  it('a policy refusal degrades to checked:false with the code, not a 500', async () => {
    fetchPolicyImpl = async () => {
      throw new policy.CfPolicyError('app_count_not_one', 'two');
    };
    const r = await list();
    expect(r.statusCode).toBe(200);
    const body = r.json<{
      drift: { checked: boolean; policy_error: string; unknown: string[]; divergent: unknown[] };
    }>();
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
      `INSERT INTO users (email, status, cf_synced_at) VALUES ($1,'suspended',NULL) RETURNING id`,
      [email],
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
      `INSERT INTO users (email, status, cf_synced_at, invited_at) VALUES ($1,'invited',NULL, now()) RETURNING id`,
      [email],
    );
    const r = await retrySync(rows[0].id);
    expect(r.json<{ direction: string }>().direction).toBe('present');
    expect(policyEmails).toContain(email);
    const u = await db.query<{ cf_synced_at: Date | null }>(
      `SELECT cf_synced_at FROM users WHERE id=$1`,
      [rows[0].id],
    );
    expect(u.rows[0].cf_synced_at).not.toBeNull();
  });

  it('is idempotent — a second call with the policy already correct issues no PUT', async () => {
    const email = freshEmail('idem');
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO users (email, status, cf_synced_at, invited_at) VALUES ($1,'invited',NULL, now()) RETURNING id`,
      [email],
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
       VALUES ($1,'invited', now() - interval '1 day', now()) RETURNING id`,
      [email],
    );
    fetchPolicyImpl = async () => {
      throw new policy.CfPolicyError('cf_timeout', 'slow');
    };
    const r = await retrySync(rows[0].id);
    expect(r.json<{ cf_synced: boolean; sync_error: string }>()).toMatchObject({
      cf_synced: false,
      sync_error: 'cf_timeout',
    });
    // cf_synced_at means "this row's intent IS reflected in the policy" (Q24).
    // After a failed reconciliation that claim is false, and leaving it set
    // also re-satisfies Q17b's activation precondition
    // (status='invited' AND cf_synced_at IS NOT NULL) for a row Cloudflare may
    // not have.
    const u = await db.query<{ cf_synced_at: Date | null }>(
      `SELECT cf_synced_at FROM users WHERE id=$1`,
      [rows[0].id],
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
      `INSERT INTO users (email, status, cf_synced_at) VALUES ($1,'suspended',NULL) RETURNING id`,
      [email],
    );
    // The 200 is load-bearing: without it this case passes against a service
    // that has no retry-sync at all, since a 404 also leaves the status alone.
    const r = await retrySync(rows[0].id);
    expect(r.statusCode).toBe(200);
    const u = await db.query<{ status: string }>(`SELECT status FROM users WHERE id=$1`, [
      rows[0].id,
    ]);
    expect(u.rows[0].status).toBe('suspended');
  });
});
