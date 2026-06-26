import 'dotenv/config';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { build } from '../helpers/build-test-app.js';
import { mkUserPair, cleanupUserPair, type UserPairHandle } from '../helpers/seed-fixtures.js';
import { db } from '../../src/db/client.js';

const handles: UserPairHandle[] = [];
afterEach(async () => {
  if (handles.length) await cleanupUserPair(handles.splice(0));
});
afterAll(async () => {
  await db.end();
});

// G11 — a malformed :id must be a clean 404, never a 500 that leaks a raw
// Postgres "invalid input syntax for type uuid" error in the response body.
const UUID_ROUTES: Array<{ method: 'GET' | 'POST' | 'PATCH'; url: string }> = [
  { method: 'GET', url: '/api/mesocycles/not-a-uuid' },
  { method: 'GET', url: '/api/mesocycles/not-a-uuid/volume-rollup' },
  { method: 'GET', url: '/api/mesocycles/not-a-uuid/recap-stats' },
  { method: 'POST', url: '/api/mesocycles/not-a-uuid/abandon' },
  { method: 'POST', url: '/api/mesocycles/not-a-uuid/deload-now' },
  { method: 'POST', url: '/api/mesocycles/not-a-uuid/deload-now/undo' },
  { method: 'PATCH', url: '/api/planned-sets/not-a-uuid' },
  { method: 'POST', url: '/api/planned-sets/not-a-uuid/substitute' },
  { method: 'GET', url: '/api/user-programs/not-a-uuid' },
  { method: 'PATCH', url: '/api/user-programs/not-a-uuid' },
  { method: 'GET', url: '/api/user-programs/not-a-uuid/warnings' },
  { method: 'GET', url: '/api/user-programs/not-a-uuid/mesocycles' },
  { method: 'POST', url: '/api/user-programs/not-a-uuid/start' },
];

describe('G11 — malformed :id is a clean 404, not a 500', () => {
  for (const route of UUID_ROUTES) {
    it(`${route.method} ${route.url} -> 404`, async () => {
      const app = await build();
      const pair = await mkUserPair();
      handles.push(pair);
      const res = await app.inject({
        method: route.method,
        url: route.url,
        headers: { authorization: `Bearer ${pair.userA.bearer}` },
        payload: route.method === 'GET' ? undefined : {},
      });
      expect(
        res.statusCode,
        `expected clean 404, got ${res.statusCode}: ${res.body.slice(0, 200)}`,
      ).toBe(404);
      expect(res.body).not.toMatch(/invalid input syntax/i);
    });
  }
});

describe('G11 — malformed bigint :id (device_tokens) is a clean 404, not a 500', () => {
  it('DELETE /api/account/sessions/not-a-number -> 404', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/account/sessions/not-a-number',
      headers: { authorization: `Bearer ${pair.userA.bearer}` },
    });
    expect(res.statusCode, `got ${res.statusCode}: ${res.body.slice(0, 200)}`).toBe(404);
    expect(res.body).not.toMatch(/invalid input syntax/i);
  });

  it('DELETE /api/tokens/not-a-number -> 404', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);
    // ADMIN_API_KEY is unset in the test env, so the admin gate opens the
    // path (authMode='admin'); user_id must be supplied on the admin path.
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/tokens/not-a-number?user_id=${pair.userA.userId}`,
    });
    expect(res.statusCode, `got ${res.statusCode}: ${res.body.slice(0, 200)}`).toBe(404);
    expect(res.body).not.toMatch(/invalid input syntax/i);
  });
});
