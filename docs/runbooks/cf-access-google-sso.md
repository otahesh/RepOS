# Runbook — Replace One-Time PIN with Google SSO on Cloudflare Access

**Date:** 2026-07-14
**Why:** The One-Time PIN login method prompts email+PIN on nearly every app
open and fails unpredictably (codes consumed by mail scanners → "already
used"; PIN sent before policy evaluation → "account not authorized" after a
code arrives). Google SSO removes the code flow entirely; a 1-month app
session makes re-auth a once-a-month single tap.

**Scope:** Cloudflare dashboard config only. Zero code changes — the backend
still verifies the same Access JWT (same `aud`, same JWKS endpoint, same
`email` claim), so `api/src/middleware/cfAccess.ts`, `/api/me`, and user
provisioning are untouched. The `/api/health/*` Bypass app for the iOS
Shortcut bearer flow is unaffected (verify it still exists at the end —
step 6).

---

## 1. Create a Google OAuth client (~10 min, Google Cloud Console)

1. <https://console.cloud.google.com/> → create (or reuse) a project, e.g.
   `repos-auth`.
2. **APIs & Services → OAuth consent screen:** User type **External**, app
   name `RepOS`, add your email as support/developer contact. No scopes
   beyond the defaults. Publish the app (or keep it in Testing and add each
   invitee's Gmail address as a test user — Testing mode is fine for a small
   circle, but users get a "Google hasn't verified this app" interstitial;
   Publishing avoids it and needs no verification for basic OpenID scopes).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID:**
   - Application type: **Web application**, name `Cloudflare Access`.
   - Authorized redirect URI:
     `https://<TEAM_DOMAIN>/cdn-cgi/access/callback`
     where `<TEAM_DOMAIN>` is the value of `CF_ACCESS_TEAM_DOMAIN` in the
     prod `.env` on Unraid (looks like `<team>.cloudflareaccess.com`).
4. Copy the **Client ID** and **Client secret**.

## 2. Add Google as a login method in Zero Trust (~2 min)

1. <https://one.dash.cloudflare.com/> → **Settings → Authentication →
   Login methods → Add new → Google**.
2. Paste Client ID + Client secret. Save.
3. Click **Test** on the new Google method — it must round-trip to a Google
   account picker and return "Your connection works".

## 3. Point the RepOS Access application at Google only (~2 min)

1. **Access → Applications →** the app covering `repos.jpmtech.com`
   (the whole-host app, NOT the `/api/health/*` Bypass app).
2. **Authentication / Login methods tab:**
   - Untick "Accept all available identity providers".
   - Tick **Google** only. Untick **One-time PIN**.
   - With a single IdP selected, enable **Instant Auth** if offered — skips
     the IdP picker page and goes straight to Google.
3. **Session duration:** set to **1 month** (730h — the Access app maximum).
4. Save.

## 4. Reconcile the allow-list with Google identities (~2 min)

The Access policy matches the email Google asserts. For each Beta invitee,
confirm the address on the allow-list is their **Google account** address
(no aliases, exact string). Fix any that were "an email they can receive
PIN mail at" but not their Google login.

## 5. Verify (~5 min)

1. Fresh private/incognito window → <https://repos.jpmtech.com>.
2. Expect: redirect straight to Google account picker (no email/PIN form,
   no IdP picker if Instant Auth is on).
3. Sign in with an allow-listed Google account → app loads, chart renders.
4. DevTools → Network → `/api/me` returns **200** (proves the backend
   accepted the Google-issued Access JWT — `aud` unchanged).
5. On iPhone: open the app, confirm same one-tap flow; existing sessions
   were invalidated by the auth change, so one re-login per device is
   expected.
6. Close and reopen the app/tab — no re-auth prompt (session persists).

## 6. Post-change checks

- **Bypass app intact:** Access → Applications → confirm the Bypass policy
  on `/api/health/*` still exists (per `specs/beta/07-infra.md`, this is
  exactly the kind of thing that gets dropped when reorganizing Access
  apps). Fire the iOS Shortcut once and confirm a `200`.
- **Negative test:** a non-allow-listed Google account must get an Access
  "not authorized" page — *after* the Google step, never a PIN email.

## Rollback

Re-tick **One-time PIN** on the app's login methods (leave Google on too).
Nothing else changed, so rollback is one checkbox. The Google IdP and OAuth
client can stay configured; they're inert unless selected on an app.

## Known trade-offs

- Google-only: invitees must have a Google account (confirmed acceptable
  for the current circle). "Sign in with Apple" is not a native Access IdP;
  the GA-era answer is in-app passkey auth, out of scope for Beta.
- OAuth client secret lives only in the Zero Trust IdP config; rotating it
  is Google Console → new secret → paste into the login method (no app or
  repo touchpoints).
