import 'dotenv/config';
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { db } from '../../src/db/client.js';
import { runSeed } from '../../src/seed/runSeed.js';
import type { ExerciseSeed } from '../../src/schemas/exerciseSeed.js';

const A: ExerciseSeed = {
  slug: 'runner-test-a', name: 'A', primary_muscle: 'chest',
  muscle_contributions: { chest: 1.0 },
  movement_pattern: 'push_horizontal', peak_tension_length: 'mid',
  required_equipment: { _v: 1, requires: [] },
  skill_complexity: 1, loading_demand: 1, systemic_fatigue: 1,
  joint_stress_profile: { _v: 1 }, eccentric_overload_capable: false,
  contraindications: [], requires_shoulder_flexion_overhead: false,
  loads_spine_in_flexion: false, loads_spine_axially: false,
  requires_hip_internal_rotation: false, requires_ankle_dorsiflexion: false,
  requires_wrist_extension_loaded: false,
};

const B: ExerciseSeed = { ...A, slug: 'runner-test-b', name: 'B' };

beforeAll(async () => {
  await db.query(`DELETE FROM exercises WHERE slug LIKE 'runner-test-%'`);
  await db.query(`DELETE FROM _seed_meta WHERE key = 'runner-test'`);
});
afterAll(async () => {
  await db.query(`DELETE FROM exercises WHERE slug LIKE 'runner-test-%'`);
  await db.query(`DELETE FROM _seed_meta WHERE key = 'runner-test'`);
  await db.end();
});

describe('runSeed', () => {
  it('first run inserts entries and writes _seed_meta', async () => {
    const r = await runSeed({ key: 'runner-test', entries: [A, B] });
    expect(r.applied).toBe(true);
    expect(r.upserted).toBe(2);
    expect(r.archived).toBe(0);
    const { rows } = await db.query(
      `SELECT slug FROM exercises WHERE slug LIKE 'runner-test-%' ORDER BY slug`
    );
    expect(rows.map(r => r.slug)).toEqual(['runner-test-a','runner-test-b']);
  });

  it('second run with identical input skips (hash match)', async () => {
    const r = await runSeed({ key: 'runner-test', entries: [A, B] });
    expect(r.applied).toBe(false);
    expect(r.reason).toBe('hash_unchanged');
  });

  it('removing entry B soft-archives it; A stays', async () => {
    const r = await runSeed({ key: 'runner-test', entries: [A] });
    expect(r.applied).toBe(true);
    expect(r.archived).toBe(1);
    const { rows } = await db.query(
      `SELECT slug, archived_at IS NOT NULL AS archived FROM exercises
       WHERE slug LIKE 'runner-test-%' ORDER BY slug`
    );
    expect(rows).toEqual([
      { slug: 'runner-test-a', archived: false },
      { slug: 'runner-test-b', archived: true },
    ]);
  });
});
