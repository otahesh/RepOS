import { db } from './client.js';
import { runMigrations } from './runMigrations.js';

try {
  await runMigrations(db);
  console.log('Migrations complete.');
} catch (err) {
  // runMigrations logs `✗ <file>` for a failing migration, but a connection
  // or filesystem failure arrives here unlogged — exiting 1 silently would be
  // worse than the pre-extraction behaviour, which crashed with a stack.
  console.error(err);
  process.exit(1);
} finally {
  await db.end();
}
