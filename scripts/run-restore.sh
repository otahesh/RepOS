#!/usr/bin/env bash
# W5 — long-running restore. Invoked detached by restoreRunner.ts.
#
# Args:
#   $1 — source dump path (absolute)
#   $2 — restore_id (sentinel id, matches /config/restore-state.json::restore_id)
#   $3 — pre-snapshot filename (predetermined by restoreRunner.ts)
#
# Implements C-RESTORE-ORDERING + C-DEVICE-TOKENS-RESTORE + I-SEQUENCE-RESET +
# I-RESTORE-CHILD-PRIVS + I-SIGTERM-DRAIN-PRESERVES-BACKUP.
#
# Flow (atomic order):
#   1. Source-path defense-in-depth: reject anything not literally
#      ${BACKUPS_DIR}/repos-*.dump.gz or ${BACKUPS_DIR}/pre-restore-*.sql.gz.
#   2. SIGTERM the API (s6-rc -d change api) and WAIT for it to fully exit, so
#      the API releases its pg pool BEFORE pg_restore opens DROP on tables the
#      pool has prepared statements against.
#   3. Run scripts/pre-restore-snapshot.sh — the rollback point. It writes the
#      pre_restore backup_runs row (event_kind='create', trigger='pre_restore').
#   4. pg_restore --clean --if-exists --no-owner --no-privileges → DB.
#   5. Run migrations (in case the snapshot pre-dated migrations).
#   6. C-DEVICE-TOKENS-RESTORE — wipe device_tokens to close the restore-replay
#      attack vector.
#   7. I-SEQUENCE-RESET — fix the backup_runs id sequence after pg_restore.
#   8. Write restore-state.json status='ok' (or 'failed' on any prior non-zero
#      exit), with fsync.
#   9. s6-rc -u change api — boot the API back up. New API sees the flag, stays
#      in maintenance until admin clears.
set -uo pipefail

SRC="$1"
RESTORE_ID="$2"
PRE_SNAPSHOT_FILENAME="${3:-}"

BACKUPS_DIR="${BACKUPS_DIR:-/config/backups}"
SCRIPTS_DIR="${REPOS_SCRIPTS_DIR:-/app/scripts}"
API_DIR="${REPOS_API_DIR:-/app/api}"
SENTINEL_PATH="${RESTORE_STATE_PATH:-/config/restore-state.json}"

# I-RESTORE-CHILD-PRIVS — defense-in-depth source-path validation. pg_restore
# runs as the DB superuser; safeBackupPath() in the API was the first gate,
# this re-validates as a second.
case "$SRC" in
  "${BACKUPS_DIR}"/repos-*.dump.gz) ;;
  "${BACKUPS_DIR}"/pre-restore-*.sql.gz) ;;
  *)
    echo "FATAL: source path ${SRC} outside allow-list" >&2
    exit 99
    ;;
esac

# Merge status+error_message+finished_at into the sentinel atomically (fsync).
mark_status() {
  local new_status="$1"
  local msg="${2:-}"
  REPOS_NEW_STATUS="$new_status" REPOS_ERR_MSG="$msg" \
  python3 - "$SENTINEL_PATH" "$RESTORE_ID" <<'PY'
import datetime, json, os, sys
path, restore_id = sys.argv[1], sys.argv[2]
state = {"restore_id": restore_id}
if os.path.exists(path):
    try:
        with open(path) as fh:
            state = json.load(fh)
    except Exception:
        pass
state["status"] = os.environ["REPOS_NEW_STATUS"]
err = os.environ.get("REPOS_ERR_MSG", "")
if err:
    state["error_message"] = err
state["finished_at"] = datetime.datetime.utcnow().isoformat() + "Z"
tmp = path + ".tmp"
with open(tmp, "w") as fh:
    json.dump(state, fh)
    fh.flush()
    os.fsync(fh.fileno())
os.replace(tmp, path)
PY
  sync
}

boot_api() {
  if command -v s6-rc >/dev/null 2>&1; then
    s6-rc -u change api || true
  fi
}

mark_failed() {
  mark_status failed "$1"
  boot_api
  exit 1
}

# 2. C-RESTORE-ORDERING — SIGTERM the API FIRST and wait for it to exit.
if command -v s6-rc >/dev/null 2>&1; then
  s6-rc -d change api || true
  # Wait up to 35s for the API to fully exit (SHUTDOWN_TIMEOUT_MS=30s + buffer).
  for _ in $(seq 1 35); do
    if ! s6-rc -a list 2>/dev/null | grep -q '^api$'; then break; fi
    sleep 1
  done
fi

# 3. Pre-restore snapshot (the rollback path). pre-restore-snapshot.sh inserts
#    its own backup_runs row trigger='pre_restore' and honors PRE_SNAPSHOT_FILENAME.
if ! BACKUPS_DIR="${BACKUPS_DIR}" PRE_SNAPSHOT_FILENAME="${PRE_SNAPSHOT_FILENAME}" \
     "${SCRIPTS_DIR}/pre-restore-snapshot.sh"; then
  mark_failed 'pre-restore snapshot failed'
fi

# 4. pg_restore. --clean --if-exists drops existing objects; --no-owner avoids
#    re-asserting the postgres role; --no-privileges skips GRANTs.
if ! gunzip -c "${SRC}" | pg_restore --clean --if-exists --no-owner --no-privileges -d "${DATABASE_URL}"; then
  mark_failed 'pg_restore non-zero exit'
fi

# 5. Run migrations forward (in case the snapshot pre-dated migrations).
if ! (cd "${API_DIR}" && node dist/db/migrate.js); then
  mark_failed 'migrations failed after restore'
fi

# 6. C-DEVICE-TOKENS-RESTORE — wipe device_tokens, close restore-replay vector.
if ! psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 <<'SQL'
UPDATE device_tokens
SET revoked_at = now(),
    revoke_reason = 'restore_replayed'
WHERE revoked_at IS NULL;
SQL
then
  mark_failed 'device_tokens wipe failed'
fi

# 7. I-SEQUENCE-RESET — bump backup_runs_id_seq past max(id) so the post-clear
#    restore_complete INSERT doesn't collide with restored ids.
psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 <<'SQL' || true
SELECT setval('backup_runs_id_seq', COALESCE((SELECT max(id) FROM backup_runs), 1));
SQL

# 8. Mark sentinel ok with fsync.
mark_status ok

# 9. Boot the API back up. New API sees /config/maintenance.flag, stays in
#    maintenance mode until admin clears via POST /api/maintenance/clear.
boot_api

exit 0
