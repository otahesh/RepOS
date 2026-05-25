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
  seedUserWithMesocycle,
  seedUserWithLoggedSet,
  cleanupSeeded,
  type SeedHandle,
} from '../helpers/seed-fixtures.js';
import { mintBearer } from '../helpers/seed-fixtures.js';
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

  it('403 when bearer has empty scopes array (fail-closed)', async () => {
    const app = await build();
    try {
      const { bearer, handle } = await seedUserAndMintBearer({ scopes: [] });
      handles.push(handle);
      const resp = await app.inject({
        method: 'POST',
        url: '/api/health/weight',
        headers: { authorization: `Bearer ${bearer}` },
        payload: validWeightPayload('2025-02-04'),
      });
      expect(resp.statusCode).toBe(403);
      expect(resp.json().error).toMatch(/scope_required:health:weight:write/);
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

// ---------------------------------------------------------------------------
// W1 reviewer-matrix Critical: /api/set-logs routes shipped without any
// `requireScope(...)` guard. A `health:weight:write` token (the iOS weight
// Shortcut) or a `health:workouts:write` token could write/edit/delete
// arbitrary set_logs. W8.2 contamination row needs to exist for all four
// HTTP verbs. The scope is `set_logs:write`.
// ---------------------------------------------------------------------------

describe('set-logs scope enforcement (W1 reviewer matrix Critical)', () => {
  it('POST /api/set-logs → 403 when bearer lacks set_logs:write scope', async () => {
    const app = await build();
    try {
      const seed = await seedUserWithMesocycle();
      handles.push(seed);
      // Mint a parallel bearer with only the workouts scope. seedUserWithMesocycle
      // already mints a set_logs:write bearer (`seed.bearer`); the next mint adds a
      // wrong-scope sibling token on the same user.
      const wrong = await mintBearer({
        userId: seed.userId,
        scopes: ['health:workouts:write'],
        label: 'wrong-scope',
      });

      const resp = await app.inject({
        method: 'POST',
        url: '/api/set-logs',
        headers: { authorization: `Bearer ${wrong.bearer}` },
        payload: {
          client_request_id: '33333333-3333-4333-8333-333333333333',
          planned_set_id: seed.plannedSetId,
          weight_lbs: 225.0,
          reps: 5,
          rir: 2,
          performed_at: new Date().toISOString(),
        },
      });

      expect(resp.statusCode).toBe(403);
      expect(resp.json().error).toMatch(/scope_required:set_logs:write/);
    } finally {
      await app.close();
    }
  });

  it('PATCH /api/set-logs/:id → 403 when bearer lacks set_logs:write scope', async () => {
    const app = await build();
    try {
      const seed = await seedUserWithLoggedSet({ minutesAgo: 30 });
      handles.push(seed);
      const wrong = await mintBearer({
        userId: seed.userId,
        scopes: ['health:weight:write'],
        label: 'wrong-scope',
      });

      const resp = await app.inject({
        method: 'PATCH',
        url: `/api/set-logs/${seed.setLogId}`,
        headers: { authorization: `Bearer ${wrong.bearer}` },
        payload: { weight_lbs: 230.0 },
      });

      expect(resp.statusCode).toBe(403);
      expect(resp.json().error).toMatch(/scope_required:set_logs:write/);
    } finally {
      await app.close();
    }
  });

  it('DELETE /api/set-logs/:id → 403 when bearer lacks set_logs:write scope', async () => {
    const app = await build();
    try {
      const seed = await seedUserWithLoggedSet({ minutesAgo: 30 });
      handles.push(seed);
      const wrong = await mintBearer({
        userId: seed.userId,
        scopes: ['health:weight:write'],
        label: 'wrong-scope',
      });

      const resp = await app.inject({
        method: 'DELETE',
        url: `/api/set-logs/${seed.setLogId}`,
        headers: { authorization: `Bearer ${wrong.bearer}` },
      });

      expect(resp.statusCode).toBe(403);
      expect(resp.json().error).toMatch(/scope_required:set_logs:write/);
    } finally {
      await app.close();
    }
  });

  it('GET /api/set-logs → 403 when bearer lacks set_logs:write scope', async () => {
    const app = await build();
    try {
      const seed = await seedUserWithMesocycle();
      handles.push(seed);
      const wrong = await mintBearer({
        userId: seed.userId,
        scopes: ['health:weight:write'],
        label: 'wrong-scope',
      });

      const resp = await app.inject({
        method: 'GET',
        url: `/api/set-logs?planned_set_id=${seed.plannedSetId}`,
        headers: { authorization: `Bearer ${wrong.bearer}` },
      });

      expect(resp.statusCode).toBe(403);
      expect(resp.json().error).toMatch(/scope_required:set_logs:write/);
    } finally {
      await app.close();
    }
  });

  it('POST /api/set-logs → 201 with set_logs:write bearer (positive control)', async () => {
    const app = await build();
    try {
      const seed = await seedUserWithMesocycle();
      handles.push(seed);

      const resp = await app.inject({
        method: 'POST',
        url: '/api/set-logs',
        headers: { authorization: `Bearer ${seed.bearer}` },
        payload: {
          client_request_id: '44444444-4444-4444-8444-444444444444',
          planned_set_id: seed.plannedSetId,
          weight_lbs: 225.0,
          reps: 5,
          rir: 2,
          performed_at: new Date().toISOString(),
        },
      });

      expect(resp.statusCode).toBe(201);
    } finally {
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// W3 Task 4 (FIX-3) — failure-first markers for the new injury scopes.
// The scope strings land in VALID_SCOPES in this commit, but the routes
// (/api/user/injuries CRUD) ship in Tasks 5–8. These tests are written now as
// the failure-first contract; they are .skip-gated and re-enabled in Task 5
// once the routes exist. Without the skip the route returns 404 (not 403) and
// the suite goes red on this branch.
// ---------------------------------------------------------------------------

describe('user_injuries scope enforcement (W3 Task 4 failure-first)', () => {
  it('GET /api/user/injuries requires health:injuries:read scope', async () => {
    const app = await build();
    try {
      const { bearer, handle } = await seedUserAndMintBearer({
        scopes: ['set_logs:write'],
      });
      handles.push(handle);

      const resp = await app.inject({
        method: 'GET',
        url: '/api/user/injuries',
        headers: { authorization: `Bearer ${bearer}` },
      });

      expect(resp.statusCode).toBe(403);
      expect(resp.json().error).toMatch(/scope_required:health:injuries:read/);
    } finally {
      await app.close();
    }
  });

  it('POST /api/user/injuries requires health:injuries:write scope', async () => {
    // A read-only bearer is the precise failure-mode the scope guard must
    // catch — read-scope alone must not authorize a write.
    const app = await build();
    try {
      const { bearer, handle } = await seedUserAndMintBearer({
        scopes: ['health:injuries:read'],
      });
      handles.push(handle);

      const resp = await app.inject({
        method: 'POST',
        url: '/api/user/injuries',
        headers: { authorization: `Bearer ${bearer}` },
        payload: { joint: 'knee_left' },
      });

      expect(resp.statusCode).toBe(403);
      expect(resp.json().error).toMatch(/scope_required:health:injuries:write/);
    } finally {
      await app.close();
    }
  });
});
