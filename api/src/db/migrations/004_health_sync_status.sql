CREATE TABLE IF NOT EXISTS health_sync_status (
  user_id              UUID        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  source               TEXT        NOT NULL,
  last_fired_at        TIMESTAMPTZ NOT NULL,
  last_success_at      TIMESTAMPTZ,
  last_error           TEXT,
  consecutive_failures INT         NOT NULL DEFAULT 0
);
