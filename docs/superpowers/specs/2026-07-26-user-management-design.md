# W9 — User Management + Invites (Design)

**Date:** 2026-07-26
**Status:** Design approved by user. Implementation plan pending (next: `superpowers:writing-plans`).
**Master plan:** [docs/superpowers/plans/2026-05-11-repos-beta.md](../plans/2026-05-11-repos-beta.md) — this wave sits *outside* the original W0–W8 arc.
**Live dashboard:** [docs/superpowers/goals/beta.md](../goals/beta.md)
**Migration range claimed:** `080–089` (W7 reserved 070–079; per-wave 10-block convention).

## Outcome

An admin invites a Beta user from inside RepOS. The invite writes a `users` row, pushes the email into the Cloudflare Access policy, and sends a branded email via Resend. The invitee clicks through, signs in with Google, and lands in the app. Suspending or deleting a user reverses all of it. **No container recreate for any user-lifecycle change** — the five new environment variables (see Configuration) require one initial configuration rollout, and nothing after it.

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
| Q4 | **`users.status` (`invited`/`active`/`suspended`/`deleting`) replaces `CF_ACCESS_ALLOWED_EMAILS`.** (`deleting` added by Q17b; no `reinstating` state — see Q34.) | The env check at `cfAccess.ts:112` is already conditional (`if (allowList.length && …)`), so an empty value is a supported state today. Removal is a subtraction, not a rewrite. |
| Q5 | **Resend for email, sending from the `send.jpmtech.com` subdomain.** | User chose Resend. The subdomain keeps root-domain SPF/DKIM untouched, so a misconfiguration here cannot break Proton-hosted mail on `jpmtech.com`. |
| Q6 | **No invite token / magic link.** The email links to `https://repos.jpmtech.com`; authentication is CF Access + Google, authorization is the pre-created row. | A token would be a second, weaker credential path into the same app. |
| Q7 | **CF sync happens before the email is sent, and never inside a DB transaction.** Row is written with `cf_synced_at NULL` → CF sync → stamp → email. | The DB write and an external HTTP call cannot share a transaction. Ordering guarantees nobody receives an invite they cannot act on. |
| Q8 | **Sync failure leaves the row "sync pending" and is retried idempotently — it does not roll back.** Applies to *grants* only; see Q17 for revocations. | Rollback discards admin intent and races the email send. A pending row with a retry affordance is recoverable; a lost invite is not. |
| Q9 | **Drift between DB and CF policy is surfaced, never auto-healed.** | Auto-healing would silently revert a deliberate dashboard edit. Showing it lets a human decide. |
| Q10 | **The sync service asserts `app_count === 1` on the policy before writing, and refuses otherwise.** | The `Owner Only` policy is `reusable: true`. Verified `app_count: 1` on 2026-07-26, but if it is ever attached to a second application, RepOS would silently start granting access to that app. Encoded in code, not just documented. |
| Q11 | **No `BOOTSTRAP_ADMIN_EMAIL` env var. First-admin recovery is a documented break-glass** (`docker exec` + one `UPDATE`). | A bootstrap env var reintroduces exactly the redeploy-coupled config this wave removes. |
| Q12 | **The G14 cohort cap (10) is enforced in code.** The counted set is **`active + invited + deleting`** — a `deleting` row has not released its slot until the cascade completes. Exceeding it returns 409, and the error body reports the count using that same definition. Both invite **and reinstate** are subject to it (Q26). | The cap currently exists only as prose in the master plan. Round-3 review: the round-2 text said `active + invited` while the architecture counted `deleting` too — one definition, stated once, referenced everywhere. |
| Q13 | **Lockout guardrails at the route layer:** no self-suspend, self-demote, or self-delete; the last remaining admin cannot be removed. | Deny-by-default makes admin lockout unrecoverable except by SSH. |
| Q14 | **Suspension removes the email from the CF policy; reinstatement re-adds it.** | A suspended user should be stopped at the edge, not travel to the origin for a 403. |
| Q15 | **Dedicated, narrowly-scoped Cloudflare API token.** Attempt the beta resource-scoped "Access policy admin" role limited to this one policy; fall back to account-scoped `Access: Apps and Policies → Edit`. Recorded in `docs/runbooks/secret-rotation.md` with a rotation cadence. | The account-scoped permission also grants edit over `ha.jpmtech.com` and `jellyseerr.jpmtech.com`. A RepOS compromise holding it is a path into home automation. The narrower scope is worth verifying. |
| Q16 | **Serialization uses a session-level `pg_advisory_lock` on a dedicated pooled connection, released in a `finally`** — not `pg_advisory_xact_lock`. The connection is checked out of the pool, the lock taken, the CF round-trip performed with **no open transaction**, then unlock + release. | Review finding 1. `pg_advisory_xact_lock` is transaction-scoped: it releases at commit, so it serializes nothing once the transaction closes, and keeping the transaction open across an HTTP call is exactly what Q7 forbids. A session lock holds across statements without a transaction. `db` is a `pg.Pool` (`max: 20`), so one held connection is acceptable at Beta volume; `statement_timeout: 5000` is per-statement and does not fire on an idle held connection. Lock acquisition is bounded by a timeout so a wedged holder fails fast instead of blocking. Crash safety is free — session end releases the lock. |
| Q17 | **The DB row — not the Cloudflare policy — is the immediate security boundary.** The rule is **grants take effect last, revocations take effect first**, where "takes effect" means *at the layer checked on every request*. Only the DB is. Concretely: **invite** = insert non-activatable row → CF add → mark synced → email. **Reinstate** = CF add → set `active` + stamp `cf_synced_at` last. **Suspend** = set `suspended` **first** → CF policy remove → stamp `cf_synced_at`. **Delete** = set `deleting` **first** → CF policy remove → stamp → cascade last. | **Round-2 review finding 1 — the round-1 version of this decision was wrong.** It assumed removing an email from the CF policy revokes access immediately. It does not: Access evaluates policy at *authentication*, and an issued session remains valid for its duration — 24h on this app's policy. Corroborated across three doc areas (service tokens describe "revoke existing tokens" as an action separate from policy config; managed OAuth re-evaluates policy "on each token refresh," not per request; MFA session durations are "only checked during the login flow and do not affect a user's existing session") and by the existence of a dedicated revocation endpoint. The DB status *is* checked on every request by `cfAccess.ts`, so it is the only immediate boundary available. |
| Q17a | **RepOS does not call Cloudflare's session-revocation endpoint.** Revocation is: DB status (immediate) + policy removal (prevents new sessions). A live CF session may persist until it expires; it is harmless because the DB gate rejects every request it carries. | **Round-3 review — this decision reverses the round-2 version, which called `revoke_user`.** Three reasons. (1) **Blast radius**: the endpoint's own API description is "Revokes a user's access across **all applications**" — suspending a RepOS user would also sign them out of `ha.jpmtech.com` and `jellyseerr.jpmtech.com`. (2) **Credential creep**: it needs `Access: Organizations Revoke`, an account-level permission that cannot be resource-scoped, directly undoing Q15's narrow-token goal. (3) **No correctness gain**: the DB already denies on the next request. The round-2 framing of "advisory, surfaced as drift" was also unimplementable — once policy removal succeeds `cf_synced_at` is correctly stamped, so no column records a failed revocation, and during delete the cascade would either destroy the retry target or block on a supposedly advisory call. Session-expiry exposure is bounded by the policy's 24h session and is **accepted**. |
| Q17b | **Durable intent columns:** `status` gains `'deleting'`, and an `invited` row may not activate unless `cf_synced_at IS NOT NULL`. | Round-2 review finding 1. Without `deleting`, a delete whose CF step fails leaves no record that deletion was requested — the intent is lost and nothing can retry it. Without the `cf_synced_at` precondition, a row whose CF provisioning failed is nonetheless activatable the moment anything puts a session in front of it. |
| Q18 | **The cohort cap check and the row insert happen inside the same critical section as the CF sync lock** (Q16). | Review finding 3. A bare count-then-insert races: two admins each observe 9 and both insert, yielding 11. Invites already serialize on the advisory lock, so moving the count inside it costs nothing. |
| Q19 | **Immediately before PUT, the policy is re-fetched and compared against the snapshot taken at the start of the operation. Any difference aborts the write and surfaces as drift.** | Review finding 4. The advisory lock serializes RepOS against itself, not against a human editing the Cloudflare dashboard between our GET and PUT. **Verified against the Cloudflare OpenAPI spec: the Access policy PUT supports no `ETag`, `If-Match`, or version field**, so true optimistic concurrency is unavailable. Re-fetch-and-compare narrows the window to the compare→PUT gap; it does not eliminate it. **Accepted residual risk**, justified by a single-operator account and an admin-initiated, low-frequency operation. |
| Q20 | **User-management routes require CF Access + `role='admin'`. The `X-Admin-Key` path is rejected**, matching `requireCfAccessOnly`. Delete additionally rejects any `Authorization: Bearer` header — see Q32 for what that does and does not guarantee. | Review finding 5. `requireAdminKeyOrCfAccess()` returns on the admin-key branch **without setting `req.userId` or `req.userEmail`**, so there is no actor: self-lockout guards (Q13) have no "self" to compare against and audit rows have no attribution. Precedent already exists — `account.ts:298` gates `DELETE /api/me` with `requireCfAccessOnly` on identical reasoning. No operator automation needs to manage users. |
| Q21 | **Activation is a conditional update that also requires provisioning:** `UPDATE users SET status='active', activated_at=now() WHERE id=$1 AND status='invited' AND cf_synced_at IS NOT NULL RETURNING id`. The `user_activated` event is emitted **only** by the request whose UPDATE returned a row. **A zero-row result is never treated as "someone else activated me."** The middleware re-reads the row and decides on its *actual* current status: `active` → allow; `suspended` or `deleting` → 403; `invited` with a null stamp → 403 `not_provisioned`. | Review finding 6, corrected twice. Round 3 added the conditional update but omitted the `cf_synced_at` predicate that Q17b requires, so the two decisions disagreed. **Round-4 review finding 3** caught the more serious half: assuming a lost race means another activation won is a security hole — the update may equally have lost because an admin concurrently suspended or deleted the row, in which case the round-3 wording would have let a suspended user straight through. Re-reading and branching on real state is the only safe interpretation of zero rows. |
| Q22 | **The sync service writes only to the `Owner Only` policy, and only when every `include[]` element is an email selector** (`{email:{email:…}}`). Any other selector type — `everyone`, `email_domain`, `group`, `service_token` — causes a refusal that surfaces as drift. `exclude[]` and `require[]` are never touched, and the app's second policy (`post-deploy-smoke service token`) is never touched. | Review clarification. "Mutate `include[]`" is unsafe without a declared shape: blind array manipulation could drop a group selector or, worse, preserve an `everyone` rule while appearing to work. Fail-closed on any unrecognized shape. Verified 2026-07-26: the policy currently contains exactly three email selectors and nothing else. |
| Q23 | **Audit rows carry both actor and target.** `account_events.user_id` is the **target** (so the event lands in that user's `AccountEventsTimeline`); `meta.actor_user_id` + `meta.actor_email` record the **actor**. | Review clarification. `invited_by` covers invitation only; suspension, role change, and deletion need durable attribution too. This requires **no migration** — `kind` has no CHECK constraint by design (per C-ACCOUNT-EVENTS-ENUM, new kinds extend the TypeScript union) and `meta` is intentionally permissive. Deletion attribution survives via the existing `user_id_at_event` snapshot + `ON DELETE SET NULL`. |
| Q24 | **`cf_synced_at` means "this row's intent is reflected in the CF policy."** Any status change that alters CF membership clears it to NULL first; it is stamped only after a successful sync. | Review clarification. Left implicit in the first draft. Without this rule a suspended-then-reinstated row could carry a stale timestamp and read as synced when it is not. |
| Q25 | **The bearer path enforces status too.** `requireAuth` joins `users` and requires `status='active'`; a suspended, deleting, or invited-but-unactivated user's token returns 401. | **Round-2 review finding 2.** Verified: `auth.ts:43–48` selects from `device_tokens` alone with no join to `users`. A suspended user's iOS Shortcut token would keep working indefinitely — the gate would exist on only one of two authentication paths. Suspension and reinstatement are tested through **both** paths. |
| Q26 | **Every transition affecting cohort membership runs under the Q16 mutation lock** — invite, reinstate, suspend, and delete, not invite alone. **Role changes and last-admin checks additionally take a transaction-level lock** covering the count-and-mutate. | **Round-2 review finding 3.** Two gaps: reinstating a suspended user also grows the counted set defined in Q12 (suspend one of ten, invite a replacement, reinstate the original → eleven), and two admins can concurrently demote each other after each observes two admins → zero admins. The Q13 guardrails are read-then-write and race exactly like the cap did. |
| Q27 | **Audit rows are written in the same transaction as the mutation they describe**, via the existing `recordAccountEventTx`. `user_invited` commits with the `users` INSERT, not after the email. Deletion emits **two** events: `user_delete_requested` in the transaction that sets `status='deleting'`, and `user_deleted` immediately before the cascade, in that transaction. | **Round-2 review finding 4.** The round-1 ordering wrote `user_invited` after Resend, so a mail failure left a real user row and a live CF grant with no audit record. `recordAccountEventTx` already exists for this exact pattern (W2 precedent). Note W6's own deletion path records `account_deleted` only as a **log line** (`account.ts:349`) with no `account_events` row — W9 does not inherit that gap. **Round 3** added the two-event split: a delete can be requested by one admin and resumed by another after an interrupted CF step, so a single event would attribute the whole operation to whoever finished it and lose the original requester. |
| Q28 | **PATCH transition matrix is closed.** Permitted: `active→suspended`, `suspended→active`, `invited→suspended`, and `role` changes on `active`/`suspended`. Rejected with 409: anything → `invited`, anything → `deleting` (delete owns that), and `deleting` → anything. **Activation happens only through first sign-in** (Q21), never through PATCH. | Review clarification. An open matrix would let an admin hand-set `invited`, re-arming an activation that Q21's conditional update assumes happens once. |
| Q29 | **Duplicate invite is explicit per current status, and the `invited` case splits on sync state:** `invited` + `cf_synced_at NULL` → **retry the CF sync first**, and send only if it succeeds (200 `{resynced: true}`); `invited` + `cf_synced_at` set → intentional resend with a **fresh** idempotency key (200 `{resent: true}`); `active` → 409 `already_active`; `suspended` → 409 `suspended_use_reinstate`; `deleting` → 409 `deletion_in_progress`. `POST /:id/resend-invite` enforces the identical precondition. | Review clarification, tightened in round 3. `users.email` is UNIQUE, so the un-specified path was a raw constraint violation surfacing as a 500. The round-2 wording emailed unconditionally on any `invited` row — but a row whose provisioning failed carries `cf_synced_at NULL`, so that would send a link the invitee cannot use, contradicting Q7 and Q17b. |
| Q30 | **Resend idempotency keys.** The initial send uses a key derived from the user id + `invited_at`, so a timeout-retry cannot double-send. An explicit admin "resend" uses a **fresh** key, because that is a deliberate second delivery. | Review clarification. Distinguishes transport retry from intentional resend. |
| Q31 | **The cutover — a numbered script under `scripts/cutover/`, not migration 080 itself — stamps the sync baseline and reconciles in both directions.** It reads the live CF policy and: (a) promotes the founding admin; (b) stamps `cf_synced_at` on rows confirmed present in the policy, leaving absent ones NULL to surface as drift; **(c) creates a `users` row with `status='invited'` and `cf_synced_at` stamped for every policy email that has no row**, so they activate normally on first sign-in. | Review clarification, corrected in round 4. The bare `ALTER TABLE` leaves every existing row `cf_synced_at NULL`, which the drift banner would read as "nothing is synced" on day one — a false alarm that trains the operator to ignore the signal. Clause (c) is the more serious half and was missing entirely: **`thesugardog@gmail.com` is in the CF policy today but has no `users` row**, having been granted access on 2026-07-26 without yet signing in. Deny-by-default would have locked out a deliberately-invited user at cutover. Creating them as `invited` rather than `active` means first sign-in emits `user_activated` exactly like any other invitee. The step consults live Cloudflare state, which is why it is a cutover script rather than a migration. |
| Q33 | **Both deletion paths share one service.** A single `deleteUser(targetId, actor)` owns the full state machine — lock, `status='deleting'`, CF removal, both audit events, cascade — and **`DELETE /api/me` is refactored to call it.** The governing invariant is stated once: **at least one `active` admin must always remain.** Self-service deletion stays available to any user subject to that invariant; an admin who is the last admin gets 409 on `/api/me` exactly as on the admin route. The admin route additionally rejects self-targeting (Q13) as a UX matter — manage yourself via `/settings/account`, not the user list. | **Round-4 review finding 1.** Verified: `account.ts:316` deletes the row directly at line 338 with no status transition, no CF removal, no lock, no role check, and no `account_events` row. Two deletion paths with different security semantics is the defect — the last-admin guard is trivially bypassed by an admin deleting themselves through `/api/me`, causing the zero-admin lockout Q13 exists to prevent, and the deleted user's email is orphaned in the CF policy forever. Framing the invariant as "≥1 active admin" rather than "no self-delete" is what makes the two paths reconcilable: the self-action bans were a cruder proxy for it. |
| Q34 | **Reinstatement clears `cf_synced_at` before the CF call, and does not get a `reinstating` status.** Order: NULL the stamp → CF add → set `status='active'` + stamp, one transaction. Q8's sync-pending contract is **explicitly narrowed to grants that create a row** (invites). A reinstatement whose CF step fails leaves an ordinary `suspended` row and is simply retried. | **Round-4 review finding 2 — adopted in part.** The genuine defect was the second half: with the round-3 ordering, a CF success followed by a DB failure left the email in the policy while the row kept a `cf_synced_at` timestamp earned while *suspended*, so it read as synced when it was not. Clearing the stamp first fixes exactly that — the row surfaces as drift (policy contains an email for a non-active user). **Declining the `reinstating` status**: unlike an interrupted delete, an interrupted reinstate has a correct and safe resting state — still suspended, still denied on both paths, no wrongful access. A fifth status would have to be threaded through the gate, both auth paths, the cap, and the transition matrix to model a failure whose fallback is already right. Durable intent earns its complexity for deletion because the alternative is a half-deleted user; here it does not. |
| Q32 | **This spec does not claim `requireFreshCfAccess` enforces re-authentication.** It rejects the `X-Admin-Key` path and requires a valid CF Access JWT plus an admin email; it performs **no token-age check** (`cfAccess.ts:217`). Delete adopts that posture under its accurate description. Renaming the existing flag is noted as a follow-up, out of scope here. | Review clarification. The round-1 spec said delete "follows the `requireFreshCfAccess` posture," which implied a freshness guarantee that does not exist. Propagating a misleading name into a security-relevant decision is how the misunderstanding spreads. |

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
│         │  ALL membership transitions hold the same lock (Q26)         │
│         ▼  ─── pg_advisory_lock, session-scoped, finally-released ──┐  │
│                                                                      │  │
│  GRANT — effective LAST (Q17)                                        │  │
│   invite:  (1) count active+invited+deleting; 409 if capped  (Q18)   │  │
│            (2) BEGIN → INSERT users (status='invited',               │  │
│                  cf_synced_at NULL → not yet activatable, Q17b)      │  │
│                → recordAccountEventTx('user_invited')  (Q27)         │  │
│                → COMMIT                                              │  │
│            (3) cfAccessSync.add                                      │  │
│                  GET policy → assert app_count===1        (Q10)      │  │
│                  → assert all include[] are email selectors (Q22)    │  │
│                  → mutate → RE-FETCH + compare (Q19) → PUT           │  │
│            (4) stamp cf_synced_at  ← row becomes activatable          │  │
│            (5) inviteMailer (idempotency key, Q30)                    │  │
│   reinstate: (1) count vs cap (Q12, Q26)                              │  │
│             (2) NULL cf_synced_at first             (Q34)             │  │
│             (3) cfAccessSync.add                                      │  │
│             (4) UPDATE status='active', cf_synced_at=now()            │  │
│                 + event, one transaction — LAST      (Q17, Q24)       │  │
│                                                                      │  │
│  REVOKE — effective FIRST (Q17)                                      │  │
│   suspend: (1) UPDATE status='suspended', cf_synced_at=NULL          │  │
│                + event, one transaction              (Q24, Q27)      │  │
│            (2) cfAccessSync.remove                                   │  │
│            (3) stamp cf_synced_at=now()                     (Q24)    │  │
│   delete:  (1) UPDATE status='deleting'                              │  │
│                + event 'user_delete_requested', one txn  (Q17b,Q27)  │  │
│            (2) cfAccessSync.remove   (3) stamp cf_synced_at          │  │
│            (4) BEGIN → recordAccountEventTx('user_deleted')          │  │
│                → DELETE FROM users (W6 cascade) → COMMIT   (Q27)     │  │
│   (no Cloudflare session-revocation call — see Q17a)                 │  │
│   ↑ services/deleteUser.ts — DELETE /api/me calls this same           │  │
│     service; neither path deletes a row directly        (Q33)        │  │
│         ▼  ─── unlock + release ────────────────────────────────────┘  │
│                                                                        │
│  middleware/auth.ts — BEARER GATE (Q25)                                │
│    prefix lookup → argon2 verify → JOIN users                          │
│      users.status <> 'active'  → 401                                   │
│                                                                        │
│  middleware/cfAccess.ts  — CF ACCESS GATE (rewritten)                  │
│    verify JWT → resolve email → SELECT users row                       │
│      no row                            → 403 not_invited               │
│                                          (no auto-provision)           │
│      'invited' AND cf_synced_at IS NULL → 403 not_provisioned  (Q17b)  │
│      'invited' AND cf_synced_at NOT NULL→ conditional UPDATE → 'active'│
│                                          stamp activated_at    (Q21)   │
│      'active'                          → allow                         │
│      'suspended'                       → 403 access_suspended          │
│      'deleting'                        → 403 access_suspended  (Q17b)  │
│    stamps req.userId / userEmail / userRole                            │
└─────────────────────────────────────────┬───────────────────────────┬──┘
                                          ▼                           ▼
                              Cloudflare Access API            Resend API
                          (policy b4a92a15…, app_count 1)   (send.jpmtech.com)
                          policy edit only — no session revocation (Q17a)
```

## Schema (migration 080)

```sql
ALTER TABLE users
  ADD COLUMN role   TEXT NOT NULL DEFAULT 'member'
    CHECK (role IN ('member','admin')),
  ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('invited','active','suspended','deleting')),
  ADD COLUMN invited_by      UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN invited_at      TIMESTAMPTZ NULL,
  ADD COLUMN activated_at    TIMESTAMPTZ NULL,
  ADD COLUMN cf_synced_at    TIMESTAMPTZ NULL,
  ADD COLUMN invite_sent_at  TIMESTAMPTZ NULL,
  ADD COLUMN invite_message_id TEXT NULL;

CREATE INDEX users_status_idx ON users (status);
```

Defaults are chosen so the migration is safe on its own: every pre-existing row becomes `member`/`active`, preserving access for everyone who already has a `users` row.

**Data step (idempotent, sentinel-gated, same pattern as `scripts/cutover/001-placeholder-to-jmeyer.sql`):** promote the founding account to `role='admin'`. As of 2026-07-26 the `users` table holds exactly one row — `jason.meyer1@gmail.com` (`c5a79f4b-1701-483f-861c-0386b7dabca4`). The step is a no-op on re-run.

Lifecycle transitions append `account_events` rows, reusing W6's existing cross-wave contract rather than adding a second audit table. New `kind` values: `user_invited`, `user_activated`, `user_suspended`, `user_reinstated`, `role_changed`, **`user_delete_requested`**, **`user_deleted`**. Each is written in the same transaction as the mutation it describes (Q27); `user_deleted` is written immediately before the cascade so its `user_id_at_event` + `user_email_at_event` snapshot survives the FK `SET NULL`. The two deletion events are separate because an interrupted delete may be resumed by a different admin — the pair preserves both the requester and the completer.

## Configuration

Five new env vars, all **set-once infrastructure identity** — none of them change when users change, so none reintroduce the redeploy coupling:

| Var | Purpose |
|---|---|
| `CF_API_TOKEN` | Cloudflare API token (Q15). Policy read/write only — deliberately **not** granted `Access: Organizations Revoke`, since RepOS makes no session-revocation call (Q17a) |
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
| CF API unreachable / token invalid — **revoke** | The DB status change has **already committed** and already denies access on every request (Q17). Policy removal is retried; until it succeeds `cf_synced_at` stays NULL and the row shows as drift. A live CF session is harmless because the DB gate rejects it |
| Live CF session outlives suspension | Expected and accepted (Q17a). The session can reach the origin but is denied by the DB gate on every request; it expires within the policy's 24h session |
| Delete interrupted after `status='deleting'` | Intent is durable (Q17b). The row is non-authenticating on both paths, and the admin resumes the delete. This is the state the round-1 design lost |
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

- **Gate (CF Access path):** unknown email → `403 not_invited`; `invited` + `cf_synced_at` set → flips to `active`; `invited` + `cf_synced_at NULL` → 403, **not** activated (Q17b); `suspended` and `deleting` → 403; no row is ever created by the middleware
- **Gate (bearer path, Q25):** a token belonging to a `suspended`, `deleting`, or unactivated user returns 401. Suspend-then-reinstate is asserted through **both** authentication paths in one test, since the round-1 design covered only one
- **Revocation timing (Q17):** with the CF calls mocked to fail entirely, a suspended user is denied on the **very next request** — proving the DB, not the policy, is the boundary
- **Activation race (Q21):** two concurrent first requests for the same `invited` user both succeed, but exactly **one** `user_activated` event is written
- **Lockout guardrails:** self-suspend, self-demote, self-delete, and last-admin removal each rejected
- **Auth gate (Q20):** every route rejects `X-Admin-Key`; a CF-Access `member` gets 403; `DELETE` additionally rejects an `Authorization: Bearer` header
- **CF sync (mocked CF API):** success stamps `cf_synced_at`; grant failure leaves NULL **and sends no email**; retry idempotent; `app_count !== 1` refuses; a non-email selector in `include[]` refuses (Q22)
- **Revoke ordering (Q17):** with CF removal mocked to fail — suspend leaves `status='suspended'` with `cf_synced_at NULL`; delete leaves `status='deleting'` with every cascaded row still intact. Asserted by row counts, not just status code. **The DB revocation must already have committed**, which is the opposite of what the round-2 draft of this test asserted
- **Dashboard-edit clobber (Q19):** mutate the policy between the service's GET and its pre-PUT re-fetch; assert the write aborts and drift surfaces rather than overwriting
- **Cap concurrency (Q18, Q26):** fire the tenth and eleventh invites concurrently against a 9-user table — exactly one 201, one 409, final count 10. Separately, fire a **concurrent invite-versus-reinstate** at a count of nine and ten; reinstate must contend for the same cap
- **Last-admin race (Q26):** two admins concurrently demote each other; assert exactly one succeeds and at least one admin always remains. Same test for concurrent mutual deletion
- **Transition matrix (Q28):** every rejected transition returns 409 — notably `active→invited` and any transition out of `deleting`
- **Duplicate invite (Q29):** all **five** state/sync cases return their specified code — `invited`+unsynced, `invited`+synced, `active`, `suspended`, `deleting` — and none surfaces a raw UNIQUE violation. The unsynced branch must **not** send mail before the retry succeeds
- **Activation vs suspension race (Q21):** suspend a row concurrently with its first sign-in; assert the losing activation is denied on re-read rather than admitted as `active`. Same for a concurrent delete
- **Unified deletion (Q33):** `DELETE /api/me` and the admin route produce identical end state — same events, same CF removal, same cascade. A last admin is refused on **both**; a non-last admin succeeds on both; a member always succeeds
- **Reinstate failure (Q34):** with CF add mocked to fail, the row stays `suspended` with `cf_synced_at NULL` and surfaces as drift; the user remains denied on both auth paths
- **Cutover (Q31):** a policy email with no `users` row gets one as `invited` with a stamped sync time, and signs in successfully on first attempt
- **Audit atomicity (Q27):** with Resend mocked to fail, the `user_invited` event still exists; with the cascade mocked to fail, `user_deleted` is rolled back with it — no event describing a mutation that did not happen, and no mutation without its event
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
