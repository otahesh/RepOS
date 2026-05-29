import { describe, it, expect } from 'vitest';
import { validateStartupEnv } from '../src/bootstrap-guards.js';

describe('validateStartupEnv — FEEDBACK_WEBHOOK_URL', () => {
  const base = { DATABASE_URL: 'postgres://x', NODE_ENV: 'test' } as NodeJS.ProcessEnv;
  it('info-logs (not fatal) when FEEDBACK_WEBHOOK_URL is unset', () => {
    const r = validateStartupEnv({ ...base });
    expect(r.fatal).not.toContain('FEEDBACK_WEBHOOK_URL must be set');
    expect(JSON.stringify(r.info)).toMatch(/FEEDBACK_WEBHOOK_URL unset/);
  });
  it('does not info-log when set', () => {
    const r = validateStartupEnv({ ...base, FEEDBACK_WEBHOOK_URL: 'https://discord/x' });
    expect(JSON.stringify(r.info)).not.toMatch(/FEEDBACK_WEBHOOK_URL unset/);
  });
});
