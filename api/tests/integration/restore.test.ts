// api/tests/integration/restore.test.ts
//
// G5 acceptance #1 — restore happy path.
//
// Flow:
//   1. Seed dataset (a row) in a DEDICATED ephemeral DB.
//   2. pg_dump → file.
//   3. Mutate DB (insert a second row).
//   4. pg_restore --clean --if-exists from the dump.
//   5. Assert DB state matches the dump (the post-dump mutation is gone).
//
// CRITICAL ISOLATION NOTE: pg_restore --clean DROPs + recreates EVERY table.
// Running that against the SHARED repos_test_w5 DB would corrupt every other
// integration suite (they share the same physical database even though vitest
// isolates module state). So this suite provisions its OWN database
// (repos_test_w5_restore) and never touches the shared `db` pool. The full
// detached shell flow (scripts/run-restore.sh) is exercised separately by
// tests/dr/restore-into-ephemeral.sh; the kickoff contract is in
// maintenance-routes.test.ts. This test proves the core invariant:
// "restore reverts post-dump mutations."
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import pg from 'pg';

const SHARED_URL = process.env.DATABASE_URL!;
// Derive a sibling DB URL by swapping the database name.
const RESTORE_DB = 'repos_test_w5_restore';
const RESTORE_URL = SHARED_URL.replace(/\/[^/?]+(\?|$)/, `/${RESTORE_DB}$1`);

let tmpDir: string;
let pool: pg.Pool;

function sh(cmd: string): void {
  execSync(cmd, { stdio: 'pipe', shell: '/bin/bash' });
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'repos-restore-'));
  // (Re)create the dedicated DB. The repos role has CREATEDB.
  const adminUrl = SHARED_URL.replace(/\/[^/?]+(\?|$)/, '/postgres$1');
  sh(`psql "${adminUrl}" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS ${RESTORE_DB} WITH (FORCE)"`);
  sh(`psql "${adminUrl}" -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${RESTORE_DB}"`);
  // A minimal schema is all this test needs (we test the revert invariant).
  pool = new pg.Pool({ connectionString: RESTORE_URL, max: 2 });
  await pool.query(`
    CREATE TABLE widgets (
      id BIGSERIAL PRIMARY KEY,
      label TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
});

afterAll(async () => {
  if (pool && !(pool as unknown as { ended?: boolean }).ended) await pool.end();
  rmSync(tmpDir, { recursive: true, force: true });
  const adminUrl = SHARED_URL.replace(/\/[^/?]+(\?|$)/, '/postgres$1');
  sh(`psql "${adminUrl}" -c "DROP DATABASE IF EXISTS ${RESTORE_DB} WITH (FORCE)"`);
});

describe('G5 case 1 — restore happy path', () => {
  it('restores a dump and the post-dump mutation is reverted', async () => {
    // 1. Seed: one widget.
    await pool.query(`INSERT INTO widgets (label) VALUES ('seed-1')`);
    const beforeCount = (await pool.query(`SELECT count(*)::int AS c FROM widgets`)).rows[0].c;
    expect(beforeCount).toBe(1);

    // 2. Dump the dedicated DB (same pg_dump|gzip pipe the backup runner uses).
    const dumpPath = join(tmpDir, 'restore-happy.dump.gz');
    sh(`pg_dump --format=custom "${RESTORE_URL}" | gzip -6 > "${dumpPath}"`);

    // 3. Mutate: insert a second widget AFTER the dump.
    await pool.query(`INSERT INTO widgets (label) VALUES ('post-dump-mutation')`);
    const afterMutateCount = (await pool.query(`SELECT count(*)::int AS c FROM widgets`)).rows[0].c;
    expect(afterMutateCount).toBe(2);

    // 4. Restore. Close the dedicated pool first so pg_restore --clean can grab
    //    its AccessExclusiveLock (mirrors run-restore.sh SIGTERM-before-restore).
    await pool.end();
    sh(
      `gunzip -c "${dumpPath}" | pg_restore --clean --if-exists --no-owner --no-privileges -d "${RESTORE_URL}"`,
    );

    // 5. Assert the post-dump mutation is gone (DB matches the dump).
    const probe = new pg.Pool({ connectionString: RESTORE_URL, max: 1 });
    try {
      const restoredCount = (await probe.query(`SELECT count(*)::int AS c FROM widgets`)).rows[0].c;
      expect(restoredCount).toBe(beforeCount);
      const labels = (await probe.query(`SELECT label FROM widgets ORDER BY id`)).rows.map(
        (r: { label: string }) => r.label,
      );
      expect(labels).toEqual(['seed-1']);
    } finally {
      await probe.end();
    }
  });
});
