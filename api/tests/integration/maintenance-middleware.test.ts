import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { writeFileSync, unlinkSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/client.js';

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let flagDir: string;
let flagPath: string;

beforeAll(async () => {
  flagDir = mkdtempSync(join(tmpdir(), 'repos-maint-'));
  flagPath = join(flagDir, 'maintenance.flag');
  process.env.MAINTENANCE_FLAG_PATH = flagPath;
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  rmSync(flagDir, { recursive: true, force: true });
  delete process.env.MAINTENANCE_FLAG_PATH;
  await db.end();
});

beforeEach(() => {
  if (existsSync(flagPath)) unlinkSync(flagPath);
});

describe('maintenance middleware', () => {
  it('passes /api/* through when no flag', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/muscles' });
    // 200 if DB seeded, 401 if no auth — either way NOT 503.
    expect(res.statusCode).not.toBe(503);
  });

  it('returns 503 + Retry-After on /api/* when flag present', async () => {
    writeFileSync(flagPath, 'restore in progress', 'utf8');
    const res = await app.inject({ method: 'GET', url: '/api/muscles' });
    expect(res.statusCode).toBe(503);
    expect(res.headers['retry-after']).toBe('60');
    expect(res.json()).toMatchObject({ error: 'maintenance' });
  });

  it('passes /api/maintenance/* through even when flag present', async () => {
    writeFileSync(flagPath, 'restore in progress', 'utf8');
    const res = await app.inject({ method: 'GET', url: '/api/maintenance/status' });
    // 401 (CF Access required) or 200 — NEVER 503.
    expect(res.statusCode).not.toBe(503);
  });

  it('passes /health through even when flag present', async () => {
    // /health is the s6 healthcheck — if maintenance 503s it, s6 will
    // restart the container in a loop. Must stay green.
    writeFileSync(flagPath, 'restore in progress', 'utf8');
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });

  it('does not cache flag state — picks up changes mid-process', async () => {
    const r1 = await app.inject({ method: 'GET', url: '/api/muscles' });
    expect(r1.statusCode).not.toBe(503);
    writeFileSync(flagPath, 'now', 'utf8');
    const r2 = await app.inject({ method: 'GET', url: '/api/muscles' });
    expect(r2.statusCode).toBe(503);
    unlinkSync(flagPath);
    const r3 = await app.inject({ method: 'GET', url: '/api/muscles' });
    expect(r3.statusCode).not.toBe(503);
  });

  it('/health/user-facing 503s when flag present, 200 when absent', async () => {
    // I-HEALTH-MAINTENANCE — external uptime monitors point here so they
    // alert during a restore window. The s6 healthcheck stays on /health.
    const ok = await app.inject({ method: 'GET', url: '/health/user-facing' });
    expect(ok.statusCode).toBe(200);
    writeFileSync(flagPath, 'restore', 'utf8');
    const down = await app.inject({ method: 'GET', url: '/health/user-facing' });
    expect(down.statusCode).toBe(503);
    expect(down.headers['retry-after']).toBe('60');
  });

  it('reaps stale running backup_runs rows at boot', async () => {
    await db.query(
      `INSERT INTO backup_runs (trigger, status, started_at)
       VALUES ('manual', 'running', now() - interval '20 minutes')`,
    );
    // Re-import bootstrap-runtime to fire the reaper.
    const { validateMaintenanceFlag } = await import('../../src/bootstrap-runtime.js');
    await validateMaintenanceFlag(process.env);
    const { rows } = await db.query(
      `SELECT status, error_message FROM backup_runs WHERE error_message LIKE 'reaped:%'`,
    );
    expect(rows[0]).toMatchObject({ status: 'failed' });
    // Clean up so this row doesn't leak into other suites' counts.
    await db.query(`DELETE FROM backup_runs WHERE error_message LIKE 'reaped:%'`);
  });
});
