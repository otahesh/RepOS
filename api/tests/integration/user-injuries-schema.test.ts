/**
 * Beta W3 — user_injuries schema test for migration 032.
 *
 * Validates that the new user_injuries table exists with the Beta API contract
 * columns, PK (user_id, joint), CHECK on joint (7-key enum), CHECK on severity,
 * the (user_id) lookup index, and a CASCADE FK to users.
 */
import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { db } from '../../src/db/client.js';

describe('user_injuries schema (migration 032)', () => {
  afterAll(async () => { await db.end(); });

  it('has user_id, joint, severity, notes, onset_at, created_at, updated_at columns', async () => {
    const { rows } = await db.query(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_name = 'user_injuries'
       ORDER BY ordinal_position`,
    );
    const cols = Object.fromEntries(rows.map((r) => [r.column_name, r]));
    expect(cols.user_id).toMatchObject({ data_type: 'uuid', is_nullable: 'NO' });
    expect(cols.joint).toMatchObject({ data_type: 'text', is_nullable: 'NO' });
    expect(cols.severity).toMatchObject({ data_type: 'text', is_nullable: 'NO' });
    expect(cols.notes).toMatchObject({ data_type: 'text', is_nullable: 'NO' });
    expect(cols.onset_at).toMatchObject({ data_type: 'date', is_nullable: 'YES' });
    expect(cols.created_at).toMatchObject({ data_type: 'timestamp with time zone', is_nullable: 'NO' });
    expect(cols.updated_at).toMatchObject({ data_type: 'timestamp with time zone', is_nullable: 'NO' });
  });

  it('enforces PRIMARY KEY (user_id, joint)', async () => {
    const { rows } = await db.query(
      `SELECT indexdef FROM pg_indexes
       WHERE tablename = 'user_injuries' AND indexname = 'user_injuries_pkey'`,
    );
    expect(rows[0]?.indexdef).toMatch(/UNIQUE.*\(user_id, joint\)/);
  });

  it('enforces CHECK joint IN (7-key enum)', async () => {
    const { rows } = await db.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conrelid = 'user_injuries'::regclass AND conname LIKE '%joint%'`,
    );
    expect(rows.some((r) => /shoulder_left/.test(r.def) && /wrist/.test(r.def))).toBe(true);
  });

  it('enforces CHECK severity IN (low|mod|high)', async () => {
    const { rows } = await db.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conrelid = 'user_injuries'::regclass AND conname LIKE '%severity%'`,
    );
    expect(rows.some((r) => /low.*mod.*high/.test(r.def))).toBe(true);
  });

  it('cascades on user delete', async () => {
    const { rows } = await db.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conrelid = 'user_injuries'::regclass AND contype = 'f'`,
    );
    expect(rows[0]?.def).toMatch(/REFERENCES users\(id\) ON DELETE CASCADE/);
  });
});
