import { describe, it, expect } from 'vitest';
import { makeProgramTemplateAdapter } from '../../src/seed/adapters/programTemplates.js';
import type { ProgramTemplateSeed } from '../../src/schemas/programTemplate.js';

const minimalDay = {
  idx: 0, day_offset: 0, kind: 'strength' as const, name: 'D',
  blocks: [{ exercise_slug: 'dumbbell-bench-press', mev: 2, mav: 3, target_reps_low: 8, target_reps_high: 10, target_rir: 1, rest_sec: 90 }],
};
const baseTpl: ProgramTemplateSeed = {
  slug: 'val-test-a', name: 'A', description: '', weeks: 1, days_per_week: 1,
  structure: { _v: 1, days: [minimalDay] },
};

describe('programTemplate validator', () => {
  it('rejects duplicate slug', () => {
    const adapter = makeProgramTemplateAdapter(new Set(['dumbbell-bench-press']));
    const r = adapter.validate([baseTpl, { ...baseTpl, name: 'A2' }]);
    expect(r.success).toBe(false);
    if (!r.success) expect(JSON.stringify(r.error.issues)).toMatch(/duplicate slug/i);
  });

  it('rejects unknown exercise_slug reference', () => {
    const adapter = makeProgramTemplateAdapter(new Set(['dumbbell-bench-press']));
    const bad: ProgramTemplateSeed = {
      ...baseTpl,
      structure: { _v: 1, days: [{ ...minimalDay, blocks: [{ ...minimalDay.blocks[0], exercise_slug: 'made-up-slug' }] }] },
    };
    const r = adapter.validate([bad]);
    expect(r.success).toBe(false);
    if (!r.success) expect(JSON.stringify(r.error.issues)).toMatch(/exercise_slug.*made-up-slug/i);
  });

  it('rejects day_idx >= days_per_week', () => {
    const adapter = makeProgramTemplateAdapter(new Set(['dumbbell-bench-press']));
    const bad: ProgramTemplateSeed = {
      ...baseTpl,
      days_per_week: 1,
      structure: { _v: 1, days: [{ ...minimalDay, idx: 2 }] },
    };
    const r = adapter.validate([bad]);
    expect(r.success).toBe(false);
    if (!r.success) expect(JSON.stringify(r.error.issues)).toMatch(/day.*idx|out of range/i);
  });

  it('rejects day_offset outside 0..6', () => {
    const adapter = makeProgramTemplateAdapter(new Set(['dumbbell-bench-press']));
    const bad: ProgramTemplateSeed = {
      ...baseTpl,
      structure: { _v: 1, days: [{ ...minimalDay, day_offset: 7 }] },
    };
    const r = adapter.validate([bad]);
    expect(r.success).toBe(false);
    if (!r.success) expect(JSON.stringify(r.error.issues)).toMatch(/day_offset/);
  });

  it('rejects duplicate day_offset within a week', () => {
    const adapter = makeProgramTemplateAdapter(new Set(['dumbbell-bench-press']));
    const dupOffset: ProgramTemplateSeed = {
      ...baseTpl, days_per_week: 2,
      structure: { _v: 1, days: [
        { ...minimalDay, idx: 0, day_offset: 1 },
        { ...minimalDay, idx: 1, day_offset: 1 },
      ]},
    };
    const r = adapter.validate([dupOffset]);
    expect(r.success).toBe(false);
  });

  it('rejects non-monotonic day_offset within a week', () => {
    const adapter = makeProgramTemplateAdapter(new Set(['dumbbell-bench-press']));
    const reversed: ProgramTemplateSeed = {
      ...baseTpl, days_per_week: 2,
      structure: { _v: 1, days: [
        { ...minimalDay, idx: 0, day_offset: 3 },
        { ...minimalDay, idx: 1, day_offset: 1 },
      ]},
    };
    const r = adapter.validate([reversed]);
    expect(r.success).toBe(false);
  });

  it('rejects an unknown week_idx field on day (single-week canonical shape)', () => {
    const adapter = makeProgramTemplateAdapter(new Set(['dumbbell-bench-press']));
    const bad = {
      ...baseTpl,
      structure: { _v: 1, days: [{ ...minimalDay, week_idx: 1 }] },
    } as any;
    const r = adapter.validate([bad]);
    expect(r.success).toBe(false);
  });

  it('rejects block where MEV > MAV', () => {
    const adapter = makeProgramTemplateAdapter(new Set(['dumbbell-bench-press']));
    const bad: ProgramTemplateSeed = {
      ...baseTpl,
      structure: { _v: 1, days: [{ ...minimalDay,
        blocks: [{ ...minimalDay.blocks[0], mev: 5, mav: 3 }] }] },
    };
    const r = adapter.validate([bad]);
    expect(r.success).toBe(false);
    if (!r.success) expect(JSON.stringify(r.error.issues)).toMatch(/mev.*mav|mav.*mev/i);
  });

  it('rejects cardio block referencing non-cardio exercise', () => {
    const adapter = makeProgramTemplateAdapter(
      new Set(['dumbbell-bench-press', 'outdoor-walking-z2']),
      new Set(['outdoor-walking-z2']),
    );
    const bad: ProgramTemplateSeed = {
      ...baseTpl,
      structure: { _v: 1, days: [{ ...minimalDay, kind: 'cardio',
        blocks: [{
          exercise_slug: 'dumbbell-bench-press',
          cardio: { target_duration_sec: 1800, target_zone: 2 },
        }] }] },
    };
    const r = adapter.validate([bad]);
    expect(r.success).toBe(false);
    if (!r.success) expect(JSON.stringify(r.error.issues)).toMatch(/cardio.*non.?cardio|not a cardio/i);
  });
});
