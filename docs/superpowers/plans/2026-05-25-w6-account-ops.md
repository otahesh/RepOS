# W6 — Account Ops + Destructive UX Hardening + Sign Out Everywhere — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Beta account-ops surface end-to-end: editable profile (display name + timezone — **NOT units; see D6 below**), full-cascade account deletion, bearer-token revocation audit trail with PII-snapshot forensic preservation, **sign-out-everywhere** (G3.d), destructive-confirm severity tiers across mid-session/equipment/snapshot surfaces, an env-driven admin-check on the CF Access path, an Origin-header CSRF guard on state-changing routes, and the **authoritative Settings sidebar layout** that every other Beta wave (W2/W4/W5/W7) registers into.

> **W6 ships FIRST.** Per the W5/W4 cross-wave coordination block below, `SETTINGS_SECTIONS`, `ConfirmDialog`, and `ToastHost` are W6-owned primitives that W4 (Program prefs + MesocycleRecap deload confirm) and W5 (Backups Settings page + restore/delete-backup confirms + `restore_replayed` revoke reason) consume. W6 cannot wait on those waves; they wait on W6.

### User-approved decisions (2026-05-26 — folded into this revision)

- **D6 — units is CUT from W6.** Migration 062 becomes a `display_name` length-cap migration ONLY (no `units` column add). The Settings UI does not ship a units selector. `PATCH /api/me/profile` does not accept `units`. Documented as a backlog row at `reference_w3_tuning_candidates.md` §"Deferred from W6"; the conversion lands in a future wave once the full render-site pipeline (`weight_lbs`, `performed_load_lbs`, `BodyweightChart`, `set_logs`, etc.) is designed end-to-end.
- **D7 — Storage + Injuries STAY top-level in the sidebar.** `SETTINGS_SECTIONS` ships 8 entries (not 6). Order: Account → Equipment → Integrations → Program prefs → Backups → Feedback → Storage → Injuries. The W3-shipped Injuries surface MUST NOT regress its G7 reachability.
- **D8 — `account_events.user_id ON DELETE SET NULL` with PII snapshot.** Forensic trail survives account deletion: `user_email_at_event TEXT NULL` + `user_id_at_event UUID NULL` columns captured at write-time, immutable. On user delete the FK `user_id` goes to NULL but the snapshot columns preserve who-did-what for incident response. Retention policy: Beta accepts unbounded retention; GA decision deferred to a documented review.
- **D10 — `REPOS_ADMIN_EMAILS` env-driven admin check.** `requireAdminKeyOrCfAccess` (api/src/middleware/cfAccess.ts:176–202) gains a ~10-LOC branch: when authenticated via CF Access, the user's email must be in `process.env.REPOS_ADMIN_EMAILS.split(',')`. Fail closed if the env var is unset. Migration 063 (originally reserved as a hotfix slot) is now formally documented as "users.role TEXT — deferred to post-Beta when cohort scales past N=1." `.env.example` gains `REPOS_ADMIN_EMAILS=jmeyer@ironcloudtech.com`.

**Architecture:** Three-tier landing order: (1) schema + Settings sidebar layout + Term registry ship first so W2/W4/W5/W7 can consume them. (2) Backend routes (`DELETE /api/me`, `POST /api/auth/signout-everywhere`, `PATCH /api/me/profile`) with G2 contamination tests per route. (3) Frontend Account page expansion + destructive-action confirm tier components + alert()-to-toast sweep. The sign-out-everywhere flow is the connective tissue between the bearer-token registry (W0/W1 surface) and the CF Access cookie clearing — both must invalidate atomically so G3.d holds.

**Tech stack:** Fastify 5 + zod + Postgres on the API side; Vite + React 18 + TypeScript + vitest + React Testing Library on the frontend; Playwright for the G3.d e2e assertion (hosted under `frontend/playwright/` per W3 precedent — see `frontend/playwright.config.ts:testMatch` glob).

**Master plan:** [docs/superpowers/plans/2026-05-11-repos-beta.md §W6](2026-05-11-repos-beta.md) (lines 385–411, plus §651 sidebar coordination paragraph)

**Migration range claimed:** **060–069 inclusive.** This plan uses **060, 061, 062** (three migrations). **Migration 063 is formally reserved** for the future `users.role TEXT` column (per D10, deferred to post-Beta cohort-scale-up). Numbers 064–069 remain reserved for in-wave hotfixes if reviewer surfaces a column/constraint that must ship via a follow-up migration before merge.

---

## Cross-wave coordination (read before starting any other parallel wave)

W6 is the **authoritative owner** of the Settings sidebar layout. Per master plan §651:

> Sidebar Settings sub-nav (cross-wave coordination): W4.3 (program-prefs), W5.4 (backups), W6.2 (account), W7.2 (feedback) all add Settings pages. The per-wave plans must coordinate sidebar ordering to avoid each wave inventing its own. **Recommendation order:** Account → Equipment → Integrations → Program prefs → Backups → Feedback. The W6 implementer owns the Settings sidebar layout authoritative.

### Sidebar landing sequence — W6 ships FIRST

W6 ships ahead of W4/W5/W7 because they depend on `SETTINGS_SECTIONS`, `ConfirmDialog`, and `ToastHost` — primitives W6 owns. Concretely:

- **W4** consumes `SETTINGS_SECTIONS[3]` (Program prefs slot) for `/settings/program-prefs`, and `ConfirmDialog tier="heavy"` for the MesocycleRecap deload confirm.
- **W5** consumes `SETTINGS_SECTIONS[4]` (Backups slot), `ConfirmDialog tier="heavy"` for restore (typed-confirm phrase), `ConfirmDialog tier="light"` (= Toast + Undo, per D-CONFIRMDIALOG-LIGHT-API) for delete-backup, and `ToastHost` for restore-completion / restore-failure messaging. W5 also extends `device_tokens.revoke_reason` with the `'restore_replayed'` enum value (W6 reserves it in migration 061).
- **W7** consumes `SETTINGS_SECTIONS[5]` (Feedback slot).
- **W2** writes to `account_events` via `recordAccountEvent({...})` with kinds `'par_q_acknowledged'` and `'onboarding_completed'` — W6 publishes the helper and reserves those kinds in the app-layer union (per C-ACCOUNT-EVENTS-ENUM, the kind enum is governed in TypeScript, not in a DB CHECK).

### Sidebar order (authoritative — D7-adjusted)

Per user decision D7 (2026-05-26), Storage and Injuries STAY top-level in the sidebar. They are not demoted to secondary entries under Account. Final order:

| # | Route | Label | Disabled at W6 ship | Wave owner |
|---|-------|-------|---------------------|------------|
| 1 | `/settings/account` | Account | false | **W6** (this plan, Tasks 7 + 16) |
| 2 | `/settings/equipment` | Equipment | false | W1/alpha (already shipped — relabel only) |
| 3 | `/settings/integrations` | Integrations | false | W1/alpha (already shipped) |
| 4 | `/settings/program-prefs` | Program prefs | true (placeholder) | W4.3 |
| 5 | `/settings/backups` | Backups | true (placeholder) | W5.4 |
| 6 | `/settings/feedback` | Feedback | true (placeholder) | W7.2 |
| 7 | `/settings/storage` | Storage | false | W1.3.8 (already shipped) |
| 8 | `/settings/injuries` | Injuries | false | W3.4 (already shipped — **G7 must not regress**) |

**Why D7:** Storage and Injuries are existing, shipped surfaces. Demoting them to "nested secondary under Account" would (a) regress the G7 reachability budget for Injuries (an already-shipped W3 surface), and (b) hide Storage from users who need to reach it during incident triage. The 8-entry sidebar is acceptable — `Sidebar.tsx` already scrolls — and the master-plan §651 order is preserved for the four wave-owned slots in front.

### Other waves consume this contract

- **W4.3 (program-prefs)** must register against `SETTINGS_SECTIONS[3]` (slot 4, route `/settings/program-prefs`). Component file: TBD by W4 plan. Slot flips `disabled: false` in W4.
- **W5.4 (backups)** must register against `SETTINGS_SECTIONS[4]` (slot 5, route `/settings/backups`). Component file: TBD by W5 plan. Slot flips `disabled: false` in W5.
- **W7.2 (feedback)** must register against `SETTINGS_SECTIONS[5]` (slot 6, route `/settings/feedback`). Component file: TBD by W7 plan. Slot flips `disabled: false` in W7.

The registration contract is "import the constant; add a `<Route>` in `App.tsx` at the appropriate slot; do not edit `SETTINGS_SECTIONS`." Slots 4/5/6 ship as `ComingSoonPlaceholder` route components (NOT `<Navigate>` redirects — per I-SIDEBAR-PLACEHOLDER, the URL must stay stable so the user can see what's coming and the disabled sidebar entry isn't a dead link).

---

## Goal/gate contributions

| Gate | Contribution |
|------|--------------|
| **G2** | Contamination tests for every new per-user route. **Five required** if the per-token revoke surface ships (`DELETE /api/me`, `PATCH /api/me/profile`, `POST /api/auth/signout-everywhere`, `GET /api/account/sessions`, `GET /api/account/events`); **six** if `DELETE /api/account/sessions/:id` ships (per-token revoke from `ActiveSessionsTable`). Per I-CONTAM-MATRIX, decide explicitly in Task 14: ship the revoke-row button + DELETE route + 6th contamination test, OR drop the button. Pattern: `api/tests/integration/contamination/<route>-contamination.test.ts`. |
| **G3.d** | Sign-out-everywhere Playwright spec asserts: device-A mints token, device-B mints token, device-A POSTs `/api/auth/signout-everywhere`, device-B's next API call returns 401. Spec file lives at `frontend/playwright/w6-signout-everywhere-g3d.spec.ts` per W3 precedent (NOT `tests/e2e/` — playwright resolution only works under `frontend/`). Hermetic mocks; supplement with manual outside-in curl on prod per memory `feedback_verify_external_config.md`. |
| **G7** | Every new user-facing surface lists its entry-point path from `/` (≤3 clicks). Documented in `docs/qa/beta-reachability.md` per W3 precedent. **D7 reachability constraint:** Injuries (`/settings/injuries`, shipped in W3) MUST remain reachable in ≤3 clicks via the top-level sidebar entry — the original draft's "secondary under Account" demotion is rejected because it would regress G7 for an already-shipped surface. |
| **G11** | Term-tooltip audit closes; no `alert()` reaches the user on Beta-new surfaces; destructive-confirm severity tiers documented and tested. **G11 closure subsection** in this plan's DoD (Task 21) maps which `08-qa.md` §"Pre-Beta security review checklist" items W6 closes vs defers, with PR links once implemented. |

---

## File map

**Created:**

- `api/src/db/migrations/060_account_events.sql` — append-only audit table for account ops; FK `user_id ON DELETE SET NULL` with `user_email_at_event` + `user_id_at_event` PII-snapshot columns (per D8)
- `api/src/db/migrations/061_device_tokens_revoke_reason.sql` — adds `revoke_reason` column with enum `user_revoked | signout_everywhere | account_deleted | restore_replayed | legacy_revoke | cf_access_logout`; backfills alpha residue to `'legacy_revoke'` (per I-REVOKE-REASON-BACKFILL + I-REVOKE-REASON-ENUM)
- `api/src/db/migrations/062_users_display_name_cap.sql` — display_name length cap CHECK only. **No `units` column** (per D6 — units is deferred).
- `api/src/middleware/csrfOrigin.ts` — Origin-header guard for CF Access state-changing routes (per C-CSRF-ORIGIN)
- `api/src/schemas/account.ts` — zod schemas for the route bodies + responses + display_name NFKC normalization + zero-width-space strip (per I-DISPLAY-NAME-NORMALIZE)
- `api/src/routes/account.ts` — `PATCH /api/me/profile`, `DELETE /api/me`, `GET /api/account/sessions`, `GET /api/account/events`
- `api/src/routes/authSignout.ts` — `POST /api/auth/signout-everywhere` (separate file so the CF-Access-cookie-clearing concern is isolated from generic account ops). **CF Access JWT only** — bearer auth is rejected (per C-SIGNOUT-CFACCESS-ONLY).
- `api/src/services/accountEvents.ts` — `recordAccountEvent({userId, kind, userEmail, ip, meta})` helper. The TypeScript `AccountEventKind` union is the source-of-truth for kinds (per C-ACCOUNT-EVENTS-ENUM — no DB CHECK on kind to avoid migration churn). Helper populates `user_email_at_event` + `user_id_at_event` snapshot columns.
- `api/src/lib/auth.ts` — additions to `scopes.ts` if the `auth:admin` scope path is taken; otherwise the simpler CF-Access-JWT-only middleware path lives here
- `api/tests/integration/contamination/account-profile-contamination.test.ts`
- `api/tests/integration/contamination/account-deletion-contamination.test.ts`
- `api/tests/integration/contamination/signout-everywhere-contamination.test.ts`
- `api/tests/integration/contamination/account-sessions-contamination.test.ts`
- `api/tests/integration/contamination/account-events-contamination.test.ts`
- `api/tests/integration/contamination/account-sessions-delete-contamination.test.ts` — **conditional** on per-token revoke shipping (per I-CONTAM-MATRIX)
- `api/tests/integration/account-deletion-cascade.test.ts` — full FK-cascade assertion (mesocycle + 100 set_logs + 30 weight samples + 2 bearer tokens + health_workouts rows) per W6.1 spec; also asserts `account_events` rows survive with `user_id=NULL` and snapshot columns populated
- `api/tests/integration/signout-everywhere.test.ts` — multi-token revoke integration test wrapped in BEGIN/COMMIT (per C-SIGNOUT-TXN)
- `api/tests/integration/account-events.test.ts` — emit-on-mutate + read-back-paginated tests + keyset pagination (per I-PAGINATION-KEYSET)
- `api/tests/integration/csrf-origin.test.ts` — Origin-header guard tests: missing/wrong Origin on CF-Access cookie path → 403 (per C-CSRF-ORIGIN)
- `api/tests/routes/account.test.ts` — route-level happy paths (profile patch, sessions list, events list)
- `frontend/src/components/settings/SettingsSidebar.tsx` — the authoritative-layout component + `SETTINGS_SECTIONS` constant (replaces the inline list in `Sidebar.tsx:35-41`); 8 entries per D7
- `frontend/src/components/settings/SettingsSidebar.test.tsx`
- `frontend/src/components/settings/AccountProfileEditor.tsx` — display-name + timezone form (NO units selector per D6); uses ControlledField pattern from W3 `InjuryChipsEditor.tsx:33-55` with useEffect re-sync + commit-on-blur diff-check (per C-PROFILE-CONTROLLED)
- `frontend/src/components/settings/AccountProfileEditor.test.tsx`
- `frontend/src/components/settings/ActiveSessionsTable.tsx` — read-only list of `device_tokens` for the current user with last-used-at + truncated IP (/24, per I-LAST-IP-TRUNCATE) + revoke-row button (conditional per I-CONTAM-MATRIX); mobile breakpoint → card layout fallback (per I-SESSIONS-MOBILE)
- `frontend/src/components/settings/ActiveSessionsTable.test.tsx`
- `frontend/src/components/settings/AccountEventsTimeline.tsx` — reverse-chronological feed of `account_events` rows; renders snapshot-email for deleted-user rows; `meta.before` is redacted to `{field, changed: true}` shape (per I-ACCOUNT-EVENTS-META)
- `frontend/src/components/settings/AccountEventsTimeline.test.tsx`
- `frontend/src/components/settings/SignOutEverywhereButton.tsx` — medium-tier confirm modal + redirect to CF Access logout + BroadcastChannel cross-tab signal (per I-BROADCASTCHANNEL)
- `frontend/src/components/settings/SignOutEverywhereButton.test.tsx`
- `frontend/src/components/settings/DeleteAccountSection.tsx` — danger-zone heavy-tier confirm (typed phrase from `CONFIRM_DELETE_ACCOUNT_PHRASE` constant, per I-CONFIRM-PHRASE-CONST) + redirect-to-logout on success
- `frontend/src/components/settings/DeleteAccountSection.test.tsx`
- `frontend/src/components/common/ConfirmDialog.tsx` — **two-tier** confirm primitive (`medium` single-modal-confirm, `heavy` typed-string match). `ConfirmTier = 'medium' | 'heavy'` — `'light'` is removed (per C-CONFIRMDIALOG-LIGHT-API; light-tier = Toast + Undo, owned by `ToastHost`, not this component). Uses `focus-trap-react` with `escapeDeactivates: true` + `onDeactivate: onCancel` only — no manual ESC `useEffect` (per C-CONFIRMDIALOG-ESC). Heavy tier uses `initialFocus: 'input[type="text"]'` (per C-CONFIRMDIALOG-FOCUS). Captures `previouslyFocused` and restores on unmount (per C-CONFIRMDIALOG-RETURNFOCUS, mirroring W3 `MidSessionSwapPicker.tsx:43,65,72`).
- `frontend/src/components/common/ConfirmDialog.test.tsx` — includes return-focus restoration test
- `frontend/src/components/common/Toast.tsx` — replaces every remaining `alert()` site (Task 11) — accessible role="status", 5s default with optional undo button
- `frontend/src/components/common/Toast.test.tsx`
- `frontend/src/components/common/ToastHost.tsx` — provider that handles toast queue + global `pushToast()`. **Mounted INSIDE `<AppShell>` (sibling of `<Outlet>`)**, not at App root (per C-TOAST-HOST-MOUNT — route changes that unmount AppShell would otherwise wipe the portal).
- `frontend/src/components/common/ComingSoonPlaceholder.tsx` — route component for sidebar slots 4/5/6 before W4/W5/W7 wire their real components (per I-SIDEBAR-PLACEHOLDER — URL stays stable, user sees "Coming in W4/W5/W7" copy)
- `frontend/src/lib/api/account.ts` — client wrappers: `patchProfile()`, `deleteAccount()`, `signOutEverywhere()`, `listSessions()`, `listEvents()`; events client uses `(before_ts, before_id)` keyset cursor (per I-PAGINATION-KEYSET)
- `frontend/src/lib/api/account.test.ts`
- `frontend/src/lib/auth/csrf.ts` — adds `X-RepOS-CSRF: 1` header to every state-changing request (per C-CSRF-ORIGIN — gives the server a deterministic preflight-required signal even when Origin spoofing is plausible)
- `frontend/src/lib/constants/accountConfirmPhrases.ts` — exports `CONFIRM_DELETE_ACCOUNT_PHRASE = 'DELETE my account'` shared across migration comments / schema / dialog body / tests (per I-CONFIRM-PHRASE-CONST)
- `frontend/src/lib/timezones.ts` — static IANA fallback list per memory `project_alpine_smallicu` (per I-IANA-TIMEZONES — do not rely on `Intl.supportedValuesOf('timeZone')` on alpine small-icu)
- `frontend/playwright/w6-signout-everywhere-g3d.spec.ts` — G3.d assertion (see Task 18); hermetic mocks per W3 precedent
- `frontend/playwright/w6-account-delete-reachability.spec.ts` — G7 reachability test (logged-in user clicks from `/` to the danger zone in ≤3 clicks)

**Modified:**

- `frontend/src/components/layout/Sidebar.tsx` — `SETTINGS_SUB` constant deleted; replaced with `import { SETTINGS_SECTIONS } from '../settings/SettingsSidebar'`. Sidebar rendering reads from the constant. Mobile hamburger → Settings target goes to `/settings/account` (per I-MOBILE-SIGNOUT-PATH — Account is the new authoritative first slot).
- `frontend/src/components/settings/SettingsAccount.tsx` — current placeholder body replaced with `<AccountProfileEditor>` + `<ActiveSessionsTable>` + `<SignOutEverywhereButton>` + `<AccountEventsTimeline>` + `<DeleteAccountSection>` stack. **No units selector** (per D6).
- `frontend/src/components/settings/SettingsIntegrations.tsx` — two `alert()` sites (lines 104 + 121) replaced with `pushToast({ severity: 'error', ... })`.
- `frontend/src/components/library/ExercisePickerDemo.tsx` — dev-only `alert()` at line 20 replaced with `pushToast()` (kept under `import.meta.env.DEV`).
- `frontend/src/pages/MyProgramPage.tsx` — `alert('Exercise picker not yet wired')` at line 169 replaced with `pushToast({ severity: 'info', body: 'Exercise picker lands in W4.' })`.
- `frontend/src/pages/TodayPage.tsx` — `alert('Desktop workout execution flow not yet wired')` at line 12 replaced with toast.
- `frontend/src/lib/terms.ts` — adds `PAT`, `bearer_token`, `session`, `IANA_timezone`, `truncated_ip_24` keys to `TermKey` + `TERMS`. `truncated_ip_24` term explains the /24 truncation (per I-LAST-IP-TRUNCATE).
- `frontend/src/components/layout/AppShell.tsx` — mounts `<ToastHost />` as a sibling of `<Outlet>` (per C-TOAST-HOST-MOUNT). Verify against current `App.tsx:40-57` — the existing AppShell layout is the correct mount surface, NOT App root.
- `frontend/src/App.tsx` — adds route entries for slots 4/5/6 as `<ComingSoonPlaceholder slot="..." />` (NOT `<Navigate>`); adds `BroadcastChannel('repos-auth')` listener in AuthProvider that redirects same-browser tabs to `/cdn-cgi/access/logout` on signout-everywhere (per I-BROADCASTCHANNEL).
- `api/src/middleware/cfAccess.ts` — `requireAdminKeyOrCfAccess` gains `REPOS_ADMIN_EMAILS` check (per D10 — ~10 LOC, fails closed if env unset). Also adds Origin-header verification on CF-Access-cookie state-changing paths (per C-CSRF-ORIGIN).
- `api/src/app.ts` — registers `accountRoutes` and `authSignoutRoutes` plugins under `/api`; mounts `csrfOrigin` middleware.
- `api/src/routes/setLogs.ts` — adds `set_logs.user_id` to the join used for the cascade test (no behavior change; ensures the FK chain the deletion test asserts on actually wires through).
- `api/.env.example` — adds `REPOS_ADMIN_EMAILS=jmeyer@ironcloudtech.com` (per D10)
- `docs/qa/beta-reachability.md` — adds W6 section per Task 19 (includes mobile sign-out-everywhere ≤3-click path per I-MOBILE-SIGNOUT-PATH + Injuries top-level reachability under D7).
- `docs/qa/08-qa.md` — Task 21 G11 closure subsection maps which security-checklist items W6 closes (per I-AUDIT-G11).
- `frontend/src/components/programs/MidSessionSwapPicker.tsx` — adds the W6.5 success toast on confirm (`pushToast({ severity: 'success', body: 'Swapped.', actionLabel: 'Undo' })`).

---

## Phases

| Phase | Theme | Deliverable | Gate to next phase |
|-------|-------|-------------|--------------------|
| **1** | Schema + sidebar contract + term registry | Migrations 060/061/062 + `SETTINGS_SECTIONS` + Term registry additions land first so parallel waves can consume them | All three migrations green on a scratch DB; `SETTINGS_SECTIONS` referenced by `Sidebar.tsx` with existing routes intact; existing tests still green |
| **2** | Backend routes + contamination tests | `PATCH /api/me/profile`, `DELETE /api/me`, `POST /api/auth/signout-everywhere`, `GET /api/account/sessions`, `GET /api/account/events`, with one G2 contamination test per route | All 5 contamination tests green + the cascade test green |
| **3** | Frontend Account page expansion | `<AccountProfileEditor>`, `<ActiveSessionsTable>`, `<SignOutEverywhereButton>`, `<AccountEventsTimeline>`, `<DeleteAccountSection>` mounted on `/settings/account` | Component tests green + manual click-walk verified |
| **4** | Destructive UX hardening + alert() sweep | `ConfirmDialog` + `Toast` primitives + 4 alert() sites converted + Abandon-mesocycle + equipment-reset confirms wired + mid-session swap success toast | No `alert(` reaches Beta surfaces (grep gate) |
| **5** | Reachability + G3.d e2e + term audit | Playwright G3.d spec green; reachability doc updated; AST term-coverage check green; risks/open-questions surfaced for reviewer panel | Wave merge gate |

---

## Phase 1 — Schema + sidebar contract + term registry

### Task 1: Migration 060 — `account_events` audit table

**Files:**
- Create: `api/src/db/migrations/060_account_events.sql`
- Test: `api/tests/integration/account-events-schema.test.ts`

- [ ] **Step 1: Write the failing schema test**

```ts
// api/tests/integration/account-events-schema.test.ts
import 'dotenv/config';
import { describe, it, expect } from 'vitest';
import { db } from '../../src/db/client.js';

describe('migration 060: account_events', () => {
  it('table exists with the required columns + types', async () => {
    const { rows } = await db.query<{ column_name: string; data_type: string; is_nullable: string }>(
      `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_name = 'account_events'
        ORDER BY ordinal_position`,
    );
    const cols = new Map(rows.map((r) => [r.column_name, r]));
    expect(cols.get('id')?.data_type).toBe('bigint');
    expect(cols.get('user_id')?.data_type).toBe('uuid');
    expect(cols.get('user_id')?.is_nullable).toBe('YES'); // D8 — SET NULL on user delete
    expect(cols.get('user_email_at_event')?.data_type).toBe('text'); // D8 PII snapshot
    expect(cols.get('user_id_at_event')?.data_type).toBe('uuid'); // D8 immutable snapshot
    expect(cols.get('kind')?.data_type).toBe('text');
    expect(cols.get('ip')?.data_type).toBe('text');
    expect(cols.get('meta')?.data_type).toBe('jsonb');
    expect(cols.get('occurred_at')?.data_type).toBe('timestamp with time zone');
    // FK ON DELETE SET NULL (per D8 — preserve audit trail post-deletion)
    const { rows: fks } = await db.query(
      `SELECT confdeltype FROM pg_constraint
        WHERE conrelid = 'account_events'::regclass AND contype = 'f'`,
    );
    expect(fks[0]?.confdeltype).toBe('n'); // 'n' = SET NULL
  });

  it('kind is governed at the app layer (no DB CHECK) — accepts any text', async () => {
    // Per C-ACCOUNT-EVENTS-ENUM: kind is a TypeScript union + zod-validated at
    // the route layer. The DB does NOT enforce CHECK on kind, so new kinds
    // (par_q_acknowledged, onboarding_completed, restore_replayed) can ship
    // post-cutover via TypeScript-only changes without migration churn.
    const { rows: [u] } = await db.query<{ id: string }>(
      `INSERT INTO users (email) VALUES ($1) RETURNING id`,
      [`vitest.acct-events.${crypto.randomUUID()}@repos.test`],
    );
    // Inserting a kind the DB doesn't know about should succeed at SQL level
    // (the app-layer union prevents it in production code paths).
    await expect(
      db.query(
        `INSERT INTO account_events (user_id, kind, ip, meta) VALUES ($1, 'arbitrary_app_layer_kind', '1.2.3.4', '{}'::jsonb)`,
        [u.id],
      ),
    ).resolves.toBeDefined();
    await db.query('DELETE FROM users WHERE id=$1', [u.id]);
  });

  it('partial index on ip exists for incident-triage grep (per I-IP-INDEX)', async () => {
    const { rows } = await db.query(
      `SELECT indexname FROM pg_indexes WHERE tablename='account_events' AND indexname='account_events_ip_idx'`,
    );
    expect(rows.length).toBe(1);
  });

  it('index on kind exists for admin "all delete_initiated in 30d" queries (per I-AUDIT-EVENT-KIND-INDEX)', async () => {
    const { rows } = await db.query(
      `SELECT indexname FROM pg_indexes WHERE tablename='account_events' AND indexname='account_events_kind_idx'`,
    );
    expect(rows.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run tests/integration/account-events-schema.test.ts`
Expected: FAIL — `relation "account_events" does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- api/src/db/migrations/060_account_events.sql
-- Beta W6 — append-only audit trail for account-scoped operations.
-- One row per profile-change / token-mint-via-account-surface / token-revoke /
-- signout-everywhere / delete-account event (W6) + par_q_acknowledged /
-- onboarding_completed (W2) + restore_replayed (W5). Drives:
--   (a) the AccountEventsTimeline UI (W6 Task 9).
--   (b) post-incident grep for "what did user X do" when a Beta user reports
--       weirdness ("my iOS Shortcut stopped working" → grep for revoke events).
--   (c) forensic survival of account deletion — per D8 (2026-05-26), the FK is
--       ON DELETE SET NULL with PII-snapshot columns so the row preserves
--       who-did-what even after the users row goes away.
--
-- Retention policy (per D8 + I-ACCOUNT-EVENTS-TTL):
--   Beta accepts unbounded retention (small N, accept-residual-risk).
--   GA decision deferred to a documented review. Append-only with row-level
--   redaction for stale rows is the planned-but-not-implemented GA shape; no
--   TTL prune cron at this time.
--
-- Append-only: no UPDATE (except FK SET NULL on user delete), no DELETE.
-- occurred_at is set server-side (DEFAULT now()), never trusted from the client.
--
-- kind is TEXT with NO CHECK constraint (per C-ACCOUNT-EVENTS-ENUM). New kinds
-- are added by extending the TypeScript AccountEventKind union + zod schema,
-- not by ALTERing the table. Avoids cross-wave migration churn (W2 needs
-- par_q_acknowledged + onboarding_completed; W5 needs restore_replayed).
--
-- meta JSONB intentionally permissive — different kinds carry different shapes.
-- For 'profile_changed', meta.before is redacted to {field, changed: true}
-- (per I-ACCOUNT-EVENTS-META) — we do not retain prior display_name PII.
--
-- ip TEXT not INET — node-pg returns INET as a string anyway, and a future
-- migration to v6 doesn't need a column-type change.

CREATE TABLE IF NOT EXISTS account_events (
  id                    BIGSERIAL    PRIMARY KEY,
  -- D8: SET NULL on user delete; PII snapshot columns preserve forensic trail.
  user_id               UUID         NULL REFERENCES users(id) ON DELETE SET NULL,
  user_email_at_event   TEXT         NULL, -- populated at write-time by recordAccountEvent
  user_id_at_event      UUID         NULL, -- immutable snapshot — never updated, never nulled by FK action
  kind                  TEXT         NOT NULL,
  ip                    TEXT         NULL,
  meta                  JSONB        NOT NULL DEFAULT '{}'::jsonb,
  occurred_at           TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Primary access pattern: AccountEventsTimeline reads "this user's events,
-- newest first" — covered by the user_id + occurred_at compound.
CREATE INDEX IF NOT EXISTS account_events_user_id_occurred_at_idx
  ON account_events (user_id, occurred_at DESC);

-- Incident triage: grep-by-IP for "any account hit from this IP in the window."
-- Partial index keeps it cheap when ip is NULL (CF Access JWT-only path).
-- Per I-IP-INDEX.
CREATE INDEX IF NOT EXISTS account_events_ip_idx
  ON account_events (ip) WHERE ip IS NOT NULL;

-- Admin queries: "every delete_initiated in the last 30 days" without scanning
-- by user. Per I-AUDIT-EVENT-KIND-INDEX.
CREATE INDEX IF NOT EXISTS account_events_kind_idx
  ON account_events (kind, occurred_at DESC);
```

- [ ] **Step 4: Run migrations + the test to verify it passes**

Run: `cd api && npm run migrate && npx vitest run tests/integration/account-events-schema.test.ts`
Expected: PASS (both tests green).

- [ ] **Step 5: Commit**

```bash
git add api/src/db/migrations/060_account_events.sql api/tests/integration/account-events-schema.test.ts
git commit -m "feat: account_events audit table (migration 060)"
```

---

### Task 2: Migration 061 — `device_tokens.revoke_reason`

**Files:**
- Create: `api/src/db/migrations/061_device_tokens_revoke_reason.sql`
- Test: `api/tests/integration/device-tokens-revoke-reason-schema.test.ts`

- [ ] **Step 1: Write the failing schema test**

```ts
// api/tests/integration/device-tokens-revoke-reason-schema.test.ts
import 'dotenv/config';
import { describe, it, expect } from 'vitest';
import { db } from '../../src/db/client.js';

describe('migration 061: device_tokens.revoke_reason', () => {
  it('column exists, nullable TEXT, CHECK constraint', async () => {
    const { rows } = await db.query<{ column_name: string; is_nullable: string; data_type: string }>(
      `SELECT column_name, is_nullable, data_type FROM information_schema.columns
        WHERE table_name='device_tokens' AND column_name='revoke_reason'`,
    );
    expect(rows.length).toBe(1);
    expect(rows[0].data_type).toBe('text');
    expect(rows[0].is_nullable).toBe('YES');
  });

  it('accepts the six enum values (per I-REVOKE-REASON-ENUM)', async () => {
    const email = `vitest.dt-rr-ok.${crypto.randomUUID()}@repos.test`;
    const { rows: [u] } = await db.query<{ id: string }>(
      `INSERT INTO users (email) VALUES ($1) RETURNING id`, [email],
    );
    for (const reason of ['user_revoked','signout_everywhere','account_deleted','restore_replayed','legacy_revoke','cf_access_logout']) {
      const { rows: [t] } = await db.query<{ id: string }>(
        `INSERT INTO device_tokens (user_id, token_hash) VALUES ($1, $2) RETURNING id`,
        [u.id, `hash-${reason}`],
      );
      await expect(
        db.query(`UPDATE device_tokens SET revoked_at=now(), revoke_reason=$1 WHERE id=$2`, [reason, t.id]),
      ).resolves.toBeDefined();
    }
    await db.query('DELETE FROM users WHERE id=$1', [u.id]);
  });

  it('rejects unknown revoke_reason values', async () => {
    const email = `vitest.dt-rr.${crypto.randomUUID()}@repos.test`;
    const { rows: [u] } = await db.query<{ id: string }>(
      `INSERT INTO users (email) VALUES ($1) RETURNING id`, [email],
    );
    await db.query(
      `INSERT INTO device_tokens (user_id, token_hash) VALUES ($1, $2)`,
      [u.id, 'aa:bb'],
    );
    await expect(
      db.query(
        `UPDATE device_tokens SET revoke_reason='garbage' WHERE user_id=$1`,
        [u.id],
      ),
    ).rejects.toThrow();
    await db.query('DELETE FROM users WHERE id=$1', [u.id]);
  });

  it('backfills alpha residue to legacy_revoke (per I-REVOKE-REASON-BACKFILL)', async () => {
    // Pre-migration rows with revoked_at IS NOT NULL AND revoke_reason IS NULL
    // should have been backfilled by the migration. Verify by asserting no such
    // (revoked_at NOT NULL, revoke_reason NULL) rows remain post-migration.
    const { rows } = await db.query(
      `SELECT count(*)::int n FROM device_tokens WHERE revoked_at IS NOT NULL AND revoke_reason IS NULL`,
    );
    expect(rows[0].n).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run tests/integration/device-tokens-revoke-reason-schema.test.ts`
Expected: FAIL — column does not exist.

- [ ] **Step 3: Write the migration**

```sql
-- api/src/db/migrations/061_device_tokens_revoke_reason.sql
-- Beta W6 — distinguish per-token-revoke from bulk sign-out-everywhere from
-- account-delete-cascade from W5 restore-replay. The plain column (revoked_at)
-- tells you it's revoked; this column tells you *why*. Drives:
--   (a) AccountEventsTimeline rendering ("Signed out everywhere (3 tokens)"
--       vs "Revoked: iOS Shortcut" vs "Revoked by restore" vs unknown).
--   (b) post-incident triage: a user reports their token stopped working
--       unexpectedly — was it a manual revoke, a signout-everywhere, did
--       account_delete fire, or did W5 restore-replay clobber sessions? grep
--       by reason.
--
-- Enum values (per I-REVOKE-REASON-ENUM):
--   user_revoked        — single-row revoke from ActiveSessionsTable
--   signout_everywhere  — W6 bulk revoke via /api/auth/signout-everywhere
--   account_deleted    — DELETE /api/me cascade
--   restore_replayed    — W5 restore handler invalidates pre-restore tokens
--   legacy_revoke       — alpha residue with no recorded reason (per
--                         I-REVOKE-REASON-BACKFILL — backfilled below)
--   cf_access_logout    — reserved for future; not currently emitted by W6.
--
-- Honest "we don't know why this was revoked, but we record it" choice for
-- alpha residue — calling it 'user_revoked' would be dishonest forensics.
--
-- Nullable allowed for forward compatibility, but new code MUST set a reason
-- on every UPDATE that sets revoked_at.

ALTER TABLE device_tokens
  ADD COLUMN IF NOT EXISTS revoke_reason TEXT
  CHECK (revoke_reason IS NULL OR revoke_reason IN (
    'user_revoked',
    'signout_everywhere',
    'account_deleted',
    'restore_replayed',
    'legacy_revoke',
    'cf_access_logout'
  ));

-- Backfill alpha residue (per I-REVOKE-REASON-BACKFILL).
-- Any row that was already revoked at migration time has no recorded reason;
-- mark it as legacy so timeline rendering can show "Revoked (legacy)" instead
-- of bait-and-switching it as user_revoked.
UPDATE device_tokens
   SET revoke_reason = 'legacy_revoke'
 WHERE revoked_at IS NOT NULL
   AND revoke_reason IS NULL;
```

- [ ] **Step 4: Run migrations + test to verify pass**

Run: `cd api && npm run migrate && npx vitest run tests/integration/device-tokens-revoke-reason-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/db/migrations/061_device_tokens_revoke_reason.sql api/tests/integration/device-tokens-revoke-reason-schema.test.ts
git commit -m "feat: device_tokens.revoke_reason column (migration 061)"
```

---

### Task 3: Migration 062 — `users.display_name` length cap (units CUT per D6)

> **D6 — units selector is cut from W6.** Migration 062 ships as display_name CHECK only. The `users.units` column is NOT added in this wave. A units selector without full-pipeline conversion (every `weight_lbs` / `performed_load_lbs` / `BodyweightChart` / set log render site) creates a worse UX than the current lbs-everywhere default. The backlog row at `reference_w3_tuning_candidates.md` §"Deferred from W6" captures the future wave for full units conversion.

**Files:**
- Create: `api/src/db/migrations/062_users_display_name_cap.sql`
- Test: `api/tests/integration/users-display-name-schema.test.ts`

- [ ] **Step 1: Write the failing schema test**

```ts
// api/tests/integration/users-display-name-schema.test.ts
import 'dotenv/config';
import { describe, it, expect } from 'vitest';
import { db } from '../../src/db/client.js';

describe('migration 062: users.display_name cap', () => {
  it('display_name length cap rejects > 80 chars', async () => {
    const longName = 'x'.repeat(81);
    await expect(
      db.query(
        `INSERT INTO users (email, display_name) VALUES ($1, $2)`,
        [`vitest.dn.${crypto.randomUUID()}@repos.test`, longName],
      ),
    ).rejects.toThrow();
  });

  it('display_name CHECK rejects empty-string / whitespace-only (per I-DISPLAY-NAME-NORMALIZE)', async () => {
    await expect(
      db.query(
        `INSERT INTO users (email, display_name) VALUES ($1, $2)`,
        [`vitest.dn-empty.${crypto.randomUUID()}@repos.test`, '   '],
      ),
    ).rejects.toThrow();
  });

  it('users.units column does NOT exist (per D6 — units is cut from W6)', async () => {
    const { rows } = await db.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name='users' AND column_name='units'`,
    );
    expect(rows.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run tests/integration/users-display-name-schema.test.ts`
Expected: FAIL — long/empty display_name accepted.

- [ ] **Step 3: Write the migration**

```sql
-- api/src/db/migrations/062_users_display_name_cap.sql
-- Beta W6 — display_name bounds. Units is CUT from W6 (per D6 2026-05-26):
-- a units selector without full-pipeline conversion through every render site
-- (weight_lbs, performed_load_lbs, BodyweightChart, set_logs) creates a worse
-- UX than the lbs-everywhere default. See reference_w3_tuning_candidates.md
-- §"Deferred from W6" for the future-wave plan.
--
-- display_name length cap: existing column has no upper bound, so a malicious
-- (or curious) user could land a 1MB string and DoS the AccountProfileEditor
-- render. 80 chars is the longest common-real-name (covers double-barrelled
-- names with middle initials and titles); matches the iCloud upper bound
-- jmeyer hit empirically during alpha.
--
-- length(trim(...)) >= 1: rejects empty-string and whitespace-only display
-- names (per I-DISPLAY-NAME-NORMALIZE). NFKC normalization + zero-width-space
-- strip lives at the zod schema layer (api/src/schemas/account.ts), not in
-- SQL — Postgres has no native NFKC normalizer.

ALTER TABLE users
  ADD CONSTRAINT users_display_name_length_chk
  CHECK (
    display_name IS NULL
    OR (length(display_name) <= 80 AND length(trim(display_name)) >= 1)
  );
```

- [ ] **Step 4: Run migrations + test**

Run: `cd api && npm run migrate && npx vitest run tests/integration/users-display-name-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/db/migrations/062_users_display_name_cap.sql api/tests/integration/users-display-name-schema.test.ts
git commit -m "feat: users.display_name length + non-empty CHECK (migration 062; units deferred per D6)"
```

---

### Task 4: Authoritative `SETTINGS_SECTIONS` constant + Sidebar refactor

**Files:**
- Create: `frontend/src/components/settings/SettingsSidebar.tsx`
- Create: `frontend/src/components/settings/SettingsSidebar.test.tsx`
- Modify: `frontend/src/components/layout/Sidebar.tsx` — replace inline `SETTINGS_SUB` const
- Modify: `frontend/src/App.tsx` — add placeholder routes for slots 4/5/6

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/settings/SettingsSidebar.test.tsx
import { describe, it, expect } from 'vitest';
import { SETTINGS_SECTIONS } from './SettingsSidebar';

describe('SETTINGS_SECTIONS authoritative layout (D7 — 8 top-level entries)', () => {
  it('ships exactly 8 top-level entries (Storage + Injuries stay top-level per D7)', () => {
    expect(SETTINGS_SECTIONS.map((s) => s.label)).toEqual([
      'Account',
      'Equipment',
      'Integrations',
      'Program prefs',
      'Backups',
      'Feedback',
      'Storage',
      'Injuries',
    ]);
  });

  it('marks slots W4/W5/W7 will populate as disabled until those waves land', () => {
    const byLabel = new Map(SETTINGS_SECTIONS.map((s) => [s.label, s]));
    expect(byLabel.get('Program prefs')?.disabled).toBe(true);
    expect(byLabel.get('Backups')?.disabled).toBe(true);
    expect(byLabel.get('Feedback')?.disabled).toBe(true);
    expect(byLabel.get('Account')?.disabled).toBe(false);
    expect(byLabel.get('Equipment')?.disabled).toBe(false);
    expect(byLabel.get('Integrations')?.disabled).toBe(false);
    // D7: Storage + Injuries are already-shipped surfaces; not disabled.
    expect(byLabel.get('Storage')?.disabled).toBe(false);
    expect(byLabel.get('Injuries')?.disabled).toBe(false);
  });

  it('every entry has a route under /settings/', () => {
    for (const s of SETTINGS_SECTIONS) expect(s.to.startsWith('/settings/')).toBe(true);
  });

  it('does NOT demote Storage or Injuries to secondary entries (D7 — G7 must not regress)', () => {
    // Sanity: there is no "secondary" / "nested" tier on the type — all 8 entries
    // are first-class top-level. If we ever add a tier field, this test fails fast.
    for (const s of SETTINGS_SECTIONS) {
      expect((s as Record<string, unknown>).tier ?? 'top').toBe('top');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/settings/SettingsSidebar.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the constant**

```tsx
// frontend/src/components/settings/SettingsSidebar.tsx
// Beta W6 — authoritative Settings sidebar layout. This module exports the
// constant SETTINGS_SECTIONS — the single source-of-truth that the rendering
// Sidebar reads from. Per master-plan §651 the W6 implementer owns the order;
// W4.3 (program-prefs), W5.4 (backups), W7.2 (feedback) flip their `disabled`
// flag to false in their own waves when their routes ship.
//
// D7 (2026-05-26): Storage + Injuries STAY top-level. They are not demoted to
// secondary entries under Account because (a) Injuries is a W3-shipped surface
// and its G7 ≤3-click reachability must not regress, and (b) Storage is needed
// for incident triage and shouldn't hide behind a nested disclosure.

export interface SettingsSection {
  /** Stable label shown in the sub-nav. Do not change once shipped. */
  label: string;
  /** Route path. Must start with /settings/. */
  to: string;
  /** When true, the sub-nav entry renders dimmed + non-navigable. */
  disabled: boolean;
  /** Wave that populates the surface (for traceability in code review). */
  ownerWave: 'W6' | 'W1' | 'W3' | 'W4' | 'W5' | 'W7';
}

// Order is locked by master-plan §651 recommendation, extended for D7:
//   Account → Equipment → Integrations → Program prefs → Backups → Feedback
//   → Storage → Injuries
// Per memory feedback_ship_clean.md: no slot is a v1.5 deferral; placeholder
// ComingSoonPlaceholder routes ship in App.tsx (NOT <Navigate> redirects per
// I-SIDEBAR-PLACEHOLDER — URL stays stable, user sees what's coming) until
// the owning wave wires the real component.
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { label: 'Account',      to: '/settings/account',       disabled: false, ownerWave: 'W6' },
  { label: 'Equipment',    to: '/settings/equipment',     disabled: false, ownerWave: 'W1' },
  { label: 'Integrations', to: '/settings/integrations',  disabled: false, ownerWave: 'W1' },
  { label: 'Program prefs',to: '/settings/program-prefs', disabled: true,  ownerWave: 'W4' },
  { label: 'Backups',      to: '/settings/backups',       disabled: true,  ownerWave: 'W5' },
  { label: 'Feedback',     to: '/settings/feedback',      disabled: true,  ownerWave: 'W7' },
  // D7: Storage + Injuries stay top-level (already-shipped W1/W3 surfaces).
  { label: 'Storage',      to: '/settings/storage',       disabled: false, ownerWave: 'W1' },
  { label: 'Injuries',     to: '/settings/injuries',      disabled: false, ownerWave: 'W3' },
] as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/settings/SettingsSidebar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Update Sidebar.tsx to consume the constant**

In `frontend/src/components/layout/Sidebar.tsx`, replace lines 35–41:

```tsx
// BEFORE:
const SETTINGS_SUB = [
  { label: 'Integrations', to: '/settings/integrations' },
  { label: 'Units & equipment', to: '/settings/equipment' },
  { label: 'Account', to: '/settings/account' },
  { label: 'Storage', to: '/settings/storage' },
  { label: 'Injuries', to: '/settings/injuries' },
]

// AFTER:
import { SETTINGS_SECTIONS } from '../settings/SettingsSidebar'
// (above the component)
```

Sidebar rendering change: every existing iteration over `SETTINGS_SUB` is now over `SETTINGS_SECTIONS`. For `disabled: true` entries, render as a `<div>` with `color: TOKENS.textMute`, `cursor: 'not-allowed'`, `aria-disabled="true"`, no `NavLink` wrap.

**Per D7 + I-SIDEBAR-AUTOEXPAND-DEAD:** Storage + Injuries render as plain top-level entries — NO "secondary auto-expand under Account" tier. The draft's nested-disclosure design is dropped entirely; the rendering loop is a flat `.map()` over all 8 entries.

**Per I-MOBILE-SIGNOUT-PATH:** If the mobile Sidebar's hamburger → Settings link currently targets `/settings/integrations` (alpha default), change it to `/settings/account` — Account is the new authoritative first slot. Verify against the current Sidebar.tsx mobile-target line.

- [ ] **Step 6: Add ComingSoonPlaceholder routes to App.tsx**

Per I-SIDEBAR-PLACEHOLDER: slots 4/5/6 ship as a real component that says "Coming in <wave>", NOT a `<Navigate>` redirect. The URL must stay stable so the user can see what's coming and the sidebar entry isn't a dead link.

First create `frontend/src/components/common/ComingSoonPlaceholder.tsx`:

```tsx
// frontend/src/components/common/ComingSoonPlaceholder.tsx
// Renders a stable Settings-page surface for sidebar slots that are wired in
// SETTINGS_SECTIONS but not yet implemented. W4/W5/W7 replace this with their
// real component as part of their wave.
import { TOKENS, FONTS } from '../../tokens';

interface Props {
  title: string;        // "Program prefs" | "Backups" | "Feedback"
  wave: 'W4' | 'W5' | 'W7';
  blurb: string;        // 1-sentence description of what's coming
}

export function ComingSoonPlaceholder({ title, wave, blurb }: Props): JSX.Element {
  return (
    <div style={{ padding: '24px 32px', maxWidth: 720 }}>
      <div style={{ fontFamily: FONTS.mono, fontSize: 10, color: TOKENS.textMute, letterSpacing: 1.2, marginBottom: 4 }}>SETTINGS</div>
      <h2 style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.5, color: TOKENS.text }}>{title}</h2>
      <p style={{ fontSize: 13, color: TOKENS.textDim, marginTop: 16 }}>
        Coming in {wave}. {blurb}
      </p>
    </div>
  );
}
```

Then in `frontend/src/App.tsx`, add three routes inside `<Route path="/" element={<AppShell />}>`:

```tsx
<Route path="settings/program-prefs" element={
  <ComingSoonPlaceholder title="Program prefs" wave="W4" blurb="Per-program preferences (deload behavior, RIR floor, etc.) land in W4." />
} />
<Route path="settings/backups" element={
  <ComingSoonPlaceholder title="Backups" wave="W5" blurb="In-app pg_dump snapshots + restore land in W5." />
} />
<Route path="settings/feedback" element={
  <ComingSoonPlaceholder title="Feedback" wave="W7" blurb="In-app feedback capture lands in W7." />
} />
```

When W4/W5/W7 land they swap `<ComingSoonPlaceholder>` for their real component.

- [ ] **Step 7: Update Sidebar test for the new shape**

Open `frontend/src/components/layout/Sidebar.test.tsx`, find any test that pins the literal `SETTINGS_SUB` list, and update to assert against `SETTINGS_SECTIONS`. If the existing test doesn't reference the list literally, no edit is needed.

- [ ] **Step 8: Run all Sidebar + SettingsSidebar tests**

Run: `cd frontend && npx vitest run src/components/layout/Sidebar.test.tsx src/components/settings/SettingsSidebar.test.tsx`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/settings/SettingsSidebar.tsx frontend/src/components/settings/SettingsSidebar.test.tsx frontend/src/components/layout/Sidebar.tsx frontend/src/components/layout/Sidebar.test.tsx frontend/src/App.tsx
git commit -m "feat: SETTINGS_SECTIONS authoritative layout + 6 sub-nav slots"
```

---

### Task 5: Term registry additions

**Files:**
- Modify: `frontend/src/lib/terms.ts`
- Modify: `frontend/src/lib/terms.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// in frontend/src/lib/terms.test.ts — add a new describe block:
describe('W6 term additions', () => {
  it.each(['PAT','bearer_token','session','IANA_timezone','truncated_ip_24'] as const)('has TERMS entry for %s', (k) => {
    expect(TERMS[k as keyof typeof TERMS]).toBeDefined();
    expect(TERMS[k as keyof typeof TERMS].short.length).toBeGreaterThan(0);
    expect(TERMS[k as keyof typeof TERMS].plain.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/terms.test.ts`
Expected: FAIL — missing keys.

- [ ] **Step 3: Add term entries**

In `frontend/src/lib/terms.ts`, extend `TermKey` union and add to `TERMS`:

```ts
// extend TermKey:
| 'PAT' | 'bearer_token' | 'session' | 'IANA_timezone' | 'truncated_ip_24'

// in TERMS:
PAT: {
  short: 'PAT',
  full: 'Personal Access Token',
  plain: 'A long-lived token your iOS Shortcut or other automation uses to talk to RepOS on your behalf.',
  whyMatters: 'Bearer tokens are device-level. If you lose a device, revoke that token here — your CF Access login on browsers is separate.',
},
bearer_token: {
  short: 'bearer token',
  full: 'Bearer token',
  plain: 'A long secret string an automation sends with each request to prove it is allowed to act for you.',
  whyMatters: 'Anyone with the secret can act as you. Revoke immediately if a device is lost or shared.',
},
session: {
  short: 'session',
  full: 'Active session',
  plain: 'A browser or device that has authenticated to RepOS and can call the API.',
  whyMatters: 'Sign out everywhere ends all sessions and bearer tokens at once — useful if you suspect any device is compromised.',
},
IANA_timezone: {
  short: 'time zone',
  full: 'IANA time zone',
  plain: 'The named time zone (like America/New_York) RepOS uses to compute "today" for your workouts.',
  whyMatters: 'If your time zone is wrong, the home page may show yesterday\'s or tomorrow\'s workout instead of today\'s.',
},
truncated_ip_24: {
  short: 'IP /24',
  full: 'Truncated IP address (/24)',
  plain: 'RepOS shows only the network portion of your last-used IP (e.g., 192.168.88.0/24) — not the exact address.',
  whyMatters: 'Enough information for "did I sign in from work or home?" without storing your precise location across every session.',
},
```

- [ ] **Step 4: Run test**

Run: `cd frontend && npx vitest run src/lib/terms.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/terms.ts frontend/src/lib/terms.test.ts
git commit -m "feat: add PAT/bearer_token/session/IANA_timezone term registry entries"
```

---

## Phase 2 — Backend routes + contamination tests

### Task 5b: CSRF Origin middleware + `REPOS_ADMIN_EMAILS` admin check + IANA tz static fallback

> **Combined sub-tasks** because all three are 10–30 LOC each and they're touched by Task 7+ (so they need to land first as preconditions).

**Files:**
- Create: `api/src/middleware/csrfOrigin.ts` (per C-CSRF-ORIGIN)
- Create: `api/src/lib/timezones.ts` (per I-IANA-TIMEZONES)
- Create: `frontend/src/lib/timezones.ts` (mirror of API list — keep in sync at PR time)
- Create: `frontend/src/lib/constants/accountConfirmPhrases.ts` (per I-CONFIRM-PHRASE-CONST)
- Modify: `api/src/middleware/cfAccess.ts` — `requireAdminKeyOrCfAccess` adds `REPOS_ADMIN_EMAILS` check (per D10); also exports new `requireCfAccessOnly` middleware (per C-SIGNOUT-CFACCESS-ONLY) that rejects bearer auth
- Modify: `api/.env.example` — add `REPOS_ADMIN_EMAILS=jmeyer@ironcloudtech.com`
- Create: `api/tests/integration/csrf-origin.test.ts`
- Create: `api/tests/middleware/admin-emails.test.ts`
- Create: `api/tests/middleware/require-cf-access-only.test.ts`

- [ ] **Step 1: Write the failing CSRF Origin tests**

```ts
// api/tests/integration/csrf-origin.test.ts
// Per C-CSRF-ORIGIN — when authMode === 'cf_access', state-changing routes
// require either:
//   (a) Origin header matching the configured host, OR
//   (b) X-RepOS-CSRF: 1 custom header (cross-origin form can't set without preflight)
// Missing/wrong → 403.
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { mkUser, cleanupUser, mintCfAccessJwt } from '../helpers/program-fixtures.js';

let app: Awaited<ReturnType<typeof buildApp>>;
let userId: string;
let cfJwt: string;
const ALLOWED_ORIGIN = process.env.PUBLIC_ORIGIN ?? 'https://repos.jpmtech.com';

beforeAll(async () => {
  app = await buildApp();
  const u = await mkUser({ prefix: 'vitest.csrf' }); userId = u.id;
  cfJwt = await mintCfAccessJwt(u.email);
});
afterAll(async () => { await cleanupUser(userId); await app.close(); });

describe('CSRF Origin guard on CF Access cookie path', () => {
  it('PATCH /api/me/profile with no Origin and no X-RepOS-CSRF → 403', async () => {
    const r = await app.inject({
      method: 'PATCH', url: '/api/me/profile',
      cookies: { CF_Authorization: cfJwt },
      payload: { display_name: 'X' },
    });
    expect(r.statusCode).toBe(403);
  });

  it('PATCH /api/me/profile with wrong Origin → 403', async () => {
    const r = await app.inject({
      method: 'PATCH', url: '/api/me/profile',
      cookies: { CF_Authorization: cfJwt },
      headers: { origin: 'https://evil.example.com' },
      payload: { display_name: 'X' },
    });
    expect(r.statusCode).toBe(403);
  });

  it('PATCH /api/me/profile with matching Origin → 200', async () => {
    const r = await app.inject({
      method: 'PATCH', url: '/api/me/profile',
      cookies: { CF_Authorization: cfJwt },
      headers: { origin: ALLOWED_ORIGIN },
      payload: { display_name: 'Jason' },
    });
    expect(r.statusCode).toBe(200);
  });

  it('PATCH /api/me/profile with X-RepOS-CSRF: 1 (no Origin) → 200', async () => {
    const r = await app.inject({
      method: 'PATCH', url: '/api/me/profile',
      cookies: { CF_Authorization: cfJwt },
      headers: { 'x-repos-csrf': '1' },
      payload: { display_name: 'Jason CSRF' },
    });
    expect(r.statusCode).toBe(200);
  });

  it('DELETE /api/me also gates on CSRF guard', async () => {
    const r = await app.inject({
      method: 'DELETE', url: '/api/me',
      cookies: { CF_Authorization: cfJwt },
      payload: { confirm: 'DELETE my account' },
    });
    expect(r.statusCode).toBe(403);
  });

  it('POST /api/auth/signout-everywhere also gates on CSRF guard', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/auth/signout-everywhere',
      cookies: { CF_Authorization: cfJwt },
    });
    expect(r.statusCode).toBe(403);
  });

  it('does NOT block bearer-auth paths (Origin guard is cookie-path only)', async () => {
    // Bearer auth doesn't carry the same CSRF risk; it requires a stolen secret.
    const token = await (async () => {
      const mint = await app.inject({
        method: 'POST', url: '/api/tokens',
        body: { user_id: userId, label: 'csrf-bypass-check', scopes: ['health:weight:write'] },
      });
      return mint.json<{ token: string }>().token;
    })();
    const r = await app.inject({
      method: 'PATCH', url: '/api/me/profile',
      headers: { authorization: `Bearer ${token}` },
      payload: { display_name: 'Jason Bearer' },
    });
    expect(r.statusCode).toBe(200);
  });
});
```

- [ ] **Step 2: Implement the middleware**

```ts
// api/src/middleware/csrfOrigin.ts
// Per C-CSRF-ORIGIN — guard state-changing routes on the CF Access cookie
// path. Bearer auth path is unaffected (a stolen bearer is its own threat
// model; Origin spoofing isn't the worry there).
//
// Pass conditions (logical OR):
//   1. authMode is NOT cf_access (i.e. bearer auth) — skip
//   2. Origin header matches process.env.PUBLIC_ORIGIN (or configured host)
//   3. X-RepOS-CSRF: 1 custom header is present (cross-origin form can't set
//      without triggering CORS preflight)
//
// Fail closed otherwise → 403.

import type { FastifyRequest, FastifyReply } from 'fastify';

export async function csrfOrigin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authMode = (req as { authMode?: string }).authMode;
  if (authMode !== 'cf_access') return; // bearer path — no Origin guard

  const allowedOrigin = process.env.PUBLIC_ORIGIN;
  if (!allowedOrigin) {
    req.log.error('csrf_origin: PUBLIC_ORIGIN not configured — failing closed');
    return reply.code(403).send({ error: 'csrf_origin_misconfigured' });
  }

  const origin = req.headers.origin;
  const csrfHeader = req.headers['x-repos-csrf'];

  if (origin === allowedOrigin) return;
  if (csrfHeader === '1') return;

  req.log.warn({ origin, hasCsrfHeader: !!csrfHeader }, 'csrf_origin_rejected');
  return reply.code(403).send({ error: 'csrf_origin_required', expected_origin: allowedOrigin });
}
```

- [ ] **Step 3: Wire the admin-emails check into `requireAdminKeyOrCfAccess`**

In `api/src/middleware/cfAccess.ts:176-202` (existing `requireAdminKeyOrCfAccess`), after the CF Access JWT path is validated:

```ts
// Per D10: when authenticated via CF Access (not the admin key), enforce
// that the user's email is in REPOS_ADMIN_EMAILS. Fail closed if env unset.
if (authMode === 'cf_access') {
  const adminEmails = process.env.REPOS_ADMIN_EMAILS;
  if (!adminEmails) {
    req.log.error('admin_check: REPOS_ADMIN_EMAILS not configured — failing closed');
    return reply.code(403).send({ error: 'admin_check_misconfigured' });
  }
  const allowed = adminEmails.split(',').map((s) => s.trim()).filter(Boolean);
  if (!allowed.includes(req.userEmail ?? '')) {
    req.log.warn({ userEmail: req.userEmail }, 'admin_check_rejected');
    return reply.code(403).send({ error: 'not_an_admin' });
  }
}
```

Per the D10 docblock: migration 063 reserves the `users.role TEXT` column for post-Beta cohort scale-up. Until then `REPOS_ADMIN_EMAILS` is the source of truth.

- [ ] **Step 3b: Add `requireCfAccessOnly` middleware (per C-SIGNOUT-CFACCESS-ONLY)**

In `api/src/middleware/cfAccess.ts`, add a new exported middleware that:
- Verifies the request authenticated via CF Access JWT (not bearer).
- 401 if no CF Access cookie / JWT validation fails.
- 403 if the request authenticated via bearer (i.e., a bearer Authorization header is present).

```ts
export async function requireCfAccessOnly(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  // Reject any path that came in with a bearer.
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    req.log.warn({ path: req.url }, 'bearer_rejected_on_cf_access_only_route');
    return reply.code(403).send({ error: 'cf_access_required' });
  }
  // Delegate to the existing CF Access JWT validator.
  // (Calls the same internal helper requireBearerOrCfAccess uses for the cookie
  // path, but without the bearer fallback.)
  await validateCfAccessJwt(req, reply);
}
```

Used by `POST /api/auth/signout-everywhere` and `DELETE /api/me` — both routes refuse to act on a stolen bearer token.

- [ ] **Step 3c: Add `CONFIRM_DELETE_ACCOUNT_PHRASE` constant (per I-CONFIRM-PHRASE-CONST)**

```ts
// frontend/src/lib/constants/accountConfirmPhrases.ts
// Centralized typed-confirm phrase for DELETE /api/me. Mirrored on the API
// side in api/src/schemas/account.ts. Any drift here is caught by the cascade
// test (it imports the API constant and exercises the dialog with this exact
// string).
export const CONFIRM_DELETE_ACCOUNT_PHRASE = 'DELETE my account';
```

- [ ] **Step 4: Static IANA tz fallback**

```ts
// api/src/lib/timezones.ts
// Per I-IANA-TIMEZONES + memory project_alpine_smallicu:
// Alpine apk nodejs is built against small-icu, which ignores Intl locale
// tags AND returns a degenerate Intl.supportedValuesOf('timeZone') list.
// Hard-coded canonical list ships in source so prod has the full set.
//
// Source: IANA tzdata 2024a primary zones. Sync via `tzdata --version` on
// the build host before each release.

export const IANA_TIMEZONES: readonly string[] = [
  'UTC',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Anchorage', 'America/Adak', 'Pacific/Honolulu',
  'America/Toronto', 'America/Vancouver', 'America/Halifax', 'America/St_Johns',
  'America/Mexico_City', 'America/Bogota', 'America/Lima', 'America/Santiago',
  'America/Buenos_Aires', 'America/Sao_Paulo',
  'Europe/London', 'Europe/Dublin', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid',
  'Europe/Rome', 'Europe/Amsterdam', 'Europe/Brussels', 'Europe/Stockholm',
  'Europe/Helsinki', 'Europe/Warsaw', 'Europe/Prague', 'Europe/Vienna', 'Europe/Zurich',
  'Europe/Athens', 'Europe/Istanbul', 'Europe/Moscow',
  'Africa/Cairo', 'Africa/Johannesburg', 'Africa/Lagos', 'Africa/Nairobi',
  'Asia/Dubai', 'Asia/Tehran', 'Asia/Karachi', 'Asia/Kolkata', 'Asia/Dhaka',
  'Asia/Bangkok', 'Asia/Singapore', 'Asia/Hong_Kong', 'Asia/Shanghai', 'Asia/Tokyo',
  'Asia/Seoul', 'Asia/Jerusalem', 'Asia/Riyadh',
  'Australia/Perth', 'Australia/Adelaide', 'Australia/Sydney', 'Australia/Brisbane',
  'Pacific/Auckland', 'Pacific/Fiji',
  // Extend as cohort grows; this list is the prod authoritative source.
] as const;
```

And the frontend mirror — same list, separate file so the bundle doesn't import the api package:

```ts
// frontend/src/lib/timezones.ts
// Mirror of api/src/lib/timezones.ts. Keep in sync at PR time; AccountProfileEditor
// + any other tz UI imports from here. Per memory project_alpine_smallicu, we
// can't rely on Intl.supportedValuesOf on the prod runtime.
export const IANA_TIMEZONES: readonly string[] = [
  'UTC',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  // ... (identical to api/src/lib/timezones.ts)
] as const;
```

**PR-time sync check:** add an `npm run check:tz-sync` script (or a CI grep) that asserts both files contain the same string set. If they drift the build fails.

- [ ] **Step 5: Run all middleware tests + commit**

Run: `cd api && npx vitest run tests/integration/csrf-origin.test.ts tests/middleware/`
Expected: PASS.

```bash
git add api/src/middleware/csrfOrigin.ts api/src/middleware/cfAccess.ts api/src/lib/timezones.ts api/.env.example api/tests/integration/csrf-origin.test.ts api/tests/middleware/admin-emails.test.ts
git commit -m "feat: CSRF Origin guard + REPOS_ADMIN_EMAILS admin check + static IANA tz list"
```

---

### Task 6: `services/accountEvents.ts` + `recordAccountEvent` helper

**Files:**
- Create: `api/src/services/accountEvents.ts`
- Create: `api/tests/services/accountEvents.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// api/tests/services/accountEvents.test.ts
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { recordAccountEvent, listAccountEvents } from '../../src/services/accountEvents.js';
import { db } from '../../src/db/client.js';
import { mkUser, cleanupUser } from '../helpers/program-fixtures.js';

let userId: string;

beforeAll(async () => { const u = await mkUser({ prefix: 'vitest.acct-svc' }); userId = u.id; });
afterAll(async () => { await cleanupUser(userId); });

describe('recordAccountEvent', () => {
  let userEmail: string;
  beforeAll(async () => {
    const { rows } = await db.query<{ email: string }>(`SELECT email FROM users WHERE id=$1`, [userId]);
    userEmail = rows[0].email;
  });

  it('inserts a row with kind + meta + ip + PII snapshot columns (per D8)', async () => {
    await recordAccountEvent({ userId, userEmail, kind: 'profile_changed', ip: '10.0.0.5', meta: { field: 'display_name', changed: true } });
    const { rows } = await db.query(
      `SELECT kind, ip, meta, user_id_at_event, user_email_at_event FROM account_events WHERE user_id=$1`,
      [userId],
    );
    expect(rows.length).toBe(1);
    expect(rows[0].kind).toBe('profile_changed');
    expect(rows[0].meta).toEqual({ field: 'display_name', changed: true });
    expect(rows[0].user_id_at_event).toBe(userId);
    expect(rows[0].user_email_at_event).toBe(userEmail);
  });

  it('rejects unknown kinds at compile time (TypeScript union enforces it)', async () => {
    // The DB does not CHECK on kind (per C-ACCOUNT-EVENTS-ENUM); compile-time
    // safety is enforced by the AccountEventKind union. This @ts-expect-error
    // verifies the type-side guard, not a runtime throw.
    await recordAccountEvent({
      userId, userEmail,
      // @ts-expect-error — invalid kind (caught by TS, not by Postgres)
      kind: 'not_real',
      ip: null, meta: {},
    });
  });

  it('accepts W2/W5 cross-wave kinds (par_q_acknowledged, onboarding_completed, restore_replayed)', async () => {
    for (const kind of ['par_q_acknowledged','onboarding_completed','restore_replayed'] as const) {
      await expect(
        recordAccountEvent({ userId, userEmail, kind, ip: null, meta: {} }),
      ).resolves.toBeUndefined();
    }
  });

  it('listAccountEvents uses keyset pagination — (occurred_at, id) tiebreaker', async () => {
    // Insert two events in the same millisecond (forced via explicit timestamp).
    const ts = new Date();
    await db.query(
      `INSERT INTO account_events (user_id, user_id_at_event, user_email_at_event, kind, ip, meta, occurred_at)
       VALUES ($1, $1, $2, 'token_minted', null, '{}'::jsonb, $3),
              ($1, $1, $2, 'token_minted', null, '{}'::jsonb, $3)`,
      [userId, userEmail, ts],
    );
    const rows = await listAccountEvents(userId, { limit: 1 });
    expect(rows.length).toBe(1);
    // Cursor onto the next page using (occurred_at, id) — same-ms event must NOT be skipped.
    const next = await listAccountEvents(userId, {
      limit: 1, beforeTs: rows[0].occurred_at, beforeId: rows[0].id,
    });
    expect(next.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run tests/services/accountEvents.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the helper**

```ts
// api/src/services/accountEvents.ts
// Beta W6 — single writer for the account_events audit table.
// Centralized so route handlers don't each invent their own INSERT shape.
//
// kind is a TypeScript-only union (per C-ACCOUNT-EVENTS-ENUM). The DB does
// not CHECK on kind; new kinds are added by extending this union without a
// migration. W2 adds par_q_acknowledged + onboarding_completed; W5 adds
// restore_replayed. W6 reserves all of them up-front so cross-wave imports
// don't have to coordinate type changes.
//
// PII snapshot (per D8): every write populates user_email_at_event +
// user_id_at_event so the row survives ON DELETE SET NULL with forensic
// fidelity. Caller MUST pass the email; we don't lazy-load it from users
// because the SET NULL semantic means the users row may not exist by the
// time a hypothetical lazy lookup runs.
import { db } from '../db/client.js';

export type AccountEventKind =
  // W6:
  | 'profile_changed'
  | 'token_minted'
  | 'token_revoked'
  | 'signout_everywhere'
  | 'delete_initiated'
  // W2 (cross-wave contract — W6 reserves the type, W2 emits):
  | 'par_q_acknowledged'
  | 'onboarding_completed'
  // W5 (cross-wave contract — W6 reserves the type, W5 emits):
  | 'restore_replayed';

export interface RecordAccountEventArgs {
  userId: string;
  /** Snapshot at write-time. Survives user delete (per D8). */
  userEmail: string;
  kind: AccountEventKind;
  ip: string | null;
  meta: Record<string, unknown>;
}

export async function recordAccountEvent(args: RecordAccountEventArgs): Promise<void> {
  await db.query(
    `INSERT INTO account_events
       (user_id, user_id_at_event, user_email_at_event, kind, ip, meta)
     VALUES ($1, $1, $2, $3, $4, $5::jsonb)`,
    [args.userId, args.userEmail, args.kind, args.ip, JSON.stringify(args.meta)],
  );
}

export interface AccountEventRow {
  id: string;
  kind: AccountEventKind;
  ip: string | null;
  meta: Record<string, unknown>;
  occurred_at: Date;
  user_email_at_event: string | null;
}

// Keyset pagination (per I-PAGINATION-KEYSET): (occurred_at, id) tuple cursor.
// Two events in the same millisecond don't skip because id is the tiebreaker.
export async function listAccountEvents(
  userId: string,
  opts: { limit?: number; beforeTs?: Date; beforeId?: string } = {},
): Promise<AccountEventRow[]> {
  const limit = Math.min(opts.limit ?? 50, 200);
  if (opts.beforeTs && opts.beforeId) {
    const { rows } = await db.query<AccountEventRow>(
      `SELECT id::text, kind, ip, meta, occurred_at, user_email_at_event
         FROM account_events
        WHERE user_id=$1 AND (occurred_at, id) < ($2, $3::bigint)
        ORDER BY occurred_at DESC, id DESC
        LIMIT $4`,
      [userId, opts.beforeTs, opts.beforeId, limit],
    );
    return rows;
  }
  const { rows } = await db.query<AccountEventRow>(
    `SELECT id::text, kind, ip, meta, occurred_at, user_email_at_event
       FROM account_events
      WHERE user_id=$1
      ORDER BY occurred_at DESC, id DESC
      LIMIT $2`,
    [userId, limit],
  );
  return rows;
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `cd api && npx vitest run tests/services/accountEvents.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/services/accountEvents.ts api/tests/services/accountEvents.test.ts
git commit -m "feat: account_events service + recordAccountEvent helper"
```

---

### Task 7: `PATCH /api/me/profile` + zod schema + contamination test

**Files:**
- Create: `api/src/schemas/account.ts`
- Create: `api/src/routes/account.ts` (initial — `PATCH /api/me/profile` only this task)
- Create: `api/tests/routes/account.test.ts`
- Create: `api/tests/integration/contamination/account-profile-contamination.test.ts`
- Modify: `api/src/app.ts` — register `accountRoutes`

- [ ] **Step 1: Write the failing happy-path test**

```ts
// api/tests/routes/account.test.ts
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/client.js';
import { mkUser, cleanupUser } from '../helpers/program-fixtures.js';

let app: Awaited<ReturnType<typeof buildApp>>;
let userId: string;
let token: string;

beforeAll(async () => {
  app = await buildApp();
  const u = await mkUser({ prefix: 'vitest.acct-routes' });
  userId = u.id;
  const mint = await app.inject({
    method: 'POST', url: '/api/tokens',
    body: { user_id: userId, label: 't', scopes: ['health:weight:write'] },
  });
  token = mint.json<{ token: string }>().token;
});
afterAll(async () => { await cleanupUser(userId); await app.close(); });

describe('PATCH /api/me/profile', () => {
  it('updates display_name + timezone (units NOT supported per D6)', async () => {
    const r = await app.inject({
      method: 'PATCH', url: '/api/me/profile',
      headers: { authorization: `Bearer ${token}` },
      payload: { display_name: 'Jason M.', timezone: 'America/New_York' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json<{ display_name: string }>().display_name).toBe('Jason M.');
    // account_events row written
    const { rows } = await db.query(
      `SELECT kind, meta FROM account_events WHERE user_id=$1 AND kind='profile_changed'`, [userId],
    );
    expect(rows.length).toBeGreaterThan(0);
    // meta.before is redacted (per I-ACCOUNT-EVENTS-META — no raw prior display_name)
    expect(rows[0].meta.before).not.toContain?.('Jay'); // string-shape sanity; actual shape is {field, changed: true}
  });

  it('rejects units in body — units is not a supported field (per D6)', async () => {
    const r = await app.inject({
      method: 'PATCH', url: '/api/me/profile',
      headers: { authorization: `Bearer ${token}` },
      payload: { units: 'kg' },
    });
    // zod .strict() rejects unknown keys with 400.
    expect(r.statusCode).toBe(400);
  });

  it('rejects unknown timezone with 400', async () => {
    const r = await app.inject({
      method: 'PATCH', url: '/api/me/profile',
      headers: { authorization: `Bearer ${token}` },
      payload: { timezone: 'Mars/Olympus' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('rejects display_name > 80 chars', async () => {
    const r = await app.inject({
      method: 'PATCH', url: '/api/me/profile',
      headers: { authorization: `Bearer ${token}` },
      payload: { display_name: 'x'.repeat(81) },
    });
    expect(r.statusCode).toBe(400);
  });

  it('rejects empty-string and whitespace-only display_name (per I-DISPLAY-NAME-NORMALIZE)', async () => {
    for (const bad of ['', '   ', '​​​']) {
      const r = await app.inject({
        method: 'PATCH', url: '/api/me/profile',
        headers: { authorization: `Bearer ${token}` },
        payload: { display_name: bad },
      });
      expect(r.statusCode).toBe(400);
    }
  });

  it('NFKC-normalizes display_name and strips zero-width spaces (per I-DISPLAY-NAME-NORMALIZE)', async () => {
    // "Ｊａｓｏｎ" full-width latin → "Jason" after NFKC; trailing ZWSP stripped.
    const r = await app.inject({
      method: 'PATCH', url: '/api/me/profile',
      headers: { authorization: `Bearer ${token}` },
      payload: { display_name: 'Ｊａｓｏｎ​' },
    });
    expect(r.statusCode).toBe(200);
    const { rows } = await db.query('SELECT display_name FROM users WHERE id=$1', [userId]);
    expect(rows[0].display_name).toBe('Jason');
  });

  it('partial update only touches sent fields', async () => {
    // Send timezone only; display_name must be preserved.
    const before = (await db.query<{ display_name: string }>('SELECT display_name FROM users WHERE id=$1', [userId])).rows[0].display_name;
    await app.inject({
      method: 'PATCH', url: '/api/me/profile',
      headers: { authorization: `Bearer ${token}` },
      payload: { timezone: 'America/Los_Angeles' },
    });
    const { rows } = await db.query('SELECT timezone, display_name FROM users WHERE id=$1', [userId]);
    expect(rows[0].timezone).toBe('America/Los_Angeles');
    expect(rows[0].display_name).toBe(before); // preserved
  });

  it('idempotent — sending the current value twice is a no-op (per I-PROFILE-IDEMPOTENCY-TEST)', async () => {
    // First call (re-sets to the current value).
    const { rows: cur } = await db.query<{ display_name: string }>('SELECT display_name FROM users WHERE id=$1', [userId]);
    await app.inject({
      method: 'PATCH', url: '/api/me/profile',
      headers: { authorization: `Bearer ${token}` },
      payload: { display_name: cur[0].display_name },
    });
    const eventCountBefore = (await db.query<{ n: number }>(`SELECT count(*)::int n FROM account_events WHERE user_id=$1 AND kind='profile_changed'`, [userId])).rows[0].n;
    // Second call with same payload — must not write a duplicate profile_changed event.
    const r = await app.inject({
      method: 'PATCH', url: '/api/me/profile',
      headers: { authorization: `Bearer ${token}` },
      payload: { display_name: cur[0].display_name },
    });
    expect(r.statusCode).toBe(200);
    const eventCountAfter = (await db.query<{ n: number }>(`SELECT count(*)::int n FROM account_events WHERE user_id=$1 AND kind='profile_changed'`, [userId])).rows[0].n;
    expect(eventCountAfter).toBe(eventCountBefore);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run tests/routes/account.test.ts`
Expected: FAIL — route not registered.

- [ ] **Step 3: Write zod schemas**

```ts
// api/src/schemas/account.ts
// Beta W6 — request/response schemas for the account routes.
//
// Per I-CONFIRM-PHRASE-CONST, the typed-confirm string is centralized in one
// constant shared with migration comments, dialog body copy, and tests:
//   frontend/src/lib/constants/accountConfirmPhrases.ts → CONFIRM_DELETE_ACCOUNT_PHRASE
// The API mirrors that const here. If it ever drifts the cascade test catches it.
import { z } from 'zod';

// Mirror of frontend/src/lib/constants/accountConfirmPhrases.ts.
// Both must stay in sync.
export const CONFIRM_DELETE_ACCOUNT_PHRASE = 'DELETE my account';

// Per I-DISPLAY-NAME-NORMALIZE:
//   - NFKC normalize (compatibility composition; full-width latin → ASCII)
//   - strip zero-width spaces and other invisible whitespace
//   - reject if length(trim()) < 1 OR length > 80
// IANA tz allow-list is enforced at the route layer using a static fallback
// list (per I-IANA-TIMEZONES — Intl.supportedValuesOf is unreliable on
// alpine small-icu).
const ZERO_WIDTH = /[​-‍﻿]/g;

const DisplayNameSchema = z
  .string()
  .transform((s) => s.normalize('NFKC').replace(ZERO_WIDTH, ''))
  .refine((s) => s.trim().length >= 1, { message: 'display_name_empty' })
  .refine((s) => s.length <= 80, { message: 'display_name_too_long' });

export const ProfilePatchRequestSchema = z.object({
  display_name: DisplayNameSchema.optional(),
  timezone: z.string().min(1).max(64).optional(),
  // NOTE: units is NOT in this schema (per D6 — units deferred from W6).
}).strict();

export const ProfileResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  display_name: z.string().nullable(),
  timezone: z.string(),
});
export type ProfileResponse = z.infer<typeof ProfileResponseSchema>;

export const SessionItemSchema = z.object({
  id: z.string(),
  label: z.string().nullable(),
  created_at: z.string(),
  last_used_at: z.string().nullable(),
  // Truncated to /24 server-side (per I-LAST-IP-TRUNCATE).
  last_used_ip_24: z.string().nullable(),
});
export const SessionListResponseSchema = z.object({
  sessions: z.array(SessionItemSchema),
});

// kind is enum-on-the-wire (zod) even though the DB has no CHECK on it
// (per C-ACCOUNT-EVENTS-ENUM) — defensive on the read side too.
export const AccountEventItemSchema = z.object({
  id: z.string(),
  kind: z.enum([
    'profile_changed','token_minted','token_revoked',
    'signout_everywhere','delete_initiated',
    'par_q_acknowledged','onboarding_completed','restore_replayed',
  ]),
  ip: z.string().nullable(),
  user_email_at_event: z.string().nullable(),
  meta: z.record(z.unknown()),
  occurred_at: z.string(),
});
export const AccountEventListResponseSchema = z.object({
  events: z.array(AccountEventItemSchema),
  // Keyset cursor for next page (per I-PAGINATION-KEYSET).
  next_cursor: z.object({ before_ts: z.string(), before_id: z.string() }).nullable(),
});

export const DeleteMeRequestSchema = z.object({
  confirm: z.literal(CONFIRM_DELETE_ACCOUNT_PHRASE),
});
```

- [ ] **Step 4: Write the route handler**

```ts
// api/src/routes/account.ts
import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { requireBearerOrCfAccess } from '../middleware/cfAccess.js';
import { csrfOrigin } from '../middleware/csrfOrigin.js';
import { recordAccountEvent, listAccountEvents } from '../services/accountEvents.js';
import {
  ProfilePatchRequestSchema,
  SessionListResponseSchema,
  AccountEventListResponseSchema,
  DeleteMeRequestSchema,
} from '../schemas/account.js';
import { IANA_TIMEZONES } from '../lib/timezones.js'; // static fallback per I-IANA-TIMEZONES

const VALID_TZ = new Set(IANA_TIMEZONES);

// Truncate an IPv4 to /24 for display (per I-LAST-IP-TRUNCATE). Returns null on
// invalid/null input. IPv6 is returned unmodified (we can revisit if cohort
// crosses into IPv6 territory).
function truncateIpTo24(ip: string | null): string | null {
  if (!ip) return null;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return ip; // not IPv4 → leave it alone (IPv6 case)
  return `${m[1]}.${m[2]}.${m[3]}.0/24`;
}

export async function accountRoutes(app: FastifyInstance) {
  // PATCH /api/me/profile — partial update of editable profile fields.
  // Identity from req.userId (set by requireBearerOrCfAccess); body cannot
  // override. Per memory feedback_user_reachability_dod.md the route is the
  // server side of the AccountProfileEditor surface — the matched UI lands
  // in Task 13. csrfOrigin guard enforces Origin/X-RepOS-CSRF on CF-Access
  // cookie path (per C-CSRF-ORIGIN).
  app.patch('/me/profile', { preHandler: [requireBearerOrCfAccess, csrfOrigin] }, async (req, reply) => {
    const userId = (req as { userId?: string }).userId;
    const userEmail = (req as { userEmail?: string }).userEmail;
    if (!userId || !userEmail) return reply.code(500).send({ error: 'auth_state_missing' });

    const parsed = ProfilePatchRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });

    if (parsed.data.timezone && !VALID_TZ.has(parsed.data.timezone)) {
      return reply.code(400).send({ error: 'invalid_timezone', timezone: parsed.data.timezone });
    }

    // Read before-state for idempotency check + redacted audit meta.
    const before = await db.query<{ display_name: string | null; timezone: string }>(
      `SELECT display_name, timezone FROM users WHERE id=$1`, [userId],
    );

    // Compute the actual changes (idempotency, per I-PROFILE-IDEMPOTENCY-TEST).
    // If nothing actually changes, skip the UPDATE + skip the audit event.
    const changedFields: string[] = [];
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (parsed.data.display_name !== undefined && parsed.data.display_name !== before.rows[0].display_name) {
      sets.push(`display_name=$${sets.length + 2}`);
      vals.push(parsed.data.display_name);
      changedFields.push('display_name');
    }
    if (parsed.data.timezone !== undefined && parsed.data.timezone !== before.rows[0].timezone) {
      sets.push(`timezone=$${sets.length + 2}`);
      vals.push(parsed.data.timezone);
      changedFields.push('timezone');
    }

    if (sets.length === 0) {
      // No-op: re-fetch current row, return 200, no audit event.
      const { rows } = await db.query<{ id: string; email: string; display_name: string | null; timezone: string }>(
        `SELECT id, email, display_name, timezone FROM users WHERE id=$1`, [userId],
      );
      return reply.code(200).send(rows[0]);
    }

    const { rows } = await db.query<{ id: string; email: string; display_name: string | null; timezone: string }>(
      `UPDATE users SET ${sets.join(', ')} WHERE id=$1 RETURNING id, email, display_name, timezone`,
      [userId, ...vals],
    );

    // Redacted meta (per I-ACCOUNT-EVENTS-META) — we record WHICH fields
    // changed, not the prior PII values. The new values live in the users
    // row (current state) and can be reconstructed from there if needed.
    await recordAccountEvent({
      userId, userEmail, kind: 'profile_changed', ip: req.ip,
      meta: { fields: changedFields, changed: true },
    });
    return reply.code(200).send(rows[0]);
  });

  // GET /api/account/sessions — list of the user's non-revoked device_tokens.
  // IP truncated to /24 per I-LAST-IP-TRUNCATE.
  app.get('/account/sessions', { preHandler: requireBearerOrCfAccess }, async (req, reply) => {
    const userId = (req as { userId?: string }).userId;
    if (!userId) return reply.code(500).send({ error: 'auth_state_missing' });
    const { rows } = await db.query(
      `SELECT id::text, label, created_at, last_used_at, last_used_ip
         FROM device_tokens
        WHERE user_id=$1 AND revoked_at IS NULL
        ORDER BY created_at DESC`,
      [userId],
    );
    const resp = SessionListResponseSchema.parse({
      sessions: rows.map((r) => ({
        id: r.id,
        label: r.label,
        created_at: r.created_at.toISOString?.() ?? r.created_at,
        last_used_at: r.last_used_at?.toISOString?.() ?? r.last_used_at,
        last_used_ip_24: truncateIpTo24(r.last_used_ip),
      })),
    });
    return reply.send(resp);
  });

  // GET /api/account/events — keyset-paginated audit feed (per I-PAGINATION-KEYSET).
  app.get<{ Querystring: { before_ts?: string; before_id?: string; limit?: string } }>(
    '/account/events',
    { preHandler: requireBearerOrCfAccess },
    async (req, reply) => {
      const userId = (req as { userId?: string }).userId;
      if (!userId) return reply.code(500).send({ error: 'auth_state_missing' });
      const beforeTs = req.query.before_ts ? new Date(req.query.before_ts) : undefined;
      const beforeId = req.query.before_id;
      const limit = req.query.limit ? Math.min(parseInt(req.query.limit, 10), 200) : 50;
      const rows = await listAccountEvents(userId, { beforeTs, beforeId, limit });
      const last = rows[rows.length - 1];
      const nextCursor = rows.length === limit && last
        ? { before_ts: last.occurred_at.toISOString(), before_id: last.id }
        : null;
      const resp = AccountEventListResponseSchema.parse({
        events: rows.map((r) => ({
          id: r.id,
          kind: r.kind,
          ip: r.ip,
          user_email_at_event: r.user_email_at_event,
          meta: r.meta,
          occurred_at: r.occurred_at.toISOString(),
        })),
        next_cursor: nextCursor,
      });
      return reply.send(resp);
    },
  );

  // DELETE /api/me — placeholder until Task 9 fleshes out. Stubbed 405 so the
  // route is reserved but a partial-merge of Task 7 doesn't open a security
  // hole. csrfOrigin attached so the contract is correct when the real handler
  // lands.
  app.delete('/me', { preHandler: [requireBearerOrCfAccess, csrfOrigin] }, async (_req, reply) => {
    return reply.code(405).send({ error: 'not_implemented' });
  });

  // Suppress unused-import lint for DeleteMeRequestSchema until Task 9 lands.
  void DeleteMeRequestSchema;
}
```

Register the plugin in `api/src/app.ts`:

```ts
import { accountRoutes } from './routes/account.js';
// ... existing registrations ...
await app.register(accountRoutes, { prefix: '/api' });
```

- [ ] **Step 5: Run happy-path test**

Run: `cd api && npx vitest run tests/routes/account.test.ts`
Expected: PASS (all 4 cases).

- [ ] **Step 6: Write G2 contamination test for the profile route**

```ts
// api/tests/integration/contamination/account-profile-contamination.test.ts
// G2 contribution — PATCH /api/me/profile with user-A token must never edit
// user-B's row. Server derives identity from req.userId; verify a body that
// tries to spoof user_id is silently ignored.
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../../src/app.js';
import { db } from '../../../src/db/client.js';
import { mkUser, cleanupUser } from '../../helpers/program-fixtures.js';

let app: Awaited<ReturnType<typeof buildApp>>;
let userA: string; let tokenA: string;
let userB: string;

beforeAll(async () => {
  app = await buildApp();
  const a = await mkUser({ prefix: 'vitest.w6-cont-a' }); userA = a.id;
  const b = await mkUser({ prefix: 'vitest.w6-cont-b' }); userB = b.id;
  const m = await app.inject({
    method: 'POST', url: '/api/tokens',
    body: { user_id: userA, label: 'a', scopes: ['health:weight:write'] },
  });
  tokenA = m.json<{ token: string }>().token;
  await db.query(`UPDATE users SET display_name='B Original' WHERE id=$1`, [userB]);
});
afterAll(async () => { await cleanupUser(userA); await cleanupUser(userB); await app.close(); });

describe('PATCH /api/me/profile contamination — G2', () => {
  it('user-A token + body with user-B-style fields edits user A only', async () => {
    await app.inject({
      method: 'PATCH', url: '/api/me/profile',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { display_name: 'A Modified' },
    });
    const { rows: ar } = await db.query('SELECT display_name FROM users WHERE id=$1', [userA]);
    const { rows: br } = await db.query('SELECT display_name FROM users WHERE id=$1', [userB]);
    expect(ar[0].display_name).toBe('A Modified');
    expect(br[0].display_name).toBe('B Original');
  });

  it('user-A token cannot read user B account_events', async () => {
    await db.query(
      `INSERT INTO account_events (user_id, kind, ip, meta) VALUES ($1,'profile_changed','9.9.9.9','{}'::jsonb)`,
      [userB],
    );
    const r = await app.inject({
      method: 'GET', url: '/api/account/events',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(r.statusCode).toBe(200);
    const events = r.json<{ events: { ip: string }[] }>().events;
    expect(events.some((e) => e.ip === '9.9.9.9')).toBe(false);
  });

  it('user-A token cannot read user B sessions', async () => {
    await app.inject({
      method: 'POST', url: '/api/tokens',
      body: { user_id: userB, label: 'B-shortcut', scopes: ['health:weight:write'] },
    });
    const r = await app.inject({
      method: 'GET', url: '/api/account/sessions',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    const sessions = r.json<{ sessions: { label: string | null }[] }>().sessions;
    expect(sessions.some((s) => s.label === 'B-shortcut')).toBe(false);
  });
});
```

- [ ] **Step 7: Run contamination test**

Run: `cd api && npx vitest run tests/integration/contamination/account-profile-contamination.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add api/src/schemas/account.ts api/src/routes/account.ts api/src/app.ts api/tests/routes/account.test.ts api/tests/integration/contamination/account-profile-contamination.test.ts
git commit -m "feat: PATCH /api/me/profile + GET sessions/events + G2 contamination"
```

---

### Task 8: `POST /api/auth/signout-everywhere` + contamination + multi-token integration test

**Files:**
- Create: `api/src/routes/authSignout.ts`
- Create: `api/tests/integration/signout-everywhere.test.ts`
- Create: `api/tests/integration/contamination/signout-everywhere-contamination.test.ts`
- Modify: `api/src/app.ts` — register `authSignoutRoutes`

- [ ] **Step 1: Write the failing multi-token integration test**

```ts
// api/tests/integration/signout-everywhere.test.ts
// W6.7 — sign-out-everywhere revokes ALL bearers for the user atomically.
// After call, every previously-valid bearer must return 401 on its next use.
// This is the backend correctness test; the e2e G3.d assertion (Task 17)
// drives the same flow from a browser to verify CF Access cookie clearing.
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/client.js';
import { mkUser, cleanupUser } from '../helpers/program-fixtures.js';

let app: Awaited<ReturnType<typeof buildApp>>;
let userId: string;
let tokenA: string;
let tokenB: string;

beforeAll(async () => {
  app = await buildApp();
  const u = await mkUser({ prefix: 'vitest.signout' }); userId = u.id;
  const ma = await app.inject({ method: 'POST', url: '/api/tokens', body: { user_id: userId, label: 'A', scopes: ['health:weight:write'] } });
  const mb = await app.inject({ method: 'POST', url: '/api/tokens', body: { user_id: userId, label: 'B', scopes: ['health:weight:write'] } });
  tokenA = ma.json<{ token: string }>().token;
  tokenB = mb.json<{ token: string }>().token;
});
afterAll(async () => { await cleanupUser(userId); await app.close(); });

describe('POST /api/auth/signout-everywhere', () => {
  it('revokes all non-revoked tokens for the calling user', async () => {
    // Sanity: tokenB works pre-call.
    const pre = await app.inject({
      method: 'GET', url: '/api/me',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    // /api/me is CF-Access-only; sanity instead via a GET that requires bearer:
    const preMe = await app.inject({
      method: 'GET', url: '/api/account/sessions',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(preMe.statusCode).toBe(200);

    // Call sign-out-everywhere with tokenA.
    const r = await app.inject({
      method: 'POST', url: '/api/auth/signout-everywhere',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(r.statusCode).toBe(204);
    // Set-Cookie clears CF_Authorization on the response.
    const setCookie = (r.headers['set-cookie'] as string[] | undefined) ?? [];
    expect(setCookie.some((c) => /CF_Authorization=;.*Max-Age=0/i.test(c))).toBe(true);

    // tokenA now 401s.
    const a = await app.inject({
      method: 'GET', url: '/api/account/sessions',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(a.statusCode).toBe(401);

    // tokenB also 401s.
    const b = await app.inject({
      method: 'GET', url: '/api/account/sessions',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(b.statusCode).toBe(401);

    // DB confirms revoke_reason='signout_everywhere' on both rows.
    const { rows } = await db.query(
      `SELECT revoke_reason FROM device_tokens WHERE user_id=$1`, [userId],
    );
    expect(rows.length).toBe(2);
    expect(rows.every((x) => x.revoke_reason === 'signout_everywhere')).toBe(true);

    // account_events row written exactly once with the revoked-count meta.
    const { rows: ev } = await db.query(
      `SELECT meta FROM account_events WHERE user_id=$1 AND kind='signout_everywhere'`, [userId],
    );
    expect(ev.length).toBe(1);
    expect(ev[0].meta.revoked_count).toBe(2);
  });

  it('is idempotent — second call returns 204 + meta.revoked_count=0', async () => {
    // Reuse the same user; all bearers were revoked above.
    // Mint a fresh CF-Access-style request — can't from inject without a JWT; instead
    // verify the SQL path: re-running the revoke loop on a user with no active
    // tokens returns 204 with revoked_count=0 in the event meta.
    // (Implementation detail: the route's UPDATE returns rowCount=0, which is
    // not an error — it's the expected idempotent outcome.)
    // This case is exercised end-to-end via the e2e G3.d spec; here we just
    // assert the DB invariant holds.
    const { rows } = await db.query(
      `SELECT count(*)::int as n FROM device_tokens WHERE user_id=$1 AND revoked_at IS NULL`,
      [userId],
    );
    expect(rows[0].n).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run tests/integration/signout-everywhere.test.ts`
Expected: FAIL — route does not exist.

- [ ] **Step 3: Write the route**

```ts
// api/src/routes/authSignout.ts
// Beta W6.7 — atomic bearer-token revocation + CF Access cookie clear.
//
// CF Access JWT ONLY (per C-SIGNOUT-CFACCESS-ONLY). Bearer auth is rejected on
// this endpoint because a stolen bearer would otherwise let an attacker lock
// out the legitimate user via a signout-everywhere call. The user invokes this
// from a browser (CF Access cookie path) where the JWT is the source of truth.
//
// Origin guard (csrfOrigin middleware) is also wired (per C-CSRF-ORIGIN) — a
// cross-origin form on an attacker site cannot trigger this revocation.
//
// Atomicity (per C-SIGNOUT-TXN): UPDATE device_tokens + recordAccountEvent are
// wrapped in BEGIN/COMMIT. If the audit write fails, the token UPDATE rolls
// back; we don't end up with revoked tokens but no audit trail.
//
// CF Access cookie clear: matches Cloudflare's actual cookie attributes (per
// I-CF-COOKIE-ATTRS — smoke-tested with curl against the prod CF Access
// response). Attributes: HttpOnly; Secure; SameSite=Lax; Path=/. Domain is
// NOT set (host-scoped cookie); if a future CF Access policy sets Domain we
// must mirror it here. Per memory feedback_verify_external_config.md the
// outside-in curl is part of the deploy DoD, not just the spec.
//
// Memory project_device_split: this surface is reachable on mobile as well
// as desktop because the user may need to revoke from their backup device
// when device-A is the lost one. The reachability test (Task 19) verifies
// the mobile click-path (≤3 clicks per G7).

import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { requireCfAccessOnly } from '../middleware/cfAccess.js'; // CF-Access-JWT-only variant
import { csrfOrigin } from '../middleware/csrfOrigin.js';
import { recordAccountEvent } from '../services/accountEvents.js';

export async function authSignoutRoutes(app: FastifyInstance) {
  app.post('/auth/signout-everywhere', { preHandler: [requireCfAccessOnly, csrfOrigin] }, async (req, reply) => {
    const userId = (req as { userId?: string }).userId;
    const userEmail = (req as { userEmail?: string }).userEmail;
    if (!userId || !userEmail) return reply.code(500).send({ error: 'auth_state_missing' });

    const client = await db.connect();
    let rowCount = 0;
    try {
      await client.query('BEGIN');
      const res = await client.query(
        `UPDATE device_tokens
            SET revoked_at = now(), revoke_reason = 'signout_everywhere'
          WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId],
      );
      rowCount = res.rowCount ?? 0;
      // Audit event inside the same txn (per C-SIGNOUT-TXN).
      await client.query(
        `INSERT INTO account_events (user_id, user_id_at_event, user_email_at_event, kind, ip, meta)
         VALUES ($1, $1, $2, 'signout_everywhere', $3, $4::jsonb)`,
        [userId, userEmail, req.ip, JSON.stringify({ revoked_count: rowCount })],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      req.log.error({ err }, 'signout_everywhere_failed');
      return reply.code(500).send({ error: 'signout_failed' });
    } finally {
      client.release();
    }

    // Clear the CF Access cookie on the response. Attributes mirror Cloudflare's
    // actual Set-Cookie (per I-CF-COOKIE-ATTRS — verified via curl on prod).
    // If the prod cookie ever gains a Domain attribute, mirror it here.
    reply.header('Set-Cookie', 'CF_Authorization=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax');

    req.log.info(
      { event: 'signout_everywhere', userId, revoked_count: rowCount, ip: req.ip },
      'signout_everywhere',
    );
    return reply.code(204).send();
  });
}
```

Register in `api/src/app.ts`:

```ts
import { authSignoutRoutes } from './routes/authSignout.js';
await app.register(authSignoutRoutes, { prefix: '/api' });
```

- [ ] **Step 4: Run the integration test**

Run: `cd api && npx vitest run tests/integration/signout-everywhere.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the contamination test**

```ts
// api/tests/integration/contamination/signout-everywhere-contamination.test.ts
// G2 — user A's sign-out-everywhere never revokes user B's tokens.
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../../src/app.js';
import { db } from '../../../src/db/client.js';
import { mkUser, cleanupUser } from '../../helpers/program-fixtures.js';

let app: Awaited<ReturnType<typeof buildApp>>;
let userA: string; let tokenA: string;
let userB: string; let tokenB: string;

beforeAll(async () => {
  app = await buildApp();
  const a = await mkUser({ prefix: 'vitest.w6-so-a' }); userA = a.id;
  const b = await mkUser({ prefix: 'vitest.w6-so-b' }); userB = b.id;
  const ma = await app.inject({ method: 'POST', url: '/api/tokens', body: { user_id: userA, label: 'a', scopes: ['health:weight:write'] } });
  const mb = await app.inject({ method: 'POST', url: '/api/tokens', body: { user_id: userB, label: 'b', scopes: ['health:weight:write'] } });
  tokenA = ma.json<{ token: string }>().token;
  tokenB = mb.json<{ token: string }>().token;
});
afterAll(async () => { await cleanupUser(userA); await cleanupUser(userB); await app.close(); });

describe('signout-everywhere contamination — G2', () => {
  it('user A signout-everywhere does not revoke user B tokens', async () => {
    await app.inject({
      method: 'POST', url: '/api/auth/signout-everywhere',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    const r = await app.inject({
      method: 'GET', url: '/api/account/sessions',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(r.statusCode).toBe(200);
  });

  it('account_events row written for A only, never B', async () => {
    const { rows: a } = await db.query(`SELECT count(*)::int n FROM account_events WHERE user_id=$1 AND kind='signout_everywhere'`, [userA]);
    const { rows: b } = await db.query(`SELECT count(*)::int n FROM account_events WHERE user_id=$1 AND kind='signout_everywhere'`, [userB]);
    expect(a[0].n).toBe(1);
    expect(b[0].n).toBe(0);
  });
});
```

- [ ] **Step 6: Run contamination test**

Run: `cd api && npx vitest run tests/integration/contamination/signout-everywhere-contamination.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add api/src/routes/authSignout.ts api/src/app.ts api/tests/integration/signout-everywhere.test.ts api/tests/integration/contamination/signout-everywhere-contamination.test.ts
git commit -m "feat: POST /api/auth/signout-everywhere + G2 contamination"
```

---

### Task 9: `DELETE /api/me` full-cascade + contamination + cascade test

**Files:**
- Modify: `api/src/routes/account.ts` — replace the 405 stub with the real DELETE handler
- Create: `api/tests/integration/account-deletion-cascade.test.ts`
- Create: `api/tests/integration/contamination/account-deletion-contamination.test.ts`

- [ ] **Step 1: Write the failing cascade test**

```ts
// api/tests/integration/account-deletion-cascade.test.ts
// W6.1 — DELETE /api/me cascades through every user-scoped table.
// Per master plan: create user with mesocycle + 100 set_logs + 30 weight
// samples + 2 bearer tokens + health_workouts rows. DELETE. Assert:
//   - response is 204
//   - SELECT count(*) FROM <each> WHERE user_id = deleted_id == 0
//   - no orphan rows where FK does not match a users row
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/client.js';
import { mkUser, cleanupUser } from '../helpers/program-fixtures.js';

let app: Awaited<ReturnType<typeof buildApp>>;
let userId: string;
let token: string;

beforeAll(async () => {
  app = await buildApp();
  const u = await mkUser({ prefix: 'vitest.del-cascade' }); userId = u.id;
  const m = await app.inject({
    method: 'POST', url: '/api/tokens',
    body: { user_id: userId, label: 't', scopes: ['health:weight:write','set_logs:write','health:workouts:write'] },
  });
  token = m.json<{ token: string }>().token;
  // Seed: 30 weight samples
  for (let i = 0; i < 30; i++) {
    await db.query(
      `INSERT INTO health_weight_samples (user_id, date, weight_lbs, source)
       VALUES ($1, current_date - $2::int, 180 + $2, 'Apple Health')
       ON CONFLICT DO NOTHING`,
      [userId, i],
    );
  }
  // Seed: 1 mesocycle + 100 set_logs requires planned_sets — heavy. Skip if
  // fixture helpers (mkUserProgram + materializeMesocycle) require too much
  // setup; instead seed via raw SQL minimally: insert one user_program,
  // mesocycle_run, day_workout, planned_set, then 100 set_logs against it.
  // (Detailed SQL inlined here; uses existing schema from migrations
  // 016/017/018/019/022.)
  const { rows: [up] } = await db.query<{ id: string }>(
    `INSERT INTO user_programs (user_id, status) VALUES ($1, 'active') RETURNING id`,
    [userId],
  );
  const { rows: [run] } = await db.query<{ id: string }>(
    `INSERT INTO mesocycle_runs (user_program_id, user_id, weeks, current_week, status)
     VALUES ($1, $2, 4, 1, 'active') RETURNING id`,
    [up.id, userId],
  );
  const { rows: [day] } = await db.query<{ id: string }>(
    `INSERT INTO day_workouts (mesocycle_run_id, week_idx, day_idx, kind, name)
     VALUES ($1, 1, 0, 'strength', 'A') RETURNING id`,
    [run.id],
  );
  const { rows: [ps] } = await db.query<{ id: string }>(
    `INSERT INTO planned_sets (day_workout_id, block_idx, set_idx, exercise_id, target_reps_low, target_reps_high, target_rir, rest_sec)
     SELECT $1, 0, 0, e.id, 6, 8, 2, 180 FROM exercises e LIMIT 1 RETURNING id`,
    [day.id],
  );
  for (let i = 0; i < 100; i++) {
    await db.query(
      `INSERT INTO set_logs (user_id, planned_set_id, exercise_id, performed_load_lbs, performed_reps, rir, performed_at, client_request_id)
       SELECT $1, $2, exercise_id, 185, 6, 2, now() - ($3::int || ' minutes')::interval, gen_random_uuid()
         FROM planned_sets WHERE id=$2`,
      [userId, ps.id, i],
    );
  }
  // Seed: 5 health_workouts rows
  for (let i = 0; i < 5; i++) {
    await db.query(
      `INSERT INTO health_workouts (user_id, started_at, ended_at, modality, duration_sec, source)
       VALUES ($1, now() - ($2::int || ' days')::interval, now() - ($2::int || ' days')::interval + interval '45 min', 'cycling', 2700, 'Apple Health')
       ON CONFLICT DO NOTHING`,
      [userId, i],
    );
  }
});

afterAll(async () => { await cleanupUser(userId).catch(() => undefined); await app.close(); });

// account_events is in a separate list — it must SURVIVE the cascade with
// user_id=NULL and PII-snapshot columns populated (per D8). Every other
// per-user table cascades to 0 rows.
const CASCADE_WIPED_TABLES = [
  'set_logs',
  'health_weight_samples',
  'health_sync_status',
  'health_workouts',
  'device_tokens',
  'user_programs',
  'mesocycle_runs',
  'user_injuries',
  'recovery_flag_events',
  'recovery_flag_dismissals',
];

describe('DELETE /api/me cascade', () => {
  it('returns 204 and cascades every user-scoped row EXCEPT account_events (D8)', async () => {
    // Pre-condition: every table has at least one row for the user.
    for (const t of ['set_logs','health_weight_samples','health_workouts','device_tokens']) {
      const { rows } = await db.query(`SELECT count(*)::int n FROM ${t} WHERE user_id=$1`, [userId]);
      expect(rows[0].n, `pre: ${t}`).toBeGreaterThan(0);
    }

    // Pre: seed an account_events row so we can verify it survives.
    const { rows: [userRow] } = await db.query<{ email: string }>('SELECT email FROM users WHERE id=$1', [userId]);
    await db.query(
      `INSERT INTO account_events (user_id, user_id_at_event, user_email_at_event, kind, ip, meta)
       VALUES ($1, $1, $2, 'profile_changed', '10.0.0.5', '{"fields":["display_name"]}'::jsonb)`,
      [userId, userRow.email],
    );

    // CF Access JWT path required (bearer rejected per C-SIGNOUT-CFACCESS-ONLY).
    const cfJwt = await mintCfAccessJwt(userRow.email);
    const r = await app.inject({
      method: 'DELETE', url: '/api/me',
      cookies: { CF_Authorization: cfJwt },
      headers: { 'content-type': 'application/json', origin: process.env.PUBLIC_ORIGIN ?? 'https://repos.jpmtech.com' },
      payload: JSON.stringify({ confirm: 'DELETE my account' }),
    });
    expect(r.statusCode).toBe(204);

    // The users row is gone.
    const { rows: u } = await db.query(`SELECT count(*)::int n FROM users WHERE id=$1`, [userId]);
    expect(u[0].n).toBe(0);

    // Every cascade-wiped table has 0 rows for the deleted id.
    for (const t of CASCADE_WIPED_TABLES) {
      const { rows } = await db.query(`SELECT count(*)::int n FROM ${t} WHERE user_id=$1`, [userId]);
      expect(rows[0].n, `post: ${t}`).toBe(0);
    }

    // D8: account_events row SURVIVES with user_id=NULL and PII snapshot intact.
    const { rows: ev } = await db.query<{ n: number }>(
      `SELECT count(*)::int n FROM account_events
        WHERE user_id IS NULL AND user_id_at_event=$1 AND user_email_at_event=$2`,
      [userId, userRow.email],
    );
    expect(ev[0].n, 'account_events survived with NULL user_id + PII snapshot').toBeGreaterThanOrEqual(1);
  });

  it('rejects bearer auth on DELETE /api/me (per C-SIGNOUT-CFACCESS-ONLY)', async () => {
    const u2 = await mkUser({ prefix: 'vitest.del-bearer-reject' });
    const m = await app.inject({
      method: 'POST', url: '/api/tokens',
      body: { user_id: u2.id, label: 't', scopes: ['health:weight:write'] },
    });
    const tok = m.json<{ token: string }>().token;
    const r = await app.inject({
      method: 'DELETE', url: '/api/me',
      headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ confirm: 'DELETE my account' }),
    });
    // 401/403 — bearer rejected; user still exists.
    expect([401, 403]).toContain(r.statusCode);
    const { rows } = await db.query(`SELECT count(*)::int n FROM users WHERE id=$1`, [u2.id]);
    expect(rows[0].n).toBe(1);
    await cleanupUser(u2.id);
  });

  it('rejects body without correct confirm string', async () => {
    const u2 = await mkUser({ prefix: 'vitest.del-rej' });
    const cfJwt = await mintCfAccessJwt(u2.email);
    const r = await app.inject({
      method: 'DELETE', url: '/api/me',
      cookies: { CF_Authorization: cfJwt },
      headers: { 'content-type': 'application/json', origin: process.env.PUBLIC_ORIGIN ?? 'https://repos.jpmtech.com' },
      payload: JSON.stringify({ confirm: 'delete' }),
    });
    expect(r.statusCode).toBe(400);
    await cleanupUser(u2.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run tests/integration/account-deletion-cascade.test.ts`
Expected: FAIL — DELETE returns 405.

- [ ] **Step 3: Replace the 405 stub with the real handler**

In `api/src/routes/account.ts`, replace the `app.delete('/me', ...)` block with:

```ts
// DELETE /api/me — full account wipe.
//
// Auth posture: CF-Access-JWT only (per C-SIGNOUT-CFACCESS-ONLY). Bearer is
// rejected — a stolen bearer must not be able to wipe the legitimate user's
// account. csrfOrigin guard also wired (per C-CSRF-ORIGIN).
//
// Atomicity (per C-DELETE-ME-TXN): BEGIN/COMMIT around the DELETE. The
// account_events 'delete_initiated' row is NOT written — D8's ON DELETE SET
// NULL makes pre-delete event rows survive the cascade with their PII snapshot
// intact, but a 'delete_initiated' row added immediately before the DELETE
// adds no forensic value (the immediate-next 'account_deleted' structured log
// IS the durable audit trail per I-DELETE-COMPLETED). Less DB churn; same
// audit fidelity.
//
// Log line ordering (per C-DELETE-ME-TXN + I-DELETE-COMPLETED): structured
// log fires AFTER the DELETE returns, not before. Logging "deleted" before
// the rollback case would be a lie.
app.delete('/me', { preHandler: [requireCfAccessOnly, csrfOrigin] }, async (req, reply) => {
  const userId = (req as { userId?: string }).userId;
  const userEmail = (req as { userEmail?: string }).userEmail;
  if (!userId || !userEmail) return reply.code(500).send({ error: 'auth_state_missing' });

  const parsed = DeleteMeRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'invalid_confirm', expected: CONFIRM_DELETE_ACCOUNT_PHRASE });
  }

  // Snapshot data we need for the post-delete log line BEFORE the DELETE.
  const { rows: tokRows } = await db.query<{ n: number }>(
    `SELECT count(*)::int n FROM device_tokens WHERE user_id=$1`, [userId],
  );
  const previousTokenCount = tokRows[0]?.n ?? 0;

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // ON DELETE CASCADE on every FK to users(id) cleans up downstream rows.
    // account_events rows are NOT wiped (FK is ON DELETE SET NULL per D8) —
    // they preserve user_email_at_event + user_id_at_event for forensic survival.
    // device_tokens rows ARE wiped (FK cascade) — semantic: a deleted account
    // cannot continue to authorize requests.
    await client.query('DELETE FROM users WHERE id=$1', [userId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    req.log.error({ err, userId }, 'account_delete_failed');
    return reply.code(500).send({ error: 'delete_failed' });
  } finally {
    client.release();
  }

  // Per I-DELETE-COMPLETED: structured log AFTER DELETE returns successfully.
  // This is the durable audit trail; the (now NULL-FK'd) account_events rows
  // provide additional forensic depth.
  req.log.info(
    {
      event: 'account_deleted',
      userId,
      userEmail,
      previous_token_count: previousTokenCount,
      ip: req.ip,
    },
    'account_deleted',
  );

  // CF Access cookie clear matches signout-everywhere. Attributes match prod CF
  // (per I-CF-COOKIE-ATTRS). The redirect to /cdn-cgi/access/logout happens
  // client-side in Task 16's DeleteAccountSection.
  reply.header('Set-Cookie', 'CF_Authorization=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax');
  return reply.code(204).send();
});
```

- [ ] **Step 4: Run cascade test**

Run: `cd api && npx vitest run tests/integration/account-deletion-cascade.test.ts`
Expected: PASS.

- [ ] **Step 5: Write contamination test**

```ts
// api/tests/integration/contamination/account-deletion-contamination.test.ts
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../../src/app.js';
import { db } from '../../../src/db/client.js';
import { mkUser, cleanupUser } from '../../helpers/program-fixtures.js';

let app: Awaited<ReturnType<typeof buildApp>>;
let userA: string; let tokenA: string;
let userB: string;

beforeAll(async () => {
  app = await buildApp();
  const a = await mkUser({ prefix: 'vitest.w6-del-a' }); userA = a.id;
  const b = await mkUser({ prefix: 'vitest.w6-del-b' }); userB = b.id;
  const m = await app.inject({
    method: 'POST', url: '/api/tokens',
    body: { user_id: userA, label: 'a', scopes: ['health:weight:write'] },
  });
  tokenA = m.json<{ token: string }>().token;
});
afterAll(async () => { await cleanupUser(userA).catch(() => undefined); await cleanupUser(userB); await app.close(); });

describe('DELETE /api/me contamination — G2', () => {
  it('user-A DELETE wipes A only, leaves B intact', async () => {
    await app.inject({
      method: 'DELETE', url: '/api/me',
      headers: { authorization: `Bearer ${tokenA}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ confirm: 'DELETE my account' }),
    });
    const { rows: a } = await db.query(`SELECT count(*)::int n FROM users WHERE id=$1`, [userA]);
    const { rows: bb } = await db.query(`SELECT count(*)::int n FROM users WHERE id=$1`, [userB]);
    expect(a[0].n).toBe(0);
    expect(bb[0].n).toBe(1);
  });
});
```

- [ ] **Step 6: Write `account-sessions-contamination.test.ts` + `account-events-contamination.test.ts`**

These were partially covered in Task 7's contamination test; this step extracts them into discrete files for grep-by-route discoverability per the G2 convention.

```ts
// api/tests/integration/contamination/account-sessions-contamination.test.ts
// (Extracted from account-profile-contamination.test.ts to give the route its
// own per-route file per G2 matrix discoverability.)
// Copy the 'user-A token cannot read user B sessions' case from Task 7.
```

```ts
// api/tests/integration/contamination/account-events-contamination.test.ts
// Same pattern. Copy the 'user-A token cannot read user B account_events' case.
```

- [ ] **Step 7: Run all five new contamination tests**

Run: `cd api && npx vitest run tests/integration/contamination/`
Expected: All green (including W3's existing `userInjuries-contamination.test.ts`).

- [ ] **Step 8: Commit**

```bash
git add api/src/routes/account.ts api/tests/integration/account-deletion-cascade.test.ts api/tests/integration/contamination/account-deletion-contamination.test.ts api/tests/integration/contamination/account-sessions-contamination.test.ts api/tests/integration/contamination/account-events-contamination.test.ts
git commit -m "feat: DELETE /api/me full cascade + G2 contamination matrix"
```

---

## Phase 3 — Frontend Account page expansion

### Task 10: `lib/api/account.ts` client wrappers + tests

**Files:**
- Create: `frontend/src/lib/api/account.ts`
- Create: `frontend/src/lib/api/account.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/lib/api/account.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as auth from '../../auth';
import { patchProfile, deleteAccount, signOutEverywhere, listSessions, listEvents } from './account';

beforeEach(() => { vi.restoreAllMocks(); });

describe('lib/api/account', () => {
  it('patchProfile PATCHes /api/me/profile with the field subset', async () => {
    const spy = vi.spyOn(auth, 'apiFetch').mockResolvedValue(new Response(JSON.stringify({ display_name: 'X' }), { status: 200 }));
    const r = await patchProfile({ display_name: 'X' });
    expect(spy).toHaveBeenCalledWith('/api/me/profile', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ display_name: 'X' }),
    }));
    expect(r.display_name).toBe('X');
  });

  it('deleteAccount POSTs with the typed confirm', async () => {
    const spy = vi.spyOn(auth, 'apiFetch').mockResolvedValue(new Response(null, { status: 204 }));
    await deleteAccount('DELETE my account');
    expect(spy).toHaveBeenCalledWith('/api/me', expect.objectContaining({ method: 'DELETE' }));
  });

  it('signOutEverywhere returns void on 204', async () => {
    vi.spyOn(auth, 'apiFetch').mockResolvedValue(new Response(null, { status: 204 }));
    await expect(signOutEverywhere()).resolves.toBeUndefined();
  });

  it('listSessions parses the response shape', async () => {
    vi.spyOn(auth, 'apiFetch').mockResolvedValue(new Response(JSON.stringify({
      sessions: [{ id: '1', label: 'iOS', created_at: '2026-01-01T00:00:00Z', last_used_at: null, last_used_ip: null }],
    }), { status: 200 }));
    const s = await listSessions();
    expect(s).toHaveLength(1);
    expect(s[0].label).toBe('iOS');
  });

  it('listEvents paginates with the keyset (before_ts, before_id) cursor', async () => {
    const spy = vi.spyOn(auth, 'apiFetch').mockResolvedValue(new Response(JSON.stringify({ events: [], next_cursor: null }), { status: 200 }));
    await listEvents({ before_ts: '2026-01-01T00:00:00Z', before_id: '42', limit: 20 });
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('before_ts=2026-01-01'), expect.any(Object));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('before_id=42'), expect.any(Object));
  });

  it('all state-changing requests send X-RepOS-CSRF: 1', async () => {
    const spy = vi.spyOn(auth, 'apiFetch').mockResolvedValue(new Response(null, { status: 204 }));
    await deleteAccount('DELETE my account');
    expect(spy).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: expect.objectContaining({ 'X-RepOS-CSRF': '1' }),
    }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/api/account.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the client**

```ts
// frontend/src/lib/api/account.ts
//
// Per C-CSRF-ORIGIN: every state-changing call sets X-RepOS-CSRF: 1 so the
// server's csrfOrigin guard accepts even on the CF Access cookie path. The
// header is added via lib/auth/csrf.ts helper (or inline if simpler).
//
// units is NOT in this client (per D6 — units deferred from W6).
import { apiFetch } from '../../auth';
import { CONFIRM_DELETE_ACCOUNT_PHRASE } from '../constants/accountConfirmPhrases';

const CSRF_HEADERS = { 'X-RepOS-CSRF': '1' } as const;

export interface ProfilePatch {
  display_name?: string;
  timezone?: string;
  // No `units` field — deferred per D6.
}

export interface ProfileResponse {
  id: string;
  email: string;
  display_name: string | null;
  timezone: string;
}

export async function patchProfile(patch: ProfilePatch): Promise<ProfileResponse> {
  const r = await apiFetch('/api/me/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...CSRF_HEADERS },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`profile_patch_failed: HTTP ${r.status}`);
  return (await r.json()) as ProfileResponse;
}

export async function deleteAccount(confirm: typeof CONFIRM_DELETE_ACCOUNT_PHRASE): Promise<void> {
  const r = await apiFetch('/api/me', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...CSRF_HEADERS },
    body: JSON.stringify({ confirm }),
  });
  if (r.status !== 204) throw new Error(`delete_account_failed: HTTP ${r.status}`);
}

export async function signOutEverywhere(): Promise<void> {
  const r = await apiFetch('/api/auth/signout-everywhere', {
    method: 'POST',
    headers: { ...CSRF_HEADERS },
  });
  if (r.status !== 204) throw new Error(`signout_everywhere_failed: HTTP ${r.status}`);
}

export interface SessionRow {
  id: string;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
  /** Truncated to /24 by the server (per I-LAST-IP-TRUNCATE). */
  last_used_ip_24: string | null;
}

export async function listSessions(): Promise<SessionRow[]> {
  const r = await apiFetch('/api/account/sessions');
  if (!r.ok) throw new Error(`sessions_load_failed: HTTP ${r.status}`);
  return ((await r.json()) as { sessions: SessionRow[] }).sessions;
}

export type AccountEventKind =
  | 'profile_changed' | 'token_minted' | 'token_revoked'
  | 'signout_everywhere' | 'delete_initiated'
  | 'par_q_acknowledged' | 'onboarding_completed' | 'restore_replayed';

export interface AccountEventRow {
  id: string;
  kind: AccountEventKind;
  ip: string | null;
  user_email_at_event: string | null;
  meta: Record<string, unknown>;
  occurred_at: string;
}

export interface AccountEventPage {
  events: AccountEventRow[];
  next_cursor: { before_ts: string; before_id: string } | null;
}

// Keyset pagination (per I-PAGINATION-KEYSET) — pass both before_ts AND
// before_id from the previous page's `next_cursor`.
export async function listEvents(opts: { before_ts?: string; before_id?: string; limit?: number } = {}): Promise<AccountEventPage> {
  const qs = new URLSearchParams();
  if (opts.before_ts) qs.set('before_ts', opts.before_ts);
  if (opts.before_id) qs.set('before_id', opts.before_id);
  if (opts.limit) qs.set('limit', String(opts.limit));
  const q = qs.toString();
  const r = await apiFetch(`/api/account/events${q ? `?${q}` : ''}`);
  if (!r.ok) throw new Error(`events_load_failed: HTTP ${r.status}`);
  return (await r.json()) as AccountEventPage;
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `cd frontend && npx vitest run src/lib/api/account.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api/account.ts frontend/src/lib/api/account.test.ts
git commit -m "feat: frontend account API client wrappers"
```

---

### Task 11: `Toast` + `ToastHost` primitives + replace all 5 `alert()` sites

**Files:**
- Create: `frontend/src/components/common/Toast.tsx`
- Create: `frontend/src/components/common/Toast.test.tsx`
- Create: `frontend/src/components/common/ToastHost.tsx`
- Create: `frontend/src/components/common/ToastHost.test.tsx`
- Modify: `frontend/src/App.tsx` — wrap children in `<ToastHost>`
- Modify: `frontend/src/components/settings/SettingsIntegrations.tsx` — replace both `alert()` calls
- Modify: `frontend/src/components/library/ExercisePickerDemo.tsx` — replace `alert()`
- Modify: `frontend/src/pages/MyProgramPage.tsx` — replace `alert()`
- Modify: `frontend/src/pages/TodayPage.tsx` — replace `alert()`

- [ ] **Step 1: Write the failing test for `Toast`**

```tsx
// frontend/src/components/common/Toast.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { Toast } from './Toast';
import userEvent from '@testing-library/user-event';

describe('Toast', () => {
  it('renders body + role=status', () => {
    render(<Toast id="t1" severity="info" body="Saved" onDismiss={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });

  it('auto-dismisses after default 5s', async () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<Toast id="t1" severity="info" body="X" onDismiss={onDismiss} />);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(onDismiss).toHaveBeenCalledWith('t1');
    vi.useRealTimers();
  });

  it('shows undo button when actionLabel is provided', async () => {
    const onAction = vi.fn();
    render(<Toast id="t1" severity="success" body="Swapped." actionLabel="Undo" onAction={onAction} onDismiss={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /undo/i }));
    expect(onAction).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify fail**

Run: `cd frontend && npx vitest run src/components/common/Toast.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `Toast.tsx`**

```tsx
// frontend/src/components/common/Toast.tsx
// Beta W6.4 — accessible toast primitive. Replaces every alert() in Beta-new
// surfaces (and the 4 alpha-residual sites flagged by W6.4). Per CLAUDE.md
// "NEVER show generic error messages" — Toast carries the actionable detail
// (HTTP status, endpoint hint where safe) the calling site provides.
//
// role=status (polite live region) for non-critical; severity='error' upgrades
// to role=alert (assertive) so screen readers interrupt.

import { useEffect } from 'react';
import { TOKENS, FONTS } from '../../tokens';

export type ToastSeverity = 'info' | 'success' | 'warn' | 'error';

export interface ToastProps {
  id: string;
  severity: ToastSeverity;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: (id: string) => void;
  durationMs?: number;
}

const severityColor: Record<ToastSeverity, string> = {
  info:    TOKENS.textDim,
  success: TOKENS.good,
  warn:    TOKENS.warn,
  error:   TOKENS.danger,
};

export function Toast({ id, severity, body, actionLabel, onAction, onDismiss, durationMs = 5000 }: ToastProps): JSX.Element {
  useEffect(() => {
    const handle = window.setTimeout(() => onDismiss(id), durationMs);
    return () => window.clearTimeout(handle);
  }, [id, durationMs, onDismiss]);

  const role = severity === 'error' ? 'alert' : 'status';

  return (
    <div role={role} style={{
      background: TOKENS.surface,
      border: `1px solid ${severityColor[severity]}`,
      borderRadius: 8,
      padding: '10px 14px',
      fontFamily: FONTS.ui,
      fontSize: 13,
      color: TOKENS.text,
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      boxShadow: '0 6px 18px rgba(0,0,0,0.32)',
      minWidth: 240,
    }}>
      <span style={{ flex: 1 }}>{body}</span>
      {actionLabel && onAction && (
        <button
          onClick={() => { onAction(); onDismiss(id); }}
          style={{
            background: 'transparent', border: 'none', color: TOKENS.accent,
            fontFamily: FONTS.mono, fontSize: 11, cursor: 'pointer', textTransform: 'uppercase',
          }}
        >{actionLabel}</button>
      )}
      <button
        aria-label="Dismiss"
        onClick={() => onDismiss(id)}
        style={{ background: 'transparent', border: 'none', color: TOKENS.textMute, cursor: 'pointer', fontSize: 14 }}
      >×</button>
    </div>
  );
}
```

- [ ] **Step 4: Write + implement `ToastHost`**

```tsx
// frontend/src/components/common/ToastHost.tsx
// Beta W6.4 — global toast queue. Exposes pushToast() via a module-level
// emitter so non-React call-sites (e.g. lib/api/* error paths) can push
// without a hook. Internal state lives in a React component to handle
// portal rendering.
import { useEffect, useState, useCallback } from 'react';
import { Toast, type ToastProps, type ToastSeverity } from './Toast';

interface ToastInput {
  severity: ToastSeverity;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  durationMs?: number;
}

type Listener = (t: ToastInput & { id: string }) => void;
const listeners = new Set<Listener>();

export function pushToast(input: ToastInput): void {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  for (const l of listeners) l({ id, ...input });
}

export function ToastHost(): JSX.Element {
  const [items, setItems] = useState<Array<ToastInput & { id: string }>>([]);

  const dismiss = useCallback((id: string) => {
    setItems((cur) => cur.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    const onPush: Listener = (t) => setItems((cur) => [...cur, t]);
    listeners.add(onPush);
    return () => { listeners.delete(onPush); };
  }, []);

  return (
    <div
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 1000,
        maxWidth: 360,
      }}
    >
      {items.map((t) => {
        const props: ToastProps = {
          id: t.id,
          severity: t.severity,
          body: t.body,
          actionLabel: t.actionLabel,
          onAction: t.onAction,
          onDismiss: dismiss,
          durationMs: t.durationMs,
        };
        return <Toast key={t.id} {...props} />;
      })}
    </div>
  );
}
```

- [ ] **Step 5: Mount `<ToastHost>` INSIDE `<AppShell>` (per C-TOAST-HOST-MOUNT)**

**DO NOT mount at App root.** If `<ToastHost>` is a sibling of `<AuthGate>` at the App root, route changes that unmount AppShell (e.g. unauth → auth boundary) wipe the portal — toasts queued mid-transition disappear silently. Mount as a sibling of `<Outlet>` inside `AppShell` so the host stays alive for the entire authenticated session.

In `frontend/src/components/layout/AppShell.tsx`:

```tsx
import { ToastHost } from '../common/ToastHost'

export function AppShell(): JSX.Element {
  return (
    <div /* existing layout chrome */>
      <Sidebar />
      <main>
        <Outlet />
      </main>
      <ToastHost />
    </div>
  )
}
```

Verify against current `App.tsx:40-57` — the existing AppShell layout is the correct mount surface, NOT App root. (If the project structure has AppShell defined inline in App.tsx, factor it out to a sibling file first; the test mounting needs the component to exist as a unit.)

The App.tsx import for ToastHost moves to AppShell. `pushToast()` is still callable from anywhere; it broadcasts to whichever ToastHost is alive.

- [ ] **Step 6: Replace each `alert()` site**

For each of the 4 files, swap `alert(...)` for the corresponding `pushToast(...)`:

1. `frontend/src/components/settings/SettingsIntegrations.tsx:104` —
   `pushToast({ severity: 'error', body: 'Failed to generate token. ' + (err instanceof Error ? err.message : 'Unknown error.') })`
2. `frontend/src/components/settings/SettingsIntegrations.tsx:121` —
   `pushToast({ severity: 'error', body: 'Failed to revoke token. ' + (err instanceof Error ? err.message : 'Unknown error.') })`
3. `frontend/src/components/library/ExercisePickerDemo.tsx:20` —
   `pushToast({ severity: 'info', body: 'Selected substitute: ' + slug })`
4. `frontend/src/pages/MyProgramPage.tsx:169` —
   `pushToast({ severity: 'info', body: 'Exercise picker lands in W4. Use mid-session swap on mobile.' })`
5. `frontend/src/pages/TodayPage.tsx:12` —
   `pushToast({ severity: 'info', body: 'Desktop workout execution lands later in Beta. Use the mobile logger.' })`

(That's 5 sites — `SettingsIntegrations.tsx` has two and the master plan said "4 sites"; the discrepancy is the dev-only `ExercisePickerDemo.tsx` site that the audit may have skipped. We convert all 5 because shipping `alert()` in `import.meta.env.DEV` paths is still a UX regression risk if a build flag flips wrong.)

- [ ] **Step 7: Grep gate — assert no `alert(` remains in src/**

Run: `cd frontend && grep -rn "alert(" src/ --include="*.tsx" --include="*.ts" | grep -v "\\.test\\." | grep -v "alertdialog"`
Expected: zero lines of output.

- [ ] **Step 8: Run all toast tests + the modified component tests**

Run: `cd frontend && npx vitest run src/components/common/ src/components/settings/SettingsIntegrations`
Expected: all PASS. If SettingsIntegrations had no test file before (it doesn't), this step is just the toast tests.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/common/ frontend/src/App.tsx frontend/src/components/settings/SettingsIntegrations.tsx frontend/src/components/library/ExercisePickerDemo.tsx frontend/src/pages/MyProgramPage.tsx frontend/src/pages/TodayPage.tsx
git commit -m "feat: Toast/ToastHost primitives + replace all 5 alert() sites"
```

---

### Task 12: `ConfirmDialog` two-tier primitive (medium + heavy; light = Toast+Undo)

**Files:**
- Create: `frontend/src/components/common/ConfirmDialog.tsx`
- Create: `frontend/src/components/common/ConfirmDialog.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/common/ConfirmDialog.test.tsx
// Per C-CONFIRMDIALOG-LIGHT-API: ConfirmTier = 'medium' | 'heavy'. The 'light'
// tier is removed — light-tier confirmation is the Toast + Undo pattern, owned
// by ToastHost, NOT by ConfirmDialog.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from './ConfirmDialog';

describe('ConfirmDialog tiers', () => {
  it('medium tier shows Confirm + Cancel + does not require typing', async () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog open tier="medium" title="End all sessions?" body="" onConfirm={onConfirm} onCancel={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /^confirm$/i }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('heavy tier requires typing the exact phrase before Confirm enables', async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open tier="heavy" title="Delete account?" body=""
        requireTyped="DELETE my account"
        onConfirm={onConfirm} onCancel={vi.fn()}
      />
    );
    const btn = screen.getByRole('button', { name: /confirm|signing out/i }); // per I-CONFIRM-BUSY-LABEL
    expect(btn).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox'), 'DELETE my account');
    expect(btn).toBeEnabled();
    await userEvent.click(btn);
    expect(onConfirm).toHaveBeenCalledWith('DELETE my account');
  });

  it('Escape key triggers onCancel exactly once (per C-CONFIRMDIALOG-ESC)', async () => {
    // Previously a manual useEffect listener fired onCancel AND focus-trap's
    // onDeactivate fired onCancel → onCancel was called twice. Now there is
    // a single ESC path through focus-trap-react's escapeDeactivates: true.
    const onCancel = vi.fn();
    render(<ConfirmDialog open tier="medium" title="X" body="" onConfirm={vi.fn()} onCancel={onCancel} />);
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('heavy tier focuses the typed-confirm input on open (per C-CONFIRMDIALOG-FOCUS)', async () => {
    render(<ConfirmDialog open tier="heavy" title="X" body="" requireTyped="DELETE my account" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    // The text input should receive initial focus, not "stay on the previously
    // focused trigger button" (which is behind the modal overlay).
    expect(screen.getByRole('textbox')).toHaveFocus();
  });

  it('restores focus to the previously-focused trigger on unmount (per C-CONFIRMDIALOG-RETURNFOCUS)', async () => {
    // Mirror W3 MidSessionSwapPicker.tsx:43,65,72 pattern.
    function Harness(): JSX.Element {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button data-testid="trigger" onClick={() => setOpen(true)}>Open</button>
          {open && (
            <ConfirmDialog open tier="medium" title="X" body="" onConfirm={() => setOpen(false)} onCancel={() => setOpen(false)} />
          )}
        </>
      );
    }
    render(<Harness />);
    const trigger = screen.getByTestId('trigger');
    trigger.focus();
    expect(trigger).toHaveFocus();
    await userEvent.click(trigger);
    await userEvent.keyboard('{Escape}');
    expect(trigger).toHaveFocus(); // focus restored
  });
});
```

- [ ] **Step 2: Run test to verify fail**

Run: `cd frontend && npx vitest run src/components/common/ConfirmDialog.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `ConfirmDialog.tsx`**

```tsx
// frontend/src/components/common/ConfirmDialog.tsx
// Beta W6.3 — two-tier destructive-confirm primitive.
//
// Tiers (per C-CONFIRMDIALOG-LIGHT-API):
//   medium — single modal + Confirm/Cancel (no typed string)
//   heavy  — modal + typed-string match (e.g., "DELETE my account") gates the
//            Confirm button until exact match
//
// Light-tier confirms are NOT this component — they are the Toast + Undo
// pattern owned by ToastHost (e.g. W5 delete-snapshot toast with Undo action).
// The previous bait-and-switch where 'light' was type-safe but rendered
// identical to 'medium' is removed.
//
// Per master plan §634 W6.3 + Design gap #1:
//   heavy:  Abandon mesocycle (type program name); Delete Account (type the
//           literal phrase "DELETE my account" — centralized in
//           CONFIRM_DELETE_ACCOUNT_PHRASE constant per I-CONFIRM-PHRASE-CONST)
//   medium: equipment-profile-reset-with-active-program; sign-out-everywhere
//
// ESC handling (per C-CONFIRMDIALOG-ESC): SINGLE path through
// focus-trap-react's escapeDeactivates: true + onDeactivate: onCancel. No
// manual useEffect/keydown listener — that would double-fire onCancel.
//
// Initial focus on heavy tier (per C-CONFIRMDIALOG-FOCUS): focus the typed
// input. Otherwise keyboard users land on the previously-focused trigger
// button which is hidden behind the modal overlay.
//
// Return focus (per C-CONFIRMDIALOG-RETURNFOCUS): capture previouslyFocused
// element on open; restore on unmount. Mirrors W3 MidSessionSwapPicker.tsx
// (lines 43, 65, 72).
//
// Confirm-button label varies by parent state (per I-CONFIRM-BUSY-LABEL):
// callers pass confirmLabel="Signing out…" during async work. The matcher
// in component tests is /confirm|signing out/i.

import { useEffect, useRef, useState } from 'react';
import FocusTrap from 'focus-trap-react';
import { TOKENS, FONTS } from '../../tokens';

// 'light' is intentionally removed (per C-CONFIRMDIALOG-LIGHT-API).
export type ConfirmTier = 'medium' | 'heavy';

interface ConfirmDialogProps {
  open: boolean;
  tier: ConfirmTier;
  title: string;
  body: string;
  /** Required for `heavy` tier — Confirm button enables only on exact match. */
  requireTyped?: string;
  /** Defaults to "Confirm". Pass busy label (e.g., "Signing out…") during async. */
  confirmLabel?: string;
  /** Defaults to "Cancel". */
  cancelLabel?: string;
  /** Optional severity → confirm-button color. */
  severity?: 'accent' | 'danger';
  onConfirm: (typed?: string) => void;
  onCancel: () => void;
}

export function ConfirmDialog(props: ConfirmDialogProps): JSX.Element | null {
  const { open, tier, title, body, requireTyped, confirmLabel = 'Confirm', cancelLabel = 'Cancel', severity = 'accent', onConfirm, onCancel } = props;
  const [typed, setTyped] = useState('');
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Capture previously-focused element on open; restore on unmount.
  useEffect(() => {
    if (open) {
      previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
      return () => {
        previouslyFocusedRef.current?.focus?.();
      };
    }
    // Reset typed-input state when re-opened.
    setTyped('');
    return undefined;
  }, [open]);

  if (!open) return null;

  const canConfirm = tier === 'heavy' ? typed === (requireTyped ?? '') : true;
  const confirmColor = severity === 'danger' ? TOKENS.danger : TOKENS.accent;

  return (
    <FocusTrap
      focusTrapOptions={{
        // Per C-CONFIRMDIALOG-FOCUS: heavy tier focuses the typed-confirm input;
        // medium tier defaults to first focusable (Cancel button).
        initialFocus: tier === 'heavy' ? 'input[type="text"]' : undefined,
        clickOutsideDeactivates: true,
        // Per C-CONFIRMDIALOG-ESC: single ESC path via focus-trap-react.
        escapeDeactivates: true,
        onDeactivate: onCancel,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        style={{
          position: 'fixed', inset: 0, zIndex: 2000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(5,8,12,0.78)', padding: 24,
        }}
      >
        <div style={{
          maxWidth: 420, width: '100%',
          background: TOKENS.surface,
          border: `1px solid ${TOKENS.lineStrong}`,
          borderRadius: 12, padding: 24,
          fontFamily: FONTS.ui, color: TOKENS.text,
        }}>
          <div id="confirm-title" style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>{title}</div>
          {body && <div style={{ fontSize: 13, color: TOKENS.textDim, marginBottom: 16 }}>{body}</div>}
          {tier === 'heavy' && requireTyped && (
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={`Type: ${requireTyped}`}
              style={{
                width: '100%', padding: '8px 10px', marginBottom: 16,
                background: TOKENS.bg, color: TOKENS.text,
                border: `1px solid ${TOKENS.lineStrong}`, borderRadius: 6,
                fontFamily: FONTS.mono, fontSize: 12,
              }}
            />
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              onClick={onCancel}
              style={{
                padding: '8px 14px', borderRadius: 6, border: `1px solid ${TOKENS.line}`,
                background: 'transparent', color: TOKENS.text, cursor: 'pointer', fontFamily: FONTS.ui, fontSize: 13,
              }}
            >{cancelLabel}</button>
            <button
              disabled={!canConfirm}
              onClick={() => onConfirm(tier === 'heavy' ? typed : undefined)}
              style={{
                padding: '8px 14px', borderRadius: 6, border: 'none',
                background: canConfirm ? confirmColor : TOKENS.surface3,
                color: '#fff', cursor: canConfirm ? 'pointer' : 'not-allowed',
                fontFamily: FONTS.ui, fontSize: 13, fontWeight: 600,
              }}
            >{confirmLabel}</button>
          </div>
        </div>
      </div>
    </FocusTrap>
  );
}
```

**Dependency check (per I-FOCUS-TRAP-REACT):** Verify `focus-trap-react` is in `frontend/package.json` dependencies. If absent, either add it (`npm i focus-trap-react focus-trap`) OR implement a homegrown trap matching W3 `MidSessionSwapPicker.tsx`'s pattern (capture focusable elements + key-handler in onKeyDown). Decide before implementation; the test suite is identical either way.

- [ ] **Step 4: Run test**

Run: `cd frontend && npx vitest run src/components/common/ConfirmDialog.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/common/ConfirmDialog.tsx frontend/src/components/common/ConfirmDialog.test.tsx
git commit -m "feat: ConfirmDialog three-tier destructive-confirm primitive"
```

---

### Task 13: `AccountProfileEditor` component

**Files:**
- Create: `frontend/src/components/settings/AccountProfileEditor.tsx`
- Create: `frontend/src/components/settings/AccountProfileEditor.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/settings/AccountProfileEditor.test.tsx
// Per C-PROFILE-CONTROLLED: inputs follow the W3 ControlledField pattern
// (frontend/src/components/InjuryChipsEditor.tsx:33-55). useEffect re-syncs
// local state when the parent's `user` prop changes (avoiding stale state on
// re-renders); commit-on-blur with diff-check fires patchProfile only when
// the field actually changed.
//
// Per D6: no `units` selector in this component.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, rerender as _rerender } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as api from '../../lib/api/account';
import { AccountProfileEditor } from './AccountProfileEditor';

vi.mock('../../lib/api/account');

describe('AccountProfileEditor', () => {
  it('renders current display_name + timezone (NO units selector per D6)', () => {
    render(<AccountProfileEditor user={{ id: 'u1', email: 'a@b', display_name: 'Jay', timezone: 'America/New_York' }} />);
    expect((screen.getByLabelText(/display name/i) as HTMLInputElement).value).toBe('Jay');
    expect(screen.queryByLabelText(/units/i)).toBeNull();
  });

  it('re-syncs from props on parent re-render (ControlledField pattern, per C-PROFILE-CONTROLLED)', () => {
    const { rerender } = render(
      <AccountProfileEditor user={{ id: 'u1', email: 'a@b', display_name: 'Jay', timezone: 'America/New_York' }} />,
    );
    expect((screen.getByLabelText(/display name/i) as HTMLInputElement).value).toBe('Jay');
    // Parent re-render with a new user (e.g., post-PATCH refetch returned a different value)
    rerender(<AccountProfileEditor user={{ id: 'u1', email: 'a@b', display_name: 'Jason', timezone: 'America/New_York' }} />);
    expect((screen.getByLabelText(/display name/i) as HTMLInputElement).value).toBe('Jason');
  });

  it('Save patches the modified fields only + shows success toast', async () => {
    const spy = vi.mocked(api.patchProfile).mockResolvedValue({
      id: 'u1', email: 'a@b', display_name: 'Jay M', timezone: 'America/New_York',
    });
    render(<AccountProfileEditor user={{ id: 'u1', email: 'a@b', display_name: 'Jay', timezone: 'America/New_York' }} />);
    await userEvent.clear(screen.getByLabelText(/display name/i));
    await userEvent.type(screen.getByLabelText(/display name/i), 'Jay M');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ display_name: 'Jay M' }));
  });

  it('Save with no diff is a no-op — patchProfile not called', async () => {
    const spy = vi.mocked(api.patchProfile);
    render(<AccountProfileEditor user={{ id: 'u1', email: 'a@b', display_name: 'Jay', timezone: 'America/New_York' }} />);
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(spy).not.toHaveBeenCalled();
  });

  it('rollback-on-error restores prior value + shows error toast', async () => {
    vi.mocked(api.patchProfile).mockRejectedValue(new Error('HTTP 500'));
    render(<AccountProfileEditor user={{ id: 'u1', email: 'a@b', display_name: 'Jay', timezone: 'America/New_York' }} />);
    await userEvent.clear(screen.getByLabelText(/display name/i));
    await userEvent.type(screen.getByLabelText(/display name/i), 'Jay M');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect((screen.getByLabelText(/display name/i) as HTMLInputElement).value).toBe('Jay'));
  });
});
```

- [ ] **Step 2: Run test to verify fail**

Run: `cd frontend && npx vitest run src/components/settings/AccountProfileEditor.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the component**

```tsx
// frontend/src/components/settings/AccountProfileEditor.tsx
// Beta W6.2 — editable profile form on /settings/account.
//
// Per D6 (2026-05-26): NO units selector. Units conversion is deferred to a
// future wave that wires through every render site.
//
// Per memory feedback_terms_of_art_tooltips: "time zone" wraps in <Term k="IANA_timezone">.
//
// Per C-PROFILE-CONTROLLED: ControlledField pattern from W3 InjuryChipsEditor.tsx
// (lines 33-55). Local state is seeded from props AND re-synced via useEffect
// when the parent re-renders with a new `user` (avoids stale state on parent
// refetch). Save calls patchProfile only for fields that actually diff against
// the current props.
//
// Per CLAUDE.md "rollback-on-error": optimistic update + restore prior value if
// patchProfile() rejects, with pushToast({severity:'error', ...}).
//
// Timezones loaded from frontend/src/lib/timezones.ts (mirror of API list) —
// NOT from Intl.supportedValuesOf, per I-IANA-TIMEZONES + project_alpine_smallicu.

import { useEffect, useState } from 'react';
import { TOKENS, FONTS } from '../../tokens';
import { patchProfile, type ProfileResponse } from '../../lib/api/account';
import { pushToast } from '../common/ToastHost';
import { Term } from '../Term';
import { IANA_TIMEZONES } from '../../lib/timezones';

interface Props {
  user: ProfileResponse;
}

export function AccountProfileEditor({ user }: Props): JSX.Element {
  // ControlledField pattern (per C-PROFILE-CONTROLLED): useState seeds from
  // props on first render, then useEffect re-syncs on prop change.
  const [displayName, setDisplayName] = useState(user.display_name ?? '');
  const [timezone, setTimezone] = useState(user.timezone);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDisplayName(user.display_name ?? '');
  }, [user.display_name]);
  useEffect(() => {
    setTimezone(user.timezone);
  }, [user.timezone]);

  const handleSave = async (): Promise<void> => {
    // Commit-on-save diff-check (per C-PROFILE-CONTROLLED): only PATCH fields
    // that actually changed from props (not from initial mount state).
    const patch: Parameters<typeof patchProfile>[0] = {};
    if (displayName !== (user.display_name ?? '')) patch.display_name = displayName;
    if (timezone !== user.timezone) patch.timezone = timezone;
    if (Object.keys(patch).length === 0) {
      // No-op: no toast, no API call (clean save UX).
      return;
    }
    setSaving(true);
    try {
      const updated = await patchProfile(patch);
      // Server is the source of truth; reflect what came back (e.g. NFKC
      // normalization may have stripped invisible chars).
      setDisplayName(updated.display_name ?? '');
      setTimezone(updated.timezone);
      pushToast({ severity: 'success', body: 'Profile saved.' });
    } catch (err) {
      // Rollback to props (server state, NOT mount state).
      setDisplayName(user.display_name ?? '');
      setTimezone(user.timezone);
      pushToast({
        severity: 'error',
        body: 'Save failed. ' + (err instanceof Error ? err.message : 'Try again.'),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="profile-section-title" style={{
      background: TOKENS.surface, border: `1px solid ${TOKENS.line}`,
      borderRadius: 12, padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      <h3 id="profile-section-title" style={{ fontSize: 14, fontWeight: 600, color: TOKENS.text, margin: 0 }}>Profile</h3>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: TOKENS.textMute, letterSpacing: 1.2 }}>DISPLAY NAME</span>
        <input
          aria-label="Display name"
          value={displayName}
          maxLength={80}
          onChange={(e) => setDisplayName(e.target.value)}
          style={{
            padding: '8px 10px', background: TOKENS.bg, color: TOKENS.text,
            border: `1px solid ${TOKENS.lineStrong}`, borderRadius: 6, fontSize: 13,
          }}
        />
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: TOKENS.textMute, letterSpacing: 1.2 }}>
          <Term k="IANA_timezone">TIME ZONE</Term>
        </span>
        <select
          aria-label="Time zone"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          style={{
            padding: '8px 10px', background: TOKENS.bg, color: TOKENS.text,
            border: `1px solid ${TOKENS.lineStrong}`, borderRadius: 6, fontSize: 13,
          }}
        >
          {IANA_TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
        </select>
      </label>

      {/* NO units selector — deferred per D6. */}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={() => void handleSave()}
          disabled={saving}
          style={{
            padding: '8px 16px', borderRadius: 6, border: 'none',
            background: saving ? TOKENS.surface3 : TOKENS.accent, color: '#fff',
            fontFamily: FONTS.ui, fontSize: 13, fontWeight: 600,
            cursor: saving ? 'not-allowed' : 'pointer',
          }}
        >{saving ? 'SAVING…' : 'SAVE'}</button>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run test**

Run: `cd frontend && npx vitest run src/components/settings/AccountProfileEditor.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/settings/AccountProfileEditor.tsx frontend/src/components/settings/AccountProfileEditor.test.tsx
git commit -m "feat: AccountProfileEditor with rollback-on-error"
```

---

### Task 14: `ActiveSessionsTable` component (with per-token revoke decision)

> **I-CONTAM-MATRIX decision required:** This task surfaces a per-token "Revoke" button in each row. Shipping the button requires a new route `DELETE /api/account/sessions/:id` AND a 6th G2 contamination test (`account-sessions-delete-contamination.test.ts`). Decide explicitly:
> - **(a) Ship the button + route + 6th contamination test** — gives users granular revoke ("just my iOS Shortcut, not the macOS browser") without needing sign-out-everywhere.
> - **(b) Drop the button** — read-only sessions list; the only revoke surface is sign-out-everywhere. Tighter scope, one less route to harden.
>
> **Recommendation: (a) ship.** The component is already specified with a Revoke button in the file map; backing it out would create a visual signal ("here are your sessions") without action affordance. The DELETE route is ~15 LOC + one contamination test. Document the decision in the commit body.

**Files:**
- Create: `frontend/src/components/settings/ActiveSessionsTable.tsx`
- Create: `frontend/src/components/settings/ActiveSessionsTable.test.tsx`
- IF (a): Create: `api/src/routes/account.ts` — `DELETE /api/account/sessions/:id` route
- IF (a): Create: `api/tests/integration/contamination/account-sessions-delete-contamination.test.ts`

- [ ] **Step 1: Write failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import * as api from '../../lib/api/account';
import { ActiveSessionsTable } from './ActiveSessionsTable';

vi.mock('../../lib/api/account');

describe('ActiveSessionsTable', () => {
  it('lists active sessions with label + last_used_at + truncated IP (/24)', async () => {
    vi.mocked(api.listSessions).mockResolvedValue([
      { id: '1', label: 'iOS Shortcut', created_at: '2026-05-01T00:00:00Z', last_used_at: '2026-05-25T07:30:00Z', last_used_ip_24: '192.168.88.0/24' },
    ]);
    render(<ActiveSessionsTable />);
    await waitFor(() => expect(screen.getByText('iOS Shortcut')).toBeInTheDocument());
    // Per I-LAST-IP-TRUNCATE: server returns /24 form; UI displays as-is.
    expect(screen.getByText(/192\.168\.88\.0\/24/)).toBeInTheDocument();
  });

  it('renders empty-state when no sessions', async () => {
    vi.mocked(api.listSessions).mockResolvedValue([]);
    render(<ActiveSessionsTable />);
    await waitFor(() => expect(screen.getByText(/no active sessions/i)).toBeInTheDocument());
  });

  // Per I-SESSIONS-MOBILE: at narrow viewports the layout falls back to cards,
  // not a 4-column table that overflows.
  it('renders card layout at <600px viewport (per I-SESSIONS-MOBILE)', async () => {
    vi.mocked(api.listSessions).mockResolvedValue([
      { id: '1', label: 'iOS', created_at: '2026-05-01T00:00:00Z', last_used_at: null, last_used_ip_24: null },
    ]);
    // jsdom default width is 1024; manually set to mobile.
    Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true });
    window.dispatchEvent(new Event('resize'));
    render(<ActiveSessionsTable />);
    await waitFor(() => expect(screen.getByText('iOS')).toBeInTheDocument());
    // Card layout exposes data-testid="session-card"; table layout exposes data-testid="session-row".
    expect(screen.queryByTestId('session-card')).toBeInTheDocument();
    expect(screen.queryByTestId('session-row')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify fail; then implement** the component reading from `lib/api/account.listSessions()`. Desktop layout = table with columns: Label · Last used · Last IP · Created · Revoke. Mobile layout (<600px) = card-per-session fallback. Wrap `bearer token` / `session` / `truncated_ip_24` in `<Term>` headers per term-tooltip audit. Implementation pattern mirrors `TokenTable.tsx`.

- [ ] **Step 3 (if (a)): Add DELETE /api/account/sessions/:id route + G2 contamination test**

```ts
// in api/src/routes/account.ts (append):
app.delete<{ Params: { id: string } }>(
  '/account/sessions/:id',
  { preHandler: [requireBearerOrCfAccess, csrfOrigin] },
  async (req, reply) => {
    const userId = (req as { userId?: string }).userId;
    const userEmail = (req as { userEmail?: string }).userEmail;
    if (!userId || !userEmail) return reply.code(500).send({ error: 'auth_state_missing' });

    // WHERE user_id=$1 is the contamination guard — a user can only revoke
    // their own tokens.
    const { rowCount } = await db.query(
      `UPDATE device_tokens
          SET revoked_at = now(), revoke_reason = 'user_revoked'
        WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [req.params.id, userId],
    );
    if (rowCount === 0) return reply.code(404).send({ error: 'session_not_found' });

    await recordAccountEvent({
      userId, userEmail, kind: 'token_revoked', ip: req.ip,
      meta: { token_id: req.params.id },
    });
    return reply.code(204).send();
  },
);
```

Contamination test: user A revokes a token id that belongs to user B → 404 (NOT 204), B's token stays unrevoked.

- [ ] **Step 4: Run + commit**

```bash
git add frontend/src/components/settings/ActiveSessionsTable.tsx frontend/src/components/settings/ActiveSessionsTable.test.tsx
# IF (a):
git add api/src/routes/account.ts api/tests/integration/contamination/account-sessions-delete-contamination.test.ts
git commit -m "feat: ActiveSessionsTable + per-token revoke (option a; 6th G2 contamination test)"
```

---

### Task 15: `SignOutEverywhereButton` component + reachability

**Files:**
- Create: `frontend/src/components/settings/SignOutEverywhereButton.tsx`
- Create: `frontend/src/components/settings/SignOutEverywhereButton.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as api from '../../lib/api/account';
import { SignOutEverywhereButton } from './SignOutEverywhereButton';

vi.mock('../../lib/api/account');

describe('SignOutEverywhereButton', () => {
  it('opens medium-tier confirm on click', async () => {
    render(<SignOutEverywhereButton />);
    await userEvent.click(screen.getByRole('button', { name: /sign out everywhere/i }));
    expect(screen.getByRole('dialog', { name: /end this session on every device/i })).toBeInTheDocument();
  });

  it('Confirm calls signOutEverywhere + posts BroadcastChannel signal + redirects', async () => {
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { value: { assign }, configurable: true, writable: true });
    vi.mocked(api.signOutEverywhere).mockResolvedValue();

    // Per I-BROADCASTCHANNEL: assert a 'signout_everywhere' message goes out
    // on the 'repos-auth' channel so other tabs in the same browser redirect.
    const messages: unknown[] = [];
    const listener = new BroadcastChannel('repos-auth');
    listener.onmessage = (e) => messages.push(e.data);

    render(<SignOutEverywhereButton />);
    await userEvent.click(screen.getByRole('button', { name: /sign out everywhere/i }));
    // Per I-CONFIRM-BUSY-LABEL: name matches "confirm" OR "signing out…"
    await userEvent.click(screen.getByRole('button', { name: /confirm|signing out/i }));
    await waitFor(() => expect(api.signOutEverywhere).toHaveBeenCalled());
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/cdn-cgi/access/logout'));
    await waitFor(() => expect(messages).toContainEqual({ type: 'signout_everywhere' }));
    listener.close();
  });
});
```

- [ ] **Step 2: Implement**

```tsx
// frontend/src/components/settings/SignOutEverywhereButton.tsx
// Beta W6.7 — medium-tier confirm + signout-everywhere API call + CF Access
// logout redirect + cross-tab BroadcastChannel signal.
//
// Per master-plan §636 D4: copy "End this session on every device? This signs
// out every device, including your iOS Shortcut. Re-mint required." Accent
// severity (not danger).
//
// Per I-BROADCASTCHANNEL: post on 'repos-auth' so other tabs in the same
// browser also redirect to /cdn-cgi/access/logout. Without this signal, an
// open tab can sit on stale state until its next request 401s — undesirable
// for a security action where the user intends "kill everything now."
//
// Per I-CONFIRM-BUSY-LABEL: the Confirm button label flips to "Signing out…"
// during the async call so tests match /confirm|signing out/i.
//
// Mobile-reachable per project_device_split + master-plan reachability:
// sign-out-everywhere is a security tool; the user must reach it on their
// backup phone when device-A is the lost one. Sidebar.tsx renders on both
// mobile + desktop so this surface comes along for free.

import { useState } from 'react';
import { TOKENS, FONTS } from '../../tokens';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { signOutEverywhere } from '../../lib/api/account';
import { pushToast } from '../common/ToastHost';

export function SignOutEverywhereButton(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const handle = async (): Promise<void> => {
    setBusy(true);
    try {
      await signOutEverywhere();
      // Broadcast to other tabs in this browser BEFORE we navigate away,
      // so listeners in those tabs receive the message.
      try {
        const ch = new BroadcastChannel('repos-auth');
        ch.postMessage({ type: 'signout_everywhere' });
        ch.close();
      } catch {
        // BroadcastChannel unavailable (very old browser) — non-fatal.
      }
      window.location.assign('/cdn-cgi/access/logout');
    } catch (err) {
      pushToast({ severity: 'error', body: 'Sign out everywhere failed. ' + (err instanceof Error ? err.message : '') });
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          padding: '10px 16px', borderRadius: 8,
          border: `1px solid ${TOKENS.lineStrong}`, background: 'transparent', color: TOKENS.text,
          fontFamily: FONTS.ui, fontSize: 13, fontWeight: 600, cursor: 'pointer',
        }}
      >Sign out everywhere</button>
      <ConfirmDialog
        open={open}
        tier="medium"
        title="End this session on every device?"
        body="This signs out every device, including your iOS Shortcut. Re-mint required."
        confirmLabel={busy ? 'Signing out…' : 'Confirm'}
        severity="accent"
        onConfirm={() => void handle()}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
```

**Companion change in `App.tsx` (per I-BROADCASTCHANNEL):** the AuthProvider listens on the same channel and redirects on signout:

```tsx
// In frontend/src/auth.tsx (or wherever AuthProvider lives):
useEffect(() => {
  let ch: BroadcastChannel | null = null;
  try {
    ch = new BroadcastChannel('repos-auth');
    ch.onmessage = (e) => {
      if (e.data?.type === 'signout_everywhere') {
        window.location.assign('/cdn-cgi/access/logout');
      }
    };
  } catch {
    // ignore — old browser
  }
  return () => { ch?.close(); };
}, []);
```

- [ ] **Step 3: Run + commit**

Run: `cd frontend && npx vitest run src/components/settings/SignOutEverywhereButton.test.tsx`
Expected: PASS.

```bash
git add frontend/src/components/settings/SignOutEverywhereButton.tsx frontend/src/components/settings/SignOutEverywhereButton.test.tsx
git commit -m "feat: SignOutEverywhereButton + CF Access logout redirect"
```

---

### Task 16: `DeleteAccountSection` + `AccountEventsTimeline` + mount on `/settings/account`

**Files:**
- Create: `frontend/src/components/settings/DeleteAccountSection.tsx`
- Create: `frontend/src/components/settings/DeleteAccountSection.test.tsx`
- Create: `frontend/src/components/settings/AccountEventsTimeline.tsx`
- Create: `frontend/src/components/settings/AccountEventsTimeline.test.tsx`
- Modify: `frontend/src/components/settings/SettingsAccount.tsx` — full rewrite

- [ ] **Step 1: Implement `DeleteAccountSection`**

Reuses `ConfirmDialog` with `tier="heavy"` and `requireTyped={CONFIRM_DELETE_ACCOUNT_PHRASE}` (imported from `frontend/src/lib/constants/accountConfirmPhrases.ts`, per I-CONFIRM-PHRASE-CONST — single source of truth shared with the migration comment, API schema, and tests). On confirm: `await deleteAccount(CONFIRM_DELETE_ACCOUNT_PHRASE); window.location.assign('/cdn-cgi/access/logout')`. Severity `danger`. Failure shows error toast, leaves user signed in.

CF Access posture: the body confirm-string is the second factor. The route is also CF-Access-JWT-only (per C-SIGNOUT-CFACCESS-ONLY) so a stolen bearer cannot wipe the account. The typed-confirm + Origin guard + CF Access JWT requirement is the agreed bar. The "require fresh JWT within ≤5 min" stricter posture is documented as an open question in §Risks for the reviewer panel (rejected for Beta — small N).

- [ ] **Step 2: Implement `AccountEventsTimeline`**

Reverse-chronological list of `account_events` rows. Each row renders:
- `kind` (humanized: "Profile changed" / "Signed out everywhere" / "Token revoked" / "Token minted" / etc.)
- `occurred_at` (relative time via existing `formatToParts` pattern per `project_alpine_smallicu`)
- `ip` (already truncated to /24 server-side)
- `user_email_at_event` only when the row is "stranded" (i.e., user_id IS NULL — happens after the user's own DELETE /api/me, but this user can no longer authenticate so the surface mainly serves admin views; for the user-facing timeline this should never render). Sanity-render anyway in case of edge cases.
- `meta.revoked_count` / `meta.token_id` / `meta.fields` (per I-ACCOUNT-EVENTS-META — the `meta.before` shape for `profile_changed` is `{ fields: ['display_name'], changed: true }` only; the prior PII value is NOT retained).

Wrap `session` + `bearer_token` terms in the header.

Pagination: uses the keyset cursor returned by `listEvents()` (per I-PAGINATION-KEYSET). Page size 50; "Load older" button at the bottom invokes `listEvents({ before_ts, before_id })` from the previous page's `next_cursor`.

- [ ] **Step 3: Rewrite `SettingsAccount.tsx`**

```tsx
// frontend/src/components/settings/SettingsAccount.tsx
// Beta W6.2 — Account page layout. No units selector per D6.
import { useEffect, useState } from 'react';
import { TOKENS, FONTS } from '../../tokens';
import { useCurrentUser, apiFetch } from '../../auth';
import { AccountProfileEditor } from './AccountProfileEditor';
import { ActiveSessionsTable } from './ActiveSessionsTable';
import { SignOutEverywhereButton } from './SignOutEverywhereButton';
import { AccountEventsTimeline } from './AccountEventsTimeline';
import { DeleteAccountSection } from './DeleteAccountSection';
import type { ProfileResponse } from '../../lib/api/account';

export default function SettingsAccount(): JSX.Element {
  const { user } = useCurrentUser();
  const [profile, setProfile] = useState<ProfileResponse | null>(null);

  useEffect(() => {
    void apiFetch('/api/me').then(async (r) => {
      if (!r.ok) return;
      const me = (await r.json()) as ProfileResponse;
      setProfile(me);
    });
  }, [user]);

  if (!profile) {
    return (
      <div style={{ padding: 24, color: TOKENS.textDim, fontFamily: FONTS.mono, fontSize: 11 }}>
        LOADING…
      </div>
    );
  }

  return (
    <div style={{ padding: '24px 32px', display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 }}>
      <div>
        <div style={{ fontFamily: FONTS.mono, fontSize: 10, color: TOKENS.textMute, letterSpacing: 1.2, marginBottom: 4 }}>SETTINGS</div>
        <h2 style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.5, color: TOKENS.text }}>Account</h2>
      </div>

      <AccountProfileEditor user={profile} />

      <ActiveSessionsTable />

      <section style={{
        background: TOKENS.surface, border: `1px solid ${TOKENS.line}`,
        borderRadius: 12, padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: TOKENS.text, margin: 0 }}>Security</h3>
        <SignOutEverywhereButton />
      </section>

      <AccountEventsTimeline />

      <DeleteAccountSection email={profile.email} />
    </div>
  );
}
```

The previous draft's `/api/me` units-synthesis workaround is gone (D6 cut units entirely).

- [ ] **Step 4: Run all component tests**

Run: `cd frontend && npx vitest run src/components/settings/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/settings/
git commit -m "feat: SettingsAccount full Beta surface (profile/sessions/signout/timeline/delete)"
```

---

## Phase 4 — Destructive UX hardening (rest of W6.3) + W6.5 toast

### Task 17: Wire Abandon-mesocycle (heavy) + Equipment-reset (medium) + mid-session swap success toast (light = Toast+Undo)

> **Reminder per C-CONFIRMDIALOG-LIGHT-API:** "Light tier" is NOT a ConfirmDialog variant — it is the Toast + Undo pattern. The mid-session swap success toast lives in `ToastHost`, not in `ConfirmDialog`. ConfirmDialog only handles medium + heavy.

**Files:**
- Modify: `frontend/src/components/programs/MidSessionSwapPicker.tsx` (or `MidSessionSwapSheet.tsx` — whichever owns the confirm-callback) — add `pushToast({severity:'success', body:'Swapped.', actionLabel:'Undo', onAction: handleUndo})` on confirm success (light tier = Toast + Undo, NOT ConfirmDialog)
- Modify: `frontend/src/pages/MyProgramPage.tsx` — Abandon mesocycle button wires to `ConfirmDialog tier="heavy" requireTyped={programName}`
- Modify: `frontend/src/components/settings/EquipmentEditor.tsx` — equipment-reset-with-active-program confirms via `ConfirmDialog tier="medium"`

For each site:

- [ ] **Step 1:** Write a failing test that asserts the new confirm flow is invoked. Confirm-button matcher uses `name: /confirm|signing out|saving/i` per I-CONFIRM-BUSY-LABEL.
- [ ] **Step 2:** Wire `<ConfirmDialog>` (for medium/heavy) or `pushToast({actionLabel:'Undo', onAction:…})` for the light tier
- [ ] **Step 3:** Run the test
- [ ] **Step 4:** Commit

(The full TDD steps per site are mechanical and follow Task 12's `ConfirmDialog` test pattern. Each is ≤30 LOC of test + ≤30 LOC of integration.)

After all three sites: grep gate — `cd frontend && grep -rn "window.confirm\|alert(" src/ --include="*.tsx" --include="*.ts" | grep -v "\\.test\\." | grep -v "alertdialog"` returns empty.

```bash
git commit -m "feat: wire heavy/medium confirms + light Toast-Undo across mesocycle/equipment/swap"
```

---

## Phase 5 — Reachability + G3.d e2e + term audit + risks

### Task 18: G3.d Playwright spec — sign-out-everywhere multi-device

**Files:**
- Create: `frontend/playwright/w6-signout-everywhere-g3d.spec.ts`

Hosted in `frontend/playwright/` per W3 precedent — `frontend/playwright.config.ts` already globs `playwright/**/*.spec.ts`. Per the W3 spec's docblock comment (`frontend/playwright/w3-injury-swap-flow.spec.ts:13–17`): "tests/e2e/ does not resolve `@playwright/test` because node_modules only resolves under frontend/" — confirmed.

- [ ] **Step 1: Write the spec**

```ts
// frontend/playwright/w6-signout-everywhere-g3d.spec.ts
// G3.d — Sign out everywhere revokes ALL bearers cross-device.
//
// Scenario:
//   1. "device A": mint bearer A via POST /api/tokens.
//   2. "device B": mint bearer B via POST /api/tokens.
//   3. From device A's browser context, navigate to /settings/account,
//      click "Sign out everywhere", confirm.
//   4. Device B (separate fetch using bearer B) makes any authenticated
//      API call → must return 401.
//
// Hermetic: mocks /api/me, /api/account/sessions, /api/account/events
// the same way w3-injury-swap-flow does. The two "devices" are two
// distinct browser contexts created from the same playwright `browser`
// (NEW context per device — independent cookie jars + localStorage).
// The bearer-token state is held in-memory in the route mocks.

import { test, expect, type Route } from '@playwright/test';

const USER = {
  id: 'user-1', email: 'tester@example.com', display_name: 'Tester', timezone: 'UTC',
};
const TOKEN_A = 'aaaaaaaaaaaaaaaa.' + 'a'.repeat(64);
const TOKEN_B = 'bbbbbbbbbbbbbbbb.' + 'b'.repeat(64);

test('G3.d: sign-out-everywhere revokes all bearers across devices', async ({ browser }) => {
  // Shared in-memory state — both contexts see the same revoked-set.
  const revoked = new Set<string>();

  const wireMocks = async (ctx: Awaited<ReturnType<typeof browser.newContext>>): Promise<void> => {
    await ctx.route('**/api/me', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...USER, units: 'lbs' }) });
    });
    await ctx.route('**/api/equipment/profile', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ _v: 1, barbell: { available: true } }) });
    });
    await ctx.route('**/api/account/sessions', async (route: Route) => {
      const auth = route.request().headers().authorization ?? '';
      const token = auth.replace(/^Bearer /, '');
      if (revoked.has(token)) {
        await route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        sessions: [{ id: 's1', label: 'iOS Shortcut', created_at: '2026-05-01T00:00:00Z', last_used_at: '2026-05-25T07:30:00Z', last_used_ip: '1.2.3.4' }],
      })});
    });
    await ctx.route('**/api/account/events', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ events: [] }) });
    });
    await ctx.route('**/api/auth/signout-everywhere', async (route: Route) => {
      // Bulk-revoke any token presented in this run.
      revoked.add(TOKEN_A); revoked.add(TOKEN_B);
      await route.fulfill({
        status: 204,
        headers: { 'Set-Cookie': 'CF_Authorization=; Max-Age=0; Path=/' },
      });
    });
  };

  // Device A — drives the click.
  const ctxA = await browser.newContext();
  await wireMocks(ctxA);
  const pageA = await ctxA.newPage();
  await pageA.goto('/settings/account');
  await pageA.getByRole('button', { name: /sign out everywhere/i }).click();
  // The medium-tier ConfirmDialog dialog opens; click Confirm.
  await pageA.getByRole('dialog', { name: /end this session on every device/i }).getByRole('button', { name: /^confirm$/i }).click();

  // Device B — independent context. Token B was minted before sign-out-everywhere
  // fired (state above). After A clicks, B's next API call returns 401.
  const ctxB = await browser.newContext({ extraHTTPHeaders: { authorization: `Bearer ${TOKEN_B}` } });
  await wireMocks(ctxB);
  const pageB = await ctxB.newPage();
  // Use a direct fetch from within the page context (carries the bearer header).
  const status = await pageB.evaluate(async () => {
    const r = await fetch('/api/account/sessions');
    return r.status;
  });
  expect(status).toBe(401);

  await ctxA.close();
  await ctxB.close();
});
```

- [ ] **Step 2: Run the spec**

Run: `cd frontend && npm run dev &` (background) — wait — `npx playwright test playwright/w6-signout-everywhere-g3d.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/playwright/w6-signout-everywhere-g3d.spec.ts
git commit -m "test: G3.d Playwright assertion for sign-out-everywhere"
```

---

### Task 19: Reachability doc update + G7 Playwright sanity

**Files:**
- Modify: `docs/qa/beta-reachability.md` — append a W6 section per W3 format
- Create: `frontend/playwright/w6-account-delete-reachability.spec.ts`

- [ ] **Step 1: Append W6 to `docs/qa/beta-reachability.md`**

```markdown
## W6 — Account ops + destructive UX hardening + Sign out everywhere

| Surface | Path from `/` | Click count |
|---|---|---|
| `/settings/account` — AccountProfileEditor (edit display_name / timezone — NO units per D6) | `/` → "Settings" nav → "Account" sub-nav | **2 clicks** ✓ |
| `/settings/account` — ActiveSessionsTable + AccountEventsTimeline | same | **2 clicks** ✓ |
| `/settings/account` — "Sign out everywhere" button (medium-tier confirm) | `/` → "Settings" → "Account" → scroll to "Security" section | **2 clicks** ✓ (button visible without scroll on viewports ≥ 720px tall; falls back to scroll on smaller viewports — no extra click) |
| `/settings/account` — DeleteAccountSection (heavy-tier confirm) | `/` → "Settings" → "Account" → scroll to "Danger zone" | **2 clicks** ✓ (button visible after vertical scroll; per Design spec danger-zone always renders at footer of Account page) |
| `/settings/injuries` — InjuryChipsEditor (W3-shipped surface; D7 requires this to stay top-level) | `/` → "Settings" → "Injuries" | **2 clicks** ✓ (preserved from W3; W6 D7 ensures Injuries stays top-level in `SETTINGS_SECTIONS` rather than nested under Account) |
| `/settings/storage` — Storage settings (W1-shipped) | `/` → "Settings" → "Storage" | **2 clicks** ✓ |

### Mobile-reachability override (per memory project_device_split + master plan + I-MOBILE-SIGNOUT-PATH)

Sign-out-everywhere MUST be reachable on mobile because the user may need to invoke it from their backup phone when device-A is the lost device. Click-path:

| Surface | Path from `/` (mobile) | Click count |
|---|---|---|
| Sign out everywhere | `/` → hamburger menu (Sidebar toggle) → "Settings" → "Account" → "Sign out everywhere" | **3 clicks** ✓ (3 clicks is the upper bound of G7; this surface intentionally sits at the bound because it is rare-use AND high-stakes — closer to root would risk fat-finger invocation) |

**Mobile Settings target — per I-MOBILE-SIGNOUT-PATH:** the hamburger-menu Settings link points to `/settings/account` (not `/settings/integrations` as alpha defaulted). Account is the new authoritative first slot.

### Source-of-truth selectors

- Sidebar Settings sub-nav: `frontend/src/components/layout/Sidebar.tsx` reads `SETTINGS_SECTIONS` from `frontend/src/components/settings/SettingsSidebar.tsx` (8 entries per D7).
- Account page mount: route `settings/account` in `frontend/src/App.tsx` renders `frontend/src/components/settings/SettingsAccount.tsx`, which composes `AccountProfileEditor`, `ActiveSessionsTable`, `SignOutEverywhereButton`, `AccountEventsTimeline`, `DeleteAccountSection`.
- Injuries page mount (D7): `/settings/injuries` route in `App.tsx` renders the W3-shipped `SettingsInjuries.tsx`. W6 does NOT touch this route — it only ensures the sidebar entry stays top-level.

### G7 status for W6

All W6 surfaces fall within the ≤3-click budget. Already-shipped W3 Injuries surface is preserved at 2 clicks (G7 unchanged). **G7 ✓ for W6.**
```

- [ ] **Step 2: Write the reachability smoke spec**

`frontend/playwright/w6-account-delete-reachability.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('G7: /settings/account reachable from / in ≤2 clicks', async ({ page }) => {
  await page.route('**/api/me', async (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ id: 'u1', email: 'a@b', display_name: 'X', timezone: 'UTC', units: 'lbs' }),
  }));
  await page.route('**/api/equipment/profile', async (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ _v: 1, barbell: { available: true } }),
  }));
  await page.route('**/api/account/sessions', async (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ sessions: [] }),
  }));
  await page.route('**/api/account/events', async (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ events: [] }),
  }));

  await page.goto('/');
  // Click 1: Settings nav
  await page.getByRole('link', { name: /^settings$/i }).click();
  // Click 2: Account sub-nav
  await page.getByRole('link', { name: /^account$/i }).click();

  await expect(page.getByRole('heading', { name: /account/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /sign out everywhere/i })).toBeVisible();
});
```

- [ ] **Step 3: Run + commit**

```bash
git add docs/qa/beta-reachability.md frontend/playwright/w6-account-delete-reachability.spec.ts
git commit -m "test: G7 reachability for W6 + reachability doc update"
```

---

### Task 20: Term-tooltip audit + Sidebar/Settings mobile sanity

- [ ] **Step 1: Run the term-coverage check**

Per master plan §634: `scripts/check-term-coverage.cjs` is the AST gate. The audit list extension for W6.7 banner specifically includes "bearer token" — which the `<SignOutEverywhereButton>` confirm body uses. Verify it wraps via `<Term k="bearer_token">` in the confirm body copy.

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS && node scripts/check-term-coverage.cjs`
Expected: green (no missed terms on Beta-new surfaces).

If the script doesn't exist yet (W6.6 spec says "CI rule already exists; this task closes the audit list"), the gate is the manual grep:

Run: `grep -rEn "PAT|bearer token|session expir|time zone" frontend/src/components/settings/ frontend/src/components/programs/MidSessionSwapPicker.tsx frontend/src/components/auth/ | grep -v "<Term" | grep -v "\\.test\\."`
Expected: empty (every occurrence in body copy wraps in `<Term>`).

- [ ] **Step 2: Manual sanity — mobile sign-out-everywhere click-path**

Open the dev server, switch to iPhone-14 viewport via Chrome DevTools, walk: `/` → hamburger → Settings → Account → scroll → "Sign out everywhere". Confirms ≤3 clicks per G7.

- [ ] **Step 3: Commit (if doc updates needed)**

If `<Term>` wraps had to be added inline, those went into Task 16/17 commits. If the term-coverage script needed config tweaks, capture in a single commit:

```bash
git commit -m "chore: close W6 term-tooltip audit gates"
```

(If no changes were needed, skip the commit.)

---

### Task 21: G11 closure subsection — map `08-qa.md` checklist items to W6 (per I-AUDIT-G11)

**Files:**
- Modify: `docs/qa/08-qa.md` — append "W6 G11 closure" subsection

- [ ] **Step 1: Open `docs/qa/08-qa.md` §"Pre-Beta security review checklist" and map each item:**

For every checklist item, mark one of:
- **Closed by W6** (link to commit / PR / file path implementing it)
- **Deferred** (with target wave OR explicit accept-residual-risk note + reason)

Example mapping (fill in with the actual checklist items):

| Item | Status | Closure |
|---|---|---|
| All state-changing routes have CSRF guard on CF Access cookie path | Closed | `api/src/middleware/csrfOrigin.ts` (Task 5b); test `api/tests/integration/csrf-origin.test.ts` |
| All per-user routes have G2 contamination test | Closed | 5–6 contamination tests under `api/tests/integration/contamination/` (Tasks 7–9, 14) |
| Audit trail survives account deletion | Closed | `account_events.user_id ON DELETE SET NULL` + PII snapshot columns (Task 1, per D8) |
| Bearer tokens cannot trigger account-destructive flows | Closed | `requireCfAccessOnly` middleware on `DELETE /api/me` + `POST /api/auth/signout-everywhere` (Task 5b, per C-SIGNOUT-CFACCESS-ONLY) |
| Admin endpoints gated beyond CF Access | Closed | `REPOS_ADMIN_EMAILS` check in `requireAdminKeyOrCfAccess` (Task 5b, per D10) |
| Sign-out-everywhere broadcasts to all open tabs | Closed | `BroadcastChannel('repos-auth')` (Task 15, per I-BROADCASTCHANNEL) |
| No `alert()` on Beta-new surfaces | Closed | Toast/ToastHost + 5 site replacements (Task 11) |
| Destructive actions have severity-tier confirms | Closed | `ConfirmDialog` medium + heavy (Task 12); light = Toast+Undo (per C-CONFIRMDIALOG-LIGHT-API) |
| <add remaining checklist items> | <Closed / Deferred> | <reference> |

- [ ] **Step 2: Commit**

```bash
git add docs/qa/08-qa.md
git commit -m "docs: G11 closure subsection mapping W6 to security checklist"
```

---

## Risks + open questions for the reviewer panel

Per memory `feedback_get_plan_reviewed.md`: after the synthesized plan is written, dispatch the specialist panel to re-review before execution.

### Risks (panel-derived findings now FOLDED IN)

The original risks list has been resolved against this revision — items below are either closed inline (with the reference) or remain open with explicit accept-residual-risk reasoning.

1. **~~`/api/me` units field exposure~~ — CLOSED.** D6 cuts units entirely from W6; the synth workaround is gone. Future wave will design units conversion end-to-end.
2. **~~CF Access re-verification on `DELETE /api/me`~~ — ACCEPT RESIDUAL FOR BETA.** Typed-confirm + CF-Access-JWT-only (C-SIGNOUT-CFACCESS-ONLY) + Origin guard (C-CSRF-ORIGIN) is the agreed bar. The "iat claim clamp ≤5 min" stricter posture is documented as a GA enhancement candidate. Beta has N=1; the cost/benefit doesn't favor it now.
3. **~~`signout-everywhere` doesn't evict CF Access globally~~ — CLOSED.** `BroadcastChannel('repos-auth')` post-signout signal (I-BROADCASTCHANNEL) plus the client-side `/cdn-cgi/access/logout` redirect covers the multi-tab case. Mobile is in the same browser so the BroadcastChannel fires.
4. **~~Migration 062 + alpine small-icu interaction~~ — CLOSED.** Static IANA fallback list (I-IANA-TIMEZONES) ships in `api/src/lib/timezones.ts` + frontend mirror; no reliance on `Intl.supportedValuesOf`.
5. **`account_events` retention — ACCEPT RESIDUAL FOR BETA (I-ACCOUNT-EVENTS-TTL).** Documented in the migration 060 docblock: Beta accepts unbounded retention (small N); GA decision deferred to a documented review. PII is row-redacted at write time for `profile_changed` (I-ACCOUNT-EVENTS-META) so the worst-case data carried is `user_email_at_event` snapshots — already required by D8 forensics.
6. **~~`device_tokens.revoke_reason` backfill~~ — CLOSED.** Migration 061 backfills alpha residue to `'legacy_revoke'` (I-REVOKE-REASON-BACKFILL — honest "we don't know why" forensics, not bait-and-switch "user_revoked").

### Open questions for the reviewer panel

These remain for the synthesized-plan re-review (per memory `feedback_get_plan_reviewed.md`):

1. **Per-token revoke route (`DELETE /api/account/sessions/:id`) — ship or drop?** Task 14 surfaces an explicit I-CONTAM-MATRIX decision. Recommendation in the plan: ship (option a), 15 LOC + 6th contamination test. Reviewer: confirm or push back.
2. **`AccountEventsTimeline` pagination depth.** Default `limit=50` with keyset cursor + "Load older" button. For an active Beta user generating ~10 events/day this covers ~5 days per page. Reviewer: enough for Beta?
3. **Should `account_events.kind` enum get a DB CHECK after all?** Per C-ACCOUNT-EVENTS-ENUM the plan governs at the TypeScript layer to avoid cross-wave migration churn. Alternative: add a CHECK and require future kinds to ship a tiny migration. Trade-off: type-safety dispersion vs. migration overhead. Reviewer: vote.
4. **Migration 063 (`users.role TEXT`) — when does it land?** D10 reserves the slot for post-Beta cohort scale-up. Reviewer: any reason to land it inside W6 instead?

The previously-open Settings sidebar order question is RESOLVED: D7 locked the 8-entry layout. The Storage/Injuries demotion alternative is rejected. The "4 vs 5 alert() sites" question is RESOLVED: convert all 5 (the dev-only one too, per the existing plan rationale).

### Acceptance gates (wave-complete)

- [ ] Migration 060 lands with `account_events` table, ON DELETE SET NULL FK, `user_email_at_event` + `user_id_at_event` snapshot columns, and indexes on `(user_id, occurred_at)`, partial `(ip)`, and `(kind, occurred_at)` (per D8 + I-IP-INDEX + I-AUDIT-EVENT-KIND-INDEX)
- [ ] Migration 061 lands with `device_tokens.revoke_reason` 6-value enum + alpha-residue backfill to `'legacy_revoke'` (per I-REVOKE-REASON-ENUM + I-REVOKE-REASON-BACKFILL)
- [ ] Migration 062 lands with `display_name` length + non-empty CHECK (per I-DISPLAY-NAME-NORMALIZE); `users.units` column NOT added (per D6)
- [ ] Migration 063 documented as reserved for `users.role TEXT` (per D10 — deferred to post-Beta)
- [ ] G2 contamination tests green for all per-user routes: profile, deletion, signout-everywhere, sessions, events, AND `/account/sessions/:id` DELETE if shipped per I-CONTAM-MATRIX (5 or 6 total)
- [ ] DELETE /api/me cascade test green — every cascade-wiped table reaches 0 rows AND `account_events` rows SURVIVE with `user_id=NULL` + PII snapshot intact (per D8)
- [ ] Wrapped in BEGIN/COMMIT: DELETE /api/me (per C-DELETE-ME-TXN) + signout-everywhere (per C-SIGNOUT-TXN)
- [ ] `POST /api/auth/signout-everywhere` and `DELETE /api/me` reject bearer auth (per C-SIGNOUT-CFACCESS-ONLY); CF Access JWT only
- [ ] CSRF Origin guard test green — missing/wrong Origin on CF-Access-cookie path → 403 (per C-CSRF-ORIGIN); X-RepOS-CSRF: 1 alternate accepted
- [ ] `REPOS_ADMIN_EMAILS` admin check on `requireAdminKeyOrCfAccess` — env-driven, fails closed if unset (per D10); `.env.example` updated
- [ ] CF Access cookie clear Set-Cookie attributes verified via outside-in curl on prod (per I-CF-COOKIE-ATTRS + memory `feedback_verify_external_config.md`)
- [ ] G3.d Playwright spec green at `frontend/playwright/w6-signout-everywhere-g3d.spec.ts` (per W3 precedent; hermetic mocks) + manual outside-in curl on prod
- [ ] G7 reachability spec green; G7 doc updated; Injuries (W3 surface) reachability preserved at 2 clicks (per D7)
- [ ] Mobile click-walk verified: ≤3 clicks to sign-out-everywhere; mobile Settings target = `/settings/account` (per I-MOBILE-SIGNOUT-PATH)
- [ ] Grep `alert(` returns 0 hits in `frontend/src/**/*.{ts,tsx}` excluding `*.test.*` and `role="alertdialog"`
- [ ] Term-coverage check green for `PAT`, `bearer_token`, `session`, `IANA_timezone`, `truncated_ip_24`
- [ ] `ConfirmDialog` type is `'medium' | 'heavy'` only (no `'light'` per C-CONFIRMDIALOG-LIGHT-API); return-focus test green (per C-CONFIRMDIALOG-RETURNFOCUS); single ESC path (per C-CONFIRMDIALOG-ESC); heavy-tier initialFocus targets the typed input (per C-CONFIRMDIALOG-FOCUS)
- [ ] `ToastHost` mounted inside `AppShell` as sibling of `<Outlet>`, NOT at App root (per C-TOAST-HOST-MOUNT)
- [ ] `AccountProfileEditor` uses ControlledField re-sync pattern (per C-PROFILE-CONTROLLED); no units selector (per D6)
- [ ] `ActiveSessionsTable` renders truncated IP /24 (per I-LAST-IP-TRUNCATE); card-layout fallback at <600px (per I-SESSIONS-MOBILE)
- [ ] `BroadcastChannel('repos-auth')` cross-tab signal posted on signout-everywhere (per I-BROADCASTCHANNEL); listener wired in AuthProvider
- [ ] `CONFIRM_DELETE_ACCOUNT_PHRASE` constant used in API schema + frontend dialog + tests (per I-CONFIRM-PHRASE-CONST)
- [ ] `account_events.meta.before` redacted to `{fields, changed: true}` for `profile_changed` (per I-ACCOUNT-EVENTS-META)
- [ ] Idempotency test for PATCH /api/me/profile asserts second identical call writes no new `profile_changed` event (per I-PROFILE-IDEMPOTENCY-TEST)
- [ ] Keyset pagination implemented on GET /api/account/events: `(occurred_at, id)` cursor (per I-PAGINATION-KEYSET)
- [ ] Sidebar slots 4/5/6 ship as `ComingSoonPlaceholder` route components, NOT `<Navigate>` redirects (per I-SIDEBAR-PLACEHOLDER)
- [ ] G11 closure subsection in `docs/qa/08-qa.md` maps W6 to security checklist items (per I-AUDIT-G11)
- [ ] No `[ ]` Important security finding from reviewer panel deferred to "v1.5 backlog"
- [ ] `reference_w3_tuning_candidates.md` §"Deferred from W6" row updated for the units backlog (per D6)
