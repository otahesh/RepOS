// api/src/types/program.ts
// Wire-record types — what `db.query` returns for the v1 program tables.
// `pg` returns Postgres NUMERIC as JS string by default; we model that
// faithfully (services convert to number where arithmetic is needed).

// ---------------------------------------------------------------------------
// Template structure — the JSONB `structure` column shape validated app-side.
// ---------------------------------------------------------------------------

export type TemplateBlock = {
  exercise_slug: string;
  mev: number;
  mav: number;
  target_reps_low: number;
  target_reps_high: number;
  target_rir: number;
  rest_sec: number;
  /** Primary movement pattern for frequency / fatigue scheduling rules. */
  movement_pattern?: string;
  cardio?: {
    target_duration_sec?: number;
    target_distance_m?: number;
    target_zone?: number;
  };
};

export type TemplateDayDef = {
  idx: number;
  day_offset: number;
  kind: 'strength' | 'cardio' | 'hybrid';
  name: string;
  blocks: TemplateBlock[];
};

export type ProgramTemplateStructure = {
  _v: 1;
  days: TemplateDayDef[];
};

// ---------------------------------------------------------------------------

export type ProgramStatus =
  | 'draft' | 'active' | 'paused' | 'completed' | 'archived';

export type DayWorkoutKind = 'strength' | 'cardio' | 'hybrid';

export type DayWorkoutStatus =
  | 'planned' | 'in_progress' | 'completed' | 'skipped';

export type MesocycleRunEventType =
  | 'started' | 'paused' | 'resumed'
  | 'day_overridden' | 'set_overridden'
  | 'day_skipped' | 'customized' | 'completed' | 'abandoned';

export interface ProgramTemplateRecord {
  id: string;
  slug: string;
  name: string;
  description: string;
  weeks: number;
  days_per_week: number;
  structure: unknown;            // validated app-side by ProgramTemplateSchema
  version: number;
  created_by: 'system' | 'user';
  seed_key: string | null;
  seed_generation: number | null;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface UserProgramRecord {
  id: string;
  user_id: string;
  template_id: string | null;
  template_version: number | null;
  name: string;
  customizations: Record<string, unknown>;
  status: ProgramStatus;
  created_at: Date;
  updated_at: Date;
}

export interface MesocycleRunRecord {
  id: string;
  user_program_id: string;
  user_id: string;
  start_date: string;            // ISO date 'YYYY-MM-DD' (pg DATE → string)
  start_tz: string;              // IANA TZ identifier
  weeks: number;
  current_week: number;
  status: ProgramStatus;
  finished_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface DayWorkoutRecord {
  id: string;
  mesocycle_run_id: string;
  week_idx: number;
  day_idx: number;
  scheduled_date: string;        // 'YYYY-MM-DD'
  kind: DayWorkoutKind;
  name: string;
  notes: string | null;
  status: DayWorkoutStatus;
  completed_at: Date | null;
}

export interface PlannedSetRecord {
  id: string;
  day_workout_id: string;
  block_idx: number;
  set_idx: number;
  exercise_id: string;
  target_reps_low: number;
  target_reps_high: number;
  target_rir: number;            // CHECK >= 1 enforced at DB
  target_load_hint: string | null;
  rest_sec: number;
  overridden_at: Date | null;
  override_reason: string | null;
  substituted_from_exercise_id: string | null;
}

export interface PlannedCardioBlockRecord {
  id: string;
  day_workout_id: string;
  block_idx: number;
  exercise_id: string;
  target_duration_sec: number | null;
  target_distance_m: number | null;
  target_zone: number | null;    // 1..5
  overridden_at: Date | null;
  override_reason: string | null;
}

export interface SetLogRecord {
  id: string;
  planned_set_id: string;
  performed_reps: number | null;
  performed_load_lbs: string | null;   // pg NUMERIC → string by default
  performed_rir: number | null;
  performed_at: Date;
  notes: string | null;
}

export interface MesocycleRunEventRecord {
  id: string;                    // BIGSERIAL → bigint string from pg
  run_id: string;
  event_type: MesocycleRunEventType;
  payload: Record<string, unknown>;
  occurred_at: Date;
}
