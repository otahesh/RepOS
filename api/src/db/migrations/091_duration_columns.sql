-- Duration targets (prescription) + performed duration (log). Sparse additive
-- columns per the measurement-model design: reps and duration are two units of
-- the same set concept, so they share planned_sets/set_logs.
-- The reps↔duration XOR CHECK lands in 092 together with the target_reps_*
-- nullability change (a duration row needs NULL reps, impossible before 092).
ALTER TABLE planned_sets
  ADD COLUMN IF NOT EXISTS target_duration_low_sec  SMALLINT,
  ADD COLUMN IF NOT EXISTS target_duration_high_sec SMALLINT,
  ADD CONSTRAINT planned_sets_duration_range_check
    CHECK (target_duration_low_sec IS NULL OR target_duration_high_sec IS NULL
           OR target_duration_low_sec <= target_duration_high_sec),
  ADD CONSTRAINT planned_sets_duration_pair_check
    CHECK ((target_duration_low_sec IS NULL) = (target_duration_high_sec IS NULL));

ALTER TABLE set_logs
  ADD COLUMN IF NOT EXISTS performed_duration_sec SMALLINT
  CONSTRAINT set_logs_duration_positive_check CHECK (performed_duration_sec IS NULL OR performed_duration_sec > 0);
