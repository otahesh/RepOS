import { describe, it, expect } from 'vitest';
import { buildDatabaseUrl } from '../../src/services/feedbackTriage-cli.js';

describe('buildDatabaseUrl', () => {
  it('prefers an explicit DATABASE_URL', () => {
    expect(buildDatabaseUrl({ DATABASE_URL: 'postgres://a/b' })).toBe('postgres://a/b');
  });

  it('builds one from POSTGRES_* when absent, as 002-w9-cf-baseline.sh does', () => {
    // DATABASE_URL is NOT in the container environment: the three s6 scripts
    // each build it into their own service, and `docker exec` inherits none of
    // that. A CLI that assumes it is ambient fails with FATAL 28000.
    expect(
      buildDatabaseUrl({
        POSTGRES_USER: 'repos',
        POSTGRES_PASSWORD: 'pw',
        POSTGRES_DB: 'repos',
      }),
    ).toBe('postgres://repos:pw@127.0.0.1:5432/repos');
  });

  it('applies the same defaults the shell scripts do', () => {
    expect(buildDatabaseUrl({ POSTGRES_PASSWORD: 'pw' })).toBe(
      'postgres://repos:pw@127.0.0.1:5432/repos',
    );
  });

  it('percent-encodes a password containing URL metacharacters', () => {
    const url = buildDatabaseUrl({ POSTGRES_PASSWORD: 'p@ss:word/#1' });
    expect(url).toBe('postgres://repos:p%40ss%3Aword%2F%231@127.0.0.1:5432/repos');
  });

  it('returns undefined when there is nothing to build from', () => {
    expect(buildDatabaseUrl({})).toBeUndefined();
  });
});
