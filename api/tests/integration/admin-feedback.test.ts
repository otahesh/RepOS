import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { setupTestJwks, type TestJwksHandle } from '../helpers/cf-access-jwt.js';
import { db } from '../../src/db/client.js';

describe('/api/me is_admin', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let jwks: TestJwksHandle;
  const savedAdminEmails = process.env.REPOS_ADMIN_EMAILS;

  beforeAll(async () => {
    jwks = await setupTestJwks();
    process.env.REPOS_ADMIN_EMAILS = 'boss@repos.test';
    app = await buildApp();
  });

  afterAll(async () => {
    await jwks.teardown();
    if (savedAdminEmails === undefined) delete process.env.REPOS_ADMIN_EMAILS;
    else process.env.REPOS_ADMIN_EMAILS = savedAdminEmails;
    await db.query(`DELETE FROM users WHERE email IN ('boss@repos.test','peon@repos.test')`);
    await app.close();
  });

  it('returns is_admin=true for an admin email', async () => {
    const jwt = await jwks.mintJwt('boss@repos.test');
    const r = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: `CF_Authorization=${jwt}` } });
    expect(r.statusCode).toBe(200);
    expect(r.json<{ is_admin: boolean }>().is_admin).toBe(true);
  });

  it('returns is_admin=false for a non-admin email', async () => {
    const jwt = await jwks.mintJwt('peon@repos.test');
    const r = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: `CF_Authorization=${jwt}` } });
    expect(r.statusCode).toBe(200);
    expect(r.json<{ is_admin: boolean }>().is_admin).toBe(false);
  });
});

describe('admin feedback routes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let jwks: TestJwksHandle;
  let feedbackId: string;       // a newer untriaged row (also exercised by the triage test)
  let olderUntriagedId: string; // an older untriaged row
  let triagedId: string;        // an already-triaged row
  const savedAdminEmails = process.env.REPOS_ADMIN_EMAILS;
  const savedAdminKey = process.env.ADMIN_API_KEY;

  beforeAll(async () => {
    jwks = await setupTestJwks();
    process.env.REPOS_ADMIN_EMAILS = 'boss@repos.test';
    process.env.ADMIN_API_KEY = 'w7-admin-key'; // force the gate closed for non-admins
    app = await buildApp();
    // Seed THREE rows so the list test can prove the spec-mandated ordering
    // (triaged_at NULLS FIRST, created_at DESC) — not just presence: two
    // untriaged at different times + one already-triaged.
    const ins = await db.query<{ id: string }>(
      `INSERT INTO feedback (body, user_email_at_submit, route, created_at, triaged_at) VALUES
         ('older untriaged','t@repos.test','/today', now() - interval '2 hours', NULL),
         ('newer untriaged','t@repos.test','/today', now() - interval '1 hour', NULL),
         ('already triaged','t@repos.test','/today', now(),                      now())
       RETURNING id`,
    );
    olderUntriagedId = ins.rows[0].id;
    feedbackId = ins.rows[1].id; // newer untriaged
    triagedId = ins.rows[2].id;
  });

  afterAll(async () => {
    await jwks.teardown();
    if (savedAdminEmails === undefined) delete process.env.REPOS_ADMIN_EMAILS; else process.env.REPOS_ADMIN_EMAILS = savedAdminEmails;
    if (savedAdminKey === undefined) delete process.env.ADMIN_API_KEY; else process.env.ADMIN_API_KEY = savedAdminKey;
    await db.query(`DELETE FROM feedback WHERE id = ANY($1::bigint[])`, [[feedbackId, olderUntriagedId, triagedId]]);
    await db.query(`DELETE FROM users WHERE email IN ('boss@repos.test','peon@repos.test')`);
    await app.close();
  });

  it('lists untriaged-first, newest-first within untriaged (X-Admin-Key path)', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/admin/feedback', headers: { 'x-admin-key': 'w7-admin-key' } });
    expect(r.statusCode).toBe(200);
    const ids = r.json<{ items: { id: string }[] }>().items.map((i) => i.id);
    const iNewer = ids.indexOf(feedbackId);
    const iOlder = ids.indexOf(olderUntriagedId);
    const iTriaged = ids.indexOf(triagedId);
    expect(iNewer).toBeGreaterThanOrEqual(0); // present (if -1, reset the test DB — shared-DB cruft)
    expect(iNewer).toBeLessThan(iOlder);      // newer untriaged before older untriaged (created_at DESC)
    expect(iOlder).toBeLessThan(iTriaged);    // both untriaged before the triaged row (NULLS FIRST)
  });

  it('403s a non-admin CF Access email', async () => {
    const jwt = await jwks.mintJwt('peon@repos.test');
    const r = await app.inject({ method: 'GET', url: '/api/admin/feedback', headers: { cookie: `CF_Authorization=${jwt}` } });
    expect(r.statusCode).toBe(403);
  });

  it('marks triaged_at idempotently', async () => {
    const r1 = await app.inject({ method: 'PATCH', url: `/api/admin/feedback/${feedbackId}/triage`, headers: { 'x-admin-key': 'w7-admin-key' } });
    expect(r1.statusCode).toBe(200);
    const t1 = r1.json<{ triaged_at: string }>().triaged_at;
    expect(t1).not.toBeNull();
    const r2 = await app.inject({ method: 'PATCH', url: `/api/admin/feedback/${feedbackId}/triage`, headers: { 'x-admin-key': 'w7-admin-key' } });
    expect(r2.json<{ triaged_at: string }>().triaged_at).toBe(t1); // unchanged
  });

  it('404s a triage on a non-numeric / missing id', async () => {
    const r = await app.inject({ method: 'PATCH', url: `/api/admin/feedback/99999999/triage`, headers: { 'x-admin-key': 'w7-admin-key' } });
    expect(r.statusCode).toBe(404);
  });
});
