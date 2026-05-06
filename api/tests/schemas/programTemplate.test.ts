import { describe, it, expect } from 'vitest';
import { ProgramTemplateSchema } from '../../src/schemas/programTemplate.js';

const baseDay = (extra: Partial<any> = {}) => ({
  idx: 0, day_offset: 0, kind: 'strength' as const, name: 'Mon',
  blocks: [{
    exercise_slug: 'barbell-back-squat',
    mev: 8, mav: 14,
    target_reps_low: 5, target_reps_high: 8,
    target_rir: 2, rest_sec: 180,
  }],
  ...extra,
});

const validTemplate = {
  slug: 'test-template',
  name: 'Test',
  description: 'desc',
  weeks: 5,
  days_per_week: 3,
  structure: {
    _v: 1,
    days: [
      baseDay({ idx: 0, day_offset: 0 }),
      baseDay({ idx: 1, day_offset: 2 }),
      baseDay({ idx: 2, day_offset: 4 }),
    ],
  },
};

describe('ProgramTemplateSchema', () => {
  it('accepts a valid 3-day template', () => {
    const r = ProgramTemplateSchema.safeParse(validTemplate);
    expect(r.success).toBe(true);
  });

  it('rejects bad slug', () => {
    const r = ProgramTemplateSchema.safeParse({ ...validTemplate, slug: 'Bad Slug' });
    expect(r.success).toBe(false);
  });

  it('rejects weeks > 16', () => {
    const r = ProgramTemplateSchema.safeParse({ ...validTemplate, weeks: 17 });
    expect(r.success).toBe(false);
  });

  it('rejects day_offset outside 0..6', () => {
    const t = {
      ...validTemplate,
      structure: { _v: 1, days: [baseDay({ idx: 0, day_offset: 7 })] },
      days_per_week: 1,
    };
    const r = ProgramTemplateSchema.safeParse(t);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(JSON.stringify(r.error.issues)).toMatch(/day_offset/);
    }
  });

  it('rejects duplicate day_offset within a week', () => {
    const t = {
      ...validTemplate,
      structure: {
        _v: 1,
        days: [
          baseDay({ idx: 0, day_offset: 0 }),
          baseDay({ idx: 1, day_offset: 0 }),
          baseDay({ idx: 2, day_offset: 4 }),
        ],
      },
    };
    const r = ProgramTemplateSchema.safeParse(t);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(JSON.stringify(r.error.issues)).toMatch(/strictly increasing/i);
    }
  });

  it('rejects non-monotonic day_offset within a week', () => {
    const t = {
      ...validTemplate,
      structure: {
        _v: 1,
        days: [
          baseDay({ idx: 0, day_offset: 4 }),
          baseDay({ idx: 1, day_offset: 1 }),
          baseDay({ idx: 2, day_offset: 5 }),
        ],
      },
    };
    const r = ProgramTemplateSchema.safeParse(t);
    expect(r.success).toBe(false);
  });

  it('rejects MEV > MAV in a block', () => {
    const t = {
      ...validTemplate,
      structure: {
        _v: 1,
        days: [
          baseDay({
            idx: 0, day_offset: 0,
            blocks: [{
              exercise_slug: 'x', mev: 14, mav: 8,
              target_reps_low: 5, target_reps_high: 8,
              target_rir: 2, rest_sec: 180,
            }],
          }),
        ],
      },
      days_per_week: 1,
    };
    const r = ProgramTemplateSchema.safeParse(t);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(JSON.stringify(r.error.issues)).toMatch(/mev/i);
    }
  });

  it('rejects target_rir = 0 (RIR 0 banned)', () => {
    const t = {
      ...validTemplate,
      structure: {
        _v: 1,
        days: [baseDay({
          idx: 0, day_offset: 0,
          blocks: [{
            exercise_slug: 'x', mev: 8, mav: 14,
            target_reps_low: 5, target_reps_high: 8,
            target_rir: 0, rest_sec: 180,
          }],
        })],
      },
      days_per_week: 1,
    };
    const r = ProgramTemplateSchema.safeParse(t);
    expect(r.success).toBe(false);
  });

  it('rejects reps_low > reps_high', () => {
    const t = {
      ...validTemplate,
      structure: {
        _v: 1,
        days: [baseDay({
          idx: 0, day_offset: 0,
          blocks: [{
            exercise_slug: 'x', mev: 8, mav: 14,
            target_reps_low: 12, target_reps_high: 5,
            target_rir: 2, rest_sec: 180,
          }],
        })],
      },
      days_per_week: 1,
    };
    const r = ProgramTemplateSchema.safeParse(t);
    expect(r.success).toBe(false);
  });

  it('cardio block requires duration or distance', () => {
    const t = {
      ...validTemplate,
      structure: {
        _v: 1,
        days: [{
          idx: 0, day_offset: 0, kind: 'cardio', name: 'Z2',
          blocks: [{
            exercise_slug: 'treadmill',
            cardio: { target_zone: 2 },
          }],
        }],
      },
      days_per_week: 1,
    };
    const r = ProgramTemplateSchema.safeParse(t);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(JSON.stringify(r.error.issues)).toMatch(/duration|distance/i);
    }
  });

  it('cardio block accepts duration', () => {
    const t = {
      ...validTemplate,
      structure: {
        _v: 1,
        days: [{
          idx: 0, day_offset: 0, kind: 'cardio', name: 'Z2',
          blocks: [{
            exercise_slug: 'treadmill',
            cardio: { target_duration_sec: 1800, target_zone: 2 },
          }],
        }],
      },
      days_per_week: 1,
    };
    const r = ProgramTemplateSchema.safeParse(t);
    expect(r.success).toBe(true);
  });
});
