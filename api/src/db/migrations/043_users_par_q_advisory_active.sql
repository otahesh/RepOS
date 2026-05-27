-- Beta W4 follow-up (migration range 043-049 reserved per W4 plan front-matter).
--
-- TODO(W2): users.par_q_advisory_active is OWNED by W2 (PAR-Q clinical-safety
-- onboarding sets it when a user's PAR-Q screen flags a contraindication). W2
-- has not merged at W4-ship time, but W4.3's LandmarksEditor [D2] reads this
-- flag via GET /api/users/me/landmarks to cap MAV/MRV at 80% of seeded defaults
-- with the "talk to a clinician" advisory. To keep the W4 route clean (a plain
-- SELECT par_q_advisory_active) and the D2 feature testable, W4 claims the
-- column defensively here with IF NOT EXISTS — same name, type, and default
-- W2 will use, so both migrations are idempotent. When W2 lands, reconcile to
-- a single owning migration.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS par_q_advisory_active BOOLEAN NOT NULL DEFAULT false;
