-- Beta W9 — user management + invites.
-- Numbering: W7 reserved 070–079; W9 claims 080–089. Only 080 is used.
--
-- Replaces two redeploy-coupled env vars with columns:
--   CF_ACCESS_ALLOWED_EMAILS -> users.status   (Q4)
--   REPOS_ADMIN_EMAILS       -> users.role     (Q3)
--
-- The comment at cfAccess.ts:265 claimed "Migration 063 reserves users.role".
-- It never existed (migrations run 060-062 then jump to 070). This builds it.
--
-- Defaults are chosen so the ALTER is safe on its own: every pre-existing row
-- becomes member/active, preserving access for everyone who already has a row.
-- IF NOT EXISTS on each ADD COLUMN keeps a partially-applied run re-runnable.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role   TEXT NOT NULL DEFAULT 'member'
    CHECK (role IN ('member','admin')),
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('invited','active','suspended','deleting')),
  -- ON DELETE SET NULL, not CASCADE: deleting the inviter must never cascade
  -- into the people they invited.
  ADD COLUMN IF NOT EXISTS invited_by        UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invited_at        TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS activated_at      TIMESTAMPTZ NULL,
  -- Q24: "this row's intent is reflected in the CF policy." NULL means sync
  -- state UNKNOWN, not divergent (Q36).
  ADD COLUMN IF NOT EXISTS cf_synced_at      TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS invite_sent_at    TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS invite_message_id TEXT NULL;

-- The gate reads by email; the admin list and the cohort count read by status.
CREATE INDEX IF NOT EXISTS users_status_idx ON users (status);

-- Q35 — guarantee an active admin exists, WITHOUT consulting Cloudflare.
--
-- Runs once, when 080 is applied (_migrations is filename-tracked, see
-- runMigrations.ts) — a one-shot conditional evaluated against the database
-- state at apply time, not a continuously-enforced invariant.
--
-- Why here and not in the cutover script: run-restore.sh runs migrations and
-- nothing else. Restoring a pre-080 dump would default everyone to
-- member/active and leave ZERO admins, while the API sits in maintenance mode
-- that only an admin can clear, and step 6 of that script revokes every
-- device_token. Total lockout, recoverable only by break-glass SQL.
--
-- Resolution order is fixed:
--   (1) an active admin already exists            -> no-op
--   (2) a row matching the founding email exists  -> promote it
--   (3) otherwise                                 -> INSERT the founding row
--
-- Clause (3) exists because migration 001 creates no rows: a genuinely empty
-- database has nothing to promote (round-6 review finding 1). It never
-- promotes an arbitrary existing user — on a dump lacking the founding email,
-- "promote the oldest row" would hand admin to a random Beta user.
DO $$
DECLARE
  founding_email CONSTANT TEXT := 'jason.meyer1@gmail.com';
  target_id UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE role = 'admin' AND status = 'active') THEN
    RETURN;
  END IF;

  SELECT id INTO target_id FROM users WHERE lower(email) = founding_email;

  IF target_id IS NOT NULL THEN
    UPDATE users SET role = 'admin', status = 'active' WHERE id = target_id;
  ELSE
    -- cf_synced_at stays NULL: this row's CF membership is unknown until the
    -- reconciliation script (Q31) reads the live policy.
    INSERT INTO users (email, role, status) VALUES (founding_email, 'admin', 'active');
  END IF;
END $$;
