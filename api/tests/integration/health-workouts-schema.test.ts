/**
 * Beta W1.4 — health_workouts schema test for migration 030.
 *
 * Validates that the new `health_workouts` table exists with the Beta API
 * contract columns (id, user_id, started_at, ended_at, modality, distance_m,
 * duration_sec, source, created_at, updated_at), the UNIQUE (user_id,
 * started_at, source) constraint, the (user_id, started_at DESC) lookup
 * index, the updated_at trigger, and a CASCADE FK to users.
 *
 * Modality is intentionally TEXT NOT NULL with NO CHECK constraint — the
 * application-side Zod schema (api/src/schemas/healthWorkouts.ts, shipped
 * in a later W1.4 task) owns the modality allowlist.
 */

import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { db } from '../../src/db/client.js';

describe('health_workouts schema (migration 030)', () => {
  afterAll(async () => {
    await db.end();
  });

  it('has id, user_id, started_at, ended_at, modality, distance_m, duration_sec, source, created_at, updated_at columns', async () => {
    const { rows } = await db.query(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_name = 'health_workouts'
       ORDER BY ordinal_position`,
    );
    const cols = Object.fromEntries(rows.map((r) => [r.column_name, r]));
    expect(cols.id).toMatchObject({ data_type: 'bigint', is_nullable: 'NO' });
    expect(cols.user_id).toMatchObject({ data_type: 'uuid', is_nullable: 'NO' });
    expect(cols.started_at).toMatchObject({ data_type: 'timestamp with time zone', is_nullable: 'NO' });
    expect(cols.ended_at).toMatchObject({ data_type: 'timestamp with time zone', is_nullable: 'NO' });
    expect(cols.modality).toMatchObject({ data_type: 'text', is_nullable: 'NO' });
    expect(cols.distance_m).toMatchObject({ data_type: 'integer', is_nullable: 'YES' });
    expect(cols.duration_sec).toMatchObject({ data_type: 'integer', is_nullable: 'NO' });
    expect(cols.source).toMatchObject({ data_type: 'text', is_nullable: 'NO' });
    expect(cols.created_at).toMatchObject({ data_type: 'timestamp with time zone', is_nullable: 'NO' });
    expect(cols.updated_at).toMatchObject({ data_type: 'timestamp with time zone', is_nullable: 'NO' });
  });

  it('enforces UNIQUE (user_id, started_at, source)', async () => {
    const { rows } = await db.query(
      `SELECT indexdef FROM pg_indexes
       WHERE tablename = 'health_workouts'
         AND indexname = 'health_workouts_user_id_started_at_source_key'`,
    );
    expect(rows[0]?.indexdef).toMatch(/UNIQUE.*\(user_id, started_at, source\)/);
  });

  it('has compound lookup index (user_id, started_at DESC)', async () => {
    const { rows } = await db.query(
      `SELECT indexdef FROM pg_indexes
       WHERE tablename = 'health_workouts'
         AND indexname = 'idx_health_workouts_user_started'`,
    );
    expect(rows[0]?.indexdef).toMatch(/\(user_id, started_at DESC\)/);
  });

  it('has updated_at trigger', async () => {
    const { rows } = await db.query(
      `SELECT trigger_name FROM information_schema.triggers
       WHERE event_object_table = 'health_workouts'
         AND trigger_name = 'health_workouts_updated_at'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('user_id has FK to users with ON DELETE CASCADE', async () => {
    const { rows } = await db.query(`
      SELECT confdeltype FROM pg_constraint
      WHERE conname LIKE 'health_workouts_user_id_fkey%'
    `);
    expect(rows[0]?.confdeltype).toBe('c'); // 'c' = CASCADE
  });
});
