import { createHash } from 'crypto';
import { db } from '../db/client.js';
import { validateSeed } from './validate.js';
import type { ExerciseSeed } from '../schemas/exerciseSeed.js';

export type RunSeedInput = { key: string; entries: ExerciseSeed[] };
export type RunSeedResult =
  | { applied: false; reason: 'hash_unchanged'; generation: number }
  | { applied: true; upserted: number; archived: number; generation: number };

export async function runSeed(input: RunSeedInput): Promise<RunSeedResult> {
  const validation = validateSeed(input.entries);
  if (!validation.ok) {
    throw new Error(`seed validation failed:\n${validation.errors.join('\n')}`);
  }

  const hash = createHash('sha256')
    .update(JSON.stringify(input.entries))
    .digest('hex');

  const client = await db.connect();
  try {
    const { rows: [meta] } = await client.query<{ hash: string; generation: number }>(
      `SELECT hash, generation FROM _seed_meta WHERE key=$1`, [input.key]
    );
    if (meta && meta.hash === hash) {
      return { applied: false, reason: 'hash_unchanged', generation: meta.generation };
    }

    await client.query('BEGIN');
    try {
      const generation = (meta?.generation ?? 0) + 1;
      const muscleIdBySlug = await loadMuscleIds(client);

      let upserted = 0;
      for (const e of input.entries) {
        const primary_muscle_id = muscleIdBySlug.get(e.primary_muscle)!;
        const parent_id = e.parent_slug
          ? (await client.query<{ id: string }>(
              `SELECT id FROM exercises WHERE slug=$1`, [e.parent_slug])).rows[0]?.id ?? null
          : null;

        const { rows: [row] } = await client.query<{ id: string }>(
          `INSERT INTO exercises (
             slug, name, parent_exercise_id, primary_muscle_id, movement_pattern,
             peak_tension_length, required_equipment, skill_complexity, loading_demand,
             systemic_fatigue, joint_stress_profile, eccentric_overload_capable,
             contraindications, requires_shoulder_flexion_overhead,
             loads_spine_in_flexion, loads_spine_axially, requires_hip_internal_rotation,
             requires_ankle_dorsiflexion, requires_wrist_extension_loaded,
             created_by, seed_generation, archived_at, updated_at
           ) VALUES (
             $1,$2,$3,$4,$5::movement_pattern,$6::peak_tension_length,$7::jsonb,
             $8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17,$18,$19,
             'system',$20,NULL,now()
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
            e.requires_wrist_extension_loaded, generation,
          ],
        );
        await client.query(`DELETE FROM exercise_muscle_contributions WHERE exercise_id=$1`, [row.id]);
        for (const [m, c] of Object.entries(e.muscle_contributions)) {
          await client.query(
            `INSERT INTO exercise_muscle_contributions (exercise_id, muscle_id, contribution)
             VALUES ($1, $2, $3)`,
            [row.id, muscleIdBySlug.get(m)!, c],
          );
        }
        upserted++;
      }

      const slugs = input.entries.map(e => e.slug);
      const { rowCount: archived } = await client.query(
        `UPDATE exercises SET archived_at=now()
         WHERE created_by='system' AND archived_at IS NULL
           AND slug NOT IN (${slugs.map((_, i) => `$${i + 1}`).join(',')})
           AND seed_generation IS NOT NULL`,
        slugs,
      );

      await client.query(
        `INSERT INTO _seed_meta (key, hash, generation)
         VALUES ($1,$2,$3)
         ON CONFLICT (key) DO UPDATE SET
           hash=EXCLUDED.hash, generation=EXCLUDED.generation, applied_at=now()`,
        [input.key, hash, generation],
      );

      await client.query('COMMIT');
      return { applied: true, upserted, archived: archived ?? 0, generation };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  } finally {
    client.release();
  }
}

async function loadMuscleIds(client: any): Promise<Map<string, number>> {
  const { rows } = await client.query<{ slug: string; id: number }>(
    `SELECT slug, id FROM muscles`,
  );
  return new Map(rows.map(r => [r.slug, r.id]));
}
