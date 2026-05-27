-- api/src/db/migrations/035_par_q_acknowledgments.sql
-- Beta W2.1 (QA Round 2 amendment) — per-version PAR-Q audit table.
-- Acknowledgments are NEVER overwritten on version bump. Each accepted
-- version gets its own row, preserving the audit trail.
--
-- Primary key (user_id, version) prevents duplicate acks for the same
-- version. ON DELETE CASCADE so account deletion (W6.1) wipes ack history
-- as part of the user cascade.
--
-- responses JSONB stores the 9-question Yes/No payload (post-Q9-ADD) at
-- acceptance time in case copy is amended later — we hold a snapshot of
-- what they accepted. Shape:
--   { "questions": ["..."], "answers": [false, false, ...] }
-- CHECK constraint validates the shape at write-time (panel I-MIG-035-CHECK).
--
-- ip TEXT NULL: populated by the POST handler from req.ip (panel
-- I-MIG-035-IP). Audit-trail parity with W6's account_events.ip. Nullable
-- because some test paths inject without an ip; production traffic always
-- sets it.
--
-- Index posture (panel I-MIG-035-IDX): the PK on (user_id, version) already
-- supports `WHERE user_id = $1` lookups efficiently. A separate partial
-- index on (user_id) is redundant — dropped from this migration.
CREATE TABLE IF NOT EXISTS par_q_acknowledgments (
  user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version     SMALLINT     NOT NULL,
  accepted_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  responses   JSONB        NOT NULL DEFAULT '{"questions":[],"answers":[]}'::jsonb,
  ip          TEXT         NULL,
  PRIMARY KEY (user_id, version),
  CONSTRAINT par_q_acknowledgments_responses_shape
    CHECK (
      jsonb_typeof(responses) = 'object'
      AND responses ? 'questions'
      AND responses ? 'answers'
    )
);

-- ── user_injuries provenance column (W2 deviation, documented) ──────────────
-- The W2 plan's Q5 joint follow-up writes user_injuries rows tagged with a
-- `source` value 'par_q_v<N>' and asserts on it in
-- tests/integration/par-q-q5-joint-followup.test.ts. The W3-shipped
-- user_injuries table (migration 032) has NO `source` column, so the PAR-Q
-- pipeline cannot record provenance without this additive column. We add it
-- here (rather than claiming an extra migration number) because the Q5→
-- user_injuries pipeline is intrinsically part of the PAR-Q feature that
-- migration 035 enables. Nullable so existing manually-entered injuries
-- (source IS NULL) remain valid; the injuryRanker never reads `source`, so
-- this is non-breaking for W3's ranking logic.
ALTER TABLE user_injuries
  ADD COLUMN IF NOT EXISTS source TEXT NULL;
