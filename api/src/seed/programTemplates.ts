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
  {
    slug: 'upper-lower-4-day',
    name: 'Upper / Lower 4-Day Hypertrophy',
    description:
      'Mon Upper Heavy / Tue Lower Heavy / Thu Upper Volume / Fri Lower Volume. The canonical RP shape for intermediate hypertrophy. Equipment minimum: garage gym (barbell, rack, dumbbells, adjustable bench, pull-up bar).',
    weeks: 5,
    days_per_week: 4,
    structure: {
      _v: 1,
      days: [
        {
          idx: 0,
          day_offset: 0,
          kind: 'strength',
          name: 'Upper Heavy',
          blocks: [
            { exercise_slug: 'barbell-bench-press',            mev: 3, mav: 5, target_reps_low: 5,  target_reps_high: 7,  target_rir: 2, rest_sec: 180 },
            { exercise_slug: 'barbell-bent-over-row',          mev: 3, mav: 5, target_reps_low: 6,  target_reps_high: 8,  target_rir: 2, rest_sec: 180 },
            { exercise_slug: 'barbell-overhead-press-standing',mev: 2, mav: 4, target_reps_low: 6,  target_reps_high: 8,  target_rir: 2, rest_sec: 150 },
            { exercise_slug: 'dumbbell-curl',                  mev: 2, mav: 3, target_reps_low: 8,  target_reps_high: 12, target_rir: 1, rest_sec: 90  },
            { exercise_slug: 'dumbbell-skull-crusher',         mev: 2, mav: 3, target_reps_low: 8,  target_reps_high: 12, target_rir: 1, rest_sec: 90  },
          ],
        },
        {
          idx: 1,
          day_offset: 1,
          kind: 'strength',
          name: 'Lower Heavy',
          blocks: [
            { exercise_slug: 'barbell-back-squat',           mev: 3, mav: 5, target_reps_low: 5,  target_reps_high: 7,  target_rir: 2, rest_sec: 210 },
            { exercise_slug: 'barbell-romanian-deadlift',    mev: 2, mav: 4, target_reps_low: 6,  target_reps_high: 8,  target_rir: 2, rest_sec: 180 },
            { exercise_slug: 'dumbbell-bulgarian-split-squat',mev: 2, mav: 3, target_reps_low: 8,  target_reps_high: 10, target_rir: 2, rest_sec: 120 },
            { exercise_slug: 'dumbbell-standing-calf-raise', mev: 2, mav: 3, target_reps_low: 10, target_reps_high: 15, target_rir: 1, rest_sec: 60  },
          ],
        },
        {
          idx: 2,
          day_offset: 3,
          kind: 'strength',
          name: 'Upper Volume',
          blocks: [
            { exercise_slug: 'incline-dumbbell-bench-press', mev: 3, mav: 5, target_reps_low: 8,  target_reps_high: 12, target_rir: 1, rest_sec: 120 },
            { exercise_slug: 'pullup',                       mev: 3, mav: 5, target_reps_low: 6,  target_reps_high: 10, target_rir: 1, rest_sec: 150 },
            { exercise_slug: 'dumbbell-lateral-raise',       mev: 3, mav: 5, target_reps_low: 12, target_reps_high: 15, target_rir: 1, rest_sec: 60  },
            { exercise_slug: 'dumbbell-rear-delt-raise',     mev: 3, mav: 4, target_reps_low: 12, target_reps_high: 15, target_rir: 1, rest_sec: 60  },
            { exercise_slug: 'dumbbell-hammer-curl',         mev: 2, mav: 3, target_reps_low: 10, target_reps_high: 15, target_rir: 1, rest_sec: 75  },
          ],
        },
        {
          idx: 3,
          day_offset: 4,
          kind: 'strength',
          name: 'Lower Volume',
          blocks: [
            { exercise_slug: 'dumbbell-romanian-deadlift', mev: 3, mav: 5, target_reps_low: 8,  target_reps_high: 12, target_rir: 1, rest_sec: 150 },
            { exercise_slug: 'dumbbell-walking-lunge',     mev: 2, mav: 4, target_reps_low: 10, target_reps_high: 12, target_rir: 1, rest_sec: 120 },
            { exercise_slug: 'dumbbell-hip-thrust',        mev: 3, mav: 5, target_reps_low: 8,  target_reps_high: 12, target_rir: 1, rest_sec: 120 },
            { exercise_slug: 'dumbbell-standing-calf-raise',mev: 3, mav: 4, target_reps_low: 12, target_reps_high: 20, target_rir: 1, rest_sec: 60  },
          ],
        },
      ],
    },
  },
  {
    slug: 'strength-cardio-3-2',
    name: 'Strength + Z2 (3 + 2)',
    description:
      'Three full-body strength days plus two Zone-2 cardio days. Best for hybrid trainees, runners/cyclists who lift. Lower strength volume than full-body-3-day to leave room for cardio. Equipment minimum: garage gym + any one cardio modality.',
    weeks: 5,
    days_per_week: 5,
    structure: {
      _v: 1,
      days: [
        {
          idx: 0,
          day_offset: 0,
          kind: 'strength',
          name: 'Strength A',
          blocks: [
            { exercise_slug: 'barbell-back-squat',     mev: 2, mav: 4, target_reps_low: 5,  target_reps_high: 8,  target_rir: 2, rest_sec: 180 },
            { exercise_slug: 'dumbbell-bench-press',   mev: 2, mav: 3, target_reps_low: 8,  target_reps_high: 10, target_rir: 2, rest_sec: 150 },
            { exercise_slug: 'dumbbell-row-1arm',      mev: 2, mav: 3, target_reps_low: 8,  target_reps_high: 12, target_rir: 2, rest_sec: 120 },
          ],
        },
        {
          idx: 1,
          day_offset: 1,
          kind: 'cardio',
          name: 'Z2 Cardio',
          blocks: [
            {
              exercise_slug: 'outdoor-walking-z2',
              mev: 1, mav: 1,
              target_reps_low: 1, target_reps_high: 1, target_rir: 1, rest_sec: 0,
              cardio: { target_duration_sec: 2700, target_zone: 2 },
            },
          ],
        },
        {
          idx: 2,
          day_offset: 2,
          kind: 'strength',
          name: 'Strength B',
          blocks: [
            { exercise_slug: 'barbell-romanian-deadlift',   mev: 2, mav: 4, target_reps_low: 6,  target_reps_high: 10, target_rir: 2, rest_sec: 180 },
            { exercise_slug: 'dumbbell-shoulder-press-seated',mev: 2, mav: 3, target_reps_low: 8,  target_reps_high: 10, target_rir: 2, rest_sec: 120 },
            { exercise_slug: 'pullup',                      mev: 2, mav: 3, target_reps_low: 5,  target_reps_high: 10, target_rir: 2, rest_sec: 150 },
          ],
        },
        {
          idx: 3,
          day_offset: 4,
          kind: 'strength',
          name: 'Strength C',
          blocks: [
            { exercise_slug: 'dumbbell-bulgarian-split-squat', mev: 2, mav: 3, target_reps_low: 8,  target_reps_high: 12, target_rir: 2, rest_sec: 120 },
            { exercise_slug: 'incline-dumbbell-bench-press',   mev: 2, mav: 3, target_reps_low: 8,  target_reps_high: 12, target_rir: 2, rest_sec: 120 },
            { exercise_slug: 'chest-supported-dumbbell-row',   mev: 2, mav: 3, target_reps_low: 8,  target_reps_high: 12, target_rir: 2, rest_sec: 120 },
          ],
        },
        {
          idx: 4,
          day_offset: 5,
          kind: 'cardio',
          name: 'Z2 Cardio Long',
          blocks: [
            {
              exercise_slug: 'outdoor-walking-z2',
              mev: 1, mav: 1,
              target_reps_low: 1, target_reps_high: 1, target_rir: 1, rest_sec: 0,
              cardio: { target_duration_sec: 2700, target_zone: 2 },
            },
          ],
        },
      ],
    },
  },
];
