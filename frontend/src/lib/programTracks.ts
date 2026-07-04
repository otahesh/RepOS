// Central definition of program experience tracks — single source of truth
// for track order, chip color, and the beginner-facing blurb shown wherever
// templates are grouped by track (catalog, onboarding, template detail).
import { TOKENS } from '../tokens';

export type ProgramTrack = 'beginner' | 'intermediate' | 'advanced';

export const PROGRAM_TRACKS: ProgramTrack[] = ['beginner', 'intermediate', 'advanced'];

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
