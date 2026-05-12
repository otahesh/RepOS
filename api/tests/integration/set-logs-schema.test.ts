/**
 * Beta W1.1 — set_logs schema test for migration 029.
 *
 * Validates that the alpha-era `set_logs` table has been extended with the
 * Beta API contract columns (user_id, exercise_id, rpe, client_request_id,
 * created_at, updated_at), the two uniqueness indices (idempotency +
 * minute-truncated double-tap dedupe), the updated_at trigger, and a
 * CASCADE FK to users.
 */

import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { db } from '../../src/db/client.js';

describe('set_logs Beta schema (migration 029)', () => {
  afterAll(async () => {
    await db.end();
  });

  it('has user_id, exercise_id, rpe, client_request_id, created_at, updated_at columns', async () => {
    const { rows } = await db.query(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_name = 'set_logs'
       ORDER BY ordinal_position`,
    );
    const cols = Object.fromEntries(rows.map((r) => [r.column_name, r]));
    expect(cols.user_id).toMatchObject({ data_type: 'uuid', is_nullable: 'NO' });
    expect(cols.exercise_id).toMatchObject({ data_type: 'uuid', is_nullable: 'NO' });
    expect(cols.rpe).toMatchObject({ data_type: 'smallint', is_nullable: 'YES' });
    expect(cols.client_request_id).toMatchObject({ data_type: 'uuid', is_nullable: 'NO' });
    expect(cols.created_at).toMatchObject({ data_type: 'timestamp with time zone', is_nullable: 'NO' });
    expect(cols.updated_at).toMatchObject({ data_type: 'timestamp with time zone', is_nullable: 'NO' });
  });

  it('enforces UNIQUE (user_id, client_request_id)', async () => {
    const { rows } = await db.query(
      `SELECT indexdef FROM pg_indexes
       WHERE tablename = 'set_logs' AND indexname = 'set_logs_user_id_client_request_id_key'`,
    );
    expect(rows[0]?.indexdef).toMatch(/UNIQUE.*\(user_id, client_request_id\)/);
  });

  it('enforces UNIQUE (planned_set_id, minute-truncated performed_at)', async () => {
    const { rows } = await db.query(
      `SELECT indexdef FROM pg_indexes
       WHERE tablename = 'set_logs' AND indexname = 'set_logs_minute_dedupe_key'`,
    );
    expect(rows[0]?.indexdef).toMatch(/date_trunc.*minute/);
    expect(rows[0]?.indexdef).toMatch(/planned_set_id/);
  });

  it('has updated_at trigger', async () => {
    const { rows } = await db.query(
      `SELECT trigger_name FROM information_schema.triggers
       WHERE event_object_table = 'set_logs' AND trigger_name = 'set_logs_updated_at'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('user_id has FK to users with ON DELETE CASCADE', async () => {
    const { rows } = await db.query(`
      SELECT confdeltype FROM pg_constraint
      WHERE conname LIKE 'set_logs_user_id_fkey%'
    `);
    expect(rows[0]?.confdeltype).toBe('c'); // 'c' = CASCADE
  });
});
