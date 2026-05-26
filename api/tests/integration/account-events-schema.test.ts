import 'dotenv/config';
import { describe, it, expect } from 'vitest';
import { db } from '../../src/db/client.js';

describe('migration 060: account_events', () => {
  it('table exists with the required columns + types', async () => {
    const { rows } = await db.query<{ column_name: string; data_type: string; is_nullable: string }>(
      `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_name = 'account_events'
        ORDER BY ordinal_position`,
    );
    const cols = new Map(rows.map((r) => [r.column_name, r]));
    expect(cols.get('id')?.data_type).toBe('bigint');
    expect(cols.get('user_id')?.data_type).toBe('uuid');
    expect(cols.get('user_id')?.is_nullable).toBe('YES'); // D8 — SET NULL on user delete
    expect(cols.get('user_email_at_event')?.data_type).toBe('text'); // D8 PII snapshot
    expect(cols.get('user_id_at_event')?.data_type).toBe('uuid'); // D8 immutable snapshot
    expect(cols.get('kind')?.data_type).toBe('text');
    expect(cols.get('ip')?.data_type).toBe('text');
    expect(cols.get('meta')?.data_type).toBe('jsonb');
    expect(cols.get('occurred_at')?.data_type).toBe('timestamp with time zone');
    // FK ON DELETE SET NULL (per D8 — preserve audit trail post-deletion)
    const { rows: fks } = await db.query<{ confdeltype: string }>(
      `SELECT confdeltype FROM pg_constraint
        WHERE conrelid = 'account_events'::regclass AND contype = 'f'`,
    );
    expect(fks[0]?.confdeltype).toBe('n'); // 'n' = SET NULL
  });

  it('kind is governed at the app layer (no DB CHECK) — accepts any text', async () => {
    // Per C-ACCOUNT-EVENTS-ENUM: kind is a TypeScript union + zod-validated at
    // the route layer. The DB does NOT enforce CHECK on kind, so new kinds
    // (par_q_acknowledged, onboarding_completed, restore_replayed) can ship
    // post-cutover via TypeScript-only changes without migration churn.
    const { rows: [u] } = await db.query<{ id: string }>(
      `INSERT INTO users (email) VALUES ($1) RETURNING id`,
      [`vitest.acct-events.${crypto.randomUUID()}@repos.test`],
    );
    // Inserting a kind the DB doesn't know about should succeed at SQL level
    // (the app-layer union prevents it in production code paths).
    await expect(
      db.query(
        `INSERT INTO account_events (user_id, kind, ip, meta) VALUES ($1, 'arbitrary_app_layer_kind', '1.2.3.4', '{}'::jsonb)`,
        [u.id],
      ),
    ).resolves.toBeDefined();
    await db.query('DELETE FROM users WHERE id=$1', [u.id]);
  });

  it('partial index on ip exists for incident-triage grep (per I-IP-INDEX)', async () => {
    const { rows } = await db.query(
      `SELECT indexname FROM pg_indexes WHERE tablename='account_events' AND indexname='account_events_ip_idx'`,
    );
    expect(rows.length).toBe(1);
  });

  it('index on kind exists for admin "all delete_initiated in 30d" queries (per I-AUDIT-EVENT-KIND-INDEX)', async () => {
    const { rows } = await db.query(
      `SELECT indexname FROM pg_indexes WHERE tablename='account_events' AND indexname='account_events_kind_idx'`,
    );
    expect(rows.length).toBe(1);
  });
});
