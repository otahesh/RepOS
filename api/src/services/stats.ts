import { db } from '../db/client.js';

export async function computeStats(userId: string, rangeStart: Date) {
  const { rows: samples } = await db.query(
    `SELECT sample_date::text AS date, weight_lbs::float AS weight_lbs, source
     FROM health_weight_samples
     WHERE user_id = $1 AND sample_date >= $2
     ORDER BY sample_date ASC`,
    [userId, rangeStart],
  );

  const { rows: [current] } = await db.query(
    `SELECT weight_lbs::float AS weight_lbs, sample_date::text AS date, sample_time::text AS time
     FROM health_weight_samples
     WHERE user_id = $1
     ORDER BY sample_date DESC, sample_time DESC LIMIT 1`,
    [userId],
  );

  // Trend: delta over a fixed window back from today
  const trendDelta = async (days: number) => {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const { rows } = await db.query(
      `SELECT weight_lbs::float AS w FROM health_weight_samples
       WHERE user_id = $1 AND sample_date >= $2
       ORDER BY sample_date ASC`,
      [userId, since],
    );
    if (rows.length < 2) return null;
    return +(rows[rows.length - 1].w - rows[0].w).toFixed(1);
  };

  const [trend7d, trend30d, trend90d] = await Promise.all([
    trendDelta(7), trendDelta(30), trendDelta(90),
  ]);

  // Adherence and missed days over the requested range
  const totalDays = Math.round((Date.now() - rangeStart.getTime()) / 86_400_000) + 1;
  const datesWithSample = new Set(samples.map((s: any) => s.date));
  const missedDays: string[] = [];
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(rangeStart);
    d.setDate(d.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    if (!datesWithSample.has(iso)) missedDays.push(iso);
  }
  const adherencePct = datesWithSample.size > 0
    ? +((datesWithSample.size / totalDays) * 100).toFixed(1)
    : null;

  return { samples, current: current ?? null, trend7d, trend30d, trend90d, adherencePct, missedDays };
}
