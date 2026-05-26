// api/src/schemas/account.ts
// Beta W6 — request/response schemas for the account routes.
//
// Per I-CONFIRM-PHRASE-CONST, the typed-confirm string is centralized in one
// constant shared with migration comments, dialog body copy, and tests:
//   frontend/src/lib/constants/accountConfirmPhrases.ts → CONFIRM_DELETE_ACCOUNT_PHRASE
// The API mirrors that const here. If it ever drifts the cascade test catches it.
import { z } from 'zod';

// Mirror of frontend/src/lib/constants/accountConfirmPhrases.ts.
// Both must stay in sync.
export const CONFIRM_DELETE_ACCOUNT_PHRASE = 'DELETE my account';

// Per I-DISPLAY-NAME-NORMALIZE:
//   - NFKC normalize (compatibility composition; full-width latin → ASCII)
//   - strip zero-width spaces and other invisible whitespace
//   - reject if length(trim()) < 1 OR length > 80
// IANA tz allow-list is enforced at the route layer using a static fallback
// list (per I-IANA-TIMEZONES — Intl.supportedValuesOf is unreliable on
// alpine small-icu).
// Zero-width chars covered (U+200B..U+200D, U+FEFF — ZWSP, ZWNJ, ZWJ, BOM).
const ZERO_WIDTH = /[​-‍﻿]/g;

const DisplayNameSchema = z
  .string()
  .transform((s) => s.normalize('NFKC').replace(ZERO_WIDTH, ''))
  .refine((s) => s.trim().length >= 1, { message: 'display_name_empty' })
  .refine((s) => s.length <= 80, { message: 'display_name_too_long' });

export const ProfilePatchRequestSchema = z
  .object({
    display_name: DisplayNameSchema.optional(),
    timezone: z.string().min(1).max(64).optional(),
    // NOTE: units is NOT in this schema (per D6 — units deferred from W6).
  })
  .strict();
export type ProfilePatchRequest = z.infer<typeof ProfilePatchRequestSchema>;

export const ProfileResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  display_name: z.string().nullable(),
  timezone: z.string(),
});
export type ProfileResponse = z.infer<typeof ProfileResponseSchema>;

export const SessionItemSchema = z.object({
  id: z.string(),
  label: z.string().nullable(),
  created_at: z.string(),
  last_used_at: z.string().nullable(),
  // Truncated to /24 server-side (per I-LAST-IP-TRUNCATE).
  last_used_ip_24: z.string().nullable(),
});
export type SessionItem = z.infer<typeof SessionItemSchema>;

export const SessionListResponseSchema = z.object({
  sessions: z.array(SessionItemSchema),
});
export type SessionListResponse = z.infer<typeof SessionListResponseSchema>;

// kind is enum-on-the-wire (zod) even though the DB has no CHECK on it
// (per C-ACCOUNT-EVENTS-ENUM) — defensive on the read side too.
export const AccountEventItemSchema = z.object({
  id: z.string(),
  kind: z.enum([
    'profile_changed',
    'token_minted',
    'token_revoked',
    'signout_everywhere',
    'delete_initiated',
    'par_q_acknowledged',
    'onboarding_completed',
    'restore_replayed',
  ]),
  ip: z.string().nullable(),
  user_email_at_event: z.string().nullable(),
  meta: z.record(z.string(), z.unknown()),
  occurred_at: z.string(),
});
export type AccountEventItem = z.infer<typeof AccountEventItemSchema>;

export const AccountEventListResponseSchema = z.object({
  events: z.array(AccountEventItemSchema),
  // Keyset cursor for next page (per I-PAGINATION-KEYSET).
  next_cursor: z
    .object({ before_ts: z.string(), before_id: z.string() })
    .nullable(),
});
export type AccountEventListResponse = z.infer<typeof AccountEventListResponseSchema>;

export const DeleteMeRequestSchema = z.object({
  confirm: z.literal(CONFIRM_DELETE_ACCOUNT_PHRASE),
});
export type DeleteMeRequest = z.infer<typeof DeleteMeRequestSchema>;
