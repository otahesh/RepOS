// W9 Q31 — reconcile the DB against the live Cloudflare Access policy.
//
// Runs from two places with identical logic and a different `source`:
//   - scripts/cutover/002-w9-cf-baseline.sh, once, at cutover
//   - scripts/run-restore.sh, after migrations, on every restore
//
// It is NOT migration 080: it consults live Cloudflare state, and a migration
// that depends on an external HTTP call is a migration that cannot be applied
// offline. Founding-admin promotion deliberately lives in 080 instead (Q35),
// so every schema-entry path yields a working admin with no CF dependency.
import { db } from '../db/client.js';
import { COHORT_CAP } from '../constants/users.js';
import type { UserStatus } from '../constants/users.js';
import { fetchPolicy, CfPolicyError } from './cfAccessPolicy.js';
import { desiredPresence } from './cfAccessSync.js';
import { recordAccountEventTx, systemActor } from './accountEvents.js';
import { withMembershipLock } from './membershipLock.js';

export type ReconcileAbortCode =
  | 'app_count_not_one'
  | 'non_email_selector'
  | 'cohort_cap_reached'
  | 'cf_unavailable';

export class ReconcileAbort extends Error {
  readonly code: ReconcileAbortCode;
  constructor(code: ReconcileAbortCode, message: string) {
    super(message);
    this.name = 'ReconcileAbort';
    this.code = code;
  }
}

export interface ReconcileResult {
  /** Rows whose membership matched their status and were stamped. */
  stamped: string[];
  /** Rows whose stamp was ACTIVELY set to NULL because membership contradicts status. */
  cleared: string[];
  /** Policy emails that had no users row and were imported as `invited`. */
  imported: string[];
  /** Every email whose membership contradicts its status. */
  divergent: string[];
}

export const RECONCILE_ACTOR_NAME = 'cf_reconciliation';

export async function reconcileCfBaseline(
  source: 'cutover' | 'restore',
): Promise<ReconcileResult> {
  // Q26 — reconciliation IMPORTS rows as `invited`, and `invited` is inside
  // the Q12 counted set, so this is a cohort-membership transition and takes
  // the Q16 mutation lock like every other one. The cutover runs against a
  // LIVE API (Deployment step 5 is after the container is back up), so without
  // the lock a concurrent invite and this import each observe room under the
  // cap independently and the cohort lands at 11; the same window also lets a
  // concurrent suspend/reinstate stamp rows from a policy snapshot that went
  // stale mid-run.
  //
  // Holding it across the fetchPolicy round-trip is the sanctioned pattern,
  // not a violation of Q7: Q16 is a session-level `pg_advisory_lock` on a
  // dedicated pooled connection with NO open transaction, precisely so a CF
  // HTTP call can happen inside it. Being a database lock, it also serializes
  // correctly across processes — this runs as its own `cfReconcile-cli.js`
  // process, not inside the API.
  //
  // Lock order stays Q26's single order: session lock -> BEGIN -> txn lock.
  // The per-import transactions below open inside this lock, never around it.
  //
  // The timeout is generous relative to the API's default: this fetches the
  // policy and then walks every row, and a cutover that fails on lock
  // acquisition is far more disruptive than one that waits.
  return withMembershipLock(() => reconcileLocked(source), { timeoutMs: 60_000 });
}

async function reconcileLocked(
  source: 'cutover' | 'restore',
): Promise<ReconcileResult> {
  // Q10 + Q22 are enforced by fetchPolicy itself: it refuses a policy attached
  // to more than one application, or one containing any non-email selector.
  // Abort rather than reconcile against a policy that has been broadened.
  let snapshot;
  try {
    snapshot = await fetchPolicy();
  } catch (err) {
    if (err instanceof CfPolicyError) {
      if (err.code === 'app_count_not_one' || err.code === 'non_email_selector') {
        throw new ReconcileAbort(err.code, err.message);
      }
      throw new ReconcileAbort('cf_unavailable', err.message);
    }
    throw err;
  }
  const inPolicy = new Set(snapshot.emails);

  const { rows } = await db.query<{ id: string; email: string; status: UserStatus; cf_synced_at: Date | null }>(
    `SELECT id, email, status, cf_synced_at FROM users`,
  );

  const result: ReconcileResult = { stamped: [], cleared: [], imported: [], divergent: [] };
  const known = new Set<string>();

  // (a) Stamp the baseline ACCORDING TO WHAT EACH ROW'S STATUS EXPECTS.
  // For active/invited, presence is synchronized; for suspended/deleting,
  // ABSENCE is synchronized and presence is divergence.
  for (const r of rows) {
    const email = r.email.toLowerCase();
    known.add(email);
    const matches = (desiredPresence(r.status) === 'present') === inPolicy.has(email);
    if (matches) {
      await db.query(`UPDATE users SET cf_synced_at = now() WHERE id=$1`, [r.id]);
      result.stamped.push(r.email);
    } else {
      // Actively NULL, not merely "leave NULL": a restored post-080 row can
      // arrive carrying a stale non-null stamp that must be cleared, or the
      // drift banner shows a green marker over a real divergence.
      if (r.cf_synced_at !== null) {
        await db.query(`UPDATE users SET cf_synced_at = NULL WHERE id=$1`, [r.id]);
        result.cleared.push(r.email);
      }
      result.divergent.push(r.email);
    }
  }

  // (b) Import every policy email that has no row.
  //
  // From `inPolicy`, NOT from snapshot.emails: Cloudflare's include[] is an
  // array of rules with no uniqueness constraint, and toSnapshot flattens it
  // in policy order without deduplicating, so one address listed twice arrives
  // as two entries. Off the raw array the first INSERT committed and the
  // second broke on users_email_key; worse, at a cohort of nine the cap check
  // read 9 + 2 = 11 and aborted the whole run indefinitely. The Set preserves
  // policy order, so the imported list is unchanged for a well-formed policy.
  const toImport = [...inPolicy].filter((e) => !known.has(e));
  if (toImport.length > 0) {
    const { rows: countRows } = await db.query<{ c: number }>(
      `SELECT count(*)::int c FROM users WHERE status IN ('active','invited','deleting')`,
    );
    if (countRows[0].c + toImport.length > COHORT_CAP) {
      throw new ReconcileAbort(
        'cohort_cap_reached',
        `importing ${toImport.length} CF-only identities would carry the cohort to ` +
          `${countRows[0].c + toImport.length}, past the cap of ${COHORT_CAP}`,
      );
    }
  }

  for (const email of toImport) {
    // Imported as `invited`, not `active`, so first sign-in emits
    // user_activated like any other invitee. NO email is sent — these
    // identities were granted out of band and were already told.
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const ins = await client.query<{ id: string }>(
        `INSERT INTO users (email, status, cf_synced_at, invited_at, invited_by, invite_sent_at)
         VALUES ($1, 'invited', now(), now(), NULL, NULL)
         RETURNING id`,
        [email],
      );
      // Q27 — the audit row commits in the SAME transaction as the row it
      // describes. Q23 — the system actor shape, with `source` keeping the
      // run's origin accurate in both invocation paths.
      await recordAccountEventTx(client, {
        userId: ins.rows[0].id,
        userEmail: email,
        kind: 'user_imported',
        ip: null,
        meta: { ...systemActor(RECONCILE_ACTOR_NAME, source) },
      });
      await client.query('COMMIT');
      result.imported.push(email);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  // It deliberately does NOT push DB-only users into the policy — that would
  // grant access as a side effect of a maintenance script.
  return result;
}
