# W7 — In-app Feedback Loop (Design)

**Date:** 2026-05-28
**Status:** Design approved by user. Implementation plan pending (next: `superpowers:writing-plans`).
**Master plan:** [docs/superpowers/plans/2026-05-11-repos-beta.md §W7](../plans/2026-05-11-repos-beta.md)
**Live dashboard:** [docs/superpowers/goals/beta.md](../goals/beta.md)
**Migration range claimed:** `070–079` (W6 reserved 060–069; per-wave 10-block convention).

## Outcome

Close the user → engineering signal loop for Beta. A logged-in user can send free-text feedback from anywhere in the app; it lands durably in a `feedback` table within 5s, forwards to a Discord-compatible webhook (confirmed by durable delivery state), and the sole admin (jmeyer) can pull + triage it via a JSON endpoint and a minimal admin page.

This wave **closes G12 entirely** and **contributes to G14** (the in-app channel is the documented Beta contact path; G14 fully closes at cutover).

## Locked decisions (from the brainstorming pass)

Each is binding for the implementation plan; deviations require re-opening this spec.

| # | Decision | Rationale anchor |
|---|----------|------------------|
| Q1 | **Discord-compatible webhook.** Single `FEEDBACK_WEBHOOK_URL` env var; POST a Discord webhook JSON payload (`content` + `embeds`) via native `fetch`. No new dependency. No-op + info-log if unset. | User chose Discord. Discord incoming webhooks are zero-config and the user already runs one. Native `fetch` (Node ≥18) means no supply-chain add. |
| Q2 | **No screenshot/image capture.** The master plan's "optional screenshot" (W7.2) traces to the git-tracked `screenshot.png` design artifact, not a capture feature. Feedback is text + auto-captured context metadata (`route`, `app_sha`, `user_agent`). | User clarification. Image capture would need html2canvas + a multipart/blob path + storage — disproportionate for an N≤10 Beta. Re-add post-Beta if testers ask. |
| Q3 | **Topbar bug-button + Settings → Feedback page.** A global button in the Topbar action group opens a `FeedbackSheet` from any route (1 click); the full form also lives in the pre-provisioned `SETTINGS_SECTIONS` "Feedback" slot. | User chose both. Max discoverability for a feedback loop (the point of W7) + the slot is already pre-provisioned (`disabled:true`, `ownerWave:'W7'`). AppShell has no footer, so the Topbar is the only global action surface. |
| Q4 | **Admin JSON endpoint + minimal admin page.** `GET /api/admin/feedback` + `PATCH /api/admin/feedback/:id/triage` (admin-gated), plus a bare `/admin/feedback` list page with a "Mark triaged" action. | User chose both. The JSON endpoint matches the plan's "engineer pulls"; the minimal page gives click-to-triage without building a board. |
| Q5 | **Durable webhook-delivery state.** `feedback.webhook_delivered_at` + `webhook_attempts` columns; async delivery updates them. | Turns G12's "webhook delivers within 5s" into assertable durable state instead of a test side-channel; lets the admin page show delivery status; satisfies CLAUDE.md API-reliability (retry on 429/5xx, no false negatives). |
| Q6 | **`app_sha` is server-stamped** from `process.env.APP_SHA` (wired via a Docker build ARG→ENV), falling back to `'dev'`. The client never supplies it. | Server and bundle ship from the same monolithic image, so the server's SHA is authoritative for the bundle the user is running. Avoids a `VITE_` define and a spoofable client field. |
| Q7 | **No `category` field.** Single textarea, per the master plan W7.2 wording. | YAGNI. A taxonomy adds UI + a column with no Beta-scale payoff; the engineer reads free text from N≤10 users directly. |

## Architecture

```
┌───────────────────────────── client (frontend) ─────────────────────────────┐
│                                                                              │
│  Topbar bug-button ──┐                                                        │
│   (any route)        ├─► <FeedbackSheet>  ──┐                                 │
│  /settings/feedback ─┘    (textarea+Send)   │  POST /api/feedback             │
│   <SettingsFeedbackPage> ───────────────────┤  { body, route }               │
│                                             │  apiFetch + X-RepOS-CSRF        │
│  /admin/feedback (admins only) ─────────────┼─► GET /api/admin/feedback       │
│   <AdminFeedbackPage> (list + triage)       │   PATCH .../:id/triage          │
│                                             │                                 │
└─────────────────────────────────────────────┼─────────────────────────────────┘
                                              │
┌───────────────────────────── server (api) ──┼─────────────────────────────────┐
│                                              ▼                                 │
│  routes/feedback.ts                                                            │
│   POST /api/feedback   [requireBearerOrCfAccess + csrfOrigin]                  │
│     ├─ zod { body:1..4000, route? }                                            │
│     ├─ INSERT feedback (user_id, user_email_at_submit, body, route,            │
│     │                   app_sha=env.APP_SHA, user_agent=header)                │
│     ├─ reply 201 { id }                                                        │
│     └─ void deliverFeedbackWebhook(row)   ── async, advisory ──┐               │
│                                                                ▼               │
│   routes/adminFeedback.ts                          lib/feedbackWebhook.ts      │
│    GET  /api/admin/feedback   [requireAdminKeyOrCfAccess]    builds Discord     │
│    PATCH /api/admin/feedback/:id/triage                     embed; POST to      │
│       └─ set triaged_at                                     FEEDBACK_WEBHOOK_URL│
│                                                             retry 429/5xx;      │
│  routes/me.ts  (+ is_admin derived from REPOS_ADMIN_EMAILS) writes              │
│                                                             webhook_delivered_at│
└────────────────────────────────────────────────────────────────────────────────┘
```

## Data model — `070_feedback.sql`

```sql
-- Beta W7 — in-app feedback capture. One row per submission.
-- Range 070–079 reserved for W7 per per-wave migration-range claim.
CREATE TABLE IF NOT EXISTS feedback (
  id                   BIGSERIAL   PRIMARY KEY,
  user_id              UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  user_email_at_submit TEXT        NULL,          -- survives user deletion (mirrors account_events)
  body                 TEXT        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  route                TEXT        NULL,           -- client-supplied page path (e.g. /today/:id/log)
  app_sha              TEXT        NULL,           -- server-stamped from process.env.APP_SHA
  user_agent           TEXT        NULL,           -- server-stamped from request header
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  triaged_at           TIMESTAMPTZ NULL,           -- W7.4 admin triage
  webhook_delivered_at TIMESTAMPTZ NULL,           -- delivery confirmation (G12-assertable)
  webhook_attempts     INT         NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS feedback_triage_idx
  ON feedback (triaged_at NULLS FIRST, created_at DESC);
```

- **`body`** capped at 4000 chars (under Discord's 4096 embed-description limit).
- **`user_id ON DELETE SET NULL`** + **`user_email_at_submit`**: feedback outlives the account so the engineer can still read it after a tester leaves the cohort, while never dangling an FK.
- **No `category`** (Q7). **No image column** (Q2).

## Backend

### `POST /api/feedback` (`routes/feedback.ts`)
- Pre-handlers: `requireBearerOrCfAccess` + `csrfOrigin` (matches the account-route pattern).
- Zod body: `{ body: string().min(1).max(4000), route: string().max(512).optional() }`.
- Resolves `user_id` from `req.userId`; `user_email_at_submit` from `req.userEmail` (re-reads `users.email` if a bearer path didn't populate it, per the account-route precedent).
- Stamps `app_sha = process.env.APP_SHA ?? 'dev'`, `user_agent = req.headers['user-agent']`.
- `INSERT` → reply **`201 { id }`** immediately. Then `void deliverFeedbackWebhook(row).catch(log)` — webhook is advisory and must never block or fail the user submit.

### `lib/feedbackWebhook.ts`
- `deliverFeedbackWebhook(row, { fetchImpl? })`:
  - No-op + `log.info` if `FEEDBACK_WEBHOOK_URL` unset.
  - Builds a **Discord** payload: `{ content, embeds: [{ title, description: body, fields: [user, route, app_sha], timestamp }] }`.
  - POSTs via `fetch` with a timeout (AbortController). Retries on `429`/`5xx` with capped exponential backoff (per CLAUDE.md API-reliability); increments `webhook_attempts`. On 2xx, sets `webhook_delivered_at = now()`.
  - Exported and unit-testable directly (inject `fetchImpl`).

### `GET /api/admin/feedback` + `PATCH /api/admin/feedback/:id/triage` (`routes/adminFeedback.ts`)
- Pre-handler: `requireAdminKeyOrCfAccess()` (dual: `X-Admin-Key` OR CF Access + `REPOS_ADMIN_EMAILS`).
- `GET`: keyset-paginated list, **untriaged first** (`triaged_at NULLS FIRST, created_at DESC`), capped `limit`. Returns `id, body, route, app_sha, user_email_at_submit, created_at, triaged_at, webhook_delivered_at`.
- `PATCH /:id/triage`: sets `triaged_at = now()` (idempotent — no-op if already set). Returns the updated row.

### `/api/me` gains `is_admin`
- Boolean derived from whether `req.userEmail` ∈ `REPOS_ADMIN_EMAILS`. Lets the frontend conditionally render the admin link without leaking the gate logic. Non-admins hitting `/api/admin/feedback` still get a hard `403`.

### Config / infra
- `bootstrap-guards.ts`: register `FEEDBACK_WEBHOOK_URL` as **optional** (info-log "webhook delivery disabled" if unset; not fatal).
- `docker/Dockerfile`: add `ARG APP_SHA` → `ENV APP_SHA=$APP_SHA`; CI build passes `--build-arg APP_SHA=$GITHUB_SHA` so prod `app_sha` is the real commit SHA.

## Frontend

### Topbar bug-button + `FeedbackSheet`
- Add an `Icon name="feedback"` (inline SVG) to the `Icon` component.
- In `Topbar.tsx`, add `<button aria-label="Send feedback">` to the existing right-aligned action group (next to the sync pill), rendered at **both** breakpoints (matches the responsive-chrome principle — same component, viewport-aware).
- `<FeedbackSheet>`: textarea (maxLength 4000, char counter) + Send. Auto-fills `route` from `useLocation().pathname`. POSTs via `apiFetch('/api/feedback', { method:'POST', headers:{'X-RepOS-CSRF':'1', ...}, body })`. `pushToast({severity:'success'})` on 201, `pushToast({severity:'error', body: actionable message})` on failure (per CLAUDE.md error-handling). Clears + closes on success.

### `SettingsFeedbackPage` (`/settings/feedback`)
- Flip the pre-provisioned `SETTINGS_SECTIONS` Feedback slot to `disabled:false`.
- Replace the `ComingSoonPlaceholder` route in `App.tsx` with `<SettingsFeedbackPage>` — the same form, full-page, design-system styled (Inter Tight, surface card, accent Send CTA all-caps).
- If `is_admin` (from `/api/me`), render a "VIEW ALL FEEDBACK →" link to `/admin/feedback`.

### `AdminFeedbackPage` (`/admin/feedback`)
- Minimal list: each row shows `body`, `user_email_at_submit`, `route`, `app_sha` (mono), relative age, webhook-delivery dot, and a "Mark triaged" button (calls the PATCH, optimistic, toast). Untriaged-first.
- On `403`, render "Not authorized" (route is reachable but the API gates it).

## Reachability (G7)

Logged in `docs/qa/beta-reachability.md` under a new `## W7 — Feedback`:

| Surface | Path from `/` | Clicks |
|---|---|---|
| Send feedback (`FeedbackSheet`) | `/` → Topbar bug-button | **1** ✓ |
| Feedback page (`/settings/feedback`) | `/` → Settings → Feedback | **2** ✓ |
| Admin triage (`/admin/feedback`, admins only) | `/` → Settings → Feedback → "View all feedback" | **3** ✓ |

Source-of-truth selectors pinned: `Topbar.tsx` button `aria-label="Send feedback"`; `SettingsSidebar.tsx::SETTINGS_SECTIONS` Feedback slot; routes in `App.tsx`.

## Testing

- **Unit (`api`, vitest):** `feedbackWebhook` — Discord payload shape; retry/backoff on 429/5xx; no-op when env unset; `webhook_delivered_at` set on 2xx (inject mock `fetchImpl`). Zod bounds (0-len rejected, 4001-len rejected, 4000 accepted).
- **Integration (`api/tests/integration/`):**
  - `feedback.test.ts` — POST inserts a row with all stamped fields; async delivery sets `webhook_delivered_at` within 5s against a local mock HTTP receiver (`expect.poll`, 5s); admin GET lists untriaged-first; PATCH sets `triaged_at` idempotently.
  - `contamination/feedback-contamination.test.ts` (**G2**) — using `mkUser()` pair: non-admin bearer → `GET /api/admin/feedback` = `403`; `POST /api/feedback` stamps the authenticated `user_id` (a client cannot write another user's id). Adds 2 routes to the G2 matrix.
- **Playwright smoke (`frontend/playwright/w7-feedback-smoke.spec.ts`):** non-admin context via the W6 `extraHTTPHeaders` bearer-injection pattern submits feedback; asserts the row landed + `webhook_delivered_at` set within 5s (polling a stubbed receiver). Designed to also run against `repos.jpmtech.com` CF Access topology in the pre-cutover prod window (G12 final verification).
- **Gate verification:** `npx tsc --noEmit` + `npm test` green on both `api/` and `frontend/`.

## Gates closed / advanced

- **G12 — closed.** Submission lands ≤5s (integration + smoke); webhook delivery confirmed (durable `webhook_delivered_at` + smoke); triage cadence documented in a new `docs/runbooks/beta-triage.md` (severity tiers + review cadence + how to pull `GET /api/admin/feedback`).
- **G2 — advanced.** +2 routes in the contamination matrix.
- **G7 — advanced.** All three W7 surfaces ≤3 clicks; logged in `beta-reachability.md`.
- **G14 — contributes.** In-app feedback is the documented contact path artifact; G14 fully closes at cutover.

## Out of scope (YAGNI)

Screenshot/image capture, multipart upload, blob storage, `category` taxonomy, full triage board (filters/status columns), email/Mailgun delivery, per-user "my feedback" history, rate-limiting on POST (Beta is N≤10 trusted users; revisit at GA).

## File touch-list (for the plan)

- **New:** `api/src/db/migrations/070_feedback.sql`, `api/src/routes/feedback.ts`, `api/src/routes/adminFeedback.ts`, `api/src/lib/feedbackWebhook.ts`, `api/tests/integration/feedback.test.ts`, `api/tests/integration/contamination/feedback-contamination.test.ts`, `api/tests/unit/feedbackWebhook.test.ts`, `frontend/src/components/feedback/FeedbackSheet.tsx`, `frontend/src/pages/SettingsFeedbackPage.tsx`, `frontend/src/pages/AdminFeedbackPage.tsx`, `frontend/src/lib/api/feedback.ts`, `frontend/playwright/w7-feedback-smoke.spec.ts`, `docs/runbooks/beta-triage.md`.
- **Edit:** `api/src/app.ts` (register routes), `api/src/routes/me.ts` (+`is_admin`), `api/src/bootstrap-guards.ts` (+`FEEDBACK_WEBHOOK_URL`), `docker/Dockerfile` (+`APP_SHA` ARG/ENV), CI build workflow (+`--build-arg`), `frontend/src/components/Icon.tsx` (+`feedback` icon), `frontend/src/components/layout/Topbar.tsx` (+button), `frontend/src/components/settings/SettingsSidebar.tsx` (flip slot), `frontend/src/App.tsx` (routes), `docs/qa/beta-reachability.md` (+W7 section).
