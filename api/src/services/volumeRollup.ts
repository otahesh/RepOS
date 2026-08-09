// api/src/services/volumeRollup.ts
import { db } from '../db/client.js';
import { MUSCLE_LANDMARKS } from './_muscleLandmarks.js';

export type MuscleVolume = {
  muscle: string;
  /** Planned sum of contributions (fractional). The program-design view. */
  sets: number;
  /**
   * Logged sum of contributions (fractional) attributed to the planned week
   * of the parent day_workout. A Week-2 set_log against a Week-2 planned_set
   * counts toward Week 2 even if it was performed during Week 3 calendar time.
   * Closes the W1 acceptance bullet "MyProgramPage shows volume rollup updated".
   */
  performed_sets: number;
  mev: number;
  mav: number;
  mrv: number;
};

export type WeekVolume = {
  week_idx: number;
  muscles: MuscleVolume[];
  minutes_by_modality: Record<string, number>;
};

export type VolumeRollup = {
  run_id: string;
  weeks: WeekVolume[];
};

export async function computeVolumeRollup(runId: string): Promise<VolumeRollup> {
  // Strength (planned): contribution-weighted sets per muscle per week.
  const { rows: setRows } = await db.query<{
    week_idx: number;
    muscle_slug: string;
    sets: number;
  }>(
    `SELECT dw.week_idx,
            m.slug AS muscle_slug,
            SUM(emc.contribution)::float AS sets
     FROM planned_sets ps
     JOIN day_workouts dw ON dw.id=ps.day_workout_id
     JOIN exercise_muscle_contributions emc ON emc.exercise_id=ps.exercise_id
     JOIN muscles m ON m.id=emc.muscle_id
     WHERE dw.mesocycle_run_id=$1
     GROUP BY dw.week_idx, m.slug
     ORDER BY dw.week_idx, m.slug`,
    [runId],
  );

  // Strength (performed): same contribution math, but counting set_logs
  // attributed to the planned week of their parent day_workout. The set_log's
  // exercise_id (set by the W1.2 POST handler from the planned_set) is what
  // we credit — so logging a substitution into the same planned_set still
  // counts correctly against the substituted exercise's muscles.
  const { rows: performedRows } = await db.query<{
    week_idx: number;
    muscle_slug: string;
    performed_sets: number;
  }>(
    `SELECT dw.week_idx,
            m.slug AS muscle_slug,
            SUM(emc.contribution)::float AS performed_sets
     FROM set_logs sl
     JOIN planned_sets ps ON ps.id = sl.planned_set_id
     JOIN day_workouts dw ON dw.id = ps.day_workout_id
     JOIN exercise_muscle_contributions emc ON emc.exercise_id = sl.exercise_id
     JOIN muscles m ON m.id = emc.muscle_id
     WHERE dw.mesocycle_run_id = $1
     GROUP BY dw.week_idx, m.slug`,
    [runId],
  );
  // Index by (week_idx, muscle_slug) for O(1) lookup during the merge.
  const performedByKey = new Map<string, number>();
  for (const p of performedRows) {
    performedByKey.set(`${p.week_idx}::${p.muscle_slug}`, Number(p.performed_sets));
  }

  // Cardio: minutes per modality per week.
  const { rows: cardioRows } = await db.query<{
    week_idx: number;
    modality_slug: string;
    minutes: number;
  }>(
    `SELECT dw.week_idx,
            e.slug AS modality_slug,
            SUM(COALESCE(pc.target_duration_sec, 0))::float / 60.0 AS minutes
     FROM planned_cardio_blocks pc
     JOIN day_workouts dw ON dw.id=pc.day_workout_id
     JOIN exercises e ON e.id=pc.exercise_id
     WHERE dw.mesocycle_run_id=$1
     GROUP BY dw.week_idx, e.slug
     ORDER BY dw.week_idx, e.slug`,
    [runId],
  );

  // Determine the run's weeks even if some are empty (e.g. all cardio).
  // [C-LANDMARKS-ACTIVE-RUN] ALSO read landmarks_snapshot — the run's
  // MEV/MAV/MRV thresholds must come from the snapshot captured at materialize
  // time, NOT the global MUSCLE_LANDMARKS constant. Otherwise a per-user
  // override would drive planned volume (Task 6) while the displayed threshold
  // line stayed at the default — and a mid-run PATCH could silently shift the
  // threshold the user is training against. Legacy runs (snapshot NULL —
  // materialized before migration 042) fall back to MUSCLE_LANDMARKS.
  const {
    rows: [runMeta],
  } = await db.query<{
    weeks: number;
    landmarks_snapshot: Record<string, { mev: number; mav: number; mrv: number }> | null;
  }>(`SELECT weeks, landmarks_snapshot FROM mesocycle_runs WHERE id=$1`, [runId]);
  const nWeeks = runMeta.weeks;
  const snapshot = runMeta.landmarks_snapshot;

  // Index planned sets the same way for the union below. The merge unions
  // muscle keys from both setRows AND performedRows per week so a logged
  // substitution that credits a muscle no planned_set credits (e.g. a swap
  // surfaced in a later wave) still surfaces in the rollup as a planned=0,
  // performed>0 row instead of being silently dropped.
  const setsByKey = new Map<string, number>();
  for (const r of setRows) {
    setsByKey.set(`${r.week_idx}::${r.muscle_slug}`, Number(r.sets));
  }

  const out: WeekVolume[] = [];
  for (let w = 1; w <= nWeeks; w++) {
    const musclesInWeek = new Set<string>();
    for (const r of setRows) if (r.week_idx === w) musclesInWeek.add(r.muscle_slug);
    for (const r of performedRows) if (r.week_idx === w) musclesInWeek.add(r.muscle_slug);

    const muscles: MuscleVolume[] = Array.from(musclesInWeek)
      .sort()
      .map((slug) => {
        // [C-LANDMARKS-ACTIVE-RUN] Prefer the run's snapshot; fall back to the
        // global default for legacy runs (snapshot NULL).
        let lm = snapshot?.[slug] ?? MUSCLE_LANDMARKS[slug];
        if (!lm) {
          console.warn(`[volumeRollup] muscle '${slug}' has no landmarks; emitting zeros`);
          lm = { mev: 0, mav: 0, mrv: 0 };
        }
        const planned = setsByKey.get(`${w}::${slug}`) ?? 0;
        const performed = performedByKey.get(`${w}::${slug}`) ?? 0;
        return {
          muscle: slug,
          sets: planned,
          performed_sets: performed,
          mev: lm.mev,
          mav: lm.mav,
          mrv: lm.mrv,
        };
      });
    const minutes_by_modality: Record<string, number> = {};
    for (const c of cardioRows) {
      if (c.week_idx === w) minutes_by_modality[c.modality_slug] = Number(c.minutes);
    }
    out.push({ week_idx: w, muscles, minutes_by_modality });
  }

  return { run_id: runId, weeks: out };
}
