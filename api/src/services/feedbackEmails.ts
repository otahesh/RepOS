// Feedback triage — the email ledger.
//
// This module is what makes full autonomy safe. The category/kind gate, the
// exclusivity rule and the commit-before-send ordering live here, in tested
// code, rather than in the agent's reasoning — so the agent cannot double-send
// even if it misbehaves or a run dies partway.
//
// There is deliberately NO way to send a `resolved` email from here. That kind
// is created only by deployment verification (check-shipped, Plan 2).
import { db } from '../db/client.js';
import { withFeedbackLock } from './feedbackLock.js';
import { FIXABLE, TERMINAL } from './feedbackTriage.js';
import type { FeedbackCategory } from './feedbackTriage.js';
import {
  buildFeedbackRequest,
  fromAddress,
  idempotencyKeyFor,
  parseFeedbackRequest,
  sendFeedbackRequest,
  serializeFeedbackRequest,
  MailerError,
} from './feedbackMailer.js';
import { alertDeadLetter, alertSendingPaused } from './feedbackAlerts.js';

/** Only the two kinds the agent may ever ask for. */
export type SendableKind = 'ack' | 'reply';

export type EmailGateErrorCode =
  | 'not_found'
  | 'not_classified'
  | 'no_recipient'
  | 'kind_not_allowed_for_category'
  | 'exclusive_kind_present';

export class EmailGateError extends Error {
  readonly code: EmailGateErrorCode;
  constructor(code: EmailGateErrorCode, message: string) {
    super(message);
    this.name = 'EmailGateError';
    this.code = code;
  }
}

function kindAllowed(kind: string, category: FeedbackCategory): kind is SendableKind {
  if (kind === 'ack') return FIXABLE.includes(category);
  if (kind === 'reply') return TERMINAL.includes(category);
  return false;
}

export interface SendResult {
  status: 'sent' | 'already_sent' | 'failed';
  messageId?: string;
  error?: string;
}

/**
 * Write the ledger row, COMMIT, then send.
 *
 * The ordering is the whole point: a crash between the commit and the response
 * leaves durable evidence that the attempt happened, which is recoverable. The
 * reverse ordering leaves a silent gap, which is not.
 *
 * An existing row with `sent_at` is a no-op. An existing unsent row REPLAYS its
 * persisted bytes under its persisted key — never a re-render, because deriving
 * the key from re-rendered content is the same bug wearing a hash.
 */
export async function sendFeedbackEmail(input: {
  id: string;
  kind: SendableKind;
  bodyText: string;
}): Promise<SendResult> {
  return withFeedbackLock(input.id, async () => {
    const { rows } = await db.query<{
      category: FeedbackCategory | null;
      user_email_at_submit: string | null;
    }>(`SELECT category, user_email_at_submit FROM feedback WHERE id=$1`, [input.id]);
    if (rows.length === 0) {
      throw new EmailGateError('not_found', `feedback ${input.id} not found`);
    }
    const { category, user_email_at_submit: to } = rows[0];
    if (category === null) {
      throw new EmailGateError('not_classified', 'classify the row before emailing');
    }
    if (!kindAllowed(input.kind, category)) {
      throw new EmailGateError(
        'kind_not_allowed_for_category',
        `kind '${input.kind}' is not permitted for category '${category}'`,
      );
    }
    if (!to) {
      // Classified and triaged, email skipped — no ledger row is written, so
      // listPending's address predicate keeps it out of the queue forever.
      throw new EmailGateError('no_recipient', 'row has no submitter address');
    }

    // `reply` is exclusive with `ack`/`resolved`, and vice versa. The unique
    // constraint cannot express this; the feedback-level lock is what makes
    // checking it safe.
    const exclusive = input.kind === 'reply' ? ['ack', 'resolved'] : ['reply'];
    const { rows: conflicting } = await db.query<{ kind: string }>(
      `SELECT kind FROM feedback_emails WHERE feedback_id=$1 AND kind = ANY($2)`,
      [input.id, exclusive],
    );
    if (conflicting.length > 0) {
      throw new EmailGateError(
        'exclusive_kind_present',
        `a '${conflicting[0].kind}' email already exists for this row`,
      );
    }

    const key = idempotencyKeyFor(input.kind, input.id);
    const from = fromAddress();

    const { rows: existing } = await db.query<{
      id: string;
      request: string;
      sent_at: Date | null;
      dead_lettered_at: Date | null;
    }>(
      `SELECT id, request, sent_at, dead_lettered_at
         FROM feedback_emails WHERE feedback_id=$1 AND kind=$2`,
      [input.id, input.kind],
    );

    let rowId: string;
    let requestJson: string;

    if (existing.length > 0) {
      if (existing[0].sent_at !== null) return { status: 'already_sent' };
      if (existing[0].dead_lettered_at !== null) {
        return { status: 'failed', error: 'dead-lettered; not retried' };
      }
      rowId = existing[0].id;
      requestJson = existing[0].request;
    } else {
      const request = buildFeedbackRequest({
        kind: input.kind,
        toEmail: to,
        feedbackId: input.id,
        bodyText: input.bodyText,
      });
      requestJson = serializeFeedbackRequest(request);
      const { rows: inserted } = await db.query<{ id: string }>(
        `INSERT INTO feedback_emails (feedback_id, kind, request, idempotency_key)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [input.id, input.kind, requestJson, key],
      );
      rowId = inserted[0].id;
    }

    // `db` is a Pool and each query auto-commits, so the row above is durable
    // before the call below. Nothing here opens a transaction on purpose.
    await db.query(
      `UPDATE feedback_emails
          SET attempts = attempts + 1,
              first_attempt_at = COALESCE(first_attempt_at, now()),
              last_attempt_at = now()
        WHERE id = $1`,
      [rowId],
    );

    try {
      const request = parseFeedbackRequest(requestJson, to, from);
      const { messageId } = await sendFeedbackRequest(request, key, to);
      await db.query(
        `UPDATE feedback_emails SET sent_at=now(), message_id=$2, error=NULL WHERE id=$1`,
        [rowId, messageId],
      );
      return { status: 'sent', messageId };
    } catch (err) {
      const detail =
        err instanceof MailerError
          ? `${err.code}: ${err.message}${err.detail ? ` — ${err.detail}` : ''}`
          : String(err);
      await db.query(`UPDATE feedback_emails SET error=$2 WHERE id=$1`, [
        rowId,
        detail.slice(0, 500),
      ]);
      return { status: 'failed', error: detail };
    }
  });
}

/** Resend forgets an idempotency key after 24 hours. */
export const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

export type FailureClass = 'retryable' | 'auth' | 'recipient';

/**
 * Failures are classified by WHOSE fault they are, because "4xx that is not
 * 429" lumps together two opposite situations.
 *
 * 401/403 says nothing about the message and applies to every message: it is
 * never a reason to abandon a recipient. Everything else 4xx is about this
 * recipient and will not improve with retrying.
 */
export function classifyFailure(err: unknown): FailureClass {
  if (err instanceof MailerError) {
    if (err.code === 'mail_timeout' || err.code === 'mail_not_configured') return 'retryable';
    const status = err.status;
    if (status === undefined) return 'retryable'; // transport/network
    if (status === 401 || status === 403) return 'auth';
    if (status === 429 || status >= 500) return 'retryable';
    return 'recipient';
  }
  return 'retryable';
}

interface PendingRow {
  id: string;
  feedback_id: string;
  kind: string;
  request: string;
  idempotency_key: string;
  first_attempt_at: Date | null;
  user_email_at_submit: string | null;
}

/**
 * Re-attempt every ledger row that is written but unsent.
 *
 * This verb is why the retry policy is real. `listPending` deliberately
 * excludes rows that already have a ledger row, and `listUntriaged` never
 * returns a classified row, so without this nothing would ever select a
 * network-failed send: it would sit untouched until it aged past 24 hours and
 * was dead-lettered with zero retries actually attempted.
 *
 * Sending halts entirely on an auth failure — nothing is consumed, so the queue
 * drains intact once the key is fixed.
 */
export async function replayPending(
  opts: { now?: Date } = {},
): Promise<{ sent: number; deadLettered: number; paused: boolean }> {
  const now = opts.now ?? new Date();
  const { rows } = await db.query<PendingRow>(
    `SELECT e.id, e.feedback_id, e.kind, e.request, e.idempotency_key, e.first_attempt_at,
            f.user_email_at_submit
       FROM feedback_emails e
       JOIN feedback f ON f.id = e.feedback_id
      WHERE e.sent_at IS NULL AND e.dead_lettered_at IS NULL
      ORDER BY e.first_attempt_at NULLS FIRST, e.id`,
  );

  let sent = 0;
  let deadLettered = 0;

  for (const row of rows) {
    const expired =
      row.first_attempt_at !== null &&
      now.getTime() - row.first_attempt_at.getTime() > IDEMPOTENCY_WINDOW_MS;

    if (expired) {
      // Ambiguous: the message may well have been delivered and only the
      // response lost. Past the window there is no way to tell, and this design
      // would rather a submitter miss an acknowledgement than receive it twice.
      await db.query(
        `UPDATE feedback_emails
            SET dead_lettered_at=now(),
                error=COALESCE(error,'') || ' | abandoned: past the 24h idempotency window'
          WHERE id=$1`,
        [row.id],
      );
      deadLettered += 1;
      await alertDeadLetter({
        feedbackId: row.feedback_id,
        kind: row.kind,
        recipient: row.user_email_at_submit ?? '(address gone)',
        error: 'past the 24h idempotency window',
      });
      continue;
    }

    if (!row.user_email_at_submit) {
      await db.query(
        `UPDATE feedback_emails
            SET dead_lettered_at=now(), error='recipient address is gone'
          WHERE id=$1`,
        [row.id],
      );
      deadLettered += 1;
      await alertDeadLetter({
        feedbackId: row.feedback_id,
        kind: row.kind,
        recipient: '(address gone)',
        error: 'recipient address is gone',
      });
      continue;
    }

    const to = row.user_email_at_submit;
    const outcome = await withFeedbackLock(row.feedback_id, async () => {
      // Make the claim atomic with the check: another replayPending run (a
      // cron tick racing an operator's CLI invocation) may have sent or
      // dead-lettered this exact row between our batch SELECT above and this
      // lock. A separate SELECT-then-UPDATE would just move the race: the
      // guard has to live in the WHERE clause of the row-claiming UPDATE
      // itself, not depend on Resend's idempotency window to save us.
      const claimed = await db.query(
        `UPDATE feedback_emails
            SET attempts = attempts + 1,
                first_attempt_at = COALESCE(first_attempt_at, now()),
                last_attempt_at = now()
          WHERE id = $1 AND sent_at IS NULL AND dead_lettered_at IS NULL`,
        [row.id],
      );
      if (claimed.rowCount === 0) {
        // Another runner already sent or abandoned this row. It is no longer
        // ours to send.
        return { kind: 'skipped' as const };
      }
      try {
        const request = parseFeedbackRequest(row.request, to, fromAddress());
        const { messageId } = await sendFeedbackRequest(request, row.idempotency_key, to);
        await db.query(
          `UPDATE feedback_emails SET sent_at=now(), message_id=$2, error=NULL WHERE id=$1`,
          [row.id, messageId],
        );
        return { kind: 'sent' as const };
      } catch (err) {
        const cls = classifyFailure(err);
        const detail = err instanceof Error ? err.message : String(err);
        await db.query(`UPDATE feedback_emails SET error=$2 WHERE id=$1`, [
          row.id,
          detail.slice(0, 500),
        ]);
        if (cls === 'recipient') {
          await db.query(`UPDATE feedback_emails SET dead_lettered_at=now() WHERE id=$1`, [row.id]);
          await alertDeadLetter({
            feedbackId: row.feedback_id,
            kind: row.kind,
            recipient: to,
            error: detail,
          });
          return { kind: 'dead' as const };
        }
        if (cls === 'auth') return { kind: 'auth' as const };
        return { kind: 'retry' as const };
      }
    });

    if (outcome.kind === 'sent') sent += 1;
    else if (outcome.kind === 'dead') deadLettered += 1;
    else if (outcome.kind === 'auth') {
      // Halt. Nothing further is attempted or consumed this run.
      await alertSendingPaused({ reason: 'Resend rejected our credentials (401/403)' });
      return { sent, deadLettered, paused: true };
    }
    // 'skipped': another runner already claimed this row. Counts toward
    // neither total; the loop continues to the next row rather than halting.
  }

  return { sent, deadLettered, paused: false };
}
