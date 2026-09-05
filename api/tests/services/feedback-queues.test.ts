import 'dotenv/config';
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
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
process.env.FEEDBACK_FROM_EMAIL = 'feedback@send.jpmtech.com';
process.env.RESEND_API_KEY = 'test-key';

const { db } = await import('../../src/db/client.js');
const { triage, defer, listUntriaged, listPending, listFixPending, listDeadLettered } =
  await import('../../src/services/feedbackTriage.js');
const mailer = await import('../../src/services/feedbackMailer.js');
const { sendFeedbackEmail, EmailGateError } = await import('../../src/services/feedbackEmails.js');

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
  mailer.__setMailFetchForTesting(null);
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

  it('excludes a row that has ANY email, even one of a kind its category would not ask for', async () => {
    // This test previously asserted the opposite — that a `noise` row holding
    // an `ack` was still pending, because the CASE demanded a `reply`. That was
    // wrong, and it stranded rows permanently: re-triage across the
    // FIXABLE/TERMINAL boundary is explicitly permitted and never un-sends an
    // email, so a row acked as a `bug` and then re-triaged `noise` would be
    // re-queued every sweep while sendFeedbackEmail refused to create the
    // `reply` (exclusive_kind_present, the ack exists). Nothing could clear it
    // and nothing alerted.
    //
    // The guarantee listPending enforces is "the submitter has not heard back",
    // and ANY email means they have.
    const noisy = await mkFeedback('yo');
    await triage({ id: noisy, category: 'noise', note: 'junk' });
    await mkEmail(noisy, 'ack');
    expect(await listPending()).toHaveLength(0);

    await db.query('DELETE FROM feedback_emails');
    await mkEmail(noisy, 'reply');
    expect(await listPending()).toHaveLength(0);

    // And with no email at all it is pending, so the exclusion above is doing
    // the work rather than the row simply never qualifying.
    await db.query('DELETE FROM feedback_emails');
    expect((await listPending()).map((r) => r.id)).toEqual([noisy]);
  });

  it('does not re-queue a row re-triaged across the FIXABLE/TERMINAL boundary', async () => {
    // The exact strand, end to end: a kind-specific membership test put this
    // row back in the queue every sweep while no action could clear it.
    const id = await mkFeedback('looked like a bug');
    await triage({ id, category: 'bug', severity: 'p2', note: 'real' });
    mailer.__setMailFetchForTesting(
      vi.fn(async () => new Response(JSON.stringify({ id: 'msg-1' }), { status: 200 })),
    );
    expect(await sendFeedbackEmail({ id, kind: 'ack', bodyText: 'thanks' })).toMatchObject({
      status: 'sent',
    });

    await triage({ id, category: 'noise', note: 'on reflection, a joke' });

    // The submitter has heard back, so the row is not pending...
    expect(await listPending()).toHaveLength(0);
    // ...and it had better not be, because nothing could ever clear it: the
    // only email its new category permits is refused outright.
    await expect(sendFeedbackEmail({ id, kind: 'reply', bodyText: 'ha' })).rejects.toThrow(
      EmailGateError,
    );
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
