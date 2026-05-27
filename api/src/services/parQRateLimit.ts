// api/src/services/parQRateLimit.ts
// Beta W2.3 — per-user PAR-Q write rate limit (panel I-RATE-LIMIT).
//
// nginx's binary_remote_addr zone is insufficient because CF Tunnel collapses
// all egress to a single IP — every browser request looks like one client.
// So we enforce a per-user 5-writes/24h limit at the application layer instead.
//
// The par_q_acknowledgments table IS the audit ledger: we already INSERT a row
// (or upsert) on every accepted POST, so count(*) over the trailing 24h window
// is the rate-limit signal — no separate write-log table needed.
import { db } from '../db/client.js';
import type { PoolClient } from 'pg';

const PAR_Q_DAILY_WRITE_LIMIT = 5;

export async function checkParQWriteRateLimit(userId: string): Promise<boolean> {
  const { rows } = await db.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM par_q_acknowledgments
      WHERE user_id = $1 AND accepted_at > now() - interval '24 hours'`,
    [userId],
  );
  return rows[0].c < PAR_Q_DAILY_WRITE_LIMIT;
}

// Recorded inside the POST handler's transaction, AFTER the INSERT into
// par_q_acknowledgments. The par_q_acknowledgments row itself serves as the
// audit, so this is currently a no-op — provided as an extension point if a
// separate audit table becomes needed.
export async function recordParQWrite(_client: PoolClient, _userId: string): Promise<void> {
  // par_q_acknowledgments INSERT IS the audit row; no separate write.
}
