// api/tests/routes/recoveryFlags.test.ts
// HTTP integration tests for GET /api/recovery-flags.
// Kept in a separate file from api/tests/recoveryFlags.test.ts (unit tests)
// to avoid collision with the top-level beforeEach(_resetRegistryForTest) there.

import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/client.js';
import { mkUser, mkTemplate, mkUserProgram, cleanupUser, cleanupTemplate } from '../helpers/program-fixtures.js';
import { recordDismissal } from '../../src/services/recoveryFlagDismissals.js';

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let userId: string;
let token: string;

// Helpers for goal=cut test
let cutUserId: string;
let cutTemplateId: string;
let cutToken: string;

beforeAll(async () => {
  app = await buildApp();

  // ---- Primary user (for trigger + dismissed tests) ----
  const u = await mkUser({ prefix: 'vitest.rf-route' });
  userId = u.id;

  const mint = await app.inject({
    method: 'POST',
    url: '/api/tokens',
    body: { user_id: userId, label: 'rf-route-test' },
  });
  token = mint.json<{ token: string }>().token;

  // Seed weight data: 8 days descending so trend ≤ -2.0 (same pattern as unit test)
  // i=0 → 7 days ago (oldest), i=7 → today
  for (let i = 0; i < 8; i++) {
    await db.query(
      `INSERT INTO health_weight_samples (user_id, sample_date, sample_time, weight_lbs, source)
       VALUES ($1, (CURRENT_DATE - ($2::int * INTERVAL '1 day'))::date, '08:00', $3, 'Manual')
       ON CONFLICT (user_id, sample_date, source) DO UPDATE SET weight_lbs=EXCLUDED.weight_lbs`,
      [userId, 7 - i, 200 - i * 0.5],
    );
  }

  // ---- Cut-goal user ----
  const cu = await mkUser({ prefix: 'vitest.rf-route-cut' });
  cutUserId = cu.id;

  const cutMint = await app.inject({
    method: 'POST',
    url: '/api/tokens',
    body: { user_id: cutUserId, label: 'rf-route-cut-test' },
  });
  cutToken = cutMint.json<{ token: string }>().token;

  // Seed same crashing weight data for cut user
  for (let i = 0; i < 8; i++) {
    await db.query(
      `INSERT INTO health_weight_samples (user_id, sample_date, sample_time, weight_lbs, source)
       VALUES ($1, (CURRENT_DATE - ($2::int * INTERVAL '1 day'))::date, '08:00', $3, 'Manual')
       ON CONFLICT (user_id, sample_date, source) DO UPDATE SET weight_lbs=EXCLUDED.weight_lbs`,
      [cutUserId, 7 - i, 200 - i * 0.5],
    );
  }

  // Seed cut-goal user with an active mesocycle_run + user_program (goal='cut')
  const tpl = await mkTemplate({
    prefix: 'vitest-rf-cut',
    structure: { days: [{ idx: 0, day_offset: 0, blocks: [] }] },
    weeks: 4,
    daysPerWeek: 1,
  });
  cutTemplateId = tpl.id;

  const up = await mkUserProgram({
    userId: cutUserId,
    templateId: tpl.id,
    status: 'active',
  });

  // Set customizations.goal = 'cut'
  await db.query(
    `UPDATE user_programs SET customizations = $1::jsonb WHERE id = $2`,
    [JSON.stringify({ goal: 'cut' }), up.id],
  );

  // Insert active mesocycle_run for cut user
  await db.query(
    `INSERT INTO mesocycle_runs (user_program_id, user_id, start_date, start_tz, weeks, status)
     VALUES ($1, $2, CURRENT_DATE, 'UTC', 4, 'active')`,
    [up.id, cutUserId],
  );
});

afterAll(async () => {
  await cleanupUser(userId);
  await cleanupUser(cutUserId);
  await cleanupTemplate(cutTemplateId);
  await app.close();
  await db.end();
});

const auth = (t: string) => ({ authorization: `Bearer ${t}` });

describe('GET /api/recovery-flags', () => {
  it('returns bodyweight_crash flag when trend ≤ -2.0 and no cut goal', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/recovery-flags',
      headers: auth(token),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json<{ flags: Array<{ flag: string; message: string; trend_7d_lbs?: number }> }>();
    expect(Array.isArray(body.flags)).toBe(true);
    const crash = body.flags.find(f => f.flag === 'bodyweight_crash');
    expect(crash).toBeDefined();
    expect(crash!.message).toMatch(/dropping/i);
    expect(typeof crash!.trend_7d_lbs).toBe('number');
    expect(crash!.trend_7d_lbs).toBeLessThanOrEqual(-2.0);
  });

  it('filters out a dismissed flag for the current week', async () => {
    // Compute current ISO-week Monday as YYYY-MM-DD
    const { rows: [{ week_start }] } = await db.query<{ week_start: string }>(
      `SELECT to_char(date_trunc('week', current_date)::date, 'YYYY-MM-DD') AS week_start`,
    );
    await recordDismissal({ userId, flag: 'bodyweight_crash', weekStart: week_start });

    const r = await app.inject({
      method: 'GET',
      url: '/api/recovery-flags',
      headers: auth(token),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json<{ flags: Array<{ flag: string }> }>();
    const crash = body.flags.find(f => f.flag === 'bodyweight_crash');
    expect(crash).toBeUndefined();
  });

  it('suppresses bodyweight_crash when active program goal is cut', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/recovery-flags',
      headers: auth(cutToken),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json<{ flags: Array<{ flag: string }> }>();
    const crash = body.flags.find(f => f.flag === 'bodyweight_crash');
    expect(crash).toBeUndefined();
  });

  it('returns 401 without auth', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/recovery-flags',
    });
    expect(r.statusCode).toBe(401);
  });
});
