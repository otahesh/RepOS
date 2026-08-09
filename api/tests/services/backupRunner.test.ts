// Direct unit coverage for services/backupRunner.ts run-state/error branches
// (quality pass Q8). The happy path (real pg_dump → sidecar → backup_runs ok)
// is covered end-to-end by tests/integration/backups-create.test.ts; these
// tests pin the FAILURE contract — a failed dump must leave a
// status='failed' backup_runs row with the error message, and rethrow.
import 'dotenv/config';
import { describe, it, expect, afterAll, afterEach } from 'vitest';
import { runManualBackup, dumpToFile } from '../../src/services/backupRunner.js';
import { db } from '../../src/db/client.js';

const origBackupsDir = process.env.BACKUPS_DIR;
const origDbUrl = process.env.DATABASE_URL;

afterEach(() => {
  if (origBackupsDir === undefined) delete process.env.BACKUPS_DIR;
  else process.env.BACKUPS_DIR = origBackupsDir;
  process.env.DATABASE_URL = origDbUrl;
});

afterAll(async () => {
  await db.query(`DELETE FROM backup_runs WHERE file_path LIKE '/nonexistent-vitest-%'`);
  await db.end();
});

describe('backupRunner failure branches', () => {
  it('dumpToFile rejects when DATABASE_URL is unset', async () => {
    delete process.env.DATABASE_URL;
    await expect(dumpToFile('/tmp/never-written.dump.gz')).rejects.toThrow(/DATABASE_URL/);
  });

  it('runManualBackup records a failed backup_runs row and rethrows when the dump cannot be written', async () => {
    // Unwritable destination: the shell pipe exits non-zero, so the catch
    // branch must stamp the run failed with the error message.
    process.env.BACKUPS_DIR = `/nonexistent-vitest-${process.pid}`;

    await expect(runManualBackup({ adminUserId: null, sourceIp: '127.0.0.1' })).rejects.toThrow();

    const { rows } = await db.query<{
      status: string;
      error_message: string | null;
      finished_at: string | null;
      trigger: string;
    }>(
      `SELECT status, error_message, finished_at, trigger
       FROM backup_runs
       WHERE file_path LIKE $1
       ORDER BY started_at DESC LIMIT 1`,
      [`/nonexistent-vitest-${process.pid}/%`],
    );
    expect(rows[0]).toBeDefined();
    expect(rows[0].status).toBe('failed');
    expect(rows[0].trigger).toBe('manual');
    expect(rows[0].error_message).toBeTruthy();
    expect(rows[0].finished_at).not.toBeNull();
  });
});
