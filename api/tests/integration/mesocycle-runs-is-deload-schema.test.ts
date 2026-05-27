import 'dotenv/config';
import { describe, it, expect } from 'vitest';
import { db } from '../../src/db/client.js';

describe('mesocycle_runs.is_deload + landmarks_snapshot — migration 042', () => {
  it('is_deload column exists with default false', async () => {
    const { rows } = await db.query<{ column_default: string; is_nullable: string }>(
      `SELECT column_default, is_nullable
       FROM information_schema.columns
       WHERE table_name='mesocycle_runs' AND column_name='is_deload'`,
    );
    expect(rows.length).toBe(1);
    expect(rows[0].is_nullable).toBe('NO');
    expect(rows[0].column_default).toMatch(/false/);
  });

  it('landmarks_snapshot JSONB column exists [C-LANDMARKS-ACTIVE-RUN]', async () => {
    const { rows } = await db.query<{ data_type: string; is_nullable: string }>(
      `SELECT data_type, is_nullable
       FROM information_schema.columns
       WHERE table_name='mesocycle_runs' AND column_name='landmarks_snapshot'`,
    );
    expect(rows.length).toBe(1);
    expect(rows[0].data_type).toBe('jsonb');
    expect(rows[0].is_nullable).toBe('YES');
  });
});
