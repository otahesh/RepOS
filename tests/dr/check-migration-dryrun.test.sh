#!/usr/bin/env bash
# W8 / WS4 — check-migration-dryrun.sh unit test (D10 two-step gate → G6).
# Drives the gate via CHANGED_FILES + MIGRATIONS_DIR overrides so we never need
# a real git diff. Synthesizes additive vs Step-2 (destructive) migrations and
# asserts the PR-body dry-run-link requirement.
set -euo pipefail

SCRIPT="$(cd "$(dirname "$0")/../.." && pwd)/scripts/check-migration-dryrun.sh"
test -x "$SCRIPT" || { echo "FAIL: $SCRIPT missing or not executable"; exit 1; }

WORK=$(mktemp -d)
# shellcheck disable=SC2064  # expand $WORK now: set above and never reassigned.
trap "rm -rf '$WORK'" EXIT
MIG="$WORK/migrations"
mkdir -p "$MIG"

# Additive migration (no destructive verbs).
cat > "$MIG/100_add_col.sql" <<'SQL'
ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname TEXT;
SQL

# Step-2 destructive migration.
cat > "$MIG/101_drop_col.sql" <<'SQL'
-- two-step: column was deprecated in 100; drop it now.
ALTER TABLE users DROP COLUMN IF EXISTS legacy_field;
SQL

run() { MIGRATIONS_DIR="$MIG" "$SCRIPT"; }

# (a) No migration files changed → PASS.
if CHANGED_FILES="api/src/routes/foo.ts" PR_BODY="no migrations here" run >/dev/null 2>&1; then
  echo "✓ no-migration PR passes"
else
  echo "FAIL: no-migration PR should pass"; exit 1
fi

# (b) Additive-only migration, no dry-run link → PASS (not destructive).
if CHANGED_FILES="api/src/db/migrations/100_add_col.sql" PR_BODY="just adds a column" run >/dev/null 2>&1; then
  echo "✓ additive-only migration passes"
else
  echo "FAIL: additive-only migration should pass"; exit 1
fi

# (c) Step-2 destructive migration WITHOUT a dry-run link → FAIL.
if CHANGED_FILES="api/src/db/migrations/101_drop_col.sql" PR_BODY="drops the col" run >/dev/null 2>&1; then
  echo "FAIL: Step-2 migration without dry-run link should be rejected"; exit 1
fi
echo "✓ Step-2 migration without dry-run link is rejected"

# (d) Same Step-2 migration WITH a dry-run link → PASS.
BODY=$'Drops legacy_field (two-step).\nDry-run: https://github.com/otahesh/repos/actions/runs/123456'
if CHANGED_FILES="api/src/db/migrations/101_drop_col.sql" PR_BODY="$BODY" run >/dev/null 2>&1; then
  echo "✓ Step-2 migration with dry-run link passes"
else
  echo "FAIL: Step-2 migration WITH dry-run link should pass"; exit 1
fi

echo "✓ check-migration-dryrun.test.sh PASS"
