// G2 contamination matrix — six rows. A CF-Access-authenticated `member` must
// be refused on every user-management route, and the X-Admin-Key escape hatch
// must not work on any of them (Q20).
//
// Why the admin-key half matters as much as the role half: that branch returns
// WITHOUT setting req.userId/req.userEmail, so there is no actor — the Q13
// self-target guards would have no "self" to compare against and every audit
// row would be unattributed. It is refused on header presence alone, before
// any CF Access check.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../../../src/app.js';
import { setupTestJwks, type TestJwksHandle } from '../../helpers/cf-access-jwt.js';
import { mkUserWithEmail, cleanupUser } from '../../helpers/program-fixtures.js';
import { db } from '../../../src/db/client.js';

let app: Awaited<ReturnType<typeof buildApp>>;
let jwks: TestJwksHandle;
let memberEmail: string;
let victimId: string;
let before: VictimState;
const created: string[] = [];

/** The address POST /invite would create. Nothing may bring it into existence. */
const INVITE_TARGET = 'x@repos.test';

/**
 * `SELECT *`, not a column list. Status and role alone were not enough for
 * the claim this test makes — four of the six routes move neither: retry-sync
 * stamps `cf_synced_at`, resend writes `invite_sent_at` / `invite_message_id`
 * / `invite_request`, invite targets a different address entirely. Naming
 * columns also means the assertion silently narrows every time a migration
 * adds one, so take the whole row.
 *
 * Plus the audit trail, since Q27 commits an `account_events` row in the same
 * transaction as any real lifecycle change — a mutation that left the users
 * row alone but wrote an event is still a breach of "the operation did not
 * happen".
 */
interface VictimState {
  row: Record<string, unknown>;
  events: number;
  inviteTargetExists: boolean;
}

async function readVictim(): Promise<VictimState> {
  const { rows } = await db.query(`SELECT * FROM users WHERE id=$1`, [victimId]);
  const { rows: ev } = await db.query<{ c: string }>(
    `SELECT count(*)::int AS c FROM account_events WHERE user_id=$1`, [victimId],
  );
  const { rows: tgt } = await db.query<{ c: string }>(
    `SELECT count(*)::int AS c FROM users WHERE email=$1`, [INVITE_TARGET],
  );
  return { row: rows[0], events: Number(ev[0].c), inviteTargetExists: Number(tgt[0].c) > 0 };
}

beforeAll(async () => {
  jwks = await setupTestJwks();
  app = await buildApp();
  memberEmail = `w9.contam-member-${randomUUID().slice(0, 8)}@repos.test`;
  created.push((await mkUserWithEmail(memberEmail, { role: 'member', status: 'active' })).id);
  // cf_synced_at is seeded NON-NULL deliberately. retry-sync's first act is to
  // CLEAR it (Q24, before the CF call), so a victim starting at NULL makes
  // that write invisible to the state comparison below — "unchanged" and
  // "cleared" are the same value. Start from the other value.
  const victim = await mkUserWithEmail(`w9.contam-victim-${randomUUID().slice(0, 8)}@repos.test`, {
    role: 'member', status: 'active', cfSyncedAt: new Date('2026-07-01T00:00:00Z'),
  });
  victimId = victim.id;
  created.push(victimId);
  before = await readVictim();
  // The invite case can only prove "no row was created" if none existed first.
  expect(before.inviteTargetExists).toBe(false);
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
      // ADMIN_API_KEY is set to the value we then present, so this proves a
      // *correct* admin key is refused — not merely that a wrong one is.
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

  // The rejections above assert a response code. This asserts the operation
  // did not happen — a route that mutated and *then* refused would satisfy
  // every case above and fail here.
  //
  // Checking only status+role was not enough for that claim: four of the six
  // routes move neither column. The whole row, the audit count, and the
  // existence of the invite target are compared against the pre-request
  // snapshot instead.
  //
  // Measured coverage, rather than assumed: dropping the gate from PATCH or
  // from retry-sync fails THIS case on its own (suspended status; cleared
  // stamp). Dropping it from invite does not reach here — the handler 500s on
  // `actor.email.toLowerCase()` with no actor, so nothing is written; that
  // mutation is caught by the 403 cases above. Both are refused; only one is
  // refused by this assertion.
  it('nothing the six routes could have touched moved', async () => {
    const after = await readVictim();
    expect(after.row).toEqual(before.row);           // covers sync + delivery columns
    expect(after.events).toBe(before.events);        // Q27 writes one per real change
    expect(after.inviteTargetExists).toBe(false);    // POST /invite targets this, not the victim
  });

  // A Cloudflare write would also be a breach, and it is covered structurally
  // rather than by assertion: CF_* is unset in the test env, so the
  // fail-closed policy client throws `cf_not_configured` before any I/O. Any
  // route that reached it would return 502, failing the 403 cases above.
  it('the victim row still exists — the comparison above was not vacuous', async () => {
    expect(before.row).toBeDefined();
    expect((await readVictim()).row.email).toBe(before.row.email);
  });
});
