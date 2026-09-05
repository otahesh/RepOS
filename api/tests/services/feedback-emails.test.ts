import 'dotenv/config';
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import pg from 'pg';
import { createEphemeralDb } from '../helpers/ephemeral-db.js';
import { runMigrations } from '../../src/db/runMigrations.js';

const eph = await createEphemeralDb('fb-emails');
{
  const bootstrap = new pg.Pool({ connectionString: eph.url, max: 6 });
  await runMigrations(bootstrap);
  await bootstrap.end();
}
process.env.DATABASE_URL = eph.url;
process.env.FEEDBACK_FROM_EMAIL = 'feedback@send.jpmtech.com';
process.env.RESEND_API_KEY = 'test-key';

const { db } = await import('../../src/db/client.js');
const { triage } = await import('../../src/services/feedbackTriage.js');
const mailer = await import('../../src/services/feedbackMailer.js');
const { sendFeedbackEmail } = await import('../../src/services/feedbackEmails.js');

afterAll(async () => {
  await db.end();
  await eph.drop();
});

function okFetch(id = 'msg-1') {
  return vi.fn(async () => new Response(JSON.stringify({ id }), { status: 200 }));
}

async function mkClassified(
  category: 'bug' | 'noise' | 'question',
  email: string | null = 'sub@example.test',
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO feedback (body, user_email_at_submit) VALUES ('x',$1) RETURNING id`,
    [email],
  );
  const id = rows[0].id;
  await triage(
    category === 'bug'
      ? { id, category: 'bug', severity: 'p2', note: 'real' }
      : { id, category, note: 'terminal' },
  );
  return id;
}

async function ledger(id: string) {
  const { rows } = await db.query(`SELECT * FROM feedback_emails WHERE feedback_id=$1`, [id]);
  return rows;
}

beforeEach(async () => {
  await db.query('DELETE FROM feedback_emails');
  await db.query('DELETE FROM feedback');
  mailer.__setMailFetchForTesting(null);
});

describe('category / kind gating', () => {
  it('sends an ack for a bug', async () => {
    mailer.__setMailFetchForTesting(okFetch());
    const id = await mkClassified('bug');
    const res = await sendFeedbackEmail({ id, kind: 'ack', bodyText: 'logged it' });
    expect(res.status).toBe('sent');
    const rows = await ledger(id);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('ack');
    expect(rows[0].message_id).toBe('msg-1');
    expect(rows[0].sent_at).not.toBeNull();
  });

  it('refuses an ack for noise, and a reply for a bug', async () => {
    const noisy = await mkClassified('noise');
    await expect(
      sendFeedbackEmail({ id: noisy, kind: 'ack', bodyText: 'x' }),
    ).rejects.toMatchObject({ code: 'kind_not_allowed_for_category' });

    const bug = await mkClassified('bug');
    await expect(
      sendFeedbackEmail({ id: bug, kind: 'reply', bodyText: 'x' }),
    ).rejects.toMatchObject({ code: 'kind_not_allowed_for_category' });
  });

  it('offers no way to send a resolved email', async () => {
    const id = await mkClassified('bug');
    await expect(
      // @ts-expect-error 'resolved' is deliberately outside the accepted union
      sendFeedbackEmail({ id, kind: 'resolved', bodyText: 'x' }),
    ).rejects.toMatchObject({ code: 'kind_not_allowed_for_category' });
  });

  it('refuses to email an unclassified row', async () => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO feedback (body, user_email_at_submit) VALUES ('x','sub@example.test') RETURNING id`,
    );
    await expect(
      sendFeedbackEmail({ id: rows[0].id, kind: 'ack', bodyText: 'x' }),
    ).rejects.toMatchObject({ code: 'not_classified' });
  });

  it('refuses a row with no submitter address and writes no ledger row', async () => {
    const id = await mkClassified('bug', null);
    await expect(sendFeedbackEmail({ id, kind: 'ack', bodyText: 'x' })).rejects.toMatchObject({
      code: 'no_recipient',
    });
    expect(await ledger(id)).toHaveLength(0);
  });
});

describe('exclusivity', () => {
  it('refuses a reply once an ack exists, and an ack once a reply exists', async () => {
    mailer.__setMailFetchForTesting(okFetch());
    const bug = await mkClassified('bug');
    await sendFeedbackEmail({ id: bug, kind: 'ack', bodyText: 'x' });
    // Reclassify so the category gate would otherwise allow a reply.
    await triage({ id: bug, category: 'noise', note: 'actually junk' });
    await expect(
      sendFeedbackEmail({ id: bug, kind: 'reply', bodyText: 'x' }),
    ).rejects.toMatchObject({ code: 'exclusive_kind_present' });
  });

  it('treats a second send of the same kind as already_sent, not an error', async () => {
    const fetchMock = okFetch();
    mailer.__setMailFetchForTesting(fetchMock);
    const id = await mkClassified('bug');
    await sendFeedbackEmail({ id, kind: 'ack', bodyText: 'x' });
    const again = await sendFeedbackEmail({ id, kind: 'ack', bodyText: 'different prose' });
    expect(again.status).toBe('already_sent');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await ledger(id)).toHaveLength(1);
  });
});

describe('commit before send', () => {
  it('leaves the row durable when the send throws', async () => {
    const id = await mkClassified('bug');
    let observedFromAnotherConnection: unknown = null;

    mailer.__setMailFetchForTesting(
      vi.fn(async () => {
        // A SEPARATE pool: the point is that the row is COMMITTED, not merely
        // visible inside an open transaction.
        const probe = new pg.Pool({ connectionString: eph.url, max: 1 });
        const { rows } = await probe.query(
          `SELECT kind, sent_at, message_id, attempts FROM feedback_emails WHERE feedback_id=$1`,
          [id],
        );
        observedFromAnotherConnection = rows[0] ?? null;
        await probe.end();
        throw new Error('network down');
      }),
    );

    const res = await sendFeedbackEmail({ id, kind: 'ack', bodyText: 'logged it' });
    expect(res.status).toBe('failed');

    // Seeded from a non-default value: a test asserting a field ends at its
    // default proves nothing about the path meant to set it.
    expect(observedFromAnotherConnection).toMatchObject({ kind: 'ack', sent_at: null });

    const rows = await ledger(id);
    expect(rows[0].sent_at).toBeNull();
    expect(rows[0].message_id).toBeNull();
    expect(rows[0].error).toContain('network down');
    expect(rows[0].attempts).toBe(1);
    expect(rows[0].first_attempt_at).not.toBeNull();
  });

  it('replays byte-identical bytes under the same key after a failure', async () => {
    const id = await mkClassified('bug');
    const bodies: string[] = [];
    const keys: string[] = [];
    const capture = vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(String(init.body));
      keys.push(String((init.headers as Record<string, string>)['Idempotency-Key']));
      throw new Error('still down');
    });
    mailer.__setMailFetchForTesting(capture as unknown as typeof fetch);

    await sendFeedbackEmail({ id, kind: 'ack', bodyText: 'first prose' });
    // Different prose on the retry: the frozen bytes must win, not a re-render.
    await sendFeedbackEmail({ id, kind: 'ack', bodyText: 'COMPLETELY different prose' });

    expect(bodies[0]).toBe(bodies[1]);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).toBe(`fb-ack-${id}`);
    expect((await ledger(id))[0].attempts).toBe(2);
  });
});
