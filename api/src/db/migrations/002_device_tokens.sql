CREATE TABLE IF NOT EXISTS device_tokens (
  id            BIGSERIAL   PRIMARY KEY,
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT        NOT NULL UNIQUE,
  scope         TEXT        NOT NULL DEFAULT 'health:weight:write',
  label         TEXT,
  last_used_at  TIMESTAMPTZ,
  last_used_ip  TEXT,
  revoked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
