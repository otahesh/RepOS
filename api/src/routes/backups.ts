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
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../db/client.js';
import { requireAdminKeyOrCfAccess } from '../middleware/cfAccess.js';
import {
  BackupListResponseSchema,
  type BackupItem,
  type VerifiedRestorable,
} from '../schemas/backups.js';

function backupsDir(): string {
  return process.env.BACKUPS_DIR ?? '/config/backups';
}

function badgeFor(fileExists: boolean, integrityVerified: boolean): VerifiedRestorable {
  if (!fileExists) return 'warn';
  if (!integrityVerified) return 'danger';
  return 'good';
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
}
