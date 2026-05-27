-- api/src/db/migrations/039_w2_marker.sql
-- Beta W2.4 — slot-claim only.
--
-- This migration intentionally contains no DDL or DML. It exists to
-- claim migration number 039 in the W2 range so concurrent waves (W4/W5/W6)
-- do not collide with this slot when running their own migrations.
--
-- The actual W2 core-taxonomy seed-generation bump happens in
-- api/src/seed/adapters/exercises.ts and adapters/programTemplates.ts
-- on the next `npm run seed`, NOT here. Keeping migrations strictly DDL
-- (panel finding I-MIG-039) avoids schema/data muddle.
--
-- This file's presence in the migration history is the slot claim.
-- migrate.ts records it in _migrations on first run; subsequent
-- runs see the row and skip the file body (empty body is fine).

SELECT 1;  -- single SELECT so the migrate-runner has something to execute
