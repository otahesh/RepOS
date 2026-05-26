-- Beta W6 — append-only audit trail for account-scoped operations.
-- One row per profile-change / token-mint-via-account-surface / token-revoke /
-- signout-everywhere / delete-account event (W6) + par_q_acknowledged /
-- onboarding_completed (W2) + restore_replayed (W5). Drives:
--   (a) the AccountEventsTimeline UI (W6 Task 9).
--   (b) post-incident grep for "what did user X do" when a Beta user reports
--       weirdness ("my iOS Shortcut stopped working" → grep for revoke events).
--   (c) forensic survival of account deletion — per D8 (2026-05-26), the FK is
--       ON DELETE SET NULL with PII-snapshot columns so the row preserves
--       who-did-what even after the users row goes away.
--
-- Retention policy (per D8 + I-ACCOUNT-EVENTS-TTL):
--   Beta accepts unbounded retention (small N, accept-residual-risk).
--   GA decision deferred to a documented review. Append-only with row-level
--   redaction for stale rows is the planned-but-not-implemented GA shape; no
--   TTL prune cron at this time.
--
-- Append-only: no UPDATE (except FK SET NULL on user delete), no DELETE.
-- occurred_at is set server-side (DEFAULT now()), never trusted from the client.
--
-- kind is TEXT with NO CHECK constraint (per C-ACCOUNT-EVENTS-ENUM). New kinds
-- are added by extending the TypeScript AccountEventKind union + zod schema,
-- not by ALTERing the table. Avoids cross-wave migration churn (W2 needs
-- par_q_acknowledged + onboarding_completed; W5 needs restore_replayed).
--
-- meta JSONB intentionally permissive — different kinds carry different shapes.
-- For 'profile_changed', meta.before is redacted to {field, changed: true}
-- (per I-ACCOUNT-EVENTS-META) — we do not retain prior display_name PII.
--
-- ip TEXT not INET — node-pg returns INET as a string anyway, and a future
-- migration to v6 doesn't need a column-type change.

CREATE TABLE IF NOT EXISTS account_events (
  id                    BIGSERIAL    PRIMARY KEY,
  -- D8: SET NULL on user delete; PII snapshot columns preserve forensic trail.
  user_id               UUID         NULL REFERENCES users(id) ON DELETE SET NULL,
  user_email_at_event   TEXT         NULL, -- populated at write-time by recordAccountEvent
  user_id_at_event      UUID         NULL, -- immutable snapshot — never updated, never nulled by FK action
  kind                  TEXT         NOT NULL,
  ip                    TEXT         NULL,
  meta                  JSONB        NOT NULL DEFAULT '{}'::jsonb,
  occurred_at           TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Primary access pattern: AccountEventsTimeline reads "this user's events,
-- newest first" — covered by the user_id + occurred_at compound.
CREATE INDEX IF NOT EXISTS account_events_user_id_occurred_at_idx
  ON account_events (user_id, occurred_at DESC);

-- Incident triage: grep-by-IP for "any account hit from this IP in the window."
-- Partial index keeps it cheap when ip is NULL (CF Access JWT-only path).
-- Per I-IP-INDEX.
CREATE INDEX IF NOT EXISTS account_events_ip_idx
  ON account_events (ip) WHERE ip IS NOT NULL;

-- Admin queries: "every delete_initiated in the last 30 days" without scanning
-- by user. Per I-AUDIT-EVENT-KIND-INDEX.
CREATE INDEX IF NOT EXISTS account_events_kind_idx
  ON account_events (kind, occurred_at DESC);
