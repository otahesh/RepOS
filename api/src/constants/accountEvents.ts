// The ONE canonical list of account-event kinds.
//
// Why a shared constant rather than two hand-maintained unions: the kind list
// was previously written out twice — the TypeScript union in
// services/accountEvents.ts and the zod enum in schemas/account.ts — and W9
// extended only the first. `GET /api/account/events` runs every row through
// AccountEventListResponseSchema.parse(), which THROWS rather than degrading,
// so the first lifecycle event written would have turned that endpoint into a
// 500 for the affected user. Deriving both from this tuple makes that drift
// structurally impossible instead of merely tested for.
//
// The DB deliberately has no CHECK on account_events.kind
// (C-ACCOUNT-EVENTS-ENUM); the wire enum stays strict as read-side defence.
export const ACCOUNT_EVENT_KINDS = [
  'profile_changed',
  'token_minted',
  'token_revoked',
  'signout_everywhere',
  'delete_initiated',
  'par_q_acknowledged',
  'onboarding_completed',
  'restore_replayed',
  // W9 lifecycle kinds.
  'user_invited',
  'user_activated',
  'user_suspended',
  'user_reinstated',
  'role_changed',
  'user_delete_requested',
  'user_deleted',
  // Q31b — distinct from user_invited because no invitation was actually sent;
  // the identity was granted out of band and imported from the CF policy.
  'user_imported',
] as const;

export type AccountEventKind = (typeof ACCOUNT_EVENT_KINDS)[number];
