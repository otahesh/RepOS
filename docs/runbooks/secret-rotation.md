# Secret Rotation (W5 ABS-4)

Quarterly cadence (note in PASSDOWN). Rotate one secret at a time; verify
before moving on. All edits land in `/mnt/user/appdata/repos/.env` on the
Unraid host; recreate the container per `reference_unraid_redeploy` (stop + rm
+ run — NOT restart — so the new env is read).

## ADMIN_API_KEY

The X-Admin-Key for `/api/tokens` and the dual-auth backup routes (the CLI/ops
path). NOTE: the destructive restore routes do NOT accept this key
(C-RESTORE-AUTH-CFACCESS); they require a fresh CF Access JWT.

1. Generate: `openssl rand -hex 32`.
2. Set `ADMIN_API_KEY=<new>` in `.env`. Recreate the container.
3. Update any ops scripts / saved curl headers that send `X-Admin-Key`.
4. Verify: `curl -fsS -H "X-Admin-Key: <new>" https://repos.jpmtech.com/api/backups`
   returns 200; the old key returns 401.

## POSTGRES_PASSWORD

The in-container Postgres superuser password (also embedded in `DATABASE_URL`).

1. Pick a new password (avoid the placeholder `changeme` — the boot guard
   rejects it).
2. Inside the container, rotate the role:
   `docker exec RepOS psql -U postgres -c "ALTER ROLE postgres PASSWORD '<new>'"`.
3. Update BOTH `POSTGRES_PASSWORD=<new>` and the password embedded in
   `DATABASE_URL=postgres://...:<new>@...` in `.env`.
4. Recreate the container. Verify `/health` is 200 and a read endpoint works.
5. Take a manual backup from `/settings/backups` and confirm badge=good
   (proves pg_dump auth still works).

## Cloudflare Access application rotation

If the CF Access app's Audience tag (AUD) or service-token must rotate (e.g.
suspected leak), see `cf-access-aud-drift.md`. After rotation, update
`CF_ACCESS_AUD` in `.env`, recreate, and verify `/api/me` returns the identity.

## After any rotation

- Re-run an outside-in smoke (`curl https://repos.jpmtech.com/health`).
- If `device_tokens` (iOS Shortcut bearers) need invalidation, the
  sign-out-everywhere flow (W6) or a restore (W5, which wipes device_tokens)
  forces a re-mint.
