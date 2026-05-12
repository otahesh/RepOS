-- Beta W0.5 — placeholder → real-user cutover.
--
-- Idempotent + sentinel-gated reattribution of alpha rows from
-- user_id = PLACEHOLDER_UUID to the real CF-Access-provisioned user
-- matching :target_email. Re-runs are no-ops on already-migrated rows
-- (filter: migrated_from_placeholder_at IS NULL).
--
-- Pre-flight: scripts/pre-restore-snapshot.sh runs BEFORE this script;
-- the dump it produces is the rollback path.
--
-- Usage:
--   psql $DATABASE_URL -v target_email='jason@jpmtech.com' \
--     -f scripts/cutover/001-placeholder-to-jmeyer.sql
--
-- The target user must already exist (auto-provisioned by CF Access first
-- login). The script aborts via \quit 1 if not.

\set ON_ERROR_STOP on
\set placeholder_uuid '\'00000000-0000-0000-0000-000000000001\''

-- Resolve the target user. \gset hoists target_uuid into a psql variable.
SELECT
  (SELECT id::text FROM users WHERE lower(email) = lower(:'target_email')) AS target_uuid,
  EXISTS (SELECT 1 FROM users WHERE lower(email) = lower(:'target_email')) AS target_exists
\gset

\if :target_exists
  \echo 'Cutover target:' :'target_email' '→' :'target_uuid'
\else
  \echo 'FATAL: No user with email' :'target_email' 'found. CF Access must auto-provision via first login before cutover.'
  \quit 1
\endif

BEGIN;

-- Sentinel-gated weight-sample reattribution. Idempotent: re-runs only touch
-- rows where migrated_from_placeholder_at IS NULL.
UPDATE health_weight_samples
SET
  user_id = :'target_uuid'::uuid,
  migrated_from_placeholder_at = now()
WHERE
  user_id = :placeholder_uuid::uuid
  AND migrated_from_placeholder_at IS NULL;

-- Sync status: single row per user (PK is user_id).
-- If target already has a sync_status row, drop the placeholder's row
-- (real-user state wins). Otherwise move the placeholder's row to target.
DELETE FROM health_sync_status
WHERE user_id = :placeholder_uuid::uuid
  AND EXISTS (SELECT 1 FROM health_sync_status WHERE user_id = :'target_uuid'::uuid);

UPDATE health_sync_status
SET user_id = :'target_uuid'::uuid
WHERE user_id = :placeholder_uuid::uuid;

-- Delete the placeholder users row. ON DELETE CASCADE on any remaining FK
-- references (programs, mesocycles, set_logs, device_tokens, etc.) wipes
-- residual alpha state — intentional per the Beta cutover plan
-- ("wipe everything except weight history").
DELETE FROM users WHERE id = :placeholder_uuid::uuid;

COMMIT;

-- Reporting (out-of-tx).
SELECT 'placeholder weight rows remaining' AS metric, count(*)::text AS value
  FROM health_weight_samples WHERE user_id = :placeholder_uuid::uuid
UNION ALL
SELECT 'target total weight rows',
  count(*)::text
  FROM health_weight_samples WHERE user_id = :'target_uuid'::uuid
UNION ALL
SELECT 'target sync_status rows',
  count(*)::text
  FROM health_sync_status WHERE user_id = :'target_uuid'::uuid
UNION ALL
SELECT 'placeholder users row remaining',
  count(*)::text
  FROM users WHERE id = :placeholder_uuid::uuid;
