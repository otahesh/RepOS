// Migration 094 — the schema guarantees the triage design leans on. The unique
// constraint and the CHECKs are load-bearing: they are what make "never email
// the same person twice" a property of the database rather than of the agent's
// memory, so each is asserted directly rather than inferred from behaviour.
import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import pg from 'pg';
import { createEphemeralDb } from '../helpers/ephemeral-db.js';
import { runMigrations } from '../../src/db/runMigrations.js';

const cleanups: Array<() => Promise<void>> = [];
afterAll(async () => {
  for (const c of cleanups) await c();
});

async function freshDb(name: string) {
  const eph = await createEphemeralDb(name);
  const pool = new pg.Pool({ connectionString: eph.url, max: 2 });
  // One cleanup, pool first: DROP DATABASE fails while a connection is live.
  cleanups.push(async () => {
    await pool.end();
    await eph.drop();
  });
  await runMigrations(pool);
  return pool;
}

async function seedFeedback(pool: pg.Pool, body = 'it broke'): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO feedback (body, user_email_at_submit) VALUES ($1, 'sub@example.test') RETURNING id`,
    [body],
  );
  return rows[0].id;
}

describe('migration 094', () => {
  it('adds the classification and fix-lifecycle columns with their CHECKs', async () => {
    const pool = await freshDb('mig094-cols');
    const id = await seedFeedback(pool);

    await pool.query(
      `UPDATE feedback SET category='bug', severity='p2', triage_note='real', fix_status='needed' WHERE id=$1`,
      [id],
    );

    await expect(
      pool.query(`UPDATE feedback SET category='nonsense' WHERE id=$1`, [id]),
    ).rejects.toThrow(/feedback_category_check/);
    await expect(pool.query(`UPDATE feedback SET severity='p9' WHERE id=$1`, [id])).rejects.toThrow(
      /feedback_severity_check/,
    );
    await expect(
      pool.query(`UPDATE feedback SET fix_status='shipped' WHERE id=$1`, [id]),
    ).rejects.toThrow(/feedback_fix_status_check/);
    await expect(
      pool.query(`UPDATE feedback SET fix_commit_sha='NOTASHA' WHERE id=$1`, [id]),
    ).rejects.toThrow(/feedback_fix_commit_sha_check/);
  });

  it('defaults fix_status to n/a so untouched rows are not in the fix queue', async () => {
    const pool = await freshDb('mig094-default');
    const id = await seedFeedback(pool);
    const { rows } = await pool.query<{ fix_status: string; category: string | null }>(
      `SELECT fix_status, category FROM feedback WHERE id=$1`,
      [id],
    );
    expect(rows[0].fix_status).toBe('n/a');
    expect(rows[0].category).toBeNull();
  });

  it('rejects a self-referencing dedupe_of', async () => {
    const pool = await freshDb('mig094-self');
    const id = await seedFeedback(pool);
    await expect(pool.query(`UPDATE feedback SET dedupe_of=$1 WHERE id=$1`, [id])).rejects.toThrow(
      /feedback_dedupe_of_not_self/,
    );
  });

  it('enforces one email per (feedback_id, kind)', async () => {
    const pool = await freshDb('mig094-unique');
    const id = await seedFeedback(pool);
    await pool.query(
      `INSERT INTO feedback_emails (feedback_id, kind, request, idempotency_key)
       VALUES ($1,'ack','{}',$2)`,
      [id, `fb-ack-${id}`],
    );
    await expect(
      pool.query(
        `INSERT INTO feedback_emails (feedback_id, kind, request, idempotency_key)
         VALUES ($1,'ack','{}',$2)`,
        [id, `fb-ack-${id}`],
      ),
    ).rejects.toThrow(/feedback_emails_feedback_id_kind_key/);

    // A different kind is allowed by the constraint. Cross-kind exclusivity is
    // a service rule enforced by the feedback-level lock, not by the schema.
    await pool.query(
      `INSERT INTO feedback_emails (feedback_id, kind, request, idempotency_key)
       VALUES ($1,'resolved','{}',$2)`,
      [id, `fb-resolved-${id}`],
    );
  });

  it('rejects an unknown email kind', async () => {
    const pool = await freshDb('mig094-kind');
    const id = await seedFeedback(pool);
    await expect(
      pool.query(
        `INSERT INTO feedback_emails (feedback_id, kind, request, idempotency_key)
         VALUES ($1,'nudge','{}','k')`,
        [id],
      ),
    ).rejects.toThrow(/feedback_emails_kind_check/);
  });

  it('cascades email rows when the feedback row is deleted', async () => {
    const pool = await freshDb('mig094-cascade');
    const id = await seedFeedback(pool);
    await pool.query(
      `INSERT INTO feedback_emails (feedback_id, kind, request, idempotency_key)
       VALUES ($1,'reply','{}','k')`,
      [id],
    );
    await pool.query(`DELETE FROM feedback WHERE id=$1`, [id]);
    const { rows } = await pool.query(`SELECT 1 FROM feedback_emails WHERE feedback_id=$1`, [id]);
    expect(rows).toHaveLength(0);
  });

  it('leaves a previously admin-triaged row in the queue', async () => {
    // adminFeedback.ts sets ONLY triaged_at. Such a row has no category, so it
    // must still be queued — this is the silent-drop the spec calls out.
    const pool = await freshDb('mig094-backfill');
    const id = await seedFeedback(pool);
    await pool.query(`UPDATE feedback SET triaged_at=now() WHERE id=$1`, [id]);
    const { rows } = await pool.query(`SELECT id FROM feedback WHERE category IS NULL AND id=$1`, [
      id,
    ]);
    expect(rows).toHaveLength(1);
  });
});
