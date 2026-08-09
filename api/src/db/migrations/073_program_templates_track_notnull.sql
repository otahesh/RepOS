-- 073_program_templates_track_notnull.sql
-- D10 ENFORCE step for the track column added in 072. Additive constraint only:
-- every insert path (seed adapter + every test fixture) now sets track, and 072
-- backfilled all pre-existing rows, so enforcing the constraint cannot fail.
ALTER TABLE program_templates ALTER COLUMN track SET NOT NULL;
