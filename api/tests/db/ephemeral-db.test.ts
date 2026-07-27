// Proves the ephemeral-DB harness that Tasks 2, 10, 11, 15 and 17 depend on:
// a throwaway database, migrations applied into it, and a clean drop.
import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import pg from 'pg';
import { createEphemeralDb } from '../helpers/ephemeral-db.js';
import { runMigrations } from '../../src/db/runMigrations.js';

const created: Array<{ drop: () => Promise<void> }> = [];
afterAll(async () => { for (const c of created) await c.drop(); });

describe('ephemeral-db harness', () => {
  it('creates an empty database, applies every migration, and reports them', async () => {
    const eph = await createEphemeralDb('harness');
    created.push(eph);
    const pool = new pg.Pool({ connectionString: eph.url, max: 2 });
    try {
      const applied = await runMigrations(pool);
      expect(applied).toContain('001_users.sql');
      const { rows } = await pool.query<{ n: number }>(
        `SELECT count(*)::int n FROM information_schema.tables
          WHERE table_schema='public' AND table_name='users'`,
      );
      expect(rows[0].n).toBe(1);
    } finally {
      await pool.end();
    }
  });

  it('is idempotent — a second run applies nothing', async () => {
    const eph = await createEphemeralDb('idem');
    created.push(eph);
    const pool = new pg.Pool({ connectionString: eph.url, max: 2 });
    try {
      const first = await runMigrations(pool);
      expect(first.length).toBeGreaterThan(0);
      const second = await runMigrations(pool);
      expect(second).toEqual([]);
    } finally {
      await pool.end();
    }
  });
});
