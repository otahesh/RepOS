// W9 Q33 — the SINGLE deletion state machine. Both DELETE /api/admin/users/:id
// and DELETE /api/me call this; neither path deletes a row directly.
//
// Before this, account.ts:338 deleted the row outright: no status transition,
// no CF removal, no lock, no role check, no account_events row. Two deletion
// paths with different security semantics is the defect — an admin could
// bypass the last-admin guard by deleting themselves through /api/me, causing
// exactly the zero-admin lockout Q13 exists to prevent, and the deleted user's
// email was orphaned in the CF policy forever.
//
// Framing the rule as "at least one active admin must remain" rather than "no
// self-delete" is what makes the two paths reconcilable: the self-action bans
// were a cruder proxy for it.
import { db } from '../db/client.js';
import { withMembershipLock } from './membershipLock.js';
import { syncEmail } from './cfAccessSync.js';
import { CfPolicyError } from './cfAccessPolicy.js';
import { recordAccountEventTx, humanActor } from './accountEvents.js';
import { LifecycleError, inAdminLockedTxn, type Actor } from './userLifecycle.js';

export async function deleteUser(
  targetId: string,
  actor: Actor,
): Promise<{ id: string; previous_token_count: number }> {
  return withMembershipLock(async () => {
    const { rows } = await db.query<{ email: string; status: string; role: string }>(
      `SELECT email, status, role FROM users WHERE id=$1`,
      [targetId],
    );
    if (rows.length === 0) throw new LifecycleError(404, 'user_not_found');
    const cur = rows[0];

    const tok = await db.query<{ n: number }>(
      `SELECT count(*)::int n FROM device_tokens WHERE user_id=$1`,
      [targetId],
    );
    const previous_token_count = tok.rows[0]?.n ?? 0;

    // ---- Phase 1: durable intent (Q17b) ----
    // Skipped when the row is ALREADY deleting: an interrupted delete may be
    // resumed by a different admin, and re-emitting user_delete_requested
    // would attribute the whole operation to whoever finished it and lose the
    // original requester (Q27).
    if (cur.status !== 'deleting') {
      // Lock order (Q26): session lock -> BEGIN -> transaction lock. This is
      // the SAME helper patchUser uses rather than a second hand-rolled copy,
      // so the order cannot drift between the two files.
      await inAdminLockedTxn(async (client) => {
        const remaining = await client.query<{ c: number }>(
          `SELECT count(*)::int c FROM users
            WHERE role='admin' AND status='active' AND id <> $1`,
          [targetId],
        );
        // I2 — refused BEFORE any mutation.
        //
        // Deliberately NOT assertAdminRemains(): that helper throws whenever no
        // other active admin exists, which is right for a demotion but wrong
        // here. Deleting a MEMBER removes no admin, so refusing it because the
        // installation happens to have zero active admins would block an
        // unrelated user's self-deletion. Only a target who IS currently an
        // active admin can breach the invariant.
        if (cur.role === 'admin' && cur.status === 'active' && remaining.rows[0].c === 0) {
          throw new LifecycleError(409, 'last_admin');
        }
        // Q24 — the stamp is cleared because CF membership is about to change.
        await client.query(
          `UPDATE users SET status='deleting', cf_synced_at=NULL WHERE id=$1`,
          [targetId],
        );
        await recordAccountEventTx(client, {
          userId: targetId,
          userEmail: cur.email,
          kind: 'user_delete_requested',
          ip: actor.ip,
          meta: { ...humanActor(actor.userId, actor.email) },
        });
      });
    }

    // ---- Phase 2: CF policy removal ----
    // The DB already denies this user on both auth paths, so a failure here is
    // recoverable: the intent is durable and any admin can resume.
    try {
      await syncEmail(cur.email, 'absent');
      await db.query(`UPDATE users SET cf_synced_at = now() WHERE id=$1`, [targetId]);
    } catch (err) {
      throw new LifecycleError(502, 'cf_sync_failed', {
        sync_error: err instanceof CfPolicyError ? err.code : 'cf_unknown_error',
        resumable: true,
      });
    }

    // ---- Phase 3: the cascade (Q27) ----
    // user_deleted is written immediately before the DELETE, in the SAME
    // transaction, so its user_id_at_event + user_email_at_event snapshot
    // survives the FK ON DELETE SET NULL. If the cascade fails, the event
    // rolls back with it — no event describing a mutation that did not happen.
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await recordAccountEventTx(client, {
        userId: targetId,
        userEmail: cur.email,
        kind: 'user_deleted',
        ip: actor.ip,
        meta: { ...humanActor(actor.userId, actor.email), previous_token_count },
      });
      await client.query('DELETE FROM users WHERE id=$1', [targetId]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    return { id: targetId, previous_token_count };
  });
}
