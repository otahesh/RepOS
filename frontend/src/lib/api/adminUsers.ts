// frontend/src/lib/api/adminUsers.ts
// Beta W9 — typed client for /api/admin/users. Every state-changing call
// carries X-RepOS-CSRF:1 (csrfOrigin requires it on the CF Access path).
//
// The response types below mirror `api/src/services/userLifecycle.ts` exactly
// — InviteOutcome, PatchOutcome and retrySync's return are NOT the list row
// shape, and typing them as one would silently promise fields the API never
// sends.
import { apiFetch } from '../../auth';
import { jsonOrThrow } from './_http';

export type UserStatus = 'invited' | 'active' | 'suspended' | 'deleting';
export type UserRole = 'member' | 'admin';

export interface AdminUserRow {
  id: string;
  email: string;
  display_name: string | null;
  role: UserRole;
  status: UserStatus;
  invited_at: string | null;
  activated_at: string | null;
  last_seen_at: string | null;
  cf_synced_at: string | null;
  invite_sent_at: string | null;
  invited_by_email: string | null;
}

export interface DriftReport {
  /** false when the live policy could not be read at all. */
  checked: boolean;
  policy_error: string | null;
  divergent: Array<{
    email: string;
    reason: 'in_policy_unexpected' | 'missing_from_policy' | 'in_policy_no_row';
  }>;
  /** Q36 — sync state UNKNOWN (stamp missing), which is NOT divergence. */
  unknown: string[];
}

export interface AdminUserList {
  users: AdminUserRow[];
  cohort: { count: number; cap: number };
  drift: DriftReport;
}

/** Mirrors InviteOutcome. A 200/201 can still carry a mail or sync failure. */
export interface InviteOutcome {
  id: string;
  email: string;
  status: UserStatus;
  created: boolean;
  cf_synced: boolean;
  invite_sent: boolean;
  sync_error: string | null;
  mail_error: string | null;
  resent?: boolean;
  resynced?: boolean;
}

/** Mirrors PatchOutcome — a summary, not a full list row. */
export interface PatchOutcome {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  cf_synced: boolean;
  sync_error: string | null;
}

export interface RetrySyncOutcome {
  id: string;
  cf_synced: boolean;
  sync_error: string | null;
  /** Q36 — reconciliation is status-aware; it does not blindly re-add. */
  direction: 'present' | 'absent';
}

export async function listUsers(): Promise<AdminUserList> {
  return jsonOrThrow<AdminUserList>(await apiFetch('/api/admin/users'));
}

export async function inviteUser(email: string, role: UserRole): Promise<InviteOutcome> {
  const res = await apiFetch('/api/admin/users/invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-RepOS-CSRF': '1' },
    body: JSON.stringify({ email, role }),
  });
  return jsonOrThrow<InviteOutcome>(res);
}

export async function patchUser(
  id: string,
  patch: { role?: UserRole; status?: 'active' | 'suspended' },
): Promise<PatchOutcome> {
  const res = await apiFetch(`/api/admin/users/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-RepOS-CSRF': '1' },
    body: JSON.stringify(patch),
  });
  return jsonOrThrow<PatchOutcome>(res);
}

export async function resendInvite(id: string): Promise<InviteOutcome> {
  const res = await apiFetch(`/api/admin/users/${id}/resend-invite`, {
    method: 'POST',
    headers: { 'X-RepOS-CSRF': '1' },
  });
  return jsonOrThrow<InviteOutcome>(res);
}

export async function retrySync(id: string): Promise<RetrySyncOutcome> {
  const res = await apiFetch(`/api/admin/users/${id}/retry-sync`, {
    method: 'POST',
    headers: { 'X-RepOS-CSRF': '1' },
  });
  return jsonOrThrow<RetrySyncOutcome>(res);
}

export async function deleteUser(id: string): Promise<void> {
  const res = await apiFetch(`/api/admin/users/${id}`, {
    method: 'DELETE',
    headers: { 'X-RepOS-CSRF': '1' },
  });
  if (!res.ok) await jsonOrThrow(res); // throws ApiError with the parsed body
}
