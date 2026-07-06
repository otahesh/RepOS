// Central definition of program experience tracks — single source of truth
// for track order, chip color, and the beginner-facing blurb shown wherever
// templates are grouped by track (catalog, onboarding, template detail).
import { TOKENS } from '../tokens';

export type ProgramTrack = 'beginner' | 'intermediate' | 'advanced';

export const PROGRAM_TRACKS: ProgramTrack[] = ['beginner', 'intermediate', 'advanced'];

/** Beginner-track programs replace RIR jargon with plain-language effort cues
 *  and show definitive set counts — per product decision 2026-07-06 ("beginners
 *  have no context or experience to know what RIR even might be for them"). */
export function isBeginnerTrack(track: string | null | undefined): boolean {
  return track === 'beginner';
}

/** Plain-language equivalent of "RIR n" for beginner surfaces. */
export function effortCue(rir: number): string {
  if (rir <= 0) return 'Push to your limit';
  return `Leave ${rir} rep${rir === 1 ? '' : 's'} in the tank`;
}

export const TRACK_META: Record<ProgramTrack, { label: string; color: string; blurb: string }> = {
  beginner: {
    label: 'Beginner',
    color: TOKENS.good,
    blurb: 'New to structured training — start here.',
  },
  intermediate: {
    label: 'Intermediate',
    color: TOKENS.accent,
    blurb: 'Comfortable with the basics, ready for more volume.',
  },
  advanced: {
    label: 'Advanced',
    color: TOKENS.warn,
    blurb: 'Experienced lifters chasing specialization.',
  },
};
