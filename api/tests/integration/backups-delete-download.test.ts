import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/client.js';

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let backupsDir: string;

beforeAll(async () => {
  backupsDir = mkdtempSync(join(tmpdir(), 'repos-backups-del-'));
  process.env.BACKUPS_DIR = backupsDir;
  delete process.env.ADMIN_API_KEY;
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
  rmSync(backupsDir, { recursive: true, force: true });
  delete process.env.BACKUPS_DIR;
  await db.query(`DELETE FROM backup_runs`);
  await db.end();
});

// backup_runs is a global (non-user-scoped) table — clean it between tests so
// download/delete audit-row counts don't pick up rows from sibling suites.
beforeEach(async () => {
  await db.query(`DELETE FROM backup_runs`);
});

describe('DELETE /api/backups/:id', () => {
  it('removes file + sidecar + leaves audit row in place (audit is immutable)', async () => {
    const filename = 'repos-20260524T030000Z.dump.gz';
    const file = join(backupsDir, filename);
    const sidecar = file.replace('.dump.gz', '.json');
    writeFileSync(file, Buffer.from([0x1f, 0x8b]));
    writeFileSync(sidecar, '{}');
    await db.query(
      `INSERT INTO backup_runs (trigger, status, file_path, integrity_verified, started_at, finished_at)
       VALUES ('manual', 'ok', $1, true, now(), now())`,
      [file],
    );

    const res = await app.inject({ method: 'DELETE', url: `/api/backups/${filename}` });
    expect(res.statusCode).toBe(204);
    expect(existsSync(file)).toBe(false);
    expect(existsSync(sidecar)).toBe(false);

    // The original 'create' audit row is immutable — it survives the delete
    // (the list endpoint then badges it 'warn' since the file is gone). A new
    // 'delete' audit row is appended separately (asserted below).
    const { rows } = await db.query(
      `SELECT count(*)::int AS c FROM backup_runs WHERE file_path=$1 AND event_kind='create'`,
      [file],
    );
    expect(rows[0].c).toBe(1);
  });

  it('rejects path traversal — only filenames within backupsDir', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/backups/..%2Fetc%2Fpasswd' });
    expect([400, 404]).toContain(res.statusCode);
  });

  it('writes a delete audit row when DELETE fires', async () => {
    const filename = 'repos-20260522T030000Z.dump.gz';
    writeFileSync(join(backupsDir, filename), Buffer.from([0x1f, 0x8b]));
    const before = (
      await db.query(`SELECT count(*)::int AS c FROM backup_runs WHERE event_kind='delete'`)
    ).rows[0].c;
    await app.inject({ method: 'DELETE', url: `/api/backups/${filename}` });
    const after = (
      await db.query(`SELECT count(*)::int AS c FROM backup_runs WHERE event_kind='delete'`)
    ).rows[0].c;
    expect(after).toBe(before + 1);
  });
});

describe('GET /api/backups/:id/download', () => {
  it('streams the file bytes with application/gzip + Content-Disposition', async () => {
    const filename = 'repos-20260523T030000Z.dump.gz';
    const file = join(backupsDir, filename);
    writeFileSync(file, Buffer.from([0x1f, 0x8b, 0x08]));
    const res = await app.inject({ method: 'GET', url: `/api/backups/${filename}/download` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/gzip/);
    expect(res.headers['content-disposition']).toContain(filename);
  });

  it('writes a download audit row + sets Content-Length per request', async () => {
    const filename = 'repos-20260521T030000Z.dump.gz';
    const file = join(backupsDir, filename);
    writeFileSync(file, Buffer.from([0x1f, 0x8b, 0x08, 0x09, 0x0a]));
    const before = (
      await db.query(`SELECT count(*)::int AS c FROM backup_runs WHERE event_kind='download'`)
    ).rows[0].c;
    const res = await app.inject({ method: 'GET', url: `/api/backups/${filename}/download` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-length']).toBe('5');
    const after = (
      await db.query(`SELECT count(*)::int AS c FROM backup_runs WHERE event_kind='download'`)
    ).rows[0].c;
    expect(after).toBe(before + 1);
  });

  it('returns 404 for a missing file', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/backups/repos-20990101T000000Z.dump.gz/download',
    });
    expect(res.statusCode).toBe(404);
  });
});
