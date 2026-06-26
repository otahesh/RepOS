import type { FastifyRequest } from 'fastify';

// Typed accessors for the identity stamped on the request by the auth
// preHandlers (requireAuth / requireCfAccess). Routes run behind those gates,
// so the value is always present at runtime; the throw is defense-in-depth —
// it surfaces as a sanitized 500 via the global error handler if a route is
// ever wired without its auth preHandler. Using these instead of
// `(req as any).userId as string` keeps the security-critical identity fields
// type-checked (a `.userid` typo no longer compiles).

export function requireUserId(req: FastifyRequest): string {
  const id = req.userId;
  if (!id) throw new Error('auth_state_missing: userId not set by auth preHandler');
  return id;
}

export function requireUserEmail(req: FastifyRequest): string {
  const email = req.userEmail;
  if (!email) throw new Error('auth_state_missing: userEmail not set by auth preHandler');
  return email;
}
