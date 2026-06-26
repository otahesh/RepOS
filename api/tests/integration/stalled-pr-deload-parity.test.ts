import 'dotenv/config';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stalledPrEvaluator } from '../../src/services/stalledPrEvaluator.js';
import { db } from '../../src/db/client.js';
import {
  seedStalledPrMultiWeekFixture,
  seedUserWithStalledPrFixture,
  cleanupSeeded,
  type StalledPrFixtureHandle,
  type StalledPrMultiWeekFixtureHandle,
} from '../helpers/seed-fixtures.js';

const handles: (StalledPrFixtureHandle | StalledPrMultiWeekFixtureHandle)[] = [];
afterEach(async () => {
  if (handles.length) await cleanupSeeded(handles.splice(0));
});
afterAll(async () => {
  await db.end();
});

describe('W2 — stalledPrEvaluator deload-signal handoff parity', () => {
  it('post-swap evaluator produces output identical to the pre-swap golden fixture (multi-week)', async () => {
    // Load the golden captured pre-swap (Task 2.4.0a). It stores the STABLE
    // exercise slug, not the per-DB-instance UUID, so it survives a reseed.
    const goldenPath = join(__dirname, '../fixtures/stalledPrEvaluator-pre-swap-golden.json');
    const golden = JSON.parse(readFileSync(goldenPath, 'utf-8')) as Array<{
      week: number;
      triggered: boolean;
      exercise_slug: string | null;
    }>;
    expect(golden.length).toBe(5); // 5-week mesocycle

    // Recreate the same seeded run. Weeks 3-4 carry the stalled RIR-0 bench
    // sessions (is_deload=false); week 5 has none. Both pre- and post-swap
    // filterings see the same 3 sessions.
    const seed = await seedStalledPrMultiWeekFixture();
    handles.push(seed);

    for (const g of golden) {
      const res = await stalledPrEvaluator.evaluate({
        userId: seed.userId,
        runId: seed.mesocycleRunId,
        weekIdx: g.week,
      });
      expect(res.triggered, `week ${g.week} triggered parity`).toBe(g.triggered);
      let postSlug: string | null = null;
      if (res.triggered && res.payload?.exercise_id) {
        const { rows } = await db.query<{ slug: string }>(
          `SELECT slug FROM exercises WHERE id = $1`,
          [res.payload.exercise_id as string],
        );
        postSlug = rows[0]?.slug ?? null;
      }
      expect(postSlug, `week ${g.week} exercise_slug parity`).toBe(g.exercise_slug);
    }
  });

  it('triggers when the latest 3 sessions are NOT on a deload day', async () => {
    const seed = await seedUserWithStalledPrFixture({ markLastSessionDeload: false });
    handles.push(seed);
    const res = await stalledPrEvaluator.evaluate({
      userId: seed.userId,
      runId: seed.mesocycleRunId,
      weekIdx: seed.currentWeek,
    });
    expect(res.triggered).toBe(true);
  });

  it('does NOT trigger when ALL 3 latest sessions land on day_workouts marked is_deload=true', async () => {
    const seed = await seedUserWithStalledPrFixture({ markLastSessionDeload: true });
    handles.push(seed);
    const res = await stalledPrEvaluator.evaluate({
      userId: seed.userId,
      runId: seed.mesocycleRunId,
      weekIdx: seed.currentWeek,
    });
    expect(res.triggered).toBe(false);
  });

  it('parity: mid-run RIR-0 fires; deload-week sessions stay silent', async () => {
    // Two seeds with identical set_log shape — only the deload position changes.
    const seedMidRun = await seedUserWithStalledPrFixture({
      sessionsInWeek: 3,
      weeks: 5,
      markLastSessionDeload: false,
    });
    const seedDeloadWeek = await seedUserWithStalledPrFixture({
      sessionsInWeek: 5,
      weeks: 5,
      markLastSessionDeload: true,
    });
    handles.push(seedMidRun, seedDeloadWeek);

    const mid = await stalledPrEvaluator.evaluate({
      userId: seedMidRun.userId,
      runId: seedMidRun.mesocycleRunId,
      weekIdx: 3,
    });
    const dl = await stalledPrEvaluator.evaluate({
      userId: seedDeloadWeek.userId,
      runId: seedDeloadWeek.mesocycleRunId,
      weekIdx: 5,
    });

    expect(mid.triggered).toBe(true); // mid-run RIR-0 fire
    expect(dl.triggered).toBe(false); // deload-week silence
  });
});
