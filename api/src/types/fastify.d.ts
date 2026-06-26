import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by requireAuth (bearer path) and requireCfAccess (CF Access path). */
    userId?: string;
    /**
     * Set by requireAuth only — the granted scopes on the device_tokens row.
     * Undefined on the CF Access path (no bearer present); requireScope
     * treats that as a pass-through because whole-host CF Access auth
     * already covers identity at the edge.
     */
    tokenScopes?: string[];
    /** Set by requireCfAccess — the JWT email claim (lower-cased). */
    userEmail?: string;
    /** Set by requireCfAccess — the JWT name claim, may be null. */
    userDisplayName?: string | null;
    /** Set by requireCfAccess — the user's IANA timezone from the users row. */
    userTimezone?: string;
    /** Set by the admin gate — which auth path the request took. */
    authMode?: 'admin' | 'cf_access' | 'cf_access_fresh';
  }
}

export {};
