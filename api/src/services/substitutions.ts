import { db } from '../db/client.js';
import type { PredicateT } from '../schemas/predicate.js';
import { allPredicatesSatisfied } from './_equipmentPredicate.js';
import { applyInjuryAdvisory, fetchUserInjuries, type JointStressProfile } from './injuryRanker.js';
import type { InjuryJoint } from '../schemas/userInjuries.js';

export type SubResult = {
  from: { slug: string; name: string };
  subs: Array<{
    id: string;
    slug: string;
    name: string;
    score: number;
    reason: string;
    /**
     * Beta W3.2 — set when this candidate's `joint_stress_profile` overlaps
     * one of the caller's recorded injuries at mod or high stress. Omitted
     * when no userId was passed (e.g. unit tests, anonymous callers) or when
     * no overlap exists.
     */
    injury_advisory?: { joint: InjuryJoint; level: 'mod' | 'high' };
  }>;
  truncated: boolean;
  total_matches?: number;
  reason?: 'no_equipment_profile' | 'no_equipment_match';
  closest_partial?: { slug: string; name: string };
};

const TRUNCATION = 25;
const SCORE_FLOOR = 100;

export async function findSubstitutions(
  targetSlug: string,
  userEquipmentProfile: Record<string, unknown>,
  // [FIX-12] Optional — preserves the 2-arg call sites in tests
  // (`tests/substitutions.test.ts`) and keeps unit-level invocations free of
  // DB-injury-fetch overhead. When provided, the W3.2 injuryRanker tags +
  // demotes candidates whose joint stress overlaps the user's recorded
  // injuries; when undefined, the ranker is skipped entirely.
  userId?: string,
): Promise<SubResult | null> {
  const {
    rows: [target],
  } = await db.query<{
    id: string;
    name: string;
    movement_pattern: string;
    primary_muscle_id: number;
    measurement: 'reps' | 'duration';
  }>(
    `SELECT id, name, movement_pattern, primary_muscle_id, measurement
     FROM exercises WHERE slug=$1 AND archived_at IS NULL`,
    [targetSlug],
  );
  if (!target) return null;

  const onlyV = Object.keys(userEquipmentProfile).filter((k) => k !== '_v').length === 0;
  if (onlyV) {
    return {
      from: { slug: targetSlug, name: target.name },
      subs: [],
      truncated: false,
      reason: 'no_equipment_profile',
    };
  }

  // Single query: fetch all candidates with scores computed inline via
  // correlated subquery for overlap. Eliminates the N+1 per-candidate
  // overlap queries that existed before. Predicate satisfaction stays in TS
  // where it's already correct and well-tested (Path C).
  // [FIX-13] Extend SELECT with `e.joint_stress_profile` so the injuryRanker
  // can read per-joint stress without a second round-trip per candidate.
  const { rows: candidates } = await db.query<{
    id: string;
    slug: string;
    name: string;
    movement_pattern: string;
    primary_muscle_id: number;
    required_equipment: { _v: number; requires: PredicateT[] };
    joint_stress_profile: JointStressProfile;
    pattern_score: number;
    primary_score: number;
    overlap_score: number;
  }>(
    `SELECT
       e.id, e.slug, e.name, e.movement_pattern, e.primary_muscle_id,
       e.required_equipment, e.joint_stress_profile,
       ((e.movement_pattern = $2)::int * 1000) AS pattern_score,
       ((e.primary_muscle_id = $3)::int * 500) AS primary_score,
       COALESCE((
         SELECT (SUM(LEAST(t.contribution, c.contribution)) * 100)::int
         FROM exercise_muscle_contributions t
         JOIN exercise_muscle_contributions c
           ON c.exercise_id = e.id AND c.muscle_id = t.muscle_id
         WHERE t.exercise_id = $1
       ), 0) AS overlap_score
     FROM exercises e
     WHERE e.id <> $1 AND e.archived_at IS NULL
       -- Cross-measurement swaps are forbidden: the substitute endpoint keeps
       -- the old row's targets, so a duration exercise on a reps slot (or vice
       -- versa) would strand mismatched targets. Pattern match is a score, not
       -- a filter — this must be a hard predicate.
       AND e.measurement = $4`,
    [target.id, target.movement_pattern, target.primary_muscle_id, target.measurement],
  );

  const profile = userEquipmentProfile;

  const passing = candidates
    .filter((c) =>
      allPredicatesSatisfied((c.required_equipment?.requires ?? []) as PredicateT[], profile),
    )
    .map((c) => {
      const score = c.pattern_score + c.primary_score + c.overlap_score;
      let reason = '';
      if (c.pattern_score > 0) {
        reason = 'Same pattern';
      }
      if (c.primary_score > 0) {
        reason = reason ? `${reason} · same primary` : 'Same primary muscle';
      }
      if (!reason) reason = 'Muscle overlap';
      return { ...c, score, reason };
    })
    .filter((c) => c.score >= SCORE_FLOOR)
    .sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug));

  if (passing.length === 0) {
    // Score-based closest_partial: highest-scored candidate from the full
    // set (equipment-agnostic), so the suggestion is relevant not alphabetical.
    const closestPartial = candidates
      .map((c) => ({ ...c, score: c.pattern_score + c.primary_score + c.overlap_score }))
      .filter((c) => c.score >= SCORE_FLOOR)
      .sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug))[0];

    return {
      from: { slug: targetSlug, name: target.name },
      subs: [],
      truncated: false,
      reason: 'no_equipment_match',
      closest_partial: closestPartial
        ? { slug: closestPartial.slug, name: closestPartial.name }
        : undefined,
    };
  }

  // [FIX-12] Apply injury awareness only when a userId is supplied. The
  // ranker is idempotent on empty injuries (returns its input untouched), but
  // we skip the DB round-trip in the common no-userId case (unit tests, anon
  // callers). When applied, `applyInjuryAdvisory` re-sorts by post-penalty
  // score, so we re-truncate from its output rather than from `passing`.
  const ranked = userId
    ? await applyInjuryAdvisory(
        passing.map((c) => ({
          id: c.id,
          slug: c.slug,
          name: c.name,
          score: c.score,
          reason: c.reason,
          joint_stress_profile: c.joint_stress_profile,
        })),
        await fetchUserInjuries(userId),
      )
    : passing;

  const sliced = ranked.slice(0, TRUNCATION);
  return {
    from: { slug: targetSlug, name: target.name },
    subs: sliced.map((s) => ({
      id: s.id,
      slug: s.slug,
      name: s.name,
      score: s.score,
      reason: s.reason,
      ...('injury_advisory' in s && s.injury_advisory
        ? { injury_advisory: s.injury_advisory }
        : {}),
    })),
    truncated: passing.length > TRUNCATION,
    ...(passing.length > TRUNCATION ? { total_matches: passing.length } : {}),
  };
}
