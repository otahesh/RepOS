-- Bodyweight-crash flag (§7.2) only fires when goal != cut. Default
-- 'maintain' covers existing rows.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS goal TEXT NOT NULL DEFAULT 'maintain'
  CHECK (goal IN ('cut','maintain','bulk'));
