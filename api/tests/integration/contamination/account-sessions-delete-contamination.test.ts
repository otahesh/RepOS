// api/tests/integration/contamination/account-sessions-delete-contamination.test.ts
//
// G2 contribution (6th) — DELETE /api/account/sessions/:id with a user-A
// bearer must NEVER revoke a token belonging to user B.
//
// Per I-CONTAM-MATRIX option (a): the per-token revoke route ships alongside
// GET /account/sessions. The server pins user_id=$1 in the UPDATE WHERE
// clause (identity from req.userId), so user-A targeting user-B's token id
// matches zero rows → 404 (never 204, never a silent revoke of B's token).
//
// Asserts:
//   - DELETE /api/account/sessions/<B-token-id> with A's bearer → 404.
//   - B's device_tokens row keeps revoked_at IS NULL (unrevoked).
//   - For completeness: A revoking A's own token → 204 (sanity that the route
//     works at all — guards against a false-green 404-on-everything bug).

import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../../src/app.js';
import { db } from '../../../src/db/client.js';
import { mkUser, cleanupUser } from '../../helpers/program-fixtures.js';

let app: Awaited<ReturnType<typeof buildApp>>;
let userA: string;
let tokenA: string;
let userB: string;
let bTokenId: string;
let aTokenId: string;

beforeAll(async () => {
  app = await buildApp();
  const a = await mkUser({ prefix: 'vitest.w6-sess-del-cont-a' });
  userA = a.id;
  const b = await mkUser({ prefix: 'vitest.w6-sess-del-cont-b' });
  userB = b.id;

  const mintA = await app.inject({
    method: 'POST',
    url: '/api/tokens',
    body: { user_id: userA, label: 'A-bearer', scopes: ['health:weight:write'] },
  });
  const aJson = mintA.json<{ id: string; token: string }>();
  tokenA = aJson.token;
  aTokenId = aJson.id;

  const mintB = await app.inject({
    method: 'POST',
    url: '/api/tokens',
    body: { user_id: userB, label: 'B-bearer', scopes: ['health:weight:write'] },
  });
  bTokenId = mintB.json<{ id: string }>().id;
});

afterAll(async () => {
  await db.query(`DELETE FROM account_events WHERE user_id IN ($1,$2)`, [userA, userB]);
  await cleanupUser(userA);
  await cleanupUser(userB);
  await app.close();
});

describe('DELETE /api/account/sessions/:id contamination — G2', () => {
  it('user A revoking user B token id returns 404, B token still active', async () => {
    const r = await app.inject({
      method: 'DELETE',
      url: `/api/account/sessions/${bTokenId}`,
      headers: { authorization: `Bearer ${tokenA}`, 'x-repos-csrf': '1' },
    });
    expect(r.statusCode).toBe(404);

    // B's token must remain unrevoked — the cross-user revoke must not land.
    const { rows } = await db.query<{ revoked_at: Date | null; revoke_reason: string | null }>(
      `SELECT revoked_at, revoke_reason FROM device_tokens WHERE id=$1`,
      [bTokenId],
    );
    expect(rows.length).toBe(1);
    expect(rows[0].revoked_at).toBeNull();
    expect(rows[0].revoke_reason).toBeNull();
  });

  it('user A revoking A own token returns 204 (sanity — route is not 404-on-all)', async () => {
    const r = await app.inject({
      method: 'DELETE',
      url: `/api/account/sessions/${aTokenId}`,
      headers: { authorization: `Bearer ${tokenA}`, 'x-repos-csrf': '1' },
    });
    expect(r.statusCode).toBe(204);

    const { rows } = await db.query<{ revoked_at: Date | null; revoke_reason: string | null }>(
      `SELECT revoked_at, revoke_reason FROM device_tokens WHERE id=$1`,
      [aTokenId],
    );
    expect(rows[0].revoked_at).not.toBeNull();
    expect(rows[0].revoke_reason).toBe('user_revoked');
  });
});
