DO $$ BEGIN
  CREATE TYPE day_workout_kind AS ENUM ('strength','cardio','hybrid');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE program_status AS ENUM ('draft','active','paused','completed','archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE mesocycle_run_event_type AS ENUM (
    'started','paused','resumed','day_overridden','set_overridden',
    'day_skipped','customized','completed','abandoned'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
