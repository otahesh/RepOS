-- Per Q16: structure is NOT carried after fork. Relational rows under
-- mesocycle_runs are the source of truth post-fork. customizations JSONB
-- carries user-level non-relational overrides only (program rename, week-trim).
CREATE TABLE IF NOT EXISTS user_programs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id      UUID REFERENCES program_templates(id),
  template_version INT,
  name             TEXT NOT NULL,
  customizations   JSONB NOT NULL DEFAULT '{}',
  status           program_status NOT NULL DEFAULT 'draft',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_programs_user
  ON user_programs(user_id) WHERE status <> 'archived';
