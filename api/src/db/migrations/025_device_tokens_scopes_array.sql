-- Spec assumes scopes is TEXT[]; production has scope TEXT singular.
-- Backfill into array, drop singular column. Unblocks the program:write
-- scope addition (Task C.1).
ALTER TABLE device_tokens
  ADD COLUMN IF NOT EXISTS scopes TEXT[] NOT NULL DEFAULT ARRAY['health:weight:write']::TEXT[];

UPDATE device_tokens
   SET scopes = ARRAY[scope]
 WHERE scope IS NOT NULL
   AND NOT (scope = ANY(scopes));

ALTER TABLE device_tokens DROP COLUMN IF EXISTS scope;
