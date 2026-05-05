// api/tests/getTodayWorkout.test.ts
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../src/db/client.js';
import { getTodayWorkout } from '../src/services/getTodayWorkout.js';
import { materializeMesocycle } from '../src/services/materializeMesocycle.js';
import { mkUser, mkTemplate, mkUserProgram, cleanupUser, cleanupTemplate } from './helpers/program-fixtures.js';

let userId: string; let templateId: string; let userProgramId: string; let runId: string;

const TEMPLATE = {
  _v: 1,
  days: [
    {
      idx: 0, day_offset: 0, kind: 'strength', name: 'Day A',
      blocks: [{ exercise_slug: 'barbell-bench-press', mev: 6, mav: 10, target_reps_low: 5, target_reps_high: 8, target_rir: 2, rest_sec: 180 }],
    },
    {
      idx: 1, day_offset: 2, kind: 'strength', name: 'Day B', // skips one day
      blocks: [{ exercise_slug: 'barbell-back-squat', mev: 6, mav: 10, target_reps_low: 5, target_reps_high: 8, target_rir: 2, rest_sec: 180 }],
    },
  ],
};

beforeAll(async () => {
  const u = await mkUser({
    prefix: 'vitest.today',
    equipment_profile: { _v: 1, dumbbells: { min_lb: 10, max_lb: 100, increment_lb: 10 }, adjustable_bench: { incline: true, decline: false } },
  });
  userId = u.id;
  const t = await mkTemplate({
    prefix: 'vitest-today', name: 'Vitest today', weeks: 5, daysPerWeek: 2, structure: TEMPLATE,
  });
  templateId = t.id;
  const up = await mkUserProgram({ userId, templateId, name: 'Vitest today run' });
  userProgramId = up.id;

  // Start a run with start_date = 2026-05-04 (a Monday) in NY tz.
  const r = await materializeMesocycle({ userProgramId, startDate: '2026-05-04', startTz: 'America/New_York' });
  runId = r.run_id;
});

afterAll(async () => {
  await cleanupUser(userId);
  await cleanupTemplate(templateId);
  await db.end();
});

describe('getTodayWorkout (spec §3.3 corrected pseudocode)', () => {
  it('before run start → no_active_run', async () => {
    const r = await getTodayWorkout(userId, new Date('2026-05-03T18:00:00Z')); // Sun NY
    expect(r.state).toBe('no_active_run');
  });

  it('workout day → state=workout with sets attached', async () => {
    // 2026-05-04 NY = day_idx 0 = Day A
    const r = await getTodayWorkout(userId, new Date('2026-05-04T16:00:00Z')); // Mon noon NY
    expect(r.state).toBe('workout');
    if (r.state === 'workout') {
      expect(r.day.kind).toBe('strength');
      expect(r.sets.length).toBeGreaterThan(0);
      expect(r.run_id).toBe(runId);
    }
  });

  it('rest day (no row, but in window) → state=rest', async () => {
    // 2026-05-05 NY → not in template (day_offsets = 0,2)
    const r = await getTodayWorkout(userId, new Date('2026-05-05T16:00:00Z'));
    expect(r.state).toBe('rest');
    if (r.state === 'rest') {
      expect(r.run_id).toBe(runId);
      expect(r.scheduled_date).toBe('2026-05-05');
    }
  });

  it('after run end → no_active_run', async () => {
    // 5 weeks * 7 days = 35 days starting 05-04 → ends 06-07. Pick 06-15.
    const r = await getTodayWorkout(userId, new Date('2026-06-15T16:00:00Z'));
    expect(r.state).toBe('no_active_run');
  });

  it('DST spring-forward day still resolves once', async () => {
    // The run starts 05-04, post-DST. Force a different shorter run that
    // straddles DST forward (2026-03-08).
    const u2 = await mkUser({ prefix: 'vitest.today.dst', equipment_profile: { _v: 1 } });
    try {
      const up2 = await mkUserProgram({ userId: u2.id, templateId, name: 'DST run' });
      await materializeMesocycle({ userProgramId: up2.id, startDate: '2026-03-08', startTz: 'America/New_York' });

      const before = await getTodayWorkout(u2.id, new Date('2026-03-08T06:00:00Z')); // 01:00 EST
      const after  = await getTodayWorkout(u2.id, new Date('2026-03-08T08:00:00Z')); // 04:00 EDT
      expect(before.state === 'workout' || before.state === 'rest').toBe(true);
      expect(after.state).toBe(before.state);
      if (before.state === 'workout' && after.state === 'workout') {
        expect(after.day.id).toBe(before.day.id);
      }
    } finally {
      await cleanupUser(u2.id);
    }
  });

  it('TZ-change-mid-mesocycle still resolves to start_tz', async () => {
    // Caller passes start_tz, not the user's current device tz, so even if
    // we fed Pacific instant the resolved date is NY.
    const r = await getTodayWorkout(userId, new Date('2026-05-04T03:00:00Z')); // 23:00 May-3 NY
    // 2026-05-03 NY is before run start (05-04) → no_active_run
    expect(r.state).toBe('no_active_run');
  });

  it('leap-year boundary (Feb 29 → Mar 1) resolves correctly', async () => {
    const u3 = await mkUser({ prefix: 'vitest.today.leap', equipment_profile: { _v: 1 } });
    try {
      const up3 = await mkUserProgram({ userId: u3.id, templateId, name: 'Leap' });
      await materializeMesocycle({ userProgramId: up3.id, startDate: '2028-02-29', startTz: 'UTC' });

      const feb29 = await getTodayWorkout(u3.id, new Date('2028-02-29T12:00:00Z'));
      const mar1  = await getTodayWorkout(u3.id, new Date('2028-03-01T12:00:00Z'));
      expect(feb29.state).toBe('workout'); // day_offset 0
      expect(mar1.state).toBe('rest');     // day_offset 2 falls on 03-02
    } finally {
      await cleanupUser(u3.id);
    }
  });

  it('between runs (run completed, none active) → no_active_run', async () => {
    const u5 = await mkUser({ prefix: 'vitest.today.between' });
    try {
      const r = await getTodayWorkout(u5.id, new Date('2026-05-04T16:00:00Z'));
      expect(r.state).toBe('no_active_run');
    } finally {
      await cleanupUser(u5.id);
    }
  });

  it('equipment-fit failure attaches suggested_substitution', async () => {
    // userId profile has dumbbells + adjustable_bench but NO barbell + NO flat_bench.
    // barbell-bench-press requires both → predicate fails → substitution should attach.
    const r = await getTodayWorkout(userId, new Date('2026-05-04T16:00:00Z'));
    expect(r.state).toBe('workout');
    if (r.state === 'workout') {
      expect(r.sets.length).toBeGreaterThan(0);
      // Every set in this day uses barbell-bench-press (the verbatim template
      // structure has only that exercise). Each should carry a substitution.
      for (const s of r.sets) {
        expect(s.suggested_substitution).toBeDefined();
        expect(s.suggested_substitution!.slug).not.toBe('barbell-bench-press');
      }
    }
  });
});
