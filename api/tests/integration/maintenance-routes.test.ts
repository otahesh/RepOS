import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, unlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/client.js';

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let root: string;
let flagPath: string;
let sentinelPath: string;
let backupsDir: string;

function writeSentinel(state: Record<string, unknown>): void {
  writeFileSync(sentinelPath, JSON.stringify(state), 'utf8');
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'repos-maint-routes-'));
  flagPath = join(root, 'maintenance.flag');
  sentinelPath = join(root, 'restore-state.json');
  backupsDir = join(root, 'backups');
  require('node:fs').mkdirSync(backupsDir, { recursive: true });
  process.env.MAINTENANCE_FLAG_PATH = flagPath;
  process.env.RESTORE_STATE_PATH = sentinelPath;
  process.env.BACKUPS_DIR = backupsDir;
  delete process.env.ADMIN_API_KEY;
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
  delete process.env.MAINTENANCE_FLAG_PATH;
  delete process.env.RESTORE_STATE_PATH;
  delete process.env.BACKUPS_DIR;
  await db.query(`DELETE FROM backup_runs`);
  await db.end();
});
beforeEach(async () => {
  if (existsSync(flagPath)) unlinkSync(flagPath);
  if (existsSync(sentinelPath)) unlinkSync(sentinelPath);
  await db.query(`DELETE FROM backup_runs`);
});

describe('maintenance routes', () => {
  it('GET /api/maintenance/status returns {active:false} when no flag', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/maintenance/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ active: false });
  });

  it('GET /api/maintenance/status returns {active:true, restore:{...}} when restore running', async () => {
    writeFileSync(flagPath, 'restore', 'utf8');
    writeSentinel({
      restore_id: 'r-1',
      status: 'running',
      started_at: new Date().toISOString(),
      source_filename: 'repos-x.dump.gz',
      pre_snapshot_filename: 'pre-restore-x.sql.gz',
    });
    const res = await app.inject({ method: 'GET', url: '/api/maintenance/status' });
    expect(res.json()).toMatchObject({ active: true, restore: { status: 'running' } });
  });

  it('GET /api/maintenance/status surfaces the failed restore + recovery affordance', async () => {
    writeFileSync(flagPath, 'restore', 'utf8');
    writeSentinel({
      restore_id: 'r-2',
      status: 'failed',
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      source_filename: 'repos-x.dump.gz',
      pre_snapshot_filename: 'pre-restore-x.sql.gz',
      error_message: 'migration 49 failed',
    });
    // A pre_restore snapshot must exist for recovery_available=true.
    await db.query(
      `INSERT INTO backup_runs (trigger, status, file_path, integrity_verified, started_at, finished_at)
       VALUES ('pre_restore', 'ok', $1, true, now(), now())`,
      [join(backupsDir, 'pre-restore-20260525T120000Z.sql.gz')],
    );
    const res = await app.inject({ method: 'GET', url: '/api/maintenance/status' });
    expect(res.json()).toMatchObject({
      active: true,
      restore: { status: 'failed', error_message: 'migration 49 failed' },
      recovery_available: true,
    });
  });

  it('POST /api/maintenance/clear removes the flag (admin-only) + appends restore_complete row', async () => {
    writeFileSync(flagPath, 'restore', 'utf8');
    writeSentinel({
      restore_id: 'r-3',
      status: 'ok',
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      source_filename: 'repos-x.dump.gz',
      pre_snapshot_filename: 'pre-restore-x.sql.gz',
    });
    const res = await app.inject({ method: 'POST', url: '/api/maintenance/clear' });
    expect(res.statusCode).toBe(204);
    expect(existsSync(flagPath)).toBe(false);
    expect(existsSync(sentinelPath)).toBe(false);
    const { rows } = await db.query(
      `SELECT count(*)::int AS c FROM backup_runs WHERE event_kind='restore_complete'`,
    );
    expect(rows[0].c).toBe(1);
  });

  it('POST /api/maintenance/clear is a no-op when no flag', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/maintenance/clear' });
    expect(res.statusCode).toBe(204);
  });
});

describe('POST /api/backups/:id/restore', () => {
  it('rejects without typed confirmation', async () => {
    const filename = 'repos-20260524T030000Z.dump.gz';
    writeFileSync(join(backupsDir, filename), Buffer.from([0x1f, 0x8b]));
    const res = await app.inject({
      method: 'POST',
      url: `/api/backups/${filename}/restore`,
      headers: { 'content-type': 'application/json' },
      payload: { confirm: 'oops' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('writes the maintenance flag + audit row + returns 202 when body confirms', async () => {
    // Seed an on-disk REAL dump so the runner's integrity check passes.
    const dumpDir = process.env.BACKUPS_DIR!;
    const filename = 'repos-20260524T030000Z.dump.gz';
    const { execSync } = require('node:child_process');
    execSync(
      `pg_dump --format=custom "${process.env.DATABASE_URL}" | gzip -6 > "${join(dumpDir, filename)}"`,
      { stdio: 'pipe', shell: '/bin/bash' },
    );
    await db.query(
      `INSERT INTO backup_runs (trigger, status, file_path, integrity_verified, started_at, finished_at)
       VALUES ('manual', 'ok', $1, true, now(), now())`,
      [join(dumpDir, filename)],
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/backups/${filename}/restore`,
      headers: { 'content-type': 'application/json' },
      payload: { confirm: 'RESTORE' },
    });
    expect(res.statusCode).toBe(202);
    expect(existsSync(flagPath)).toBe(true);
    // The durable sentinel is the source of truth for in-flight state.
    expect(existsSync(sentinelPath)).toBe(true);
    // Best-effort restore_init audit row written.
    const { rows } = await db.query(
      `SELECT trigger, status, event_kind FROM backup_runs WHERE trigger='restore' ORDER BY started_at DESC LIMIT 1`,
    );
    expect(rows[0]).toMatchObject({ trigger: 'restore', status: 'running', event_kind: 'restore_init' });
  });
});
