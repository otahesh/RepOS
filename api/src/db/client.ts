import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

export const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// Apply per-session statement_timeout on every new connection.
// 5s caps any single query — prevents one stuck query from hanging the API.
db.on('connect', (client) => {
  client.query('SET statement_timeout = 5000').catch((err) => {
    console.error('failed to set statement_timeout', err);
  });
});
