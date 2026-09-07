import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openPr, __setPrFetchForTesting } from '../../src/reposGit/openPr.js';

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const pr = (number: number, state = 'open', merged_at: string | null = null) => ({
  number,
  state,
  merged_at,
  head: { ref: 'feedback/5', repo: { full_name: 'otahesh/RepOS' } },
  base: { ref: 'main', repo: { full_name: 'otahesh/RepOS' } },
});
beforeEach(() => {
  vi.stubEnv('FEEDBACK_GITHUB_TOKEN', 'ghp_test');
  vi.stubEnv('FEEDBACK_GITHUB_REPO', 'otahesh/RepOS');
});
afterEach(() => {
  __setPrFetchForTesting(null);
  vi.unstubAllEnvs();
});

describe('openPr', () => {
  it('discovers first, then creates derived private-data-free metadata against main', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response({ number: 93, html_url: 'https://untrusted.invalid/' }, 201));
    __setPrFetchForTesting(fetcher);
    expect(
      await openPr({
        feedbackId: '5',
        title: 'reporter private',
        body: 'private body',
        baseBranch: 'production',
      }),
    ).toEqual({ number: 93, url: 'https://github.com/otahesh/RepOS/pull/93' });
    expect(fetcher.mock.calls[0][1]?.method).toBe('GET');
    const [url, options] = fetcher.mock.calls[1];
    expect(url).toBe('https://api.github.com/repos/otahesh/RepOS/pulls');
    expect(JSON.parse(String(options?.body))).toEqual({
      title: 'fix: feedback 5',
      body: 'Addresses feedback 5.',
      head: 'feedback/5',
      base: 'main',
    });
    expect(new Headers(options?.headers).get('authorization')).toBe('Bearer ghp_test');
    expect(options?.redirect).toBe('error');
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ['open', null],
    ['closed', '2026-09-06T00:00:00Z'],
  ])('returns an existing %s PR without another POST', async (state, merged) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response([pr(21, state!, merged)]));
    __setPrFetchForTesting(fetcher);
    expect((await openPr({ feedbackId: '5' })).number).toBe(21);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]?.method).toBe('GET');
  });

  it('prefers merged over open when both have the same head', async () => {
    __setPrFetchForTesting(
      vi.fn<typeof fetch>().mockResolvedValue(response([pr(22), pr(21, 'closed', '2026-09-06')])),
    );
    expect((await openPr({ feedbackId: '5' })).number).toBe(21);
  });

  it('does not silently reopen or duplicate a closed unmerged PR', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response([pr(21, 'closed')]));
    __setPrFetchForTesting(fetcher);
    await expect(openPr({ feedbackId: '5' })).rejects.toMatchObject({ code: 'pr_closed' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(['duplicate race', 'lost response'])(
    'reconciles %s after creating exactly once',
    async (kind) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response([]));
      if (kind === 'duplicate race') fetcher.mockResolvedValueOnce(response({}, 422));
      else fetcher.mockRejectedValueOnce(new Error('ghp_test transport secret'));
      fetcher.mockResolvedValueOnce(response([pr(93)]));
      __setPrFetchForTesting(fetcher);
      expect((await openPr({ feedbackId: '5' })).number).toBe(93);
      expect(fetcher.mock.calls.map((call) => call[1]?.method)).toEqual(['GET', 'POST', 'GET']);
    },
  );

  it('validates response identity instead of accepting another repository or branch', async () => {
    const wrong = pr(20);
    wrong.head.repo.full_name = 'someone/fork';
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response([wrong]))
      .mockResolvedValueOnce(response({ number: 93 }, 201));
    __setPrFetchForTesting(fetcher);
    expect((await openPr({ feedbackId: '5' })).number).toBe(93);
  });

  it('paginates discovery before deciding there is no PR', async () => {
    const others = Array.from({ length: 100 }, (_, i) => ({
      ...pr(i + 1),
      head: { ref: 'other', repo: { full_name: 'otahesh/RepOS' } },
    }));
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(others))
      .mockResolvedValueOnce(response([pr(120)]));
    __setPrFetchForTesting(fetcher);
    expect((await openPr({ feedbackId: '5' })).number).toBe(120);
    expect(String(fetcher.mock.calls[1][0])).toContain('page=2');
    expect(fetcher.mock.calls.every((call) => call[1]?.method === 'GET')).toBe(true);
  });

  it('refuses bad ids or trusted repository/token configuration before HTTP', async () => {
    const fetcher = vi.fn<typeof fetch>();
    __setPrFetchForTesting(fetcher);
    await expect(openPr({ feedbackId: '../main' })).rejects.toMatchObject({
      code: 'bad_feedback_id',
    });
    vi.stubEnv('FEEDBACK_GITHUB_REPO', 'owner/repo/../../evil');
    await expect(openPr({ feedbackId: '5' })).rejects.toMatchObject({ code: 'not_configured' });
    vi.stubEnv('FEEDBACK_GITHUB_REPO', 'owner/repo');
    vi.stubEnv('FEEDBACK_GITHUB_TOKEN', '');
    await expect(openPr({ feedbackId: '5' })).rejects.toMatchObject({ code: 'not_configured' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('fails closed on discovery failures, malformed or oversized responses', async () => {
    for (const body of [
      response({}, 500),
      response({ unexpected: true }),
      response([{ number: 3 }]),
      response('x'.repeat(1024 * 1024)),
    ]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(body);
      __setPrFetchForTesting(fetcher);
      await expect(openPr({ feedbackId: '5' })).rejects.toMatchObject({ code: 'pr_failed' });
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });

  it('does not echo secrets in HTTP or transport error bodies', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response({ message: 'ghp_test' }, 403))
      .mockResolvedValueOnce(response([]));
    __setPrFetchForTesting(fetcher);
    const error = await openPr({ feedbackId: '5' }).catch((err: unknown) => err);
    expect(error).toMatchObject({ code: 'pr_failed' });
    expect(String(error)).not.toContain('ghp_test');
  });
});
