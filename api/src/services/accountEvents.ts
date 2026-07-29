import { db } from '../db/client.js';
import type { PoolClient } from 'pg';

export type AccountEventKind =
  | 'profile_changed' | 'token_minted' | 'token_revoked' | 'signout_everywhere' | 'delete_initiated'
  | 'par_q_acknowledged' | 'onboarding_completed'
  | 'restore_replayed'
  // W9 lifecycle kinds. No migration needed: account_events.kind has no CHECK
  // constraint by design (C-ACCOUNT-EVENTS-ENUM) — new kinds extend this union.
  | 'user_invited' | 'user_activated' | 'user_suspended' | 'user_reinstated'
  | 'role_changed' | 'user_delete_requested' | 'user_deleted'
  // Q31b — distinct from user_invited because no invitation was actually sent;
  // the identity was granted out of band and imported from the CF policy.
  | 'user_imported';

/**
 * Q23 — the discriminated actor recorded in account_events.meta. Every W9
 * lifecycle event carries exactly ONE of these shapes, never a partial or a
 * mix. `meta` is intentionally permissive (see 060_account_events.sql) so this
 * needs no migration.
 */
export type EventActor =
  | { actor_kind: 'user'; actor_user_id: string; actor_email: string }
  | { actor_kind: 'system'; actor_name: string; source: 'cutover' | 'restore' };

/** A real admin (or the user themselves, for user_activated) took the action. */
export function humanActor(userId: string, email: string): EventActor {
  return { actor_kind: 'user', actor_user_id: userId, actor_email: email };
}

/**
 * The reconciliation script took the action. `source` keeps the run's origin
 * accurate: the same code path runs at cutover and inside run-restore.sh, and
 * a hard-coded 'system:cutover' would simply lie in the restore case.
 */
export function systemActor(
  actor_name: string,
  source: 'cutover' | 'restore',
): EventActor {
  return { actor_kind: 'system', actor_name, source };
}

export interface RecordAccountEventArgs {
  userId: string;
  userEmail: string;
  kind: AccountEventKind;
  ip: string | null;
  meta: Record<string, unknown>;
}

export async function recordAccountEvent(args: RecordAccountEventArgs): Promise<void> {
  await db.query(
    `INSERT INTO account_events
       (user_id, user_id_at_event, user_email_at_event, kind, ip, meta)
     VALUES ($1, $1, $2, $3, $4, $5::jsonb)`,
    [args.userId, args.userEmail, args.kind, args.ip, JSON.stringify(args.meta)],
  );
}

// W2: transaction-scoped variant. The W2 routes (PAR-Q POST, onboarding
// POST) emit the account event in the SAME transaction as their primary
// INSERT/UPDATE so the audit row and the state change commit atomically.
// W6 already shipped the table + the 'par_q_acknowledged' / 'onboarding_completed'
// enum values, so no try/catch shim is needed (the plan's W2→W6 transitional
// `tryRecordAccountEvent` posture is moot now that W6 is merged).
export async function recordAccountEventTx(
  client: PoolClient,
  args: RecordAccountEventArgs,
): Promise<void> {
  await client.query(
    `INSERT INTO account_events
       (user_id, user_id_at_event, user_email_at_event, kind, ip, meta)
     VALUES ($1, $1, $2, $3, $4, $5::jsonb)`,
    [args.userId, args.userEmail, args.kind, args.ip, JSON.stringify(args.meta)],
  );
}

export interface AccountEventRow {
  id: string;
  kind: AccountEventKind;
  ip: string | null;
  meta: Record<string, unknown>;
  occurred_at: Date;
  user_email_at_event: string | null;
}

export async function listAccountEvents(
  userId: string,
  opts: { limit?: number; beforeTs?: Date; beforeId?: string } = {},
): Promise<AccountEventRow[]> {
  const limit = Math.min(opts.limit ?? 50, 200);
  if (opts.beforeTs && opts.beforeId) {
    const { rows } = await db.query<AccountEventRow>(
      `SELECT id::text, kind, ip, meta, occurred_at, user_email_at_event
         FROM account_events
        WHERE user_id=$1 AND (occurred_at, id) < ($2, $3::bigint)
        ORDER BY occurred_at DESC, id DESC
        LIMIT $4`,
      [userId, opts.beforeTs, opts.beforeId, limit],
    );
    return rows;
  }
  const { rows } = await db.query<AccountEventRow>(
    `SELECT id::text, kind, ip, meta, occurred_at, user_email_at_event
       FROM account_events
      WHERE user_id=$1
      ORDER BY occurred_at DESC, id DESC
      LIMIT $2`,
    [userId, limit],
  );
  return rows;
}
