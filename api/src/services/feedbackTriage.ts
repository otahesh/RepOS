// Feedback triage — classification. The mechanical half of the design: this is
// tested code so that the agent's only job is judgement, never bookkeeping.
import { db } from '../db/client.js';
import { withFeedbackLock, withFeedbackPairLock } from './feedbackLock.js';

export type FeedbackCategory = 'bug' | 'ux' | 'feature' | 'question' | 'noise';
export type FeedbackSeverity = 'p1' | 'p2' | 'p3';
export type FixStatus = 'n/a' | 'needed' | 'patch_submitted' | 'pr_open' | 'merged' | 'deferred';

/** Categories that can produce a fix, and therefore an ack/resolved pair. */
export const FIXABLE: readonly FeedbackCategory[] = ['bug', 'ux', 'feature'];
/** Categories that get exactly one terminal `reply`. */
export const TERMINAL: readonly FeedbackCategory[] = ['question', 'noise'];

export type TriageErrorCode =
  | 'not_found'
  | 'note_required'
  | 'severity_required'
  | 'severity_not_allowed'
  | 'dedupe_self'
  | 'dedupe_target_not_found'
  | 'dedupe_not_canonical'
  | 'dedupe_has_dependants'
  | 'not_classified'
  | 'reason_required';

export class TriageError extends Error {
  readonly code: TriageErrorCode;
  constructor(code: TriageErrorCode, message: string) {
    super(message);
    this.name = 'TriageError';
    this.code = code;
  }
}

export interface TriageInput {
  id: string;
  category: FeedbackCategory;
  severity?: FeedbackSeverity | null;
  note: string;
  dedupeOf?: string | null;
}

/**
 * Classify a row.
 *
 * Re-runnable: a misclassification is corrected by running this again. It never
 * un-sends an email, so the email rules are evaluated against whatever the
 * category is at send time.
 *
 * `triaged_at` uses COALESCE deliberately — it means "somebody looked at this",
 * matching the admin UI's meaning from 070, and must not creep forward on every
 * re-triage. Queue membership is `category IS NULL`, never this column.
 */
export async function triage(input: TriageInput): Promise<void> {
  const note = input.note.trim();
  if (note === '') throw new TriageError('note_required', 'a triage note is required');

  const wantsSeverity = FIXABLE.includes(input.category);
  if (wantsSeverity && !input.severity) {
    throw new TriageError('severity_required', `${input.category} requires a severity`);
  }
  if (!wantsSeverity && input.severity) {
    throw new TriageError('severity_not_allowed', `${input.category} takes no severity`);
  }
  if (input.dedupeOf && String(input.dedupeOf) === String(input.id)) {
    throw new TriageError('dedupe_self', 'a row cannot be its own duplicate');
  }

  const run = async () => {
    const { rows: self } = await db.query<{ id: string; fix_status: FixStatus }>(
      `SELECT id, fix_status FROM feedback WHERE id=$1`,
      [input.id],
    );
    if (self.length === 0) throw new TriageError('not_found', `feedback ${input.id} not found`);

    if (input.dedupeOf) {
      const { rows: target } = await db.query<{ id: string; dedupe_of: string | null }>(
        `SELECT id, dedupe_of FROM feedback WHERE id=$1`,
        [input.dedupeOf],
      );
      if (target.length === 0) {
        throw new TriageError('dedupe_target_not_found', `feedback ${input.dedupeOf} not found`);
      }
      // Only a canonical row may be a dedupe target: chains are forbidden, and
      // check-shipped resolves exactly one hop through dedupe_of.
      if (target[0].dedupe_of !== null) {
        throw new TriageError('dedupe_not_canonical', 'dedupe target is itself a duplicate');
      }
      const { rows: dependants } = await db.query(
        `SELECT 1 FROM feedback WHERE dedupe_of=$1 LIMIT 1`,
        [input.id],
      );
      if (dependants.length > 0) {
        throw new TriageError(
          'dedupe_has_dependants',
          'other rows point at this one; it cannot become a duplicate',
        );
      }
    }

    // A duplicate's canonical row owns the fix, so the duplicate never enters
    // the fix queue — including a row that was already `needed` when the
    // duplication was spotted. This test stays FIRST: it is load-bearing and
    // outranks every decided state below.
    //
    // Otherwise a fix_status that records a DECISION or work already done is
    // left alone. Recomputing it unconditionally would undo a `defer` (reachable
    // today: `defer` then `triage`) and, once the git verbs land, would reset
    // patch_submitted / pr_open / merged and re-open the fix queue for work that
    // has already shipped.
    const decided: readonly FixStatus[] = ['patch_submitted', 'pr_open', 'merged', 'deferred'];
    const fixStatus: FixStatus = input.dedupeOf
      ? 'n/a'
      : decided.includes(self[0].fix_status)
        ? self[0].fix_status
        : FIXABLE.includes(input.category)
          ? 'needed'
          : 'n/a';

    await db.query(
      `UPDATE feedback
          SET category    = $2,
              severity    = $3,
              triage_note = $4,
              dedupe_of   = $5,
              fix_status  = $6,
              triaged_at  = COALESCE(triaged_at, now())
        WHERE id = $1`,
      [input.id, input.category, input.severity ?? null, note, input.dedupeOf ?? null, fixStatus],
    );
  };

  // Both rows are locked when a dedupe target is involved, in ascending id
  // order, so `A.dedupe_of = B` cannot race `B.dedupe_of = C` into a chain.
  return input.dedupeOf
    ? withFeedbackPairLock(input.id, input.dedupeOf, run)
    : withFeedbackLock(input.id, run);
}

/**
 * Terminal "no fix is planned". Without this a feature request nobody intends
 * to build sits in the fix queue forever.
 */
export async function defer(id: string, reason: string): Promise<void> {
  const trimmed = reason.trim();
  if (trimmed === '') throw new TriageError('reason_required', 'a defer reason is required');

  return withFeedbackLock(id, async () => {
    const { rows } = await db.query<{ category: string | null; triage_note: string | null }>(
      `SELECT category, triage_note FROM feedback WHERE id=$1`,
      [id],
    );
    if (rows.length === 0) throw new TriageError('not_found', `feedback ${id} not found`);
    if (rows[0].category === null) {
      throw new TriageError('not_classified', 'classify the row before deferring it');
    }
    const note = `${rows[0].triage_note ?? ''}\n\nDeferred: ${trimmed}`.trim();
    await db.query(`UPDATE feedback SET fix_status='deferred', triage_note=$2 WHERE id=$1`, [
      id,
      note,
    ]);
  });
}

export interface QueueRow {
  id: string;
  body: string;
  route: string | null;
  created_at: Date;
  category: FeedbackCategory | null;
  severity: FeedbackSeverity | null;
  user_email_at_submit: string | null;
  fix_status: FixStatus;
  dedupe_of: string | null;
}

const QUEUE_COLS = `id, body, route, created_at, category, severity,
                    user_email_at_submit, fix_status, dedupe_of`;

/**
 * The agent's intake queue.
 *
 * `category IS NULL`, never `triaged_at IS NULL`. PATCH /admin/feedback/:id/
 * triage sets only triaged_at, so a triaged_at-based queue would silently drop
 * any row a human clicked in the admin UI — classified by nobody, answered by
 * nobody.
 */
export async function listUntriaged(): Promise<QueueRow[]> {
  const { rows } = await db.query<QueueRow>(
    `SELECT ${QUEUE_COLS} FROM feedback WHERE category IS NULL ORDER BY created_at, id`,
  );
  return rows;
}

/**
 * Classified rows whose required first email was never written at all.
 *
 * This is the crash gap: the moment `triage` commits a category the row leaves
 * listUntriaged, and if the run dies before the ledger row is written nothing
 * else selects it. The written-but-unsent case is NOT here — that is
 * replayPending's job, and the two are stranded by different mechanisms.
 *
 * The membership test is ANY email, not the kind the CURRENT category calls
 * for. The guarantee being enforced is "the submitter has not heard back", and
 * any email means they have. A kind-specific test strands a re-triaged row
 * forever: triage `bug`, send its `ack`, then re-triage `noise`, and the row
 * now demands a `reply` that sendFeedbackEmail refuses to create
 * (`exclusive_kind_present`, because the ack exists). It would be re-queued
 * every sweep with no action able to clear it, and nothing would alert. The
 * spec explicitly permits re-triage across this boundary and says it never
 * un-sends an email, so the queue must tolerate it.
 */
export async function listPending(): Promise<QueueRow[]> {
  const { rows } = await db.query<QueueRow>(
    `SELECT ${QUEUE_COLS}
       FROM feedback f
      WHERE f.category IS NOT NULL
        AND f.user_email_at_submit IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM feedback_emails e WHERE e.feedback_id = f.id
        )
      ORDER BY f.created_at, f.id`,
  );
  return rows;
}

/**
 * Acknowledged items whose fix is unfinished.
 *
 * `dedupe_of IS NULL` matters: a duplicate's canonical row owns the fix, so
 * including duplicates would open two pull requests for one defect.
 */
export async function listFixPending(): Promise<QueueRow[]> {
  const { rows } = await db.query<QueueRow>(
    `SELECT ${QUEUE_COLS}
       FROM feedback
      WHERE fix_status IN ('needed','patch_submitted','pr_open')
        AND dedupe_of IS NULL
      ORDER BY created_at, id`,
  );
  return rows;
}

/** Sends that were abandoned, so a human can see who never heard back. */
export async function listDeadLettered(): Promise<
  Array<{
    feedback_id: string;
    kind: string;
    error: string | null;
    dead_lettered_at: Date;
    user_email_at_submit: string | null;
  }>
> {
  const { rows } = await db.query<{
    feedback_id: string;
    kind: string;
    error: string | null;
    dead_lettered_at: Date;
    user_email_at_submit: string | null;
  }>(
    `SELECT e.feedback_id, e.kind, e.error, e.dead_lettered_at, f.user_email_at_submit
       FROM feedback_emails e
       JOIN feedback f ON f.id = e.feedback_id
      WHERE e.dead_lettered_at IS NOT NULL
      ORDER BY e.dead_lettered_at DESC`,
  );
  return rows;
}
