// Feedback triage — the durable state of a fix.
//
// `link` is the manual path, for when a human merges something the agent did
// not push. `reconcile-fixes` (Task 4) is the observed path and owns every
// other transition into a remote-derived state.
import { db } from '../db/client.js';
import { withFeedbackLock } from './feedbackLock.js';
import { FIXABLE } from './feedbackTriage.js';

/** Full lowercase 40-hex. Anything else is refused rather than normalised. */
export const SHA_RE = /^[0-9a-f]{40}$/;

export type FixLifecycleErrorCode =
  | 'not_found'
  | 'bad_sha'
  | 'sha_conflict'
  | 'not_canonical'
  | 'terminal_state';

export class FixLifecycleError extends Error {
  readonly code: FixLifecycleErrorCode;
  constructor(code: FixLifecycleErrorCode, message: string) {
    super(message);
    this.name = 'FixLifecycleError';
    this.code = code;
  }
}

/**
 * Record a merged commit by hand.
 *
 * Refuses to overwrite a different SHA: silently replacing it would change
 * which commit the ancestry check runs against, and could tell somebody their
 * bug shipped when a different commit did.
 */
export async function link(id: string, sha: string): Promise<void> {
  if (!SHA_RE.test(sha)) {
    throw new FixLifecycleError('bad_sha', `not a full lowercase 40-hex SHA: ${sha}`);
  }
  return withFeedbackLock(id, async () => {
    const { rows } = await db.query<{
      fix_commit_sha: string | null;
      fix_status: string;
      dedupe_of: string | null;
    }>(`SELECT fix_commit_sha, fix_status, dedupe_of FROM feedback WHERE id=$1`, [id]);
    if (rows.length === 0) throw new FixLifecycleError('not_found', `feedback ${id} not found`);
    const r = rows[0];
    if (r.dedupe_of !== null) {
      throw new FixLifecycleError(
        'not_canonical',
        'a duplicate does not own a fix; link its canonical row instead',
      );
    }
    if (r.fix_status === 'deferred') {
      throw new FixLifecycleError('terminal_state', 'the row is deferred; no fix is planned');
    }
    if (r.fix_commit_sha !== null && r.fix_commit_sha !== sha) {
      throw new FixLifecycleError(
        'sha_conflict',
        `row already links ${r.fix_commit_sha}; refusing to overwrite with ${sha}`,
      );
    }
    await db.query(`UPDATE feedback SET fix_commit_sha=$2, fix_status='merged' WHERE id=$1`, [
      id,
      sha,
    ]);
  });
}

export interface ResolvableRow {
  id: string;
  effective_fix_sha: string;
  user_email_at_submit: string;
  body: string;
  dedupe_of: string | null;
}

/**
 * Rows that would receive a `resolved` email IF their fix turns out to be
 * deployed. The ancestry check is check-shipped's job; this is only selection.
 *
 * The effective fix SHA is COALESCE(own, canonical-via-dedupe_of). A duplicate
 * never carries its own, so selecting on the row's own column would exclude
 * every duplicate from the step meant to include them — their submitters would
 * be acked and then never told.
 *
 * The category filter mirrors sendResolvedEmail's gate exactly: that gate
 * throws for an unclassified row and for any category outside FIXABLE, and
 * `link` does not require a triaged row. Selecting such a row would throw on
 * every sweep, with no operator action that clears it — a permanently failing
 * `check-shipped`. The category is read from the row itself, not the canonical
 * dedupe target, because the email gate reads it from the row itself too and a
 * duplicate is triaged in its own right.
 */
export async function listResolvable(): Promise<ResolvableRow[]> {
  const { rows } = await db.query<ResolvableRow>(
    `SELECT f.id,
            COALESCE(f.fix_commit_sha, c.fix_commit_sha) AS effective_fix_sha,
            f.user_email_at_submit,
            f.body,
            f.dedupe_of
       FROM feedback f
       LEFT JOIN feedback c ON c.id = f.dedupe_of
      WHERE COALESCE(f.fix_commit_sha, c.fix_commit_sha) IS NOT NULL
        AND f.user_email_at_submit IS NOT NULL
        AND f.category = ANY($1::text[])
        AND NOT EXISTS (
          SELECT 1 FROM feedback_emails e
           WHERE e.feedback_id = f.id AND e.kind IN ('resolved','reply')
        )
      ORDER BY f.created_at, f.id`,
    [FIXABLE],
  );
  return rows;
}
