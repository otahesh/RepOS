import { db } from '../db/client.js';

export type AccountEventKind =
  | 'profile_changed' | 'token_minted' | 'token_revoked' | 'signout_everywhere' | 'delete_initiated'
  | 'par_q_acknowledged' | 'onboarding_completed'
  | 'restore_replayed';

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
