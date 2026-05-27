import { fetchUserInjuries, JOINT_ROOT } from './injuryRanker.js';
import { computeMuscleJointRoots } from './muscleJointStress.js';

export type InjuryConstraint = { joint: string; level: 'low' | 'mod' | 'high' };

// [I-INJURY-OVERLAY-COPY] Derive named injury constraints server-side so the
// LandmarksEditor can render `⚠ left knee (high)` chips. For each muscle that
// is joint-stressed at a root the user is injured at, report the HIGHEST-
// severity injury on that root (so the soft-cap math uses the worst case).
//
// Reuses the SAME constants the /api/muscles/joint-stress endpoint exposes
// (JOINT_ROOT + MUSCLE_JOINT_ROOTS) — single server-side source of truth.
//
// `joint` in the output is the ORIGINAL lateralized injury joint (e.g.
// 'knee_left'), so the chip names the specific injury; `level` is its severity.
const SEVERITY_RANK: Record<'low' | 'mod' | 'high', number> = { low: 0, mod: 1, high: 2 };

export async function deriveInjuryConstraints(
  userId: string,
): Promise<Record<string, InjuryConstraint>> {
  const injuries = await fetchUserInjuries(userId);
  if (injuries.length === 0) return {};

  const muscleRoots = await computeMuscleJointRoots(); // { chest: ['elbow','shoulder'], ... }

  // root → best (highest-severity) injury touching that root
  const bestByRoot = new Map<string, InjuryConstraint>();
  for (const inj of injuries) {
    const root = JOINT_ROOT[inj.joint];
    if (!root) continue;
    const candidate: InjuryConstraint = { joint: inj.joint, level: inj.severity };
    const prev = bestByRoot.get(root);
    if (!prev || SEVERITY_RANK[candidate.level] > SEVERITY_RANK[prev.level]) {
      bestByRoot.set(root, candidate);
    }
  }

  const out: Record<string, InjuryConstraint> = {};
  for (const [muscle, roots] of Object.entries(muscleRoots)) {
    let best: InjuryConstraint | undefined;
    for (const root of roots) {
      const c = bestByRoot.get(root);
      if (c && (!best || SEVERITY_RANK[c.level] > SEVERITY_RANK[best.level])) best = c;
    }
    if (best) out[muscle] = best;
  }
  return out;
}
