// api/src/services/recoveryFlagDismissals.ts
// Canonical schema per plan reconciliation addendum §7.2:
// (user_id, flag, week_start DATE) — NOT scoped to mesocycle_run_id.
// week_start = Monday of the ISO week the flag fired.
import { db } from '../db/client.js';

export type DismissalKey = {
  userId: string;
  /** flag CHECK IN ('bodyweight_crash','overreaching','stalled_pr') */
  flag: string;
  /** ISO date string for the Monday of the week the flag fired */
  weekStart: string;
};

export async function recordDismissal(k: DismissalKey): Promise<void> {
  await db.query(
    `INSERT INTO recovery_flag_dismissals (user_id, flag, week_start)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, flag, week_start) DO NOTHING`,
    [k.userId, k.flag, k.weekStart],
  );
}

export async function isDismissed(k: DismissalKey): Promise<boolean> {
  const { rows } = await db.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM recovery_flag_dismissals
       WHERE user_id=$1 AND flag=$2 AND week_start=$3
     ) AS exists`,
    [k.userId, k.flag, k.weekStart],
  );
  return !!rows[0]?.exists;
}

export const isFlagSuppressed = isDismissed;
