CREATE TABLE IF NOT EXISTS _seed_meta (
  key        TEXT PRIMARY KEY,
  hash       TEXT NOT NULL,
  generation INT  NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
