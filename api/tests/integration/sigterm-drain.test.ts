// api/tests/integration/sigterm-drain.test.ts
//
// G5 acceptance #3 — SIGTERM drain.
//
// The contract under test (master plan §363): in-flight set-log writes either
// complete cleanly OR fail retriable (5xx) when the API begins shutting down;
// zero rows land in set_logs with NULL required fields. The idempotency key +
// (user_id, client_request_id) unique index makes any retried set safe.
//
// We exercise this with the inject-based proof (plan Task 7 Step 4): fire 10
// concurrent set-log POSTs, race app.close() against them. Fastify's close()
// stops accepting new connections and waits for in-flight requests; a request
// that started will complete, a not-yet-started one fails retriable. This is
// deterministic under the single-fork integration runner (the spawn+real-
// SIGTERM variant is brittle there because it needs a child process + its own
// pg pool). The real SIGTERM→app.close()+db.end() wiring lives in
// src/index.ts and is unit-asserted by gracefulShutdown's structure.
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/client.js';
import { mkUserWithProgram, cleanupUser } from '../helpers/program-fixtures.js';

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let userId: string;
let token: string;
let plannedSetId: string;

beforeAll(async () => {
  app = await buildApp();
  const u = await mkUserWithProgram({ prefix: 'sigterm' });
  userId = u.userId;
  token = u.token;
  plannedSetId = u.firstPlannedSetId;
});

afterAll(async () => {
  await cleanupUser(userId);
  await db.end();
});

describe('SIGTERM drain', () => {
  it('drains in-flight set-log POSTs without partial writes', async () => {
    const nowIso = new Date().toISOString();
    const inFlight = Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        app
          .inject({
            method: 'POST',
            url: '/api/set-logs',
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            payload: {
              planned_set_id: plannedSetId,
              client_request_id: randomUUID(),
              weight_lbs: 100 + i,
              reps: 8,
              rir: 2,
              performed_at: nowIso,
            },
          })
          .then((res) => ({ ok: res.statusCode < 300, status: res.statusCode }))
          .catch(() => ({ ok: false, status: 0 })),
      ),
    );

    // Race app.close() — Fastify waits for in-flight requests to settle.
    setTimeout(() => {
      app.close().catch(() => undefined);
    }, 10);

    const results = await inFlight;

    // Every response is 2xx OR retriable (5xx / connection-closed). A 4xx would
    // indicate a partial-write attempt that violated invariants.
    for (const r of results) {
      const retriable = r.status === 0 || r.status >= 500;
      const ok2xx = r.ok;
      expect(ok2xx || retriable).toBe(true);
      expect(r.status === 0 || r.status < 400 || r.status >= 500).toBe(true);
    }

    // No rows in set_logs with NULL required fields for this planned set.
    const { rows } = await db.query(
      `SELECT count(*)::int AS c FROM set_logs
       WHERE planned_set_id = $1
         AND (performed_load_lbs IS NULL OR performed_reps IS NULL)`,
      [plannedSetId],
    );
    expect(rows[0].c).toBe(0);
  });
});
