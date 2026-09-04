// api/src/services/backupRunner.ts
//
// W5.4 — node-side shellout to the existing repos-backup.sh. In test we
// run pg_dump directly against process.env.DATABASE_URL so the suite
// doesn't require s6-overlay. In production the path lives at
// /usr/local/bin/repos-backup.sh per the container layout, but the
// manual-snapshot HTTP path runs the same logical pg_dump→gzip pipeline here
// with direct process streams, so the behavior is identical and self-contained.
import { spawn } from 'node:child_process';
import { createWriteStream, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { db } from '../db/client.js';
import { pipeChildProcesses, waitForSuccessfulExit } from '../utils/childProcess.js';

export interface BackupResult {
  id: string;
  file_path: string;
  size_bytes: number;
  trigger: 'manual' | 'auto';
}

function backupsDir(): string {
  return process.env.BACKUPS_DIR ?? '/config/backups';
}

function timestampedFilename(): string {
  // ISO-8601 compact (matches repos-backup.sh format).
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `repos-${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z.dump.gz`
  );
}

export interface ManualBackupCaller {
  adminUserId: string | null; // C-ADMIN-USER-ID — populated from req.userId
  sourceIp: string | null; // C-DOWNLOAD-AUDIT — req.ip / x-forwarded-for
}

export async function runManualBackup(caller: ManualBackupCaller): Promise<BackupResult> {
  const filename = timestampedFilename();
  const filePath = join(backupsDir(), filename);

  const { rows: started } = await db.query(
    `INSERT INTO backup_runs (trigger, event_kind, status, file_path, admin_user_id, source_ip, started_at)
     VALUES ('manual', 'create', 'running', $1, $2, $3, now())
     RETURNING id`,
    [filePath, caller.adminUserId, caller.sourceIp],
  );
  const runId = started[0].id;

  try {
    await dumpToFile(filePath);
    const sizeBytes = statSync(filePath).size;
    await integrityCheck(filePath); // gunzip | pg_restore -l
    writeSidecar(filePath, sizeBytes, 'manual');

    await db.query(
      `UPDATE backup_runs SET status='ok', size_bytes=$1, integrity_verified=true, finished_at=now()
       WHERE id=$2`,
      [sizeBytes, runId],
    );
    return { id: filename, file_path: filePath, size_bytes: sizeBytes, trigger: 'manual' };
  } catch (err) {
    await db.query(
      `UPDATE backup_runs SET status='failed', error_message=$1, finished_at=now() WHERE id=$2`,
      [(err as Error).message, runId],
    );
    throw err;
  }
}

export function dumpToFile(filePath: string): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) return Promise.reject(new Error('DATABASE_URL not set'));

  // Pass the connection URL as one argv entry and implement compression with
  // Node streams. Neither the URL nor the destination is parsed by a shell.
  const pgDump = spawn('pg_dump', ['--format=custom', url], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const dumpDone = waitForSuccessfulExit(pgDump, 'pg_dump');
  const streamDone = pipeline(
    pgDump.stdout,
    createGzip({ level: 6 }),
    createWriteStream(filePath, { mode: 0o640 }),
  );

  return Promise.all([dumpDone, streamDone])
    .then(() => undefined)
    .catch(async (err: unknown) => {
      if (pgDump.exitCode === null && pgDump.signalCode === null) pgDump.kill();
      await Promise.allSettled([dumpDone, streamDone]);
      throw err;
    });
}

export async function integrityCheck(filePath: string): Promise<void> {
  const gunzip = spawn('gunzip', ['-c', '--', filePath], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const pgRestore = spawn('pg_restore', ['-l'], {
    stdio: ['pipe', 'ignore', 'inherit'],
  });
  await pipeChildProcesses(gunzip, 'gunzip', pgRestore, 'pg_restore -l', {
    allowEarlyConsumerExit: true,
  });
}

function writeSidecar(filePath: string, sizeBytes: number, trigger: 'manual' | 'auto'): void {
  const sidecar = filePath.replace(/\.dump\.gz$/, '.json');
  // I-SIDECAR-PERMS — 0640 + metadata-only contract (no PII / user-identifying fields).
  writeFileSync(
    sidecar,
    JSON.stringify({
      file: filePath.split('/').pop(),
      size_bytes: sizeBytes,
      trigger,
      created_at: new Date().toISOString(),
    }),
    { mode: 0o640 },
  );
}
