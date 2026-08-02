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
    // NOTE: this suspends the row BEFORE the request, so the gate's opening
    // SELECT already sees 'suspended' and the activation block is never
    // entered — it does not reach the re-read at all. Kept because it is a
    // legitimate case, but the interleaving one below is what actually covers
    // the zero-row re-read.
    // cf_synced_at=NULL because migration 082 requires it on any status change
    // that crosses CF membership groups, and because patchUser's suspend does
    // exactly this — a fixture that only set status was modelling a transition
    // production cannot perform.
    await db.query(`UPDATE users SET status='suspended', cf_synced_at=NULL WHERE id=$1`, [u.id]);
    const r = await me(email);
    expect(r.statusCode).toBe(403);
    expect(r.json<{ error: string }>().error).toBe('access_suspended');
  });

  it('a row suspended BETWEEN the read and the conditional UPDATE stays denied', async () => {
    // This is the case round-4 finding 3 is actually about: the gate reads the
    // row as invited + provisioned, and only then does an admin suspend it, so
    // the conditional UPDATE matches zero rows. Assuming that means "someone
    // else activated me" would admit a suspended user.
    //
    // Hook the gate's own identity SELECT: let it resolve, then suspend the row
    // before returning. That lands the mutation strictly between the SELECT and
    // the conditional UPDATE — deterministic, not a timing race. (Hooking
    // db.connect instead does not work: pool.query() acquires a client
    // internally, so the first connect is the SELECT's own.)
    const email = freshEmail('interleave');
    const u = await mkUserWithEmail(email, { status: 'invited', cfSyncedAt: new Date() });
    created.push(u.id);
    const realQuery = db.query.bind(db);
    const spy = vi.spyOn(db, 'query').mockImplementation(async (...args: unknown[]) => {
      const res = await (realQuery as (...a: unknown[]) => Promise<unknown>)(...args);
      const sql = typeof args[0] === 'string' ? args[0] : '';
      if (sql.includes('FROM users WHERE lower(email)')) {
        await (realQuery as (...a: unknown[]) => Promise<unknown>)(
          `UPDATE users SET status='suspended', cf_synced_at=NULL WHERE id=$1`,
          [u.id],
        );
      }
      return res;
    });
    try {
      const r = await me(email);
      expect(r.statusCode).toBe(403);
      expect(r.json<{ error: string }>().error).toBe('access_suspended');
    } finally {
      spy.mockRestore();
    }
    // And it must not have activated on the way past.
    const { rows } = await db.query<{ status: string; activated_at: Date | null }>(
      `SELECT status, activated_at FROM users WHERE id=$1`, [u.id],
    );
    expect(rows[0].status).toBe('suspended');
    expect(rows[0].activated_at).toBeNull();
  });

  it('a concurrently deleted row also stays denied', async () => {
    const email = freshEmail('lostdel');
    const u = await mkUserWithEmail(email, { status: 'invited', cfSyncedAt: new Date() });
    created.push(u.id);
    await db.query(`UPDATE users SET status='deleting', cf_synced_at=NULL WHERE id=$1`, [u.id]);
    const r = await me(email);
    expect(r.statusCode).toBe(403);
  });
});
