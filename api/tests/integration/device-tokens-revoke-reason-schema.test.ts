import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { db } from '../../src/db/client.js';

describe('device_tokens.revoke_reason schema (migration 061)', () => {
  afterAll(async () => { await db.end(); });

  it('column exists, nullable TEXT, CHECK constraint', async () => {
    const { rows } = await db.query<{ column_name: string; is_nullable: string; data_type: string }>(
      `SELECT column_name, is_nullable, data_type FROM information_schema.columns
        WHERE table_name='device_tokens' AND column_name='revoke_reason'`,
    );
    expect(rows.length).toBe(1);
    expect(rows[0].data_type).toBe('text');
    expect(rows[0].is_nullable).toBe('YES');
  });

  it('accepts the six enum values (per I-REVOKE-REASON-ENUM)', async () => {
    const email = `vitest.dt-rr-ok.${crypto.randomUUID()}@repos.test`;
    const { rows: [u] } = await db.query<{ id: string }>(
      `INSERT INTO users (email) VALUES ($1) RETURNING id`, [email],
    );
    for (const reason of ['user_revoked','signout_everywhere','account_deleted','restore_replayed','legacy_revoke','cf_access_logout']) {
      const { rows: [t] } = await db.query<{ id: string }>(
        `INSERT INTO device_tokens (user_id, token_hash) VALUES ($1, $2) RETURNING id`,
        [u.id, `hash-${reason}-${crypto.randomUUID()}`],
      );
      await expect(
        db.query(`UPDATE device_tokens SET revoked_at=now(), revoke_reason=$1 WHERE id=$2`, [reason, t.id]),
      ).resolves.toBeDefined();
    }
    // device_tokens.user_id is ON DELETE CASCADE (per migration 002), so the
    // tokens inserted above are cleaned up by this user delete.
    await db.query('DELETE FROM users WHERE id=$1', [u.id]);
  });

  it('rejects unknown revoke_reason values', async () => {
    const email = `vitest.dt-rr.${crypto.randomUUID()}@repos.test`;
    const { rows: [u] } = await db.query<{ id: string }>(
      `INSERT INTO users (email) VALUES ($1) RETURNING id`, [email],
    );
    await db.query(
      `INSERT INTO device_tokens (user_id, token_hash) VALUES ($1, $2)`,
      [u.id, `aa:bb-${crypto.randomUUID()}`],
    );
    await expect(
      db.query(
        `UPDATE device_tokens SET revoke_reason='garbage' WHERE user_id=$1`,
        [u.id],
      ),
    ).rejects.toThrow();
    await db.query('DELETE FROM users WHERE id=$1', [u.id]);
  });

  it('backfills alpha residue to legacy_revoke (per I-REVOKE-REASON-BACKFILL)', async () => {
    // Pre-migration rows with revoked_at IS NOT NULL AND revoke_reason IS NULL
    // should have been backfilled by the migration. Verify by asserting no such
    // (revoked_at NOT NULL, revoke_reason NULL) rows remain post-migration.
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int n FROM device_tokens WHERE revoked_at IS NOT NULL AND revoke_reason IS NULL`,
    );
    expect(rows[0].n).toBe(0);
  });
});
