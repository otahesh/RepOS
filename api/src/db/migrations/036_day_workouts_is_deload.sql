-- api/src/db/migrations/036_day_workouts_is_deload.sql
-- Beta W2.5 — day_workouts.is_deload column.
-- Owned by the program engine: set true on every day_workout row whose
-- week_idx == mesocycle_runs.weeks (the canonical RP deload week) AND on
-- every day_workout row inserted by manual_deload (W2.5 routes).
--
-- Backfill: every existing active/abandoned/completed mesocycle_run gets
-- its last-week rows flipped to is_deload=true. Reads identical to the
-- interim `current_week >= weeks` heuristic stalledPrEvaluator used pre-W2,
-- so the swap in api/src/services/stalledPrEvaluator.ts is behavior-
-- preserving for the existing alpha cohort.
ALTER TABLE day_workouts
  ADD COLUMN IF NOT EXISTS is_deload BOOLEAN NOT NULL DEFAULT false;

-- Backfill: flip the final week of every existing run.
UPDATE day_workouts dw
   SET is_deload = true
  FROM mesocycle_runs mr
 WHERE dw.mesocycle_run_id = mr.id
   AND dw.week_idx = mr.weeks
   AND dw.is_deload = false;

-- Index — stalledPrEvaluator filters on (mesocycle_run_id, is_deload=false)
-- when scanning sessions. Partial index keeps it cheap.
CREATE INDEX IF NOT EXISTS day_workouts_non_deload_by_run_idx
  ON day_workouts (mesocycle_run_id)
  WHERE is_deload = false;
