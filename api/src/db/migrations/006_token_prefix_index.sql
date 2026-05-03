-- The auth middleware queries `WHERE token_hash LIKE 'prefix:%'` (api/src/middleware/auth.ts).
-- For btree indexes to support LIKE prefix patterns, the index must use a `*_pattern_ops`
-- opclass — the default opclass is locale-aware and does NOT enable LIKE optimization.
-- Conditional WHERE keeps the index small (only active tokens are searchable via this path).
CREATE INDEX IF NOT EXISTS idx_device_tokens_prefix
  ON device_tokens (token_hash text_pattern_ops)
  WHERE revoked_at IS NULL;
