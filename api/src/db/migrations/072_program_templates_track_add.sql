-- 072_program_templates_track_add.sql
-- First-class experience tracks for program templates (Feature B).
-- D10 EXPAND step: ADDITIVE only. Adds a nullable column and backfills it. The
-- companion 073 migration adds the NOT NULL constraint after every insert path
-- (seed adapter + test fixtures) sets track. Splitting expand/enforce keeps the
-- test suite green and gives prod a safe backfill-before-enforce window.
ALTER TABLE program_templates
  ADD COLUMN track TEXT CHECK (track IN ('beginner','intermediate','advanced'));

-- Classify the three curated v1 templates.
UPDATE program_templates SET track='beginner'     WHERE slug='full-body-3-day';
UPDATE program_templates SET track='intermediate' WHERE slug='upper-lower-4-day';
UPDATE program_templates SET track='intermediate' WHERE slug='strength-cardio-3-2';

-- Catch-all so 073's enforce cannot fail on any legacy/archived row created by an
-- earlier seed generation (the seed archiver leaves old rows in place — this is
-- load-bearing, not merely defensive). Harmless when there are none. 'intermediate'
-- is the neutral default for any stray row.
UPDATE program_templates SET track='intermediate' WHERE track IS NULL;
