-- Cardio execution log — session/block grain (Q15: cardio's dimension is
-- minutes/week, not sets/week; measurement-model design 2026-07-12). Mirrors
-- set_logs' idempotency + minute-dedupe discipline. source distinguishes
-- manual logging from the future Apple Health ingestion (phase 3), which is
-- session-grained by HealthKit design (HKWorkout has no per-set schema).
CREATE TABLE IF NOT EXISTS cardio_logs (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  planned_cardio_block_id UUID NOT NULL REFERENCES planned_cardio_blocks(id) ON DELETE CASCADE,
  user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exercise_id             UUID NOT NULL REFERENCES exercises(id) ON DELETE RESTRICT,
  client_request_id       UUID NOT NULL,
  performed_duration_sec  INT  NOT NULL CHECK (performed_duration_sec BETWEEN 1 AND 86400),
  performed_distance_m    INT      CHECK (performed_distance_m IS NULL OR performed_distance_m > 0),
  avg_hr                  SMALLINT CHECK (avg_hr IS NULL OR avg_hr BETWEEN 30 AND 250),
  max_hr                  SMALLINT CHECK (max_hr IS NULL OR max_hr BETWEEN 30 AND 250),
  energy_kcal             INT      CHECK (energy_kcal IS NULL OR energy_kcal BETWEEN 1 AND 10000),
  srpe                    SMALLINT CHECK (srpe IS NULL OR srpe BETWEEN 1 AND 10),
  source                  TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','apple_health')),
  performed_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotency: per-user client_request_id, same contract as set_logs.
CREATE UNIQUE INDEX IF NOT EXISTS cardio_logs_user_client_request_key
  ON cardio_logs (user_id, client_request_id);
-- Double-tap dedupe: same block within the same UTC minute collapses. 3-arg
-- date_trunc for IMMUTABLE index-safety (same rationale as 029).
CREATE UNIQUE INDEX IF NOT EXISTS cardio_logs_minute_dedupe_key
  ON cardio_logs (planned_cardio_block_id, date_trunc('minute', performed_at, 'UTC'));
CREATE INDEX IF NOT EXISTS idx_cardio_logs_user_performed
  ON cardio_logs (user_id, exercise_id, performed_at DESC);

-- updated_at trigger — same table-scoped pattern as set_logs (029); PATCH
-- relies on it.
CREATE OR REPLACE FUNCTION cardio_logs_set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cardio_logs_updated_at ON cardio_logs;
CREATE TRIGGER cardio_logs_updated_at
  BEFORE UPDATE ON cardio_logs
  FOR EACH ROW
  EXECUTE FUNCTION cardio_logs_set_updated_at();
