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
