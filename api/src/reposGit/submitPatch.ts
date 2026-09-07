import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import {
  verifyApproval,
  patchDigest,
  ApprovalError,
  type Approval,
} from '../services/patchApproval.js';
import { runGit } from './git.js';
import { feedbackBranch, githubRepo, githubToken } from './config.js';
import { RepoGitError } from './errors.js';
export { RepoGitError, type RepoGitErrorCode } from './errors.js';
export { GIT_HARDENING } from './git.js';

const SHA_RE = /^[0-9a-f]{40}$/;
export interface SubmitPatchInput {
  feedbackId: string;
  patch: string;
  approval: Approval;
  signature: string;
  /** Legacy compatibility only: public metadata is always derived. */
  message?: string;
  /** Trusted operator configuration, never an agent-supplied repository. */
  repoDir: string;
  publicKeyPem: string;
  remote?: string;
}
export interface SubmitPatchResult {
  branch: string;
  headSha: string;
  replaced: boolean;
}

export async function submitPatch(input: SubmitPatchInput): Promise<SubmitPatchResult> {
  const branch = feedbackBranch(input.feedbackId);
  if (input.remote !== undefined && input.remote !== 'origin') {
    throw new RepoGitError('bad_remote', 'only configured origin is allowed');
  }
  if (typeof input.patch !== 'string' || Buffer.byteLength(input.patch) > 1024 * 1024) {
    throw new RepoGitError('malformed', 'patch exceeds the 1 MiB limit');
  }
  if (input.approval.feedbackId !== input.feedbackId) {
    throw new RepoGitError('id_mismatch', 'approval belongs to another feedback item');
  }
  if (patchDigest(input.patch) !== input.approval.patchDigest) {
    throw new RepoGitError('digest_mismatch', 'patch does not match approved bytes');
  }
  try {
    verifyApproval(input.approval, input.signature, input.publicKeyPem);
  } catch (err) {
    if (err instanceof ApprovalError) throw new RepoGitError(err.code, 'approval refused');
    throw err;
  }
  const git = (args: string[], env?: NodeJS.ProcessEnv, content?: string) =>
    runGit(input.repoDir, args, { env, input: content });

  // Resolve exactly one configured destination. Do not let pushurl, mirror,
  // configured push refspecs or URL rewrites select additional destinations.
  const remote = await git(['remote', 'get-url', '--all', 'origin']);
  const pushRemote = await git(['remote', 'get-url', '--push', '--all', 'origin']);
  const url = remote.stdout.trim();
  if (remote.code || pushRemote.code || url !== pushRemote.stdout.trim() || /[\r\n]/.test(url)) {
    throw new RepoGitError(
      'bad_remote',
      'origin must have one identical fetch and push destination',
    );
  }
  let auth: NodeJS.ProcessEnv = {};
  if (!isAbsolute(url)) {
    if (
      url !== `https://github.com/${githubRepo()}.git` &&
      url !== `https://github.com/${githubRepo()}`
    ) {
      throw new RepoGitError(
        'bad_remote',
        'origin must be the configured GitHub repository over HTTPS',
      );
    }
    // Secret is child environment only, never argv, persisted config or errors.
    auth = {
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
      GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`x-access-token:${githubToken()}`).toString('base64')}`,
    };
  }
  if (
    (
      await git(
        [
          'fetch',
          '--quiet',
          '--no-tags',
          '--no-write-fetch-head',
          url,
          'refs/heads/main:refs/remotes/origin/main',
        ],
        auth,
      )
    ).code !== 0
  ) {
    throw new RepoGitError('remote_failed', 'could not refresh trusted main');
  }
  const base = input.approval.baseSha;
  if ((await git(['cat-file', '-e', `${base}^{commit}`])).code !== 0) {
    throw new RepoGitError('unknown_base', 'approved base is unavailable');
  }
  if ((await git(['merge-base', '--is-ancestor', base, 'refs/remotes/origin/main'])).code !== 0) {
    throw new RepoGitError('untrusted_base', 'approved base is not an ancestor of origin/main');
  }
  const ref = `refs/heads/${branch}`;
  const listing = await git(['ls-remote', '--refs', url, ref], auth);
  if (listing.code !== 0) throw new RepoGitError('remote_failed', 'could not read feedback branch');
  const rows = listing.stdout.trim().split('\n').filter(Boolean);
  const existing = rows.length === 0 ? null : rows[0].split('\t')[0];
  if (
    rows.length > 1 ||
    (existing && (!SHA_RE.test(existing) || rows[0] !== `${existing}\t${ref}`))
  ) {
    throw new RepoGitError('remote_failed', 'unexpected remote branch response');
  }
  if (
    existing &&
    (await git(['fetch', '--quiet', '--no-tags', '--no-write-fetch-head', url, existing], auth))
      .code
  ) {
    throw new RepoGitError('remote_failed', 'could not fetch feedback tip');
  }
  const scratch = await mkdtemp(join(tmpdir(), 'repos-git-'));
  try {
    const env = { GIT_INDEX_FILE: join(scratch, 'index') };
    if (
      (await git(['read-tree', base], env)).code ||
      (await git(['apply', '--cached', '--whitespace=nowarn', '-'], env, input.patch)).code
    ) {
      throw new RepoGitError('apply_failed', 'patch does not apply to approved base');
    }
    const tree = await git(['write-tree'], env);
    const treeSha = tree.stdout.trim();
    if (tree.code || !SHA_RE.test(treeSha))
      throw new RepoGitError('apply_failed', 'could not write patch tree');
    const message = `fix: feedback ${input.feedbackId}\n\nFeedback-Id: ${input.feedbackId}\nFeedback-Base: ${base}\nFeedback-Patch-Digest: ${input.approval.patchDigest}\n`;
    if (existing) {
      const metadata = await git(['show', '-s', '--format=%B', existing]);
      const oldTree = await git(['rev-parse', `${existing}^{tree}`]);
      if (
        !metadata.code &&
        !oldTree.code &&
        metadata.stdout.trim() === message.trim() &&
        oldTree.stdout.trim() === treeSha
      ) {
        return { branch, headSha: existing, replaced: false };
      }
    }
    const commit = await git(
      ['commit-tree', treeSha, '-p', existing ?? base],
      {
        ...env,
        GIT_AUTHOR_NAME: 'RepOS Feedback',
        GIT_AUTHOR_EMAIL: 'feedback@users.noreply.github.com',
        GIT_COMMITTER_NAME: 'RepOS Feedback',
        GIT_COMMITTER_EMAIL: 'feedback@users.noreply.github.com',
      },
      message,
    );
    const headSha = commit.stdout.trim();
    if (commit.code || !SHA_RE.test(headSha))
      throw new RepoGitError('apply_failed', 'could not commit patch');
    // No force marker: a concurrent writer wins safely; next invocation reads
    // its real tip. Neither the worktree nor the clone's ordinary index moves.
    if ((await git(['push', '--quiet', '--no-follow-tags', url, `${headSha}:${ref}`], auth)).code) {
      throw new RepoGitError('push_failed', 'feedback branch push failed; reconcile before retry');
    }
    return { branch, headSha, replaced: existing !== null };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
