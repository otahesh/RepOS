ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS seed_key TEXT;

UPDATE exercises SET seed_key='exercises' WHERE created_by='system' AND seed_key IS NULL;

CREATE INDEX IF NOT EXISTS idx_exercises_seed_key
  ON exercises(seed_key) WHERE seed_key IS NOT NULL;
