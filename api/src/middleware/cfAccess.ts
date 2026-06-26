import type { FastifyRequest, FastifyReply } from 'fastify';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { db } from '../db/client.js';
import { requireAuth } from './auth.js';
import { assertNotPlaceholderUserId } from '../bootstrap-runtime.js';
import { constantTimeEqual } from '../utils/constantTimeEqual.js';

// CF Access whole-host auth. Reads the JWT from either the
// `Cf-Access-Jwt-Assertion` header (server-to-server / Shortcut-style) or the
// `CF_Authorization` cookie (browser). Verifies signature against the team's
// JWKS endpoint, validates `aud` and `iss`, then resolves the email claim
// to a `users` row (auto-provisioning on first sight).
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

  const allowList = (process.env.CF_ACCESS_ALLOWED_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allowList.length && !allowList.includes(rawEmail)) {
    return reply.code(403).send({ error: 'email_not_allowed' });
  }

  const displayNameClaim = typeof payload.name === 'string' ? payload.name : null;

  const { rows } = await db.query(
    `SELECT id, display_name, timezone, last_seen_at
     FROM users WHERE lower(email) = $1`,
    [rawEmail],
  );

  let userId: string;
  let userDisplayName: string | null;
  let userTz: string;

  if (rows.length === 0) {
    const ins = await db.query(
      `INSERT INTO users (email, timezone, display_name, last_seen_at)
       VALUES ($1, 'UTC', $2, now())
       RETURNING id, display_name, timezone`,
      [rawEmail, displayNameClaim],
    );
    userId = ins.rows[0].id as string;
    // Post-insert canary: gen_random_uuid() can never return the placeholder, so
    // this never fires in normal flow. If it ever did, the row is already written
    // — the throw surfaces a 500 and stops the sentinel id reaching a live session
    // (defense-in-depth alongside the boot-time validatePlaceholderPurge).
    assertNotPlaceholderUserId(userId, process.env);
    userDisplayName = ins.rows[0].display_name as string | null;
    userTz = ins.rows[0].timezone as string;
  } else {
    userId = rows[0].id as string;
    userDisplayName = rows[0].display_name as string | null;
    userTz = rows[0].timezone as string;
    const last = rows[0].last_seen_at as Date | null;
    if (!last || Date.now() - last.getTime() > 60_000) {
      // Debounce last_seen_at writes to once per minute per user.
      await db.query(`UPDATE users SET last_seen_at = now() WHERE id = $1`, [userId]);
    }
  }

  (req as any).userId = userId;
  (req as any).userEmail = rawEmail;
  (req as any).userDisplayName = userDisplayName;
  (req as any).userTimezone = userTz;
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

// True iff `email` is in the comma-separated REPOS_ADMIN_EMAILS allow-list.
// Fail-closed: unset env or empty email → false (never accidentally admin).
export function isAdminEmail(email: string | undefined | null): boolean {
  const adminEmails = process.env.REPOS_ADMIN_EMAILS;
  if (!adminEmails || !email) return false;
  return adminEmails
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

// Shared helper: enforce that the CF-Access-authenticated user's email is in
// REPOS_ADMIN_EMAILS. Fail closed if env unset (per D10). Returns true if the
// reply was already sent (caller must short-circuit).
function rejectIfNotAdminEmail(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!process.env.REPOS_ADMIN_EMAILS) {
    req.log.error('admin_check: REPOS_ADMIN_EMAILS not configured — failing closed');
    reply.code(403).send({ error: 'admin_check_misconfigured' });
    return true;
  }
  const userEmail = (req as { userEmail?: string }).userEmail;
  if (!isAdminEmail(userEmail)) {
    req.log.warn({ userEmail }, 'admin_check_rejected');
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
//   - default ({}): dual-auth (X-Admin-Key OR CF Access JWT + admin email).
//   - { requireFreshCfAccess: true } (per C-RESTORE-AUTH-CFACCESS): destructive
//     admin ops (restore) — REJECT the X-Admin-Key path, require CF Access JWT
//     + admin email. The opaque bearer escape hatch is not enough for a
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
      if (rejectIfNotAdminEmail(req, reply)) return;
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
      if (!constantTimeEqual(provided, adminKey)) {
        return reply.code(401).send({ error: 'unauthorized' });
      }
      (req as any).authMode = 'admin';
      return;
    }

    if (isCfAccessEnabled()) {
      await requireCfAccess(req, reply);
      if (reply.sent) return;
      (req as any).authMode = 'cf_access';

      // Per D10: when authenticated via CF Access (not the admin key), enforce
      // that the user's email is in REPOS_ADMIN_EMAILS. Fail closed if env unset.
      // Migration 063 reserves users.role TEXT for post-Beta cohort scale-up;
      // until then REPOS_ADMIN_EMAILS is the source of truth.
      if (rejectIfNotAdminEmail(req, reply)) return;
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
