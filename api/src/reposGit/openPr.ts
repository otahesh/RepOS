import { feedbackBranch, githubRepo, githubToken } from './config.js';
import { RepoGitError } from './errors.js';

let fetchOverride: typeof fetch | null = null;
export function __setPrFetchForTesting(f: typeof fetch | null): void {
  fetchOverride = f;
}
export interface OpenPrInput {
  feedbackId: string;
  /** Compatibility only. Public metadata is derived from the feedback id. */
  title?: string;
  body?: string;
  baseBranch?: string;
}
interface PullRequest {
  number: number;
  state: 'open' | 'closed';
  merged_at: string | null;
  head: { ref: string; repo: { full_name: string } | null };
  base: { ref: string; repo: { full_name: string } };
}

export async function openPr(input: OpenPrInput): Promise<{ number: number; url: string }> {
  const branch = feedbackBranch(input.feedbackId);
  const repo = githubRepo();
  const token = githubToken();
  const endpoint = `https://api.github.com/repos/${repo}/pulls`;
  const headers = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'repos-feedback-triage',
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };
  const request = async (
    url: string,
    body?: object,
  ): Promise<{ status: number; value: unknown }> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await (fetchOverride ?? fetch)(url, {
        method: body === undefined ? 'GET' : 'POST',
        headers,
        redirect: 'error',
        signal: controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      // Bound both the response bytes and the time spent consuming its body.
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      if (reader) {
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            bytes += part.value.length;
            if (bytes > 1024 * 1024) {
              controller.abort();
              throw new Error('response too large');
            }
            chunks.push(part.value);
          }
        } finally {
          await reader.cancel().catch(() => {});
        }
      }
      // Error bodies may echo secrets or remote text; do not expose them.
      return {
        status: response.status,
        value: response.ok ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null,
      };
    } catch {
      throw new RepoGitError('pr_failed', 'GitHub request failed');
    } finally {
      clearTimeout(timer);
    }
  };
  const result = (number: number) => ({ number, url: `https://github.com/${repo}/pull/${number}` });
  const discover = async (): Promise<ReturnType<typeof result> | null> => {
    const found: PullRequest[] = [];
    for (let page = 1; page <= 10; page++) {
      const query = new URLSearchParams({
        state: 'all',
        head: `${repo.split('/')[0]}:${branch}`,
        base: 'main',
        per_page: '100',
        page: String(page),
      });
      const response = await request(`${endpoint}?${query}`);
      if (response.status !== 200 || !Array.isArray(response.value)) {
        throw new RepoGitError('pr_failed', 'could not discover existing pull requests');
      }
      for (const item of response.value) {
        const pr = item as Partial<PullRequest> | null;
        if (
          !pr ||
          !Number.isSafeInteger(pr.number) ||
          Number(pr.number) <= 0 ||
          !['open', 'closed'].includes(pr.state ?? '') ||
          !(pr.merged_at === null || typeof pr.merged_at === 'string') ||
          typeof pr.head?.ref !== 'string' ||
          typeof pr.base?.ref !== 'string'
        ) {
          throw new RepoGitError('pr_failed', 'unexpected pull request response');
        }
        if (
          pr.head.ref === branch &&
          pr.base.ref === 'main' &&
          pr.head.repo?.full_name.toLowerCase() === repo.toLowerCase() &&
          pr.base.repo?.full_name.toLowerCase() === repo.toLowerCase()
        )
          found.push(pr as PullRequest);
      }
      if (response.value.length < 100) {
        const merged = found.find((pr) => pr.merged_at !== null);
        const open = found.find((pr) => pr.state === 'open');
        if (merged || open) return result((merged ?? open)!.number);
        if (found.length)
          throw new RepoGitError(
            'pr_closed',
            'feedback pull request was closed; operator action required',
          );
        return null;
      }
    }
    throw new RepoGitError('pr_failed', 'pull request discovery exceeded its page limit');
  };
  const existing = await discover();
  if (existing) return existing;
  try {
    const response = await request(endpoint, {
      title: `fix: feedback ${input.feedbackId}`,
      body: `Addresses feedback ${input.feedbackId}.`,
      head: branch,
      base: 'main',
    });
    const value = response.value as { number?: unknown } | null;
    if (
      response.status === 201 &&
      Number.isSafeInteger(value?.number) &&
      Number(value?.number) > 0
    ) {
      return result(Number(value!.number));
    }
  } catch {
    // A lost POST response is ambiguous. Observe the remote again, just as
    // for a concurrent create returning 422; never issue a second POST here.
  }
  const raced = await discover();
  if (raced) return raced;
  throw new RepoGitError('pr_failed', 'GitHub did not create the feedback pull request');
}
