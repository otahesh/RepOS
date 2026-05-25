// api/tests/services/overreachingEvaluator.test.ts
//
// Beta W3.1 — overreachingEvaluator strict AND-gate. Four scenarios:
//   1. ALL conditions met (3 RIR-0 compound sessions/7d + week >= MAV) → fires
//   2. only 2 RIR-0 compound sessions    → does NOT fire (gate 1 fails)
//   3. 3 RIR-0 isolation-pattern sessions → does NOT fire (gate 1 fails)
//   4. 3 RIR-0 compound but volume < MAV → does NOT fire (gate 2 fails)

import 'dotenv/config';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { overreachingEvaluator } from '../../src/services/overreachingEvaluator.js';
import {
  seedUserOverreaching,
  seedOverreachingPartial,
  cleanupSeeded,
  type SeedHandle,
} from '../helpers/seed-fixtures.js';
import { db } from '../../src/db/client.js';

const handles: SeedHandle[] = [];
afterEach(async () => {
  if (handles.length) await cleanupSeeded(handles.splice(0));
});
afterAll(async () => {
  await db.end();
});

describe('overreachingEvaluator (W3.1 AND-gate)', () => {
  it('fires when ALL conditions met (>=3 RIR-0 compound sessions/7d AND week >= MAV)', async () => {
    const seed = await seedUserOverreaching();
    handles.push(seed);
    const r = await overreachingEvaluator.evaluate({
      userId: seed.userId,
      runId: seed.mesocycleRunId,
      weekIdx: 0,
    });
    expect(r.triggered).toBe(true);
    if (r.triggered) {
      expect(r.message).toMatch(/deload|heavy|overreach/i);
    }
  });

  it('does NOT fire when only 2 RIR-0 compound sessions / 7d', async () => {
    const seed = await seedOverreachingPartial({ rir0Sessions: 2 });
    handles.push(seed);
    const r = await overreachingEvaluator.evaluate({
      userId: seed.userId,
      runId: seed.mesocycleRunId,
      weekIdx: 0,
    });
    expect(r.triggered).toBe(false);
  });

  it('does NOT fire when 3 RIR-0 sessions are on non-compound (isolation) exercises', async () => {
    const seed = await seedOverreachingPartial({ exerciseType: 'isolation' });
    handles.push(seed);
    const r = await overreachingEvaluator.evaluate({
      userId: seed.userId,
      runId: seed.mesocycleRunId,
      weekIdx: 0,
    });
    expect(r.triggered).toBe(false);
  });

  it('does NOT fire when 3 RIR-0 compound sessions but current-week volume < MAV', async () => {
    const seed = await seedOverreachingPartial({ underMav: true });
    handles.push(seed);
    const r = await overreachingEvaluator.evaluate({
      userId: seed.userId,
      runId: seed.mesocycleRunId,
      weekIdx: 0,
    });
    expect(r.triggered).toBe(false);
  });
});
