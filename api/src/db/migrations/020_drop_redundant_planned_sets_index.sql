-- Code review found idx_planned_sets_day duplicates the UNIQUE-backing index
-- on the same (day_workout_id, block_idx, set_idx) tuple. Drop it.
DROP INDEX IF EXISTS idx_planned_sets_day;
