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
    const { rows: self } = await db.query<{ id: string }>(`SELECT id FROM feedback WHERE id=$1`, [
      input.id,
    ]);
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
    // duplication was spotted.
    const fixStatus: FixStatus = input.dedupeOf
      ? 'n/a'
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
