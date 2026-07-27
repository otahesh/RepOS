// Throwaway per-test-file databases.
//
// Why: migration 080's data step (Q35) and the cohort-cap tests (Q12/Q18)
// assert on WHOLE-TABLE state. Running them against the shared dev database
// makes them depend on rows other test files leaked. Each caller gets its own
// database, created from the maintenance connection derived from DATABASE_URL.
//
// This module MUST NOT import src/db/client.js — callers set
// process.env.DATABASE_URL from `url` and then dynamically import the app, so
// the shared pool must not have been constructed yet.
import { randomUUID } from 'node:crypto';
import pg from 'pg';

export interface EphemeralDb {
  /** Connection string for the new database. */
  url: string;
  /** The generated database name. */
  name: string;
  /** DROP the database. Safe to call twice. */
  drop: () => Promise<void>;
}

function maintenanceUrl(base: string): string {
  const u = new URL(base);
  u.pathname = '/postgres';
  return u.toString();
}

export async function createEphemeralDb(tag: string): Promise<EphemeralDb> {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL must be set to create an ephemeral database');
  const name = `repos_t_${tag.replace(/[^a-z0-9]/gi, '').toLowerCase()}_${randomUUID().slice(0, 8)}`;
  const admin = new pg.Client({ connectionString: maintenanceUrl(base), connectionTimeoutMillis: 5_000 });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  const u = new URL(base);
  u.pathname = `/${name}`;
  const url = u.toString();

  let dropped = false;
  const drop = async (): Promise<void> => {
    if (dropped) return;
    dropped = true;
    const a = new pg.Client({ connectionString: maintenanceUrl(base), connectionTimeoutMillis: 5_000 });
    await a.connect();
    try {
      await a.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [name],
      );
      await a.query(`DROP DATABASE IF EXISTS ${name}`);
    } finally {
      await a.end();
    }
  };

  return { url, name, drop };
}
