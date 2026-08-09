// Shared user + bearer primitives (2026-07-13 quality pass Q9).
//
// Before this file, user creation existed twice (program-fixtures.mkUser and
// raw `INSERT INTO users` sites across seed-fixtures) and bearer minting
// existed twice (seed-fixtures.mintBearer direct-DB and an HTTP POST
// /api/tokens inside mkUserWithProgram). A schema change to either then had
// to land in every copy or the suite went partially green. Both families now
// delegate here; their public exports are unchanged (re-exports), so test
// files keep their existing import sites.

import { randomBytes, randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { db } from '../../src/db/client.js';

export interface MkUserOpts {
  /** Tag included in the email for log readability. Default 'vitest'. */
  prefix?: string;
  /** equipment_profile JSONB. */
  equipment_profile?: object;
  /** users.goal CHECK ∈ (cut|maintain|bulk). */
  goal?: 'cut' | 'maintain' | 'bulk';
  /** IANA tz; column default is 'UTC'. */
  timezone?: string;
}

export async function mkUser(opts: MkUserOpts = {}): Promise<{ id: string; email: string }> {
  const prefix = opts.prefix ?? 'vitest';
  const email = `${prefix}.${randomUUID()}@repos.test`;
  const cols = ['email'];
  const values: unknown[] = [email];
  const placeholders = ['$1'];

  if (opts.equipment_profile !== undefined) {
    cols.push('equipment_profile');
    values.push(JSON.stringify(opts.equipment_profile));
    placeholders.push(`$${values.length}::jsonb`);
  }
  if (opts.goal !== undefined) {
    cols.push('goal');
    values.push(opts.goal);
    placeholders.push(`$${values.length}`);
  }
  if (opts.timezone !== undefined) {
    cols.push('timezone');
    values.push(opts.timezone);
    placeholders.push(`$${values.length}`);
  }

  const {
    rows: [u],
  } = await db.query<{ id: string; email: string }>(
    `INSERT INTO users (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id, email`,
    values,
  );
  return u;
}

/** Idempotent: ignores undefined ids. Cascades take care of dependent rows. */
export async function cleanupUser(userId: string | undefined): Promise<void> {
  if (userId) await db.query(`DELETE FROM users WHERE id=$1`, [userId]);
}

// ---------------------------------------------------------------------------
// mintBearer — INSERT a device_tokens row that the production auth middleware
// (api/src/middleware/auth.ts) will accept. Token format is
// "<16-hex-prefix>.<64-hex-secret>"; stored as "<prefix>:<argon2hash-of-secret>".
// The single minting path for ALL test fixtures.
// ---------------------------------------------------------------------------
export async function mintBearer(opts: {
  userId: string;
  scopes?: string[];
  label?: string;
}): Promise<{ bearer: string; userId: string }> {
  const prefix = randomBytes(8).toString('hex'); // 16 hex chars
  const secret = randomBytes(32).toString('hex'); // 64 hex chars
  const bearer = `${prefix}.${secret}`;
  const hash = await argon2.hash(secret);
  const stored = `${prefix}:${hash}`;
  const scopes = opts.scopes ?? ['health:weight:write'];
  await db.query(
    `INSERT INTO device_tokens (user_id, token_hash, scopes, label)
     VALUES ($1, $2, $3::text[], $4)`,
    [opts.userId, stored, scopes, opts.label ?? 'seed-fixture'],
  );
  return { bearer, userId: opts.userId };
}
