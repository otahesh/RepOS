// api/src/routes/backups.ts
//
// Beta W5 — backup CRUD. /api/backups list joins on-disk filenames with
// backup_runs audit rows to render the verified-restorable badge per
// Design spec ABS-2.
//
// Auth: requireAdminKeyOrCfAccess (matches tokens.ts pattern). The CLI
// path uses X-Admin-Key; the browser path uses CF Access JWT.
//
// File-id contract: the filename IS the API id. Filenames are sortable
// (ISO timestamp) + unique by-design via the timestamp; no separate UUID.
import type { FastifyInstance } from 'fastify';
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, createReadStream } from 'node:fs';
import { join } from 'node:path';
import { db } from '../db/client.js';
import { requireAdminKeyOrCfAccess } from '../middleware/cfAccess.js';
import {
  BackupListResponseSchema,
  RestoreRequestSchema,
  type BackupItem,
  type VerifiedRestorable,
} from '../schemas/backups.js';
import { runManualBackup } from '../services/backupRunner.js';
import { kickOffRestore, DumpSchemaRevTooNewError } from '../services/restoreRunner.js';

function backupsDir(): string {
  return process.env.BACKUPS_DIR ?? '/config/backups';
}

function badgeFor(fileExists: boolean, integrityVerified: boolean): VerifiedRestorable {
  if (!fileExists) return 'warn';
  if (!integrityVerified) return 'danger';
  return 'good';
}

// Filename whitelist: must match the timestamped pattern OR pre-restore-*.
// Returns null for anything else (path-traversal defence — the id can never
// contain a slash or `..` and still pass).
export function safeBackupPath(id: string): string | null {
  if (!/^(repos-\d{8}T\d{6}Z\.dump\.gz|pre-restore-\d{8}T\d{6}Z\.sql\.gz)$/.test(id)) {
    return null;
  }
  return join(backupsDir(), id);
}

// Derive caller context for audit rows (C-ADMIN-USER-ID + C-DOWNLOAD-AUDIT).
function callerContext(req: any): { adminUserId: string | null; sourceIp: string | null } {
  return {
    adminUserId: req.userId ?? null,
    sourceIp:
      (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
      req.ip ??
      null,
  };
}

function readSidecar(
  dir: string,
  dumpFilename: string,
): { created_at?: string; trigger?: string } | null {
  const sidecar = join(dir, dumpFilename.replace(/\.dump\.gz$|\.sql\.gz$/, '.json'));
  if (!existsSync(sidecar)) return null;
  try {
    return JSON.parse(readFileSync(sidecar, 'utf8'));
  } catch {
    return null;
  }
}

export async function backupRoutes(app: FastifyInstance): Promise<void> {
  app.get('/backups', { preHandler: requireAdminKeyOrCfAccess() }, async (_req, reply) => {
    const dir = backupsDir();
    const onDisk = existsSync(dir)
      ? readdirSync(dir).filter((f) => f.endsWith('.dump.gz') || f.endsWith('.sql.gz'))
      : [];

    // Pull CREATE rows only (latest first) — per C-DOWNLOAD-AUDIT the table
    // also stores download/delete event rows. The snapshot listing shows the
    // snapshot's creation; download/delete are pure audit, not list entries.
    const { rows } = await db.query(
      `SELECT trigger, status, file_path, size_bytes, integrity_verified, started_at
         FROM backup_runs
        WHERE status = 'ok'
          AND event_kind = 'create'
          AND trigger IN ('manual', 'auto', 'pre_restore')
        ORDER BY started_at DESC`,
    );

    const items: BackupItem[] = rows.map((r: any) => {
      const filename = r.file_path ? r.file_path.split('/').pop()! : '(unknown)';
      const fileExists = onDisk.includes(filename);
      const sidecar = readSidecar(dir, filename);
      return {
        id: filename,
        trigger: r.trigger,
        size_bytes: Number(r.size_bytes ?? 0),
        verified_restorable: badgeFor(fileExists, r.integrity_verified),
        created_at: sidecar?.created_at ?? new Date(r.started_at).toISOString(),
      };
    });

    const body = BackupListResponseSchema.parse({ items });
    return reply.send(body);
  });

  app.post('/backups', { preHandler: requireAdminKeyOrCfAccess() }, async (req, reply) => {
    const result = await runManualBackup({
      adminUserId: (req as any).userId ?? null, // C-ADMIN-USER-ID
      sourceIp:
        (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
        req.ip ??
        null,
    });
    return reply.code(201).send({
      id: result.id,
      trigger: 'manual',
      size_bytes: result.size_bytes,
      verified_restorable: 'good',
      created_at: new Date().toISOString(),
    });
  });

  app.delete<{ Params: { id: string } }>(
    '/backups/:id',
    { preHandler: requireAdminKeyOrCfAccess() },
    async (req, reply) => {
      const { id } = req.params;
      const filePath = safeBackupPath(id);
      if (!filePath) return reply.code(400).send({ error: 'invalid_backup_id' });
      const sizeBytes = existsSync(filePath) ? statSync(filePath).size : 0;
      if (existsSync(filePath)) unlinkSync(filePath);
      const sidecar = filePath.replace(/\.(dump|sql)\.gz$/, '.json');
      if (existsSync(sidecar)) unlinkSync(sidecar);
      // I-DELETE-BACKUP-AUDIT — append a row recording who deleted what.
      const { adminUserId, sourceIp } = callerContext(req);
      await db.query(
        `INSERT INTO backup_runs (trigger, event_kind, status, file_path, size_bytes,
                                  admin_user_id, source_ip, started_at, finished_at)
         VALUES ('manual', 'delete', 'ok', $1, $2, $3, $4, now(), now())`,
        [filePath, sizeBytes, adminUserId, sourceIp],
      );
      return reply.code(204).send();
    },
  );

  app.get<{ Params: { id: string } }>(
    '/backups/:id/download',
    { preHandler: requireAdminKeyOrCfAccess() },
    async (req, reply) => {
      const { id } = req.params;
      const filePath = safeBackupPath(id);
      if (!filePath || !existsSync(filePath)) return reply.code(404).send({ error: 'not_found' });
      const sizeBytes = statSync(filePath).size;
      // C-DOWNLOAD-AUDIT — D9 — every download writes a new backup_runs row.
      const { adminUserId, sourceIp } = callerContext(req);
      await db.query(
        `INSERT INTO backup_runs (trigger, event_kind, status, file_path, size_bytes,
                                  admin_user_id, source_ip, started_at, finished_at)
         VALUES ('manual', 'download', 'ok', $1, $2, $3, $4, now(), now())`,
        [filePath, sizeBytes, adminUserId, sourceIp],
      );
      reply
        .header('Content-Type', 'application/gzip')
        .header('Content-Length', String(sizeBytes)) // I-CONTENT-LENGTH — browser shows progress
        .header('Content-Disposition', `attachment; filename="${id}"`);
      return reply.send(createReadStream(filePath));
    },
  );

  app.post<{ Params: { id: string } }>(
    '/backups/:id/restore',
    // C-RESTORE-AUTH-CFACCESS — destructive admin op REQUIRES a fresh CF Access
    // JWT, rejects the X-Admin-Key path. The bearer escape hatch is not enough.
    { preHandler: requireAdminKeyOrCfAccess({ requireFreshCfAccess: true }) },
    async (req, reply) => {
      const parsedBody = RestoreRequestSchema.safeParse(req.body);
      if (!parsedBody.success) {
        return reply
          .code(400)
          .send({ error: 'invalid_confirm', message: 'body must be {confirm:"RESTORE"}' });
      }
      const { id } = req.params;
      const filePath = safeBackupPath(id);
      if (!filePath || !existsSync(filePath)) {
        return reply.code(404).send({ error: 'not_found' });
      }
      try {
        const result = await kickOffRestore(id, callerContext(req));
        return reply.code(202).send({ restore_id: result.restore_id, source: id });
      } catch (err) {
        if (err instanceof DumpSchemaRevTooNewError) {
          // C-FORWARD-INCOMPAT-CHECK — dump is from a newer RepOS than the
          // running code; reject before any destructive op.
          return reply.code(409).send({ error: 'dump_schema_rev_too_new', message: err.message });
        }
        throw err;
      }
    },
  );
}
