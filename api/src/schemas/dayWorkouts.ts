import { z } from 'zod';

// ---------------------------------------------------------------------------
// Sequence-workouts Task 2 — day-workout status mutation schemas.
//
// completed_on is a calendar DATE (not a datetime): the backfill affordance
// asks "which day did you train?", and the route stores it as noon in the
// run's start_tz to dodge TZ midnight edges. Range checks (not in the future,
// not before the run started) are route-level because they need the run row.
// ---------------------------------------------------------------------------

export const DayWorkoutCompleteSchema = z.object({
  completed_on: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'completed_on must be a YYYY-MM-DD date')
    .optional(),
});
export type DayWorkoutComplete = z.infer<typeof DayWorkoutCompleteSchema>;
