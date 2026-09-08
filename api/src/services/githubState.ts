// Anonymous reads of the public repository's branch and PR state.
//
// No token: the repo is public, and putting a credential in the path that runs
// on every sweep buys nothing. repos-git's token is for writes only.
const API = 'https://api.github.com';
const TIMEOUT_MS = 10_000;

let fetchOverride: typeof fetch | null = null;

export function __setGithubFetchForTesting(f: typeof fetch | null): void {
  fetchOverride = f;
}

export function repoSlug(): string {
  return process.env.FEEDBACK_GITHUB_REPO ?? 'otahesh/RepOS';
}

export interface BranchState {
  exists: boolean;
  headSha: string | null;
}

export interface PrState {
  number: number;
  state: 'open' | 'closed';
  merged: boolean;
  mergeCommitSha: string | null;
}

async function get(path: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await (fetchOverride ?? fetch)(`${API}${path}`, {
      method: 'GET',
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'repos-feedback-triage',
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function lookupBranch(branch: string): Promise<BranchState> {
  const res = await get(`/repos/${repoSlug()}/git/ref/heads/${encodeURIComponent(branch)}`);
  if (res.status === 404) return { exists: false, headSha: null };
  if (!res.ok) throw new Error(`github branch lookup failed: ${res.status}`);
  const body = (await res.json()) as { object?: { sha?: string } };
  return { exists: true, headSha: body.object?.sha ?? null };
}

export async function lookupPrForBranch(branch: string): Promise<PrState | null> {
  const [owner] = repoSlug().split('/');
  const res = await get(
    `/repos/${repoSlug()}/pulls?state=all&head=${encodeURIComponent(`${owner}:${branch}`)}&per_page=10`,
  );
  if (!res.ok) throw new Error(`github pr lookup failed: ${res.status}`);
  const body = (await res.json()) as Array<{
    number: number;
    state: string;
    merged_at: string | null;
    merge_commit_sha: string | null;
    base?: { ref?: string } | null;
  }>;
  if (!Array.isArray(body) || body.length === 0) return null;

  // Only PRs targeting `main` count. openPr refuses to adopt any other base,
  // and a PR merged into some other branch is not on the path to production —
  // recording it as `merged` would leave the fix outside the observable set
  // and could tell a submitter their fix is live off a branch that never
  // reached the deployed image.
  const candidates = body.filter((p) => p.base?.ref === 'main');
  if (candidates.length === 0) return null;

  // Prefer a merged PR, then an open one, then the most recent closed one.
  const merged = candidates.find((p) => p.merged_at !== null);
  const open = candidates.find((p) => p.state === 'open');
  const chosen = merged ?? open ?? candidates[0];
  return {
    number: chosen.number,
    state: chosen.state === 'open' ? 'open' : 'closed',
    merged: chosen.merged_at !== null,
    mergeCommitSha: chosen.merge_commit_sha ?? null,
  };
}
