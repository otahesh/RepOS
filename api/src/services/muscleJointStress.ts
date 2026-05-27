import { db } from '../db/client.js';
import { JOINT_ROOT } from './injuryRanker.js';

export { JOINT_ROOT };

// Group exercises by primary_muscle slug; project joint_stress_profile keys
// where stress >= 'mod' (i.e. moderately or more joint-stressing).
//
// DEVIATION FROM PLAN PSEUDOCODE (documented): the plan's draft mapped each
// profile key through JOINT_ROOT[joint]. But the seeded
// exercises.joint_stress_profile JSONB is ALREADY keyed by joint ROOTS
// (e.g. { _v: 1, shoulder: 'mod', elbow: 'mod', knee: 'mod', lumbar: 'mod',
// wrist: 'mod' }) — NOT by lateralized joints. JOINT_ROOT, by contrast, is
// keyed by lateralized joints (shoulder_left → 'shoulder'); JOINT_ROOT['shoulder']
// is undefined. So we add the profile keys DIRECTLY (they are already roots).
// JOINT_ROOT is still used by deriveInjuryConstraints, where user_injuries.joint
// IS lateralized and needs root-mapping.
//
// Result: { chest: ['elbow', 'shoulder', ...], quads: ['knee', 'lumbar', ...] }.
export async function computeMuscleJointRoots(): Promise<Record<string, string[]>> {
  const { rows } = await db.query<{ slug: string; profile: Record<string, string> }>(
    `SELECT m.slug, e.joint_stress_profile AS profile
     FROM exercises e JOIN muscles m ON m.id = e.primary_muscle_id
     WHERE e.joint_stress_profile IS NOT NULL`,
  );
  const out: Record<string, Set<string>> = {};
  for (const r of rows) {
    const set = out[r.slug] ??= new Set();
    for (const [joint, level] of Object.entries(r.profile ?? {})) {
      if (joint === '_v') continue;
      if (level === 'mod' || level === 'high') {
        // The profile keys are joint roots already — add directly.
        set.add(joint);
      }
    }
  }
  const final: Record<string, string[]> = {};
  for (const slug of Object.keys(out)) final[slug] = [...out[slug]].sort();
  return final;
}

export async function getMuscleJointStressCatalog() {
  return {
    JOINT_ROOT,
    MUSCLE_JOINT_ROOTS: await computeMuscleJointRoots(),
  };
}
