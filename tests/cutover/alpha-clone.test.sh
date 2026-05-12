#!/usr/bin/env bash
set -euo pipefail

# Beta W0.5 alpha-clone cutover test.
#
# Restores a real pg_dump of the alpha production database into a scratch
# Postgres, runs the cutover SQL, and asserts the same invariants as the
# synthetic test — but against real-shape data.
#
# Operator-provided prerequisites:
#   ALPHA_DUMP_PATH — pg_dump --format=custom of jmeyer's actual alpha DB,
#                     taken 2026-05-07 or later. Acquire via:
#                       ssh root@<unraid-host> 'docker exec repos pg_dump -Fc -U repos repos | gzip' \
#                         > /tmp/alpha-dump-YYYYMMDD.sql.gz
#   DATABASE_URL    — a fresh, empty (or wipe-able) Postgres. This script
#                     WIPES the public schema first, so do NOT point this at
#                     anything you care about. Recommended: the same
#                     repos_test DB used by the synthetic test.
#
# Usage:
#   ALPHA_DUMP_PATH=/tmp/alpha-dump-20260511.sql.gz \
#     DATABASE_URL=postgres://repos:repos_dev_pw@127.0.0.1:5432/repos_test \
#     bash tests/cutover/alpha-clone.test.sh

: "${ALPHA_DUMP_PATH:?ALPHA_DUMP_PATH must point at the alpha pg_dump (custom format)}"
: "${DATABASE_URL:?DATABASE_URL must be set (this script WIPES it; use a scratch DB)}"

PLACEHOLDER_UUID='00000000-0000-0000-0000-000000000001'
TARGET_EMAIL="${TARGET_EMAIL:-jason@jpmtech.com}"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

PSQL() { psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 "$@"; }

echo "→ Wiping target DB public schema..."
PSQL <<SQL >/dev/null
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
SQL

echo "→ Restoring alpha dump (${ALPHA_DUMP_PATH})..."
if [[ "${ALPHA_DUMP_PATH}" == *.gz ]]; then
  gunzip -c "${ALPHA_DUMP_PATH}" | pg_restore --no-owner --no-privileges --dbname="${DATABASE_URL}"
else
  pg_restore --no-owner --no-privileges --dbname="${DATABASE_URL}" "${ALPHA_DUMP_PATH}"
fi

# The migration 028 sentinel column may or may not be in the dump (depending
# on when it was taken). Apply it idempotently to be safe.
echo "→ Ensuring sentinel column exists (migration 028)..."
PSQL -f "${REPO_ROOT}/api/src/db/migrations/028_health_weight_samples_migrated_sentinel.sql" >/dev/null

echo "→ Capturing before-counts..."
PLACEHOLDER_BEFORE=$(PSQL -tA -c "SELECT count(*) FROM health_weight_samples WHERE user_id='${PLACEHOLDER_UUID}'")
echo "   placeholder weight rows before: ${PLACEHOLDER_BEFORE}"

if [ "${PLACEHOLDER_BEFORE}" = "0" ]; then
  echo "⚠ alpha dump has no placeholder rows. Either cutover was already run, or the alpha used a different user_id. Aborting."
  exit 1
fi

echo "→ Ensuring ${TARGET_EMAIL} exists in the restored DB (simulates CF Access auto-provisioning)..."
PSQL <<SQL >/dev/null
INSERT INTO users (email, timezone) VALUES ('${TARGET_EMAIL}', 'America/New_York')
  ON CONFLICT (email) DO NOTHING;
SQL

echo "→ Running cutover SQL..."
PSQL -v target_email="${TARGET_EMAIL}" -f "${REPO_ROOT}/scripts/cutover/001-placeholder-to-jmeyer.sql"

echo "→ Asserting post-cutover invariants..."
PLACEHOLDER_AFTER=$(PSQL -tA -c "SELECT count(*) FROM health_weight_samples WHERE user_id='${PLACEHOLDER_UUID}'")
TARGET_AFTER=$(PSQL -tA -c "SELECT count(*) FROM health_weight_samples hws JOIN users u ON u.id=hws.user_id WHERE lower(u.email)=lower('${TARGET_EMAIL}')")
DUPES=$(PSQL -tA -c "SELECT count(*) FROM (SELECT id FROM health_weight_samples GROUP BY id HAVING count(*) > 1) x")
PLACEHOLDER_USER_GONE=$(PSQL -tA -c "SELECT count(*) FROM users WHERE id='${PLACEHOLDER_UUID}'")

[ "${PLACEHOLDER_AFTER}" = "0" ] || { echo "FAIL: placeholder weight rows remain: ${PLACEHOLDER_AFTER}"; exit 1; }
[ "${TARGET_AFTER}" = "${PLACEHOLDER_BEFORE}" ] || { echo "FAIL: target weight count (${TARGET_AFTER}) ≠ before-placeholder count (${PLACEHOLDER_BEFORE})"; exit 1; }
[ "${DUPES}" = "0" ] || { echo "FAIL: duplicate IDs: ${DUPES}"; exit 1; }
[ "${PLACEHOLDER_USER_GONE}" = "0" ] || { echo "FAIL: placeholder users row still present"; exit 1; }

echo "✓ alpha-clone cutover test PASS (migrated ${TARGET_AFTER} weight samples)"
