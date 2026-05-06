-- Per §7.2 — dismissals stored per (user, flag, week_start) so a dismissed
-- toast doesn't re-fire the same week. Reconciliation addendum pins the
-- canonical schema: (user_id, flag, week_start DATE), NOT scoped per
-- mesocycle_run_id. week_start is the Monday of the ISO week the flag fired.
CREATE TABLE IF NOT EXISTS recovery_flag_dismissals (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  flag         TEXT NOT NULL CHECK (flag IN ('bodyweight_crash','overreaching','stalled_pr')),
  week_start   DATE NOT NULL,
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, flag, week_start)
);
CREATE INDEX IF NOT EXISTS idx_rfd_user ON recovery_flag_dismissals(user_id, week_start);
