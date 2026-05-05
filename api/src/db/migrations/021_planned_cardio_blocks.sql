-- Cardio is its own table per Q15 — its dimension is minutes/week, not
-- sets/week. CHECK enforces at least one of duration or distance is set.
-- exercise_id ON DELETE RESTRICT mirrors planned_sets for the same Q17
-- soft-delete-discipline reason.
CREATE TABLE IF NOT EXISTS planned_cardio_blocks (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  day_workout_id      UUID NOT NULL REFERENCES day_workouts(id) ON DELETE CASCADE,
  block_idx           SMALLINT NOT NULL,
  exercise_id         UUID NOT NULL REFERENCES exercises(id) ON DELETE RESTRICT,
  target_duration_sec INT,
  target_distance_m   INT,
  target_zone         SMALLINT CHECK (target_zone BETWEEN 1 AND 5),
  overridden_at       TIMESTAMPTZ,
  override_reason     TEXT,
  UNIQUE (day_workout_id, block_idx),
  CHECK (target_duration_sec IS NOT NULL OR target_distance_m IS NOT NULL)
);
