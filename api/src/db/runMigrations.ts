import { readdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, 'migrations');

/**
 * Apply every pending .sql migration against `pool`, in filename order, each
 * in its own transaction. Returns the filenames actually applied (empty on a
 * fully-migrated database).
 *
 * Pins one client for the run so BEGIN/sql/COMMIT share a session, and clears
 * the per-session 5s statement_timeout the Pool sets for runtime queries —
 * migrations may legitimately do long CREATE INDEX or backfill UPDATEs.
 *
 * Throws on the first failing migration (after ROLLBACK) rather than calling
 * process.exit, so tests and run-restore.sh can both handle the failure.
 */
export async function runMigrations(pool: pg.Pool): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SET statement_timeout = 0');
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    const already = new Set(
      (await client.query('SELECT filename FROM _migrations')).rows.map(
        (r: { filename: string }) => r.filename,
      ),
    );
    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (already.has(file)) continue;
      const sql = await readFile(join(migrationsDir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
        console.log(`✓ ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`✗ ${file}`, err);
        throw err;
      }
    }
  } finally {
    client.release();
  }
  return applied;
}
