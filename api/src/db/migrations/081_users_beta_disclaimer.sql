-- G14 — first-run Beta disclaimer acknowledgment. NULL until the user acks
-- the "this is Beta software, not medical advice" first-run notice; stamped
-- once by POST /api/me/beta-disclaimer-ack (idempotent, COALESCE-guarded).
-- Additive only.
ALTER TABLE users ADD COLUMN IF NOT EXISTS beta_disclaimer_ack_at TIMESTAMPTZ;
