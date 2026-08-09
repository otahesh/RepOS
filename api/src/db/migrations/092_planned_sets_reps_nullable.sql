-- DESTRUCTIVE (column demotion): planned_sets.target_reps_low/high lose NOT
-- NULL so duration-measured sets can carry NULL reps instead of sentinel
-- values. Dry-run: link in PR body.
ALTER TABLE planned_sets
  ALTER COLUMN target_reps_low  DROP NOT NULL,
  ALTER COLUMN target_reps_high DROP NOT NULL;

-- Reps targets remain pair-consistent...
ALTER TABLE planned_sets
  ADD CONSTRAINT planned_sets_reps_pair_check
    CHECK ((target_reps_low IS NULL) = (target_reps_high IS NULL)),
-- ...and every planned set measures exactly one dimension (measurement model).
-- All pre-092 rows: reps populated + duration NULL -> XOR satisfied; the 019
-- low<=high CHECK is NULL-satisfied for duration rows by SQL semantics.
  ADD CONSTRAINT planned_sets_measurement_xor_check
    CHECK ((target_reps_low IS NULL) <> (target_duration_low_sec IS NULL));
