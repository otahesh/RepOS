-- api/src/db/migrations/040_movement_pattern_spinal_flexion_anti_extension.sql
-- Beta W2.4 — extend movement_pattern enum with 'spinal_flexion' and
-- 'anti_extension' for the new core exercises.
--
-- W2 owns this migration (was W4-scoped) because W2 introduces the
-- exercises that require it (Cable Crunch, Hanging Leg Raise, Ab Wheel
-- Rollout). W4 consumes the values from the planning side.
--
-- ALTER TYPE … ADD VALUE IF NOT EXISTS semantics: PG 12+ allows this
-- inside a transaction; the value is NOT referenceable from within the
-- same transaction (panel I-MIG-037 applies here too). Any seed that
-- tags an exercise with one of these values runs separately via
-- `npm run seed`, NOT inside this migration. (Local + prod are PG 16.)
ALTER TYPE movement_pattern ADD VALUE IF NOT EXISTS 'spinal_flexion';
ALTER TYPE movement_pattern ADD VALUE IF NOT EXISTS 'anti_extension';
