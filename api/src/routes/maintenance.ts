// api/src/routes/maintenance.ts
//
// W5 — admin escape hatch for the maintenance-mode flow. These routes are
// bypassed by the maintenance middleware (see middleware/maintenance.ts).
//
// All endpoints are admin-key OR CF-Access gated EXCEPT restore-pre-snapshot
// which (per C-RESTORE-AUTH-CFACCESS) requires a fresh CF Access JWT only.
//
// Status reads from /config/restore-state.json (sentinel) per C-AUDIT-SENTINEL:
// the DB backup_runs table is wiped+restored mid-operation, so the in-flight
// state cannot live there. recovery_available reads backup_runs (pre_restore
// rows are written BEFORE pg_restore so they survive the restore window).
import type { FastifyInstance } from 'fastify';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { db } from '../db/client.js';
import { requireAdminKeyOrCfAccess } from '../middleware/cfAccess.js';
import { clientIp } from '../utils/clientIp.js';

function flagPath(): string {
  return process.env.MAINTENANCE_FLAG_PATH ?? '/config/maintenance.flag';
}
function sentinelPath(): string {
  return process.env.RESTORE_STATE_PATH ?? '/config/restore-state.json';
}

interface RestoreSentinel {
  restore_id: string;
  status: 'running' | 'ok' | 'failed';
  started_at: string;
  finished_at?: string;
  source_filename: string;
  pre_snapshot_filename: string;
  error_message?: string;
  admin_user_id?: string | null;
}

function readSentinel(): RestoreSentinel | null {
  const p = sentinelPath();
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

export async function maintenanceRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/maintenance/status',
    { preHandler: requireAdminKeyOrCfAccess() },
    async (_req, reply) => {
      const active = existsSync(flagPath());
      const sentinel = readSentinel();
      const restore = sentinel
        ? {
            status: sentinel.status,
            file_path: sentinel.source_filename,
            error_message: sentinel.error_message ?? null,
            started_at: sentinel.started_at,
            finished_at: sentinel.finished_at ?? null,
          }
        : null;

      // recovery_available = there's a pre_restore snapshot we can roll back to.
      const { rows: preRows } = await db.query(
        `SELECT id, file_path FROM backup_runs
         WHERE trigger='pre_restore' AND event_kind='create' AND status='ok'
         ORDER BY started_at DESC LIMIT 1`,
      );
      const recovery_available = preRows.length > 0;

      return reply.send({ active, restore, recovery_available });
    },
  );

  app.post(
    '/maintenance/clear',
    { preHandler: requireAdminKeyOrCfAccess() },
    async (req, reply) => {
      // Append restore_complete row to backup_runs (C-AUDIT-SENTINEL —
      // this is the post-clear historical audit; populated from the sentinel).
      const sentinel = readSentinel();
      if (sentinel) {
        await db.query(
          `INSERT INTO backup_runs (trigger, event_kind, status, file_path,
                                  error_message, admin_user_id, started_at, finished_at)
         VALUES ('restore', 'restore_complete', $1, $2, $3, $4, $5, now())`,
          [
            sentinel.status === 'ok' ? 'ok' : 'failed',
            sentinel.source_filename,
            sentinel.error_message ?? null,
            req.userId ?? sentinel.admin_user_id ?? null,
            sentinel.started_at,
          ],
        );
        if (existsSync(sentinelPath())) unlinkSync(sentinelPath());
      }
      if (existsSync(flagPath())) unlinkSync(flagPath());
      return reply.code(204).send();
    },
  );

  app.post(
    '/maintenance/restore-pre-snapshot',
    // C-RESTORE-AUTH-CFACCESS — restore endpoints REQUIRE a fresh CF Access
    // JWT (reject X-Admin-Key path). A destructive admin op needs more than
    // the opaque-bearer escape hatch.
    { preHandler: requireAdminKeyOrCfAccess({ requireFreshCfAccess: true }) },
    async (req, reply) => {
      const { rows } = await db.query(
        `SELECT file_path FROM backup_runs
         WHERE trigger='pre_restore' AND event_kind='create' AND status='ok'
         ORDER BY started_at DESC LIMIT 1`,
      );
      if (rows.length === 0) {
        return reply.code(409).send({ error: 'no_pre_restore_snapshot' });
      }
      const sourcePath = rows[0].file_path;
      const { kickOffRestore } = await import('../services/restoreRunner.js');
      const filename = sourcePath.split('/').pop()!;
      const result = await kickOffRestore(filename, {
        adminUserId: req.userId ?? null,
        sourceIp: clientIp(req),
      });
      return reply.code(202).send({ restore_id: result.restore_id, source: filename });
    },
  );
}
