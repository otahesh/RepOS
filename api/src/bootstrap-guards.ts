// Pure env validation for startup. No DB / FS / network calls — those live
// in bootstrap-runtime.ts.
//
// Beta W0.3: extends the original two-guard set (ADMIN_API_KEY in prod,
// CF_ACCESS_AUD+TEAM_DOMAIN when CF_ACCESS_ENABLED=true) with three more
// (DATABASE_URL set, POSTGRES_PASSWORD not "changeme") plus one info log
// (CF_ACCESS_ALLOWED_EMAILS count at boot).

export interface StartupGuardResult {
  fatal: string[];
  info: Array<Record<string, unknown>>;
}

export function validateStartupEnv(env: NodeJS.ProcessEnv): StartupGuardResult {
  const fatal: string[] = [];
  const info: Array<Record<string, unknown>> = [];

  if (env.NODE_ENV === 'production' && !env.ADMIN_API_KEY) {
    fatal.push('ADMIN_API_KEY must be set when NODE_ENV=production');
  }

  if (env.CF_ACCESS_ENABLED === 'true') {
    for (const key of ['CF_ACCESS_AUD', 'CF_ACCESS_TEAM_DOMAIN'] as const) {
      if (!env[key]) fatal.push(`${key} must be set when CF_ACCESS_ENABLED=true`);
    }
  }

  if (!env.DATABASE_URL) {
    fatal.push('DATABASE_URL must be set');
  }

  // POSTGRES_PASSWORD is optional (dev can put creds inline in DATABASE_URL),
  // but if set, must not be the Unraid template default.
  if (env.POSTGRES_PASSWORD === 'changeme') {
    fatal.push('POSTGRES_PASSWORD must not be the placeholder "changeme"');
  }

  const allowList = (env.CF_ACCESS_ALLOWED_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  info.push({ allowListCount: allowList.length });

  return { fatal, info };
}
