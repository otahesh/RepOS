// Single source of truth for token scope values. device_tokens.scopes (TEXT[])
// is validated against this list at mint-time; route guards check
// hasScope(token.scopes, 'program:write') before allowing writes.
export const VALID_SCOPES = [
  'health:weight:write',
  'program:write',
] as const;

export type Scope = typeof VALID_SCOPES[number];

export function isValidScope(s: string): s is Scope {
  return (VALID_SCOPES as readonly string[]).includes(s);
}

export function hasScope(granted: readonly string[] | null | undefined, required: Scope): boolean {
  if (!granted) return false;
  return granted.includes(required);
}
