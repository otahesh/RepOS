// Runtime guards that need DB or filesystem access. Kept separate from
// bootstrap-guards.ts (pure env validation) so the latter stays trivially
// unit-testable.

import {
  existsSync,
  readFileSync,
  openSync,
  writeSync,
  fsyncSync,
  closeSync,
} from 'node:fs';
import { db } from './db/client.js';

const PLACEHOLDER_UUID = '00000000-0000-0000-0000-000000000001';
// Re-export under the spec name (08-qa.md §PLACEHOLDER) for the insert-time guard
// and unit tests. Do NOT import this constant into production source — the grep
// guard (scripts/check-no-placeholder.sh) only catches the literal UUID string.
export const PLACEHOLDER_USER_ID = PLACEHOLDER_UUID;
const DEFAULT_MAINTENANCE_FLAG_PATH = '/config/maintenance.flag';
const DEFAULT_RESTORE_STATE_PATH = '/config/restore-state.json';

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
 * G8 insert-time guard. Refuse to attach the placeholder user UUID to any
 * write outside the test environment. The boot-time validatePlaceholderPurge
 * rejects the placeholder EXISTING in production; this is the complementary
 * write-path guard that stops it being (re)created at runtime in dev or prod.
 * No-op for null/undefined (no identity yet) and in NODE_ENV=test (fixtures
 * legitimately seed the placeholder row).
 */
export function assertNotPlaceholderUserId(
  userId: string | null | undefined,
  env: NodeJS.ProcessEnv,
): void {
  if (env.NODE_ENV === 'test') return;
  if (userId === PLACEHOLDER_UUID) {
    throw new Error(
      `refusing to write placeholder user (id=${PLACEHOLDER_UUID}) — ` +
        `real identity must come from CF Access. This is a bug; see G8.`,
    );
  }
}

/**
 * W5 — I-STALE-ROW-REAPER. Mark stale running backup/restore-prep rows as
 * failed so /api/backups doesn't show "running" forever when a process died.
 * Threshold: 15 minutes for backups (which take 5-30s) + pre_restore snapshots.
 * Runs in ALL environments (it is a safe idempotent DB UPDATE) so the
 * integration suite can exercise it.
 */
export async function reapStaleBackupRuns(): Promise<void> {
  await db.query(`
    UPDATE backup_runs
    SET status='failed',
        error_message='reaped: process did not finalize',
        finished_at=now()
    WHERE status='running'
      AND trigger IN ('manual','auto','pre_restore')
      AND started_at < now() - interval '15 minutes'
  `);
}

/**
 * W5 — C-STALE-LOCK. If /config/restore-state.json exists AND
 * started_at < now() - 5 min while still status='running', the restore
 * process crashed. Mark the sentinel as failed (with fsync) so
 * /api/maintenance/status returns recovery_available=true and the FE shows
 * the Roll-back affordance.
 */
export function detectStaleRestoreSentinel(env: NodeJS.ProcessEnv): void {
  const sentinelPath = env.RESTORE_STATE_PATH ?? DEFAULT_RESTORE_STATE_PATH;
  if (!existsSync(sentinelPath)) return;
  try {
    const state = JSON.parse(readFileSync(sentinelPath, 'utf8'));
    const startedAt = new Date(state.started_at).getTime();
    if (state.status === 'running' && Date.now() - startedAt > 5 * 60 * 1000) {
      const updated = {
        ...state,
        status: 'failed',
        error_message: 'detected stale restore at boot',
        finished_at: new Date().toISOString(),
      };
      const fd = openSync(sentinelPath, 'w');
      try {
        writeSync(fd, JSON.stringify(updated));
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    }
  } catch (err) {
    console.warn('[boot] failed to read/update restore-state.json', err);
  }
}

/**
 * If a persisted maintenance flag exists at MAINTENANCE_FLAG_PATH (default
 * /config/maintenance.flag), log a warning at boot — the W5.3 maintenance
 * middleware short-circuits /api/* to 503 except for /api/maintenance/*
 * until the admin clears the flag explicitly.
 *
 * Always runs the stale-row reaper + stale-restore-sentinel detection (these
 * are safe in all environments). The flag-present console warning is gated to
 * non-test env so the test harness boot stays quiet.
 */
export async function validateMaintenanceFlag(env: NodeJS.ProcessEnv): Promise<void> {
  // W5 — I-STALE-ROW-REAPER + C-STALE-LOCK run in every environment.
  await reapStaleBackupRuns();
  detectStaleRestoreSentinel(env);

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
