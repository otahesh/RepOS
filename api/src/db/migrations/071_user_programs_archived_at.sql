-- 071_user_programs_archived_at.sql
-- Reversible "archive" for user programs: a nullable timestamp, mirroring
-- program_templates.archived_at. Column-archived rows (the new /archive path)
-- restore cleanly on unarchive. Legacy status='archived' rows backfilled below
-- keep their enum value, so after unarchive they surface only under ?include=past
-- (none expected in prod). The column is the single source of truth for filtering.
ALTER TABLE user_programs ADD COLUMN archived_at TIMESTAMPTZ NULL;

-- Carry over any rows previously archived via the enum value so the new column
-- is the single source of truth. (None expected in prod — single user, lifting
-- data still wipe-recreatable — but keep the migration correct regardless.)
UPDATE user_programs SET archived_at = now() WHERE status = 'archived';

-- Swap the partial "active list" index off the enum value onto the new column.
DROP INDEX IF EXISTS idx_user_programs_user;
CREATE INDEX idx_user_programs_user ON user_programs (user_id) WHERE archived_at IS NULL;
