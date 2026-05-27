// Beta W5.2 — sentinel-file gated maintenance mode.
//
// Per Infra recommendation in master plan Appendix A: persistence is a
// file at /config/maintenance.flag, NOT a DB row. The DB may be mid-
// restore when the flag is checked; a row-based flag would be unreadable.
//
// Wired as a Fastify onRequest hook BEFORE any route plugin registers.
// Checks existence on every request — existsSync() on a hot inode is
// sub-microsecond. No cache: caching would defeat "API boots into
// maintenance mode when flag was written by the restore runner."
//
// Per I-FLAGPATH-CACHE: flagPath() resolution itself is read on every
// request from env so tests can swap MAINTENANCE_FLAG_PATH per-suite (the
// env is process-local and constant within a single boot); the existsSync()
// on the resolved path runs on every request.
//
// Bypass list (these routes work even with the flag set):
//   - /api/maintenance/*    — admin escape hatch (status + clear + restore-pre-snapshot)
//   - /health               — s6 healthcheck (would cause restart loop if 503d)
//
// Per I-HEALTH-MAINTENANCE: /health/user-facing is a SEPARATE endpoint
// that DOES return 503 during restore. External uptime monitors point at
// /health/user-facing so they alert during a restore window; the s6
// healthcheck stays on /health and is silent.
import { existsSync } from 'node:fs';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

const DEFAULT_MAINTENANCE_FLAG_PATH = '/config/maintenance.flag';

function flagPath(): string {
  return process.env.MAINTENANCE_FLAG_PATH ?? DEFAULT_MAINTENANCE_FLAG_PATH;
}

export function isMaintenanceModeActive(): boolean {
  return existsSync(flagPath());
}

function isBypassed(url: string): boolean {
  // Strip the query string so e.g. /health?probe=1 still bypasses.
  const path = url.split('?')[0];
  // Exact match for /health; prefix match for /api/maintenance.
  // /health/user-facing is NOT bypassed (per I-HEALTH-MAINTENANCE).
  if (path === '/health') return true;
  if (path.startsWith('/api/maintenance/') || path === '/api/maintenance') return true;
  return false;
}

export async function registerMaintenanceGate(app: FastifyInstance): Promise<void> {
  // I-HEALTH-MAINTENANCE — user-facing health endpoint that 503s during
  // restore so external uptime monitors don't go silent.
  app.get('/health/user-facing', async (_req, reply) => {
    if (isMaintenanceModeActive()) {
      reply.header('Retry-After', '60');
      return reply.code(503).send({ status: 'maintenance' });
    }
    return reply.send({ status: 'ok' });
  });

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!isMaintenanceModeActive()) return;
    if (isBypassed(req.url)) return;
    reply.header('Retry-After', '60');
    return reply.code(503).send({
      error: 'maintenance',
      retry_after_s: 60,
      message: 'RepOS is down for a database restore. ~60 seconds.',
    });
  });
}
