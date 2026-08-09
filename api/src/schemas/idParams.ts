import { z } from 'zod';

// Shared :id path-param guards. Before W8 only setLogs.ts (UUID) and
// adminFeedback.ts (bigint) validated their :id; other UUID/bigint-keyed
// routes passed req.params.id raw into typed columns, so a malformed id threw
// a Postgres "invalid input syntax" error → 500 with raw DB text in the body
// (G11 finding). These guards turn that into a clean 404.
export const UuidParamSchema = z.object({
  id: z.string().uuid(),
});
export type UuidParam = z.infer<typeof UuidParamSchema>;

// device_tokens.id is BIGSERIAL (bigint). A digit-only string can still
// overflow bigint (22003) on the UPDATE, so range-check too. Anything that
// cannot be a valid row id is a clean 404 (mirrors adminFeedback.ts).
const BIGINT_MAX = 9223372036854775807n;
export function isValidBigintId(id: string): boolean {
  if (!/^\d+$/.test(id)) return false;
  try {
    const n = BigInt(id);
    return n >= 1n && n <= BIGINT_MAX;
  } catch {
    return false;
  }
}
