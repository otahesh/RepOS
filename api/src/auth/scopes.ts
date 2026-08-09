// Single source of truth for token scope values. device_tokens.scopes (TEXT[])
// is validated against this list at mint-time; route guards check
// hasScope(token.scopes, 'program:write') before allowing writes.
export const VALID_SCOPES = [
  'health:weight:write',
  'health:workouts:write',
  'program:write',
  'set_logs:write',
  'cardio_logs:write', // measurement model phase 2: cardio-block completion
  'health:injuries:read',
  'health:injuries:write',
  'health:recovery:read', // [FIX-28] gates the existing /api/recovery-flags routes
  'account:write', // W2: PAR-Q POST, onboarding-complete POST, deload-now POST + /undo
] as const;

export type Scope = (typeof VALID_SCOPES)[number];

export function isValidScope(s: string): s is Scope {
  return (VALID_SCOPES as readonly string[]).includes(s);
}

export function hasScope(granted: readonly string[] | null | undefined, required: Scope): boolean {
  if (!granted) return false;
  return granted.includes(required);
}
