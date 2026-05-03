import { readdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { db } from './client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, 'migrations');

await db.query(`
  CREATE TABLE IF NOT EXISTS _migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`);

const applied = new Set(
  (await db.query('SELECT filename FROM _migrations')).rows.map((r: { filename: string }) => r.filename)
);

const files = (await readdir(migrationsDir)).filter(f => f.endsWith('.sql')).sort();

for (const file of files) {
  if (applied.has(file)) continue;
  const sql = await readFile(join(migrationsDir, file), 'utf8');
  await db.query('BEGIN');
  try {
    await db.query(sql);
    await db.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
    await db.query('COMMIT');
    console.log(`✓ ${file}`);
  } catch (err) {
    await db.query('ROLLBACK');
    console.error(`✗ ${file}`, err);
    process.exit(1);
  }
}

await db.end();
console.log('Migrations complete.');
