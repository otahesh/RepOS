-- api/src/db/migrations/018_day_workouts.sql
-- One row per (mesocycle_run, week_idx, day_idx). Rest is implicit — dates
-- between start_date and start_date+weeks*7-1 with no day_workout row are
-- rest days. day_workout_kind has no 'rest' label by design.
CREATE TABLE IF NOT EXISTS day_workouts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mesocycle_run_id UUID NOT NULL REFERENCES mesocycle_runs(id) ON DELETE CASCADE,
  week_idx         SMALLINT NOT NULL,
  day_idx          SMALLINT NOT NULL,
  scheduled_date   DATE NOT NULL,
  kind             day_workout_kind NOT NULL,
  name             TEXT NOT NULL,
  notes            TEXT,
  status           TEXT NOT NULL DEFAULT 'planned'
                   CHECK (status IN ('planned','in_progress','completed','skipped')),
  completed_at     TIMESTAMPTZ,
  UNIQUE (mesocycle_run_id, week_idx, day_idx)
);

CREATE INDEX IF NOT EXISTS idx_day_workouts_lookup
  ON day_workouts(mesocycle_run_id, scheduled_date);
