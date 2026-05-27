-- Beta W5.0 — operational indexes for backup_runs.
-- Split out from 050 per the project's single-purpose migration pattern
-- (see 019 + 020). Future index swaps can be done as a Step-2
-- destructive migration per G6 without rewriting 050.

-- For GET /api/backups: list latest first.
CREATE INDEX IF NOT EXISTS backup_runs_started_at_desc_idx
  ON backup_runs (started_at DESC);

-- For GET /api/maintenance/status::recovery_available — find the latest
-- pre_restore snapshot. Per I-PARTIAL-INDEX-MATCH, this matches the actual
-- query (the failed-restore lookup happens against the sentinel file, not
-- the DB, per C-AUDIT-SENTINEL — so the old failed-restore partial index
-- is removed in favour of the pre_restore one).
CREATE INDEX IF NOT EXISTS backup_runs_pre_restore_ok_idx
  ON backup_runs (started_at DESC)
  WHERE trigger = 'pre_restore' AND status = 'ok';

-- Prevent two concurrent autoruns from overlapping (would create
-- gzip-truncation race on the same partial file).
CREATE UNIQUE INDEX IF NOT EXISTS backup_runs_one_auto_running_idx
  ON backup_runs ((true))
  WHERE status = 'running' AND trigger = 'auto';
