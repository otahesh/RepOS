import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Scope } from '../auth/scopes.js';

/**
 * Bearer-token scope guard. Use as a preHandler AFTER requireBearerOrCfAccess
 * (or requireAuth directly). The composer sets `req.tokenScopes` only on the
 * bearer path; the CF Access path leaves it undefined.
 *
 * - CF Access JWT path: tokenScopes is undefined. Whole-host CF Access auth
 *   already enforces identity at the edge — pass through without a scope
 *   check. This is the same contract the existing routes had before W1.4.0.
 * - Bearer path: tokenScopes is set (possibly empty array). Reject with 403
 *   unless it includes the required scope.
 *
 * Typing the scope parameter as the `Scope` union from auth/scopes.ts keeps
 * route declarations honest — you cannot accidentally require a scope that
 * isn't in VALID_SCOPES.
 */
export function requireScope(scope: Scope) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const granted = (req as any).tokenScopes as string[] | undefined;
    if (granted === undefined) return;             // CF Access path
    if (granted.includes(scope)) return;           // bearer has the scope
    return reply.code(403).send({ error: `scope_required:${scope}` });
  };
}
