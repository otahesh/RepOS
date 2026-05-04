import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

// `statement_timeout` is sent as part of the connection startup parameters
// before the client is handed to user code — using the native Pool option
// (vs a `connect` event handler running an unawaited `SET`) avoids the
// overlapping-query DeprecationWarning from pg.
export const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 5_000,
});
