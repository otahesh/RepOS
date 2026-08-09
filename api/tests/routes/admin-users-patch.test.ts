// Q13, Q17, Q24, Q26, Q28, Q34 — suspend, reinstate, role change.
//
// Ephemeral DB: the cohort cap and the last-admin invariant both count
// whole-table state, so this suite cannot share the dev database.
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createEphemeralDb } from '../helpers/ephemeral-db.js';
import { runMigrations } from '../../src/db/runMigrations.js';
import pg from 'pg';

const eph = await createEphemeralDb('patch');
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
const ADMIN = 'admin.patch@repos.test';
let adminId: string;

let policyEmails: string[];
let fetchPolicyImpl: () => Promise<unknown>;

// PUBLIC_ORIGIN is not in api/.env, and csrfOrigin fails CLOSED without it —
// before it ever looks at the X-RepOS-CSRF header — so every PATCH below would
// 403 with csrf_origin_misconfigured for a reason unrelated to the transition
// matrix. Same trap as the invite suite.
const savedEnv: Record<string, string | undefined> = {};
function setEnv(key: string, value: string): void {
  savedEnv[key] = process.env[key];
  process.env[key] = value;
}

beforeAll(async () => {
  setEnv('PUBLIC_ORIGIN', 'https://repos.patch.test');
  jwks = await setupTestJwks();
  app = await buildApp();
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO users (email, role, status) VALUES ($1,'admin','active') RETURNING id`,
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
  // Every case acts as ADMIN, so ADMIN must be an active admin at the start of
  // each one. Several cases deliberately demote or suspend admins, and vitest
  // gives no ordering guarantee worth relying on.
  await db.query(`UPDATE users SET role='admin', status='active' WHERE id=$1`, [adminId]);
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
  vi.spyOn(policy, 'fetchPolicy').mockImplementation(() => fetchPolicyImpl() as never);
  vi.spyOn(policy, 'putPolicyEmails').mockImplementation(async (emails: string[]) => {
    policyEmails = [...emails];
  });
});

function freshEmail(tag: string) {
  return `pt-${tag}-${randomUUID().slice(0, 8)}@repos.test`;
}

async function patch(id: string, body: Record<string, unknown>, asEmail = ADMIN) {
  return app.inject({
    method: 'PATCH',
    url: `/api/admin/users/${id}`,
    headers: { 'cf-access-jwt-assertion': await jwks.mintJwt(asEmail), 'x-repos-csrf': '1' },
    payload: body,
  });
}

async function seed(
  email: string,
  status: string,
  role = 'member',
  cfSynced: Date | null = new Date(),
) {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO users (email, status, role, cf_synced_at) VALUES ($1,$2,$3,$4) RETURNING id`,
    [email, status, role, cfSynced],
  );
  if (status === 'active' || status === 'invited') policyEmails.push(email);
  return rows[0].id;
}

async function emailOf(id: string): Promise<string> {
  const { rows } = await db.query<{ email: string }>(`SELECT email FROM users WHERE id=$1`, [id]);
  return rows[0].email;
}

describe('suspend — revocation takes effect FIRST (Q17, Q24)', () => {
  it('commits suspended + NULL stamp, then removes from the policy, then stamps', async () => {
    const email = freshEmail('susp');
    const id = await seed(email, 'active');
    const r = await patch(id, { status: 'suspended' });
    expect(r.statusCode).toBe(200);
    const { rows } = await db.query<{ status: string; cf_synced_at: Date | null }>(
      `SELECT status, cf_synced_at FROM users WHERE id=$1`,
      [id],
    );
    expect(rows[0].status).toBe('suspended');
    expect(rows[0].cf_synced_at).not.toBeNull();
    expect(policyEmails).not.toContain(email);
  });

  it('with CF removal mocked to FAIL, the DB revocation has ALREADY committed', async () => {
    const email = freshEmail('suspfail');
    const id = await seed(email, 'active');
    fetchPolicyImpl = async () => {
      throw new policy.CfPolicyError('cf_http_error', 'down');
    };
    const r = await patch(id, { status: 'suspended' });
    expect(r.statusCode).toBe(200);
    expect(r.json<{ sync_error: string }>().sync_error).toBe('cf_http_error');
    const { rows } = await db.query<{ status: string; cf_synced_at: Date | null }>(
      `SELECT status, cf_synced_at FROM users WHERE id=$1`,
      [id],
    );
    // The opposite of what the round-2 draft asserted: the DB change stands.
    expect(rows[0].status).toBe('suspended');
    expect(rows[0].cf_synced_at).toBeNull();
  });

  it('denies the suspended user on the VERY NEXT request, with CF still failing', async () => {
    const email = freshEmail('nextreq');
    const id = await seed(email, 'active');
    fetchPolicyImpl = async () => {
      throw new policy.CfPolicyError('cf_http_error', 'down');
    };
    await patch(id, { status: 'suspended' });
    const me = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { 'cf-access-jwt-assertion': await jwks.mintJwt(email) },
    });
    expect(me.statusCode).toBe(403);
    expect(me.json<{ error: string }>().error).toBe('access_suspended');
  });

  it('emits user_suspended with the human actor', async () => {
    const id = await seed(freshEmail('suspev'), 'active');
    await patch(id, { status: 'suspended' });
    const { rows } = await db.query<{ meta: Record<string, unknown> }>(
      `SELECT meta FROM account_events WHERE user_id=$1 AND kind='user_suspended'`,
      [id],
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
      `SELECT status, cf_synced_at FROM users WHERE id=$1`,
      [id],
    );
    expect(rows[0].status).toBe('active');
    expect(rows[0].cf_synced_at).not.toBeNull();
    expect(policyEmails).toContain(email);
    const ev = await db.query<{ n: number }>(
      `SELECT count(*)::int n FROM account_events WHERE user_id=$1 AND kind='user_reinstated'`,
      [id],
    );
    expect(ev.rows[0].n).toBe(1);
  });

  it('CF add fails -> row stays suspended with a NULL stamp; policy untouched', async () => {
    const email = freshEmail('reinstfail');
    const id = await seed(email, 'suspended', 'member', new Date());
    fetchPolicyImpl = async () => {
      throw new policy.CfPolicyError('cf_timeout', 'slow');
    };
    const r = await patch(id, { status: 'active' });
    expect(r.statusCode).toBe(502);
    expect(r.json<{ error: string }>().error).toBe('cf_sync_failed');
    const { rows } = await db.query<{ status: string; cf_synced_at: Date | null }>(
      `SELECT status, cf_synced_at FROM users WHERE id=$1`,
      [id],
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
      method: 'POST',
      url: '/api/tokens',
      body: { user_id: id, label: 't', scopes: ['health:weight:write'] },
    });
    const token = mint.json<{ token: string }>().token;
    fetchPolicyImpl = async () => {
      throw new policy.CfPolicyError('cf_timeout', 'slow');
    };
    await patch(id, { status: 'active' });

    const cf = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { 'cf-access-jwt-assertion': await jwks.mintJwt(email) },
    });
    expect(cf.statusCode).toBe(403);
    const bearer = await app.inject({
      method: 'GET',
      url: '/api/account/sessions',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(bearer.statusCode).toBe(401);
  });

  it('reinstatement contends for the cohort cap (Q12, Q26)', async () => {
    await db.query(`DELETE FROM users WHERE email <> $1`, [ADMIN]);
    const id = await seed(freshEmail('capreinst'), 'suspended', 'member', new Date());
    for (let i = 0; i < 9; i++) {
      await db.query(`INSERT INTO users (email, status) VALUES ($1,'active')`, [
        freshEmail(`f${i}`),
      ]);
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
