#!/usr/bin/env bash
# tests/dr/check-cadence.sh — fails the build if last-run.txt is > 100 days
# stale. Per I-LAST-RUN-CI, uses the file's GIT COMMIT time (not filesystem
# mtime, which resets to now on every checkout). Wire into the W8.6 CI hook.
set -euo pipefail

FILE="tests/dr/last-run.txt"
test -f "$FILE" || { echo "FAIL: $FILE missing"; exit 1; }

LAST_COMMIT_TS=$(git log -1 --format=%ct "$FILE" 2>/dev/null || echo 0)
if [ "$LAST_COMMIT_TS" -eq 0 ]; then
  echo "FAIL: $FILE has no git history (commit it after the first DR run)"
  exit 1
fi
NOW=$(date +%s)
DELTA=$(( NOW - LAST_COMMIT_TS ))
LIMIT=8640000  # 100 days in seconds
if [ "$DELTA" -gt "$LIMIT" ]; then
  DAYS=$(( DELTA / 86400 ))
  echo "FAIL: last DR run was ${DAYS} days ago (limit: 100)." >&2
  echo "      Run tests/dr/restore-into-ephemeral.sh + commit the updated last-run.txt." >&2
  exit 1
fi
echo "OK: last DR run was $(( DELTA / 86400 )) days ago"
