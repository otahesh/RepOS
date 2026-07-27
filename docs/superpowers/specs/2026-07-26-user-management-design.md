# W9 — User Management + Invites (Design)

**Date:** 2026-07-26
**Status:** Design approved by user. Implementation plan pending (next: `superpowers:writing-plans`).
**Master plan:** [docs/superpowers/plans/2026-05-11-repos-beta.md](../plans/2026-05-11-repos-beta.md) — this wave sits *outside* the original W0–W8 arc.
**Live dashboard:** [docs/superpowers/goals/beta.md](../goals/beta.md)
**Migration range claimed:** `080–089` (W7 reserved 070–079; per-wave 10-block convention).

## Outcome

An admin invites a Beta user from inside RepOS. The invite writes a `users` row, pushes the email into the Cloudflare Access policy, and sends a branded email via Resend. The invitee clicks through, signs in with Google, and lands in the app. Suspending or deleting a user reverses all of it. **No container recreate at any point.**

This removes the two env vars that currently couple user management to a redeploy — `CF_ACCESS_ALLOWED_EMAILS` and `REPOS_ADMIN_EMAILS` — and replaces them with `users.status` and `users.role`.

**Relationship to the Beta gates:** this wave is *not* gate-blocking. Per user direction on 2026-07-26, Beta is an active development period, not a feature freeze; the freeze and bug-hunt happen before GA. The wave nonetheless **mechanizes G14** (cohort cap, Beta disclaimer, documented contact path move from prose into code and email copy) and **adds six rows toward G2's ≥35** contamination matrix.

## Problem statement

Adding a user today requires editing `/mnt/user/appdata/repos/.env` and running stop + rm + run, because env vars are fixed at container-create time. Observed 2026-07-26 while adding one Beta user: two full container recreates, one for the user and one to correct `REPOS_ADMIN_EMAILS`.

Compounding it, the app-layer allow-list duplicates a decision Cloudflare already makes. CF Access refuses to mint a JWT unless the email matches the Access policy, and `cfAccess.ts` validates `aud` against this specific application — so `CF_ACCESS_ALLOWED_EMAILS` is a second copy of the same fact, and it is the copy that costs a redeploy.

## Locked decisions (from the brainstorming pass)

Each is binding for the implementation plan; deviations require re-opening this spec.

| # | Decision | Rationale anchor |
|---|----------|------------------|
| Q1 | **The database is the authoritative gate; Cloudflare is synced to match.** A `users` row and its `status` decide access. The app still pushes emails into the CF policy so strangers are stopped at Cloudflare's edge. | User chose "DB gates, CF syncs." Keeps the edge-blocking property (Home Assistant shares this Access org) while making the decision live in a place that can change without a redeploy. |
| Q2 | **Deny-by-default replaces auto-provisioning.** `cfAccess.ts:128` currently INSERTs a `users` row for any email that clears CF Access. That behavior is removed: an unknown email gets `403 not_invited`. | Auto-provisioning is the opposite of a gate. Without this flip, the DB cannot be authoritative. |
| Q3 | **`users.role` (`member`/`admin`) replaces `REPOS_ADMIN_EMAILS`.** `isAdminEmail()` collapses to a role check; `/api/me` keeps returning `is_admin`, re-derived from the column. | The comment at `cfAccess.ts:265` claims "Migration 063 reserves `users.role`" — **that migration was never written** (migrations run 060–062 then jump to 070). This wave actually builds it. Keeping the `is_admin` response field means no frontend contract break. |
| Q4 | **`users.status` (`invited`/`active`/`suspended`) replaces `CF_ACCESS_ALLOWED_EMAILS`.** | The env check at `cfAccess.ts:112` is already conditional (`if (allowList.length && …)`), so an empty value is a supported state today. Removal is a subtraction, not a rewrite. |
| Q5 | **Resend for email, sending from the `send.jpmtech.com` subdomain.** | User chose Resend. The subdomain keeps root-domain SPF/DKIM untouched, so a misconfiguration here cannot break Proton-hosted mail on `jpmtech.com`. |
| Q6 | **No invite token / magic link.** The email links to `https://repos.jpmtech.com`; authentication is CF Access + Google, authorization is the pre-created row. | A token would be a second, weaker credential path into the same app. |
| Q7 | **CF sync happens before the email is sent, and never inside a DB transaction.** Row is written with `cf_synced_at NULL` → CF sync → stamp → email. | The DB write and an external HTTP call cannot share a transaction. Ordering guarantees nobody receives an invite they cannot act on. |
| Q8 | **Sync failure leaves the row "sync pending" and is retried idempotently — it does not roll back.** Applies to *grants* only; see Q17 for revocations. | Rollback discards admin intent and races the email send. A pending row with a retry affordance is recoverable; a lost invite is not. |
| Q9 | **Drift between DB and CF policy is surfaced, never auto-healed.** | Auto-healing would silently revert a deliberate dashboard edit. Showing it lets a human decide. |
| Q10 | **The sync service asserts `app_count === 1` on the policy before writing, and refuses otherwise.** | The `Owner Only` policy is `reusable: true`. Verified `app_count: 1` on 2026-07-26, but if it is ever attached to a second application, RepOS would silently start granting access to that app. Encoded in code, not just documented. |
| Q11 | **No `BOOTSTRAP_ADMIN_EMAIL` env var. First-admin recovery is a documented break-glass** (`docker exec` + one `UPDATE`). | A bootstrap env var reintroduces exactly the redeploy-coupled config this wave removes. |
| Q12 | **The G14 cohort cap (10) is enforced in code** — `active + invited > 10` returns 409. | The cap currently exists only as prose in the master plan. |
| Q13 | **Lockout guardrails at the route layer:** no self-suspend, self-demote, or self-delete; the last remaining admin cannot be removed. | Deny-by-default makes admin lockout unrecoverable except by SSH. |
| Q14 | **Suspension removes the email from the CF policy; reinstatement re-adds it.** | A suspended user should be stopped at the edge, not travel to the origin for a 403. |
| Q15 | **Dedicated, narrowly-scoped Cloudflare API token.** Attempt the beta resource-scoped "Access policy admin" role limited to this one policy; fall back to account-scoped `Access: Apps and Policies → Edit`. Recorded in `docs/runbooks/secret-rotation.md` with a rotation cadence. | The account-scoped permission also grants edit over `ha.jpmtech.com` and `jellyseerr.jpmtech.com`. A RepOS compromise holding it is a path into home automation. The narrower scope is worth verifying. |
| Q16 | **Serialization uses a session-level `pg_advisory_lock` on a dedicated pooled connection, released in a `finally`** — not `pg_advisory_xact_lock`. The connection is checked out of the pool, the lock taken, the CF round-trip performed with **no open transaction**, then unlock + release. | Review finding 1. `pg_advisory_xact_lock` is transaction-scoped: it releases at commit, so it serializes nothing once the transaction closes, and keeping the transaction open across an HTTP call is exactly what Q7 forbids. A session lock holds across statements without a transaction. `db` is a `pg.Pool` (`max: 20`), so one held connection is acceptable at Beta volume; `statement_timeout: 5000` is per-statement and does not fire on an idle held connection. Lock acquisition is bounded by a timeout so a wedged holder fails fast instead of blocking. Crash safety is free — session end releases the lock. |
| Q17 | **Sync direction follows the fail-closed rule.** *Grants* (invite, reinstate) are DB-first then CF: a CF failure means no access and no email. *Revocations* (suspend, delete) are **CF-first then DB**: the email is removed from the policy before the row is changed or cascaded. | Review finding 2. Deleting the row first destroys the only record of what needs removing — `retry-sync` would have neither an email nor a target. Inverting the order removes the failure mode rather than tracking it, so **no `deleting` tombstone state is needed**. If the DB step fails after CF removal, access is already revoked and the data is intact: the safe direction, and the admin simply retries. |
| Q18 | **The cohort cap check and the row insert happen inside the same critical section as the CF sync lock** (Q16). | Review finding 3. A bare count-then-insert races: two admins each observe 9 and both insert, yielding 11. Invites already serialize on the advisory lock, so moving the count inside it costs nothing. |
| Q19 | **Immediately before PUT, the policy is re-fetched and compared against the snapshot taken at the start of the operation. Any difference aborts the write and surfaces as drift.** | Review finding 4. The advisory lock serializes RepOS against itself, not against a human editing the Cloudflare dashboard between our GET and PUT. **Verified against the Cloudflare OpenAPI spec: the Access policy PUT supports no `ETag`, `If-Match`, or version field**, so true optimistic concurrency is unavailable. Re-fetch-and-compare narrows the window to the compare→PUT gap; it does not eliminate it. **Accepted residual risk**, justified by a single-operator account and an admin-initiated, low-frequency operation. |
| Q20 | **User-management routes require CF Access + `role='admin'`. The `X-Admin-Key` path is rejected**, matching `requireCfAccessOnly`. Delete additionally follows the `requireFreshCfAccess` posture. | Review finding 5. `requireAdminKeyOrCfAccess()` returns on the admin-key branch **without setting `req.userId` or `req.userEmail`**, so there is no actor: self-lockout guards (Q13) have no "self" to compare against and audit rows have no attribution. Precedent already exists — `account.ts:298` gates `DELETE /api/me` with `requireCfAccessOnly` on identical reasoning. No operator automation needs to manage users. |
| Q21 | **Activation is a conditional update:** `UPDATE users SET status='active', activated_at=now() WHERE id=$1 AND status='invited' RETURNING id`. The `user_activated` event is emitted **only** by the request whose UPDATE returned a row. | Review finding 6. Concurrent first requests can both read `invited` and both emit an activation event. The conditional update makes exactly one the winner; losers proceed as normal `active` requests. |
| Q22 | **The sync service writes only to the `Owner Only` policy, and only when every `include[]` element is an email selector** (`{email:{email:…}}`). Any other selector type — `everyone`, `email_domain`, `group`, `service_token` — causes a refusal that surfaces as drift. `exclude[]` and `require[]` are never touched, and the app's second policy (`post-deploy-smoke service token`) is never touched. | Review clarification. "Mutate `include[]`" is unsafe without a declared shape: blind array manipulation could drop a group selector or, worse, preserve an `everyone` rule while appearing to work. Fail-closed on any unrecognized shape. Verified 2026-07-26: the policy currently contains exactly three email selectors and nothing else. |
| Q23 | **Audit rows carry both actor and target.** `account_events.user_id` is the **target** (so the event lands in that user's `AccountEventsTimeline`); `meta.actor_user_id` + `meta.actor_email` record the **actor**. | Review clarification. `invited_by` covers invitation only; suspension, role change, and deletion need durable attribution too. This requires **no migration** — `kind` has no CHECK constraint by design (per C-ACCOUNT-EVENTS-ENUM, new kinds extend the TypeScript union) and `meta` is intentionally permissive. Deletion attribution survives via the existing `user_id_at_event` snapshot + `ON DELETE SET NULL`. |
| Q24 | **`cf_synced_at` means "this row's intent is reflected in the CF policy."** Any status change that alters CF membership clears it to NULL first; it is stamped only after a successful sync. Under Q17, revocations sync before the DB write, so they set status and `cf_synced_at` together in one statement. | Review clarification. Left implicit in the first draft. Without this rule a suspended-then-reinstated row could carry a stale timestamp and read as synced when it is not. |

## Architecture

```
┌────────────────────────── client (frontend) ───────────────────────────┐
│  /settings/users  (admin only, via SETTINGS_SECTIONS)                  │
│   <UsersTable>     email · status · role · last seen · invited by      │
│                    · sync state · drift banner                         │
│   <InviteUserModal>  email + role → POST /api/admin/users/invite       │
│   <ConfirmDialog>    light: resend · medium: suspend · heavy: delete   │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │ apiFetch + X-RepOS-CSRF
┌────────────────────────── server (api) ──┼─────────────────────────────┐
│                                          ▼                             │
│  routes/adminUsers.ts   [requireCfAccessAdmin + csrfOrigin]  (Q20)     │
│    GET    /api/admin/users              list + drift comparison        │
│    POST   /api/admin/users/invite       ─┐                             │
│    POST   /api/admin/users/:id/resend-invite                           │
│    PATCH  /api/admin/users/:id          role / status                  │
│    DELETE /api/admin/users/:id          + W6 cascade  [fresh CF Access]│
│    POST   /api/admin/users/:id/retry-sync                              │
│                                          │                             │
│         ┌────────────────────────────────┘                             │
│         │  GRANT path — DB first, then CF (Q17)                        │
│         ▼  ─── pg_advisory_lock, session-scoped, finally-released ──┐  │
│              (1) count active+invited; 409 if cap reached  (Q18)    │  │
│              (2) INSERT users (status='invited', cf_synced_at NULL) │  │
│              (3) services/cfAccessSync.ts                           │  │
│                    GET policy → assert app_count===1 (Q10)          │  │
│                    → assert all include[] are email selectors (Q22) │  │
│                    → mutate → RE-FETCH + compare (Q19) → PUT        │  │
│                    → stamp cf_synced_at                             │  │
│         ▼  ─── unlock + release ────────────────────────────────────┘  │
│              (4) services/inviteMailer.ts  (only if 3 succeeded)       │
│                    Resend API → stamp invite_sent_at + message id      │
│              (5) INSERT account_events (kind='user_invited',           │
│                    user_id=target, meta.actor_*)             (Q23)     │
│                                                                        │
│         REVOKE path (suspend / delete) — CF first, then DB (Q17)       │
│              (1) CF remove under the same lock                         │
│              (2) UPDATE status (+cf_synced_at) or W6 cascade delete    │
│                                                                      │  │
│  middleware/cfAccess.ts  — THE GATE (rewritten)                     │  │
│    verify JWT → resolve email → SELECT users row                    │  │
│      no row        → 403 not_invited      (no auto-provision)       │  │
│      'invited'     → UPDATE → 'active', stamp activated_at          │  │
│      'active'      → allow                                          │  │
│      'suspended'   → 403 access_suspended                           │  │
│    stamps req.userId / userEmail / userRole                         │  │
└─────────────────────────────────────────┼───────────────────────────┼──┘
                                          ▼                           ▼
                              Cloudflare Access API            Resend API
                          (policy b4a92a15…, app_count 1)   (send.jpmtech.com)
```

## Schema (migration 080)

```sql
ALTER TABLE users
  ADD COLUMN role   TEXT NOT NULL DEFAULT 'member'
    CHECK (role IN ('member','admin')),
  ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('invited','active','suspended')),
  ADD COLUMN invited_by      UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN invited_at      TIMESTAMPTZ NULL,
  ADD COLUMN activated_at    TIMESTAMPTZ NULL,
  ADD COLUMN cf_synced_at    TIMESTAMPTZ NULL,
  ADD COLUMN invite_sent_at  TIMESTAMPTZ NULL,
  ADD COLUMN invite_message_id TEXT NULL;

CREATE INDEX users_status_idx ON users (status);
```

Defaults are chosen so the migration is safe on its own: every pre-existing row becomes `member`/`active`, which preserves current access for both existing accounts.

**Data step (idempotent, sentinel-gated, same pattern as `scripts/cutover/001-placeholder-to-jmeyer.sql`):** promote the founding account to `role='admin'`. As of 2026-07-26 the `users` table holds exactly one row — `jason.meyer1@gmail.com` (`c5a79f4b-1701-483f-861c-0386b7dabca4`). The step is a no-op on re-run.

Lifecycle transitions append `account_events` rows, reusing W6's existing cross-wave contract rather than adding a second audit table. New `kind` values: `user_invited`, `user_activated`, `user_suspended`, `user_reinstated`, `role_changed`.

## Configuration

Five new env vars, all **set-once infrastructure identity** — none of them change when users change, so none reintroduce the redeploy coupling:

| Var | Purpose |
|---|---|
| `CF_API_TOKEN` | Cloudflare API token (Q15) |
| `CF_ACCOUNT_ID` | `400d0b4a35d63a32b86ab774b9feb4ab` |
| `CF_ACCESS_POLICY_ID` | `b4a92a15-27d5-477b-ad36-f78fcdae931c` |
| `RESEND_API_KEY` | Resend transactional key |
| `INVITE_FROM_EMAIL` | e.g. `repos@send.jpmtech.com` |

**Removed:** `CF_ACCESS_ALLOWED_EMAILS`, `REPOS_ADMIN_EMAILS`.

`bootstrap-guards.ts` drops the `allowListCount` INFO line and gains advisory INFO lines when `CF_API_TOKEN` or `RESEND_API_KEY` are unset — advisory, not fatal, matching the existing Healthchecks and feedback-webhook precedent. Missing credentials fail at use time with a specific error rather than preventing boot.

## DNS work

Resend requires SPF and DKIM records on the sending domain. These go on **`send.jpmtech.com`**, leaving the root records untouched:

- Root SPF stays `v=spf1 include:_spf.protonmail.ch mx ~all` — unmodified.
- Root DKIM CNAMEs (`protonmail._domainkey` et al.) — unmodified.
- Root DMARC `v=DMARC1; p=quarantine;` covers the subdomain by inheritance; Resend's DKIM signature aligns, so invites authenticate.

Records are added via the Cloudflare API (DNS edit permissions are already available to the operator tooling).

## Email content

Shaped by G14, which requires each Beta user to have a disclaimer and a documented contact path:

1. Who invited them; one line on what RepOS is.
2. An explicit Beta disclaimer.
3. **"Sign in with the Google account for this exact address."** The `repos` Access application allows only the Google IdP (`allowed_idps` lists Google alone; the org's one-time-PIN provider is not enabled on it), so an invitee attempting a non-Google address is bounced with no in-app explanation. This exact confusion cost a live debugging session on 2026-07-26, when `REPOS_ADMIN_EMAILS` was found pointing at a ProtonMail-hosted address that could never authenticate.
4. A contact path for problems.
5. A plain link to `https://repos.jpmtech.com`.

**Rendering:** Inter Tight and JetBrains Mono cannot be relied on — Gmail strips `@font-face`. The template uses the brand palette (`#4D8DFF` accent, `#10141C` surface) with a system-font fallback stack, inline CSS, table layout, and a plain-text alternative part.

## Error handling

| Failure | Behavior |
|---|---|
| CF API unreachable / token invalid — **grant** | Row persists `cf_synced_at NULL`; **no email sent**; admin UI shows "Sync pending — retry"; `POST .../retry-sync` is idempotent |
| CF API unreachable / token invalid — **revoke** | Operation aborts **before** any DB change (Q17); status unchanged, row not cascaded; admin retries. No orphaned state to reconcile |
| DB failure after a successful CF removal | Access is already revoked and data is intact — the fail-closed direction. Admin retries the delete/suspend |
| Policy `app_count !== 1` | Sync refuses, surfaces a distinct error (Q10) |
| Policy contains a non-email selector | Sync refuses, surfaces as drift (Q22) |
| Concurrent invites | Session-level `pg_advisory_lock` on a dedicated connection serializes the whole count → insert → CF round-trip (Q16, Q18) |
| Lock acquisition times out | 503 with a retry hint; a wedged holder fails fast rather than blocking the pool (Q16) |
| Dashboard edited mid-operation | Re-fetch-and-compare immediately before PUT aborts the write and surfaces drift (Q19). Residual window between compare and PUT is **accepted, not eliminated** |
| Concurrent first sign-in (activation race) | Conditional UPDATE picks one winner; only it emits `user_activated` (Q21) |
| Resend failure | Row keeps `invite_sent_at NULL`; user is already in CF policy and *can* sign in; admin resends |
| DB/CF drift | Surfaced as a banner on `/settings/users`; never auto-corrected |
| Cohort cap exceeded | 409 with the current count |
| Self-lockout attempt | 409, action refused (Q13) |
| Total admin lockout | Break-glass runbook: `docker exec` + `UPDATE users SET role='admin', status='active' WHERE email=…` |

## Testing

The highest regression risk is **inverted behavior**: existing tests assert that auto-provisioning works. Locating and flipping those assertions matters more than any new test.

- **Gate:** unknown email → `403 not_invited`; `invited` → flips to `active` and stamps `activated_at`; `suspended` → `403 access_suspended`; no row is ever created by the middleware
- **Activation race (Q21):** two concurrent first requests for the same `invited` user both succeed, but exactly **one** `user_activated` event is written
- **Lockout guardrails:** self-suspend, self-demote, self-delete, and last-admin removal each rejected
- **Auth gate (Q20):** every route rejects `X-Admin-Key`; a CF-Access `member` gets 403; `DELETE` additionally rejects an `Authorization: Bearer` header
- **CF sync (mocked CF API):** success stamps `cf_synced_at`; grant failure leaves NULL **and sends no email**; retry idempotent; `app_count !== 1` refuses; a non-email selector in `include[]` refuses (Q22)
- **Revoke ordering (Q17):** with CF removal mocked to fail, suspend leaves `status` unchanged and delete leaves the row and its data intact — asserted by row counts, not just status code
- **Dashboard-edit clobber (Q19):** mutate the policy between the service's GET and its pre-PUT re-fetch; assert the write aborts and drift surfaces rather than overwriting
- **Cap concurrency (Q18):** fire the tenth and eleventh invites concurrently against a 9-user table; assert exactly one 201 and one 409, and that the final count is 10
- **Email (mocked Resend):** not sent when sync failed; sent on success; resend works
- **Contamination:** a non-admin receives 403 on all six routes — six rows toward G2's ≥35
- **Audit (Q23):** every lifecycle event records both target (`user_id`) and actor (`meta.actor_*`); attribution survives deletion via `user_id_at_event`
- **Migration:** idempotent on re-run; pre-existing rows retain access
- **Reachability (G7):** `/settings/users` within ≤3 clicks of `/`

## Explicitly out of scope

- Self-service signup or access requests
- Organizations, teams, or per-user permissions beyond `member`/`admin`
- Resend delivery webhooks (the resend button covers failure at N≤10)
- Auto-healing DB↔CF drift
- Migrating the CF policy to an Access Group (direct email entries are fine at this scale)
- Invite expiry (an invited row simply waits)
