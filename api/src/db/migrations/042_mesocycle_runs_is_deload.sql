-- Beta W4.4 — mesocycle_runs.is_deload BOOLEAN column.
-- Marks a mesocycle_run that was generated via POST /api/user-programs/:id/start
-- with ?intent=deload. Used to:
--   (a) drive MesocycleRecap copy + UI accent on subsequent loads,
--   (b) gate clinical evaluators (overreaching evaluator must not fire on
--       a deload meso — entire run is intentionally low volume).
--
-- Distinct from W2.5's day_workouts.is_deload (which marks the deload WEEK
-- inside a non-deload mesocycle run — i.e. the week-N deload of a 5-week
-- accumulation block). One is run-level, one is week-level. Both will
-- exist post-W2; this plan owns only the run-level column.

ALTER TABLE mesocycle_runs
  ADD COLUMN IF NOT EXISTS is_deload BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS mesocycle_runs_is_deload_idx
  ON mesocycle_runs (user_id, is_deload) WHERE is_deload = true;

-- TODO(W2): day_workouts.is_deload is OWNED by W2.5 (week-level deload flag
-- inside a non-deload accumulation block). W2 has not merged at W4-ship time,
-- so W4 claims the column defensively here with IF NOT EXISTS — same name,
-- type, and default W2.5 will use, so both migrations are idempotent. Per the
-- [C-IS-DELOAD] joint contract (master plan §651), every day_workout of a
-- deload mesocycle run must carry is_deload=true; W4's materialize deload
-- post-process and the overreaching-evaluator guard both depend on this
-- column existing. When W2.5 lands, reconcile to a single owning migration.
ALTER TABLE day_workouts
  ADD COLUMN IF NOT EXISTS is_deload BOOLEAN NOT NULL DEFAULT false;

-- [C-LANDMARKS-ACTIVE-RUN] Snapshot of resolveUserLandmarks() captured at
-- materialize time. The run's volume-rollup and clinical evaluators ALWAYS
-- read from this snapshot — never re-read users.muscle_landmarks during an
-- active run. Mid-run PATCH /users/me/landmarks affects only future
-- mesocycles, not the currently-running one. Nullable for the migration's
-- back-fill window; the materialize service populates it on every new run.
ALTER TABLE mesocycle_runs
  ADD COLUMN IF NOT EXISTS landmarks_snapshot JSONB;
