import 'dotenv/config';
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import pg from 'pg';
import { createEphemeralDb } from '../helpers/ephemeral-db.js';
import { runMigrations } from '../../src/db/runMigrations.js';

const eph = await createEphemeralDb('fb-reconcile');
{
  const bootstrap = new pg.Pool({ connectionString: eph.url, max: 4 });
  await runMigrations(bootstrap);
  await bootstrap.end();
}
process.env.DATABASE_URL = eph.url;

const { db } = await import('../../src/db/client.js');
const { triage } = await import('../../src/services/feedbackTriage.js');
const gh = await import('../../src/services/githubState.js');
const { reconcileFixes } = await import('../../src/services/reconcileFixes.js');

afterAll(async () => {
  await db.end();
  await eph.drop();
});

const HEAD = 'd'.repeat(40);
const MERGE = 'e'.repeat(40);

/** Route by URL so one stub serves both the branch and the PR lookup. */
function stub(routes: Record<string, { status: number; body: unknown }>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [needle, res] of Object.entries(routes)) {
      if (url.includes(needle)) {
        return new Response(JSON.stringify(res.body), {
          status: res.status,
          headers: { 'content-type': 'application/json' },
        });
      }
    }
    return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
  });
}

async function mkNeeded(): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO feedback (body, user_email_at_submit) VALUES ('broke','s@example.test') RETURNING id`,
  );
  await triage({ id: rows[0].id, category: 'bug', severity: 'p2', note: 'real' });
  return rows[0].id;
}

async function state(id: string) {
  const { rows } = await db.query(
    `SELECT fix_status, fix_branch, fix_pr_number, fix_commit_sha FROM feedback WHERE id=$1`,
    [id],
  );
  return rows[0];
}

beforeEach(async () => {
  await db.query('DELETE FROM feedback_emails');
  await db.query('DELETE FROM feedback');
});

afterEach(() => gh.__setGithubFetchForTesting(null));

describe('reconcileFixes', () => {
  it('promotes needed to patch_submitted when the branch exists with no PR', async () => {
    const id = await mkNeeded();
    gh.__setGithubFetchForTesting(
      stub({
        [`/git/ref/heads/feedback%2F${id}`]: { status: 200, body: { object: { sha: HEAD } } },
        '/pulls?': { status: 200, body: [] },
      }),
    );
    const res = await reconcileFixes();
    expect(res).toMatchObject({ examined: 1, changed: 1 });
    expect(await state(id)).toMatchObject({
      fix_status: 'patch_submitted',
      fix_branch: `feedback/${id}`,
    });
  });

  it('promotes to pr_open when an open PR exists', async () => {
    const id = await mkNeeded();
    gh.__setGithubFetchForTesting(
      stub({
        [`/git/ref/heads/feedback%2F${id}`]: { status: 200, body: { object: { sha: HEAD } } },
        '/pulls?': {
          status: 200,
          body: [{ number: 91, state: 'open', merged_at: null, merge_commit_sha: null }],
        },
      }),
    );
    await reconcileFixes();
    expect(await state(id)).toMatchObject({ fix_status: 'pr_open', fix_pr_number: 91 });
  });

  it('promotes to merged and records the merge commit SHA', async () => {
    const id = await mkNeeded();
    await db.query(`UPDATE feedback SET fix_status='pr_open', fix_pr_number=91 WHERE id=$1`, [id]);
    gh.__setGithubFetchForTesting(
      stub({
        [`/git/ref/heads/feedback%2F${id}`]: { status: 404, body: { message: 'Not Found' } },
        '/pulls?': {
          status: 200,
          body: [
            { number: 91, state: 'closed', merged_at: '2026-09-05T00:00:00Z', merge_commit_sha: MERGE },
          ],
        },
      }),
    );
    await reconcileFixes();
    expect(await state(id)).toMatchObject({ fix_status: 'merged', fix_commit_sha: MERGE });
  });

  it('does not demote merged back to needed when the branch is deleted', async () => {
    // Post-merge branch deletion is routine. A reconciler that demoted on it
    // would flip the row every sweep and could re-trigger work already done.
    const id = await mkNeeded();
    await db.query(
      `UPDATE feedback SET fix_status='merged', fix_commit_sha=$2, fix_pr_number=91 WHERE id=$1`,
      [id, MERGE],
    );
    gh.__setGithubFetchForTesting(stub({}));  // everything 404s
    const res = await reconcileFixes();
    expect(res.examined).toBe(0);
    expect(await state(id)).toMatchObject({ fix_status: 'merged', fix_commit_sha: MERGE });
  });

  it('demotes pr_open to needed when neither branch nor PR exists', async () => {
    // A closed-unmerged PR with the branch gone means the attempt was
    // abandoned. The row must become workable again.
    const id = await mkNeeded();
    await db.query(`UPDATE feedback SET fix_status='pr_open', fix_pr_number=91 WHERE id=$1`, [id]);
    gh.__setGithubFetchForTesting(
      stub({
        '/pulls?': {
          status: 200,
          body: [{ number: 91, state: 'closed', merged_at: null, merge_commit_sha: null }],
        },
      }),
    );
    await reconcileFixes();
    expect(await state(id)).toMatchObject({ fix_status: 'needed', fix_pr_number: null });
  });

  it('never touches a deferred row', async () => {
    const id = await mkNeeded();
    await db.query(`UPDATE feedback SET fix_status='deferred' WHERE id=$1`, [id]);
    gh.__setGithubFetchForTesting(
      stub({ [`/git/ref/heads/feedback%2F${id}`]: { status: 200, body: { object: { sha: HEAD } } } }),
    );
    const res = await reconcileFixes();
    expect(res.examined).toBe(0);
    expect(await state(id)).toMatchObject({ fix_status: 'deferred' });
  });

  it('never touches a duplicate', async () => {
    const canonical = await mkNeeded();
    const dup = await mkNeeded();
    await triage({ id: dup, category: 'bug', severity: 'p2', note: 'dup', dedupeOf: canonical });
    gh.__setGithubFetchForTesting(stub({ '/pulls?': { status: 200, body: [] } }));
    const res = await reconcileFixes();
    expect(res.examined).toBe(1);
    expect(await state(dup)).toMatchObject({ fix_status: 'n/a' });
  });

  it('leaves the row untouched when GitHub errors, and reports it', async () => {
    const id = await mkNeeded();
    gh.__setGithubFetchForTesting(
      vi.fn(async () => new Response('boom', { status: 503 })),
    );
    const res = await reconcileFixes();
    expect(res).toMatchObject({ examined: 1, changed: 0, errored: 1 });
    expect(await state(id)).toMatchObject({ fix_status: 'needed' });
  });

  it('one failing row does not abandon the others', async () => {
    const bad = await mkNeeded();
    const good = await mkNeeded();
    gh.__setGithubFetchForTesting(
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes(`feedback%2F${bad}`)) return new Response('boom', { status: 503 });
        if (url.includes('/pulls?')) {
          return new Response(
            JSON.stringify([{ number: 92, state: 'open', merged_at: null, merge_commit_sha: null }]),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response(JSON.stringify({ object: { sha: HEAD } }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }),
    );
    const res = await reconcileFixes();
    expect(res.errored).toBe(1);
    expect(await state(good)).toMatchObject({ fix_status: 'pr_open' });
  });

  it('sends no Authorization header — the repository is public', async () => {
    const id = await mkNeeded();
    const spy = vi.fn(async () => new Response('[]', {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    gh.__setGithubFetchForTesting(spy);
    await reconcileFixes();
    expect(spy.mock.calls.length).toBeGreaterThan(0);
    for (const call of spy.mock.calls) {
      // Headers can arrive either as a second RequestInit argument or baked
      // into a Request passed as the first argument — check whichever shape
      // was actually used so a future switch to `fetch(new Request(...))`
      // can't carry an Authorization header past this assertion unnoticed.
      const [input, init] = call as [RequestInfo | URL, RequestInit | undefined];
      const headers =
        input instanceof Request ? input.headers : new Headers(init?.headers ?? {});
      expect(headers.get('authorization')).toBeNull();
    }
    expect(await state(id)).toBeTruthy();
  });

  it('prefers a merged PR over an open PR even when open is listed first', async () => {
    // `/pulls?state=all&head=...` can return both once a bad-SHA merge left a
    // row stuck in pr_open and a second attempt opened a fresh PR against the
    // same derived branch. Naive `body.find(p => p.state === 'open')` would
    // pick the open one first and silently drop the never-resolved merge.
    const id = await mkNeeded();
    await db.query(`UPDATE feedback SET fix_status='pr_open', fix_pr_number=91 WHERE id=$1`, [id]);
    gh.__setGithubFetchForTesting(
      stub({
        [`/git/ref/heads/feedback%2F${id}`]: { status: 200, body: { object: { sha: HEAD } } },
        '/pulls?': {
          status: 200,
          body: [
            { number: 92, state: 'open', merged_at: null, merge_commit_sha: null },
            { number: 91, state: 'closed', merged_at: '2026-09-05T00:00:00Z', merge_commit_sha: MERGE },
          ],
        },
      }),
    );
    await reconcileFixes();
    expect(await state(id)).toMatchObject({
      fix_status: 'merged',
      fix_pr_number: 91,
      fix_commit_sha: MERGE,
    });
  });

  it('prefers an open PR over a closed-unmerged PR even when open is listed second', async () => {
    const id = await mkNeeded();
    gh.__setGithubFetchForTesting(
      stub({
        [`/git/ref/heads/feedback%2F${id}`]: { status: 200, body: { object: { sha: HEAD } } },
        '/pulls?': {
          status: 200,
          body: [
            { number: 90, state: 'closed', merged_at: null, merge_commit_sha: null },
            { number: 93, state: 'open', merged_at: null, merge_commit_sha: null },
          ],
        },
      }),
    );
    await reconcileFixes();
    expect(await state(id)).toMatchObject({ fix_status: 'pr_open', fix_pr_number: 93 });
  });

  it('falls back deterministically when only closed-unmerged PRs exist, and demotes to needed', async () => {
    const id = await mkNeeded();
    await db.query(`UPDATE feedback SET fix_status='pr_open', fix_pr_number=91 WHERE id=$1`, [id]);
    gh.__setGithubFetchForTesting(
      stub({
        [`/git/ref/heads/feedback%2F${id}`]: { status: 404, body: { message: 'Not Found' } },
        '/pulls?': {
          status: 200,
          body: [
            { number: 88, state: 'closed', merged_at: null, merge_commit_sha: null },
            { number: 91, state: 'closed', merged_at: null, merge_commit_sha: null },
          ],
        },
      }),
    );
    await reconcileFixes();
    expect(await state(id)).toMatchObject({ fix_status: 'needed', fix_pr_number: null });
  });

  it('rejects a merge_commit_sha that is not 40-hex rather than storing it', async () => {
    const id = await mkNeeded();
    await db.query(`UPDATE feedback SET fix_status='pr_open', fix_pr_number=91 WHERE id=$1`, [id]);
    gh.__setGithubFetchForTesting(
      stub({
        '/pulls?': {
          status: 200,
          body: [{ number: 91, state: 'closed', merged_at: '2026-09-05T00:00:00Z',
                   merge_commit_sha: 'NOTASHA' }],
        },
      }),
    );
    const res = await reconcileFixes();
    expect(res.errored).toBe(1);
    expect(await state(id)).toMatchObject({ fix_status: 'pr_open', fix_commit_sha: null });
  });
});
