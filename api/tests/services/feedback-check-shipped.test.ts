import 'dotenv/config';
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import pg from 'pg';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createEphemeralDb } from '../helpers/ephemeral-db.js';
import { runMigrations } from '../../src/db/runMigrations.js';

const eph = await createEphemeralDb('fb-shipped');
{
  const bootstrap = new pg.Pool({ connectionString: eph.url, max: 4 });
  await runMigrations(bootstrap);
  await bootstrap.end();
}
process.env.DATABASE_URL = eph.url;
process.env.FEEDBACK_FROM_EMAIL = 'feedback@send.jpmtech.com';
process.env.RESEND_API_KEY = 'test-key';
// readDeployedRev refuses to run at all without a configured host, before it
// ever reaches the (overridden) runner.
process.env.UNRAID_SSH_HOST = 'unraid.test';

const { db } = await import('../../src/db/client.js');
const { triage } = await import('../../src/services/feedbackTriage.js');
const { link } = await import('../../src/services/fixLifecycle.js');
const mailer = await import('../../src/services/feedbackMailer.js');
const deployed = await import('../../src/services/deployedRev.js');
const { checkShipped, isAncestor, __setAncestryForTesting } =
  await import('../../src/services/checkShipped.js');

// A real repository, because the ancestry rules are the thing under test and a
// stub would only assert that the stub was called.
const repo = await mkdtemp(join(tmpdir(), 'fb-shipped-repo-'));
// Every git invocation ignores hooks and system/global config, so whatever is
// on this machine (or CI runner) cannot influence the ancestry answer or run
// arbitrary code on our behalf.
const git = (...args: string[]) =>
  execFileSync('git', ['-C', repo, '-c', 'core.hooksPath=/dev/null', ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
    },
  }).trim();

git('init', '-q', '-b', 'main');
git('config', 'user.email', 'test@example.test');
git('config', 'user.name', 'Test');
git('commit', '-q', '--allow-empty', '-m', 'base');
const OLD = git('rev-parse', 'HEAD');
git('commit', '-q', '--allow-empty', '-m', 'the fix');
const FIX = git('rev-parse', 'HEAD');
git('commit', '-q', '--allow-empty', '-m', 'deployed');
const DEPLOYED = git('rev-parse', 'HEAD');
git('checkout', '-q', '-b', 'side', OLD);
git('commit', '-q', '--allow-empty', '-m', 'never merged');
const SIDE = git('rev-parse', 'HEAD');

afterAll(async () => {
  await db.end();
  await eph.drop();
  await rm(repo, { recursive: true, force: true });
});

const ok = () => vi.fn(async () => new Response(JSON.stringify({ id: 'm1' }), { status: 200 }));

// readDeployedRev requires line 0 to be exactly the container's
// `.State.Running` value ('true') and a later `APP_SHA=<40hex>` line — a bare
// SHA is no longer accepted and throws DeployedRevError('unreadable').
const runnerFor = (sha: string) => async () => `true\nAPP_SHA=${sha}\n`;

async function mkFixed(sha: string, email: string | null = 'sub@example.test'): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO feedback (body, user_email_at_submit) VALUES ('broke',$1) RETURNING id`,
    [email],
  );
  await triage({ id: rows[0].id, category: 'bug', severity: 'p2', note: 'real' });
  await link(rows[0].id, sha);
  return rows[0].id;
}

beforeEach(async () => {
  await db.query('DELETE FROM feedback_emails');
  await db.query('DELETE FROM feedback');
  mailer.__setMailFetchForTesting(null);
  __setAncestryForTesting(null);
  deployed.__setDeployedRevRunnerForTesting(runnerFor(DEPLOYED));
});

describe('isAncestor', () => {
  it('is true for an ancestor and false for a sibling', async () => {
    expect(await isAncestor(FIX, DEPLOYED, repo)).toBe(true);
    expect(await isAncestor(SIDE, DEPLOYED, repo)).toBe(false);
  });

  it('is true for the deployed commit itself', async () => {
    expect(await isAncestor(DEPLOYED, DEPLOYED, repo)).toBe(true);
  });

  it('is false for a descendant — direction matters', async () => {
    expect(await isAncestor(DEPLOYED, FIX, repo)).toBe(false);
  });

  it('throws on an unknown object rather than answering false', async () => {
    // Non-zero exit means BOTH "not an ancestor" and "no such object".
    // Collapsing them would hide a broken clone forever.
    await expect(isAncestor('0'.repeat(40), DEPLOYED, repo)).rejects.toThrow(/unknown object/i);
  });

  it('refuses a malformed SHA without invoking git', async () => {
    await expect(isAncestor('not-a-sha', DEPLOYED, repo)).rejects.toThrow(/40-hex/);
  });
});

describe('checkShipped', () => {
  it('uses the configured clone rather than the process working directory', async () => {
    await mkFixed(FIX);
    expect(process.cwd()).not.toBe(repo);
    const res = await checkShipped({ repoDir: repo, dryRun: true });
    expect(res).toMatchObject({ considered: 1, shipped: 1, skipped: 0, diagnostics: [] });
  });

  it('returns sanitized diagnostics for unverifiable ancestry', async () => {
    const id = await mkFixed(FIX);
    __setAncestryForTesting(async () => {
      throw new Error('private-reporter@example.test secret');
    });
    const res = await checkShipped({ repoDir: repo, dryRun: true });
    expect(res.diagnostics).toEqual([{ feedbackId: id, stage: 'ancestry', code: 'unverifiable' }]);
    expect(JSON.stringify(res)).not.toContain('private-reporter');
    expect(res.skipped).toBe(1);
  });

  it('emails the submitter when the fix is an ancestor of the deployed SHA', async () => {
    const fetchMock = ok();
    mailer.__setMailFetchForTesting(fetchMock);
    __setAncestryForTesting(async (a, d) => isAncestor(a, d, repo));
    const id = await mkFixed(FIX);

    const res = await checkShipped();
    expect(res).toMatchObject({ deployedSha: DEPLOYED, considered: 1, shipped: 1, emailed: 1 });

    const { rows } = await db.query(
      `SELECT kind, sent_at FROM feedback_emails WHERE feedback_id=$1`,
      [id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('resolved');
    expect(rows[0].sent_at).not.toBeNull();
  });

  it('does not email when the fix is not deployed', async () => {
    const fetchMock = ok();
    mailer.__setMailFetchForTesting(fetchMock);
    __setAncestryForTesting(async (a, d) => isAncestor(a, d, repo));
    await mkFixed(SIDE);

    const res = await checkShipped();
    expect(res).toMatchObject({ shipped: 0, emailed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('emails a duplicate submitter using the canonical row SHA', async () => {
    mailer.__setMailFetchForTesting(ok());
    __setAncestryForTesting(async (a, d) => isAncestor(a, d, repo));
    const canonical = await mkFixed(FIX);
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO feedback (body, user_email_at_submit) VALUES ('same','dup@example.test') RETURNING id`,
    );
    await triage({
      id: rows[0].id,
      category: 'bug',
      severity: 'p2',
      note: 'dup',
      dedupeOf: canonical,
    });

    const res = await checkShipped();
    expect(res.emailed).toBe(2);
    const { rows: sent } = await db.query(
      `SELECT feedback_id FROM feedback_emails WHERE kind='resolved' ORDER BY feedback_id`,
    );
    expect(sent.map((r) => r.feedback_id).sort()).toEqual([canonical, rows[0].id].sort());
  });

  it('no-ops entirely when the deployed SHA is unreadable', async () => {
    const fetchMock = ok();
    mailer.__setMailFetchForTesting(fetchMock);
    __setAncestryForTesting(async () => true);
    await mkFixed(FIX);
    deployed.__setDeployedRevRunnerForTesting(async () => {
      throw new Error('No route to host');
    });

    const res = await checkShipped();
    expect(res).toMatchObject({ deployedSha: null, considered: 0, shipped: 0, emailed: 0 });
    expect(res.diagnostics).toEqual([{ stage: 'deployment', code: 'unreadable' }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips a row whose object is unknown and still processes the rest', async () => {
    // One broken row must not abandon the sweep.
    mailer.__setMailFetchForTesting(ok());
    __setAncestryForTesting(async (a, d) => isAncestor(a, d, repo));
    await mkFixed('0'.repeat(40), 'ghost@example.test');
    const good = await mkFixed(FIX);

    const res = await checkShipped();
    expect(res.skipped).toBe(1);
    expect(res.emailed).toBe(1);
    const { rows } = await db.query(
      `SELECT feedback_id FROM feedback_emails WHERE kind='resolved'`,
    );
    expect(rows.map((r) => r.feedback_id)).toEqual([good]);
  });

  it('dryRun reports what would be sent and sends nothing', async () => {
    const fetchMock = ok();
    mailer.__setMailFetchForTesting(fetchMock);
    __setAncestryForTesting(async (a, d) => isAncestor(a, d, repo));
    await mkFixed(FIX);

    const res = await checkShipped({ dryRun: true });
    expect(res).toMatchObject({ shipped: 1, emailed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    const { rows } = await db.query(`SELECT 1 FROM feedback_emails`);
    expect(rows).toHaveLength(0);
  });

  it('is idempotent — a second run emails nobody twice', async () => {
    const fetchMock = ok();
    mailer.__setMailFetchForTesting(fetchMock);
    __setAncestryForTesting(async (a, d) => isAncestor(a, d, repo));
    await mkFixed(FIX);

    await checkShipped();
    const second = await checkShipped();
    expect(second.emailed).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not abort the sweep when one send fails', async () => {
    __setAncestryForTesting(async (a, d) => isAncestor(a, d, repo));
    await mkFixed(FIX, 'a@example.test');
    await mkFixed(FIX, 'b@example.test');
    let n = 0;
    mailer.__setMailFetchForTesting(
      vi.fn(async () => {
        n += 1;
        return n === 1
          ? new Response('nope', { status: 500 })
          : new Response(JSON.stringify({ id: 'm2' }), { status: 200 });
      }),
    );
    const res = await checkShipped();
    expect(res.emailed).toBe(1);
    expect(res.skipped).toBe(1);
    expect(res.diagnostics).toEqual([
      { feedbackId: expect.any(String), stage: 'email', code: 'failed' },
    ]);
  });

  it('does not abort the sweep when a send throws — the catch is defended, not deleted', async () => {
    // Mutation check: deleting the body of checkShipped's catch block (which
    // wraps sendResolvedEmail) leaves all other tests green, because none of
    // them make sendResolvedEmail actually THROW — only return `failed`. This
    // test forces a genuine thrown exception (EmailGateError('not_found'))
    // by deleting the feedback row out from under the send, mid-sweep, the
    // same race-simulation technique the "already-sent" test below uses.
    // Rows are processed in listResolvable's created_at order, so the first
    // ancestry() call is for `broken`.
    const broken = await mkFixed(FIX, 'broken@example.test');
    const good = await mkFixed(FIX, 'good@example.test');
    let calls = 0;
    __setAncestryForTesting(async (a, d) => {
      calls += 1;
      if (calls === 1) {
        await db.query(`DELETE FROM feedback WHERE id=$1`, [broken]);
      }
      return isAncestor(a, d, repo);
    });
    mailer.__setMailFetchForTesting(ok());

    const res = await checkShipped();

    expect(res.emailed).toBe(1);
    expect(res.skipped).toBe(1);
    // The gate's own code is recorded, not a flat 'send_refused': the codes
    // are non-secret enum strings and are the only signal saying WHICH gate
    // refused. The message is never recorded — it can quote row content.
    expect(res.diagnostics).toEqual([{ feedbackId: broken, stage: 'email', code: 'not_found' }]);
    const { rows } = await db.query(
      `SELECT feedback_id FROM feedback_emails WHERE kind='resolved'`,
    );
    expect(rows.map((r) => r.feedback_id)).toEqual([good]);
  });

  it('records send_refused for a throw that is not an EmailGateError', async () => {
    // Every gate passes; the failure comes from the mailer (fromAddress()
    // throws MailerError when FEEDBACK_FROM_EMAIL is unset), which carries no
    // gate code. That case must still be reported, generically.
    const id = await mkFixed(FIX);
    __setAncestryForTesting(async (a, d) => {
      vi.stubEnv('FEEDBACK_FROM_EMAIL', '');
      return isAncestor(a, d, repo);
    });
    const fetchMock = ok();
    mailer.__setMailFetchForTesting(fetchMock);

    let res;
    try {
      res = await checkShipped();
    } finally {
      vi.unstubAllEnvs();
    }

    expect(res.skipped).toBe(1);
    expect(res.emailed).toBe(0);
    expect(res.diagnostics).toEqual([{ feedbackId: id, stage: 'email', code: 'send_refused' }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never considers a row the resolved-email gate would refuse', async () => {
    // A row linked before triage is exactly the shape that made check-shipped
    // fail on every run: selected here, refused by the gate, exit 1 forever.
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO feedback (body, user_email_at_submit)
       VALUES ('linked before triage','sub@example.test') RETURNING id`,
    );
    await link(rows[0].id, FIX);
    __setAncestryForTesting(async (a, d) => isAncestor(a, d, repo));
    const fetchMock = ok();
    mailer.__setMailFetchForTesting(fetchMock);

    const first = await checkShipped();
    const second = await checkShipped();
    expect(first).toMatchObject({ considered: 0, skipped: 0, diagnostics: [] });
    expect(second).toMatchObject({ considered: 0, skipped: 0, diagnostics: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats an already-sent notice as a successful no-op, not a skip', async () => {
    // listResolvable only excludes a row once a `resolved` feedback_emails
    // row exists, so the only way this row is still selected AND already
    // sent is a genuine overlapping sweep: another process wins the race and
    // inserts+sends between our listResolvable() read and our
    // sendResolvedEmail() call. The ancestry seam runs in exactly that
    // window, so it stands in for the other process here.
    const id = await mkFixed(FIX);
    __setAncestryForTesting(async (a, d) => {
      await db.query(
        `INSERT INTO feedback_emails (feedback_id, kind, request, idempotency_key, sent_at, message_id)
         VALUES ($1, 'resolved', '{}', 'already-sent-test', now(), 'earlier-run')`,
        [id],
      );
      return isAncestor(a, d, repo);
    });
    const fetchMock = ok();
    mailer.__setMailFetchForTesting(fetchMock);

    const res = await checkShipped();
    expect(res.shipped).toBe(1);
    expect(res.skipped).toBe(0);
    expect(res.emailed).toBe(0);
    expect(res.diagnostics).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('re-triage cannot undo a shipped decision', () => {
  it('preserves merged across a re-triage', async () => {
    // Ruling 5 from Plan 1: `decided` fix_status values survive re-triage.
    const id = await mkFixed(FIX);
    await triage({ id, category: 'ux', severity: 'p3', note: 'reclassified' });
    const { rows } = await db.query(`SELECT fix_status FROM feedback WHERE id=$1`, [id]);
    expect(rows[0].fix_status).toBe('merged');
  });
});
