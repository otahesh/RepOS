-- File: api/src/db/migrations/011_users_equipment_profile.sql
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS equipment_profile JSONB NOT NULL DEFAULT '{"_v":1}'::jsonb;
