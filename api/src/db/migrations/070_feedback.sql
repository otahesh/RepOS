-- Beta W7 — in-app feedback capture. One row per submission.
-- Range 070–079 reserved for W7 per per-wave migration-range claim (W6 reserved
-- 060–069). user_id is SET NULL on user delete so feedback outlives the account
-- (the engineer still wants to read it after a tester leaves), with the email
-- snapshot preserved alongside (mirrors account_events.user_email_at_event).
CREATE TABLE IF NOT EXISTS feedback (
  id                   BIGSERIAL   PRIMARY KEY,
  user_id              UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  user_email_at_submit TEXT        NULL,
  body                 TEXT        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  route                TEXT        NULL,
  app_sha              TEXT        NULL,
  user_agent           TEXT        NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  triaged_at           TIMESTAMPTZ NULL,
  webhook_delivered_at TIMESTAMPTZ NULL,
  webhook_attempts     INT         NOT NULL DEFAULT 0
);

-- Admin triage view orders untriaged-first, newest-first.
CREATE INDEX IF NOT EXISTS feedback_triage_idx
  ON feedback (triaged_at NULLS FIRST, created_at DESC);
