import { describe, it, expect } from 'vitest';
import { FeedbackCreateSchema } from '../src/schemas/feedback.js';

describe('FeedbackCreateSchema', () => {
  it('accepts a normal body and trims it', () => {
    const r = FeedbackCreateSchema.safeParse({ body: '  the rest timer skipped  ' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.body).toBe('the rest timer skipped');
  });

  it('accepts an optional route', () => {
    const r = FeedbackCreateSchema.safeParse({ body: 'hi', route: '/today/abc/log' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.route).toBe('/today/abc/log');
  });

  it('rejects an empty / whitespace-only body', () => {
    expect(FeedbackCreateSchema.safeParse({ body: '   ' }).success).toBe(false);
    expect(FeedbackCreateSchema.safeParse({ body: '' }).success).toBe(false);
  });

  it('rejects a body over 4000 chars', () => {
    expect(FeedbackCreateSchema.safeParse({ body: 'x'.repeat(4001) }).success).toBe(false);
    expect(FeedbackCreateSchema.safeParse({ body: 'x'.repeat(4000) }).success).toBe(true);
  });

  it('rejects unknown keys (cannot spoof user_id)', () => {
    expect(FeedbackCreateSchema.safeParse({ body: 'hi', user_id: 'other' }).success).toBe(false);
  });
});
