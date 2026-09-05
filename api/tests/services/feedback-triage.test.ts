import 'dotenv/config';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import pg from 'pg';
import { createEphemeralDb } from '../helpers/ephemeral-db.js';
import { runMigrations } from '../../src/db/runMigrations.js';

const eph = await createEphemeralDb('fb-triage');
{
  const bootstrap = new pg.Pool({ connectionString: eph.url, max: 4 });
  await runMigrations(bootstrap);
  await bootstrap.end();
}
process.env.DATABASE_URL = eph.url;

const { db } = await import('../../src/db/client.js');
const { triage, defer, TriageError } = await import('../../src/services/feedbackTriage.js');

afterAll(async () => {
  await db.end();
  await eph.drop();
});

async function mkFeedback(body = 'it broke'): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO feedback (body, user_email_at_submit) VALUES ($1,'sub@example.test') RETURNING id`,
    [body],
  );
  return rows[0].id;
}

async function row(id: string) {
  const { rows } = await db.query(`SELECT * FROM feedback WHERE id=$1`, [id]);
  return rows[0];
}

beforeEach(async () => {
  await db.query('DELETE FROM feedback_emails');
  await db.query('DELETE FROM feedback');
});

describe('triage', () => {
  it('classifies a bug, sets triaged_at, and puts it in the fix queue', async () => {
    const id = await mkFeedback();
    await triage({ id, category: 'bug', severity: 'p2', note: 'reproduced' });
    const r = await row(id);
    expect(r.category).toBe('bug');
    expect(r.severity).toBe('p2');
    expect(r.triage_note).toBe('reproduced');
    expect(r.triaged_at).not.toBeNull();
    expect(r.fix_status).toBe('needed');
  });

  it('leaves noise out of the fix queue and refuses a severity for it', async () => {
    const id = await mkFeedback('yo dawg');
    await triage({ id, category: 'noise', note: 'conversational' });
    expect((await row(id)).fix_status).toBe('n/a');

    const other = await mkFeedback('yo dawg again');
    await expect(
      triage({ id: other, category: 'noise', severity: 'p3', note: 'x' }),
    ).rejects.toMatchObject({ code: 'severity_not_allowed' });
  });

  it('requires a severity for bug, ux and feature', async () => {
    const id = await mkFeedback();
    await expect(triage({ id, category: 'bug', note: 'x' })).rejects.toMatchObject({
      code: 'severity_required',
    });
  });

  it('requires a non-empty note', async () => {
    const id = await mkFeedback();
    await expect(triage({ id, category: 'question', note: '   ' })).rejects.toMatchObject({
      code: 'note_required',
    });
  });

  it('is idempotent-by-overwrite: re-running replaces the classification', async () => {
    const id = await mkFeedback();
    await triage({ id, category: 'bug', severity: 'p1', note: 'first' });
    const firstTriagedAt = (await row(id)).triaged_at;
    await triage({ id, category: 'ux', severity: 'p3', note: 'second' });
    const r = await row(id);
    expect(r.category).toBe('ux');
    expect(r.severity).toBe('p3');
    // triaged_at is a "somebody looked" stamp; it does not move on re-triage.
    expect(r.triaged_at).toEqual(firstTriagedAt);
  });

  it('404s on an unknown id', async () => {
    await expect(
      triage({ id: '999999', category: 'bug', severity: 'p2', note: 'x' }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('triage with dedupe_of', () => {
  it('marks a duplicate n/a so it never enters the fix queue', async () => {
    const canonical = await mkFeedback('programs page broken on mobile');
    const dup = await mkFeedback('programs page looks wrong on my phone');
    await triage({ id: canonical, category: 'bug', severity: 'p2', note: 'canonical' });
    await triage({
      id: dup,
      category: 'bug',
      severity: 'p2',
      note: 'same thing',
      dedupeOf: canonical,
    });

    const r = await row(dup);
    expect(r.dedupe_of).toBe(canonical);
    // A duplicate's canonical row owns the fix. Two rows describing one bug
    // would otherwise each get a worktree, a patch and a pull request.
    expect(r.fix_status).toBe('n/a');
    expect((await row(canonical)).fix_status).toBe('needed');
  });

  it('drops an already-needed row to n/a when it is later found to be a duplicate', async () => {
    const canonical = await mkFeedback('a');
    const dup = await mkFeedback('b');
    await triage({ id: canonical, category: 'bug', severity: 'p2', note: 'canonical' });
    await triage({ id: dup, category: 'bug', severity: 'p2', note: 'looked new' });
    expect((await row(dup)).fix_status).toBe('needed');

    await triage({
      id: dup,
      category: 'bug',
      severity: 'p2',
      note: 'dup after all',
      dedupeOf: canonical,
    });
    expect((await row(dup)).fix_status).toBe('n/a');
  });

  it('rejects a self-reference', async () => {
    const id = await mkFeedback();
    await expect(
      triage({ id, category: 'bug', severity: 'p2', note: 'x', dedupeOf: id }),
    ).rejects.toMatchObject({ code: 'dedupe_self' });
  });

  it('rejects pointing at a row that is itself a duplicate (no chains)', async () => {
    const a = await mkFeedback('a');
    const b = await mkFeedback('b');
    const c = await mkFeedback('c');
    await triage({ id: a, category: 'bug', severity: 'p2', note: 'canonical' });
    await triage({ id: b, category: 'bug', severity: 'p2', note: 'dup', dedupeOf: a });
    await expect(
      triage({ id: c, category: 'bug', severity: 'p2', note: 'chain', dedupeOf: b }),
    ).rejects.toMatchObject({ code: 'dedupe_not_canonical' });
  });

  it('rejects making a row a duplicate while other rows point at it', async () => {
    const a = await mkFeedback('a');
    const b = await mkFeedback('b');
    const c = await mkFeedback('c');
    await triage({ id: a, category: 'bug', severity: 'p2', note: 'canonical' });
    await triage({ id: b, category: 'bug', severity: 'p2', note: 'dup', dedupeOf: a });
    await triage({ id: c, category: 'bug', severity: 'p2', note: 'canonical too' });
    // `a` has a dependant, so it cannot become a duplicate itself.
    await expect(
      triage({ id: a, category: 'bug', severity: 'p2', note: 'oops', dedupeOf: c }),
    ).rejects.toMatchObject({ code: 'dedupe_has_dependants' });
  });

  it('rejects an unknown canonical id', async () => {
    const id = await mkFeedback();
    await expect(
      triage({ id, category: 'bug', severity: 'p2', note: 'x', dedupeOf: '999999' }),
    ).rejects.toMatchObject({ code: 'dedupe_target_not_found' });
  });
});

describe('defer', () => {
  it('is terminal and records the reason', async () => {
    const id = await mkFeedback('please add dark mode for my toaster');
    await triage({ id, category: 'feature', severity: 'p3', note: 'a feature request' });
    await defer(id, 'out of scope for beta');
    const r = await row(id);
    expect(r.fix_status).toBe('deferred');
    expect(r.triage_note).toContain('out of scope for beta');
  });

  it('requires a reason', async () => {
    const id = await mkFeedback();
    await triage({ id, category: 'bug', severity: 'p3', note: 'x' });
    await expect(defer(id, '  ')).rejects.toMatchObject({ code: 'reason_required' });
  });

  it('refuses to defer an unclassified row', async () => {
    const id = await mkFeedback();
    await expect(defer(id, 'nope')).rejects.toMatchObject({ code: 'not_classified' });
  });
});
