-- Beta W5.0 — backup_runs audit table.
-- Append-only audit of every backup + restore + download + delete
-- operation. Status transitions: running → ok | failed. Used by:
--   - GET /api/backups (list + verified-restorable badge inference)
--   - GET /api/maintenance/status (reads /config/restore-state.json
--     sentinel for in-flight state — backup_runs only has post-clear
--     restore_complete rows; per C-AUDIT-SENTINEL)
--   - DR runbook (proves "manual backup → sidecar JSON → integrity-verified")
--
-- trigger:
--   'manual'      — user clicked Backup Now in /settings/backups
--   'auto'        — nightly s6 backup longrun (repos-backup.sh)
--   'pre_restore' — pre-restore-snapshot.sh, captured before destructive restore
--   'restore'     — the restore operation itself (file_path = source snapshot)
--
-- event_kind (per C-DOWNLOAD-AUDIT — every event gets its own row):
--   'create'           — the snapshot was created (default)
--   'download'         — GET /api/backups/:id/download fired (D9 audit)
--   'delete'           — DELETE /api/backups/:id fired
--   'restore_init'     — POST /api/backups/:id/restore accepted (kicked off)
--   'restore_complete' — admin cleared the maintenance flag post-restore
--
-- status:
--   'running' — operation in flight (BACKUPS ONLY — restores use sentinel file)
--   'ok'      — finished cleanly (integrity_verified=true for backups; admin cleared for restores)
--   'failed'  — non-zero exit OR integrity check failed; error_message populated
--
-- admin_user_id: per C-ADMIN-USER-ID, populated from (req as any).userId on every
-- HTTP-triggered row and from ${ADMIN_USER_ID} env on script-triggered rows.
-- Required so the audit trail can answer "who clicked Restore."
--
-- source_ip: client IP from x-forwarded-for or req.ip on HTTP-triggered rows.
--
-- Partial unique index in 051 prevents two concurrent autoruns.

CREATE TABLE IF NOT EXISTS backup_runs (
  id                  BIGSERIAL    PRIMARY KEY,
  trigger             TEXT         NOT NULL CHECK (trigger IN ('manual', 'auto', 'pre_restore', 'restore')),
  event_kind          TEXT         NOT NULL DEFAULT 'create' CHECK (event_kind IN ('create','download','delete','restore_init','restore_complete')),
  status              TEXT         NOT NULL CHECK (status IN ('running', 'ok', 'failed')),
  file_path           TEXT,
  size_bytes          BIGINT,
  integrity_verified  BOOLEAN      NOT NULL DEFAULT false,
  error_message       TEXT,
  admin_user_id       UUID         REFERENCES users(id) ON DELETE SET NULL,
  source_ip           TEXT,
  started_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  finished_at         TIMESTAMPTZ
);
