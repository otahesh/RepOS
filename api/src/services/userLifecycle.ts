// W9 — the user lifecycle state machine.
//
// One rule governs the ordering of every operation here (Q17):
//   GRANTS TAKE EFFECT LAST, REVOCATIONS TAKE EFFECT FIRST,
// where "takes effect" means *at the layer checked on every request*. Only the
// DB is that layer. Removing an email from the CF policy does NOT revoke
// access: Access evaluates policy at AUTHENTICATION, and an issued session
// remains valid for its duration — 24h on this app's policy.
//
// Every membership transition runs under the same session-level advisory lock
// (Q26), and the Cloudflare call never happens inside a DB transaction (Q7).
import { db } from '../db/client.js';
import { COHORT_CAP } from '../constants/users.js';
import type { UserRole, UserStatus } from '../constants/users.js';
import { withMembershipLock } from './membershipLock.js';
import { syncEmail, syncEmailToStatus } from './cfAccessSync.js';
import { CfPolicyError } from './cfAccessPolicy.js';
import {
  buildInviteRequest,
  sendInviteRequest,
  serializeInviteRequest,
  parseInviteRequest,
  initialIdempotencyKey,
  resendIdempotencyKey,
  MailerError,
  SUPPORT_CONTACT,
  type InviteRequest,
} from './inviteMailer.js';
import { recordAccountEventTx, humanActor } from './accountEvents.js';

export interface Actor {
  userId: string;
  email: string;
  ip: string | null;
}

export class LifecycleError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: Record<string, unknown>;
  constructor(statusCode: number, code: string, details: Record<string, unknown> = {}) {
    super(code);
    this.name = 'LifecycleError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export interface InviteOutcome {
  id: string;
  email: string;
  status: UserStatus;
  /**
   * True ONLY on the path that INSERTs a users row — the single thing that
   * makes the response a 201. Required, not optional: an optional flag lets a
   * new return site forget it and silently fall back to 200, which is the
   * class of bug that made the route's old `resent`/`resynced` inference wrong
   * in the first place. Every exit from inviteUser must state it.
   */
  created: boolean;
  cf_synced: boolean;
  invite_sent: boolean;
  sync_error: string | null;
  mail_error: string | null;
  resent?: boolean;
  resynced?: boolean;
}

function syncErrorCode(err: unknown): string {
  return err instanceof CfPolicyError ? err.code : 'cf_unknown_error';
}
function mailErrorCode(err: unknown): string {
  return err instanceof MailerError ? err.code : 'mail_unknown_error';
}

/** Q12 — the counted set is active + invited + deleting. */
async function countCohort(): Promise<number> {
  const { rows } = await db.query<{ c: number }>(
    `SELECT count(*)::int c FROM users WHERE status IN ('active','invited','deleting')`,
  );
  return rows[0].c;
}

/**
 * The address the invite body must name, recovered from state that was
 * committed BEFORE any I/O, so every retry of a never-delivered invite renders
 * byte-identical content and can therefore safely share one idempotency key.
 *
 * `user_invited` and `user_imported` are both written in the same transaction
 * as the row they describe (Q27), so exactly one exists for every `invited`
 * row and neither can be lost to a later mutation. `meta.actor_email` is a
 * frozen snapshot: unlike a join through `invited_by` (which is
 * ON DELETE SET NULL) it survives the inviting admin being deleted, so the
 * replay stays stable even then.
 *
 * Q31b imports carry the Q23 SYSTEM actor shape and therefore have no
 * actor_email at all — that is the designed state of every imported row, not
 * an edge case, since the cutover creates them `invited` with `invited_by
 * NULL` and `invite_sent_at NULL`. They resolve to a constant, which is
 * equally stable across attempts.
 */
async function originalSender(userId: string): Promise<string> {
  const { rows } = await db.query<{ kind: string; meta: Record<string, unknown> | null }>(
    `SELECT kind, meta FROM account_events
      WHERE user_id=$1 AND kind IN ('user_invited','user_imported')
      ORDER BY id ASC`,
    [userId],
  );
  // Validate, never default. Collapsing "no event", "null meta" or "a
  // user_invited carrying the wrong actor shape" onto the support constant
  // would silently pair the ORIGINAL key with a DIFFERENT body — recreating
  // the 409 this function exists to prevent — while hiding a broken Q27
  // invariant behind a plausible-looking send. Exactly one event must exist,
  // and its shape must match its kind.
  if (rows.length !== 1) {
    throw new LifecycleError(500, 'invite_provenance_invalid', {
      reason: rows.length === 0 ? 'no_user_invited_or_imported_event' : 'multiple_events',
      count: rows.length,
    });
  }
  const { kind, meta } = rows[0];
  if (kind === 'user_invited') {
    // Q23 human shape. The address is the payload, so it must be present.
    if (
      !meta || meta.actor_kind !== 'user' ||
      typeof meta.actor_email !== 'string' || meta.actor_email === ''
    ) {
      throw new LifecycleError(500, 'invite_provenance_invalid', { reason: 'malformed_human_actor' });
    }
    return meta.actor_email;
  }
  // Q31b import: the Q23 SYSTEM shape carries no actor_email by design, so the
  // constant IS the durable answer here — but only for a correctly shaped
  // system event, never as a catch-all.
  if (!meta || meta.actor_kind !== 'system') {
    throw new LifecycleError(500, 'invite_provenance_invalid', { reason: 'malformed_system_actor' });
  }
  return SUPPORT_CONTACT;
}

/**
 * Load the frozen request for this invite, minting one on first use.
 *
 * Q30 says a retry after a lost acknowledgement must not deliver twice, and
 * Resend collapses two sends only when they are BYTE-IDENTICAL under one key.
 * Re-rendering cannot meet that bar: INVITE_FROM_EMAIL is environment-supplied
 * and the copy ships with the deployment, so a redeploy inside the 24h window
 * would either drift the body (409, invite stuck for a day) or force a new key
 * (a second delivery — the thing Q30 forbids). Freeze once, replay thereafter.
 *
 * Stored as TEXT on `users` (migration 081), NOT as jsonb and NOT in
 * account_events:
 *   - jsonb canonicalises key order — PG16 rewrites {from,to,subject,html,text}
 *     as {to,from,html,text,subject} — so a jsonb round-trip would itself
 *     destroy the byte-identity the column exists to preserve.
 *   - 060 declares account_events append-only ("no UPDATE"), and a frozen
 *     payload is operational state, not an audit event: it has no business in
 *     a user's visible timeline.
 *
 * Called OUTSIDE the creation transaction, on the send path. A missing
 * INVITE_FROM_EMAIL therefore surfaces as a mail failure on a durable invited
 * row rather than rolling back the invitation — the frozen error contract says
 * a mail-side failure leaves the row with invite_sent_at NULL and a retry
 * affordance, and discarding admin intent over a config gap would break it.
 */
async function frozenInviteRequest(userId: string, email: string): Promise<InviteRequest> {
  const { rows } = await db.query<{ invite_request: string | null }>(
    `SELECT invite_request FROM users WHERE id=$1`,
    [userId],
  );
  const stored = rows[0]?.invite_request;
  if (stored !== null && stored !== undefined) return parseInviteRequest(stored, email);

  const request = buildInviteRequest({
    toEmail: email,
    invitedByEmail: await originalSender(userId),
  });
  // Commit the freeze before any I/O, so a crash between here and the send
  // replays these exact bytes rather than re-rendering them.
  await db.query(
    `UPDATE users SET invite_request=$2 WHERE id=$1 AND invite_request IS NULL`,
    [userId, serializeInviteRequest(request)],
  );
  // Re-read: if a concurrent attempt won the freeze, replay ITS bytes, not ours.
  const { rows: after } = await db.query<{ invite_request: string | null }>(
    `SELECT invite_request FROM users WHERE id=$1`,
    [userId],
  );
  return parseInviteRequest(after[0].invite_request as string, email);
}

/**
 * Attempt the CF add, then freeze-and-mail. Shared by the fresh-invite and the
 * retry-then-send branch of Q29. Never throws for a sync or mail failure —
 * both are recorded on the outcome so the row survives with a retry
 * affordance (Q8). Rollback would discard admin intent and race the email.
 *
 * `makeRequest` is a THUNK, evaluated here after the stamp, and deliberately
 * not a value the caller has already computed. Q7 fixes the order as
 * sync → stamp → email, which means a mail-side failure must leave the invitee
 * PROVISIONED. Building the request first inverts that: an unset
 * INVITE_FROM_EMAIL, or an unusable frozen row, would return a mail_error with
 * `cf_synced_at` still NULL — an invitee absent from the CF policy, unable to
 * sign in, over a failure that had nothing to do with Cloudflare. Freezing is
 * mail-side work and belongs after the boundary that makes the row usable.
 *
 * A LifecycleError propagates rather than being flattened into `mail_error`: a
 * broken Q27 provenance is a server fault (500), not a delivery outcome, and
 * reporting it as a mail failure would offer a retry affordance for something
 * no retry can fix.
 */
async function provisionAndMail(
  userId: string,
  email: string,
  invitedAt: Date,
  makeRequest: () => Promise<InviteRequest>,
  idempotencyKey: string,
): Promise<{ cf_synced: boolean; invite_sent: boolean; sync_error: string | null; mail_error: string | null }> {
  try {
    await syncEmail(email, 'present');
  } catch (err) {
    return { cf_synced: false, invite_sent: false, sync_error: syncErrorCode(err), mail_error: null };
  }
  // Q7 — stamp only after a successful sync. The row becomes activatable here
  // and not one instruction earlier.
  await db.query(`UPDATE users SET cf_synced_at = now() WHERE id=$1`, [userId]);

  let request: InviteRequest;
  try {
    request = await makeRequest();
  } catch (err) {
    if (err instanceof LifecycleError) throw err;
    // Provisioned, not mailed — the row is durable and the invitee can sign in.
    return { cf_synced: true, invite_sent: false, sync_error: null, mail_error: mailErrorCode(err) };
  }

  try {
    const { messageId } = await sendInviteRequest(request, idempotencyKey, email);
    await db.query(
      `UPDATE users SET invite_sent_at = now(), invite_message_id = $2 WHERE id=$1`,
      [userId, messageId],
    );
    return { cf_synced: true, invite_sent: true, sync_error: null, mail_error: null };
  } catch (err) {
    // The user is already in the CF policy and CAN sign in; the admin resends.
    return { cf_synced: true, invite_sent: false, sync_error: null, mail_error: mailErrorCode(err) };
  }
}

export async function inviteUser(
  email: string,
  role: UserRole,
  actor: Actor,
): Promise<InviteOutcome> {
  const target = email.toLowerCase();
  // Q18 — the cap check and the insert happen inside the SAME critical section
  // as the CF sync. A bare count-then-insert races: two admins each observe 9
  // and both insert, yielding 11.
  return withMembershipLock(async () => {
    const existing = await db.query<{
      id: string; status: UserStatus; cf_synced_at: Date | null;
      invited_at: Date | null; invite_sent_at: Date | null;
    }>(
      `SELECT id, status, cf_synced_at, invited_at, invite_sent_at FROM users WHERE lower(email)=$1`,
      [target],
    );

    // Q29 — duplicate invite is explicit per current status. users.email is
    // UNIQUE, so the un-specified path was a raw constraint violation
    // surfacing as a 500.
    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      if (row.status === 'active') throw new LifecycleError(409, 'already_active');
      if (row.status === 'suspended') throw new LifecycleError(409, 'suspended_use_reinstate');
      if (row.status === 'deleting') throw new LifecycleError(409, 'deletion_in_progress');

      const invitedAt = row.invited_at ?? new Date();

      // Q30 — the key is chosen by whether a delivery has ever SUCCEEDED, not
      // by which retry branch we are in. `invite_sent_at` is the only durable
      // record of that, and it is written only after sendInviteRequest resolves.
      //
      // The case that forces this: Resend ACCEPTS the initial send but the
      // response times out. The row is left invited + CF-synced +
      // invite_sent_at NULL, so a retry lands in the "already provisioned"
      // branch below — which used to mint a FRESH key and deliver the same
      // initial invite a second time. Resend only deduplicates retries that
      // reuse the same key, so the deterministic initial key is the only thing
      // that collapses them. A fresh key is correct exclusively when a prior
      // delivery is known-successful, which is what Q30 means by "a deliberate
      // second delivery".
      // Reusing the deterministic key OBLIGES us to reproduce the original
      // request body, because Resend deduplicates only IDENTICAL requests
      // sharing a key and returns 409 invalid_idempotent_request otherwise.
      // Rendering the retry with the CURRENT admin's address breaks that:
      // Admin A's send is accepted, the response is lost, Admin B retries, and
      // the body now names B against A's key.
      //
      // So the sender is resolved from durable state rather than from the
      // caller — see originalSender(). Both the key and the body are then pure
      // functions of the row, which is what makes the retry a true replay.
      // There is deliberately NO fresh-key fallback on this branch: a fresh key
      // per attempt would defeat Q30 outright, since a lost ack leaves the row
      // untouched and the next attempt would deliver again.
      const neverDelivered = row.invite_sent_at === null;
      const idempotencyKey = neverDelivered
        ? initialIdempotencyKey(row.id, invitedAt)
        : resendIdempotencyKey(row.id);
      // A never-delivered invite REPLAYS its frozen request; a known-successful
      // prior delivery is a deliberate new one, so it renders fresh under a
      // fresh key and has no earlier request to match. Either can fail on a
      // missing INVITE_FROM_EMAIL, which is a MAIL failure on a durable row —
      // never a reason to unwind the invitation, and (on the unsynced branch
      // below) never a reason to skip provisioning. Hence a thunk rather than a
      // value: provisionAndMail evaluates it only after the CF add and the
      // stamp, so a config gap cannot strand the row with cf_synced_at NULL.
      const makeRequest = async (): Promise<InviteRequest> =>
        neverDelivered
          ? await frozenInviteRequest(row.id, target)
          : buildInviteRequest({ toEmail: target, invitedByEmail: actor.email });

      if (row.cf_synced_at === null) {
        // Provisioning failed last time: retry the sync FIRST and send only if
        // it succeeds. Mailing unconditionally would send a link the invitee
        // cannot use, contradicting Q7 and Q17b.
        const r = await provisionAndMail(
          row.id, target, invitedAt, makeRequest, idempotencyKey,
        );
        return {
          id: row.id, email: target, status: 'invited', created: false,
          ...r, resynced: r.cf_synced,
        };
      }
      // Already provisioned, so there is no sync to order the freeze against —
      // building the request here cannot strand the row. Whether this is a
      // resend or the completion of an initial delivery is decided by
      // `neverDelivered`, not by this branch.
      let invite_sent = false;
      let mail_error: string | null = null;
      try {
        // `target`, not `email`: the frozen request was rendered against the
        // lower-cased address, and sendInviteRequest compares expectedTo to
        // request.to[0] EXACTLY. Passing the raw input would reject every
        // replay of an invite whose address was typed with capitals.
        const { messageId } = await sendInviteRequest(
          await makeRequest(), idempotencyKey, target,
        );
        await db.query(
          `UPDATE users SET invite_sent_at = now(), invite_message_id=$2 WHERE id=$1`,
          [row.id, messageId],
        );
        invite_sent = true;
      } catch (err) {
        if (err instanceof LifecycleError) throw err;
        mail_error = mailErrorCode(err);
      }
      return {
        id: row.id, email: target, status: 'invited', created: false,
        cf_synced: true, invite_sent, sync_error: null, mail_error,
        // Only a genuine second delivery is a resend; finishing an initial
        // send whose response was lost is not. This is exactly the branch that
        // returns resent:false WITHOUT having created anything, which is why
        // the route keys 201 off `created` and not off this field.
        resent: !neverDelivered,
      };
    }

    const count = await countCohort();
    if (count >= COHORT_CAP) {
      throw new LifecycleError(409, 'cohort_cap_reached', { count, cap: COHORT_CAP });
    }

    // Q27 — the audit row commits with the users INSERT, not after the email.
    // The round-1 ordering wrote user_invited after Resend, so a mail failure
    // left a real user row and a live CF grant with no audit record.
    const client = await db.connect();
    let userId: string;
    let invitedAt: Date;
    try {
      await client.query('BEGIN');
      const ins = await client.query<{ id: string; invited_at: Date }>(
        `INSERT INTO users (email, role, status, invited_by, invited_at, cf_synced_at)
         VALUES ($1, $2, 'invited', $3, now(), NULL)
         RETURNING id, invited_at`,
        [target, role, actor.userId],
      );
      userId = ins.rows[0].id;
      invitedAt = ins.rows[0].invited_at;
      await recordAccountEventTx(client, {
        userId,
        userEmail: target,
        kind: 'user_invited',
        ip: actor.ip,
        // Q30's frozen request is deliberately NOT built here. buildInviteRequest
        // throws mail_not_configured when INVITE_FROM_EMAIL is unset, and inside
        // this transaction that exception reaches the catch below and rolls the
        // invitation back — discarding admin intent over a config gap, which the
        // error contract forbids. It is frozen on the send path instead, where a
        // failure leaves a durable invited row with invite_sent_at NULL.
        meta: { ...humanActor(actor.userId, actor.email), role },
      });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    // Freezing happens inside provisionAndMail, AFTER the row and its audit
    // event are committed AND after the CF add and stamp. Committing first is
    // what makes a config gap yield a durable invited row rather than a
    // rolled-back invitation; deferring past the stamp is what makes that row
    // PROVISIONED, so the invitee can sign in even though no mail went out
    // (Q7). Freezing between the two would satisfy the first and break the
    // second.
    const r = await provisionAndMail(
      userId, target, invitedAt,
      () => frozenInviteRequest(userId, target),
      initialIdempotencyKey(userId, invitedAt),
    );
    // The only path that INSERTs, so the only one that is a 201.
    return { id: userId, email: target, status: 'invited', created: true, ...r };
  });
}

/** Q29 — POST /:id/resend-invite enforces the identical precondition. */
export async function resendInvite(targetId: string, actor: Actor): Promise<InviteOutcome> {
  const { rows } = await db.query<{ email: string }>(
    `SELECT email FROM users WHERE id=$1`, [targetId],
  );
  if (rows.length === 0) throw new LifecycleError(404, 'user_not_found');
  return inviteUser(rows[0].email, 'member', actor);
}
