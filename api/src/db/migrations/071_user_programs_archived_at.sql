-- 071_user_programs_archived_at.sql
-- Reversible "archive" for user programs: a nullable timestamp, mirroring
-- program_templates.archived_at. The column is the single source of truth for
-- archive state and list filtering.
--
-- D10 EXPAND step: this migration is ADDITIVE only. It adds the column,
-- backfills any legacy status='archived' rows, and creates a NEW partial index
-- matching the archive-aware "active list" predicate. The legacy
-- idx_user_programs_user (WHERE status <> 'archived') is intentionally left in
-- place to avoid removing an index in this step (a destructive change under the
-- D10 gate); it is now redundant (the app never sets status='archived') and can
-- be retired in a later contract migration.
ALTER TABLE user_programs ADD COLUMN archived_at TIMESTAMPTZ NULL;

-- Carry over any rows previously archived via the enum value (none expected in
-- prod — single user, lifting data still wipe-recreatable). Legacy
-- status='archived' rows keep their enum value, so after unarchive they surface
-- only under ?include=past; the column drives all list filtering going forward.
UPDATE user_programs SET archived_at = now() WHERE status = 'archived';

-- New partial index matching the new "active programs" predicate.
CREATE INDEX IF NOT EXISTS idx_user_programs_active
  ON user_programs (user_id) WHERE archived_at IS NULL;
