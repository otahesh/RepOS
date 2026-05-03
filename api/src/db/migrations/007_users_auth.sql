-- CF Access whole-host auth: identity comes from the Cf-Access-Jwt-Assertion
-- email claim. Adds optional profile fields and enforces case-insensitive
-- uniqueness so 'Foo@x.com' and 'foo@x.com' resolve to the same row.

ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

-- The existing UNIQUE on raw email is case-sensitive. Add a separate UNIQUE
-- index on lower(email) so auto-provisioning + lookup both go through
-- the normalized form without dupes. Keep the original UNIQUE in place;
-- it acts as a secondary guard and is harmless.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));
