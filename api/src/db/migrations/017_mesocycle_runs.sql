-- api/src/db/migrations/017_mesocycle_runs.sql
-- One ACTIVE mesocycle_run per user globally, enforced by partial unique index
-- per Q6. Concurrent strength + cardio plans are deferred to v2.
-- start_tz fixed at run-start per Q18 — TZ change mid-mesocycle does not
-- redrift scheduled_date. "Shift schedule" action is a v1.5 follow-up.
CREATE TABLE IF NOT EXISTS mesocycle_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_program_id UUID NOT NULL REFERENCES user_programs(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date      DATE NOT NULL,
  start_tz        TEXT NOT NULL,
  weeks           SMALLINT NOT NULL,
  current_week    SMALLINT NOT NULL DEFAULT 1,
  status          program_status NOT NULL DEFAULT 'active',
  finished_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_meso_one_active_per_user
  ON mesocycle_runs(user_id) WHERE status = 'active';
