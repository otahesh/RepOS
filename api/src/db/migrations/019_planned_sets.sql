-- Strength-only prescription rows. RIR 0 is hard-banned globally in v1
-- (Q4) — relax to "isolation last week" is a v2 decision after we see real
-- adherence data. exercise_id and substituted_from_exercise_id are
-- ON DELETE RESTRICT (Q17) — deleting a curated exercise mid-mesocycle is
-- forbidden; the seed runner soft-archives instead.
CREATE TABLE IF NOT EXISTS planned_sets (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  day_workout_id               UUID NOT NULL REFERENCES day_workouts(id) ON DELETE CASCADE,
  block_idx                    SMALLINT NOT NULL,
  set_idx                      SMALLINT NOT NULL,
  exercise_id                  UUID NOT NULL REFERENCES exercises(id) ON DELETE RESTRICT,
  target_reps_low              SMALLINT NOT NULL,
  target_reps_high             SMALLINT NOT NULL,
  target_rir                   SMALLINT NOT NULL CHECK (target_rir >= 1),
  target_load_hint             TEXT,
  rest_sec                     SMALLINT NOT NULL,
  overridden_at                TIMESTAMPTZ,
  override_reason              TEXT,
  substituted_from_exercise_id UUID REFERENCES exercises(id) ON DELETE RESTRICT,
  UNIQUE (day_workout_id, block_idx, set_idx),
  CHECK (target_reps_low <= target_reps_high)
);
