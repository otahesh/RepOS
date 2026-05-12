// Runtime guards that need DB or filesystem access. Kept separate from
// bootstrap-guards.ts (pure env validation) so the latter stays trivially
// unit-testable.

import { existsSync } from 'node:fs';
import { db } from './db/client.js';

const PLACEHOLDER_UUID = '00000000-0000-0000-0000-000000000001';
const DEFAULT_MAINTENANCE_FLAG_PATH = '/config/maintenance.flag';

/**
 * Refuse to boot in production when a `users` row with the placeholder UUID
 * exists. The cutover script at scripts/cutover/001-placeholder-to-jmeyer.sql
 * must run successfully before the API can boot post-flag-flip.
 *
 * No-op in non-production environments — local dev + tests can carry the
 * placeholder row without tripping the guard.
 */
export async function validatePlaceholderPurge(env: NodeJS.ProcessEnv): Promise<void> {
  if (env.NODE_ENV !== 'production') return;
  const { rows } = await db.query(
    `SELECT 1 FROM users WHERE id = $1 LIMIT 1`,
    [PLACEHOLDER_UUID],
  );
  if (rows.length > 0) {
    console.error(
      `FATAL: placeholder user row (id=${PLACEHOLDER_UUID}) found in production DB. ` +
        `Run scripts/cutover/001-placeholder-to-jmeyer.sql before booting.`,
    );
    process.exit(1);
  }
}

/**
 * If a persisted maintenance flag exists at MAINTENANCE_FLAG_PATH (default
 * /config/maintenance.flag), log a warning at boot — the W5.3 maintenance
 * middleware (lands in a later wave) will short-circuit /api/* to 503 except
 * for /api/maintenance/* until the admin clears the flag explicitly.
 *
 * No-op in test env so the test harness can boot freely.
 */
export async function validateMaintenanceFlag(env: NodeJS.ProcessEnv): Promise<void> {
  if (env.NODE_ENV === 'test') return;
  const path = env.MAINTENANCE_FLAG_PATH ?? DEFAULT_MAINTENANCE_FLAG_PATH;
  if (existsSync(path)) {
    console.error(
      `[startup] maintenance flag present at ${path} — ` +
        `API will boot but /api/* will return 503 (except /api/maintenance/*). ` +
        `Admin must clear the flag via /api/maintenance/clear once DB state is verified.`,
    );
    // No process.exit — the API stays up to serve maintenance routes.
  }
}
