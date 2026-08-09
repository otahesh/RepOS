// Q13, Q17, Q17b, Q27, Q33, Q37 — the ONE deletion state machine.
//
// Ephemeral DB: the cohort count and the last-admin invariant both read
// whole-table state, so this suite cannot share the dev database.
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createEphemeralDb } from '../helpers/ephemeral-db.js';
import { runMigrations } from '../../src/db/runMigrations.js';
import pg from 'pg';

const eph = await createEphemeralDb('delete');
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
const { SUPPORT_CONTACT } = await import('../../src/services/inviteMailer.js');

let app: Awaited<ReturnType<typeof buildApp>>;
let jwks: Awaited<ReturnType<typeof setupTestJwks>>;
const ADMIN = 'admin.delete@repos.test';
let adminId: string;

let policyEmails: string[];
let fetchPolicyImpl: () => Promise<unknown>;

// PUBLIC_ORIGIN is not in api/.env, and csrfOrigin fails CLOSED without it —
// before it ever looks at the X-RepOS-CSRF header — so every request below
// would 403 with csrf_origin_misconfigured for a reason unrelated to deletion.
// Same trap as the invite and patch suites.
const savedEnv: Record<string, string | undefined> = {};
function setEnv(key: string, value: string): void {
  savedEnv[key] = process.env[key];
  process.env[key] = value;
}

beforeAll(async () => {
  setEnv('PUBLIC_ORIGIN', 'https://repos.delete.test');
  jwks = await setupTestJwks();
  app = await buildApp();
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO users (email, role, status) VALUES ($1,'admin','active') RETURNING id`,
    [ADMIN],
  );
  adminId = rows[0].id;
  // The deterministic cascade blocker used by the Q27 rollback case. ON DELETE
  // NO ACTION means a referencing row makes `DELETE FROM users` raise inside
  // the final transaction — no spy, no timing, no mock of db.connect.
  await db.query(
    `CREATE TABLE IF NOT EXISTS w9_block (user_id UUID REFERENCES users(id) ON DELETE NO ACTION)`,
  );
});

afterAll(async () => {
  await db.query(`DROP TABLE IF EXISTS w9_block`);
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
  // Every admin-route case acts as ADMIN, and one case deliberately demotes
  // every other row, so ADMIN must start each case as an active admin.
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
  return `dt-${tag}-${randomUUID().slice(0, 8)}@repos.test`;
}

async function del(id: string, asEmail = ADMIN) {
  return app.inject({
    method: 'DELETE',
    url: `/api/admin/users/${id}`,
    headers: { 'cf-access-jwt-assertion': await jwks.mintJwt(asEmail), 'x-repos-csrf': '1' },
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
    const { rows } = await db.query<{
      kind: string;
      user_id: string | null;
      user_id_at_event: string;
      user_email_at_event: string;
    }>(
      `SELECT kind, user_id, user_id_at_event, user_email_at_event
         FROM account_events WHERE user_id_at_event=$1 ORDER BY occurred_at`,
      [id],
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
       VALUES ($1, '2026-07-01', '08:00', 180.0, 'Manual')`,
      [id],
    );
    fetchPolicyImpl = async () => {
      throw new policy.CfPolicyError('cf_http_error', 'down');
    };
    const r = await del(id);
    expect(r.statusCode).toBe(502);

    const u = await db.query<{ status: string; cf_synced_at: Date | null }>(
      `SELECT status, cf_synced_at FROM users WHERE id=$1`,
      [id],
    );
    expect(u.rows[0].status).toBe('deleting');
    expect(u.rows[0].cf_synced_at).toBeNull();
    // Asserted by ROW COUNTS, not just a status code.
    const child = await db.query<{ n: number }>(
      `SELECT count(*)::int n FROM health_weight_samples WHERE user_id=$1`,
      [id],
    );
    expect(child.rows[0].n).toBe(1);
    const ev = await db.query<{ n: number }>(
      `SELECT count(*)::int n FROM account_events
        WHERE user_id_at_event=$1 AND kind='user_delete_requested'`,
      [id],
    );
    expect(ev.rows[0].n).toBe(1);
  });

  it('a second admin resumes an interrupted delete without a duplicate request event', async () => {
    const email = freshEmail('resume');
    const id = await seed(email, 'active');
    fetchPolicyImpl = async () => {
      throw new policy.CfPolicyError('cf_http_error', 'down');
    };
    await del(id);
    // CF recovers; a different admin finishes the job.
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
    const r = await del(id);
    expect(r.statusCode).toBe(204);
    const ev = await db.query<{ n: number }>(
      `SELECT count(*)::int n FROM account_events
        WHERE user_id_at_event=$1 AND kind='user_delete_requested'`,
      [id],
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
        WHERE user_id_at_event=$1 AND kind='user_deleted'`,
      [id],
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
      method: 'DELETE',
      url: `/api/admin/users/${id}`,
      headers: { authorization: 'Bearer whatever', 'x-repos-csrf': '1' },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json<{ error: string }>().error).toBe('cf_access_required');
  });

  it('a deleting row occupies a cohort slot until the cascade completes (Q12)', async () => {
    await db.query(`DELETE FROM users WHERE email <> $1`, [ADMIN]);
    const id = await seed(freshEmail('slot'), 'active');
    fetchPolicyImpl = async () => {
      throw new policy.CfPolicyError('cf_http_error', 'down');
    };
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
      method: 'DELETE',
      url: '/api/me',
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
      `SELECT kind FROM account_events WHERE user_id_at_event=$1`,
      [id],
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
    const { rows } = await db.query<{ status: string }>(`SELECT status FROM users WHERE email=$1`, [
      ADMIN,
    ]);
    expect(rows[0].status).toBe('active'); // no mutation happened
  });

  it('still rejects a Bearer header and a wrong confirm phrase', async () => {
    const email = freshEmail('selfguard');
    await seed(email, 'active');
    const bearer = await app.inject({
      method: 'DELETE',
      url: '/api/me',
      headers: { authorization: 'Bearer x', 'x-repos-csrf': '1' },
      payload: { confirm: 'DELETE my account' },
    });
    expect(bearer.statusCode).toBe(403);
    const wrong = await app.inject({
      method: 'DELETE',
      url: '/api/me',
      headers: { 'cf-access-jwt-assertion': await jwks.mintJwt(email), 'x-repos-csrf': '1' },
      payload: { confirm: 'delete it' },
    });
    expect(wrong.statusCode).toBe(400);
  });

  it('Q37: an interrupted self-delete cannot be resumed by the user, only by an admin', async () => {
    const email = freshEmail('interrupt');
    const id = await seed(email, 'active');
    const mint = await app.inject({
      method: 'POST',
      url: '/api/tokens',
      body: { user_id: id, label: 't', scopes: ['health:weight:write'] },
    });
    const token = mint.json<{ token: string }>().token;

    fetchPolicyImpl = async () => {
      throw new policy.CfPolicyError('cf_http_error', 'down');
    };
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
    // They cannot call /api/me again — the gate stops them before the handler.
    expect((await selfDelete(email)).statusCode).toBe(403);

    // An admin completes it.
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
    expect((await del(id)).statusCode).toBe(204);

    // The bearer this user held is recorded on the audit row before the
    // cascade wipes device_tokens — the count is unrecoverable afterwards, so
    // reading it late would silently always be 0. This case is the only one
    // that mints a token, so it is the only place the field is falsifiable.
    const ev = await db.query<{ meta: { previous_token_count?: number } }>(
      `SELECT meta FROM account_events
        WHERE user_id_at_event=$1 AND kind='user_deleted'`,
      [id],
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
    const body = r.json<{
      error: string;
      disabled?: boolean;
      resumable?: boolean;
      message?: string;
    }>();
    expect(body.error).toBe('delete_finalize_failed');
    expect(body.disabled).toBe(true);
    expect(body.resumable).toBe(true);
    expect(body.message).toContain(SUPPORT_CONTACT);

    // Durably disabled, and no event describing a deletion that did not happen.
    const u = await db.query<{ status: string }>(`SELECT status FROM users WHERE id=$1`, [id]);
    expect(u.rows[0].status).toBe('deleting');
    const ev = await db.query<{ n: number }>(
      `SELECT count(*)::int n FROM account_events
        WHERE user_id_at_event=$1 AND kind='user_deleted'`,
      [id],
    );
    expect(ev.rows[0].n).toBe(0);

    await db.query(`DELETE FROM w9_block WHERE user_id=$1`, [id]);
  });
});
