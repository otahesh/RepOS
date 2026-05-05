import { describe, it, expect } from 'vitest';
import { programTemplates } from '../../src/seed/programTemplates.js';
import { ProgramTemplateSeedSchema } from '../../src/schemas/programTemplate.js';

describe('programTemplates entries (lineup)', () => {
  it('includes full-body-3-day with 3 days/week and 5 weeks', () => {
    const t = programTemplates.find(p => p.slug === 'full-body-3-day');
    expect(t).toBeDefined();
    expect(t!.weeks).toBe(5);
    expect(t!.days_per_week).toBe(3);
    const parsed = ProgramTemplateSeedSchema.safeParse(t);
    expect(parsed.success).toBe(true);
  });

  it('includes upper-lower-4-day with 4 days/week, day_offsets [0,1,3,4]', () => {
    const t = programTemplates.find(p => p.slug === 'upper-lower-4-day');
    expect(t).toBeDefined();
    expect(t!.days_per_week).toBe(4);
    expect(t!.structure.days.map(d => d.day_offset)).toEqual([0, 1, 3, 4]);
    expect(ProgramTemplateSeedSchema.safeParse(t).success).toBe(true);
  });
});
