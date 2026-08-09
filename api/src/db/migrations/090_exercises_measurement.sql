-- Measurement model (docs/superpowers/plans/2026-07-12-measurement-model.md).
-- 'reps'     — discrete contraction cycles (dynamic work, external load or bodyweight).
-- 'duration' — unbroken time under load (isometric holds, time-prescribed carries).
-- Cardio is deliberately NOT in this enum: its dimension is minutes/week at
-- session grain (Q15) and it lives in planned_cardio_blocks / cardio_logs.
-- INVARIANT: measurement drives materialization, seeds, and substitution
-- filtering ONLY. Rendering of an already-materialized planned_sets row keys
-- on which target columns are populated — never on this column — so rows
-- materialized before an exercise was reclassified keep rendering correctly.
ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS measurement TEXT NOT NULL DEFAULT 'reps'
  CONSTRAINT exercises_measurement_check CHECK (measurement IN ('reps','duration'));
