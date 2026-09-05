-- Feedback triage agent — classification, fix lifecycle, and the email ledger.
--
-- Range: 094+. The 08x range is shared between W9 and origin's own migrations
-- and already collided once; production is applied through 093_cardio_logs.
--
-- `triaged_at` (from 070) deliberately keeps its old meaning of "somebody
-- looked at this". It CANNOT gate the agent's queue: PATCH /admin/feedback/:id
-- /triage sets only triaged_at and no category, so a row clicked in the admin
-- UI would leave a triaged_at-based queue while never being classified or
-- answered. Queue membership is `category IS NULL`.

ALTER TABLE feedback
  ADD COLUMN IF NOT EXISTS category    TEXT NULL,
  ADD COLUMN IF NOT EXISTS severity    TEXT NULL,
  ADD COLUMN IF NOT EXISTS triage_note TEXT NULL,
  ADD COLUMN IF NOT EXISTS dedupe_of   BIGINT NULL REFERENCES feedback(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fix_commit_sha   TEXT NULL,
  ADD COLUMN IF NOT EXISTS fix_status       TEXT NOT NULL DEFAULT 'n/a',
  ADD COLUMN IF NOT EXISTS fix_base_sha     TEXT NULL,
  ADD COLUMN IF NOT EXISTS fix_patch_digest TEXT NULL,
  ADD COLUMN IF NOT EXISTS fix_branch       TEXT NULL,
  ADD COLUMN IF NOT EXISTS fix_pr_number    INT NULL;

-- No DROP CONSTRAINT IF EXISTS guard here: runMigrations() tracks this file in
-- _migrations and runs it inside a single transaction, so it executes exactly
-- once against any database and these constraints never pre-exist. A
-- drop-then-add pair would also make this file always read as Step-2
-- (destructive) to scripts/check-migration-dryrun.sh, which flags any DROP
-- CONSTRAINT regardless of context — an unwarranted cost for a guard this
-- migration doesn't need.
ALTER TABLE feedback
  ADD CONSTRAINT feedback_category_check
    CHECK (category IS NULL OR category IN ('bug','ux','feature','question','noise')),
  -- Noise carries no severity; the service enforces that pairing. The schema
  -- only constrains the vocabulary.
  ADD CONSTRAINT feedback_severity_check
    CHECK (severity IS NULL OR severity IN ('p1','p2','p3')),
  ADD CONSTRAINT feedback_fix_status_check
    CHECK (fix_status IN ('n/a','needed','patch_submitted','pr_open','merged','deferred')),
  ADD CONSTRAINT feedback_fix_commit_sha_check
    CHECK (fix_commit_sha IS NULL OR fix_commit_sha ~ '^[0-9a-f]{40}$'),
  ADD CONSTRAINT feedback_fix_base_sha_check
    CHECK (fix_base_sha IS NULL OR fix_base_sha ~ '^[0-9a-f]{40}$'),
  ADD CONSTRAINT feedback_dedupe_of_not_self
    CHECK (dedupe_of IS NULL OR dedupe_of <> id);

-- The agent's queue: unclassified rows, oldest first.
CREATE INDEX IF NOT EXISTS feedback_untriaged_idx
  ON feedback (created_at) WHERE category IS NULL;

-- The fix queue: acknowledged canonical items whose fix is unfinished.
CREATE INDEX IF NOT EXISTS feedback_fix_pending_idx
  ON feedback (created_at)
  WHERE fix_status IN ('needed','patch_submitted','pr_open') AND dedupe_of IS NULL;

-- One row per email we intend to send. The row is written and COMMITTED before
-- the network call, so a crash mid-send leaves durable evidence rather than a
-- silent gap; `request` holds the frozen bytes so a retry replays verbatim
-- under the same key instead of re-rendering (the Q30 lesson from
-- inviteMailer.ts). UNIQUE (feedback_id, kind) is what makes same-kind
-- double-send impossible regardless of what the agent believes.
CREATE TABLE IF NOT EXISTS feedback_emails (
  id               BIGSERIAL   PRIMARY KEY,
  feedback_id      BIGINT      NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
  kind             TEXT        NOT NULL,
  request          TEXT        NOT NULL,
  idempotency_key  TEXT        NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 256),
  message_id       TEXT        NULL,
  sent_at          TIMESTAMPTZ NULL,
  error            TEXT        NULL,
  attempts         INT         NOT NULL DEFAULT 0,
  first_attempt_at TIMESTAMPTZ NULL,
  last_attempt_at  TIMESTAMPTZ NULL,
  dead_lettered_at TIMESTAMPTZ NULL,
  CONSTRAINT feedback_emails_kind_check CHECK (kind IN ('ack','resolved','reply')),
  CONSTRAINT feedback_emails_feedback_id_kind_key UNIQUE (feedback_id, kind)
);

-- replay-pending selects on this: written, not sent, not abandoned.
CREATE INDEX IF NOT EXISTS feedback_emails_unsent_idx
  ON feedback_emails (first_attempt_at)
  WHERE sent_at IS NULL AND dead_lettered_at IS NULL;
