import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm, writeFile, readFile, readdir, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { submitPatch, type SubmitPatchInput } from '../../src/reposGit/submitPatch.js';
import { gitEnvironment, GIT_HARDENING } from '../../src/reposGit/git.js';
import * as gitRunner from '../../src/reposGit/git.js';
import { patchDigest, signApproval } from '../../src/services/patchApproval.js';

const keys = generateKeyPairSync('ed25519');
const priv = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const pub = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
function git(dir: string, ...args: string[]) {
  return execFileSync('git', [...GIT_HARDENING, '-C', dir, ...args], {
    encoding: 'utf8',
    env: gitEnvironment(),
    timeout: 10_000,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}
async function makeRepo() {
  const root = await mkdtemp(join(tmpdir(), 'feedback-git-test-'));
  dirs.push(root);
  const bare = join(root, 'remote.git');
  const work = join(root, 'clone');
  git(root, 'init', '-q', '--bare', '-b', 'main', bare);
  git(root, 'clone', '-q', bare, work);
  git(work, 'config', 'user.name', 'Test');
  git(work, 'config', 'user.email', 'test@example.test');
  await writeFile(join(work, 'app.txt'), 'limit = 10\n');
  git(work, 'add', 'app.txt');
  git(work, 'commit', '-q', '-m', 'base');
  git(work, 'push', '-q', 'origin', 'main');
  return { root, bare, work, base: git(work, 'rev-parse', 'HEAD') };
}
function patch(to = '25', from = '10') {
  return `diff --git a/app.txt b/app.txt\n--- a/app.txt\n+++ b/app.txt\n@@ -1 +1 @@\n-limit = ${from}\n+limit = ${to}\n`;
}
function input(work: string, base: string, diff = patch()): SubmitPatchInput {
  const approval = {
    feedbackId: '5',
    baseSha: base,
    patchDigest: patchDigest(diff),
    expiry: Math.floor(Date.now() / 1000) + 600,
  };
  return {
    feedbackId: '5',
    patch: diff,
    approval,
    signature: signApproval(approval, priv),
    repoDir: work,
    publicKeyPem: pub,
  };
}
const scratchDirs = async () =>
  (await readdir(tmpdir())).filter((p) => p.startsWith('repos-git-')).sort();

describe('submitPatch using a real bare remote', () => {
  it('never force-pushes or executes checkout commands', async () => {
    const { work, base } = await makeRepo();
    const spy = vi.spyOn(gitRunner, 'runGit');
    await submitPatch(input(work, base));
    const commands = spy.mock.calls.map((call) => call[1]);
    const pushes = commands.filter((args) => args[0] === 'push');
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).not.toContain('--force');
    expect(pushes[0]).not.toContain('-f');
    expect(pushes[0].some((arg) => arg.startsWith('+'))).toBe(false);
    expect(pushes[0].at(-1)).toMatch(/^[0-9a-f]{40}:refs\/heads\/feedback\/5$/);
    expect(commands.some((args) => ['checkout', 'checkout-index'].includes(args[0]))).toBe(false);
    expect(commands.find((args) => args[0] === 'apply')).toContain('--cached');
  });
  it('creates the derived branch with approved content and derived metadata', async () => {
    const { bare, work, base } = await makeRepo();
    const result = await submitPatch({ ...input(work, base), message: 'private reporter content' });
    expect(result.branch).toBe('feedback/5');
    expect(result.replaced).toBe(false);
    expect(git(bare, 'show', 'feedback/5:app.txt')).toBe('limit = 25');
    const message = git(bare, 'show', '-s', '--format=%B', result.headSha);
    expect(message).toContain(`Feedback-Base: ${base}`);
    expect(message).toContain(`Feedback-Patch-Digest: ${patchDigest(patch())}`);
    expect(message).not.toContain('private reporter');
    expect(git(bare, 'rev-parse', `${result.headSha}^`)).toBe(base);
  });

  it('repeats the same base/digest from a fresh clone without another commit', async () => {
    const { root, bare, work, base } = await makeRepo();
    const first = await submitPatch(input(work, base));
    const fresh = join(root, 'fresh');
    git(root, 'clone', '-q', bare, fresh);
    const second = await submitPatch(input(fresh, base));
    expect(second.headSha).toBe(first.headSha);
    expect(git(bare, 'rev-list', '--count', 'feedback/5')).toBe('2');
  });

  it('a revision fast-forwards with the old tip as sole parent and the new base-relative tree', async () => {
    const { bare, work, base } = await makeRepo();
    const first = await submitPatch(input(work, base));
    const second = await submitPatch(input(work, base, patch('50')));
    expect(second.replaced).toBe(true);
    expect(git(bare, 'show', '-s', '--format=%P', second.headSha)).toBe(first.headSha);
    expect(git(bare, 'show', 'feedback/5:app.txt')).toBe('limit = 50');
    expect(git(bare, 'merge-base', '--is-ancestor', first.headSha, second.headSha)).toBe('');
  });

  it.each(['main', 'refs/tags/v1', 'outside/5', ':main'])(
    'ignores caller target %s',
    async (branch) => {
      const { bare, work, base } = await makeRepo();
      await submitPatch({
        ...input(work, base),
        branch,
        force: true,
        delete: true,
      } as SubmitPatchInput);
      expect(git(bare, 'rev-parse', 'main')).toBe(base);
      expect(
        git(bare, 'for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/tags').split('\n'),
      ).toEqual(['refs/heads/feedback/5', 'refs/heads/main']);
    },
  );

  it('refuses any caller remote other than origin before Git runs', async () => {
    await expect(
      submitPatch({ ...input('/missing', 'a'.repeat(40)), remote: '/tmp/another' }),
    ).rejects.toMatchObject({ code: 'bad_remote' });
  });

  it('rejects a different pushurl instead of sending to it', async () => {
    const { root, bare, work, base } = await makeRepo();
    git(work, 'remote', 'set-url', '--push', 'origin', join(root, 'other.git'));
    await expect(submitPatch(input(work, base))).rejects.toMatchObject({ code: 'bad_remote' });
    expect(git(bare, 'for-each-ref', '--format=%(refname)', 'refs/heads')).toBe('refs/heads/main');
  });

  it('refuses a known commit outside trusted main ancestry', async () => {
    const { work } = await makeRepo();
    await writeFile(join(work, 'app.txt'), 'limit = 12\n');
    git(work, 'commit', '-qam', 'unpublished');
    const side = git(work, 'rev-parse', 'HEAD');
    await expect(submitPatch(input(work, side, patch('25', '12')))).rejects.toMatchObject({
      code: 'untrusted_base',
    });
  });

  it('fetches trusted main rather than trusting a stale tracking ref', async () => {
    const { root, bare, work } = await makeRepo();
    const other = join(root, 'other');
    git(root, 'clone', '-q', bare, other);
    git(other, 'config', 'user.email', 'test@example.test');
    git(other, 'config', 'user.name', 'Test');
    await writeFile(join(other, 'app.txt'), 'limit = 12\n');
    git(other, 'commit', '-qam', 'new main');
    git(other, 'push', '-q', 'origin', 'main');
    const latest = git(other, 'rev-parse', 'HEAD');
    await submitPatch(input(work, latest, patch('25', '12')));
    expect(git(bare, 'rev-parse', 'feedback/5^')).toBe(latest);
  });

  it('refuses unknown base and invalid approvals before changing the remote', async () => {
    const { work, base } = await makeRepo();
    await expect(submitPatch(input(work, '0'.repeat(40)))).rejects.toMatchObject({
      code: 'unknown_base',
    });
    const original = input(work, base);
    await expect(submitPatch({ ...original, patch: patch('99') })).rejects.toMatchObject({
      code: 'digest_mismatch',
    });
    await expect(
      submitPatch({ ...original, signature: Buffer.alloc(64).toString('base64') }),
    ).rejects.toMatchObject({ code: 'bad_signature' });
    await expect(submitPatch({ ...original, feedbackId: '6' })).rejects.toMatchObject({
      code: 'id_mismatch',
    });
    const expired = { ...original.approval, expiry: 1 };
    await expect(
      submitPatch({ ...original, approval: expired, signature: signApproval(expired, priv) }),
    ).rejects.toMatchObject({ code: 'expired' });
    for (const id of ['../main', 'HEAD', '0', '5;true', '']) {
      await expect(submitPatch({ ...original, feedbackId: id })).rejects.toMatchObject({
        code: 'bad_feedback_id',
      });
    }
  });

  it('leaves checkout and index intact and removes scratch state on success and apply failure', async () => {
    const { bare, work, base } = await makeRepo();
    await writeFile(join(work, 'operator.txt'), 'unrelated\n');
    git(work, 'add', 'operator.txt');
    const index = await readFile(join(work, '.git/index'));
    const before = await scratchDirs();
    await expect(submitPatch(input(work, base, patch('25', '999')))).rejects.toMatchObject({
      code: 'apply_failed',
    });
    expect(git(bare, 'for-each-ref', '--format=%(refname)', 'refs/heads')).toBe('refs/heads/main');
    await submitPatch(input(work, base));
    expect(await scratchDirs()).toEqual(before);
    expect(await readFile(join(work, '.git/index'))).toEqual(index);
    expect(await readFile(join(work, 'app.txt'), 'utf8')).toBe('limit = 10\n');
    expect(git(work, 'rev-parse', 'HEAD')).toBe(base);
  });

  it('disables local hooks, fsmonitor and checkout filters while clearing inherited Git overrides', async () => {
    const { root, bare, work, base } = await makeRepo();
    const marker = join(root, 'hook-ran');
    const hook = join(work, '.git/hooks/pre-push');
    await writeFile(hook, `#!/bin/sh\ntouch '${marker}'\nexit 1\n`);
    await chmod(hook, 0o700);
    git(work, 'config', 'core.fsmonitor', hook);
    git(work, 'config', 'filter.probe.smudge', hook);
    await writeFile(join(work, '.git/info/attributes'), '* filter=probe\n');
    vi.stubEnv('GIT_DIR', '/does/not/exist');
    vi.stubEnv('GIT_INDEX_FILE', '/does/not/exist/index');
    vi.stubEnv('GIT_CONFIG_COUNT', '1');
    vi.stubEnv('GIT_CONFIG_KEY_0', 'core.hooksPath');
    vi.stubEnv('GIT_CONFIG_VALUE_0', join(work, '.git/hooks'));
    vi.stubEnv('GIT_TRACE', join(root, 'trace'));
    await submitPatch(input(work, base));
    expect(git(bare, 'show', 'feedback/5:app.txt')).toBe('limit = 25');
    await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(root, 'trace'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('cleans scratch state and reports a sanitized rejected push', async () => {
    const { bare, work, base } = await makeRepo();
    git(bare, 'config', 'receive.denyNonFastForwards', 'true');
    git(bare, 'config', 'transfer.hideRefs', 'refs/heads/feedback/');
    const before = await scratchDirs();
    await expect(submitPatch(input(work, base))).rejects.toMatchObject({ code: 'push_failed' });
    expect(await scratchDirs()).toEqual(before);
  });
});
