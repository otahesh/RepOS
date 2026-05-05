import { createHash } from 'crypto';
import type { PoolClient } from 'pg';
import type { z } from 'zod';
import { db } from '../db/client.js';

export type SeedAdapter<T> = {
  validate: (entries: T[]) => z.SafeParseReturnType<T[], T[]>;
  upsertOne: (tx: PoolClient, entry: T, generation: number) => Promise<void>;
  archiveMissing: (tx: PoolClient, key: string, generation: number) => Promise<number>;
};

export type RunSeedOpts<T> = { key: string; entries: T[]; adapter: SeedAdapter<T> };
export type RunSeedResult =
  | { applied: false; reason: 'hash_unchanged'; generation: number }
  | { applied: true; upserted: number; archived: number; generation: number };

export async function runSeed<T>(opts: RunSeedOpts<T>): Promise<RunSeedResult> {
  const validation = opts.adapter.validate(opts.entries);
  if (!validation.success) {
    const issues = validation.error.issues.map(i => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`seed validation failed (${opts.key}):\n${issues.join('\n')}`);
  }

  const hash = createHash('sha256').update(JSON.stringify(opts.entries)).digest('hex');
  const client = await db.connect();
  try {
    const { rows: [meta] } = await client.query<{ hash: string; generation: number }>(
      `SELECT hash, generation FROM _seed_meta WHERE key=$1`, [opts.key]
    );
    if (meta && meta.hash === hash) {
      return { applied: false, reason: 'hash_unchanged', generation: meta.generation };
    }

    await client.query('BEGIN');
    try {
      const generation = (meta?.generation ?? 0) + 1;
      let upserted = 0;
      for (const e of opts.entries) {
        await opts.adapter.upsertOne(client, e, generation);
        upserted++;
      }
      const archived = await opts.adapter.archiveMissing(client, opts.key, generation);
      await client.query(
        `INSERT INTO _seed_meta (key, hash, generation) VALUES ($1,$2,$3)
         ON CONFLICT (key) DO UPDATE SET hash=EXCLUDED.hash, generation=EXCLUDED.generation, applied_at=now()`,
        [opts.key, hash, generation],
      );
      await client.query('COMMIT');
      return { applied: true, upserted, archived, generation };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  } finally {
    client.release();
  }
}
