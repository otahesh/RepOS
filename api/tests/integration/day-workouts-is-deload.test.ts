import 'dotenv/config';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { materializeMesocycle } from '../../src/services/materializeMesocycle.js';
import { db } from '../../src/db/client.js';
import { seedUserProgram, cleanupSeeded, type SeedHandle } from '../helpers/seed-fixtures.js';

const handles: SeedHandle[] = [];
afterEach(async () => {
  if (handles.length) await cleanupSeeded(handles.splice(0));
});
afterAll(async () => {
  await db.end();
});

describe('W2 — is_deload populated by materializeMesocycle', () => {
  it('week N rows have is_deload=true, weeks 1..N-1 have is_deload=false', async () => {
    const seed = await seedUserProgram(); // 5-week program template
    handles.push(seed);
    const { run_id } = await materializeMesocycle({
      userProgramId: seed.userProgramId,
      startDate: '2026-06-01',
      startTz: 'UTC',
    });
    const { rows } = await db.query<{ week_idx: number; is_deload: boolean }>(
      'SELECT week_idx, is_deload FROM day_workouts WHERE mesocycle_run_id=$1',
      [run_id],
    );
    const byWeek = new Map<number, boolean[]>();
    for (const r of rows) {
      const arr = byWeek.get(r.week_idx) ?? [];
      arr.push(r.is_deload);
      byWeek.set(r.week_idx, arr);
    }
    // Final week is_deload all true; earlier weeks all false.
    const weeks = [...byWeek.keys()].sort((a, b) => a - b);
    expect(weeks.length).toBeGreaterThan(1);
    const finalWeek = weeks[weeks.length - 1];
    for (const w of weeks) {
      const expected = w === finalWeek;
      for (const b of byWeek.get(w)!) expect(b).toBe(expected);
    }
  });
});
