-- api/src/db/migrations/022_set_logs.sql
-- Created here as a hard prereq for sub-project #3 (Live Logger). #3
-- writes to it; #2 only creates the table. performed_load_lbs is
-- NUMERIC(5,1) — same units and precision as health_weight_samples.
CREATE TABLE IF NOT EXISTS set_logs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  planned_set_id     UUID NOT NULL REFERENCES planned_sets(id) ON DELETE CASCADE,
  performed_reps     SMALLINT,
  performed_load_lbs NUMERIC(5,1),
  performed_rir      SMALLINT,
  performed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes              TEXT
);

CREATE INDEX IF NOT EXISTS idx_set_logs_planned ON set_logs(planned_set_id);
