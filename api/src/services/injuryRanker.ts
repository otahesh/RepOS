// Beta W3.2 — injuryRanker.
//
// [FIX-14] Same-root double-injury: deterministic tiebreaker — sort active
//          injuries alphabetically by joint, then pick the highest weighted
//          penalty (stress_penalty × severity_factor). With equal penalty the
//          alphabetically-first joint wins. Documented because the bilateral
//          mapping (knee_left + knee_right → 'knee' root) is intentional
//          given exercise joint_stress_profile carries no laterality data.
// [FIX-15] joint_stress_profile typed precisely: { _v: number } intersection
//          with Partial<Record<root, 'low'|'mod'|'high'>>.
// [FIX-26] Severity is wired into the penalty calc — low=0.5×, mod=1.0×,
//          high=1.5× multiplier on the stress-based base penalty. Resolves
//          the "severity stored but unused" UX-lie finding.
import { db } from '../db/client.js';
import type { InjuryJoint, InjurySeverity } from '../schemas/userInjuries.js';

const JOINT_ROOT: Record<InjuryJoint, string> = {
  // Bilateral mapping is intentional. Exercise joint_stress_profile carries
  // no laterality — both knees take the penalty for a one-sided knee injury.
  // See [[reference_w3_tuning_candidates]] memory for the future sided-stress
  // data exercise. DO NOT "fix" this by laterality-matching alone — back
  // squat (bilateral lift) would silently skip the penalty.
  shoulder_left:  'shoulder',
  shoulder_right: 'shoulder',
  low_back:       'lumbar',
  knee_left:      'knee',
  knee_right:     'knee',
  elbow:          'elbow',
  wrist:          'wrist',
};

const STRESS_PENALTY = { mod: 150, high: 300 } as const;
const SEVERITY_FACTOR: Record<InjurySeverity, number> = {
  low: 0.5, mod: 1.0, high: 1.5,
};

export function jointRoot(joint: InjuryJoint): string {
  return JOINT_ROOT[joint];
}

export type StressLevel = 'low' | 'mod' | 'high';
export type JointStressProfile = { _v: number } & Partial<Record<string, StressLevel>>;

export type RankerCandidate = {
  id: string; slug: string; name: string;
  score: number; reason: string;
  joint_stress_profile: JointStressProfile;
  injury_advisory?: { joint: InjuryJoint; level: 'mod' | 'high' };
};

export type UserInjuryRow = { joint: InjuryJoint; severity: InjurySeverity };

export async function applyInjuryAdvisory(
  candidates: RankerCandidate[],
  userInjuries: UserInjuryRow[],
): Promise<RankerCandidate[]> {
  if (!userInjuries.length) return candidates;
  // [FIX-14] sort alphabetically for deterministic tiebreaker
  const sortedInjuries = [...userInjuries].sort((a, b) => a.joint.localeCompare(b.joint));
  const out = candidates.map((c) => {
    let bestWeighted = 0;
    let bestTag: RankerCandidate['injury_advisory'];
    for (const injury of sortedInjuries) {
      const root = jointRoot(injury.joint);
      const stress = c.joint_stress_profile[root];
      if (stress === 'mod' || stress === 'high') {
        const weighted = STRESS_PENALTY[stress] * SEVERITY_FACTOR[injury.severity];
        if (weighted > bestWeighted) {
          bestWeighted = weighted;
          bestTag = { joint: injury.joint, level: stress };
        }
      }
    }
    return bestWeighted
      ? { ...c, score: Math.round(c.score - bestWeighted), injury_advisory: bestTag }
      : c;
  });
  return out.sort((a, b) => b.score - a.score);
}

export async function fetchUserInjuries(userId: string): Promise<UserInjuryRow[]> {
  const { rows } = await db.query<UserInjuryRow>(
    `SELECT joint, severity FROM user_injuries WHERE user_id = $1`,
    [userId],
  );
  return rows;
}
