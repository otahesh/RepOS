/**
 * Frontend types for the /api/recovery-flags surface.
 * Manually kept in sync with api/src/schemas/recoveryFlags.ts.
 * See api/src/schemas/README.md for the cross-package type mirror strategy.
 *
 * Inconsistency note: the frontend type previously included `scheduled_date`
 * and `dismissable` fields, but the actual API response only returns
 * `flag`, `message`, and (for bodyweight_crash) `trend_7d_lbs`.
 * The corrected type mirrors the real API contract.
 */

import { jsonOrThrow } from './_http';

export { ApiError } from './_http';

export type RecoveryFlagKey = 'bodyweight_crash' | 'overreaching' | 'stalled_pr';

export type RecoveryFlag = {
  flag: RecoveryFlagKey;
  message: string;
  trend_7d_lbs?: number;
};

export async function listRecoveryFlags(): Promise<{ flags: RecoveryFlag[] }> {
  const res = await fetch('/api/recovery-flags', { credentials: 'same-origin' });
  return jsonOrThrow(res);
}

export async function dismissRecoveryFlag(flag: RecoveryFlagKey): Promise<void> {
  const res = await fetch('/api/recovery-flags/dismiss', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin', body: JSON.stringify({ flag }),
  });
  if (!res.ok && res.status !== 204) {
    await jsonOrThrow(res); // throws ApiError
  }
}
