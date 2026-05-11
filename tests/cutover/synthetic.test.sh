#!/usr/bin/env bash
set -euo pipefail

# Beta W0.5 synthetic-fixture test for the placeholder → real-user cutover.
#
# Seeds a placeholder user + 3 weight samples + 1 sync_status row, runs the
# cutover, and asserts:
#   - placeholder count after cutover = 0
#   - real-user count after cutover = original placeholder count
#   - no duplicate rows
#   - sentinel column populated on all migrated rows
#   - re-run is a no-op (idempotency)
#   - placeholder users row deleted
#
# Usage:
#   DATABASE_URL=postgres://repos:repos_dev_pw@127.0.0.1:5432/repos_test \
#     bash tests/cutover/synthetic.test.sh

: "${DATABASE_URL:?DATABASE_URL must be set (use the local test DB connection string)}"

PLACEHOLDER_UUID='00000000-0000-0000-0000-000000000001'
TARGET_EMAIL='cutover-synthetic-test@local'
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

PSQL() { psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 "$@"; }

echo "→ Cleaning prior state..."
PSQL <<SQL >/dev/null
DELETE FROM health_weight_samples WHERE user_id IN (
  '${PLACEHOLDER_UUID}',
  COALESCE((SELECT id FROM users WHERE lower(email)=lower('${TARGET_EMAIL}')), '${PLACEHOLDER_UUID}'::uuid)
);
DELETE FROM health_sync_status WHERE user_id IN (
  '${PLACEHOLDER_UUID}',
  COALESCE((SELECT id FROM users WHERE lower(email)=lower('${TARGET_EMAIL}')), '${PLACEHOLDER_UUID}'::uuid)
);
DELETE FROM users WHERE id = '${PLACEHOLDER_UUID}' OR lower(email) = lower('${TARGET_EMAIL}');
SQL

echo "→ Seeding fixtures..."
PSQL <<SQL >/dev/null
INSERT INTO users (id, email, timezone) VALUES
  ('${PLACEHOLDER_UUID}', 'placeholder@local', 'UTC');

INSERT INTO users (email, timezone) VALUES
  ('${TARGET_EMAIL}', 'America/New_York');

INSERT INTO health_weight_samples (user_id, sample_date, sample_time, weight_lbs, source) VALUES
  ('${PLACEHOLDER_UUID}', '2026-04-15', '07:00:00', 180.0, 'Apple Health'),
  ('${PLACEHOLDER_UUID}', '2026-04-16', '07:00:00', 179.5, 'Apple Health'),
  ('${PLACEHOLDER_UUID}', '2026-04-17', '07:00:00', 179.0, 'Apple Health');

INSERT INTO health_sync_status (user_id, source, last_fired_at, last_success_at)
  VALUES ('${PLACEHOLDER_UUID}', 'Apple Health', now(), now())
  ON CONFLICT (user_id) DO NOTHING;
SQL

PLACEHOLDER_BEFORE=$(PSQL -tA -c "SELECT count(*) FROM health_weight_samples WHERE user_id='${PLACEHOLDER_UUID}'")
echo "   seeded ${PLACEHOLDER_BEFORE} placeholder weight rows"

echo "→ Running cutover SQL..."
PSQL -v target_email="${TARGET_EMAIL}" -f "${REPO_ROOT}/scripts/cutover/001-placeholder-to-jmeyer.sql"

echo "→ Asserting post-cutover invariants..."
PLACEHOLDER_AFTER=$(PSQL -tA -c "SELECT count(*) FROM health_weight_samples WHERE user_id='${PLACEHOLDER_UUID}'")
TARGET_AFTER=$(PSQL -tA -c "SELECT count(*) FROM health_weight_samples hws JOIN users u ON u.id=hws.user_id WHERE lower(u.email)=lower('${TARGET_EMAIL}')")
DUPES=$(PSQL -tA -c "SELECT count(*) FROM (SELECT id FROM health_weight_samples GROUP BY id HAVING count(*) > 1) x")
SENTINEL=$(PSQL -tA -c "SELECT count(*) FROM health_weight_samples WHERE migrated_from_placeholder_at IS NOT NULL")
PLACEHOLDER_USER_GONE=$(PSQL -tA -c "SELECT count(*) FROM users WHERE id='${PLACEHOLDER_UUID}'")

[ "${PLACEHOLDER_AFTER}" = "0" ] || { echo "FAIL: placeholder rows remain: ${PLACEHOLDER_AFTER}"; exit 1; }
[ "${TARGET_AFTER}" = "${PLACEHOLDER_BEFORE}" ] || { echo "FAIL: target count ≠ before-placeholder (${TARGET_AFTER} vs ${PLACEHOLDER_BEFORE})"; exit 1; }
[ "${DUPES}" = "0" ] || { echo "FAIL: duplicate ids: ${DUPES}"; exit 1; }
[ "${SENTINEL}" -ge "${PLACEHOLDER_BEFORE}" ] || { echo "FAIL: sentinel populated on fewer rows than migrated: ${SENTINEL} < ${PLACEHOLDER_BEFORE}"; exit 1; }
[ "${PLACEHOLDER_USER_GONE}" = "0" ] || { echo "FAIL: placeholder users row still present"; exit 1; }

echo "→ Re-running cutover (must be idempotent no-op)..."
PSQL -v target_email="${TARGET_EMAIL}" -f "${REPO_ROOT}/scripts/cutover/001-placeholder-to-jmeyer.sql"
TARGET_AFTER_RERUN=$(PSQL -tA -c "SELECT count(*) FROM health_weight_samples hws JOIN users u ON u.id=hws.user_id WHERE lower(u.email)=lower('${TARGET_EMAIL}')")
[ "${TARGET_AFTER_RERUN}" = "${PLACEHOLDER_BEFORE}" ] || { echo "FAIL: re-run changed target count to ${TARGET_AFTER_RERUN}"; exit 1; }

echo "→ Cleaning up test fixtures..."
PSQL <<SQL >/dev/null
DELETE FROM health_weight_samples WHERE user_id = (SELECT id FROM users WHERE lower(email)=lower('${TARGET_EMAIL}'));
DELETE FROM health_sync_status WHERE user_id = (SELECT id FROM users WHERE lower(email)=lower('${TARGET_EMAIL}'));
DELETE FROM users WHERE lower(email) = lower('${TARGET_EMAIL}');
SQL

echo "✓ synthetic cutover test PASS (migrated ${TARGET_AFTER} weight samples)"
