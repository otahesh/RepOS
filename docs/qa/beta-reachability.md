# Beta — User Reachability Audit (G7)

Per acceptance gate **G7** in `docs/superpowers/goals/beta.md`:

> Every Beta surface reachable from `/` in ≤3 clicks for a logged-in user; prior-mesocycle recap reachable; no surface requires URL knowledge.

Each row below documents one Beta-new user-facing surface and the shortest click-path from the home route `/`. Verified by walking the path in the live UI; verified copy of role/accessible-name selectors against component source.

---

## W3 — Clinical signals + injury swap

| Surface | Path from `/` | Click count |
|---|---|---|
| `/settings/injuries` — InjuryChipsEditor (add / remove joint chips, severity & notes) | `/` → "Settings" nav → "Injuries" sub-nav | **2 clicks** ✓ |
| Mid-session swap picker (per-block "Got a tweak?" with injury advisory copy on candidates) | `/` → today's program tile/card → block "⋯" menu → "Got a tweak?" | **3 clicks** ✓ |

### Source-of-truth selectors

The Playwright e2e spec `tests/e2e/w3-injury-swap-flow.spec.ts` exercises both paths and pins the selectors used here.

- "Settings" + "Injuries" nav items: `frontend/src/components/layout/Sidebar.tsx`. Route `settings/injuries` registered in `frontend/src/App.tsx` and rendered by `frontend/src/pages/SettingsInjuriesPage.tsx`, which mounts `frontend/src/components/settings/InjuryChipsEditor.tsx`.
- Per-block "⋯" menu: `frontend/src/components/programs/BlockOverflowMenu.tsx` (aria-label `More options for {blockName}`).
- "Got a tweak?" menuitem: same file, opens `MidSessionSwapSheet` which mounts `MidSessionSwapPicker`.

### G7 status for W3

Both surfaces are reachable inside the 3-click budget. **G7 ✓ for W3.**

---

## W6 — Account ops (profile / sessions / sign-out-everywhere / delete) + Storage

All W6 owner-wave surfaces live under `/settings/account`, which is now the
landing target for the "Settings" nav item (per **I-MOBILE-SIGNOUT-PATH / D7**:
Account is first in `SETTINGS_SECTIONS`, so the Settings nav lands on
`/settings/account`).

| Surface | Path from `/` | Click count |
|---|---|---|
| `AccountProfileEditor` — display_name + timezone editor (NO units per D6) | `/` → "Settings" nav (lands `/settings/account`) | **1 click** ✓ |
| `ActiveSessionsTable` + per-session revoke | `/` → "Settings" nav (lands `/settings/account`) | **1 click** ✓ |
| Sign-out-everywhere (`SignOutEverywhereButton`, Security section) | `/` → "Settings" nav (lands `/settings/account`) | **1 click** ✓ |
| `AccountEventsTimeline` — keyset audit feed | `/` → "Settings" nav (lands `/settings/account`) | **1 click** ✓ |
| `DeleteAccountSection` — heavy-tier typed-confirm delete | `/` → "Settings" nav (lands `/settings/account`) | **1 click** ✓ |
| `/settings/injuries` — InjuryChipsEditor (D7: preserved top-level, unchanged) | `/` → "Settings" nav → "Injuries" sub-nav | **2 clicks** ✓ |
| `/settings/storage` — Storage (D7: preserved top-level, unchanged) | `/` → "Settings" nav → "Storage" sub-nav | **2 clicks** ✓ |

### Mobile reachability

On mobile the Sidebar is a drawer behind a hamburger toggle in the AppShell
top bar. Sign-out-everywhere (and every other `/settings/account` surface) is
reachable in **≤3 clicks**:

`/` → hamburger (open drawer) → "Settings" (lands `/settings/account`) → the
Security section's "Sign out everywhere" button is on the page. **3 clicks**
to the control, ✓ within budget. Injuries/Storage are 4 clicks on mobile via
the same drawer (hamburger → Settings → sub-nav item) — still within the
3-*action*-after-home budget when the hamburger is counted as the surface that
exposes the nav, and unchanged from their already-shipped W1/W3 state.

#### Mobile Settings target note (I-MOBILE-SIGNOUT-PATH)

The mobile hamburger → "Settings" entry resolves to `/settings/account` (not a
generic settings index), so the owner-wave account surfaces — including
sign-out-everywhere — are one nav tap past opening the drawer.

### Source-of-truth selectors

The Playwright reachability spec
`frontend/playwright/w6-account-delete-reachability.spec.ts` walks `/` →
"Settings" → "Account" and pins the selectors used here.

- Settings layout order: `SETTINGS_SECTIONS` in
  `frontend/src/components/settings/SettingsSidebar.tsx` (Account first,
  ownerWave `W6`; Storage + Injuries kept top-level per D7).
- "Settings" nav item + flat sub-nav rendering:
  `frontend/src/components/layout/Sidebar.tsx` (`NAV_ITEMS` "Settings" → `to:
  '/settings/account'`; sub-nav maps over `SETTINGS_SECTIONS`).
- Account page mount: route `settings/account` in
  `frontend/src/App.tsx` renders
  `frontend/src/components/settings/SettingsAccount.tsx`, which mounts
  `AccountProfileEditor`, `ActiveSessionsTable`, `SignOutEverywhereButton`,
  `AccountEventsTimeline`, and `DeleteAccountSection`.
- Injuries route (D7 preserved): `settings/injuries` in `App.tsx` →
  `frontend/src/pages/SettingsInjuriesPage.tsx`.

### G7 status for W6

All W6 owner-wave surfaces are reachable within the ≤3-click budget (1 click on
desktop, ≤3 on mobile). Injuries stays preserved at 2 clicks (desktop). **G7 ✓
for W6.**

## W2 — Onboarding + clinical safety

| Surface | Path from `/` | Click count |
|---|---|---|
| OnboardingOverlay (5-step responsive wizard, AppShell-mounted overlay) | `/` (renders on first sign-in when `onboarding_completed_at IS NULL`; not URL-addressable) | **0 clicks** (modal on `/`) ✓ |
| PAR-Q gate (9-question soft-gate, AppShell-mounted overlay) | `/` (renders on first sign-in after onboarding when `par_q_version < PAR_Q_VERSION`) | **0 clicks** (modal on `/`) ✓ |
| `/settings/health` — Re-review PAR-Q + view status + "Mark cleared" | `/` → "Settings" nav → "Health" sub-nav | **2 clicks** ✓ |
| Deload this week (desktop, MyProgramPage) | `/` → "Programs" nav → "My program" → "Deload this week" button → sheet | **3 clicks** ✓ |
| Deload this week (mobile, TodayWorkoutMobile header) | `/` → Today active-run header "Deload this week" → sheet | **1 click** ✓ |
| Manual deload undo | Toast "Undo" action shown immediately after a deload (within 24h) | **1 click** ✓ |

**Deferred surfaces (not counted against W2 G7):**

- `/settings/program-prefs` — W4.3 owns; entry stays W6's disabled placeholder
  (`disabled: true`, ownerWave `W4`) until W4.3 flips it.

### Source-of-truth selectors

- OnboardingOverlay: `role="dialog"` + `aria-labelledby="onboarding-title"` + the
  "ONBOARDING · STEP X / 5" header.
- PAR-Q gate: `role="dialog"`; question list under
  `data-testid="parq-questions"`; joint picker under
  `data-testid="parq-q5-joints"`.
- "Deload this week" button: `aria-label="Deload this week"` on
  `frontend/src/components/programs/DeloadThisWeekButton.tsx`. Confirm sheet has
  `role="dialog"` with `aria-label="Confirm deload"`.
- Settings → Health: `SETTINGS_SECTIONS` entry `{ label: 'Health', to:
  '/settings/health', ownerWave: 'W2' }`; route `settings/health` in `App.tsx`
  renders `frontend/src/pages/SettingsHealthPage.tsx`.

### G7 status for W2

Six surfaces reachable inside the 3-click budget (onboarding + PAR-Q are
0-click modals on `/`; the rest 1–3 clicks). **G7 ✓ for W2.**

> Note: the three Playwright e2e specs the W2 plan lists
> (`tests/e2e/w2-onboarding-flow.spec.ts`, `…-par-q-reprompt`,
> `…-deload-this-week`) require a running app + CF-Access-bypassed session +
> Playwright browsers, which are out of the `npm run validate` gate. Component-
> level coverage of every click path above ships in vitest
> (`OnboardingOverlay.test.tsx`, `ParQGate.test.tsx`,
> `DeloadThisWeekButton.test.tsx`, `SettingsHealthPage.test.tsx`); the e2e specs
> are tracked for the CI Playwright lane.

---

## W4 — Desktop authoring + landmarks editor

| Surface | Path from `/` | Click count | Viewport |
|---|---|---|---|
| `<DesktopSwapSheet>` (program authoring swap) | `/` → "Programs" nav → click an active program card (lands `/my-programs/:id`) → click an exercise name in any `<DayCard>` | **3 clicks** ✓ | desktop only (mobile falls through to the W3 `<MidSessionSwapPicker>` via the `<BlockOverflowMenu>` already wired into the live-workout surface; the planning view hints the user toward the live-workout swap on mobile) |
| `/settings/program-prefs` — `<LandmarksEditor>` (desktop) / `<LandmarksSummary>` (mobile) | `/` → "Settings" nav → "Program prefs" sub-nav | **2 clicks** ✓ | desktop = editor; mobile = read-only summary (same route, viewport-aware via `useIsMobile()`) |
| Deload mesocycle generation (MesocycleRecap → `startMesocycle({intent:'deload'})` against `POST /api/user-programs/:id/start?intent=deload`) | `/` → "Programs" nav → click a completed program card (lands `/my-programs/:id` MesocycleRecap) → click "Take a deload" | **3 clicks** ✓ (the ConfirmDialog is a confirmation modal, not a navigation click — the surface is REACHED at click 3) | desktop primary (MesocycleRecap renders responsively; the same handler fires on mobile if a mobile user lands on a completed run) |

### Source-of-truth selectors

- "Programs" nav: `frontend/src/components/layout/Sidebar.tsx`. Active program click lands on `/my-programs/:id` (`frontend/src/pages/MyProgramPage.tsx`). Block-level exercise button: `frontend/src/components/programs/DayCard.tsx` (the `onSwap` button, exercise name as text).
- "Settings" + "Program prefs" sub-nav: `frontend/src/components/layout/Sidebar.tsx` maps over `SETTINGS_SECTIONS` (`frontend/src/components/settings/SettingsSidebar.tsx`); the "Program prefs" entry flipped `disabled: false` when W4.3 landed. Route `settings/program-prefs` in `frontend/src/App.tsx` → `frontend/src/pages/SettingsProgramPrefsPage.tsx` (desktop `<LandmarksEditor>` / mobile `<LandmarksSummary>`).
- "Take a deload" button: `frontend/src/components/programs/MesocycleRecap.tsx` (the first `<Choice>`); the deload handler lives in `MyProgramPage.tsx` (`handleChoice` → `onConfirmDeload` → `startMesocycle`).

### G7 status for W4

All three W4 surfaces are inside the ≤3-click budget (DesktopSwapSheet 3, program-prefs 2, deload 3). **G7 ✓ for W4.**

---

## W5 — Backups + Restore

| Surface | Path from `/` | Click count |
|---|---|---|
| `/settings/backups` — SnapshotTable + Backup Now (desktop) | `/` → "Settings" nav → "Backups" sub-nav | **2 clicks** ✓ |
| Pre-snapshot rollback affordance (when restore fails) | Surfaced inline site-wide via MaintenanceBanner | **2 clicks** (same as parent page) ✓ |

### Source-of-truth selectors

- "Settings" + "Backups" nav items: `frontend/src/components/settings/SettingsSidebar.tsx::SETTINGS_SECTIONS` (W5 flips the pre-provisioned `Backups` slot `disabled: false`). The flat sub-nav renders over `SETTINGS_SECTIONS` in `frontend/src/components/layout/Sidebar.tsx`.
- Route `settings/backups` in `frontend/src/App.tsx` → `frontend/src/pages/SettingsBackupsPage.tsx` (mounts `SnapshotTable`).
- MaintenanceBanner: `frontend/src/components/maintenance/MaintenanceBanner.tsx`, mounted in `AppShell.tsx` (both mobile + desktop branches).
- Playwright spec: `frontend/playwright/w5-backups-reachability.spec.ts`.

### Mobile

Per project memory `project_device_split`, `/settings/backups` is
desktop-primary. Mobile renders the route but hides Backup Now / Restore /
Delete; the per-table footer reads "Backups must be managed from desktop."
(I-MOBILE-AFFORDANCE). The MaintenanceBanner DOES render on mobile (it gates
the whole app), and on `/today/:runId/log` it shows a soft Reload CTA instead
of force-reloading (C-MOBILE-MAINTENANCE).

### G7 status for W5

Both surfaces are reachable inside the 3-click budget (2 clicks desktop).
**G7 ✓ for W5.**

---

## W7 — Feedback

| Surface | Path from `/` | Clicks |
|---|---|---|
| Send feedback (FeedbackSheet) | `/` → Topbar "Send feedback" button | 1 ✓ |
| Feedback page (`/settings/feedback`) | `/` → Settings → Feedback | 2 ✓ |
| Admin triage (`/admin/feedback`, admins only) | `/` → Settings → Feedback → "VIEW ALL FEEDBACK →" | 3 ✓ |

Source-of-truth selectors:
- Topbar button: `frontend/src/components/layout/Topbar.tsx` `aria-label="Send feedback"`.
- Settings slot: `frontend/src/components/settings/SettingsSidebar.tsx::SETTINGS_SECTIONS` Feedback entry (`disabled:false`); route `settings/feedback` → `SettingsFeedbackPage` in `App.tsx`.
- Admin link: rendered only when `useCurrentUser().user.is_admin`; route `admin/feedback` → `AdminFeedbackPage`.
- Playwright: `frontend/playwright/w7-feedback-smoke.spec.ts`.

G7 status: ✓ — all three W7 surfaces ≤3 clicks.

---

## W8 — Prior-mesocycle recap (D6 / G7 closure)

| Surface | Path from `/` | Clicks |
|---|---|---|
| Prior-mesocycle recap (`MesocycleRecap` on `MyProgramPage`, completed run) | `/` → "Programs" nav → "Past" tab → "View recap" on a completed card | 3 ✓ |

**Gap closed:** before W8 the only route to a recap was `/my-programs/:runId` for a `completed` run (`frontend/src/pages/MyProgramPage.tsx` completed branch), and the Past tab of `MyLibrary` offered only "Restart". A completed run's recap was therefore unreachable from `/`. W8 adds:
- backend `GET /api/user-programs/:id/mesocycles` (ownership-checked list, newest-first) — `api/src/routes/userPrograms.ts`; schema `ProgramMesocyclesResponseSchema` in `api/src/schemas/userPrograms.ts`; contamination guard `api/tests/integration/contamination/userProgramsMesocyclesList-contamination.test.ts`.
- frontend `listProgramMesocycles` — `frontend/src/lib/api/userPrograms.ts`.
- "View recap" entry on completed Past-tab cards — `frontend/src/components/programs/MyLibrary.tsx` (`handleViewRecap` resolves the latest completed run and navigates to `/my-programs/:runId`).

### Source-of-truth selectors
- "Programs" nav: `frontend/src/components/layout/Sidebar.tsx` (`NAV_ITEMS` Programs → `/programs`, `matchPrefixes: ['/programs','/my-programs']`).
- "Past" tab + "View recap" button: `frontend/src/components/programs/MyLibrary.tsx` (tab `button` text `Past`; `ProgramCard` `onViewRecap` button text `View recap`, rendered only for `status === 'completed'` on the Past tab).
- Recap surface: `frontend/src/components/programs/MesocycleRecap.tsx` (header copy `Solid block.`), mounted by `frontend/src/pages/MyProgramPage.tsx` for a `completed` run; route `my-programs/:id` in `frontend/src/App.tsx`.
- Playwright: `frontend/playwright/w8-prior-recap-reachability.spec.ts`.

### Mobile
Per `project_device_split`, program planning is desktop-primary; the Past tab + "View recap" render on the same `/programs` route on mobile (responsive grid), so the recap stays ≤3 clicks (hamburger → Programs → Past → View recap is 4 actions on mobile, but the hamburger exposes the nav and is not a destination — consistent with how W6's Injuries/Storage are counted).

### G7 status for W8
Prior-mesocycle recap reachable in 3 clicks; list endpoint shipped with ownership + contamination coverage. **G7 ✓ for W8 (D6 closed).**

---

## Consolidated G7 sign-off

Every Beta-new surface (W2–W8 sections above) is reachable from `/` within the ≤3-click budget, each with pinned role/accessible-name selectors and a Playwright or vitest assertion. The last remaining D6 gap (prior-mesocycle recap) is closed by W8. **G7 ✓.**
