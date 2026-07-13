// Direct unit coverage for services/stats.ts (2026-07-13 quality pass Q8).
// Previously exercised only indirectly through the weight/mesocycles routes,
// leaving the aggregation math unguarded for refactors.
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { computeStats } from '../../src/services/stats.js';
import { mkUser, cleanupUser } from '../helpers/program-fixtures.js';
import { db } from '../../src/db/client.js';

let userId: string;

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

async function insertSample(date: string, weight: number, time = '07:00:00'): Promise<void> {
  await db.query(
    `INSERT INTO health_weight_samples (user_id, sample_date, sample_time, weight_lbs, source)
     VALUES ($1, $2, $3, $4, 'Manual')
     ON CONFLICT (user_id, sample_date, source) DO UPDATE SET weight_lbs = EXCLUDED.weight_lbs`,
    [userId, date, time, weight],
  );
}

beforeAll(async () => {
  const u = await mkUser({ prefix: 'stats' });
  userId = u.id;
});
afterAll(async () => {
  await cleanupUser(userId);
  await db.end();
});

describe('computeStats', () => {
  it('returns empty shape for a user with no samples', async () => {
    const rangeStart = new Date();
    rangeStart.setDate(rangeStart.getDate() - 6);
    const s = await computeStats(userId, rangeStart);
    expect(s.samples).toEqual([]);
    expect(s.current).toBeNull();
    expect(s.trend7d).toBeNull();
    expect(s.trend30d).toBeNull();
    expect(s.trend90d).toBeNull();
    expect(s.adherencePct).toBeNull();
    // Every day in the range is missed (7 inclusive days).
    expect(s.missedDays.length).toBe(7);
  });

  it('computes trend as last-minus-first over the window, 1dp', async () => {
    await insertSample(daysAgo(6), 190.0);
    await insertSample(daysAgo(3), 188.6);
    await insertSample(daysAgo(0), 187.5);

    const rangeStart = new Date();
    rangeStart.setDate(rangeStart.getDate() - 6);
    const s = await computeStats(userId, rangeStart);

    expect(s.samples.length).toBe(3);
    expect(s.current).toMatchObject({ weight_lbs: 187.5 });
    // 187.5 - 190.0 = -2.5 across the 7d window
    expect(s.trend7d).toBe(-2.5);
    // 30d/90d windows contain the same 3 samples → same delta
    expect(s.trend30d).toBe(-2.5);
    expect(s.trend90d).toBe(-2.5);
  });

  it('adherence counts distinct sampled days over the inclusive range', async () => {
    const rangeStart = new Date();
    rangeStart.setDate(rangeStart.getDate() - 6);
    const s = await computeStats(userId, rangeStart);
    // 3 sampled days over a 7-day inclusive range
    expect(s.adherencePct).toBe(+((3 / 7) * 100).toFixed(1));
    expect(s.missedDays.length).toBe(4);
    expect(s.missedDays).not.toContain(daysAgo(0));
    expect(s.missedDays).toContain(daysAgo(1));
  });

  it('current is the latest sample by date then time', async () => {
    await insertSample(daysAgo(0), 187.9, '21:30:00');
    const rangeStart = new Date();
    rangeStart.setDate(rangeStart.getDate() - 6);
    const s = await computeStats(userId, rangeStart);
    // Same-day upsert (dedupe key user/date/source) replaced the morning value.
    expect(s.current).toMatchObject({ weight_lbs: 187.9 });
  });

  it('trend is null with fewer than 2 samples in the window', async () => {
    const fresh = await mkUser({ prefix: 'stats-single' });
    try {
      await db.query(
        `INSERT INTO health_weight_samples (user_id, sample_date, sample_time, weight_lbs, source)
         VALUES ($1, $2, '07:00:00', 200.0, 'Manual')`,
        [fresh.id, daysAgo(1)],
      );
      const rangeStart = new Date();
      rangeStart.setDate(rangeStart.getDate() - 6);
      const s = await computeStats(fresh.id, rangeStart);
      expect(s.trend7d).toBeNull();
      expect(s.current).toMatchObject({ weight_lbs: 200 });
    } finally {
      await cleanupUser(fresh.id);
    }
  });
});
