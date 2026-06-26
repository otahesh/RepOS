// api/tests/integration/recovery-flag-overreaching-e2e.test.ts
//
// Beta W3.1 Task 13 — end-to-end recovery-flag flow for the overreaching
// evaluator:
//   1. GET /api/recovery-flags surfaces `overreaching` when the AND-gate
//      conditions hold (>=3 RIR-0 compound sessions in 7d + current-week
//      volume >= MAV) and no dismissal exists for the current ISO week.
//   2. POST /api/recovery-flags/dismiss silences the flag for the remainder
//      of the ISO week — the very next GET no longer lists `overreaching`.
//
// Wire-shape note: the route serializes each flag with a `flag` field (not
// `key`). Internally EvaluatedFlag uses `key` (FIX-6); the route maps it to
// `flag` for the client (see api/src/routes/recoveryFlags.ts line ~81).
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/client.js';
import { seedUserOverreaching, cleanupSeeded, type SeedHandle } from '../helpers/seed-fixtures.js';

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let seed: SeedHandle;
let userId: string;
let token: string;

beforeAll(async () => {
  app = await buildApp();
  seed = await seedUserOverreaching();
  userId = seed.userId;
  token = seed.bearer;
});

afterAll(async () => {
  // Wipe telemetry rows first since recovery_flag_events is keyed on user_id
  // but doesn't cascade through users (it's append-only with its own PK).
  await db.query(`DELETE FROM recovery_flag_events WHERE user_id=$1`, [userId]);
  await cleanupSeeded(seed);
  await app.close();
});

describe('recovery-flag overreaching e2e', () => {
  it('GET shows overreaching when condition true and not dismissed', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/recovery-flags',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json<{ flags: Array<{ flag: string }> }>();
    expect(body.flags.some((f) => f.flag === 'overreaching')).toBe(true);
  });

  it('POST /dismiss silences it for the rest of the ISO week', async () => {
    const dismiss = await app.inject({
      method: 'POST',
      url: '/api/recovery-flags/dismiss',
      headers: { authorization: `Bearer ${token}` },
      payload: { flag: 'overreaching' },
    });
    expect(dismiss.statusCode).toBe(204);

    const r = await app.inject({
      method: 'GET',
      url: '/api/recovery-flags',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json<{ flags: Array<{ flag: string }> }>();
    expect(body.flags.some((f) => f.flag === 'overreaching')).toBe(false);
  });

  it('subsequent GET after dismiss stays silent (re-dismissed = still hidden)', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/recovery-flags',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json<{ flags: Array<{ flag: string }> }>();
    expect(body.flags.some((f) => f.flag === 'overreaching')).toBe(false);
  });
});
