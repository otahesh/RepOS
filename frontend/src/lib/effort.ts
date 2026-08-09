import type { TodaySet } from './api/mesocycles';

// =============================================================================
// effort.ts — THE single conversion seam between stored proximity-to-failure
// (rir, effort-descending, the DB unit for targets AND performed effort) and
// displayed RPE (effort-ascending) on duration sets. If you need `10 - rir`
// anywhere else, import from here instead — a second conversion site is how
// a unit bug ships. [measurement-model design v2 §fix-4]
// =============================================================================

export function rpeFromRir(rir: number): number {
  return 10 - rir;
}

export function rirFromRpe(rpe: number): number {
  return 10 - rpe;
}

/**
 * Which input mode a planned row renders. Derives from the row's OWN populated
 * targets — never from exercise.measurement — so rows materialized before an
 * exercise was reclassified (e.g. the in-flight production run's side-plank
 * sets) keep rendering as they were prescribed. exercise.measurement is for
 * materialization, seeds, and substitution filtering only. [design v2 §fix-1]
 */
export function rowMode(set: Pick<TodaySet, 'target_duration_low_sec'>): 'reps' | 'duration' {
  return set.target_duration_low_sec != null ? 'duration' : 'reps';
}
