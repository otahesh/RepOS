// api/src/services/scheduleRules.ts
import type { ProgramTemplateStructure } from '../types/program.js';

export type ScheduleWarning = {
  code: 'too_many_days_per_week' | 'consecutive_same_pattern' | 'cardio_interval_too_close' | 'hiit_day_before_heavy_lower';
  severity: 'warn' | 'block';
  message: string;
  day_idx?: number;
};

export function validateFrequencyLimits(structure: ProgramTemplateStructure): ScheduleWarning[] {
  const out: ScheduleWarning[] = [];
  const trainingDays = structure.days.filter(d => d.kind !== 'cardio' || (d.blocks?.length ?? 0) > 0);
  if (trainingDays.length >= 7) {
    out.push({ code: 'too_many_days_per_week', severity: 'block', message: '7 training days/week — recovery debt is unavoidable. Drop a day.' });
  } else if (trainingDays.length === 6) {
    out.push({ code: 'too_many_days_per_week', severity: 'warn', message: '6 days/week is the cap. Watch sleep and food.' });
  }
  // Sort by day_offset and walk consecutively. We treat day_offset N and N+1 as consecutive.
  const sorted = [...structure.days].sort((a, b) => a.day_offset - b.day_offset);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1], curr = sorted[i];
    if (curr.day_offset - prev.day_offset !== 1) continue;
    const prevPat = (prev.blocks?.[0] as any)?.movement_pattern;
    const currPat = (curr.blocks?.[0] as any)?.movement_pattern;
    const prevRir = prev.blocks?.[0]?.target_rir ?? 99;
    const currRir = curr.blocks?.[0]?.target_rir ?? 99;
    if (prevPat && prevPat === currPat && prevRir <= 2 && currRir <= 2) {
      out.push({
        code: 'consecutive_same_pattern',
        severity: 'warn',
        message: `Same primary pattern (${prevPat}) on consecutive days at RIR ≤ 2 — joint stress accumulates.`,
        day_idx: curr.idx,
      });
    }
  }
  return out;
}

export function validateCardioScheduling(_structure: ProgramTemplateStructure): ScheduleWarning[] {
  // Implemented in B.14
  return [];
}
