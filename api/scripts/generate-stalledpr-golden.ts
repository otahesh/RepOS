// api/scripts/generate-stalledpr-golden.ts
// Run with:
//   cd api && tsx scripts/generate-stalledpr-golden.ts > tests/fixtures/stalledPrEvaluator-pre-swap-golden.json
//
// Captures the PRE-SWAP stalledPrEvaluator output (triggered + exercise_id) per
// week 1..5 of the multi-week fixture. stalledPrEvaluator.ts has NOT been
// touched since HEAD d5110bc (verified via git log), so the current evaluator
// IS the pre-swap version — running this BEFORE applying the Task 2.4.3 swap
// produces the same golden the plan's d5110bc capture would. Do NOT re-run
// after the swap.
import 'dotenv/config';
import { stalledPrEvaluator } from '../src/services/stalledPrEvaluator.js';
import { seedStalledPrMultiWeekFixture, cleanupSeeded } from '../tests/helpers/seed-fixtures.js';
import { db } from '../src/db/client.js';

(async () => {
  const seed = await seedStalledPrMultiWeekFixture();
  // Resolve the fired exercise to its STABLE slug (not the per-DB-instance
  // UUID, which changes on every reseed). The golden therefore survives a
  // DROP SCHEMA + reseed: parity compares triggered + exercise_slug.
  const out: Array<{ week: number; triggered: boolean; exercise_slug: string | null }> = [];
  for (let w = 1; w <= 5; w++) {
    const res = await stalledPrEvaluator.evaluate({
      userId: seed.userId,
      runId: seed.mesocycleRunId,
      weekIdx: w,
    });
    let slug: string | null = null;
    if (res.triggered && res.payload?.exercise_id) {
      const { rows } = await db.query<{ slug: string }>(
        `SELECT slug FROM exercises WHERE id = $1`,
        [res.payload.exercise_id as string],
      );
      slug = rows[0]?.slug ?? null;
    }
    out.push({ week: w, triggered: res.triggered, exercise_slug: slug });
  }
  await cleanupSeeded([{ userId: seed.userId }]);
  await db.end();
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
})();
