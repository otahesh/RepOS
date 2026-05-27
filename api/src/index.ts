import 'dotenv/config';
import { validateStartupEnv } from './bootstrap-guards.js';
import { validatePlaceholderPurge, validateMaintenanceFlag } from './bootstrap-runtime.js';
import { buildApp } from './app.js';
import { db } from './db/client.js';

const guards = validateStartupEnv(process.env);
for (const msg of guards.fatal) {
  console.error(`FATAL: ${msg}`);
}
if (guards.fatal.length > 0) {
  process.exit(1);
}
for (const entry of guards.info) {
  console.log(`[startup] ${JSON.stringify(entry)}`);
}

await validatePlaceholderPurge(process.env);
await validateMaintenanceFlag(process.env);

const app = await buildApp({ logger: true });
const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '127.0.0.1';
await app.listen({ port, host });

// W5 — graceful drain on SIGTERM. Fastify's close() stops accepting new
// connections, waits for in-flight requests up to the keep-alive timeout,
// then resolves. Then we close the pg pool so its connections terminate
// cleanly rather than being yanked.
//
// This is the critical reorder behind C-RESTORE-ORDERING: run-restore.sh
// sends SIGTERM and waits for the API to exit BEFORE pg_restore touches the
// DB, so the pool is fully drained before any DROP.
//
// I-POOL-DRAIN-DOC — SHUTDOWN_TIMEOUT_MS defaults to 30s, derived from
// statement_timeout=5s × 6 retries (the maximum surface a long-running
// chained query could occupy) plus a small safety margin. Reduce only if
// statement_timeout is lowered in the DB config.
//
// I-SIGTERM-DRAIN-PRESERVES-BACKUP — if a manual backup is in flight when
// SIGTERM lands, the backupRunner's status='running' row is on disk; the boot
// reaper (bootstrap-runtime.ts) marks it failed on next boot.
let shuttingDown = false;
async function gracefulShutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'graceful shutdown begin');
  const timeoutMs = Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 30_000);
  const timeout = setTimeout(() => {
    app.log.error({ timeoutMs }, 'shutdown timed out — forcing exit 1');
    process.exit(1);
  }, timeoutMs);
  timeout.unref();
  try {
    await app.close();
    await db.end();
    app.log.info('graceful shutdown done');
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, 'shutdown error');
    process.exit(1);
  }
}
process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
