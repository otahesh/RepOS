// The sole writer of every remote-derived fix_status.
//
// submit-patch and open-pr write NOTHING to the database. Their responses can
// be lost — a push can succeed and the reply never arrive — so if they wrote
// the state, a lost response would leave the row claiming less than reality.
// Here the state is observed instead, and an interrupted attempt resumes from
// what is actually on the remote.
import { db } from '../db/client.js';
import { withFeedbackLock, LockTimeoutError } from './feedbackLock.js';
import { SHA_RE } from './fixLifecycle.js';
import { lookupBranch, lookupPrForBranch } from './githubState.js';
import type { FixStatus } from './feedbackTriage.js';

export interface ReconcileResult {
  examined: number;
  changed: number;
  unchanged: number;
  errored: number;
}

/** The states this function owns. Anything else it leaves entirely alone. */
const OBSERVABLE: readonly FixStatus[] = ['needed', 'patch_submitted', 'pr_open'];

export async function reconcileFixes(): Promise<ReconcileResult> {
  const result: ReconcileResult = { examined: 0, changed: 0, unchanged: 0, errored: 0 };

  const { rows } = await db.query<{
    id: string;
    fix_status: FixStatus;
    fix_pr_number: number | null;
    fix_commit_sha: string | null;
  }>(
    `SELECT id, fix_status, fix_pr_number, fix_commit_sha
       FROM feedback
      WHERE fix_status = ANY($1::text[])
        AND dedupe_of IS NULL
      ORDER BY created_at, id`,
    [OBSERVABLE],
  );
  result.examined = rows.length;

  for (const row of rows) {
    const branch = `feedback/${row.id}`;
    let next: { status: FixStatus; pr: number | null; sha: string | null };

    try {
      const [branchState, pr] = await Promise.all([
        lookupBranch(branch),
        lookupPrForBranch(branch),
      ]);

      if (pr?.merged) {
        if (pr.mergeCommitSha === null || !SHA_RE.test(pr.mergeCommitSha)) {
          // A merged PR with no usable SHA cannot drive ship detection.
          // Leave the row where it is rather than record something the
          // ancestry check will refuse.
          throw new Error(`merged pr #${pr.number} has no usable merge_commit_sha`);
        }
        next = { status: 'merged', pr: pr.number, sha: pr.mergeCommitSha };
      } else if (pr && pr.state === 'open') {
        next = { status: 'pr_open', pr: pr.number, sha: row.fix_commit_sha };
      } else if (branchState.exists) {
        next = { status: 'patch_submitted', pr: null, sha: row.fix_commit_sha };
      } else {
        // No branch, no open PR, not merged: the attempt is gone. Back to
        // workable — but only from a state this function owns, which is why
        // `merged` and `deferred` were never selected above.
        next = { status: 'needed', pr: null, sha: row.fix_commit_sha };
      }
    } catch {
      result.errored += 1;
      continue;
    }

    const unchanged =
      next.status === row.fix_status &&
      next.pr === row.fix_pr_number &&
      next.sha === row.fix_commit_sha;
    if (unchanged) {
      result.unchanged += 1;
      continue;
    }

    try {
      await withFeedbackLock(row.id, async () => {
        // Re-check under the lock: triage or defer may have moved the row out
        // of an observable state since the batch SELECT.
        const { rowCount } = await db.query(
          `UPDATE feedback
              SET fix_status=$2, fix_branch=$3, fix_pr_number=$4,
                  fix_commit_sha=COALESCE($5, fix_commit_sha)
            WHERE id=$1
              AND fix_status = ANY($6::text[])
              AND dedupe_of IS NULL`,
          [row.id, next.status, next.status === 'needed' ? null : branch, next.pr, next.sha, OBSERVABLE],
        );
        if (rowCount === 1) result.changed += 1;
        else result.unchanged += 1;
      });
    } catch (err) {
      if (err instanceof LockTimeoutError) {
        result.errored += 1;
        continue;
      }
      // Deliberate: any other error here aborts the sweep with no partial
      // ReconcileResult, rather than swallowing a real bug to keep going.
      throw err;
    }
  }

  return result;
}
