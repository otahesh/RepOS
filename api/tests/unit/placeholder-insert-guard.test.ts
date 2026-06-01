import { describe, it, expect } from 'vitest';
import {
  assertNotPlaceholderUserId,
  PLACEHOLDER_USER_ID,
} from '../../src/bootstrap-runtime.js';

const REAL_UUID = '11111111-2222-3333-4444-555555555555';

describe('assertNotPlaceholderUserId', () => {
  it('throws when the placeholder UUID is written in production', () => {
    expect(() =>
      assertNotPlaceholderUserId(PLACEHOLDER_USER_ID, { NODE_ENV: 'production' } as NodeJS.ProcessEnv),
    ).toThrow(/placeholder user/i);
  });

  it('throws when the placeholder UUID is written in development', () => {
    expect(() =>
      assertNotPlaceholderUserId(PLACEHOLDER_USER_ID, { NODE_ENV: 'development' } as NodeJS.ProcessEnv),
    ).toThrow(/placeholder user/i);
  });

  it('is a no-op for the placeholder UUID in test env (fixtures may carry it)', () => {
    expect(() =>
      assertNotPlaceholderUserId(PLACEHOLDER_USER_ID, { NODE_ENV: 'test' } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });

  it('passes a real UUID in production', () => {
    expect(() =>
      assertNotPlaceholderUserId(REAL_UUID, { NODE_ENV: 'production' } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });

  it('passes null / undefined without throwing (no write yet)', () => {
    expect(() => assertNotPlaceholderUserId(null, { NODE_ENV: 'production' } as NodeJS.ProcessEnv)).not.toThrow();
    expect(() => assertNotPlaceholderUserId(undefined, { NODE_ENV: 'production' } as NodeJS.ProcessEnv)).not.toThrow();
  });
});
