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
import { dumpSchemaRev, currentCodeRev, assertSchemaRevCompatible } from '../../src/services/restoreRunner.js';

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

  // C-FORWARD-INCOMPAT-CHECK — reject a restore when the dump's recorded schema
  // rev is newer than the running code's highest migration. Exercises the REAL
  // extraction (dumpSchemaRev reads the dump's _migrations rows) — no test-only
  // rev override.
  it('rejects restore when the dump _migrations rev > current code rev', async () => {
    const futureDump = join(backupsDir, 'repos-20260601T000000Z.dump.gz');
    // Stamp a future migration into _migrations so the dump records rev 999,
    // then remove it so the live DB stays clean. The dump file retains 999.
    await db.query(`INSERT INTO _migrations (filename) VALUES ('999_future_test_only.sql')`);
    try {
      execSync(
        `pg_dump --format=custom "${process.env.DATABASE_URL}" | gzip -6 > "${futureDump}"`,
        { stdio: 'pipe', shell: '/bin/bash' },
      );
    } finally {
      await db.query(`DELETE FROM _migrations WHERE filename = '999_future_test_only.sql'`);
    }
    await db.query(
      `INSERT INTO backup_runs (trigger, event_kind, status, file_path, integrity_verified, started_at, finished_at)
       VALUES ('manual', 'create', 'ok', $1, true, now(), now())`,
      [futureDump],
    );
    const res = await app.inject({
      method: 'POST',
      url: `/api/backups/${basename(futureDump)}/restore`,
      payload: { confirm: 'RESTORE' },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('dump_schema_rev_too_new');
    // The flag must NOT have been written (rejection happens pre-flag).
    expect(existsSync(flagPath)).toBe(false);
  });

  // Proves the extraction is real (not null-on-everything): a current dump
  // resolves to the live code rev, so assertSchemaRevCompatible does NOT throw.
  it('dumpSchemaRev extracts the real max rev from a current dump', async () => {
    const okDump = join(backupsDir, 'repos-20260527T000000Z.dump.gz');
    execSync(
      `pg_dump --format=custom "${process.env.DATABASE_URL}" | gzip -6 > "${okDump}"`,
      { stdio: 'pipe', shell: '/bin/bash' },
    );
    const rev = dumpSchemaRev(okDump);
    expect(rev).toBe(currentCodeRev());
    expect(rev).toBeGreaterThan(0);
    expect(() => assertSchemaRevCompatible(okDump)).not.toThrow();
  });
});
