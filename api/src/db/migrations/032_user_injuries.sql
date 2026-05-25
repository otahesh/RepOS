-- Beta W3 — user_injuries table.
-- One row per (user, joint) the user has marked as an active concern.
-- Drives the W3.2 injury-aware substitution ranker and W3.4 Settings UI.
--
-- joint is TEXT with a CHECK constraint pinned against the 7-key chip enum.
-- Adding a chip in the future requires (a) extending this CHECK, (b) adding
-- the joint to JOINT_ROOT in api/src/services/injuryRanker.ts, AND
-- (c) ensuring at least one exercise carries the matching joint key in
-- joint_stress_profile. All three or none.
--
-- [FIX-1] Table-scoped updated_at function — no shared set_updated_at()
-- exists in this project (see migrations 029/030 docblock for the canonical
-- per-table pattern).

CREATE TABLE IF NOT EXISTS user_injuries (
  user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joint       TEXT         NOT NULL CHECK (joint IN (
                 'shoulder_left','shoulder_right','low_back',
                 'knee_left','knee_right','elbow','wrist'
               )),
  severity    TEXT         NOT NULL DEFAULT 'mod' CHECK (severity IN ('low','mod','high')),
  notes       TEXT         NOT NULL DEFAULT '',
  onset_at    DATE         NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, joint)
);

CREATE INDEX IF NOT EXISTS user_injuries_user_id_idx ON user_injuries (user_id);

CREATE OR REPLACE FUNCTION user_injuries_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_injuries_updated_at ON user_injuries;
CREATE TRIGGER user_injuries_updated_at
  BEFORE UPDATE ON user_injuries
  FOR EACH ROW EXECUTE FUNCTION user_injuries_set_updated_at();
