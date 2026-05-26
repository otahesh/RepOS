-- Beta W6 — distinguish per-token-revoke from bulk sign-out-everywhere from
-- account-delete-cascade from W5 restore-replay. The plain column (revoked_at)
-- tells you it's revoked; this column tells you *why*. Drives:
--   (a) AccountEventsTimeline rendering ("Signed out everywhere (3 tokens)"
--       vs "Revoked: iOS Shortcut" vs "Revoked by restore" vs unknown).
--   (b) post-incident triage: a user reports their token stopped working
--       unexpectedly — was it a manual revoke, a signout-everywhere, did
--       account_delete fire, or did W5 restore-replay clobber sessions? grep
--       by reason.
--
-- Enum values (per I-REVOKE-REASON-ENUM):
--   user_revoked        — single-row revoke from ActiveSessionsTable
--   signout_everywhere  — W6 bulk revoke via /api/auth/signout-everywhere
--   account_deleted    — DELETE /api/me cascade
--   restore_replayed    — W5 restore handler invalidates pre-restore tokens
--   legacy_revoke       — alpha residue with no recorded reason (per
--                         I-REVOKE-REASON-BACKFILL — backfilled below)
--   cf_access_logout    — reserved for future; not currently emitted by W6.
--
-- Honest "we don't know why this was revoked, but we record it" choice for
-- alpha residue — calling it 'user_revoked' would be dishonest forensics.
--
-- Nullable allowed for forward compatibility, but new code MUST set a reason
-- on every UPDATE that sets revoked_at.

ALTER TABLE device_tokens
  ADD COLUMN IF NOT EXISTS revoke_reason TEXT
  CHECK (revoke_reason IS NULL OR revoke_reason IN (
    'user_revoked',
    'signout_everywhere',
    'account_deleted',
    'restore_replayed',
    'legacy_revoke',
    'cf_access_logout'
  ));

-- Backfill alpha residue (per I-REVOKE-REASON-BACKFILL).
-- Any row that was already revoked at migration time has no recorded reason;
-- mark it as legacy so timeline rendering can show "Revoked (legacy)" instead
-- of bait-and-switching it as user_revoked.
UPDATE device_tokens
   SET revoke_reason = 'legacy_revoke'
 WHERE revoked_at IS NOT NULL
   AND revoke_reason IS NULL;
