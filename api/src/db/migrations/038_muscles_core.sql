-- api/src/db/migrations/038_muscles_core.sql
-- Beta W2.4 — core/abs muscle taxonomy.
-- Adds the 'core' muscle row. The slug 'core' is already permitted by the
-- muscles.group_name CHECK constraint in migration 008. Existing exercises
-- that should belong to core (e.g. Pallof press, currently misclassified
-- to 'upper_back' in api/src/seed/exercises.ts) will be re-tagged in
-- the next seed pass (Task 3.2).
INSERT INTO muscles (slug, name, group_name, display_order) VALUES
  ('core', 'Core / Abdominals', 'core', 130)
ON CONFLICT (slug) DO NOTHING;
