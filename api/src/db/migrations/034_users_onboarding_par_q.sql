-- api/src/db/migrations/034_users_onboarding_par_q.sql
-- Beta W2.1 — onboarding + PAR-Q columns on users.
-- All ADD COLUMN IF NOT EXISTS so the migration is idempotent on re-runs.
-- Defaults chosen so existing alpha-tester rows are valid without backfill:
--   onboarding_completed_at: NULL → treated as "needs onboarding" by the
--     overlay; the alpha-tester is backfilled to now() in this same
--     migration (see WHERE clause below) so they don't see the wizard.
--   par_q_acknowledged_at: NULL → treated as "needs PAR-Q gate."
--   par_q_version: 0 default. The current ACTIVE version constant in
--     api/src/constants/parQ.ts is PAR_Q_VERSION = 2 (post Q7 wording fix
--     + Q9 chronic-condition addition). Rows at par_q_version=0 get the
--     gate; rows at par_q_version >= PAR_Q_VERSION skip it.
--   par_q_advisory_active: false default. Set to true by the PAR-Q POST
--     handler when any_yes=true on the answers payload. Read by W3
--     stalledPr evaluator and W4 landmarks editor to cap user volume at
--     MEV with RIR=3 floor until the user posts par_q_advisory_active=false
--     via the Settings → Health "Mark cleared" affordance.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS par_q_acknowledged_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS par_q_version           SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS par_q_advisory_active   BOOLEAN  NOT NULL DEFAULT false;

-- Alpha-tester backfill: the production alpha user skips onboarding so a
-- Beta cutover doesn't re-prompt them. They still see PAR-Q because that's
-- a new clinical gate. LOWER() per migration 007's case-insensitive convention.
--
-- IMPORTANT (panel finding I-MIG-034): the alpha-cohort target email is
-- 'jason@jpmtech.com' per scripts/cutover/001-placeholder-to-jmeyer.sql
-- (which targets that address explicitly with -v target_email=...). The
-- user's session email 'jmeyer@ironcloudtech.com' is separate. If the
-- Beta cohort eventually expands, ADD additional addresses here — do NOT
-- swap. Use `lower(email) = $1` semantics; IN-list left for clarity.
UPDATE users
   SET onboarding_completed_at = now()
 WHERE onboarding_completed_at IS NULL
   AND lower(email) = 'jason@jpmtech.com';
