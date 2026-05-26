// Per C-CSRF-ORIGIN — guard state-changing routes on the CF Access cookie
// path. Bearer auth path is unaffected (a stolen bearer is its own threat
// model; Origin spoofing isn't the worry there).
//
// Pass conditions (logical OR):
//   1. authMode is NOT cf_access (i.e. bearer auth) — skip
//   2. Origin header matches process.env.PUBLIC_ORIGIN (or configured host)
//   3. X-RepOS-CSRF: 1 custom header is present (cross-origin form can't set
//      without triggering CORS preflight)
//
// Fail closed otherwise → 403.
//
// Mounted as a `preHandler` AFTER the auth middleware (so `authMode` is set).
// The bearer/admin paths set authMode='admin' or leave it undefined (when
// `requireAuth` runs); only `requireCfAccess` (directly or via composers)
// flags authMode='cf_access' as a state-changing request that needs the
// Origin guard.

import type { FastifyRequest, FastifyReply } from 'fastify';

export async function csrfOrigin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authMode = (req as { authMode?: string }).authMode;
  if (authMode !== 'cf_access') return; // bearer / admin path — no Origin guard

  const allowedOrigin = process.env.PUBLIC_ORIGIN;
  if (!allowedOrigin) {
    req.log.error('csrf_origin: PUBLIC_ORIGIN not configured — failing closed');
    return reply.code(403).send({ error: 'csrf_origin_misconfigured' });
  }

  const origin = req.headers.origin;
  const csrfHeader = req.headers['x-repos-csrf'];

  if (origin === allowedOrigin) return;
  if (csrfHeader === '1') return;

  req.log.warn({ origin, hasCsrfHeader: !!csrfHeader }, 'csrf_origin_rejected');
  return reply
    .code(403)
    .send({ error: 'csrf_origin_required', expected_origin: allowedOrigin });
}
