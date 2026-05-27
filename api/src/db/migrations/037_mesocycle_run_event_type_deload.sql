-- api/src/db/migrations/037_mesocycle_run_event_type_deload.sql
-- Beta W2.5 — add 'manual_deload' + 'manual_deload_undone' to the
-- mesocycle_run_event_type enum so the manual-deload audit trail fits
-- the existing mesocycle_run_events writer pattern.
--
-- Postgres semantics (panel I-MIG-037): on PG 12+, `ALTER TYPE … ADD VALUE
-- IF NOT EXISTS` IS allowed inside a transaction — but the newly-added
-- value CANNOT be referenced from within the SAME transaction. That means
-- this migration must NOT contain any `SELECT 'manual_deload'::mesocycle_run_event_type`
-- or `INSERT … VALUES ('manual_deload', …)` smoke test. Any test using
-- the new value belongs in a separate migration or in integration tests.
-- migrate.ts wraps each migration in BEGIN/COMMIT, which is fine because
-- the IF NOT EXISTS guard makes re-runs no-op safe. (Local + prod are PG 16.)
ALTER TYPE mesocycle_run_event_type ADD VALUE IF NOT EXISTS 'manual_deload';
ALTER TYPE mesocycle_run_event_type ADD VALUE IF NOT EXISTS 'manual_deload_undone';
