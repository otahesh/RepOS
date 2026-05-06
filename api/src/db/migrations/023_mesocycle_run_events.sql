-- api/src/db/migrations/023_mesocycle_run_events.sql
-- Append-only forensic log of run lifecycle (Q20). Cheap support tooling
-- without retro-deriving state from row diffs. event_type is a Postgres
-- ENUM defined in 014_program_kind_enums.sql.
CREATE TABLE IF NOT EXISTS mesocycle_run_events (
  id          BIGSERIAL PRIMARY KEY,
  run_id      UUID NOT NULL REFERENCES mesocycle_runs(id) ON DELETE CASCADE,
  event_type  mesocycle_run_event_type NOT NULL,
  payload     JSONB NOT NULL DEFAULT '{}',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meso_events_run
  ON mesocycle_run_events(run_id, occurred_at);
