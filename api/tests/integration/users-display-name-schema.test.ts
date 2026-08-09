import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { db } from '../../src/db/client.js';

describe('users.display_name schema (migration 062)', () => {
  afterAll(async () => {
    await db.end();
  });

  it('display_name length cap rejects > 80 chars', async () => {
    const longName = 'x'.repeat(81);
    await expect(
      db.query(`INSERT INTO users (email, display_name) VALUES ($1, $2)`, [
        `vitest.dn.${crypto.randomUUID()}@repos.test`,
        longName,
      ]),
    ).rejects.toThrow();
  });

  it('display_name CHECK rejects empty-string / whitespace-only (per I-DISPLAY-NAME-NORMALIZE)', async () => {
    await expect(
      db.query(`INSERT INTO users (email, display_name) VALUES ($1, $2)`, [
        `vitest.dn-empty.${crypto.randomUUID()}@repos.test`,
        '   ',
      ]),
    ).rejects.toThrow();
  });

  it('users.units column does NOT exist (per D6 — units is cut from W6)', async () => {
    const { rows } = await db.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name='users' AND column_name='units'`,
    );
    expect(rows.length).toBe(0);
  });
});
