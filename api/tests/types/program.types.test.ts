import { describe, it, expectTypeOf } from 'vitest';
import type {
  ProgramStatus,
  DayWorkoutKind,
  MesocycleRunEventType,
  MesocycleRunRecord,
  DayWorkoutRecord,
  PlannedSetRecord,
  PlannedCardioBlockRecord,
  SetLogRecord,
  ProgramTemplateRecord,
  UserProgramRecord,
  MesocycleRunEventRecord,
} from '../../src/types/program.js';

describe('program record types', () => {
  it('ProgramStatus enum-equivalent string union', () => {
    expectTypeOf<ProgramStatus>().toEqualTypeOf<
      'draft' | 'active' | 'paused' | 'completed' | 'archived'
    >();
  });

  it('DayWorkoutKind has no rest member', () => {
    expectTypeOf<DayWorkoutKind>().toEqualTypeOf<'strength' | 'cardio' | 'hybrid'>();
  });

  it('MesocycleRunEventType lists all 9 v1 events', () => {
    expectTypeOf<MesocycleRunEventType>().toEqualTypeOf<
      | 'started' | 'paused' | 'resumed'
      | 'day_overridden' | 'set_overridden'
      | 'day_skipped' | 'customized' | 'completed' | 'abandoned'
    >();
  });

  it('MesocycleRunRecord carries start_tz string', () => {
    expectTypeOf<MesocycleRunRecord['start_tz']>().toEqualTypeOf<string>();
    expectTypeOf<MesocycleRunRecord['status']>().toEqualTypeOf<ProgramStatus>();
  });

  it('PlannedSetRecord target_rir is number, not 0', () => {
    expectTypeOf<PlannedSetRecord['target_rir']>().toEqualTypeOf<number>();
  });

  it('PlannedCardioBlockRecord allows nullable duration / distance', () => {
    expectTypeOf<PlannedCardioBlockRecord['target_duration_sec']>()
      .toEqualTypeOf<number | null>();
    expectTypeOf<PlannedCardioBlockRecord['target_distance_m']>()
      .toEqualTypeOf<number | null>();
  });

  it('SetLogRecord performed_load_lbs is number-string union (pg returns string for NUMERIC)', () => {
    expectTypeOf<SetLogRecord['performed_load_lbs']>().toEqualTypeOf<string | null>();
  });

  it('DayWorkoutRecord, ProgramTemplateRecord, UserProgramRecord, MesocycleRunEventRecord exist', () => {
    expectTypeOf<DayWorkoutRecord>().not.toBeAny();
    expectTypeOf<ProgramTemplateRecord>().not.toBeAny();
    expectTypeOf<UserProgramRecord>().not.toBeAny();
    expectTypeOf<MesocycleRunEventRecord>().not.toBeAny();
  });
});
