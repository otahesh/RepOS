// api/src/services/volumeRollup.ts
import { db } from '../db/client.js';
import { MUSCLE_LANDMARKS } from './_muscleLandmarks.js';

export type MuscleVolume = {
  muscle: string;
  sets: number;            // sum of contributions, fractional
  mev: number; mav: number; mrv: number;
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
  // Strength: contribution-weighted sets per muscle per week.
  const { rows: setRows } = await db.query<{
    week_idx: number; muscle_slug: string; sets: number;
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

  // Cardio: minutes per modality per week.
  const { rows: cardioRows } = await db.query<{
    week_idx: number; modality_slug: string; minutes: number;
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
  const { rows: [{ weeks: nWeeks }] } = await db.query<{ weeks: number }>(
    `SELECT weeks FROM mesocycle_runs WHERE id=$1`, [runId],
  );

  const out: WeekVolume[] = [];
  for (let w = 1; w <= nWeeks; w++) {
    const muscles: MuscleVolume[] = setRows
      .filter(r => r.week_idx === w)
      .map(r => {
        let lm = MUSCLE_LANDMARKS[r.muscle_slug];
        if (!lm) {
          console.warn(`[volumeRollup] muscle '${r.muscle_slug}' has no landmarks; emitting zeros`);
          lm = { mev: 0, mav: 0, mrv: 0 };
        }
        return { muscle: r.muscle_slug, sets: Number(r.sets), mev: lm.mev, mav: lm.mav, mrv: lm.mrv };
      });
    const minutes_by_modality: Record<string, number> = {};
    for (const c of cardioRows) {
      if (c.week_idx === w) minutes_by_modality[c.modality_slug] = Number(c.minutes);
    }
    out.push({ week_idx: w, muscles, minutes_by_modality });
  }

  return { run_id: runId, weeks: out };
}
