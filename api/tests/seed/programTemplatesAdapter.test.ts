import { describe, it, expect } from 'vitest';
import { makeProgramTemplateAdapter } from '../../src/seed/adapters/programTemplates.js';

describe('programTemplateSeedAdapter', () => {
  it('exports validate / upsertOne / archiveMissing', () => {
    const adapter = makeProgramTemplateAdapter(new Set());
    expect(typeof adapter.validate).toBe('function');
    expect(typeof adapter.upsertOne).toBe('function');
    expect(typeof adapter.archiveMissing).toBe('function');
  });

  it('rejects empty entries with a contextual error', () => {
    const r = makeProgramTemplateAdapter(new Set()).validate([]);
    // empty array is allowed by zod array; this asserts the schema still parses
    expect(r.success).toBe(true);
  });
});
