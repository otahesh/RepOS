-- Beta W1.4 — health_workouts table.
-- New domain table for Apple Health workout ingestion (walks, runs, cycles,
-- swims, rows, ellipticals, strength sessions, etc.) coming from the
-- iOS Shortcut + future Withings/Renpho integrations. Mirrors the
-- (user_id, started_at, source) dedupe shape that weight samples use.
--
-- Modality is TEXT NOT NULL with NO CHECK constraint by design: the
-- application-side Zod schema in api/src/schemas/healthWorkouts.ts owns
-- the allowlist (walk|run|cycle|row|swim|elliptical|strength|other).
-- Keeping the allowlist in one place (Zod) avoids the migration-vs-code
-- drift that a duplicate SQL CHECK would invite. Do NOT add a CHECK on
-- modality in a follow-up migration without first removing the Zod one.
--
-- Note: migrate.ts wraps each migration file in its own BEGIN/COMMIT, so
-- this file omits explicit transaction control.

CREATE TABLE IF NOT EXISTS health_workouts (
  id           BIGSERIAL    PRIMARY KEY,
  user_id      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at   TIMESTAMPTZ  NOT NULL,
  ended_at     TIMESTAMPTZ  NOT NULL,
  modality     TEXT         NOT NULL,
  distance_m   INTEGER      NULL CHECK (distance_m IS NULL OR distance_m >= 0),
  duration_sec INTEGER      NOT NULL CHECK (duration_sec > 0),
  source       TEXT         NOT NULL CHECK (source IN ('Apple Health','Manual')),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (user_id, started_at, source),
  CHECK (ended_at > started_at)
);

-- Compound index for per-user chronological lookups (W1.4-C list/feed
-- queries, future analytics in W3+).
CREATE INDEX IF NOT EXISTS idx_health_workouts_user_started
  ON health_workouts (user_id, started_at DESC);

-- updated_at trigger. No shared set_updated_at() function exists in prior
-- migrations (029 also ships its own), so this migration follows the
-- same table-scoped pattern.
CREATE OR REPLACE FUNCTION health_workouts_set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS health_workouts_updated_at ON health_workouts;
CREATE TRIGGER health_workouts_updated_at
  BEFORE UPDATE ON health_workouts
  FOR EACH ROW
  EXECUTE FUNCTION health_workouts_set_updated_at();
