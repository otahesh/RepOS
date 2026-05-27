// api/tests/integration/restore-crash-recovery.test.ts
//
// G5 acceptance #2 — API crash mid-restore.
//
// Setup: simulate "API died during pg_restore" by leaving the maintenance
// flag in place + a restore-state.json sentinel stuck at status='running'
// with started_at >5 min ago.
//
// On the API's next boot (validateMaintenanceFlag runs the C-STALE-LOCK
// detector + buildApp wires the middleware):
//   - the stale sentinel is flipped to status='failed'.
//   - the middleware short-circuits all /api/* to 503 except /api/maintenance/*.
//   - /health stays 200 (s6); /health/user-facing 503s (I-HEALTH-MAINTENANCE).
//   - admin POST /api/maintenance/clear resumes traffic + appends a
//     restore_complete audit row.
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/client.js';
import { validateMaintenanceFlag } from '../../src/bootstrap-runtime.js';

type App = Awaited<ReturnType<typeof buildApp>>;
let flagPath: string;
let sentinelPath: string;

beforeAll(() => {
  flagPath = join(mkdtempSync(join(tmpdir(), 'repos-crash-')), 'maintenance.flag');
  sentinelPath = `${dirname(flagPath)}/restore-state.json`;
  process.env.MAINTENANCE_FLAG_PATH = flagPath;
  process.env.RESTORE_STATE_PATH = sentinelPath;
});
afterAll(async () => {
  if (existsSync(flagPath)) unlinkSync(flagPath);
  if (existsSync(sentinelPath)) unlinkSync(sentinelPath);
  delete process.env.MAINTENANCE_FLAG_PATH;
  delete process.env.RESTORE_STATE_PATH;
  await db.end();
});

describe('G5 case 2 — crash-mid-restore recovery', () => {
  it('on next boot, API serves only /api/maintenance/* and /health, then recovers', async () => {
    // Simulate crash: flag was written, sentinel says status='running' but
    // started_at is >5 min ago (so the C-STALE-LOCK detector flips it failed).
    writeFileSync(flagPath, 'restore-crash', 'utf8');
    writeFileSync(
      sentinelPath,
      JSON.stringify({
        restore_id: 'crashed-1',
        status: 'running',
        started_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        source_filename: 'repos-x.dump.gz',
        pre_snapshot_filename: 'pre-restore-x.sql.gz',
      }),
    );

    // Next boot: run the boot hook (stale detection + reaper) then build app.
    await validateMaintenanceFlag(process.env);
    const app: App = await buildApp();

    const r1 = await app.inject({ method: 'GET', url: '/api/muscles' });
    expect(r1.statusCode).toBe(503);
    expect(r1.headers['retry-after']).toBe('60');

    const r2 = await app.inject({ method: 'GET', url: '/api/maintenance/status' });
    expect(r2.statusCode).not.toBe(503);
    const status = r2.json();
    expect(status.active).toBe(true);
    // C-STALE-LOCK — the boot detector marked the stale sentinel failed.
    expect(status.restore.status).toBe('failed');
    expect(status.restore.error_message).toMatch(/stale/i);

    const r3 = await app.inject({ method: 'GET', url: '/health' });
    expect(r3.statusCode).toBe(200);

    // /health/user-facing 503s (I-HEALTH-MAINTENANCE).
    const rhuf = await app.inject({ method: 'GET', url: '/health/user-facing' });
    expect(rhuf.statusCode).toBe(503);

    // Admin clears the flag (after manually verifying DB state).
    const r4 = await app.inject({ method: 'POST', url: '/api/maintenance/clear' });
    expect(r4.statusCode).toBe(204);

    // Clear appends a restore_complete row to backup_runs.
    const { rows: completeRows } = await db.query(
      `SELECT count(*)::int AS c FROM backup_runs WHERE event_kind='restore_complete'`,
    );
    expect(completeRows[0].c).toBeGreaterThanOrEqual(1);

    // Now /api/* serves traffic again.
    const r5 = await app.inject({ method: 'GET', url: '/api/muscles' });
    expect(r5.statusCode).not.toBe(503);

    await app.close();
    // Clean up the restore_complete audit row so it doesn't leak counts.
    await db.query(`DELETE FROM backup_runs WHERE event_kind='restore_complete'`);
  });
});
