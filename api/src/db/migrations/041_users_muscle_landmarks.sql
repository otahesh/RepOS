-- Beta W4.2 — users.muscle_landmarks JSONB column.
-- Stores per-user overrides for MEV/MAV/MRV per muscle slug. Canonical
-- defaults remain in api/src/services/_muscleLandmarks.ts; this column
-- carries ONLY the user's deltas. Shape:
--   { _v: 1, overrides: { <muscle_slug>: { mev, mav, mrv, mv? } } }
--
-- Reads merge via resolveUserLandmarks(userId) in the same file as the
-- existing MUSCLE_LANDMARKS constant. Writes are validated by
-- api/src/schemas/userLandmarks.ts (MV<=MEV<MAV<MRV, MV>=0, MRV<=50).
--
-- Per project_alpha_state.md: post-W0 alpha data wipe has already run;
-- the column defaults to '{"_v":1}'::jsonb so the merge is identity.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS muscle_landmarks JSONB NOT NULL DEFAULT '{"_v":1}'::jsonb;

-- [I-MIG-040-CHECK] Belt-and-suspenders shape guard. The application path
-- always writes through the zod schema, but a direct DB write (admin REPL,
-- bad migration, etc.) would silently corrupt the column otherwise.
ALTER TABLE users
  ADD CONSTRAINT users_muscle_landmarks_shape
  CHECK (jsonb_typeof(muscle_landmarks) = 'object' AND muscle_landmarks ? '_v');
