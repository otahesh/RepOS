// api/tests/integration/restore-migration-failure.test.ts
//
// G5 acceptance #4 — migration failure mid-restore rolls back to pre-snapshot,
// plus C-FORWARD-INCOMPAT-CHECK (reject a dump whose schema rev > code rev).
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/client.js';

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let backupsDir: string;
let flagPath: string;
let sentinelPath: string;
let preSnapshotPath: string;

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), 'repos-mig-fail-'));
  backupsDir = join(root, 'backups');
  mkdirSync(backupsDir, { recursive: true });
  flagPath = join(root, 'maintenance.flag');
  sentinelPath = join(root, 'restore-state.json');
  process.env.BACKUPS_DIR = backupsDir;
  process.env.MAINTENANCE_FLAG_PATH = flagPath;
  process.env.RESTORE_STATE_PATH = sentinelPath;
  delete process.env.ADMIN_API_KEY;
  // A REAL pre-restore dump so kickOffRestore's integrity check passes.
  preSnapshotPath = join(backupsDir, 'pre-restore-20260525T120000Z.sql.gz');
  execSync(
    `pg_dump --format=custom "${process.env.DATABASE_URL}" | gzip -6 > "${preSnapshotPath}"`,
    { stdio: 'pipe', shell: '/bin/bash' },
  );
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
  rmSync(backupsDir, { recursive: true, force: true });
  if (existsSync(flagPath)) unlinkSync(flagPath);
  if (existsSync(sentinelPath)) unlinkSync(sentinelPath);
  delete process.env.BACKUPS_DIR;
  delete process.env.MAINTENANCE_FLAG_PATH;
  delete process.env.RESTORE_STATE_PATH;
  await db.query(`DELETE FROM backup_runs`);
  await db.end();
});
beforeEach(async () => {
  if (existsSync(flagPath)) unlinkSync(flagPath);
  if (existsSync(sentinelPath)) unlinkSync(sentinelPath);
  await db.query(`DELETE FROM backup_runs`);
});

describe('G5 case 4 — migration failure rollback to pre-snapshot', () => {
  it('surfaces recovery affordance + kicks off pre-snapshot restore on demand', async () => {
    writeFileSync(flagPath, 'restore-failed', 'utf8');
    // Sentinel reflects the failed restore (C-AUDIT-SENTINEL source of truth).
    writeFileSync(
      sentinelPath,
      JSON.stringify({
        restore_id: 'failed-mig',
        status: 'failed',
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        source_filename: 'source.dump.gz',
        pre_snapshot_filename: basename(preSnapshotPath),
        error_message: 'migrations failed after restore',
      }),
    );
    // The pre_restore snapshot the failed restore captured beforehand.
    await db.query(
      `INSERT INTO backup_runs (trigger, status, file_path, integrity_verified, started_at, finished_at)
       VALUES ('pre_restore', 'ok', $1, true, now() - interval '5 minutes', now() - interval '5 minutes')`,
      [preSnapshotPath],
    );

    // 1. Status surfaces the failure + recovery affordance.
    const status = await app.inject({ method: 'GET', url: '/api/maintenance/status' });
    expect(status.statusCode).toBe(200);
    const body = status.json();
    expect(body).toMatchObject({
      active: true,
      restore: { status: 'failed', error_message: 'migrations failed after restore' },
      recovery_available: true,
    });

    // 2. Recovery kickoff.
    const recover = await app.inject({ method: 'POST', url: '/api/maintenance/restore-pre-snapshot' });
    expect(recover.statusCode).toBe(202);
    expect(recover.json().source).toBe('pre-restore-20260525T120000Z.sql.gz');

    // 3. A new 'restore' audit row appears (kicked-off recovery).
    const { rows } = await db.query(
      `SELECT count(*)::int AS c FROM backup_runs WHERE trigger='restore' AND status='running'`,
    );
    expect(rows[0].c).toBeGreaterThanOrEqual(1);
  });

  it('returns 409 when no pre_restore snapshot exists', async () => {
    await db.query(`DELETE FROM backup_runs WHERE trigger='pre_restore'`);
    const res = await app.inject({ method: 'POST', url: '/api/maintenance/restore-pre-snapshot' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('no_pre_restore_snapshot');
  });

  // C-FORWARD-INCOMPAT-CHECK — reject a restore when the dump schema rev is
  // newer than the running code's highest migration.
  it('rejects restore when dump schema rev > current code rev', async () => {
    const futureDump = join(backupsDir, 'repos-20260601T000000Z.dump.gz');
    // A real, restorable dump (integrity check passes) — the rejection is
    // driven by the schema-rev preflight, not a corrupt file.
    execSync(
      `pg_dump --format=custom "${process.env.DATABASE_URL}" | gzip -6 > "${futureDump}"`,
      { stdio: 'pipe', shell: '/bin/bash' },
    );
    await db.query(
      `INSERT INTO backup_runs (trigger, event_kind, status, file_path, integrity_verified, started_at, finished_at)
       VALUES ('manual', 'create', 'ok', $1, true, now(), now())`,
      [futureDump],
    );
    process.env.REPOS_TEST_FORCE_FUTURE_DUMP_REV = '999';
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/api/backups/${basename(futureDump)}/restore`,
        payload: { confirm: 'RESTORE' },
        headers: { 'content-type': 'application/json' },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe('dump_schema_rev_too_new');
    } finally {
      delete process.env.REPOS_TEST_FORCE_FUTURE_DUMP_REV;
    }
    // The flag must NOT have been written (rejection happens pre-flag).
    expect(existsSync(flagPath)).toBe(false);
  });
});
