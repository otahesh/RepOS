import { describe, it, expect } from 'vitest';
import { validateStartupEnv } from '../../src/bootstrap-guards.js';

function envBase(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    ADMIN_API_KEY: 'set',
    DATABASE_URL: 'postgresql://x',
    POSTGRES_PASSWORD: 'real-password',
    CF_ACCESS_ENABLED: 'true',
    CF_ACCESS_AUD: 'aud',
    CF_ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
    CF_ACCESS_ALLOWED_EMAILS: 'a@b.c',
    ...overrides,
  } as NodeJS.ProcessEnv;
}

describe('validateStartupEnv', () => {
  it('passes a fully-valid prod env', () => {
    const r = validateStartupEnv(envBase());
    expect(r.fatal).toEqual([]);
  });

  it('fails when ADMIN_API_KEY is missing in production', () => {
    const r = validateStartupEnv(envBase({ ADMIN_API_KEY: undefined }));
    expect(r.fatal).toContain('ADMIN_API_KEY must be set when NODE_ENV=production');
  });

  it('passes when ADMIN_API_KEY is missing in development', () => {
    const r = validateStartupEnv(envBase({ NODE_ENV: 'development', ADMIN_API_KEY: undefined }));
    expect(r.fatal).not.toContain('ADMIN_API_KEY must be set when NODE_ENV=production');
  });

  it('fails when CF_ACCESS_ENABLED=true but CF_ACCESS_AUD is missing', () => {
    const r = validateStartupEnv(envBase({ CF_ACCESS_AUD: undefined }));
    expect(r.fatal).toContain('CF_ACCESS_AUD must be set when CF_ACCESS_ENABLED=true');
  });

  it('fails when CF_ACCESS_ENABLED=true but CF_ACCESS_TEAM_DOMAIN is missing', () => {
    const r = validateStartupEnv(envBase({ CF_ACCESS_TEAM_DOMAIN: undefined }));
    expect(r.fatal).toContain('CF_ACCESS_TEAM_DOMAIN must be set when CF_ACCESS_ENABLED=true');
  });

  it('passes when CF_ACCESS_ENABLED is false even with CF_ACCESS_AUD missing', () => {
    const r = validateStartupEnv(envBase({ CF_ACCESS_ENABLED: 'false', CF_ACCESS_AUD: undefined }));
    expect(r.fatal.join(';')).not.toMatch(/CF_ACCESS_AUD/);
  });

  it('fails when DATABASE_URL is unset', () => {
    const r = validateStartupEnv(envBase({ DATABASE_URL: undefined }));
    expect(r.fatal).toContain('DATABASE_URL must be set');
  });

  it('fails when POSTGRES_PASSWORD is the placeholder "changeme"', () => {
    const r = validateStartupEnv(envBase({ POSTGRES_PASSWORD: 'changeme' }));
    expect(r.fatal).toContain('POSTGRES_PASSWORD must not be the placeholder "changeme"');
  });

  it('passes when POSTGRES_PASSWORD is unset (dev path with DATABASE_URL inline creds)', () => {
    const r = validateStartupEnv(envBase({ POSTGRES_PASSWORD: undefined }));
    expect(r.fatal.join(';')).not.toMatch(/POSTGRES_PASSWORD/);
  });

  it('emits an info log entry for allow-list count', () => {
    const r = validateStartupEnv(envBase({ CF_ACCESS_ALLOWED_EMAILS: 'a@b.c, b@b.c, c@b.c' }));
    expect(r.info).toContainEqual({ allowListCount: 3 });
  });

  it('emits 0 allow-list count when CF_ACCESS_ALLOWED_EMAILS unset', () => {
    const r = validateStartupEnv(envBase({ CF_ACCESS_ALLOWED_EMAILS: undefined }));
    expect(r.info).toContainEqual({ allowListCount: 0 });
  });

  it('emits 0 allow-list count when CF_ACCESS_ALLOWED_EMAILS is whitespace-only', () => {
    const r = validateStartupEnv(envBase({ CF_ACCESS_ALLOWED_EMAILS: '  , , ,' }));
    expect(r.info).toContainEqual({ allowListCount: 0 });
  });

  it('reports multiple fatals when several env conditions are violated', () => {
    const r = validateStartupEnv(
      envBase({
        DATABASE_URL: undefined,
        POSTGRES_PASSWORD: 'changeme',
        CF_ACCESS_AUD: undefined,
      }),
    );
    expect(r.fatal.length).toBeGreaterThanOrEqual(3);
  });
});
