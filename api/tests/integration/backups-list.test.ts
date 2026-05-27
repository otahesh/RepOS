import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/client.js';

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let backupsDir: string;

beforeAll(async () => {
  backupsDir = mkdtempSync(join(tmpdir(), 'repos-backups-'));
  process.env.BACKUPS_DIR = backupsDir;
  delete process.env.ADMIN_API_KEY; // open admin path for the test
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

describe('GET /api/backups', () => {
  it('returns empty array when no snapshots', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/backups' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [] });
  });

  // Note: backup_runs.event_kind defaults to 'create' — these seed rows
  // rely on the default so they remain readable. Download/delete rows
  // (event_kind != 'create') are filtered out of the list query.
  it('joins on-disk file + backup_runs row + sidecar JSON', async () => {
    const file = join(backupsDir, 'repos-20260525T030000Z.dump.gz');
    const sidecar = join(backupsDir, 'repos-20260525T030000Z.json');
    writeFileSync(file, Buffer.from([0x1f, 0x8b])); // gzip magic only — not parsed here
    writeFileSync(
      sidecar,
      JSON.stringify({
        file: 'repos-20260525T030000Z.dump.gz',
        size_bytes: 2,
        trigger: 'auto',
        created_at: '2026-05-25T03:00:00Z',
      }),
    );
    await db.query(
      `INSERT INTO backup_runs (trigger, status, file_path, size_bytes, integrity_verified, started_at, finished_at)
       VALUES ('auto', 'ok', $1, 2, true, '2026-05-25T03:00:00Z', '2026-05-25T03:00:05Z')`,
      [file],
    );

    const res = await app.inject({ method: 'GET', url: '/api/backups' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      id: 'repos-20260525T030000Z.dump.gz',
      trigger: 'auto',
      size_bytes: 2,
      verified_restorable: 'good', // integrity_verified=true && file exists
      created_at: '2026-05-25T03:00:00Z',
    });
  });

  it('marks badge danger when file present but integrity_verified=false', async () => {
    const file = join(backupsDir, 'repos-20260520T030000Z.dump.gz');
    writeFileSync(file, Buffer.from([0x00])); // not gzip
    await db.query(
      `INSERT INTO backup_runs (trigger, status, file_path, size_bytes, integrity_verified, started_at, finished_at)
       VALUES ('manual', 'ok', $1, 1, false, now(), now())`,
      [file],
    );
    const res = await app.inject({ method: 'GET', url: '/api/backups' });
    expect(res.json().items[0].verified_restorable).toBe('danger');
  });

  it('marks badge warn when audit row exists but file is missing on disk', async () => {
    await db.query(
      `INSERT INTO backup_runs (trigger, status, file_path, size_bytes, integrity_verified, started_at, finished_at)
       VALUES ('manual', 'ok', $1, 100, true, now(), now())`,
      [join(backupsDir, 'gone.dump.gz')],
    );
    const res = await app.inject({ method: 'GET', url: '/api/backups' });
    expect(res.json().items[0].verified_restorable).toBe('warn');
  });
});
