-- Beta W1.4 — workout_write_log rate-limit table.
-- Mirrors weight_write_log. Per-scope window so a chatty weight Shortcut
-- cannot starve workout writes. Day key uses the UTC calendar date derived
-- from the workout's started_at — keeps rate-limit accounting deterministic
-- across daylight-saving boundaries and matches the W1.4.6 test that pins
-- started_at via Date.UTC(...).toISOString().
--
-- Note: migrate.ts wraps each migration file in its own BEGIN/COMMIT, so
-- this file omits explicit transaction control. No trigger needed — the
-- write_count column is an INT counter (no updated_at).

CREATE TABLE IF NOT EXISTS workout_write_log (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_date    DATE NOT NULL,
  write_count INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, log_date)
);
