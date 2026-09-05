import 'dotenv/config';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import pg from 'pg';
import { createEphemeralDb } from '../helpers/ephemeral-db.js';
import { runMigrations } from '../../src/db/runMigrations.js';

const eph = await createEphemeralDb('fb-queues');
{
  const bootstrap = new pg.Pool({ connectionString: eph.url, max: 4 });
  await runMigrations(bootstrap);
  await bootstrap.end();
}
process.env.DATABASE_URL = eph.url;

const { db } = await import('../../src/db/client.js');
const { triage, defer, listUntriaged, listPending, listFixPending, listDeadLettered } =
  await import('../../src/services/feedbackTriage.js');

afterAll(async () => {
  await db.end();
  await eph.drop();
});

async function mkFeedback(
  body: string,
  email: string | null = 'sub@example.test',
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO feedback (body, user_email_at_submit) VALUES ($1,$2) RETURNING id`,
    [body, email],
  );
  return rows[0].id;
}

async function mkEmail(
  feedbackId: string,
  kind: 'ack' | 'reply' | 'resolved',
  over: { sent?: boolean; deadLettered?: boolean; error?: string } = {},
) {
  await db.query(
    `INSERT INTO feedback_emails
       (feedback_id, kind, request, idempotency_key, sent_at, dead_lettered_at, error, attempts, first_attempt_at)
     VALUES ($1,$2,'{}',$3,$4,$5,$6,1,now())`,
    [
      feedbackId,
      kind,
      `fb-${kind}-${feedbackId}`,
      over.sent ? new Date() : null,
      over.deadLettered ? new Date() : null,
      over.error ?? null,
    ],
  );
}

beforeEach(async () => {
  await db.query('DELETE FROM feedback_emails');
  await db.query('DELETE FROM feedback');
});

describe('listUntriaged', () => {
  it('returns unclassified rows oldest first', async () => {
    const a = await mkFeedback('first');
    const b = await mkFeedback('second');
    const rows = await listUntriaged();
    expect(rows.map((r) => r.id)).toEqual([a, b]);
  });

  it('still returns a row the admin UI merely stamped triaged_at on', async () => {
    // adminFeedback.ts sets ONLY triaged_at. Keying the queue on that column
    // would drop this row silently, unclassified and unanswered.
    const id = await mkFeedback('clicked in the admin UI');
    await db.query(`UPDATE feedback SET triaged_at=now() WHERE id=$1`, [id]);
    expect((await listUntriaged()).map((r) => r.id)).toEqual([id]);
  });

  it('excludes classified rows', async () => {
    const id = await mkFeedback('x');
    await triage({ id, category: 'noise', note: 'junk' });
    expect(await listUntriaged()).toHaveLength(0);
  });
});

describe('listPending', () => {
  it('returns a classified row whose first email was never written', async () => {
    const id = await mkFeedback('x');
    await triage({ id, category: 'bug', severity: 'p2', note: 'real' });
    expect((await listPending()).map((r) => r.id)).toEqual([id]);
  });

  it('excludes a row that already has its ledger row, even unsent', async () => {
    // The written-but-unsent case belongs to replayPending, not here.
    const id = await mkFeedback('x');
    await triage({ id, category: 'bug', severity: 'p2', note: 'real' });
    await mkEmail(id, 'ack');
    expect(await listPending()).toHaveLength(0);
  });

  it('expects reply for noise and question, ack for the rest', async () => {
    const noisy = await mkFeedback('yo');
    await triage({ id: noisy, category: 'noise', note: 'junk' });
    await mkEmail(noisy, 'ack'); // wrong kind for noise
    expect((await listPending()).map((r) => r.id)).toEqual([noisy]);

    await db.query('DELETE FROM feedback_emails');
    await mkEmail(noisy, 'reply');
    expect(await listPending()).toHaveLength(0);
  });

  it('excludes rows with no submitter address', async () => {
    const id = await mkFeedback('anonymous', null);
    await triage({ id, category: 'bug', severity: 'p3', note: 'no address' });
    expect(await listPending()).toHaveLength(0);
  });
});

describe('listFixPending', () => {
  it('returns needed, patch_submitted and pr_open canonical rows', async () => {
    const a = await mkFeedback('a');
    await triage({ id: a, category: 'bug', severity: 'p1', note: 'x' });
    const b = await mkFeedback('b');
    await triage({ id: b, category: 'ux', severity: 'p3', note: 'x' });
    await db.query(`UPDATE feedback SET fix_status='pr_open' WHERE id=$1`, [b]);
    expect((await listFixPending()).map((r) => r.id).sort()).toEqual([a, b].sort());
  });

  it('excludes duplicates, deferred, merged, and unclassified rows', async () => {
    const canonical = await mkFeedback('canonical');
    await triage({ id: canonical, category: 'bug', severity: 'p2', note: 'x' });
    const dup = await mkFeedback('dup');
    await triage({ id: dup, category: 'bug', severity: 'p2', note: 'x', dedupeOf: canonical });

    const deferred = await mkFeedback('deferred');
    await triage({ id: deferred, category: 'feature', severity: 'p3', note: 'x' });
    await defer(deferred, 'not now');

    const merged = await mkFeedback('merged');
    await triage({ id: merged, category: 'bug', severity: 'p2', note: 'x' });
    await db.query(`UPDATE feedback SET fix_status='merged' WHERE id=$1`, [merged]);

    await mkFeedback('untouched');

    expect((await listFixPending()).map((r) => r.id)).toEqual([canonical]);
  });
});

describe('listDeadLettered', () => {
  it('returns abandoned sends with their reason and recipient', async () => {
    const id = await mkFeedback('x');
    await triage({ id, category: 'bug', severity: 'p2', note: 'x' });
    await mkEmail(id, 'ack', { deadLettered: true, error: 'recipient suppressed' });
    const rows = await listDeadLettered();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      feedback_id: id,
      kind: 'ack',
      error: 'recipient suppressed',
      user_email_at_submit: 'sub@example.test',
    });
  });

  it('excludes sent and still-retrying rows', async () => {
    const id = await mkFeedback('x');
    await triage({ id, category: 'bug', severity: 'p2', note: 'x' });
    await mkEmail(id, 'ack', { sent: true });
    await mkEmail(id, 'resolved', { error: 'timeout' });
    expect(await listDeadLettered()).toHaveLength(0);
  });
});
