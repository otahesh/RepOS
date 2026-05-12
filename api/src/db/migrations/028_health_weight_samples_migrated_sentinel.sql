-- Beta W0.5 — sentinel column for idempotent placeholder → real-user cutover.
-- Set by scripts/cutover/001-placeholder-to-jmeyer.sql; NULL means "not migrated."
-- Re-runs of the cutover only touch rows WHERE migrated_from_placeholder_at IS NULL,
-- which keeps the cutover an idempotent no-op after first success.

ALTER TABLE health_weight_samples
  ADD COLUMN IF NOT EXISTS migrated_from_placeholder_at TIMESTAMPTZ NULL;
