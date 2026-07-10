import type { FastifyRequest, FastifyReply } from 'fastify';
import argon2 from 'argon2';
import { createHash } from 'node:crypto';
import { db } from '../db/client.js';
import { clientIp } from '../utils/clientIp.js';

// Token format: "<16-hex-prefix>.<64-hex-secret>"
// Stored in device_tokens.token_hash as "<prefix>:<argon2hash-of-secret>"
// The prefix is used for a fast indexed lookup; argon2 only runs once per request.
//
// Timing-leak guard: a miss in device_tokens returns 401 in ~1ms (one indexed
// lookup); a hit then runs argon2.verify (~50–100ms). Without an equalizer, a
// remote attacker who can issue probes can distinguish "valid prefix, wrong
// secret" from "no such prefix". With 64 bits of prefix space brute-forcing is
// infeasible — but defence-in-depth: run a dummy argon2.verify against a
// sentinel hash on the miss path so both branches pay the same cost.
let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  if (dummyHashPromise === null) {
    dummyHashPromise = argon2.hash(
      'sentinel-secret-for-timing-equalizer-only-never-matches-any-real-token',
    );
  }
  return dummyHashPromise;
}

// Verified-token cache (G9 finding, 2026-07-10): argon2.verify costs
// ~50–100ms of CPU per call, capping the whole API at ~16 req/s on the 2-CPU
// prod box. A token that has already passed argon2 is remembered by
// sha256(full token) and skips ONLY the re-verify. The DB prefix lookup below
// still runs on every request and enforces `revoked_at IS NULL`, so
// revocation takes effect on the very next request; the cached entry must
// also match the row id the lookup returned, so a rotated row can't be
// served from a stale entry.
//
// INVARIANT the cache depends on: a device_tokens row's secret is immutable
// for its id — rotation is always mint-new-row + revoke-old-row (tokens.ts).
// An in-place `UPDATE token_hash` on a live id would let the OLD token serve
// from cache for up to the TTL; don't add that path without keying the cache
// on the hash as well.
const verifiedTokenCache = new Map<
  string,
  { tokenId: string; expiresAt: number; lastTouchedAt: number }
>();
const VERIFIED_CACHE_TTL_MS = 10 * 60_000;
const VERIFIED_CACHE_MAX = 512;
// last_used_at is an ops signal ("is this token still alive before I revoke
// it"), not an audit log — one write per minute per token is plenty. The
// per-request UPDATE serialized concurrent requests sharing a token on a
// single row lock (measured in the 2026-07-10 G9 run).
const LAST_USED_TOUCH_MS = 60_000;

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return reply.code(401).send();
  }
  const token = header.slice(7);

  // Parse prefix from the bearer token
  const dotIdx = token.indexOf('.');
  if (dotIdx === -1) {
    return reply.code(401).send();
  }
  const prefix = token.slice(0, dotIdx);
  const secret = token.slice(dotIdx + 1);

  // Reject anything but 16 lowercase hex BEFORE the LIKE query: `%`/`_` in an
  // unvalidated prefix act as SQL wildcards (`%.x` would range-scan every
  // active token). Pay the dummy-verify so this path is timing-identical to
  // an unknown-prefix miss.
  if (!/^[0-9a-f]{16}$/.test(prefix)) {
    await argon2.verify(await getDummyHash(), secret).catch(() => false);
    return reply.code(401).send();
  }

  // Look up by prefix — at most one row; no table scan. `scopes` is pulled
  // alongside id/user_id so requireScope (api/src/middleware/scope.ts) can
  // gate writes without a second DB round-trip.
  const { rows } = await db.query(
    `SELECT id, user_id, token_hash, scopes
     FROM device_tokens
     WHERE token_hash LIKE $1 AND revoked_at IS NULL
     ORDER BY id LIMIT 1`,
    [`${prefix}:%`],
  );

  if (rows.length === 0) {
    // Run a dummy argon2.verify so the miss path's timing matches the hit
    // path's (~50–100ms). The sentinel hash can never match a real bearer
    // secret; we discard the result.
    await argon2.verify(await getDummyHash(), secret).catch(() => false);
    return reply.code(401).send();
  }

  const row = rows[0];
  // Strip the "<prefix>:" prefix from the stored composite to get the bare argon2 hash
  const storedHash = row.token_hash.slice(prefix.length + 1);

  const cacheKey = createHash('sha256').update(token).digest('hex');
  const cached = verifiedTokenCache.get(cacheKey);
  const cacheHit =
    cached !== undefined && cached.tokenId === String(row.id) && cached.expiresAt > Date.now();

  if (!cacheHit) {
    if (!(await argon2.verify(storedHash, secret))) {
      return reply.code(401).send();
    }
    // Bounded: evict the oldest entry (Map preserves insertion order) rather
    // than grow without limit under many distinct tokens.
    if (verifiedTokenCache.size >= VERIFIED_CACHE_MAX) {
      const oldest = verifiedTokenCache.keys().next().value;
      if (oldest !== undefined) verifiedTokenCache.delete(oldest);
    }
    verifiedTokenCache.set(cacheKey, {
      tokenId: String(row.id),
      expiresAt: Date.now() + VERIFIED_CACHE_TTL_MS,
      lastTouchedAt: 0,
    });
  }

  const entry = verifiedTokenCache.get(cacheKey);
  if (entry && Date.now() - entry.lastTouchedAt >= LAST_USED_TOUCH_MS) {
    entry.lastTouchedAt = Date.now();
    await db.query(
      `UPDATE device_tokens SET last_used_at = now(), last_used_ip = $1 WHERE id = $2`,
      [clientIp(req), row.id],
    );
  }
  req.userId = row.user_id as string;
  // Empty array (rather than undefined) on the bearer path so requireScope
  // can distinguish "bearer with zero scopes" (403) from "no bearer used,
  // CF Access took over" (pass-through).
  req.tokenScopes = (row.scopes as string[] | null) ?? [];
}
