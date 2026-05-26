// frontend/src/lib/api/account.ts
//
// Beta W6 Task 10 — typed client wrappers for the /api/me + /api/account
// surfaces. All wrappers go through `apiFetch` (same-origin cookie creds + CF
// Access 401 redirect handling) so the components don't have to reinvent that.
//
// State-changing requests (PATCH / POST / DELETE) include the
// `X-RepOS-CSRF: 1` custom header which the API's csrfOrigin middleware
// requires. A cross-origin attacker can't set custom headers without a CORS
// preflight + matching Origin, so this is the same-site CSRF guard.
//
// Server response shapes are mirrored from api/src/schemas/account.ts —
// notably `last_used_ip_24` (truncated /24 per I-LAST-IP-TRUNCATE), and the
// keyset cursor on events (per I-PAGINATION-KEYSET).
//
// NO `units` field anywhere (per D6 — units deferred from W6).

import { apiFetch } from '../../auth';
import { CONFIRM_DELETE_ACCOUNT_PHRASE } from '../constants/accountConfirmPhrases';
import { ApiError } from './_http';

export { ApiError };

// ───────────────────────── types (mirror api/src/schemas/account.ts) ─────

export type ProfilePatchRequest = {
  display_name?: string;
  timezone?: string;
};

export type ProfileResponse = {
  id: string;
  email: string;
  display_name: string | null;
  timezone: string;
};

export type SessionRow = {
  id: string;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
  // /24-truncated server-side; the client never sees the full IP.
  last_used_ip_24: string | null;
};

export type AccountEventKind =
  | 'profile_changed'
  | 'token_minted'
  | 'token_revoked'
  | 'signout_everywhere'
  | 'delete_initiated'
  | 'par_q_acknowledged'
  | 'onboarding_completed'
  | 'restore_replayed';

export type AccountEventRow = {
  id: string;
  kind: AccountEventKind;
  ip: string | null;
  user_email_at_event: string | null;
  meta: Record<string, unknown>;
  occurred_at: string;
};

export type AccountEventCursor = {
  before_ts: string;
  before_id: string;
};

export type AccountEventPage = {
  events: AccountEventRow[];
  next_cursor: AccountEventCursor | null;
};

export type ListEventsParams = {
  before_ts?: string;
  before_id?: string;
  limit?: number;
};

// ───────────────────────── helpers ─────────────────────────────────────────

const CSRF_HEADER = { 'X-RepOS-CSRF': '1' } as const;
const JSON_HEADERS = {
  'Content-Type': 'application/json',
  ...CSRF_HEADER,
} as const;

async function parseOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const raw = await res.text();
    let parsed: unknown = undefined;
    try {
      parsed = raw ? JSON.parse(raw) : undefined;
    } catch {
      /* keep raw */
    }
    throw new ApiError(res.status, parsed, raw || res.statusText);
  }
  return res.json() as Promise<T>;
}

async function expectNoContent(res: Response): Promise<void> {
  if (res.status === 204) return;
  if (!res.ok) {
    const raw = await res.text();
    let parsed: unknown = undefined;
    try {
      parsed = raw ? JSON.parse(raw) : undefined;
    } catch {
      /* keep raw */
    }
    throw new ApiError(res.status, parsed, raw || res.statusText);
  }
  // 2xx but not 204 — drain body for completeness.
}

// ───────────────────────── PATCH /api/me/profile ───────────────────────────

/**
 * Update the current user's profile. Only the fields present in `patch` are
 * sent; the server validates each independently.
 *
 * Per D6, `units` is intentionally NOT part of the surface.
 */
export async function patchProfile(
  patch: ProfilePatchRequest,
): Promise<ProfileResponse> {
  const res = await apiFetch('/api/me/profile', {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(patch),
  });
  return parseOrThrow<ProfileResponse>(res);
}

// ───────────────────────── DELETE /api/me ──────────────────────────────────

/**
 * Full-cascade account deletion. The `confirm` arg is constrained to the
 * exact typed-confirm phrase at the type level so a misclick can't reach
 * here without the dialog. The runtime check still lives on the server.
 *
 * Returns void on 204. The session is gone after this — the caller is
 * responsible for navigating away.
 */
export async function deleteAccount(
  confirm: typeof CONFIRM_DELETE_ACCOUNT_PHRASE,
): Promise<void> {
  const res = await apiFetch('/api/me', {
    method: 'DELETE',
    headers: JSON_HEADERS,
    body: JSON.stringify({ confirm }),
  });
  await expectNoContent(res);
}

// ───────────────────────── POST /api/auth/signout-everywhere ──────────────

/**
 * Revoke every non-revoked bearer token belonging to this user and clear the
 * CF Access cookie via Set-Cookie on the response. The browser will be
 * unauthenticated on the next /api/me hit.
 *
 * CF-Access-only per C-SIGNOUT-CFACCESS-ONLY (a stolen bearer must not be
 * able to nuke the user's other devices).
 */
export async function signOutEverywhere(): Promise<void> {
  const res = await apiFetch('/api/auth/signout-everywhere', {
    method: 'POST',
    headers: CSRF_HEADER,
  });
  await expectNoContent(res);
}

// ───────────────────────── GET /api/account/sessions ──────────────────────

/**
 * List the user's non-revoked bearer tokens (their "sessions"). IPs are
 * truncated to /24 server-side per I-LAST-IP-TRUNCATE; the client never sees
 * the precise address.
 */
export async function listSessions(): Promise<SessionRow[]> {
  const res = await apiFetch('/api/account/sessions', { method: 'GET' });
  const body = await parseOrThrow<{ sessions: SessionRow[] }>(res);
  return body.sessions;
}

// ───────────────────────── GET /api/account/events ────────────────────────

/**
 * Keyset-paginated audit feed (per I-PAGINATION-KEYSET). Pass the
 * `next_cursor` fields from a prior page to load the next slice; omit them
 * to load the first page.
 */
export async function listEvents(
  params: ListEventsParams = {},
): Promise<AccountEventPage> {
  const qs = new URLSearchParams();
  if (params.before_ts) qs.set('before_ts', params.before_ts);
  if (params.before_id) qs.set('before_id', params.before_id);
  if (params.limit != null) qs.set('limit', String(params.limit));
  const query = qs.toString();
  const path = query ? `/api/account/events?${query}` : '/api/account/events';
  const res = await apiFetch(path, { method: 'GET' });
  return parseOrThrow<AccountEventPage>(res);
}
