import type { FastifyRequest, FastifyReply } from 'fastify';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { db } from '../db/client.js';
import { requireAuth } from './auth.js';
import { recordAccountEventTx, humanActor } from '../services/accountEvents.js';

// CF Access whole-host auth. Reads the JWT from either the
// `Cf-Access-Jwt-Assertion` header (server-to-server / Shortcut-style) or the
// `CF_Authorization` cookie (browser). Verifies signature against the team's
// JWKS endpoint, validates `aud` and `iss`, then resolves the email claim
// to a `users` row. Deny-by-default per W9 Q2: no row means 403, never an
// INSERT.
//
// All gating is on `CF_ACCESS_ENABLED=true` — when off, requireCfAccess
// returns 503 so callers can detect "feature not configured" cleanly. This
// matches the deploy ordering: code lands first, the user creates the CF
// Access apps in the dashboard, then the env flag flips on.

// JWKS cache strategy: refresh the public-key set at most every 30s under
// normal traffic (cacheMaxAge), and on a cache miss for a kid, refresh
// immediately without rate-limiting (cooldownDuration=0). With Cloudflare
// Access's occasional JWKS rotation cadence, this yields a ~60s p99 budget
// for a rotated-in key to start verifying. Beta W0.6's integration test
// in api/tests/integration/jwks-rotation.test.ts proves the budget holds.
let cachedJwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function jwks() {
  if (cachedJwks) return cachedJwks;
  const teamDomain = process.env.CF_ACCESS_TEAM_DOMAIN;
  if (!teamDomain) throw new Error('CF_ACCESS_TEAM_DOMAIN must be set');
  // Test-only escape hatch: allow http:// when teamDomain is a localhost
  // ephemeral-port form like "127.0.0.1:54321" AND NODE_ENV=test. Prod always
  // resolves to https:// because real team domains start with team names.
  const proto =
    process.env.NODE_ENV === 'test' && teamDomain.startsWith('127.0.0.1')
      ? 'http'
      : 'https';
  cachedJwks = createRemoteJWKSet(
    new URL(`${proto}://${teamDomain}/cdn-cgi/access/certs`),
    {
      cacheMaxAge: 30_000, // 30s soft refresh
      cooldownDuration: 0, // immediate refresh on a kid miss
    },
  );
  return cachedJwks;
}

/**
 * Test-only: clear the module-level JWKS cache so a rotation in test N
 * doesn't leak into test N+1. Do not call from production code.
 */
export function resetJwksCacheForTesting(): void {
  cachedJwks = null;
}

export function isCfAccessEnabled(): boolean {
  return (
    process.env.CF_ACCESS_ENABLED === 'true' &&
    !!process.env.CF_ACCESS_AUD &&
    !!process.env.CF_ACCESS_TEAM_DOMAIN
  );
}

function readCfAccessJwt(req: FastifyRequest): string | undefined {
  const headerJwt = req.headers['cf-access-jwt-assertion'];
  if (typeof headerJwt === 'string' && headerJwt.length > 0) return headerJwt;
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return undefined;
  const m = cookieHeader.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : undefined;
}

function buildLoginUrl(req: FastifyRequest): string {
  const teamDomain = process.env.CF_ACCESS_TEAM_DOMAIN ?? '';
  const host = (req.headers.host as string | undefined) ?? '';
  // After CF Access login, the user is redirected back to the original URL.
  // For /api/* paths that's a raw JSON response, which is ugly UX. Land on
  // the SPA root instead so the AuthProvider can re-bootstrap normally.
  const target = req.url.startsWith('/api/') ? '/' : req.url;
  return `https://${teamDomain}/cdn-cgi/access/login/${host}${target}`;
}

export async function requireCfAccess(req: FastifyRequest, reply: FastifyReply) {
  if (!isCfAccessEnabled()) {
    return reply.code(503).send({ error: 'cf_access_disabled' });
  }

  const token = readCfAccessJwt(req);
  if (!token) {
    reply.header('WWW-Authenticate', `CFAccess url=${buildLoginUrl(req)}`);
    return reply.code(401).send({ error: 'no_cf_access_jwt' });
  }

  let payload: { email?: unknown; name?: unknown };
  try {
    const teamDomain = process.env.CF_ACCESS_TEAM_DOMAIN!;
    const result = await jwtVerify(token, jwks(), {
      audience: process.env.CF_ACCESS_AUD,
      issuer: `https://${teamDomain}`,
    });
    payload = result.payload as { email?: unknown; name?: unknown };
  } catch {
    reply.header('WWW-Authenticate', `CFAccess url=${buildLoginUrl(req)}`);
    return reply.code(401).send({ error: 'invalid_cf_access_jwt' });
  }

  const rawEmail = typeof payload.email === 'string' ? payload.email.toLowerCase() : null;
  if (!rawEmail) return reply.code(401).send({ error: 'no_email_claim' });

  const displayNameClaim = typeof payload.name === 'string' ? payload.name : null;

  // Deny-by-default (Q2). cfAccess.ts previously INSERTed a users row for any
  // email that cleared CF Access; auto-provisioning is the opposite of a gate,
  // and without this flip the DB cannot be authoritative.
  const { rows } = await db.query<{
    id: string;
    display_name: string | null;
    timezone: string;
    last_seen_at: Date | null;
    status: string;
    role: string;
    cf_synced_at: Date | null;
  }>(
    `SELECT id, display_name, timezone, last_seen_at, status, role, cf_synced_at
     FROM users WHERE lower(email) = $1`,
    [rawEmail],
  );

  if (rows.length === 0) {
    req.log.warn({ email: rawEmail }, 'cf_access_not_invited');
    return reply.code(403).send({ error: 'not_invited' });
  }

  const user = rows[0];
  let status = user.status;

  if (status === 'invited') {
    // Q17b — an invited row may not activate unless its CF provisioning
    // actually landed. Without this precondition a row whose CF step failed
    // would be activatable the moment anything put a session in front of it.
    if (user.cf_synced_at === null) {
      req.log.warn({ email: rawEmail }, 'cf_access_not_provisioned');
      return reply.code(403).send({ error: 'not_provisioned' });
    }

    // Q21 — the conditional UPDATE picks exactly one winner among concurrent
    // first requests, so user_activated is emitted at most once.
    //
    // Q27 — the UPDATE and its audit row commit TOGETHER. Doing the update on
    // the pool and then recording the event separately would leave an
    // activated account with no user_activated row if the process died or the
    // insert failed in between: a mutation without its event, which is exactly
    // the lost-intent case invariant I3 forbids. Only the transaction that
    // actually won the race writes the event, so the race test's
    // "exactly one event" assertion still holds.
    const client = await db.connect();
    let won = false;
    try {
      await client.query('BEGIN');
      const upd = await client.query<{ id: string }>(
        `UPDATE users SET status='active', activated_at=now()
          WHERE id=$1 AND status='invited' AND cf_synced_at IS NOT NULL
          RETURNING id`,
        [user.id],
      );
      won = upd.rowCount === 1;
      if (won) {
        await recordAccountEventTx(client, {
          userId: user.id,
          userEmail: rawEmail,
          kind: 'user_activated',
          ip: req.ip,
          meta: { ...humanActor(user.id, rawEmail) },
        });
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      req.log.error({ err, userId: user.id }, 'activation_failed');
      // Fail closed: an activation we could not commit must not admit anyone.
      return reply.code(403).send({ error: 'not_provisioned' });
    } finally {
      client.release();
    }

    if (won) {
      status = 'active';
    } else {
      // A zero-row result is NEVER treated as "someone else activated me"
      // (round-4 review finding 3). The update may equally have lost because
      // an admin concurrently suspended or deleted the row — assuming the
      // benign case would let a suspended user straight through. Re-read and
      // branch on the row's ACTUAL current status.
      const re = await db.query<{ status: string; cf_synced_at: Date | null }>(
        `SELECT status, cf_synced_at FROM users WHERE id=$1`,
        [user.id],
      );
      status = re.rows[0]?.status ?? 'deleting';
      if (status === 'invited') {
        return reply.code(403).send({ error: 'not_provisioned' });
      }
    }
  }

  if (status !== 'active') {
    // 'suspended' and 'deleting' share one response: a deleting row must not
    // reveal that a deletion is under way.
    req.log.warn({ email: rawEmail, status }, 'cf_access_inactive');
    return reply.code(403).send({ error: 'access_suspended' });
  }

  const last = user.last_seen_at;
  if (!last || Date.now() - last.getTime() > 60_000) {
    // Debounce last_seen_at writes to once per minute per user.
    await db.query(`UPDATE users SET last_seen_at = now() WHERE id = $1`, [user.id]);
  }

  (req as any).userId = user.id;
  (req as any).userEmail = rawEmail;
  (req as any).userDisplayName = user.display_name ?? displayNameClaim;
  (req as any).userTimezone = user.timezone;
  (req as any).userRole = user.role;
}

// Composer: tries Bearer first (the iOS Shortcut machine path), then CF
// Access (the browser path). 401 if neither succeeds. The CF Access edge
// "Bypass" rule on /api/health/* lets the Shortcut reach this composer
// without a JWT challenge — the bearer check then enforces auth.
export async function requireBearerOrCfAccess(req: FastifyRequest, reply: FastifyReply) {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return requireAuth(req, reply);
  }
  // No Bearer header: only fall through to CF Access when it's actually configured.
  // Otherwise the request is simply unauthenticated → 401, not "service unavailable".
  if (!isCfAccessEnabled()) {
    reply.header('WWW-Authenticate', 'Bearer realm="api"');
    return reply.code(401).send({ error: 'unauthorized' });
  }
  return requireCfAccess(req, reply);
}

// Q3 — users.role replaces REPOS_ADMIN_EMAILS. The comment that used to live
// at line 265 claimed "Migration 063 reserves users.role"; that migration was
// never written (060-062 then a jump to 070). Migration 080 actually builds it.
//
// Fail-closed: the role is only ever read from a row the gate already
// resolved, so an unauthenticated request can never be admin.
export function isAdminRequest(req: FastifyRequest): boolean {
  return (req as { userRole?: string }).userRole === 'admin';
}

/** Returns true if the reply was already sent (caller must short-circuit). */
function rejectIfNotAdminRole(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!isAdminRequest(req)) {
    req.log.warn(
      { userEmail: (req as { userEmail?: string }).userEmail },
      'admin_check_rejected',
    );
    reply.code(403).send({ error: 'not_an_admin' });
    return true;
  }
  return false;
}

// /api/tokens auth: admin API key path keeps body `user_id` semantics for
// CLI / tests; CF Access path derives identity from the JWT. authMode is
// stashed on the request so handlers can pick the right user_id source.
//
// FACTORY (W5): call `requireAdminKeyOrCfAccess()` to get a preHandler.
//   - default ({}): dual-auth (X-Admin-Key OR CF Access JWT + role='admin').
//   - { requireFreshCfAccess: true } (per C-RESTORE-AUTH-CFACCESS): destructive
//     admin ops (restore) — REJECT the X-Admin-Key path, require CF Access JWT
//     + role='admin'. The opaque bearer escape hatch is not enough for a
//     restore that DROPs the database.
export function requireAdminKeyOrCfAccess(
  opts: { requireFreshCfAccess?: boolean } = {},
) {
  return async function adminGate(req: FastifyRequest, reply: FastifyReply) {
    if (opts.requireFreshCfAccess) {
      // Dev / test: ADMIN_API_KEY unset means open admin path — same bypass
      // the dual-auth branch uses below. Production always sets ADMIN_API_KEY,
      // so the strict CF-Access-only path below is enforced in prod.
      if (!process.env.ADMIN_API_KEY) {
        (req as any).authMode = 'cf_access_fresh';
        return;
      }
      // Restore endpoints — reject any X-Admin-Key presence, require CF Access.
      const adminKeyHeader = req.headers['x-admin-key'];
      if (typeof adminKeyHeader === 'string' && adminKeyHeader.length > 0) {
        req.log.warn({ path: req.url }, 'admin_key_rejected_on_fresh_cf_access_route');
        return reply.code(403).send({ error: 'cf_access_required' });
      }
      if (!isCfAccessEnabled()) {
        return reply.code(503).send({ error: 'cf_access_unavailable' });
      }
      await requireCfAccess(req, reply);
      if (reply.sent) return;
      if (rejectIfNotAdminRole(req, reply)) return;
      (req as any).authMode = 'cf_access_fresh';
      return;
    }

    const adminKey = process.env.ADMIN_API_KEY;

    // Dev / test: ADMIN_API_KEY unset means open admin path.
    if (!adminKey) {
      (req as any).authMode = 'admin';
      return;
    }

    const provided = req.headers['x-admin-key'];
    if (typeof provided === 'string' && provided.length > 0) {
      if (provided !== adminKey) {
        return reply.code(401).send({ error: 'unauthorized' });
      }
      (req as any).authMode = 'admin';
      return;
    }

    if (isCfAccessEnabled()) {
      await requireCfAccess(req, reply);
      if (reply.sent) return;
      (req as any).authMode = 'cf_access';

      // Per D10 as re-based by W9 Q3: authorization is users.role, resolved by
      // requireCfAccess above. There is no env allow-list any more.
      if (rejectIfNotAdminRole(req, reply)) return;
      return;
    }

    return reply.code(401).send({ error: 'unauthorized' });
  };
}

// Per C-SIGNOUT-CFACCESS-ONLY — gate routes that must NEVER act on a stolen
// bearer (signout-everywhere, account deletion). If an Authorization: Bearer
// header is present, reject 403 even before JWT validation. Otherwise
// delegate to the existing CF Access JWT validator.
//
// We deliberately call `requireCfAccess` directly: same code path used by the
// cookie branch of `requireBearerOrCfAccess`, no refactor required. After a
// successful JWT validation we stamp `authMode='cf_access'` so the downstream
// `csrfOrigin` preHandler enforces the Origin guard (per C-CSRF-ORIGIN) — a
// stolen JWT replayed cross-origin must still be blocked.
export async function requireCfAccessOnly(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    req.log.warn({ path: req.url }, 'bearer_rejected_on_cf_access_only_route');
    return reply.code(403).send({ error: 'cf_access_required' });
  }
  await requireCfAccess(req, reply);
  if (reply.sent) return;
  (req as any).authMode = 'cf_access';
}

/**
 * Q20 — the user-management gate. CF Access JWT + role='admin', with the
 * X-Admin-Key path rejected outright.
 *
 * Why reject the admin key: requireAdminKeyOrCfAccess returns on its admin-key
 * branch WITHOUT setting req.userId or req.userEmail, so there is no actor —
 * the self-lockout guards (Q13) have no "self" to compare against and audit
 * rows have no attribution. Precedent already exists at account.ts:298, which
 * gates DELETE /api/me with requireCfAccessOnly on identical reasoning. No
 * operator automation needs to manage users.
 *
 * Q32 — this is NOT `requireFreshCfAccess`. It performs no token-age check and
 * makes no re-authentication guarantee; it requires a valid CF Access JWT and
 * the admin role, nothing more. Renaming the existing misleading flag is a
 * follow-up, out of scope for W9.
 *
 * `rejectBearer` is used by DELETE: a stolen bearer must never delete a user.
 */
export function requireCfAccessAdmin(opts: { rejectBearer?: boolean } = {}) {
  return async function cfAccessAdminGate(req: FastifyRequest, reply: FastifyReply) {
    if (opts.rejectBearer) {
      const auth = req.headers.authorization;
      if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
        req.log.warn({ path: req.url }, 'bearer_rejected_on_admin_users_route');
        return reply.code(403).send({ error: 'cf_access_required' });
      }
    }
    const adminKeyHeader = req.headers['x-admin-key'];
    if (typeof adminKeyHeader === 'string' && adminKeyHeader.length > 0) {
      req.log.warn({ path: req.url }, 'admin_key_rejected_on_user_management_route');
      return reply.code(403).send({ error: 'cf_access_required' });
    }
    await requireCfAccess(req, reply);
    if (reply.sent) return;
    if (rejectIfNotAdminRole(req, reply)) return;
    // Stamp authMode so the chained csrfOrigin preHandler enforces the Origin
    // guard — a stolen JWT replayed cross-origin must still be blocked.
    (req as any).authMode = 'cf_access';
  };
}
