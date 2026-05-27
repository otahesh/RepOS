import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/client.js';

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let backupsDir: string;

beforeAll(async () => {
  backupsDir = mkdtempSync(join(tmpdir(), 'repos-backups-create-'));
  process.env.BACKUPS_DIR = backupsDir;
  delete process.env.ADMIN_API_KEY;
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
  rmSync(backupsDir, { recursive: true, force: true });
  delete process.env.BACKUPS_DIR;
  await db.end();
});
beforeEach(async () => {
  await db.query(`DELETE FROM backup_runs`);
});

describe('POST /api/backups', () => {
  it('creates a manual snapshot, writes audit row + sidecar JSON, returns 201 with id', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/backups' });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toMatch(/^repos-\d{8}T\d{6}Z\.dump\.gz$/);
    expect(body.verified_restorable).toBe('good');

    // On-disk artifact + sidecar
    const files = readdirSync(backupsDir);
    expect(files).toContain(body.id);
    expect(files).toContain(body.id.replace('.dump.gz', '.json'));

    // Audit row
    const { rows } = await db.query(
      `SELECT trigger, status, integrity_verified FROM backup_runs WHERE file_path LIKE '%' || $1`,
      [body.id],
    );
    expect(rows[0]).toMatchObject({ trigger: 'manual', status: 'ok', integrity_verified: true });
  });
});
