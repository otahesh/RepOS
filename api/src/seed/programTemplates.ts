// File: api/src/seed/programTemplates.ts
// Curated v1 program lineup. Three templates: full-body-3-day, upper-lower-4-day, strength-cardio-3+2.
// Auto-ramp materializer expands these template-week structures across N weeks at run-start.
// MEV/MAV per block are inputs the materializer reads; do not pre-expand here.

import type { ProgramTemplateSeed } from '../schemas/programTemplate.js';

export const programTemplates: ProgramTemplateSeed[] = [
  {
    slug: 'full-body-3-day',
    name: 'Full Body 3-Day Foundation',
    description:
      'Three full-body sessions per week (Mon/Wed/Fri). Best for beginners and time-limited trainees. Equipment minimum: dumbbells + adjustable bench.',
    weeks: 5,
    days_per_week: 3,
    structure: {
      _v: 1,
      days: [
        {
          idx: 0,
          day_offset: 0,
          kind: 'strength',
          name: 'Full Body A',
          blocks: [
            { exercise_slug: 'dumbbell-goblet-squat',        mev: 2, mav: 4, target_reps_low: 8,  target_reps_high: 10, target_rir: 2, rest_sec: 150 },
            { exercise_slug: 'dumbbell-bench-press',         mev: 2, mav: 4, target_reps_low: 8,  target_reps_high: 10, target_rir: 2, rest_sec: 150 },
            { exercise_slug: 'chest-supported-dumbbell-row', mev: 2, mav: 4, target_reps_low: 8,  target_reps_high: 12, target_rir: 2, rest_sec: 120 },
            { exercise_slug: 'dumbbell-curl',                mev: 2, mav: 3, target_reps_low: 10, target_reps_high: 15, target_rir: 1, rest_sec: 90  },
          ],
        },
        {
          idx: 1,
          day_offset: 2,
          kind: 'strength',
          name: 'Full Body B',
          blocks: [
            { exercise_slug: 'dumbbell-romanian-deadlift',  mev: 2, mav: 4, target_reps_low: 8,  target_reps_high: 12, target_rir: 2, rest_sec: 150 },
            { exercise_slug: 'dumbbell-shoulder-press-seated', mev: 2, mav: 4, target_reps_low: 8,  target_reps_high: 10, target_rir: 2, rest_sec: 120 },
            { exercise_slug: 'dumbbell-row-1arm',           mev: 2, mav: 4, target_reps_low: 8,  target_reps_high: 12, target_rir: 2, rest_sec: 120 },
            { exercise_slug: 'dumbbell-skull-crusher',      mev: 2, mav: 3, target_reps_low: 10, target_reps_high: 12, target_rir: 1, rest_sec: 90  },
          ],
        },
        {
          idx: 2,
          day_offset: 4,
          kind: 'strength',
          name: 'Full Body C',
          blocks: [
            { exercise_slug: 'dumbbell-bulgarian-split-squat', mev: 2, mav: 4, target_reps_low: 8,  target_reps_high: 12, target_rir: 2, rest_sec: 120 },
            { exercise_slug: 'incline-dumbbell-bench-press',   mev: 2, mav: 4, target_reps_low: 8,  target_reps_high: 12, target_rir: 2, rest_sec: 120 },
            { exercise_slug: 'dumbbell-rear-delt-raise',       mev: 2, mav: 3, target_reps_low: 12, target_reps_high: 15, target_rir: 1, rest_sec: 60  },
            { exercise_slug: 'dumbbell-lateral-raise',         mev: 2, mav: 3, target_reps_low: 12, target_reps_high: 15, target_rir: 1, rest_sec: 60  },
          ],
        },
      ],
    },
  },
  // upper-lower-4-day appended in D.7
  // strength-cardio-3+2 appended in D.8
];
