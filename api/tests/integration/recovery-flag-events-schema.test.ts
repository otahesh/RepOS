/**
 * Beta W3 — recovery_flag_events schema test for migration 033.
 *
 * Append-only telemetry: one row per (shown | dismissed) emit. Powers the
 * post-cohort tuning pass on the W3 evaluator thresholds per reviewer NIT
 * (master plan line 616).
 */
import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { db } from '../../src/db/client.js';

describe('recovery_flag_events schema (migration 033)', () => {
  afterAll(async () => {
    await db.end();
  });

  it('has id, user_id, flag, week_start, event_type, occurred_at columns', async () => {
    const { rows } = await db.query(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_name = 'recovery_flag_events'
       ORDER BY ordinal_position`,
    );
    const cols = Object.fromEntries(rows.map((r) => [r.column_name, r]));
    expect(cols.id).toMatchObject({ data_type: 'bigint', is_nullable: 'NO' });
    expect(cols.user_id).toMatchObject({ data_type: 'uuid', is_nullable: 'NO' });
    expect(cols.flag).toMatchObject({ data_type: 'text', is_nullable: 'NO' });
    // [FIX-7] week_start is DATE (not TEXT) — matches recovery_flag_dismissals.week_start
    // from migration 024 for join compatibility.
    expect(cols.week_start).toMatchObject({ data_type: 'date', is_nullable: 'NO' });
    expect(cols.event_type).toMatchObject({ data_type: 'text', is_nullable: 'NO' });
    expect(cols.occurred_at).toMatchObject({
      data_type: 'timestamp with time zone',
      is_nullable: 'NO',
    });
  });

  it('enforces CHECK event_type IN (shown, dismissed)', async () => {
    const { rows } = await db.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conrelid = 'recovery_flag_events'::regclass AND conname LIKE '%event_type%'`,
    );
    expect(rows.some((r) => /shown.*dismissed/.test(r.def))).toBe(true);
  });

  // [FIX-30] flag has CHECK mirroring KNOWN_FLAGS to catch typos in recordFlagEvent.
  it('flag has CHECK against KNOWN_FLAGS (bodyweight_crash, overreaching, stalled_pr)', async () => {
    const { rows } = await db.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conrelid = 'recovery_flag_events'::regclass AND conname LIKE '%flag%'`,
    );
    expect(rows.some((r) => /bodyweight_crash.*overreaching.*stalled_pr/.test(r.def))).toBe(true);
  });

  it('has (user_id, week_start, flag) lookup index', async () => {
    const { rows } = await db.query(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'recovery_flag_events'`,
    );
    expect(rows.some((r) => /\(user_id, week_start, flag\)/.test(r.indexdef))).toBe(true);
  });

  // [FIX-16] partial unique index for dedupe on shown events
  it('shown events are deduped per (user, flag, week)', async () => {
    const { rows } = await db.query(
      `SELECT indexdef FROM pg_indexes
       WHERE tablename = 'recovery_flag_events' AND indexname = 'recovery_flag_events_shown_dedupe_idx'`,
    );
    expect(rows[0]?.indexdef).toMatch(/UNIQUE.*\(user_id, flag, week_start\).*WHERE.*shown/);
  });

  it('cascades on user delete', async () => {
    const { rows } = await db.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conrelid = 'recovery_flag_events'::regclass AND contype = 'f'`,
    );
    expect(rows[0]?.def).toMatch(/REFERENCES users\(id\) ON DELETE CASCADE/);
  });
});
