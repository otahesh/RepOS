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
  }
}

export {};
