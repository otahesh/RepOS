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
TS=$(date -u +%Y%m%dT%H%M%SZ)
OUT_DUMP="${BACKUPS_DIR}/pre-restore-${TS}.sql.gz"
OUT_SIDECAR="${BACKUPS_DIR}/pre-restore-${TS}.json"

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

echo "✓ pre-restore snapshot captured: ${OUT_DUMP} (${SIZE} bytes)"
echo "  sidecar: ${OUT_SIDECAR}"
