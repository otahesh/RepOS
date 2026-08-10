#!/usr/bin/env bash
# W9 cutover step 2 — stamp the CF sync baseline and import CF-only identities.
#
# Run ONCE, after migration 080 has been applied, from inside the container so
# CF_API_TOKEN / CF_ACCOUNT_ID / CF_ACCESS_POLICY_ID are set:
#
#   docker exec -it RepOS /scripts/cutover/002-w9-cf-baseline.sh
#
# The container is named RepOS, capitalised. `docker exec ... repos` is a
# different (nonexistent) container and fails before this script is reached.
#
# NOTE the path: the Dockerfile does `COPY scripts /scripts` (docker/Dockerfile:57).
# `/app/scripts` is the LOCAL-dev default only — see api/.env.example's
# REPOS_SCRIPTS_DIR=/scripts note. Using /app/scripts here fails "file not found"
# and silently leaves CF-only identities unimported.
#
# It is idempotent: re-running re-stamps rows that still match and imports
# nothing that already exists. It aborts rather than importing when the policy
# is attached to more than one application (Q10), contains a non-email selector
# (Q22), or when the import would carry the cohort past the cap (Q12).
#
# Founding-admin promotion is NOT here — it lives in migration 080 (Q35), so a
# restore that never runs this script still yields a working admin.
set -euo pipefail

# DATABASE_URL is NOT part of the container environment. The three s6 scripts
# that need it each build it themselves and export it into their own service
# (run-api:6, init-migrations:8, init-seed:8) — `docker exec` starts a fresh
# process that inherits none of that. The header of this file used to claim it
# "is set", and the first production run on 2026-08-09 died with
#   FATAL 28000: no PostgreSQL user name specified in startup packet
# because an unset connection string makes pg fall back to libpq defaults.
# Built here the same way those three build it, and only when absent, so an
# explicit override still wins.
if [[ -z "${DATABASE_URL:-}" ]]; then
  db_name="${POSTGRES_DB:-repos}"
  db_user="${POSTGRES_USER:-repos}"
  export DATABASE_URL="postgres://${db_user}:${POSTGRES_PASSWORD}@127.0.0.1:5432/${db_name}"
fi

# REPOS_API_DIR, not API_DIR: run-restore.sh:37 already reads that name for the
# same directory, and two sibling scripts honouring different overrides for one
# path is a trap for whoever relocates it.
API_DIR="${REPOS_API_DIR:-/app/api}"
cd "${API_DIR}"
exec node dist/services/cfReconcile-cli.js --source=cutover
