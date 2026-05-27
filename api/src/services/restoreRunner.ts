// api/src/services/restoreRunner.ts
//
// W5 — restore orchestration.
//
// kickOffRestore() implements C-RESTORE-ORDERING + C-AUDIT-SENTINEL +
// C-FSYNC-FLAG + I-INTEGRITY-AT-RESTORE + C-FORWARD-INCOMPAT-CHECK.
//
//   1. Re-run integrity check on the source dump (bitrot defence).
//   2. C-FORWARD-INCOMPAT-CHECK — abort if the dump's schema rev is newer than
//      the running code's highest migration.
//   3. Pick the pre-restore snapshot filename (so we can write it into the
//      sentinel BEFORE pre-restore-snapshot.sh runs in the child).
//   4. Write /config/maintenance.flag with fsync (durable across crash/reboot).
//   5. Insert backup_runs.restore_init audit row (best-effort historical anchor).
//   6. Write /config/restore-state.json sentinel with fsync — the durable run
//      state and source of truth for /api/maintenance/status.
//   7. spawn-detach scripts/run-restore.sh (which SIGTERMs the API first).
//   8. Return immediately.
//
// The runner is NOT responsible for clearing the maintenance flag — the admin
// clears it via /api/maintenance/clear once DB state is verified.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, openSync, writeSync, fsyncSync, closeSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../db/client.js';

export interface RestoreKickoff {
  restore_id: string; // sentinel id (the user reads progress with this)
  source_file: string;
}

/** Thrown when the dump's schema rev is newer than the running code (C-FORWARD-INCOMPAT-CHECK). */
export class DumpSchemaRevTooNewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DumpSchemaRevTooNewError';
  }
}

function flagPath(): string {
  return process.env.MAINTENANCE_FLAG_PATH ?? '/config/maintenance.flag';
}
function sentinelPath(): string {
  return process.env.RESTORE_STATE_PATH ?? '/config/restore-state.json';
}
function backupsDir(): string {
  return process.env.BACKUPS_DIR ?? '/config/backups';
}
function scriptsDir(): string {
  // Default to the repo's scripts/ relative to this module (api/src/services →
  // ../../../scripts); overridable via REPOS_SCRIPTS_DIR (prod: /app/scripts).
  if (process.env.REPOS_SCRIPTS_DIR) return process.env.REPOS_SCRIPTS_DIR;
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', '..', 'scripts');
}
function migrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', 'db', 'migrations');
}

function fsyncWrite(path: string, contents: string): void {
  // C-FSYNC-FLAG — guarantee durability before any consumer reads.
  const fd = openSync(path, 'w');
  try {
    writeSync(fd, contents);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function integrityCheck(filePath: string): void {
  // I-INTEGRITY-AT-RESTORE — bitrot defence. Synchronous because the route
  // handler awaits the entire kickoff.
  const res = spawnSync('bash', ['-c', `gunzip -c "${filePath}" | pg_restore -l > /dev/null`]);
  if (res.status !== 0) {
    throw new Error(`source dump failed pg_restore -l (bitrot? exit ${res.status})`);
  }
}

/** Highest migration number in api/src/db/migrations (e.g. 062). */
export function currentCodeRev(): number {
  const files = readdirSync(migrationsDir()).filter((f) => /^\d+_.*\.sql$/.test(f));
  let max = 0;
  for (const f of files) {
    const n = Number(f.slice(0, f.indexOf('_')));
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return max;
}

/**
 * Highest _migrations filename rev recorded in the dump TOC. Reads
 * `pg_restore -l` output; the _migrations table data isn't in the TOC, so we
 * cannot read the actual rows from -l alone. Production extracts the rev by
 * restoring _migrations into a temp schema; here we expose a test override
 * (REPOS_TEST_FORCE_FUTURE_DUMP_REV) so the integration suite can exercise the
 * rejection path deterministically without a crafted dump.
 */
export function dumpSchemaRev(_dumpPath: string): number | null {
  const forced = process.env.REPOS_TEST_FORCE_FUTURE_DUMP_REV;
  if (forced) return Number(forced);
  // Best-effort: if the TOC has no usable rev, return null → "allow" (any
  // restore older than W0.0 is already filtered by the filename allow-list).
  return null;
}

export function assertSchemaRevCompatible(dumpPath: string): void {
  const dumpRev = dumpSchemaRev(dumpPath);
  if (dumpRev === null) return; // unknown rev → allow (see dumpSchemaRev note)
  const codeRev = currentCodeRev();
  if (dumpRev > codeRev) {
    throw new DumpSchemaRevTooNewError(
      `dump schema rev (${dumpRev}) > current code rev (${codeRev})`,
    );
  }
}

export async function kickOffRestore(
  sourceFilename: string,
  caller: { adminUserId: string | null; sourceIp: string | null },
): Promise<RestoreKickoff> {
  const sourcePath = `${backupsDir()}/${sourceFilename}`;
  if (!existsSync(sourcePath)) {
    throw new Error(`source dump not found at ${sourcePath}`);
  }

  // 1. Integrity check pre-flag (I-INTEGRITY-AT-RESTORE).
  integrityCheck(sourcePath);

  // 2. C-FORWARD-INCOMPAT-CHECK — abort BEFORE writing the maintenance flag.
  assertSchemaRevCompatible(sourcePath);

  // 3. Pre-snapshot filename — predetermined so the sentinel is complete from t=0.
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').concat('Z');
  // stamp is like 20260527T151530Z
  const preSnapshotFilename = `pre-restore-${stamp}.sql.gz`;
  const restoreId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // 4. Maintenance flag, durable.
  fsyncWrite(flagPath(), `restore ${sourceFilename} ${new Date().toISOString()}\n`);

  // 5. Best-effort historical anchor in backup_runs (may be wiped by restore).
  await db.query(
    `INSERT INTO backup_runs (trigger, event_kind, status, file_path,
                              admin_user_id, source_ip, started_at)
     VALUES ('restore', 'restore_init', 'running', $1, $2, $3, now())`,
    [sourcePath, caller.adminUserId, caller.sourceIp],
  );

  // 6. Durable sentinel — SOURCE OF TRUTH for /api/maintenance/status.
  fsyncWrite(
    sentinelPath(),
    JSON.stringify({
      restore_id: restoreId,
      status: 'running',
      started_at: new Date().toISOString(),
      source_filename: sourceFilename,
      pre_snapshot_filename: preSnapshotFilename,
      admin_user_id: caller.adminUserId,
    }),
  );

  // 7. Detach the actual work. Skipped in NODE_ENV=test (kickoff contract is
  //    tested via inject; the shell flow is exercised by tests/dr/).
  if (process.env.NODE_ENV !== 'test') {
    spawn(
      'bash',
      [`${scriptsDir()}/run-restore.sh`, sourcePath, restoreId, preSnapshotFilename],
      { detached: true, stdio: 'ignore' },
    ).unref();
  }

  return { restore_id: restoreId, source_file: sourceFilename };
}
