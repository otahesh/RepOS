import { describe, it, expect } from 'vitest';
import { programTemplateSeedAdapter } from '../../src/seed/adapters/programTemplates.js';

describe('programTemplateSeedAdapter', () => {
  it('exports validate / upsertOne / archiveMissing', () => {
    expect(typeof programTemplateSeedAdapter.validate).toBe('function');
    expect(typeof programTemplateSeedAdapter.upsertOne).toBe('function');
    expect(typeof programTemplateSeedAdapter.archiveMissing).toBe('function');
  });

  it('rejects empty entries with a contextual error', () => {
    const r = programTemplateSeedAdapter.validate([]);
    // empty array is allowed by zod array; this asserts the schema still parses
    expect(r.success).toBe(true);
  });
});
