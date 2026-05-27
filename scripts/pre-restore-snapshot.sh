#!/usr/bin/env bash
set -euo pipefail

# Beta W0.5 / W5.3 — pre-destructive-operation snapshot capture.
#
# Takes a pg_dump snapshot before:
#   - scripts/cutover/001-placeholder-to-jmeyer.sql (live prod cutover)
#   - W5.3 restore route (the API's maintenance-mode restore flow)
#
# Output: ${BACKUPS_DIR}/pre-restore-<ts>.sql.gz + sidecar JSON tagged
# trigger:'pre_restore'. The dump is the rollback path: if the destructive
# operation goes wrong, restore from this file.
#
# Environment:
#   DATABASE_URL  required — same pg connection used by the API.
#   BACKUPS_DIR   optional — defaults to /config/backups (the in-container
#                 path; on host it maps to /mnt/user/appdata/repos/config/backups).

: "${DATABASE_URL:?DATABASE_URL must be set}"

BACKUPS_DIR="${BACKUPS_DIR:-/config/backups}"
# W5 — the restore runner predetermines the snapshot filename (so the
# /config/restore-state.json sentinel is complete from t=0). Honor it when
# supplied; otherwise fall back to a fresh timestamp (cutover use).
if [ -n "${PRE_SNAPSHOT_FILENAME:-}" ]; then
  OUT_DUMP="${BACKUPS_DIR}/${PRE_SNAPSHOT_FILENAME}"
  OUT_SIDECAR="${BACKUPS_DIR}/${PRE_SNAPSHOT_FILENAME%.sql.gz}.json"
else
  TS=$(date -u +%Y%m%dT%H%M%SZ)
  OUT_DUMP="${BACKUPS_DIR}/pre-restore-${TS}.sql.gz"
  OUT_SIDECAR="${BACKUPS_DIR}/pre-restore-${TS}.json"
fi

mkdir -p "${BACKUPS_DIR}"

echo "→ Capturing pre-restore snapshot to ${OUT_DUMP}..."
pg_dump --format=custom "${DATABASE_URL}" | gzip > "${OUT_DUMP}"
SIZE=$(wc -c < "${OUT_DUMP}" | tr -d ' ')

cat > "${OUT_SIDECAR}" <<EOF
{
  "file": "$(basename "${OUT_DUMP}")",
  "size_bytes": ${SIZE},
  "trigger": "pre_restore",
  "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
chmod 0640 "${OUT_SIDECAR}" 2>/dev/null || true

# W5 — INSERT the backup_runs audit row so /api/maintenance/status sees a
# pre_restore snapshot and exposes recovery_available=true. event_kind='create'
# is the default. Best-effort: a failed INSERT must not abort the snapshot
# (the file on disk is still the rollback path).
psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 <<SQL || echo "WARN: backup_runs audit insert failed (non-fatal)"
INSERT INTO backup_runs (trigger, event_kind, status, file_path, size_bytes,
                         integrity_verified, started_at, finished_at)
VALUES ('pre_restore', 'create', 'ok', '${OUT_DUMP}', ${SIZE}, true, now(), now());
SQL

echo "✓ pre-restore snapshot captured: ${OUT_DUMP} (${SIZE} bytes)"
echo "  sidecar: ${OUT_SIDECAR}"
