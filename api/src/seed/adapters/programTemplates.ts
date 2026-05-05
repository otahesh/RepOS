import type { PoolClient } from 'pg';
import { z } from 'zod';
import {
  ProgramTemplateSeedSchema,
  type ProgramTemplateSeed,
} from '../../schemas/programTemplate.js';
import type { SeedAdapter } from '../runSeed.js';

const ProgramTemplateSeedArraySchema = z.array(ProgramTemplateSeedSchema);

// Canonical-key JSON: deterministic key order, used for structure-changed comparison.
function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalize(obj[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

export const programTemplateSeedAdapter: SeedAdapter<ProgramTemplateSeed> = {
  validate: (entries) => ProgramTemplateSeedArraySchema.safeParse(entries),

  upsertOne: async (tx, e, generation) => {
    // Look up existing structure to decide if version bumps.
    const { rows: existing } = await tx.query<{ structure: unknown; version: number }>(
      `SELECT structure, version FROM program_templates WHERE slug=$1`, [e.slug]
    );
    let nextVersion = 1;
    if (existing[0]) {
      const oldCanon = canonicalize(existing[0].structure);
      const newCanon = canonicalize(e.structure);
      nextVersion = oldCanon === newCanon ? existing[0].version : existing[0].version + 1;
    }

    await tx.query(
      `INSERT INTO program_templates (
         slug, name, description, weeks, days_per_week, structure, version,
         created_by, seed_key, seed_generation, archived_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,'system',$8,$9,NULL,now())
       ON CONFLICT (slug) DO UPDATE SET
         name=EXCLUDED.name,
         description=EXCLUDED.description,
         weeks=EXCLUDED.weeks,
         days_per_week=EXCLUDED.days_per_week,
         structure=EXCLUDED.structure,
         version=EXCLUDED.version,
         seed_key=EXCLUDED.seed_key,
         seed_generation=EXCLUDED.seed_generation,
         archived_at=NULL,
         updated_at=now()`,
      [e.slug, e.name, e.description ?? '', e.weeks, e.days_per_week,
       JSON.stringify(e.structure), nextVersion, 'program_templates', generation],
    );
  },

  archiveMissing: async (tx, key, generation) => {
    const { rowCount } = await tx.query(
      `UPDATE program_templates SET archived_at=now(), updated_at=now()
       WHERE created_by='system' AND archived_at IS NULL AND seed_key=$1
         AND seed_generation IS NOT NULL AND seed_generation < $2`,
      [key, generation],
    );
    return rowCount ?? 0;
  },
};
