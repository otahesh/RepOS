// api/src/services/recoveryFlagEvents.ts
//
// Beta W3.1 — append-only telemetry writes for recovery_flag_events.
// Powers the post-cohort tuning pass on the W3 evaluator thresholds
// (see [[reference_w3_tuning_candidates]] memory + master plan line 616).
//
// [FIX-8]  No JS isoWeekKey() helper — Postgres date_trunc('week', current_date)::date
//          is the existing project pattern, matching recovery_flag_dismissals.week_start
//          from migration 024. Keeps timezone math consistent with the dismiss path.
// [FIX-16] 'shown' rows are deduped via ON CONFLICT against the partial unique index
//          recovery_flag_events_shown_dedupe_idx (migration 033). Lets every GET poll
//          attempt to record without exploding the table — one row per
//          (user, flag, week) instead of one per request.
//          'dismissed' rows are append-only — each dismiss is a discrete user action
//          worth recording (e.g. dismiss → re-fire → dismiss again next week).
// [FIX-30] flag is validated by the CHECK constraint on the table (migration 033).
//          Invalid flag strings throw at INSERT, surfacing typos in callers.
import { db } from '../db/client.js';
import type { RecoveryFlagKey } from '../schemas/recoveryFlags.js';

export async function recordFlagShown(params: {
  userId: string;
  flag: RecoveryFlagKey;
}): Promise<void> {
  // ON CONFLICT target must match the partial unique index
  // recovery_flag_events_shown_dedupe_idx — its columns are
  // (user_id, flag, week_start) with predicate WHERE event_type = 'shown'.
  // Postgres requires the conflict_target predicate to be supplied so it can
  // pick the partial index; we include the same WHERE here.
  await db.query(
    `INSERT INTO recovery_flag_events (user_id, flag, week_start, event_type)
     VALUES ($1, $2, date_trunc('week', current_date)::date, 'shown')
     ON CONFLICT (user_id, flag, week_start) WHERE event_type = 'shown'
     DO NOTHING`,
    [params.userId, params.flag],
  );
}

export async function recordFlagDismissed(params: {
  userId: string;
  flag: RecoveryFlagKey;
}): Promise<void> {
  await db.query(
    `INSERT INTO recovery_flag_events (user_id, flag, week_start, event_type)
     VALUES ($1, $2, date_trunc('week', current_date)::date, 'dismissed')`,
    [params.userId, params.flag],
  );
}
