// Reconstructs a pre-W9 database so the next runMigrations re-applies the whole
// 080–089 range from scratch.
//
// Shared rather than copied. This unwind has been written three times in this
// wave and been WRONG twice, each time in the same way: it removed the
// migrations someone remembered and left the rest applied. A leftover
// `_migrations` row makes the re-run skip that file silently, so the test then
// proves the restore path only for the migrations that were unwound — while
// reading as though it covered all of them. Round six caught 081 being left
// behind; Task 15b caught 082.
//
// The rule, stated once, here: ANYTHING added in the 080–089 range must be
// unwound in this function. That includes objects that are not columns — 082's
// trigger and function must be dropped BEFORE the columns they depend on, or
// `DROP COLUMN status` fails with "other objects depend on it".
import type pg from 'pg';

/** Every migration W9 adds. Keep in sync with `src/db/migrations/08*.sql`. */
export const W9_MIGRATIONS = [
  '080_users_roles_status.sql',
  '081_invite_request.sql',
  '082_cf_sync_stamp_guard.sql',
] as const;

/** Every column W9 adds to `users` — eight from 080, one from 081. */
export const W9_USER_COLUMNS = [
  'role',
  'status',
  'invited_by',
  'invited_at',
  'activated_at',
  'cf_synced_at',
  'invite_sent_at',
  'invite_message_id',
  'invite_request',
] as const;

/**
 * Drop everything W9 created and re-arm all three migrations.
 *
 * Also empties `users`, because 080's data step (Q35) branches on whole-table
 * state — a leftover row would decide which clause fires.
 */
export async function unwindToPreW9(pool: pg.Pool): Promise<void> {
  await pool.query(`DELETE FROM users`);

  // 082 first: the trigger depends on users.status, so the column drop below
  // fails while it exists.
  await pool.query(`DROP TRIGGER IF EXISTS users_cf_stamp_guard ON users`);
  await pool.query(`DROP FUNCTION IF EXISTS users_cf_stamp_guard()`);

  await pool.query(`DELETE FROM _migrations WHERE filename = ANY($1)`, [[...W9_MIGRATIONS]]);

  await pool.query(
    `ALTER TABLE users ${W9_USER_COLUMNS.map((c) => `DROP COLUMN ${c}`).join(', ')}`,
  );
  // Redundant once `status` is dropped — the index goes with its column — but
  // kept so the unwind still holds if the index is ever moved to another column.
  await pool.query(`DROP INDEX IF EXISTS users_status_idx`);
}
