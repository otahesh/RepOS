import 'dotenv/config';
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import pg from 'pg';
import { createEphemeralDb } from '../helpers/ephemeral-db.js';
import { runMigrations } from '../../src/db/runMigrations.js';

const eph = await createEphemeralDb('fb-delivery');
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
const { sendFeedbackEmail, replayPending, classifyFailure, IDEMPOTENCY_WINDOW_MS } =
  await import('../../src/services/feedbackEmails.js');
const alerts = await import('../../src/services/feedbackAlerts.js');
const { withFeedbackLock, FEEDBACK_LOCK_CLASS } =
  await import('../../src/services/feedbackLock.js');

afterAll(async () => {
  await db.end();
  await eph.drop();
});

const status = (code: number) =>
  vi.fn(async () => new Response(JSON.stringify({ message: 'no' }), { status: code }));
const ok = () => vi.fn(async () => new Response(JSON.stringify({ id: 'msg-ok' }), { status: 200 }));

async function mkBug(): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO feedback (body, user_email_at_submit) VALUES ('x','sub@example.test') RETURNING id`,
  );
  await triage({ id: rows[0].id, category: 'bug', severity: 'p2', note: 'real' });
  return rows[0].id;
}

async function ledgerRow(id: string) {
  const { rows } = await db.query(`SELECT * FROM feedback_emails WHERE feedback_id=$1`, [id]);
  return rows[0];
}

/** Discord-shaped, and never actually reached: the alert fetch is stubbed. */
const WEBHOOK = 'https://discord.com/api/webhooks/123/abc';

/** Records every alert fired by the test that is currently running. */
let alertCalls: Array<{ url: string; body: string }> = [];

beforeEach(async () => {
  await db.query('DELETE FROM feedback_emails');
  await db.query('DELETE FROM feedback');
  mailer.__setMailFetchForTesting(null);
  // replayPending now calls assertAlertingConfigured() before it selects
  // anything, so a sweep with no alert destination fails loudly instead of
  // dead-lettering people in silence. Every test in this file therefore needs
  // a configured webhook — and a stub, so nothing leaves the machine.
  process.env.FEEDBACK_WEBHOOK_URL = WEBHOOK;
  // Reset per test, so no test can accidentally depend on another's alerts.
  alertCalls = [];
  alerts.__setAlertFetchForTesting(
    vi.fn(async (url: string, init: RequestInit) => {
      alertCalls.push({ url: String(url), body: String(init.body) });
      return new Response('', { status: 204 });
    }) as unknown as typeof fetch,
  );
});

describe('classifyFailure', () => {
  it('separates transient, auth and recipient failures', () => {
    const mk = (s: number) => new mailer.MailerError('mail_http_error', 'x', undefined, s);
    expect(classifyFailure(mk(429))).toBe('retryable');
    expect(classifyFailure(mk(500))).toBe('retryable');
    expect(classifyFailure(mk(503))).toBe('retryable');
    expect(classifyFailure(new mailer.MailerError('mail_timeout', 'x'))).toBe('retryable');
    expect(classifyFailure(mk(401))).toBe('auth');
    expect(classifyFailure(mk(403))).toBe('auth');
    // 422 is the documented recipient-level rejection: this address cannot be
    // mailed, and no retry will change that.
    expect(classifyFailure(mk(422))).toBe('recipient');
    // A 400 is about OUR payload, not about this recipient — a Resend API
    // change would return it for every message in the queue. Dead-lettering on
    // it abandons every pending submitter over a bug on our side, which is the
    // same harm the 401/403 carve-out exists to prevent. It retries instead,
    // and dead-letters at 24h with an alert if it really is systemic.
    expect(classifyFailure(mk(400))).toBe('retryable');
    expect(classifyFailure(mk(404))).toBe('retryable');
  });
});

describe('replayPending', () => {
  it('re-sends a written-but-unsent row using its original bytes and key', async () => {
    const id = await mkBug();
    mailer.__setMailFetchForTesting(
      vi.fn(async () => {
        throw new Error('network down');
      }) as unknown as typeof fetch,
    );
    await sendFeedbackEmail({ id, kind: 'ack', bodyText: 'original prose' });
    const before = await ledgerRow(id);
    expect(before.sent_at).toBeNull();

    const bodies: string[] = [];
    mailer.__setMailFetchForTesting(
      vi.fn(async (_u: string, init: RequestInit) => {
        bodies.push(String(init.body));
        return new Response(JSON.stringify({ id: 'msg-replay' }), { status: 200 });
      }) as unknown as typeof fetch,
    );

    const res = await replayPending();
    expect(res).toMatchObject({ sent: 1, deadLettered: 0, paused: false });
    expect(bodies[0]).toBe(before.request);
    const after = await ledgerRow(id);
    expect(after.sent_at).not.toBeNull();
    expect(after.message_id).toBe('msg-replay');
  });

  it('dead-letters a send that is still unsent 24 hours after its first attempt', async () => {
    const id = await mkBug();
    mailer.__setMailFetchForTesting(
      vi.fn(async () => {
        throw new Error('down');
      }) as unknown as typeof fetch,
    );
    await sendFeedbackEmail({ id, kind: 'ack', bodyText: 'x' });
    await db.query(
      `UPDATE feedback_emails SET first_attempt_at = now() - interval '25 hours' WHERE feedback_id=$1`,
      [id],
    );

    const fetchMock = ok();
    mailer.__setMailFetchForTesting(fetchMock);
    const res = await replayPending();

    expect(res).toMatchObject({ sent: 0, deadLettered: 1 });
    // Ambiguous outcome: it may already have been delivered. Do not risk twice.
    expect(fetchMock).not.toHaveBeenCalled();
    const row = await ledgerRow(id);
    expect(row.dead_lettered_at).not.toBeNull();
    expect(row.sent_at).toBeNull();
  });

  it('fires a dead-letter alert when a row expires past the 24h window', async () => {
    const id = await mkBug();
    mailer.__setMailFetchForTesting(
      vi.fn(async () => {
        throw new Error('down');
      }) as unknown as typeof fetch,
    );
    await sendFeedbackEmail({ id, kind: 'ack', bodyText: 'x' });
    await db.query(
      `UPDATE feedback_emails SET first_attempt_at = now() - interval '25 hours' WHERE feedback_id=$1`,
      [id],
    );

    mailer.__setMailFetchForTesting(ok());
    const res = await replayPending();

    expect(res.deadLettered).toBe(1);
    expect(alertCalls).toHaveLength(1);
    expect(alertCalls[0].body).toContain(`feedback ${id}`);
  });

  it('dead-letters a recipient-level rejection on the first response', async () => {
    const id = await mkBug();
    mailer.__setMailFetchForTesting(status(422));
    const res = await replayPendingAfterInitial(id);
    expect(res.deadLettered).toBe(1);
    expect((await ledgerRow(id)).dead_lettered_at).not.toBeNull();
  });

  it('fires the recipient-rejection dead-letter alert only after the row lock is released', async () => {
    // Pins the fix for the Critical finding: alertDeadLetter for a
    // recipient-level rejection must run OUTSIDE withFeedbackLock. If it
    // ran inside (as it did before the fix), the row's advisory lock would
    // still be held while this stub is awaited, and the acquisition below
    // — for the SAME feedback id, with a deadline far shorter than the
    // alert's own timeout — would throw LockTimeoutError instead of
    // resolving.
    const id = await mkBug();

    let lockWasFree: boolean | undefined;
    let lockError: unknown;
    alerts.__setAlertFetchForTesting(
      vi.fn(async (_u: string, _init: RequestInit) => {
        try {
          await withFeedbackLock(id, async () => {}, { timeoutMs: 200 });
          lockWasFree = true;
        } catch (err) {
          lockWasFree = false;
          lockError = err;
        }
        return new Response('', { status: 204 });
      }) as unknown as typeof fetch,
    );

    mailer.__setMailFetchForTesting(status(422));
    const res = await replayPendingAfterInitial(id);

    expect(res.deadLettered).toBe(1);
    expect(lockWasFree, `expected the lock to be free; got error: ${String(lockError)}`).toBe(true);
  });

  it('does NOT dead-letter a 429', async () => {
    const id = await mkBug();
    mailer.__setMailFetchForTesting(status(429));
    const res = await replayPendingAfterInitial(id);
    expect(res.deadLettered).toBe(0);
    expect((await ledgerRow(id)).dead_lettered_at).toBeNull();
  });

  it('pauses on 401 and consumes nothing', async () => {
    // An auth failure applies to EVERY message. Dead-lettering on it would burn
    // the whole queue over an expired key.
    const a = await mkBug();
    const b = await mkBug();
    mailer.__setMailFetchForTesting(
      vi.fn(async () => {
        throw new Error('seed');
      }) as unknown as typeof fetch,
    );
    await sendFeedbackEmail({ id: a, kind: 'ack', bodyText: 'x' });
    await sendFeedbackEmail({ id: b, kind: 'ack', bodyText: 'x' });

    const unauthorized = status(401);
    mailer.__setMailFetchForTesting(unauthorized);
    const res = await replayPending();

    expect(res.paused).toBe(true);
    expect(res.sent).toBe(0);
    expect(res.deadLettered).toBe(0);
    // Halted: it did not go on to try the second row.
    expect(unauthorized).toHaveBeenCalledTimes(1);
    expect((await ledgerRow(a)).dead_lettered_at).toBeNull();
    expect((await ledgerRow(b)).dead_lettered_at).toBeNull();

    // Once the key is fixed the queue drains intact.
    mailer.__setMailFetchForTesting(ok());
    const after = await replayPending();
    expect(after.sent).toBe(2);
  });

  it('skips rows that are already sent or already dead-lettered', async () => {
    const id = await mkBug();
    mailer.__setMailFetchForTesting(ok());
    await sendFeedbackEmail({ id, kind: 'ack', bodyText: 'x' });
    const fetchMock = ok();
    mailer.__setMailFetchForTesting(fetchMock);
    const res = await replayPending();
    expect(res.sent).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips a row another runner claims between the batch read and this row's own claim", async () => {
    // The coordinator's suggested version of this test marks the row sent
    // BEFORE calling replayPending — but replayPending's batch SELECT already
    // filters on `sent_at IS NULL`, so that row would never be read into the
    // batch at all, and the claim-UPDATE guard would never run. That would be
    // a test that passes for the wrong reason.
    //
    // To actually exercise the atomic claim-UPDATE, both rows must still be
    // unsent when the batch SELECT runs. Row `b`'s send is then completed by
    // a simulated concurrent runner from inside row `a`'s mocked fetch call —
    // i.e. strictly between the batch SELECT (which read `b` as pending) and
    // the point in the loop where `b`'s own claim-UPDATE executes.
    const a = await mkBug();
    const b = await mkBug();
    mailer.__setMailFetchForTesting(
      vi.fn(async () => {
        throw new Error('seed');
      }) as unknown as typeof fetch,
    );
    await sendFeedbackEmail({ id: a, kind: 'ack', bodyText: 'x' });
    await sendFeedbackEmail({ id: b, kind: 'ack', bodyText: 'x' });

    const fetchMock = vi.fn(async () => {
      // Stand in for a concurrent replayPending run winning the race on `b`:
      // it sends and marks `b` sent while `a`'s send (the only row this mock
      // is ever invoked for) is in flight.
      await db.query(
        `UPDATE feedback_emails SET sent_at=now(), message_id='msg-other' WHERE feedback_id=$1`,
        [b],
      );
      return new Response(JSON.stringify({ id: 'msg-a' }), { status: 200 });
    });
    mailer.__setMailFetchForTesting(fetchMock as unknown as typeof fetch);

    const res = await replayPending();
    expect(res).toMatchObject({ sent: 1, deadLettered: 0, paused: false });
    // The mock is called exactly once, for `a`. `b`'s own claim-UPDATE found
    // sent_at already set and returned 'skipped' without ever attempting a
    // send.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const rowB = await ledgerRow(b);
    expect(rowB.message_id).toBe('msg-other');
    expect(rowB.attempts).toBe(1); // not re-incremented by replayPending's claim
  });

  it('skips a row whose lock is held elsewhere without abandoning the rest of the batch', async () => {
    // A LockTimeoutError escaping the loop would leave every REMAINING row in
    // the batch unattempted and unalerted — silent batch loss, the same class
    // as the alert-inside-the-lock bug. Another holder is actively working the
    // locked row, so skipping it is correct; skipping its successors is not.
    const a = await mkBug();
    const b = await mkBug();
    mailer.__setMailFetchForTesting(
      vi.fn(async () => {
        throw new Error('seed');
      }) as unknown as typeof fetch,
    );
    await sendFeedbackEmail({ id: a, kind: 'ack', bodyText: 'x' });
    await sendFeedbackEmail({ id: b, kind: 'ack', bodyText: 'x' });

    // Hold `a`'s advisory lock from a connection replayPending cannot reach,
    // for longer than its 5s acquisition deadline.
    const holder = new pg.Client({ connectionString: eph.url });
    await holder.connect();
    await holder.query('SELECT pg_advisory_lock($1, $2)', [FEEDBACK_LOCK_CLASS, Number(a)]);

    try {
      mailer.__setMailFetchForTesting(ok());
      const res = await replayPending();
      // `b` still went out. Before the fix this returned nothing and threw.
      expect(res).toMatchObject({ sent: 1, deadLettered: 0, paused: false });
      expect((await ledgerRow(b)).sent_at).not.toBeNull();
      expect((await ledgerRow(a)).sent_at).toBeNull();
      expect((await ledgerRow(a)).dead_lettered_at).toBeNull();
    } finally {
      await holder.query('SELECT pg_advisory_unlock($1, $2)', [FEEDBACK_LOCK_CLASS, Number(a)]);
      await holder.end();
    }
  });

  it('does not dead-letter an expired row that was delivered concurrently', async () => {
    // Cron batch-selects an unsent row near the 24h boundary; the operator's
    // `feedback email --id X --kind ack` replays the frozen bytes and commits
    // sent_at in between. Without the claim guard the expired branch stamps
    // dead_lettered_at over a DELIVERED row and alerts — it then reads as
    // "nobody replied", and the documented human response to a dead letter is
    // to send it by hand, producing the second email the design forbids.
    //
    // Pre-setting sent_at and then calling replayPending would prove nothing:
    // the batch SELECT filters on `sent_at IS NULL`, so the row would never be
    // read and the expired branch would never run. The concurrent send must
    // therefore land BETWEEN the batch SELECT and this row's own UPDATE, which
    // is what row `a`'s in-flight mailer stub does below.
    const a = await mkBug(); // first in the batch: first_attempt_at IS NULL
    const b = await mkBug(); // expired, and delivered while `a` is in flight
    await seedLedger(a, null);
    await seedLedger(b, "now() - interval '25 hours'");

    const fetchMock = vi.fn(async () => {
      await db.query(
        `UPDATE feedback_emails SET sent_at=now(), message_id='msg-operator' WHERE feedback_id=$1`,
        [b],
      );
      return new Response(JSON.stringify({ id: 'msg-a' }), { status: 200 });
    });
    mailer.__setMailFetchForTesting(fetchMock as unknown as typeof fetch);

    const res = await replayPending();

    expect(res).toMatchObject({ sent: 1, deadLettered: 0, paused: false });
    const rowB = await ledgerRow(b);
    expect(rowB.dead_lettered_at).toBeNull();
    expect(rowB.message_id).toBe('msg-operator');
    expect(alertCalls).toHaveLength(0);
  });

  // Helper: write an unsent ack ledger row with a chosen first_attempt_at.
  // `when` is inlined SQL, so it must never be caller data — it is a literal
  // at every call site here.
  async function seedLedger(id: string, when: string | null) {
    await db.query(
      `INSERT INTO feedback_emails (feedback_id, kind, request, idempotency_key, attempts, first_attempt_at)
       VALUES ($1,'ack',$2,$3,1,${when ?? 'NULL'})`,
      [
        id,
        JSON.stringify({
          from: 'feedback@send.jpmtech.com',
          to: ['sub@example.test'],
          reply_to: 'jason@jpmtech.com',
          subject: 'RepOS — we got your feedback',
          html: '<p>hi</p>',
          text: 'hi',
        }),
        `fb-ack-${id}`,
      ],
    );
  }

  // Helper: seed an unsent row, then run one replay pass.
  async function replayPendingAfterInitial(id: string) {
    await seedLedger(id, 'now()');
    return replayPending();
  }
});

describe('alerting must be configured before a sweep runs', () => {
  it('throws when FEEDBACK_WEBHOOK_URL is unset rather than abandoning people quietly', async () => {
    // replayPending dead-letters and alerts. With no destination, post() returns
    // early and every dead letter is silent — the exact anti-goal the alerting
    // exists to prevent. Fail loudly at the top instead.
    delete process.env.FEEDBACK_WEBHOOK_URL;
    await expect(replayPending()).rejects.toThrow(/FEEDBACK_WEBHOOK_URL/);
  });
});

describe('the 24-hour window is the spec value', () => {
  it('is exactly 24 hours', () => {
    expect(IDEMPOTENCY_WINDOW_MS).toBe(86_400_000);
  });
});
