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
});
