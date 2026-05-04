import { readdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { db } from './client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, 'migrations');

// Pin a single client for the run so BEGIN/sql/COMMIT all share the same
// session, and clear the per-session 5s statement_timeout that the Pool sets
// for runtime queries — migrations may legitimately do long CREATE INDEX
// or backfill UPDATEs.
const client = await db.connect();
try {
  await client.query('SET statement_timeout = 0');

  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const applied = new Set(
    (await client.query('SELECT filename FROM _migrations')).rows.map(
      (r: { filename: string }) => r.filename,
    ),
  );

  const files = (await readdir(migrationsDir)).filter(f => f.endsWith('.sql')).sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(join(migrationsDir, file), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`✓ ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`✗ ${file}`, err);
      process.exit(1);
    }
  }
} finally {
  client.release();
  await db.end();
}

console.log('Migrations complete.');
