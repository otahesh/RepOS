import type { FastifyRequest } from 'fastify';

// Resolve the best-available client IP for audit trails.
//
// Topology: client → Cloudflare → cloudflared (CF Tunnel) → nginx → Fastify.
// Fastify's `req.ip` is the socket peer = nginx on loopback (127.0.0.1), which
// is useless for "where was this token used from". Better sources, in order:
//
//   1. `Cf-Connecting-Ip` — set by Cloudflare to the true client. For requests
//      that arrive through the tunnel this is the trustworthy client IP.
//   2. First `X-Forwarded-For` entry — a dev/test fallback.
//   3. `req.ip` — last resort (direct/local connections with no proxy headers).
//
// TRUST NOTE: this is NOT cryptographically authenticated. The container is on
// a macvlan with a routable LAN address and nginx also serves :80 LAN-side, so
// a host that reaches the origin directly (bypassing the tunnel) could forge
// `Cf-Connecting-Ip` / `X-Forwarded-For`. The value is therefore advisory
// audit provenance only — it is NEVER an authorization input (every route is
// independently gated by bearer/CF-Access auth). To make it tamper-proof,
// strip these headers at the trust boundary in nginx (see deployment notes).
// We deliberately do NOT enable Fastify `trustProxy`, which would make `req.ip`
// itself derive from the (spoofable) X-Forwarded-For chain.
export function clientIp(req: FastifyRequest): string | null {
  // Headers that appear more than once arrive as string[]; take the first.
  const cfRaw = req.headers['cf-connecting-ip'];
  const cf = Array.isArray(cfRaw) ? cfRaw[0] : cfRaw;
  if (typeof cf === 'string' && cf.trim().length > 0) return cf.trim();

  const xffRaw = req.headers['x-forwarded-for'];
  const xff = Array.isArray(xffRaw) ? xffRaw.join(',') : xffRaw;
  if (typeof xff === 'string' && xff.length > 0) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }

  return req.ip ?? null;
}
