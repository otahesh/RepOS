#!/usr/bin/env bash
# Pre-cutover 2026-07-11 — the image must pin REPOS_SCRIPTS_DIR to where the
# Dockerfile actually copies the scripts. The restore runner spawn-detaches
# ${REPOS_SCRIPTS_DIR:-/app/scripts}/run-restore.sh with stdio ignored; the
# Dockerfile ships the scripts at /scripts, so with the env unset the spawn
# died instantly and silently — the W5 on-prod restore was never executable
# (found RED in the G5 rehearsal: sentinel stuck 'running', API never
# SIGTERMed, no pg_restore process).
set -euo pipefail

DOCKERFILE="$(cd "$(dirname "$0")/../.." && pwd)/docker/Dockerfile"
test -f "$DOCKERFILE" || { echo "FAIL: $DOCKERFILE missing"; exit 1; }

# The scripts COPY target and the env var must agree.
COPY_TARGET=$(grep -E '^COPY scripts ' "$DOCKERFILE" | awk '{print $3}')
test -n "$COPY_TARGET" || { echo "FAIL: no 'COPY scripts <dir>' in Dockerfile"; exit 1; }

grep -qE "^ENV REPOS_SCRIPTS_DIR=${COPY_TARGET}\$" "$DOCKERFILE" \
  || { echo "FAIL: Dockerfile must set ENV REPOS_SCRIPTS_DIR=${COPY_TARGET} (scripts COPY target)"; exit 1; }
echo "✓ REPOS_SCRIPTS_DIR pinned to ${COPY_TARGET}"

echo "PASS: image scripts-path invariant holds"
