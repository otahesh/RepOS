// Ship detection.
//
// The question is never "was it merged?" — a commit can sit in main for days
// without being deployed. It is "is the fix contained in what production is
// running?", answered by ancestry against the SHA the container reports.
// Ancestry is also monotone: once true it stays true, so a re-run cannot flip
// a decision back and un-tell somebody.
import { spawn } from 'node:child_process';
import { listResolvable, SHA_RE } from './fixLifecycle.js';
import { sendResolvedEmail } from './feedbackEmails.js';
import { readDeployedRev } from './deployedRev.js';

type Ancestry = (candidate: string, deployed: string) => Promise<boolean>;
let ancestryOverride: Ancestry | null = null;

export function __setAncestryForTesting(f: Ancestry | null): void {
  ancestryOverride = f;
}

// Every invocation runs with no system/global git config and no hooks, so
// hooks and repo-local config from whatever machine this runs on cannot
// change the answer or execute arbitrary code on our behalf.
function runGit(args: string[], cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
      cwd,
      stdio: 'ignore',
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_TERMINAL_PROMPT: '0',
      },
    });
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
}

/**
 * Is `candidate` contained in `deployed`?
 *
 * `--is-ancestor` exits non-zero for BOTH "not an ancestor" and "I do not have
 * that object", so the object's existence is checked first. Collapsing the two
 * would report a definite "not shipped" for a broken clone, and hide it
 * forever.
 */
export async function isAncestor(
  candidate: string,
  deployed: string,
  repoDir: string = process.cwd(),
): Promise<boolean> {
  for (const sha of [candidate, deployed]) {
    if (!SHA_RE.test(sha)) throw new Error(`not a full lowercase 40-hex SHA: ${sha}`);
  }
  for (const sha of [candidate, deployed]) {
    if ((await runGit(['cat-file', '-e', `${sha}^{commit}`], repoDir)) !== 0) {
      throw new Error(`unknown object ${sha} in ${repoDir}`);
    }
  }
  const code = await runGit(['merge-base', '--is-ancestor', candidate, deployed], repoDir);
  if (code !== 0 && code !== 1) throw new Error('ancestry check failed');
  return code === 0;
}

export interface CheckShippedResult {
  deployedSha: string | null;
  considered: number;
  shipped: number;
  emailed: number;
  skipped: number;
  diagnostics: Array<{
    feedbackId?: string;
    stage: 'deployment' | 'ancestry' | 'email';
    code: string;
  }>;
}

export async function checkShipped(
  opts: { dryRun?: boolean; repoDir?: string } = {},
): Promise<CheckShippedResult> {
  const result: CheckShippedResult = {
    deployedSha: null,
    considered: 0,
    shipped: 0,
    emailed: 0,
    skipped: 0,
    diagnostics: [],
  };

  let deployedSha: string;
  try {
    deployedSha = await readDeployedRev();
  } catch {
    // Cannot read production: no-op. Guessing here is how somebody gets told
    // their bug shipped when it did not.
    result.diagnostics.push({ stage: 'deployment', code: 'unreadable' });
    return result;
  }
  result.deployedSha = deployedSha;

  const ancestry: Ancestry = ancestryOverride ?? ((a, d) => isAncestor(a, d, opts.repoDir));
  const rows = await listResolvable();
  result.considered = rows.length;

  for (const row of rows) {
    let shipped: boolean;
    try {
      shipped = await ancestry(row.effective_fix_sha, deployedSha);
    } catch {
      // Unknown object or a broken clone — one bad row does not abandon the
      // sweep, and the row stays selectable for the next run.
      result.skipped += 1;
      result.diagnostics.push({ feedbackId: row.id, stage: 'ancestry', code: 'unverifiable' });
      continue;
    }
    if (!shipped) continue;
    result.shipped += 1;
    if (opts.dryRun) continue;

    try {
      const res = await sendResolvedEmail({ id: row.id, bodyText: resolvedCopy(row.body) });
      if (res.status === 'sent') result.emailed += 1;
      else {
        result.skipped += 1;
        result.diagnostics.push({ feedbackId: row.id, stage: 'email', code: res.status });
      }
    } catch {
      result.skipped += 1;
      result.diagnostics.push({ feedbackId: row.id, stage: 'email', code: 'send_refused' });
    }
  }

  return result;
}

function resolvedCopy(body: string): string {
  const quoted = body.trim().replace(/\s+/g, ' ').slice(0, 160);
  return [
    'You reported this:',
    `"${quoted}"`,
    'It is fixed and live. Thanks for telling us — it made the app better.',
  ].join('\n\n');
}
