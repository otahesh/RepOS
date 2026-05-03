import type { FastifyRequest, FastifyReply } from 'fastify';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { db } from '../db/client.js';
import { requireAuth } from './auth.js';

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

let cachedJwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function jwks() {
  if (cachedJwks) return cachedJwks;
  const teamDomain = process.env.CF_ACCESS_TEAM_DOMAIN;
  if (!teamDomain) throw new Error('CF_ACCESS_TEAM_DOMAIN must be set');
  cachedJwks = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
  return cachedJwks;
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
  return requireCfAccess(req, reply);
}

// /api/tokens auth: admin API key path keeps body `user_id` semantics for
// CLI / tests; CF Access path derives identity from the JWT. authMode is
// stashed on the request so handlers can pick the right user_id source.
export async function requireAdminKeyOrCfAccess(req: FastifyRequest, reply: FastifyReply) {
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
    return;
  }

  return reply.code(401).send({ error: 'unauthorized' });
}
