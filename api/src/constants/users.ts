// W9 — user-management constants shared by the migration's TypeScript-side
// tests, the lifecycle service, and the reconciliation script.

/**
 * Q35 — the identity migration 080 guarantees admin for. Deliberately a
 * constant and not an env var: a BOOTSTRAP_ADMIN_EMAIL env var would
 * reintroduce exactly the redeploy-coupled config W9 removes (Q11).
 *
 * Kept in sync with the literal inside 080_users_roles_status.sql by
 * `migration-080.test.ts`, which reads the .sql file and compares. It used to
 * say "keep in sync" in prose and the two drifted the first time it mattered:
 * on 2026-08-09 the founding identity moved to jason@jpmtech.com, 080 still
 * named the old address, and on a database where the old row no longer existed
 * clause (3) INSERTED a second admin instead of promoting the real one.
 */
export const FOUNDING_ADMIN_EMAIL = 'jason@jpmtech.com';

/**
 * Q12 — the G14 cohort cap, enforced in code rather than left as prose.
 * The counted set is status IN ('active','invited','deleting'): a `deleting`
 * row has not released its slot until the cascade completes.
 */
export const COHORT_CAP = 10;

export const COUNTED_STATUSES = ['active', 'invited', 'deleting'] as const;

export type UserStatus = 'invited' | 'active' | 'suspended' | 'deleting';
export type UserRole = 'member' | 'admin';
