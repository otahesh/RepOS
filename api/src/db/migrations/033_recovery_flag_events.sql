-- Beta W3 — recovery_flag_events telemetry table.
-- Append-only. One row per recovery-flag first-show per (user, flag, week)
-- AND one row per user dismiss. Powers the post-cohort tuning pass on the
-- W3 evaluator thresholds.
--
-- [FIX-7] week_start is DATE (Monday-of-ISO-week), matching recovery_flag_dismissals
-- from migration 024. Required for join compatibility with the existing dismiss
-- correlation queries. Use Postgres date_trunc('week', current_date)::date on write.
--
-- [FIX-30] flag has a CHECK mirroring schemas/recoveryFlags.ts KNOWN_FLAGS, to
-- catch typos in recordFlagEvent({flag: 'overreach'}) before they land silently.
--
-- [FIX-16] (user_id, week_start, flag, event_type) UNIQUE for event_type='shown' —
-- enforced via a partial unique index. Lets evaluator emits ON CONFLICT DO NOTHING
-- on every poll without table-explosion. 'dismissed' events are append-only and
-- not deduped because each dismiss is a discrete user action worth recording.

CREATE TABLE IF NOT EXISTS recovery_flag_events (
  id          BIGSERIAL    PRIMARY KEY,
  user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  flag        TEXT         NOT NULL CHECK (flag IN ('bodyweight_crash','overreaching','stalled_pr')),
  week_start  DATE         NOT NULL,
  event_type  TEXT         NOT NULL CHECK (event_type IN ('shown','dismissed')),
  occurred_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recovery_flag_events_lookup_idx
  ON recovery_flag_events (user_id, week_start, flag);

CREATE UNIQUE INDEX IF NOT EXISTS recovery_flag_events_shown_dedupe_idx
  ON recovery_flag_events (user_id, flag, week_start)
  WHERE event_type = 'shown';
