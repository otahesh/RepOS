DO $$ BEGIN
  CREATE TYPE movement_pattern AS ENUM (
    'push_horizontal','push_vertical','pull_horizontal','pull_vertical',
    'squat','hinge','lunge','carry','rotation','anti_rotation','gait'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE peak_tension_length AS ENUM ('short','mid','long','lengthened_partial_capable');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS exercises (
  id                                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                                TEXT UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9-]+$'),
  name                                TEXT NOT NULL,
  parent_exercise_id                  UUID REFERENCES exercises(id) ON DELETE SET NULL,
  primary_muscle_id                   INT NOT NULL REFERENCES muscles(id),
  movement_pattern                    movement_pattern NOT NULL,
  peak_tension_length                 peak_tension_length NOT NULL,
  required_equipment                  JSONB NOT NULL DEFAULT '{"_v":1,"requires":[]}'::jsonb,
  skill_complexity                    SMALLINT NOT NULL CHECK (skill_complexity BETWEEN 1 AND 5),
  loading_demand                      SMALLINT NOT NULL CHECK (loading_demand BETWEEN 1 AND 5),
  systemic_fatigue                    SMALLINT NOT NULL CHECK (systemic_fatigue BETWEEN 1 AND 5),
  joint_stress_profile                JSONB NOT NULL DEFAULT '{"_v":1}'::jsonb,
  eccentric_overload_capable          BOOLEAN NOT NULL DEFAULT false,
  contraindications                   TEXT[] NOT NULL DEFAULT '{}',
  requires_shoulder_flexion_overhead  BOOLEAN NOT NULL DEFAULT false,
  loads_spine_in_flexion              BOOLEAN NOT NULL DEFAULT false,
  loads_spine_axially                 BOOLEAN NOT NULL DEFAULT false,
  requires_hip_internal_rotation      BOOLEAN NOT NULL DEFAULT false,
  requires_ankle_dorsiflexion         BOOLEAN NOT NULL DEFAULT false,
  requires_wrist_extension_loaded     BOOLEAN NOT NULL DEFAULT false,
  created_by                          TEXT NOT NULL DEFAULT 'system' CHECK (created_by IN ('system','user')),
  seed_generation                     INT,
  archived_at                         TIMESTAMPTZ,
  created_at                          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (parent_exercise_id <> id)
);

CREATE INDEX IF NOT EXISTS idx_exercises_pattern        ON exercises(movement_pattern)        WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_exercises_primary_muscle ON exercises(primary_muscle_id)       WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_exercises_parent         ON exercises(parent_exercise_id)      WHERE parent_exercise_id IS NOT NULL;
