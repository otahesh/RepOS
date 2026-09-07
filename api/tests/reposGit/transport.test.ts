import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import * as runner from '../../src/reposGit/git.js';
import { submitPatch } from '../../src/reposGit/submitPatch.js';
import { patchDigest, signApproval } from '../../src/services/patchApproval.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
describe('Git credential transport', () => {
  it('authenticates HTTPS in the child environment without argv, config writes or error disclosure', async () => {
    const token = 'ghp_transportsecret';
    vi.stubEnv('FEEDBACK_GITHUB_TOKEN', token);
    vi.stubEnv('FEEDBACK_GITHUB_REPO', 'otahesh/RepOS');
    const sha = 'a'.repeat(40);
    const diff = 'a bounded approved diff';
    const keys = generateKeyPairSync('ed25519');
    const approval = {
      feedbackId: '5',
      baseSha: sha,
      patchDigest: patchDigest(diff),
      expiry: Math.floor(Date.now() / 1000) + 600,
    };
    const spy = vi.spyOn(runner, 'runGit').mockImplementation(async (_dir, args) => {
      if (args[0] === 'remote')
        return { code: 0, stdout: 'https://github.com/otahesh/RepOS.git\n' };
      if (args[0] === 'ls-remote') return { code: 0, stdout: '' };
      if (args[0] === 'push') return { code: 1, stdout: token };
      return { code: 0, stdout: `${sha}\n` };
    });
    const error = await submitPatch({
      feedbackId: '5',
      patch: diff,
      approval,
      signature: signApproval(
        approval,
        keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      ),
      publicKeyPem: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      repoDir: '/trusted/clone',
    }).catch((err: unknown) => err);
    expect(error).toMatchObject({ code: 'push_failed' });
    expect(String(error)).not.toContain(token);
    const push = spy.mock.calls.find((call) => call[1][0] === 'push');
    expect(push).toBeDefined();
    const header = push![2]?.env?.GIT_CONFIG_VALUE_0;
    expect(header).toBe(
      `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`,
    );
    for (const [, args] of spy.mock.calls) {
      expect(JSON.stringify(args)).not.toContain(token);
      expect(JSON.stringify(args)).not.toContain(
        Buffer.from(`x-access-token:${token}`).toString('base64'),
      );
      expect(args[0]).not.toBe('config');
    }
    expect(runner.gitEnvironment()).not.toHaveProperty('FEEDBACK_GITHUB_TOKEN');
  });
});
