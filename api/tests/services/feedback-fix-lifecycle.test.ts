import 'dotenv/config';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import pg from 'pg';
import { createEphemeralDb } from '../helpers/ephemeral-db.js';
import { runMigrations } from '../../src/db/runMigrations.js';

const eph = await createEphemeralDb('fb-fixlife');
{
  const bootstrap = new pg.Pool({ connectionString: eph.url, max: 4 });
  await runMigrations(bootstrap);
  await bootstrap.end();
}
process.env.DATABASE_URL = eph.url;

const { db } = await import('../../src/db/client.js');
const { triage, defer } = await import('../../src/services/feedbackTriage.js');
const { link, listResolvable } = await import('../../src/services/fixLifecycle.js');

afterAll(async () => {
  await db.end();
  await eph.drop();
});

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

async function mkBug(email: string | null = 'sub@example.test'): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO feedback (body, user_email_at_submit) VALUES ('it broke',$1) RETURNING id`,
    [email],
  );
  await triage({ id: rows[0].id, category: 'bug', severity: 'p2', note: 'real' });
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

describe('link', () => {
  it('records the SHA and moves the row to merged', async () => {
    const id = await mkBug();
    await link(id, SHA_A);
    const r = await row(id);
    expect(r.fix_commit_sha).toBe(SHA_A);
    expect(r.fix_status).toBe('merged');
  });

  it('is idempotent for the same SHA', async () => {
    const id = await mkBug();
    await link(id, SHA_A);
    await link(id, SHA_A);
    expect((await row(id)).fix_commit_sha).toBe(SHA_A);
  });

  it('refuses to overwrite a different recorded SHA', async () => {
    // Silently replacing it would change which commit the ancestry check runs
    // against, and could tell someone their bug shipped when a different
    // commit did.
    const id = await mkBug();
    await link(id, SHA_A);
    await expect(link(id, SHA_B)).rejects.toMatchObject({ code: 'sha_conflict' });
  });

  it('rejects a malformed SHA', async () => {
    const id = await mkBug();
    for (const bad of ['NOTASHA', 'A'.repeat(40), 'abc', `${SHA_A}0`]) {
      await expect(link(id, bad)).rejects.toMatchObject({ code: 'bad_sha' });
    }
    expect((await row(id)).fix_commit_sha).toBeNull();
  });

  it('refuses a duplicate — its canonical row owns the fix', async () => {
    const canonical = await mkBug();
    const dup = await mkBug();
    await triage({ id: dup, category: 'bug', severity: 'p2', note: 'dup', dedupeOf: canonical });
    await expect(link(dup, SHA_A)).rejects.toMatchObject({ code: 'not_canonical' });
  });

  it('refuses a deferred row', async () => {
    const id = await mkBug();
    await defer(id, 'not doing it');
    await expect(link(id, SHA_A)).rejects.toMatchObject({ code: 'terminal_state' });
  });

  it('404s on an unknown id', async () => {
    await expect(link('999999', SHA_A)).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('listResolvable', () => {
  it('returns a merged canonical row with an address', async () => {
    const id = await mkBug();
    await link(id, SHA_A);
    const rows = await listResolvable();
    expect(rows.map((r) => r.id)).toEqual([id]);
    expect(rows[0].effective_fix_sha).toBe(SHA_A);
  });

  it('returns a duplicate using its canonical row SHA', async () => {
    // The whole point: the duplicate carries no fix_commit_sha of its own.
    const canonical = await mkBug();
    const dup = await mkBug('dup@example.test');
    await triage({ id: dup, category: 'bug', severity: 'p2', note: 'dup', dedupeOf: canonical });
    await link(canonical, SHA_A);

    const rows = await listResolvable();
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(dup)!.effective_fix_sha).toBe(SHA_A);
    expect(byId.get(dup)!.user_email_at_submit).toBe('dup@example.test');
    expect((await row(dup)).fix_commit_sha).toBeNull();
  });

  it('excludes a row that already has a resolved email', async () => {
    const id = await mkBug();
    await link(id, SHA_A);
    await db.query(
      `INSERT INTO feedback_emails (feedback_id, kind, request, idempotency_key)
       VALUES ($1,'resolved','{}',$2)`,
      [id, `fb-resolved-${id}`],
    );
    expect(await listResolvable()).toHaveLength(0);
  });

  it('excludes a row whose submitter got a terminal reply', async () => {
    const id = await mkBug();
    await link(id, SHA_A);
    await db.query(
      `INSERT INTO feedback_emails (feedback_id, kind, request, idempotency_key)
       VALUES ($1,'reply','{}',$2)`,
      [id, `fb-reply-${id}`],
    );
    expect(await listResolvable()).toHaveLength(0);
  });

  it('excludes rows with no SHA anywhere, no address, and deferred canonicals', async () => {
    await mkBug(); // no SHA
    const noAddr = await mkBug(null);
    await link(noAddr, SHA_A);

    const deferredCanonical = await mkBug();
    const dupOfDeferred = await mkBug('x@example.test');
    await triage({
      id: dupOfDeferred,
      category: 'bug',
      severity: 'p2',
      note: 'dup',
      dedupeOf: deferredCanonical,
    });
    await defer(deferredCanonical, 'wontfix');

    // A deferred canonical has no fix_commit_sha, so neither it nor its
    // duplicate resolves to an effective SHA. Nobody is told a fix shipped.
    expect(await listResolvable()).toHaveLength(0);
  });

  // Selection must match sendResolvedEmail's gate exactly. That gate throws
  // for an unclassified row and for any category outside FIXABLE, and `link`
  // does not require a triaged row — so a row selected here that the gate
  // refuses fails on EVERY sweep, with no operator action that clears it.
  it('excludes a linked but untriaged row — the email gate would refuse it', async () => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO feedback (body, user_email_at_submit)
       VALUES ('never triaged','sub@example.test') RETURNING id`,
    );
    await link(rows[0].id, SHA_A);
    expect((await row(rows[0].id)).category).toBeNull();
    expect(await listResolvable()).toHaveLength(0);
  });

  it('excludes a linked row whose category cannot produce a resolved email', async () => {
    for (const category of ['question', 'noise'] as const) {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO feedback (body, user_email_at_submit)
         VALUES ($1,'sub@example.test') RETURNING id`,
        [category],
      );
      await triage({ id: rows[0].id, category, note: 'terminal' });
      await link(rows[0].id, SHA_A);
    }
    expect(await listResolvable()).toHaveLength(0);
  });

  it('includes every fixable category', async () => {
    const ids: string[] = [];
    for (const category of ['bug', 'ux', 'feature'] as const) {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO feedback (body, user_email_at_submit)
         VALUES ($1,'sub@example.test') RETURNING id`,
        [category],
      );
      await triage({ id: rows[0].id, category, severity: 'p2', note: 'real' });
      await link(rows[0].id, SHA_A);
      ids.push(rows[0].id);
    }
    expect((await listResolvable()).map((r) => r.id).sort()).toEqual([...ids].sort());
  });
});
