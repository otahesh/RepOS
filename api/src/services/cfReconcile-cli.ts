// CLI wrapper. Invoked by scripts/cutover/002-w9-cf-baseline.sh with
// --source=cutover and by scripts/run-restore.sh with --source=restore.
import { db } from '../db/client.js';
import { reconcileCfBaseline, ReconcileAbort } from './cfReconcile.js';

const arg = process.argv.find((a) => a.startsWith('--source='));
const source = arg?.slice('--source='.length);
if (source !== 'cutover' && source !== 'restore') {
  console.error('usage: cfReconcile-cli --source=cutover|restore');
  process.exit(2);
}

try {
  const r = await reconcileCfBaseline(source);
  console.log(JSON.stringify({ source, ...r }, null, 2));
  if (r.divergent.length > 0) {
    console.warn(`⚠ ${r.divergent.length} row(s) diverge from the CF policy — see /settings/users`);
  }
} catch (err) {
  if (err instanceof ReconcileAbort) {
    console.error(`✗ reconciliation aborted (${err.code}): ${err.message}`);
  } else {
    console.error('✗ reconciliation failed', err);
  }
  process.exit(1);
} finally {
  await db.end();
}
