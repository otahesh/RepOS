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
  const out: Array<{ week: number; triggered: boolean; exercise_id: string | null }> = [];
  for (let w = 1; w <= 5; w++) {
    const res = await stalledPrEvaluator.evaluate({
      userId: seed.userId, runId: seed.mesocycleRunId, weekIdx: w,
    });
    out.push({
      week: w,
      triggered: res.triggered,
      exercise_id: res.triggered ? (res.payload?.exercise_id as string ?? null) : null,
    });
  }
  await cleanupSeeded([{ userId: seed.userId }]);
  await db.end();
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
})();
