// Beta W4.4 Task 13 — [I-MID-RUN-RECOVERY-RESET].
//
// Contract (as the schema actually implements it — see
// api/src/services/recoveryFlagDismissals.ts): recovery-flag dismissals
// correlate by (user_id, flag, week_start), where week_start is the Monday of
// the ISO week the flag fired. They are explicitly NOT scoped to
// mesocycle_run_id. So a dismissal recorded under a PRIOR ISO week's Monday
// does NOT suppress the same flag evaluated in the CURRENT ISO week — the week
// boundary resets the dismissal context. A new mesocycle run started later is
// in a new ISO week, so its week-1 flags are not pre-silenced by a prior
// week's dismissal.
//
// DEVIATION NOTE: the plan skeleton phrased the correlation as
// (user_id, run_id, week_start), but recovery_flag_dismissals has NO run_id
// column. This test asserts the real (week_start-based) reset semantics, which
// satisfy the user-facing intent ("a fresh run/week is not pre-dismissed").
import 'dotenv/config';
import { describe, it, expect, afterEach } from 'vitest';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/client.js';
import { seedUserOverreaching, cleanupSeeded, type SeedHandle } from '../helpers/seed-fixtures.js';

type App = Awaited<ReturnType<typeof buildApp>>;
const seeds: SeedHandle[] = [];
let app: App | undefined;

afterEach(async () => {
  for (const s of seeds.splice(0)) {
    await db.query(`DELETE FROM recovery_flag_events WHERE user_id=$1`, [s.userId]);
    await db.query(`DELETE FROM recovery_flag_dismissals WHERE user_id=$1`, [s.userId]);
    await cleanupSeeded(s);
  }
  if (app) {
    await app.close();
    app = undefined;
  }
});

describe('recovery_flag_events — dismissals reset on new week/run [I-MID-RUN-RECOVERY-RESET]', () => {
  it('a dismissal stored under a PRIOR ISO week does NOT suppress the flag this week', async () => {
    app = await buildApp();
    const seed = await seedUserOverreaching();
    seeds.push(seed);

    // Record a dismissal keyed to LAST week's Monday (a prior run/week).
    await db.query(
      `INSERT INTO recovery_flag_dismissals (user_id, flag, week_start)
       VALUES ($1, 'overreaching', (date_trunc('week', current_date) - interval '7 days')::date)`,
      [seed.userId],
    );

    // The route consults isDismissed with the CURRENT week's Monday — the prior
    // week's dismissal must NOT match, so the flag is still surfaced.
    const r = await app.inject({
      method: 'GET',
      url: '/api/recovery-flags',
      headers: { authorization: `Bearer ${seed.bearer}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json<{ flags: Array<{ flag: string }> }>();
    expect(body.flags.some((f) => f.flag === 'overreaching')).toBe(true);
  });

  it('a dismissal stored under the CURRENT ISO week DOES suppress the flag (control)', async () => {
    app = await buildApp();
    const seed = await seedUserOverreaching();
    seeds.push(seed);

    await db.query(
      `INSERT INTO recovery_flag_dismissals (user_id, flag, week_start)
       VALUES ($1, 'overreaching', date_trunc('week', current_date)::date)`,
      [seed.userId],
    );

    const r = await app.inject({
      method: 'GET',
      url: '/api/recovery-flags',
      headers: { authorization: `Bearer ${seed.bearer}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json<{ flags: Array<{ flag: string }> }>();
    expect(body.flags.some((f) => f.flag === 'overreaching')).toBe(false);
  });
});
