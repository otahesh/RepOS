// W9 Q35 — run-restore.sh's ORCHESTRATION, executed as a real shell script.
//
// Why this exists: the reconciliation step (5b) originally only echoed its
// failure to stderr. restoreRunner.ts spawns this script detached with
// `stdio: 'ignore'`, so that stream goes nowhere, and the run then wrote an
// ordinary `ok` sentinel. Every service-level test still passed, because none
// of them ran the script — reconciliation was called directly. Deleting step
// 5b outright left the whole DR suite green. The only way to cover the wiring
// is to execute the script.
//
// The real Postgres/CF work is stubbed on PATH; what is under test is the
// script's control flow and what it persists to the sentinel.
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, mkdir, rm, readFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const SCRIPT = join(REPO_ROOT, 'scripts', 'run-restore.sh');

const sandboxes: string[] = [];
afterAll(async () => {
  for (const s of sandboxes) await rm(s, { recursive: true, force: true });
});

interface Sentinel {
  restore_id: string;
  status: 'running' | 'ok' | 'failed';
  error_message?: string;
  warning_message?: string;
  finished_at?: string;
}

interface Scenario {
  /** exit code for `node dist/db/migrate.js` */
  migrateExit?: number;
  /** exit code for `node dist/services/cfReconcile-cli.js` */
  reconcileExit?: number;
  /** exit code for the device_tokens `psql` call */
  psqlExit?: number;
}

/**
 * Build a throwaway environment the script can actually run in: a real gzip
 * dump whose name satisfies the allow-list, a stubbed snapshot script, and
 * stubs for pg_restore/psql/node/s6-rc earlier on PATH than anything real.
 *
 * s6-rc IS stubbed. An earlier version left it out on the reasoning that it is
 * absent from this workstation — but absence here is a property of one machine,
 * not of the test. On any CI image or inside the container itself the script's
 * `command -v s6-rc` guard would succeed and the run would issue a real
 * `s6-rc -d change api`, stopping a live service and then polling `-a list`
 * up to 35 times per scenario. The supervisor is not this test's subject; the
 * sentinel and the control flow are. Stubbing it makes the harness hermetic
 * AND exercises the stop/wait/boot branch, which the unstubbed version skipped
 * entirely.
 */
async function sandbox(scn: Scenario): Promise<{ run: () => number; sentinel: () => Promise<Sentinel> }> {
  const root = await mkdtemp(join(tmpdir(), 'repos-restore-orch-'));
  sandboxes.push(root);

  const backups = join(root, 'backups');
  const scripts = join(root, 'scripts');
  const bin = join(root, 'bin');
  const apiDir = join(root, 'api');
  await Promise.all([mkdir(backups), mkdir(scripts), mkdir(bin), mkdir(apiDir)]);

  // A REAL gzip: step 4 pipes `gunzip -c` into pg_restore under `pipefail`, so
  // a fake byte string would fail the pipeline and never reach step 5b.
  const src = join(backups, 'repos-orchestration-test.dump.gz');
  await writeFile(src, gzipSync(Buffer.from('-- not a real dump; pg_restore is stubbed\n')));

  const stub = async (name: string, body: string): Promise<void> => {
    const p = join(bin, name);
    await writeFile(p, `#!/usr/bin/env bash\n${body}\n`);
    await chmod(p, 0o755);
  };

  await stub('pg_restore', 'cat > /dev/null; exit 0');
  await stub('psql', `cat > /dev/null; exit ${scn.psqlExit ?? 0}`);
  // One `node` stub for both invocations — dispatch on the script path so a
  // scenario can fail exactly one of them.
  await stub(
    'node',
    [
      'case "$*" in',
      `  *cfReconcile-cli*) exit ${scn.reconcileExit ?? 0} ;;`,
      `  *migrate.js*) exit ${scn.migrateExit ?? 0} ;;`,
      '  *) exit 0 ;;',
      'esac',
    ].join('\n'),
  );

  // `-a list` must print NOTHING: the script greps its output for '^api$' and
  // breaks the 35×1s wait as soon as the service is gone, so silence means
  // "already stopped" and the loop exits on its first iteration. Every other
  // subcommand (`-d change api`, `-u change api`) just succeeds.
  await stub('s6-rc', 'exit 0');

  const snapshot = join(scripts, 'pre-restore-snapshot.sh');
  await writeFile(snapshot, '#!/usr/bin/env bash\nexit 0\n');
  await chmod(snapshot, 0o755);

  const sentinelPath = join(root, 'restore-state.json');

  return {
    run: () => {
      const r = spawnSync('bash', [SCRIPT, src, 'orch-restore-id', 'pre-restore-orch.sql.gz'], {
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH ?? ''}`,
          BACKUPS_DIR: backups,
          REPOS_SCRIPTS_DIR: scripts,
          REPOS_API_DIR: apiDir,
          RESTORE_STATE_PATH: sentinelPath,
          DATABASE_URL: 'postgres://stub/stub',
        },
        encoding: 'utf8',
      });
      return r.status ?? -1;
    },
    sentinel: async () => JSON.parse(await readFile(sentinelPath, 'utf8')) as Sentinel,
  };
}

describe('run-restore.sh orchestration (W9 Q35)', () => {
  beforeEach(() => {
    // The script must never reach a real database or a real s6 supervisor.
    expect(SCRIPT).toMatch(/scripts\/run-restore\.sh$/);
  });

  it('a FAILED reconciliation does not fail the restore, and is persisted as a warning', async () => {
    // The exact defect: previously this echoed to stderr, which restoreRunner
    // discards, and then wrote a clean `ok`. The operator saw a green restore
    // over an unreconciled Cloudflare policy.
    const { run, sentinel } = await sandbox({ reconcileExit: 1 });
    expect(run()).toBe(0); // non-fatal: the data restore is valid

    const s = await sentinel();
    expect(s.status).toBe('ok');
    expect(s.warning_message).toMatch(/reconciliation failed/i);
    expect(s.warning_message).toMatch(/settings\/users/); // names the remediation
    expect(s.error_message).toBeUndefined(); // it is a warning, not an error
  });

  it('a SUCCESSFUL reconciliation leaves no warning behind', async () => {
    // Without this, an implementation that always warns would pass the case
    // above and mean nothing.
    const { run, sentinel } = await sandbox({ reconcileExit: 0 });
    expect(run()).toBe(0);

    const s = await sentinel();
    expect(s.status).toBe('ok');
    expect(s.warning_message).toBeUndefined();
  });

  it('a warning recorded mid-run SURVIVES a later hard failure', async () => {
    // The sentinel is read-modify-write, and the warning is written the moment
    // it happens rather than at the end. Deferring it to the final mark_status
    // would silently drop it on exactly the runs that need it most.
    const { run, sentinel } = await sandbox({ reconcileExit: 1, psqlExit: 1 });
    expect(run()).toBe(1);

    const s = await sentinel();
    expect(s.status).toBe('failed');
    expect(s.error_message).toBe('device_tokens wipe failed');
    expect(s.warning_message).toMatch(/reconciliation failed/i);
  });

  it('a failed migration still fails the whole restore', async () => {
    // Proves the harness can observe failure at all — without it, every
    // assertion above could be passing against a script that never ran.
    const { run, sentinel } = await sandbox({ migrateExit: 1 });
    expect(run()).toBe(1);

    const s = await sentinel();
    expect(s.status).toBe('failed');
    expect(s.error_message).toBe('migrations failed after restore');
    expect(s.warning_message).toBeUndefined();
  });
});
