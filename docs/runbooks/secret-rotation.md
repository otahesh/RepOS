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

## CF_API_TOKEN (W9 — Access policy sync)

**Scope (Q15, amended 2026-08-02):** account-scoped `Access: Apps and Policies
Edit` — that is the label in the token dashboard; the endpoint docs sometimes
call the same permission *Write*. There is no narrower option: the permission
group is account-scoped only, with no per-policy variant. "Cloudflare Access
Policy Admin" is a **member role** granted to account members — it is not
offered when minting an API token, so do not go looking for it under My Profile
→ API Tokens. (The policy this token drives is
`b4a92a15-27d5-477b-ad36-f78fcdae931c`.)

**Never grant `Access: Organizations Revoke`.** RepOS makes no
session-revocation call (Q17a) — that endpoint revokes access across *all*
applications in the org, so using it here would also sign users out of
`ha.jpmtech.com` and `jellyseerr.jpmtech.com`.

**Set a 180-day expiry (`notAfter`) on the token when you create it.** That is
the one restriction that actually bounds this token, and it makes the rotation
cadence below self-enforcing instead of procedural.

**The blast radius is accepted, and it is account-wide.** The permission also
grants edit over `ha.jpmtech.com` and `jellyseerr.jpmtech.com`, so anyone
holding a stolen `CF_API_TOKEN` has a path into home automation. **Do not think
RepOS's fail-closed policy guards contain this.** Those guards (Q10/Q19/Q22/Q38)
constrain *this application's* client — the compare-before-write, the abort
deadline, the refusal to act on an unverifiable read. A stolen token is
presented straight to Cloudflare's API with RepOS nowhere in the path, so it
carries the token's full account scope and every one of those guards is
irrelevant to it. Cloudflare offers no narrower Access permission, so the real
controls are expiry, the cadence below, and immediate rotation on any suspected
container compromise. IP restriction would narrow it further but is not used:
the Unraid host's address is residential and dynamic.

**Rotation cadence:** every 180 days, or immediately on any suspected
container compromise.

**Procedure:**
1. Create the replacement token in the Cloudflare dashboard (My Profile → API
   Tokens) with the scope above, and set its **expiry 180 days out**.
2. Update `CF_API_TOKEN` in `/mnt/user/appdata/repos/.env` on Unraid.
3. Recreate the container (env vars are fixed at create time — stop + rm + run,
   not restart; see the redeploy recipe).
4. Verify: `/settings/users` loads and shows **no policy-error advisory** —
   i.e. the response carries `drift.checked === true` and
   `drift.policy_error === null`. There is deliberately no "in sync" banner to
   look for: the UI renders a banner only for confirmed divergence, and a
   separate advisory when `drift.checked === false` (Q36 — sync-pending is not
   divergence, and a banner for the healthy case would train the operator to
   ignore the signal).
5. Delete the old token in the dashboard.

**Blast radius if leaked:** edit rights on the RepOS Access policy — an
attacker could add their own email to the policy. They would still be stopped
by the DB gate (`403 not_invited`), because Cloudflare is not the security
boundary (Q17).

## RESEND_API_KEY / INVITE_FROM_EMAIL (W9 — invite delivery)

**Scope:** a Resend sending key restricted to the `send.jpmtech.com` domain.
The subdomain keeps root-domain SPF/DKIM untouched, so a misconfiguration here
cannot break Proton-hosted mail on `jpmtech.com`.

**Rotation cadence:** every 180 days.

**Procedure:** create a new key in the Resend dashboard, update the `.env`,
recreate the container, send a test invite to a disposable address, confirm
delivery, then **delete that test user from `/settings/users`** before revoking
the old key.

Do not skip the cleanup. A verification invite is not free: it leaves a durable
`users` row, a real address added to the Cloudflare Access policy, and a
consumed slot against `COHORT_CAP`. Deleting through `/settings/users` runs the
Q33 deletion path, which removes the Cloudflare grant as well as the row —
deleting the row directly in SQL would leave the address in the policy.

**Blast radius if leaked:** an attacker can send mail as
`repos@send.jpmtech.com`. It grants no access to RepOS — there is no invite
token and no magic link (Q6); authorization is the pre-created `users` row.

## After any rotation

- Re-run an outside-in smoke (`curl https://repos.jpmtech.com/health`).
- If `device_tokens` (iOS Shortcut bearers) need invalidation, the
  sign-out-everywhere flow (W6) or a restore (W5, which wipes device_tokens)
  forces a re-mint.
