-- Beta W1.1 — set_logs Beta columns.
-- Extends migration 022 with the Beta API contract: user_id + exercise_id
-- (FK ownership + per-user/per-exercise indices for W3 stalled-PR queries),
-- rpe (separate from RIR — same set can have both), client_request_id
-- (idempotency from offline queue), and standard audit columns. Backfills
-- user_id from mesocycle_runs via day_workouts; exercise_id from
-- planned_sets directly.
--
-- Note: migrate.ts wraps each migration file in its own BEGIN/COMMIT, so
-- this file omits explicit transaction control.

ALTER TABLE set_logs
  ADD COLUMN IF NOT EXISTS user_id            UUID,
  ADD COLUMN IF NOT EXISTS exercise_id        UUID,
  ADD COLUMN IF NOT EXISTS rpe                SMALLINT CHECK (rpe BETWEEN 1 AND 10),
  ADD COLUMN IF NOT EXISTS client_request_id  UUID,
  ADD COLUMN IF NOT EXISTS created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ NOT NULL DEFAULT now();

-- Backfill user_id + exercise_id from the planned-set chain.
UPDATE set_logs sl
SET
  user_id     = mr.user_id,
  exercise_id = ps.exercise_id
FROM planned_sets ps
JOIN day_workouts dw ON dw.id = ps.day_workout_id
JOIN mesocycle_runs mr ON mr.id = dw.mesocycle_run_id
WHERE sl.planned_set_id = ps.id
  AND (sl.user_id IS NULL OR sl.exercise_id IS NULL);

-- Backfill client_request_id for any pre-existing rows.
UPDATE set_logs SET client_request_id = gen_random_uuid()
WHERE client_request_id IS NULL;

-- Orphan guard (per memory `project_alpha_state.md` — alpha non-weight rows
-- are throwaway): any set_log whose planned_set chain doesn't reach a
-- mesocycle_run gets removed BEFORE we apply NOT NULL. Without this, a
-- cascade-in-flight or pre-existing orphan would make the ALTER fail and
-- roll back the whole migration transaction.
DELETE FROM set_logs WHERE user_id IS NULL OR exercise_id IS NULL;

ALTER TABLE set_logs
  ALTER COLUMN user_id           SET NOT NULL,
  ALTER COLUMN exercise_id       SET NOT NULL,
  ALTER COLUMN client_request_id SET NOT NULL,
  ADD CONSTRAINT set_logs_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  ADD CONSTRAINT set_logs_exercise_id_fkey
    FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE RESTRICT;

-- Idempotency: per-user client_request_id is globally unique.
CREATE UNIQUE INDEX IF NOT EXISTS set_logs_user_id_client_request_id_key
  ON set_logs (user_id, client_request_id);

-- Double-tap dedupe: same planned_set within same minute = single row.
-- Uses the 3-arg date_trunc(text, timestamptz, text) overload because the
-- 2-arg form is STABLE (session TIMEZONE-dependent) and Postgres rejects
-- non-IMMUTABLE expressions in index keys (SQLSTATE 42P17). Pinning to
-- 'UTC' makes the minute boundary deterministic regardless of session TZ.
CREATE UNIQUE INDEX IF NOT EXISTS set_logs_minute_dedupe_key
  ON set_logs (planned_set_id, date_trunc('minute', performed_at, 'UTC'));

-- Compound index for W3 stalled-PR and overreaching queries.
CREATE INDEX IF NOT EXISTS idx_set_logs_user_exercise_performed
  ON set_logs (user_id, exercise_id, performed_at DESC);

-- updated_at trigger. No shared set_updated_at() function exists in prior
-- migrations (grepped 001–028 — none define a trigger function), so this
-- migration ships its own table-scoped one. If a future migration extracts
-- a shared helper, this can be repointed.
CREATE OR REPLACE FUNCTION set_logs_set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_logs_updated_at ON set_logs;
CREATE TRIGGER set_logs_updated_at
  BEFORE UPDATE ON set_logs
  FOR EACH ROW
  EXECUTE FUNCTION set_logs_set_updated_at();
