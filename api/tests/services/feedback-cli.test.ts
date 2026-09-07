import { describe, it, expect, vi, afterEach } from 'vitest';
import { Readable } from 'node:stream';
import { generateKeyPairSync } from 'node:crypto';
import { buildDatabaseUrl, runCli } from '../../src/services/feedbackTriage-cli.js';

const mocks = vi.hoisted(() => ({
  dbImports: 0,
  end: vi.fn(async () => {}),
  link: vi.fn(async () => {}),
  check: vi.fn(
    async (): Promise<{
      diagnostics: Array<{ stage: string; code: string }>;
      shipped: number;
    }> => ({ diagnostics: [], shipped: 0 }),
  ),
  reconcile: vi.fn(async () => ({ examined: 0, changed: 0, unchanged: 0, errored: 0 })),
  openPr: vi.fn(async () => ({ number: 7, url: 'https://github.com/example/repo/pull/7' })),
  submitPatch: vi.fn(async () => ({
    branch: 'feedback/1',
    headSha: 'a'.repeat(40),
    replaced: false,
  })),
  readFile: vi.fn(),
  stream: vi.fn(),
}));
vi.mock('../../src/db/client.js', () => {
  mocks.dbImports += 1;
  return { db: { end: mocks.end } };
});
vi.mock('../../src/services/feedbackTriage.js', () => ({}));
vi.mock('../../src/services/feedbackEmails.js', () => ({}));
vi.mock('../../src/services/fixLifecycle.js', () => ({ link: mocks.link }));
vi.mock('../../src/services/checkShipped.js', () => ({ checkShipped: mocks.check }));
vi.mock('../../src/services/reconcileFixes.js', () => ({ reconcileFixes: mocks.reconcile }));
vi.mock('../../src/reposGit/index.js', () => ({
  openPr: mocks.openPr,
  submitPatch: mocks.submitPatch,
}));
vi.mock('node:fs/promises', () => ({ readFile: mocks.readFile }));
vi.mock('node:fs', () => ({ createReadStream: mocks.stream }));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function stdin(text: string) {
  vi.spyOn(process, 'stdin', 'get').mockReturnValue(Readable.from([text]) as typeof process.stdin);
}
function noDatabase() {
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('POSTGRES_PASSWORD', '');
}

describe('fix lifecycle CLI', () => {
  it('opens a PR without database configuration and derives metadata', async () => {
    noDatabase();
    expect(await runCli(['open-pr', '--id', '1'], vi.fn())).toBe(0);
    expect(mocks.openPr).toHaveBeenCalledWith({ feedbackId: '1' });
    expect(mocks.end).not.toHaveBeenCalled();
    expect(mocks.dbImports).toBe(0);
  });
  it('requires an explicit trusted clone before database setup for check-shipped', async () => {
    noDatabase();
    vi.stubEnv('FEEDBACK_REPO_DIR', '');
    const out = vi.fn();
    expect(await runCli(['check-shipped'], out)).toBe(2);
    expect(out).toHaveBeenCalledWith('FEEDBACK_REPO_DIR is required');
    expect(mocks.check).not.toHaveBeenCalled();
  });
  it('threads clone and dry-run, then closes its database pool', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://test/local');
    vi.stubEnv('FEEDBACK_REPO_DIR', '/trusted/clone');
    expect(await runCli(['check-shipped', '--dry-run'], vi.fn())).toBe(0);
    expect(mocks.check).toHaveBeenCalledWith({ dryRun: true, repoDir: '/trusted/clone' });
    expect(mocks.end).toHaveBeenCalledOnce();
  });
  it('reports ancestry diagnostics as failure but unreadable deployment as a no-op', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://test/local');
    vi.stubEnv('FEEDBACK_REPO_DIR', '/trusted/clone');
    mocks.check.mockResolvedValueOnce({
      diagnostics: [{ stage: 'ancestry', code: 'unverifiable' }],
      shipped: 0,
    });
    const out = vi.fn();
    expect(await runCli(['check-shipped', '--dry-run'], out)).toBe(1);
    expect(JSON.parse(out.mock.calls[0][0]).diagnostics[0].code).toBe('unverifiable');
    mocks.check.mockResolvedValueOnce({
      diagnostics: [{ stage: 'deployment', code: 'unreadable' }],
      shipped: 0,
    });
    expect(await runCli(['check-shipped', '--dry-run'], vi.fn())).toBe(0);
  });
  it('wires link and reconcile using the existing flag convention', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://test/local');
    expect(await runCli(['link', '--id', '1', '--sha', 'a'.repeat(40)], vi.fn())).toBe(0);
    expect(mocks.link).toHaveBeenCalledWith('1', 'a'.repeat(40));
    expect(await runCli(['reconcile'], vi.fn())).toBe(0);
    expect(mocks.reconcile).toHaveBeenCalledOnce();
  });
  it('signs and consumes the exact patch without a database', async () => {
    noDatabase();
    const pair = generateKeyPairSync('ed25519');
    const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
    const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' });
    const patch =
      'diff --git a/readme.txt b/readme.txt\n--- a/readme.txt\n+++ b/readme.txt\n@@ -1 +1 @@\n-old\n+new\n';
    vi.stubEnv('FEEDBACK_APPROVAL_KEY', '/key');
    vi.stubEnv('FEEDBACK_APPROVAL_PUBKEY', '/pubkey');
    vi.stubEnv('FEEDBACK_REPO_DIR', '/trusted/clone');
    mocks.readFile.mockResolvedValueOnce(privateKey).mockResolvedValueOnce(publicKey);
    stdin(patch);
    const lines: string[] = [];
    expect(
      await runCli(['approve-patch', '--id', '1', '--base', 'a'.repeat(40)], (s) => lines.push(s)),
    ).toBe(0);
    stdin(lines[0]);
    mocks.stream.mockReturnValue(Readable.from([patch]));
    expect(await runCli(['submit-patch', '--patch', '/patch'], vi.fn())).toBe(0);
    expect(mocks.submitPatch).toHaveBeenCalledWith(
      expect.objectContaining({ patch, feedbackId: '1', repoDir: '/trusted/clone' }),
    );
    expect(mocks.end).not.toHaveBeenCalled();
  });
  it.each(['0', '-1', '1.5', '86401', 'NaN'])('refuses invalid signing TTL %s', async (ttl) => {
    noDatabase();
    vi.stubEnv('FEEDBACK_APPROVAL_TTL_SECONDS', ttl);
    expect(await runCli(['approve-patch', '--id', '1', '--base', 'a'.repeat(40)], vi.fn())).toBe(1);
    expect(mocks.readFile).not.toHaveBeenCalled();
  });
  it('refuses oversized input before reading a signing key', async () => {
    noDatabase();
    vi.stubEnv('FEEDBACK_APPROVAL_KEY', '/key');
    stdin('x'.repeat(1024 * 1024 + 1));
    expect(await runCli(['approve-patch', '--id', '1', '--base', 'a'.repeat(40)], vi.fn())).toBe(1);
    expect(mocks.readFile).not.toHaveBeenCalled();
  });
  it.each(['null', '{}', '{"approval":null}', '{"approval":{"feedbackId":1},"signature":42}'])(
    'refuses malformed envelope %s before reading files',
    async (text) => {
      noDatabase();
      vi.stubEnv('FEEDBACK_APPROVAL_PUBKEY', '/pub');
      vi.stubEnv('FEEDBACK_REPO_DIR', '/clone');
      stdin(text);
      expect(await runCli(['submit-patch', '--patch', '/patch'], vi.fn())).toBe(1);
      expect(mocks.readFile).not.toHaveBeenCalled();
      expect(mocks.stream).not.toHaveBeenCalled();
    },
  );
});

describe('buildDatabaseUrl', () => {
  it('prefers an explicit DATABASE_URL', () => {
    expect(buildDatabaseUrl({ DATABASE_URL: 'postgres://a/b' })).toBe('postgres://a/b');
  });

  it('builds one from POSTGRES_* when absent, as 002-w9-cf-baseline.sh does', () => {
    // DATABASE_URL is NOT in the container environment: the three s6 scripts
    // each build it into their own service, and `docker exec` inherits none of
    // that. A CLI that assumes it is ambient fails with FATAL 28000.
    expect(
      buildDatabaseUrl({
        POSTGRES_USER: 'repos',
        POSTGRES_PASSWORD: 'pw',
        POSTGRES_DB: 'repos',
      }),
    ).toBe('postgres://repos:pw@127.0.0.1:5432/repos');
  });

  it('applies the same defaults the shell scripts do', () => {
    expect(buildDatabaseUrl({ POSTGRES_PASSWORD: 'pw' })).toBe(
      'postgres://repos:pw@127.0.0.1:5432/repos',
    );
  });

  it('percent-encodes a password containing URL metacharacters', () => {
    const url = buildDatabaseUrl({ POSTGRES_PASSWORD: 'p@ss:word/#1' });
    expect(url).toBe('postgres://repos:p%40ss%3Aword%2F%231@127.0.0.1:5432/repos');
  });

  it('returns undefined when there is nothing to build from', () => {
    expect(buildDatabaseUrl({})).toBeUndefined();
  });
});
