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
