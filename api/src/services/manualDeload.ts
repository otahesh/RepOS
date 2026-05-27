// api/src/services/manualDeload.ts
// Beta W2.5 — manual mid-mesocycle deload service.
// Mutates remaining-week planned_sets in-place + flips day_workouts.is_deload.
// Appends a mesocycle_run_events row of type 'manual_deload' with the
// pre-mutation snapshot in payload — undo restores from that snapshot.
//
// Reduction rule (user decision D3, 2026-05-26):
//   reduced_sets = max(1, floor(muscle_mav * MANUAL_DELOAD_MAV_FACTOR))
//                  where MANUAL_DELOAD_MAV_FACTOR = 0.5
//   target_rir   = MANUAL_DELOAD_RIR = 4
//
// muscle_mav resolves PER-USER per block. W4.3 introduces a per-user resolver
// `resolveUserLandmarks(userId, muscleSlug)`; until it merges, this service
// reads the seeded constant MUSCLE_LANDMARKS[muscleSlug].mav. (We deliberately
// do NOT dynamic-`require` the W4 module — this is an ESM package and the
// resolver isn't in the tree yet; W4 wires it in via a static import when it
// lands.)
//
// "Remaining week" = day_workouts where week_idx >= mesocycle_runs.current_week.
//
// Idempotency: a 'manual_deload' event with no subsequent 'manual_deload_undone'
// row → 409 conflict (already deloaded).
import { db } from '../db/client.js';
import { MANUAL_DELOAD_MAV_FACTOR, MANUAL_DELOAD_RIR } from './_deloadConstants.js';
import { MUSCLE_LANDMARKS } from './_muscleLandmarks.js';

// W4.3 hand-off point: when userLandmarks.ts lands, replace this with a call
// to resolveUserLandmarks(userId, muscleSlug). Until then, the seeded landmark
// is the source of truth.
async function muscleMavForBlock(_userId: string, muscleSlug: string): Promise<number> {
  return (MUSCLE_LANDMARKS as Record<string, { mav: number }>)[muscleSlug]?.mav ?? 10;
}

export class AlreadyDeloadedError extends Error {
  status = 409;
  constructor() { super('manual_deload already applied'); }
}

export class RunNotActiveError extends Error {
  status = 409;
  constructor() { super('mesocycle_run not active'); }
}

export async function applyManualDeload(
  userId: string,
  runId: string,
): Promise<{
  affected_week_idxs: number[];
  affected_day_workouts: number;
  affected_planned_sets: number;
  removed_planned_sets: number;
}> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Ownership + active-run check.
    const { rows: [run] } = await client.query<{ current_week: number; status: string }>(
      `SELECT current_week, status FROM mesocycle_runs WHERE id=$1 AND user_id=$2 FOR UPDATE`,
      [runId, userId],
    );
    if (!run) { await client.query('ROLLBACK'); throw new Error('not_found'); }
    if (run.status !== 'active') { await client.query('ROLLBACK'); throw new RunNotActiveError(); }

    // Already-deloaded check.
    const { rows: priorEvents } = await client.query<{ event_type: string }>(
      `SELECT event_type FROM mesocycle_run_events
        WHERE run_id=$1 AND event_type IN ('manual_deload','manual_deload_undone')
        ORDER BY occurred_at`,
      [runId],
    );
    const lastEvent = priorEvents[priorEvents.length - 1]?.event_type;
    if (lastEvent === 'manual_deload') { await client.query('ROLLBACK'); throw new AlreadyDeloadedError(); }

    // Snapshot pre-mutation planned_sets for the undo payload.
    const { rows: snapshot } = await client.query(
      `SELECT ps.id, ps.day_workout_id, ps.block_idx, ps.set_idx, ps.exercise_id,
              ps.target_reps_low, ps.target_reps_high, ps.target_rir, ps.target_load_hint, ps.rest_sec
       FROM planned_sets ps JOIN day_workouts dw ON dw.id = ps.day_workout_id
       WHERE dw.mesocycle_run_id=$1 AND dw.week_idx >= $2`,
      [runId, run.current_week],
    );

    // Per-block reduced target: floor(muscle_mav * MANUAL_DELOAD_MAV_FACTOR), min 1.
    const blockKeys = new Map<string, { exerciseId: string }>();
    for (const row of snapshot) {
      const key = `${row.day_workout_id}|${row.block_idx}`;
      if (!blockKeys.has(key)) blockKeys.set(key, { exerciseId: row.exercise_id });
    }
    // Resolve each block's muscle MAV. Cache per-muscle.
    const exerciseToMuscle = new Map<string, string>();
    if (blockKeys.size > 0) {
      const exerciseIds = Array.from(new Set(Array.from(blockKeys.values()).map(v => v.exerciseId)));
      const { rows: emRows } = await client.query<{ exercise_id: string; muscle_slug: string }>(
        `SELECT e.id::text AS exercise_id, m.slug AS muscle_slug
           FROM exercises e JOIN muscles m ON m.id = e.primary_muscle_id
          WHERE e.id = ANY($1::uuid[])`,
        [exerciseIds],
      );
      for (const r of emRows) exerciseToMuscle.set(r.exercise_id, r.muscle_slug);
    }
    const muscleMavCache = new Map<string, number>();
    async function getMavForMuscle(muscleSlug: string): Promise<number> {
      const cached = muscleMavCache.get(muscleSlug);
      if (cached !== undefined) return cached;
      const mav = await muscleMavForBlock(userId, muscleSlug);
      muscleMavCache.set(muscleSlug, mav);
      return mav;
    }
    // Build reducedTargets: Map<dayWorkoutId|blockIdx, reducedCount>.
    const reducedTargets = new Map<string, number>();
    for (const [key, v] of blockKeys) {
      const muscleSlug = exerciseToMuscle.get(v.exerciseId) ?? 'chest';
      const mav = await getMavForMuscle(muscleSlug);
      const reduced = Math.max(1, Math.floor(mav * MANUAL_DELOAD_MAV_FACTOR));
      reducedTargets.set(key, reduced);
    }

    // Delete trailing set_idx rows per (day_workout, block) above the new target.
    const reducedKeys = Array.from(reducedTargets.keys());
    const dwIds = reducedKeys.map(k => k.split('|')[0]);
    const blockIdxs = reducedKeys.map(k => Number(k.split('|')[1]));
    const targetCounts = reducedKeys.map(k => reducedTargets.get(k)!);
    const { rowCount: removed } = await client.query(
      `WITH targets AS (
         -- Multi-arg UNNEST cannot carry a column definition list with types;
         -- the ::uuid[]/::int[] casts already type the columns. Name them only.
         SELECT * FROM unnest($1::uuid[], $2::int[], $3::int[])
           AS t(day_workout_id, block_idx, reduced_target)
       ),
       ranked AS (
         SELECT ps.id,
                ROW_NUMBER() OVER (PARTITION BY ps.day_workout_id, ps.block_idx
                                   ORDER BY ps.set_idx) AS rn,
                t.reduced_target
         FROM planned_sets ps
         JOIN day_workouts dw ON dw.id = ps.day_workout_id
         JOIN targets t ON t.day_workout_id = ps.day_workout_id AND t.block_idx = ps.block_idx
         WHERE dw.mesocycle_run_id = $4 AND dw.week_idx >= $5
       )
       DELETE FROM planned_sets ps USING ranked r
        WHERE ps.id = r.id
          AND r.rn > GREATEST(1, r.reduced_target)`,
      [dwIds, blockIdxs, targetCounts, runId, run.current_week],
    );

    // Pin RIR=MANUAL_DELOAD_RIR on remaining sets in deloaded weeks.
    const { rowCount: updated } = await client.query(
      `UPDATE planned_sets ps SET target_rir = $3
        FROM day_workouts dw
        WHERE ps.day_workout_id = dw.id
          AND dw.mesocycle_run_id = $1
          AND dw.week_idx >= $2`,
      [runId, run.current_week, MANUAL_DELOAD_RIR],
    );

    // Flip day_workouts.is_deload for the affected weeks.
    const { rows: dwFlipped } = await client.query<{ week_idx: number }>(
      `UPDATE day_workouts SET is_deload = true
        WHERE mesocycle_run_id=$1 AND week_idx >= $2
        RETURNING week_idx`,
      [runId, run.current_week],
    );

    // Audit row with snapshot payload.
    await client.query(
      `INSERT INTO mesocycle_run_events (run_id, event_type, payload)
       VALUES ($1, 'manual_deload', $2::jsonb)`,
      [runId, JSON.stringify({ from_week: run.current_week, snapshot })],
    );

    await client.query('COMMIT');
    return {
      affected_week_idxs: Array.from(new Set(dwFlipped.map(r => r.week_idx))).sort((a, b) => a - b),
      affected_day_workouts: dwFlipped.length,
      affected_planned_sets: updated ?? 0,
      removed_planned_sets: removed ?? 0,
    };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* */ }
    throw e;
  } finally {
    client.release();
  }
}

// Undo: restores from the most recent 'manual_deload' event payload, but ONLY
// if the event occurred within the last 24 hours. Past the window → 409.
export class UndoWindowExpiredError extends Error {
  status = 409;
  constructor() { super('undo_window_expired'); }
}

export async function undoManualDeload(userId: string, runId: string): Promise<void> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const { rows: [run] } = await client.query(
      `SELECT id FROM mesocycle_runs WHERE id=$1 AND user_id=$2 FOR UPDATE`,
      [runId, userId],
    );
    if (!run) { await client.query('ROLLBACK'); throw new Error('not_found'); }

    const { rows: [event] } = await client.query<{ occurred_at: string; payload: any }>(
      `SELECT occurred_at, payload FROM mesocycle_run_events
        WHERE run_id=$1 AND event_type='manual_deload'
        ORDER BY occurred_at DESC LIMIT 1`,
      [runId],
    );
    if (!event) { await client.query('ROLLBACK'); throw new Error('no_manual_deload'); }

    // 24-hour window check.
    const ageMs = Date.now() - new Date(event.occurred_at).getTime();
    if (ageMs > 24 * 60 * 60 * 1000) {
      await client.query('ROLLBACK');
      throw new UndoWindowExpiredError();
    }

    // Idempotent: if a manual_deload_undone row already exists newer than the
    // manual_deload row, nothing to do.
    const { rows: undoneRows } = await client.query(
      `SELECT 1 FROM mesocycle_run_events
        WHERE run_id=$1 AND event_type='manual_deload_undone'
          AND occurred_at > $2`,
      [runId, event.occurred_at],
    );
    if (undoneRows.length > 0) { await client.query('COMMIT'); return; }

    const snapshot = event.payload?.snapshot ?? [];
    const fromWeek = event.payload?.from_week as number;

    // Delete current planned_sets in the affected weeks.
    await client.query(
      `DELETE FROM planned_sets ps USING day_workouts dw
        WHERE ps.day_workout_id = dw.id
          AND dw.mesocycle_run_id=$1 AND dw.week_idx >= $2`,
      [runId, fromWeek],
    );

    // Restore from snapshot.
    if (snapshot.length > 0) {
      await client.query(
        `INSERT INTO planned_sets
           (id, day_workout_id, block_idx, set_idx, exercise_id,
            target_reps_low, target_reps_high, target_rir, target_load_hint, rest_sec)
         SELECT id, day_workout_id, block_idx, set_idx, exercise_id,
                target_reps_low, target_reps_high, target_rir, target_load_hint, rest_sec
         FROM jsonb_to_recordset($1::jsonb)
              AS t(id uuid, day_workout_id uuid, block_idx int, set_idx int, exercise_id uuid,
                   target_reps_low int, target_reps_high int, target_rir int,
                   target_load_hint text, rest_sec int)`,
        [JSON.stringify(snapshot)],
      );
    }

    // Unflip is_deload — but ONLY back to is_deload=true for the FINAL week
    // (the canonical RP deload week). Intermediate weeks go back to false.
    await client.query(
      `UPDATE day_workouts dw SET is_deload = (dw.week_idx = mr.weeks)
         FROM mesocycle_runs mr
        WHERE dw.mesocycle_run_id = mr.id
          AND mr.id=$1 AND dw.week_idx >= $2`,
      [runId, fromWeek],
    );

    await client.query(
      `INSERT INTO mesocycle_run_events (run_id, event_type, payload)
       VALUES ($1, 'manual_deload_undone', '{}'::jsonb)`,
      [runId],
    );

    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* */ }
    throw e;
  } finally {
    client.release();
  }
}
