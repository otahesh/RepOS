/**
 * Beta W1.4.0 — bearer-token scope-enforcement integration tests.
 *
 * Per Security review Critical #1: `api/src/routes/weight.ts` accepted any
 * valid bearer regardless of `device_tokens.scopes`. This suite locks in
 * the contract that the write routes now require `health:weight:write`.
 *
 * Three angles:
 *   1. Bearer without the scope is rejected with 403 + scope_required:<scope>.
 *   2. Bearer with the scope is accepted (positive control).
 *   3. CF Access JWT (the browser path) bypasses scope check — whole-host
 *      CF Access auth at the edge already enforces identity, so requireScope
 *      pass-throughs when tokenScopes is undefined (no bearer was used).
 *
 * The plan's first test (`weight-only bearer rejected on POST /api/health/workouts`)
 * needs the workouts route to exist; that's W1.4.5. The current suite replaces
 * it with the inverse angle (workouts-scoped bearer rejected on /weight) so
 * the contract is locked from a route that already exists.
 */

import 'dotenv/config';
import { describe, it, expect, afterEach, afterAll, beforeAll } from 'vitest';
import { build } from '../helpers/build-test-app.js';
import {
  seedUserAndMintBearer,
  cleanupSeeded,
  type SeedHandle,
} from '../helpers/seed-fixtures.js';
import { setupTestJwks, type TestJwksHandle } from '../helpers/cf-access-jwt.js';
import { db } from '../../src/db/client.js';

const handles: SeedHandle[] = [];
let jwks: TestJwksHandle | undefined;

beforeAll(async () => {
  jwks = await setupTestJwks();
});

afterEach(async () => {
  if (handles.length) await cleanupSeeded(handles.splice(0));
});

afterAll(async () => {
  if (jwks) await jwks.teardown();
  // Wipe any user the CF Access path auto-provisioned by email claim.
  await db.query(`DELETE FROM users WHERE email = $1`, [
    'scope-enforcement-cf@repos.test',
  ]);
  await db.end();
});

// A valid weight sample payload. Use a per-test unique date so a dedupe
// trip on rerun doesn't drop the positive-control test from 201 to 200.
function validWeightPayload(date: string) {
  return {
    weight_lbs: 185.4,
    date,
    time: '07:32:00',
    source: 'Apple Health',
  };
}

describe('scope enforcement (W1.4.0 backport)', () => {
  it('403 scope_required:health:weight:write when bearer lacks the scope', async () => {
    const app = await build();
    try {
      const { bearer, handle } = await seedUserAndMintBearer({
        scopes: ['health:workouts:write'],
      });
      handles.push(handle);

      const resp = await app.inject({
        method: 'POST',
        url: '/api/health/weight',
        headers: { authorization: `Bearer ${bearer}` },
        payload: validWeightPayload('2025-02-01'),
      });

      expect(resp.statusCode).toBe(403);
      expect(resp.json().error).toMatch(/scope_required:health:weight:write/);
    } finally {
      await app.close();
    }
  });

  it('201 when bearer has health:weight:write scope (positive control)', async () => {
    const app = await build();
    try {
      const { bearer, handle } = await seedUserAndMintBearer({
        scopes: ['health:weight:write'],
      });
      handles.push(handle);

      const resp = await app.inject({
        method: 'POST',
        url: '/api/health/weight',
        headers: { authorization: `Bearer ${bearer}` },
        payload: validWeightPayload('2025-02-02'),
      });

      expect(resp.statusCode).toBe(201);
      expect(resp.json().deduped).toBe(false);
    } finally {
      await app.close();
    }
  });

  it('CF Access JWT bypasses scope check (whole-host auth covers it)', async () => {
    const app = await build();
    try {
      const jwt = await jwks!.mintJwt('scope-enforcement-cf@repos.test');

      const resp = await app.inject({
        method: 'POST',
        url: '/api/health/weight',
        headers: { 'cf-access-jwt-assertion': jwt },
        payload: validWeightPayload('2025-02-03'),
      });

      // CF Access auto-provisions the user on first sight, so the write
      // should succeed end-to-end (201) — no scope check fires because
      // requireScope pass-throughs when tokenScopes is undefined.
      expect(resp.statusCode).toBe(201);
    } finally {
      await app.close();
    }
  });
});
