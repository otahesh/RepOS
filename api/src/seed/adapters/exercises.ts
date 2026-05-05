import type { PoolClient } from 'pg';
import { z } from 'zod';
import { ExerciseSeedSchema, type ExerciseSeed } from '../../schemas/exerciseSeed.js';
import { validateSeed } from '../validate.js';
import type { SeedAdapter } from '../runSeed.js';

const ExerciseSeedArraySchema = z.array(ExerciseSeedSchema)
  .superRefine((arr, ctx) => {
    const result = validateSeed(arr);
    if (!result.ok) for (const msg of result.errors) {
      ctx.addIssue({ code: 'custom', message: msg, path: [] });
    }
  });

let muscleIdsCache: Map<string, number> | null = null;
async function loadMuscleIds(tx: PoolClient): Promise<Map<string, number>> {
  if (muscleIdsCache) return muscleIdsCache;
  const { rows } = await tx.query<{ slug: string; id: number }>(`SELECT slug, id FROM muscles`);
  muscleIdsCache = new Map(rows.map(r => [r.slug, r.id]));
  return muscleIdsCache;
}

export function makeExerciseSeedAdapter(key: string): SeedAdapter<ExerciseSeed> {
  return {
    validate: (entries) => ExerciseSeedArraySchema.safeParse(entries),
    upsertOne: async (tx, e, generation) => {
      const muscles = await loadMuscleIds(tx);
      const primary_muscle_id = muscles.get(e.primary_muscle)!;
      const parent_id = e.parent_slug
        ? (await tx.query<{ id: string }>(`SELECT id FROM exercises WHERE slug=$1`, [e.parent_slug])).rows[0]?.id ?? null
        : null;

      const { rows: [row] } = await tx.query<{ id: string }>(
        `INSERT INTO exercises (
           slug, name, parent_exercise_id, primary_muscle_id, movement_pattern,
           peak_tension_length, required_equipment, skill_complexity, loading_demand,
           systemic_fatigue, joint_stress_profile, eccentric_overload_capable,
           contraindications, requires_shoulder_flexion_overhead,
           loads_spine_in_flexion, loads_spine_axially, requires_hip_internal_rotation,
           requires_ankle_dorsiflexion, requires_wrist_extension_loaded,
           created_by, seed_key, seed_generation, archived_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5::movement_pattern,$6::peak_tension_length,$7::jsonb,
           $8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17,$18,$19,
           'system',$20,$21,NULL,now()
         )
         ON CONFLICT (slug) DO UPDATE SET
           name=EXCLUDED.name,
           parent_exercise_id=EXCLUDED.parent_exercise_id,
           primary_muscle_id=EXCLUDED.primary_muscle_id,
           movement_pattern=EXCLUDED.movement_pattern,
           peak_tension_length=EXCLUDED.peak_tension_length,
           required_equipment=EXCLUDED.required_equipment,
           skill_complexity=EXCLUDED.skill_complexity,
           loading_demand=EXCLUDED.loading_demand,
           systemic_fatigue=EXCLUDED.systemic_fatigue,
           joint_stress_profile=EXCLUDED.joint_stress_profile,
           eccentric_overload_capable=EXCLUDED.eccentric_overload_capable,
           contraindications=EXCLUDED.contraindications,
           requires_shoulder_flexion_overhead=EXCLUDED.requires_shoulder_flexion_overhead,
           loads_spine_in_flexion=EXCLUDED.loads_spine_in_flexion,
           loads_spine_axially=EXCLUDED.loads_spine_axially,
           requires_hip_internal_rotation=EXCLUDED.requires_hip_internal_rotation,
           requires_ankle_dorsiflexion=EXCLUDED.requires_ankle_dorsiflexion,
           requires_wrist_extension_loaded=EXCLUDED.requires_wrist_extension_loaded,
           seed_key=EXCLUDED.seed_key,
           seed_generation=EXCLUDED.seed_generation,
           archived_at=NULL,
           updated_at=now()
         RETURNING id`,
        [
          e.slug, e.name, parent_id, primary_muscle_id, e.movement_pattern,
          e.peak_tension_length, JSON.stringify(e.required_equipment),
          e.skill_complexity, e.loading_demand, e.systemic_fatigue,
          JSON.stringify(e.joint_stress_profile), e.eccentric_overload_capable,
          e.contraindications, e.requires_shoulder_flexion_overhead,
          e.loads_spine_in_flexion, e.loads_spine_axially,
          e.requires_hip_internal_rotation, e.requires_ankle_dorsiflexion,
          e.requires_wrist_extension_loaded, key, generation,
        ],
      );
      await tx.query(`DELETE FROM exercise_muscle_contributions WHERE exercise_id=$1`, [row.id]);
      for (const [m, c] of Object.entries(e.muscle_contributions)) {
        await tx.query(
          `INSERT INTO exercise_muscle_contributions (exercise_id, muscle_id, contribution) VALUES ($1,$2,$3)`,
          [row.id, muscles.get(m)!, c],
        );
      }
    },
    archiveMissing: async (tx, seedKey, generation) => {
      // Equivalent to "slug NOT IN (current entries)": runSeed is the sole writer
      // per seed_key and serializes on the transaction, so any row whose
      // seed_generation is older than the just-bumped generation was not re-upserted.
      const { rowCount } = await tx.query(
        `UPDATE exercises SET archived_at=now()
         WHERE created_by='system' AND archived_at IS NULL AND seed_key=$1
           AND seed_generation IS NOT NULL AND seed_generation < $2`,
        [seedKey, generation],
      );
      return rowCount ?? 0;
    },
  };
}
