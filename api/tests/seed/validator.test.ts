import { describe, it, expect } from 'vitest';
import { validateSeed } from '../../src/seed/validate.js';
import type { ExerciseSeed } from '../../src/schemas/exerciseSeed.js';

const ok: ExerciseSeed = {
  slug: 'barbell-bench-press',
  name: 'Barbell Bench Press',
  primary_muscle: 'chest',
  muscle_contributions: { chest: 1.0, triceps: 0.5, front_delt: 0.5 },
  movement_pattern: 'push_horizontal',
  peak_tension_length: 'mid',
  required_equipment: { _v: 1, requires: [{ type: 'barbell' }, { type: 'flat_bench' }] },
  skill_complexity: 3, loading_demand: 4, systemic_fatigue: 3,
  joint_stress_profile: { _v: 1, shoulder: 'mod', elbow: 'mod', wrist: 'mod' },
  eccentric_overload_capable: false,
  contraindications: ['shoulder_impingement'],
  requires_shoulder_flexion_overhead: false,
  loads_spine_in_flexion: false,
  loads_spine_axially: false,
  requires_hip_internal_rotation: false,
  requires_ankle_dorsiflexion: false,
  requires_wrist_extension_loaded: true,
};

describe('validateSeed', () => {
  it('valid single-entry seed passes', () => {
    expect(validateSeed([ok])).toEqual({ ok: true });
  });

  it('detects duplicate slugs', () => {
    const r = validateSeed([ok, { ...ok, name: 'Dup' }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/duplicate slug/i);
  });

  it('detects parent-cycle (a → b → a)', () => {
    const a: ExerciseSeed = { ...ok, slug: 'a', parent_slug: 'b' };
    const b: ExerciseSeed = { ...ok, slug: 'b', parent_slug: 'a' };
    const r = validateSeed([a, b]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/cycle/i);
  });

  it('detects parent_slug pointing to a missing slug', () => {
    const r = validateSeed([{ ...ok, parent_slug: 'does-not-exist' }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/parent_slug.*does-not-exist/);
  });

  it('detects unknown muscle slug in contributions', () => {
    const bad = { ...ok, muscle_contributions: { chest: 1.0, soleus: 0.5 } as any };
    const r = validateSeed([bad]);
    expect(r.ok).toBe(false);
  });

  it('detects unknown predicate type in required_equipment', () => {
    const bad = { ...ok, required_equipment: { _v: 1, requires: [{ type: 'unobtanium' }] } as any };
    const r = validateSeed([bad]);
    expect(r.ok).toBe(false);
  });

  it('detects contribution sum outside 0.8–4.0', () => {
    const bad = { ...ok, muscle_contributions: { chest: 1.0, triceps: 1.0, front_delt: 1.0, biceps: 1.0, lats: 0.5 } };
    const r = validateSeed([bad]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/contribution sum/i);
  });

  it('detects primary_muscle without contribution = 1.0', () => {
    const bad = { ...ok, muscle_contributions: { chest: 0.5, triceps: 0.5 } };
    const r = validateSeed([bad]);
    expect(r.ok).toBe(false);
  });
});
