# CF Access AUD Drift (W5 ABS-4)

The API verifies every CF Access JWT against `CF_ACCESS_AUD` (the application
Audience tag) and the team issuer. If the AUD configured in `.env` drifts from
the AUD Cloudflare actually stamps on tokens, EVERY browser request to a
CF-Access-gated route fails — including the admin backup/restore routes.

## Symptoms

- `/api/me` returns 401 `invalid_cf_access_jwt` for a user who IS logged in
  via CF Access (the login round-trip succeeds, but the API rejects the token).
- `/settings/backups`, `/settings/account`, etc. appear to "log you out"
  immediately after the CF Access challenge.
- API logs show `invalid_cf_access_jwt` with a valid-looking token.
- The iOS Shortcut bearer path still works (it doesn't use CF Access), which
  isolates the fault to the CF Access JWT layer, not the DB.

## Diagnosis

1. In the Cloudflare Zero Trust dashboard → Access → Applications → the RepOS
   app → copy the **Application Audience (AUD) Tag**.
2. Compare to `CF_ACCESS_AUD` in `/mnt/user/appdata/repos/.env`.
3. Decode a live token to confirm the `aud` claim:
   - Grab the `CF_Authorization` cookie or `Cf-Access-Jwt-Assertion` header from
     a browser request.
   - `echo '<jwt>' | cut -d. -f2 | base64 -d 2>/dev/null | jq .aud`
   - The decoded `aud` must equal `CF_ACCESS_AUD`.
4. Confirm `CF_ACCESS_TEAM_DOMAIN` matches the team domain in the JWT `iss`
   claim (`https://<team>.cloudflareaccess.com`).

## Recovery

1. Set `CF_ACCESS_AUD=<correct-aud>` (and `CF_ACCESS_TEAM_DOMAIN` if it also
   drifted) in `.env`.
2. Recreate the container per `reference_unraid_redeploy` (stop + rm + run).
3. The JWKS cache is in-process (30s soft refresh, immediate refresh on a kid
   miss — see `api/src/middleware/cfAccess.ts`), so a fresh boot resolves keys
   cleanly; no manual cache bust needed.
4. Verify: log in via the browser, hit `/api/me`, confirm 200 with the expected
   identity. Confirm `/settings/backups` loads the snapshot list.

## Prevention

- When recreating the CF Access application (vs editing), the AUD changes.
  Treat "recreated the Access app" as "must update `CF_ACCESS_AUD`."
- The W0.6 `jwks-rotation.test.ts` covers key rotation; AUD drift is a config
  mismatch, not a rotation event, so it surfaces only at runtime — this runbook
  is the recovery path.
