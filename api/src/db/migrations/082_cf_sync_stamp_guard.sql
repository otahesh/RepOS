-- Beta W9 — Q24 as a database invariant.
--
-- `cf_synced_at` means "this row's intent is reflected in the CF policy". Q24
-- requires it be cleared to NULL by any status change that ALTERS that intent,
-- and stamped only after a successful sync. Until now that rule lived only in
-- prose and in each caller's discipline, and it was broken three times in this
-- wave: retrySync preserved a stale stamp on failure, and both break-glass
-- UPDATEs promoted a row without clearing. A stale stamp is not cosmetic — the
-- row keeps asserting "CF agrees" right where nothing has established it, so
-- /settings/users reports synced while membership is unverified.
--
-- Enforced here rather than by a static check over `SET status=` because that
-- check is unsatisfiable and imprecise:
--   * invited -> active must PRESERVE the stamp (both require policy presence),
--   * migration 080 promotes while the column it just added is still NULL,
--   * fixtures set status without modelling Cloudflare at all,
--   * multiline, reordered and dynamically-built SQL evade text matching.
-- The invariant is about MEMBERSHIP GROUPS, so the database enforces those.
--
--   presence group: active, invited     -- address SHOULD be in the policy
--   absence  group: suspended, deleting -- address should NOT be
--
-- Crossing between groups changes membership intent; moving within a group does
-- not. Callers that need to end up stamped do it in two statements inside one
-- transaction (clear + cross, then stamp). The commit is still atomic, so Q7's
-- ordering guarantee — the grant takes effect last — is unchanged.

CREATE OR REPLACE FUNCTION users_cf_stamp_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.status IN ('active','invited')) IS DISTINCT FROM (OLD.status IN ('active','invited'))
     AND NEW.cf_synced_at IS NOT NULL THEN
    RAISE EXCEPTION
      'cf_synced_at must be NULL when users.status crosses CF membership groups (Q24): % -> %',
      OLD.status, NEW.status
      USING ERRCODE = 'check_violation',
            HINT = 'Clear cf_synced_at in the same statement, then stamp it after a successful sync.';
  END IF;
  RETURN NEW;
END $$;

-- BEFORE UPDATE OF status fires whenever status appears in the SET list; the
-- WHEN clause narrows that to statements that actually change it, so a no-op
-- rewrite of the same status never trips the guard.
DROP TRIGGER IF EXISTS users_cf_stamp_guard ON users;
CREATE TRIGGER users_cf_stamp_guard
  BEFORE UPDATE OF status ON users
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION users_cf_stamp_guard();
