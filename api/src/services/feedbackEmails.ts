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
