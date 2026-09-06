import 'dotenv/config';
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import pg from 'pg';
import { createEphemeralDb } from '../helpers/ephemeral-db.js';
import { runMigrations } from '../../src/db/runMigrations.js';

const eph = await createEphemeralDb('fb-resolved');
{
  const bootstrap = new pg.Pool({ connectionString: eph.url, max: 4 });
  await runMigrations(bootstrap);
  await bootstrap.end();
}
process.env.DATABASE_URL = eph.url;
process.env.FEEDBACK_FROM_EMAIL = 'feedback@send.jpmtech.com';
process.env.RESEND_API_KEY = 'test-key';

const { db } = await import('../../src/db/client.js');
const { triage } = await import('../../src/services/feedbackTriage.js');
const mailer = await import('../../src/services/feedbackMailer.js');
const { sendFeedbackEmail, sendResolvedEmail } =
  await import('../../src/services/feedbackEmails.js');

afterAll(async () => {
  await db.end();
  await eph.drop();
});

const ok = (id = 'msg-r') =>
  vi.fn(async () => new Response(JSON.stringify({ id }), { status: 200 }));

async function mkClassified(category: 'bug' | 'noise'): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO feedback (body, user_email_at_submit) VALUES ('x','sub@example.test') RETURNING id`,
  );
  const id = rows[0].id;
  await triage(
    category === 'bug'
      ? { id, category: 'bug', severity: 'p2', note: 'real' }
      : { id, category: 'noise', note: 'junk' },
  );
  return id;
}

async function ledger(id: string) {
  const { rows } = await db.query(
    `SELECT kind, sent_at, message_id, dead_lettered_at FROM feedback_emails
      WHERE feedback_id=$1 ORDER BY kind`,
    [id],
  );
  return rows;
}

beforeEach(async () => {
  await db.query('DELETE FROM feedback_emails');
  await db.query('DELETE FROM feedback');
  mailer.__setMailFetchForTesting(null);
});

describe('sendResolvedEmail', () => {
  it('sends a resolved notice for a fixable row', async () => {
    mailer.__setMailFetchForTesting(ok());
    const id = await mkClassified('bug');
    const res = await sendResolvedEmail({ id, bodyText: 'shipped it' });
    expect(res.status).toBe('sent');
    const rows = await ledger(id);
    expect(rows.map((r) => r.kind)).toEqual(['resolved']);
    expect(rows[0].message_id).toBe('msg-r');
  });

  it('coexists with an ack — both rows, one each', async () => {
    mailer.__setMailFetchForTesting(ok());
    const id = await mkClassified('bug');
    await sendFeedbackEmail({ id, kind: 'ack', bodyText: 'got it' });
    await sendResolvedEmail({ id, bodyText: 'shipped it' });
    expect((await ledger(id)).map((r) => r.kind)).toEqual(['ack', 'resolved']);
  });

  it('sends even when the ack was dead-lettered', async () => {
    // Per the spec's failure table: dead-lettering one email does not abandon
    // the item. The person still deserves to hear their bug was fixed.
    const id = await mkClassified('bug');
    await db.query(
      `INSERT INTO feedback_emails (feedback_id, kind, request, idempotency_key, dead_lettered_at, attempts, first_attempt_at)
       VALUES ($1,'ack','{}',$2, now(), 1, now())`,
      [id, `fb-ack-${id}`],
    );
    mailer.__setMailFetchForTesting(ok());
    const res = await sendResolvedEmail({ id, bodyText: 'shipped it' });
    expect(res.status).toBe('sent');
  });

  it('refuses a terminal category', async () => {
    const id = await mkClassified('noise');
    await expect(sendResolvedEmail({ id, bodyText: 'x' })).rejects.toMatchObject({
      code: 'kind_not_allowed_for_category',
    });
    expect(await ledger(id)).toHaveLength(0);
  });

  it('refuses when a reply already exists', async () => {
    mailer.__setMailFetchForTesting(ok());
    const id = await mkClassified('noise');
    await sendFeedbackEmail({ id, kind: 'reply', bodyText: 'snark' });
    // Reclassify so the category gate alone would now permit resolved.
    await triage({ id, category: 'bug', severity: 'p3', note: 'actually real' });
    await expect(sendResolvedEmail({ id, bodyText: 'x' })).rejects.toMatchObject({
      code: 'exclusive_kind_present',
    });
  });

  it('is at-most-once: a second call is already_sent and does not re-send', async () => {
    const fetchMock = ok();
    mailer.__setMailFetchForTesting(fetchMock);
    const id = await mkClassified('bug');
    await sendResolvedEmail({ id, bodyText: 'shipped' });
    const again = await sendResolvedEmail({ id, bodyText: 'different prose' });
    expect(again.status).toBe('already_sent');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses a row with no submitter address and writes no ledger row', async () => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO feedback (body, user_email_at_submit) VALUES ('x',NULL) RETURNING id`,
    );
    await triage({ id: rows[0].id, category: 'bug', severity: 'p2', note: 'x' });
    await expect(sendResolvedEmail({ id: rows[0].id, bodyText: 'x' })).rejects.toMatchObject({
      code: 'no_recipient',
    });
    expect(await ledger(rows[0].id)).toHaveLength(0);
  });
});

describe('the refactor preserves sendFeedbackEmail', () => {
  it('still refuses resolved through the public entry point', async () => {
    const id = await mkClassified('bug');
    await expect(
      // @ts-expect-error 'resolved' is deliberately outside SendableKind
      sendFeedbackEmail({ id, kind: 'resolved', bodyText: 'x' }),
    ).rejects.toMatchObject({ code: 'kind_not_allowed_for_category' });
  });
});
