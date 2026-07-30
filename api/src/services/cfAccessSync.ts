// W9 — status-aware reconciliation of one email against the CF policy.
//
// Callers MUST already hold the membership lock (Q26): read-modify-write on
// include[] is not safe concurrently, and putPolicyEmails' compare-and-write
// only narrows the dashboard-edit window, not the RepOS-vs-RepOS one.
import type { UserStatus } from '../constants/users.js';
import { fetchPolicy, putPolicyEmails } from './cfAccessPolicy.js';

/**
 * Q36 — what the CF policy should contain for a row in this status.
 *
 * The point of this function is that `retry-sync` is NOT a reinstate. A
 * retry-sync that always added would silently restore CF access to a suspended
 * user: the operation meant to repair drift would create a security
 * regression. Explicit Reinstate is the operation that retries a failed add.
 */
export function desiredPresence(status: UserStatus): 'present' | 'absent' {
  return status === 'invited' || status === 'active' ? 'present' : 'absent';
}

/**
 * Drive the policy toward `desired` for exactly one email. Returns
 * `{ changed: false }` — with no PUT issued at all — when the policy already
 * agrees, so a redundant retry costs one GET and cannot clobber a concurrent
 * dashboard edit.
 *
 * Throws CfPolicyError untouched; callers translate that into "sync pending"
 * or drift rather than rolling back the DB (Q8, Q17).
 */
export async function syncEmail(
  email: string,
  desired: 'present' | 'absent',
): Promise<{ changed: boolean }> {
  const target = email.toLowerCase();
  const snapshot = await fetchPolicy();
  const present = snapshot.emails.includes(target);
  if ((desired === 'present') === present) return { changed: false };

  const next =
    desired === 'present'
      ? [...snapshot.emails, target]
      : snapshot.emails.filter((e) => e !== target);

  await putPolicyEmails(next, snapshot);
  return { changed: true };
}

/** Convenience wrapper: reconcile an email to whatever its row's status expects. */
export async function syncEmailToStatus(
  email: string,
  status: UserStatus,
): Promise<{ changed: boolean }> {
  return syncEmail(email, desiredPresence(status));
}
