-- Canonical structure JSON shape (see spec §3.2.2):
--   { _v:1,
--     days:[
--       { idx, day_offset, kind, name,
--         blocks:[ { exercise_slug, mev, mav, target_reps_low, target_reps_high,
--                    target_rir, rest_sec, cardio?:{...} } ] } ] }
-- day_offset: integer 0..6 days from each week's anchor for this training day
--   (e.g. [0,1,3,4] = Mon/Tue/Thu/Fri when start_date is a Monday).
-- Validator (Zod, app-side) enforces strictly-increasing offsets within a week,
-- no duplicates, and within-week range 0..6. Implicit rest on dates between
-- start_date..(start_date + weeks*7 - 1) without a day_workout row.
CREATE TABLE IF NOT EXISTS program_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9-]+$'),
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  weeks           SMALLINT NOT NULL CHECK (weeks BETWEEN 1 AND 16),
  days_per_week   SMALLINT NOT NULL CHECK (days_per_week BETWEEN 1 AND 7),
  structure       JSONB NOT NULL,
  version         INT NOT NULL DEFAULT 1,
  created_by      TEXT NOT NULL DEFAULT 'system'
                  CHECK (created_by IN ('system','user')),
  seed_key        TEXT,
  seed_generation INT,
  archived_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_program_templates_seed_key
  ON program_templates(seed_key) WHERE seed_key IS NOT NULL;
