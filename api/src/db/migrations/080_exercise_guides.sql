-- api/src/db/migrations/080_exercise_guides.sql
-- W2 of the logging redesign (spec 2026-07-06 §4): seeded setup-card content.
-- ADDITIVE only (D10 migration gate). Content rows arrive via the seed CLI
-- (same pattern as program_templates), not via this migration.
--
-- setup_facts: structured numbers for W3's app-rendered annotation tags
--   (e.g. {"bench_angle_deg": 30}); never baked into images.
-- media: {"start": "/exercise-media/<slug>-start.webp", "end": ...} — empty
--   until W3 commits approved photos.
CREATE TABLE IF NOT EXISTS exercise_guides (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exercise_id     UUID NOT NULL UNIQUE REFERENCES exercises(id) ON DELETE CASCADE,
  setup_callout   TEXT NOT NULL CHECK (length(setup_callout) BETWEEN 40 AND 600),
  setup_facts     JSONB NOT NULL DEFAULT '{}'::jsonb,
  cues            TEXT[] NOT NULL CHECK (cardinality(cues) = 3),
  donts           TEXT[] NOT NULL CHECK (cardinality(donts) = 2),
  media           JSONB NOT NULL DEFAULT '{}'::jsonb,
  seed_key        TEXT,
  seed_generation INT,
  archived_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
