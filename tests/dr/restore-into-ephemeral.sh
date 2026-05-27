#!/usr/bin/env bash
# W5.5 — DR test. Restore the most-recent prod dump into an ephemeral
# postgres + run a smoke query. CI-runnable artifact, NOT a manual
# procedure.
#
# Usage:
#   PROD_HOST=192.168.88.65 PROD_USER=root \
#     tests/dr/restore-into-ephemeral.sh
#
# Env:
#   PROD_HOST      — hostname or IP of the prod container's host
#   PROD_USER      — SSH user (default: root, the unraid SSH alias)
#   PROD_BACKUPS   — prod backups dir (default the appdata mount)
#   EPHEMERAL_DSN  — postgres DSN to restore into; defaults to a
#                    docker-spawned ephemeral if `docker` is available,
#                    otherwise to ${EPHEMERAL_DSN_FALLBACK} (a local
#                    repos_dr test DB that the developer pre-creates).
set -euo pipefail

PROD_HOST="${PROD_HOST:-192.168.88.65}"
PROD_USER="${PROD_USER:-root}"
PROD_BACKUPS="${PROD_BACKUPS:-/mnt/user/appdata/repos/config/backups}"
LAST_RUN_FILE="$(dirname "$0")/last-run.txt"

echo "→ Pulling latest dump from ${PROD_USER}@${PROD_HOST}:${PROD_BACKUPS}/"
LATEST=$(ssh "${PROD_USER}@${PROD_HOST}" \
  "ls -t ${PROD_BACKUPS}/repos-*.dump.gz | head -1")
[ -n "$LATEST" ] || { echo "FAIL: no dumps found on prod"; exit 1; }

TMP_DIR=$(mktemp -d)
LOCAL_DUMP="$TMP_DIR/$(basename "$LATEST")"
scp "${PROD_USER}@${PROD_HOST}:${LATEST}" "$LOCAL_DUMP"

echo "→ pg_restore -l smoke (table-of-contents readable):"
gunzip -c "$LOCAL_DUMP" | pg_restore -l > "$TMP_DIR/toc.txt"
wc -l "$TMP_DIR/toc.txt"

echo "→ Restoring into ephemeral postgres..."
EPHEMERAL_NAME=""
cleanup() {
  [ -n "$EPHEMERAL_NAME" ] && docker stop "$EPHEMERAL_NAME" >/dev/null 2>&1
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

if command -v docker >/dev/null 2>&1; then
  EPHEMERAL_NAME="repos-dr-$$"
  docker run -d --rm --name "$EPHEMERAL_NAME" \
    -e POSTGRES_PASSWORD=dr -p 0:5432 postgres:16-alpine >/dev/null
  PORT=$(docker port "$EPHEMERAL_NAME" 5432 | head -1 | cut -d: -f2)
  DSN="postgres://postgres:dr@127.0.0.1:${PORT}/postgres"
  # Wait for ready
  for _ in $(seq 1 30); do
    pg_isready -d "$DSN" >/dev/null 2>&1 && break || sleep 1
  done
else
  DSN="${EPHEMERAL_DSN:-${EPHEMERAL_DSN_FALLBACK:-postgres://repos@127.0.0.1:5432/repos_dr}}"
  echo "→ docker not available; using ${DSN}"
fi

gunzip -c "$LOCAL_DUMP" | pg_restore --clean --if-exists --no-owner --no-privileges -d "$DSN"

echo "→ Integration smoke (table count):"
TABLE_COUNT=$(psql "$DSN" -tA -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
echo "   tables: $TABLE_COUNT"
[ "$TABLE_COUNT" -ge 10 ] || { echo "FAIL: too few tables restored ($TABLE_COUNT)"; exit 1; }

USERS_COUNT=$(psql "$DSN" -tA -c "SELECT count(*) FROM users")
echo "   users rows: $USERS_COUNT"

echo "✓ DR test green"
date -u +%Y-%m-%dT%H:%M:%SZ > "$LAST_RUN_FILE"
echo "   updated $LAST_RUN_FILE — git add + commit it so the cadence gate stays current"
