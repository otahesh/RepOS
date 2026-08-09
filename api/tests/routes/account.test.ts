// api/tests/routes/account.test.ts
//
// Beta W6 Task 7 — happy-path coverage for PATCH /api/me/profile.
//
// Validates:
//   - Successful partial update + redacted profile_changed audit event
//   - .strict() rejects unknown body keys (e.g. `units` deferred per D6)
//   - timezone allow-list rejects unknown zones (400 invalid_timezone)
//   - display_name length cap (>80 → 400)
//   - empty / whitespace / zero-width-only display_name → 400 (I-DISPLAY-NAME-NORMALIZE)
//   - NFKC normalization + zero-width stripping (Ｊａｓｏｎ + ZWSP → "Jason")
//   - partial PATCH only touches sent fields (display_name preserved)
//   - idempotency — re-sending the same value does NOT write a duplicate event
//
// The cross-user IDOR matrix lives in
// api/tests/integration/contamination/account-profile-contamination.test.ts.
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/client.js';
import { mkUser, cleanupUser } from '../helpers/program-fixtures.js';

let app: Awaited<ReturnType<typeof buildApp>>;
let userId: string;
let token: string;

beforeAll(async () => {
  app = await buildApp();
  const u = await mkUser({ prefix: 'vitest.acct-routes' });
  userId = u.id;
  const mint = await app.inject({
    method: 'POST',
    url: '/api/tokens',
    body: { user_id: userId, label: 't', scopes: ['health:weight:write'] },
  });
  token = mint.json<{ token: string }>().token;
});

afterAll(async () => {
  await cleanupUser(userId);
  await app.close();
});

describe('PATCH /api/me/profile', () => {
  it('updates display_name + timezone (units NOT supported per D6)', async () => {
    const r = await app.inject({
      method: 'PATCH',
      url: '/api/me/profile',
      headers: { authorization: `Bearer ${token}` },
      payload: { display_name: 'Jason M.', timezone: 'America/New_York' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json<{ display_name: string }>().display_name).toBe('Jason M.');
    // account_events row written
    const { rows } = await db.query<{
      kind: string;
      meta: { fields: string[]; changed: boolean };
    }>(
      `SELECT kind, meta FROM account_events
        WHERE user_id=$1 AND kind='profile_changed'
        ORDER BY occurred_at DESC LIMIT 1`,
      [userId],
    );
    expect(rows.length).toBeGreaterThan(0);
    // Per I-ACCOUNT-EVENTS-META — only field names + a `changed` flag.
    // The prior PII value is NEVER persisted.
    expect(rows[0].meta.changed).toBe(true);
    expect(Array.isArray(rows[0].meta.fields)).toBe(true);
    expect(rows[0].meta.fields).toEqual(expect.arrayContaining(['display_name', 'timezone']));
  });

  it('rejects units in body — units is not a supported field (per D6)', async () => {
    const r = await app.inject({
      method: 'PATCH',
      url: '/api/me/profile',
      headers: { authorization: `Bearer ${token}` },
      payload: { units: 'kg' },
    });
    // zod .strict() rejects unknown keys with 400.
    expect(r.statusCode).toBe(400);
  });

  it('rejects unknown timezone with 400', async () => {
    const r = await app.inject({
      method: 'PATCH',
      url: '/api/me/profile',
      headers: { authorization: `Bearer ${token}` },
      payload: { timezone: 'Mars/Olympus' },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json<{ error: string }>().error).toBe('invalid_timezone');
  });

  it('rejects display_name > 80 chars', async () => {
    const r = await app.inject({
      method: 'PATCH',
      url: '/api/me/profile',
      headers: { authorization: `Bearer ${token}` },
      payload: { display_name: 'x'.repeat(81) },
    });
    expect(r.statusCode).toBe(400);
  });

  it('rejects empty-string and whitespace-only display_name (per I-DISPLAY-NAME-NORMALIZE)', async () => {
    for (const bad of ['', '   ', '​​​']) {
      const r = await app.inject({
        method: 'PATCH',
        url: '/api/me/profile',
        headers: { authorization: `Bearer ${token}` },
        payload: { display_name: bad },
      });
      expect(r.statusCode).toBe(400);
    }
  });

  it('NFKC-normalizes display_name and strips zero-width spaces (per I-DISPLAY-NAME-NORMALIZE)', async () => {
    // "Ｊａｓｏｎ" full-width latin → "Jason" after NFKC; trailing ZWSP stripped.
    const r = await app.inject({
      method: 'PATCH',
      url: '/api/me/profile',
      headers: { authorization: `Bearer ${token}` },
      payload: { display_name: 'Ｊａｓｏｎ​' },
    });
    expect(r.statusCode).toBe(200);
    const { rows } = await db.query<{ display_name: string }>(
      'SELECT display_name FROM users WHERE id=$1',
      [userId],
    );
    expect(rows[0].display_name).toBe('Jason');
  });

  it('partial update only touches sent fields', async () => {
    // Send timezone only; display_name must be preserved.
    const before = (
      await db.query<{ display_name: string }>('SELECT display_name FROM users WHERE id=$1', [
        userId,
      ])
    ).rows[0].display_name;
    await app.inject({
      method: 'PATCH',
      url: '/api/me/profile',
      headers: { authorization: `Bearer ${token}` },
      payload: { timezone: 'America/Los_Angeles' },
    });
    const { rows } = await db.query<{
      timezone: string;
      display_name: string;
    }>('SELECT timezone, display_name FROM users WHERE id=$1', [userId]);
    expect(rows[0].timezone).toBe('America/Los_Angeles');
    expect(rows[0].display_name).toBe(before); // preserved
  });

  it('idempotent — sending the current value twice is a no-op (per I-PROFILE-IDEMPOTENCY-TEST)', async () => {
    // First call (re-sets to the current value).
    const { rows: cur } = await db.query<{ display_name: string }>(
      'SELECT display_name FROM users WHERE id=$1',
      [userId],
    );
    await app.inject({
      method: 'PATCH',
      url: '/api/me/profile',
      headers: { authorization: `Bearer ${token}` },
      payload: { display_name: cur[0].display_name },
    });
    const eventCountBefore = (
      await db.query<{ n: number }>(
        `SELECT count(*)::int n FROM account_events WHERE user_id=$1 AND kind='profile_changed'`,
        [userId],
      )
    ).rows[0].n;
    // Second call with same payload — must not write a duplicate profile_changed event.
    const r = await app.inject({
      method: 'PATCH',
      url: '/api/me/profile',
      headers: { authorization: `Bearer ${token}` },
      payload: { display_name: cur[0].display_name },
    });
    expect(r.statusCode).toBe(200);
    const eventCountAfter = (
      await db.query<{ n: number }>(
        `SELECT count(*)::int n FROM account_events WHERE user_id=$1 AND kind='profile_changed'`,
        [userId],
      )
    ).rows[0].n;
    expect(eventCountAfter).toBe(eventCountBefore);
  });
});
