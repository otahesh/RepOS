# Beta Scope — UI/UX

> **Author**: UI/UX specialist (this spec)
> **Status**: Draft for cross-team review
> **Companion specs**: `01-product.md` (scope), `02-backend.md`, `03-frontend.md`, `04-data.md`, `05-auth.md`
>
> **Guiding principles** (do not relitigate in this spec):
> - **Device-of-purpose split** — desktop = data management / planning / analytics; mobile = live workout execution. Memory: `project_device_split`.
> - **Responsive chrome, not URL split** — same routes, viewport-aware components. No `/mobile/*` subtree. Memory: `project_responsive_chrome`.
> - **User-reachability is part of Done** — every Beta surface must be reachable from the home screen via normal navigation by a logged-in user, on the viewport class it targets. Memory: `feedback_user_reachability_dod`.
> - **Cardio is first-class** — Beta surfaces classify cardio surfaces with equal weight to strength. Memory: `feedback_cardio_first_class`.

---

## Site map (Beta-state) — desktop and mobile

Single route tree (per `project_responsive_chrome`). The same URLs render different chrome and content composition based on `useIsMobile()`.

```
/  (Today — home)
├─ desktop → TodayCard (active program day) + DesktopDashboard (weight chart, trend, PRs, weekly volume)
└─ mobile  → TodayWorkoutMobile (today's day, big START button) + MobileWeightChip

/programs                          (list / browse)
├─ desktop → MyLibrary (active + past) + ProgramCatalog (templates)
└─ mobile  → MyLibrary stacked vertical, catalog collapsed behind "Browse Templates" CTA

/programs/:slug                    (template detail + fork wizard launch)
├─ desktop → full ForkWizard inline (multi-step, side-by-side preview)
└─ mobile  → "Open on desktop to customize" hard-stop card with one-tap "Use defaults & start" escape hatch

/my-programs/:id                   (a forked, in-progress mesocycle)
├─ desktop → ProgramPage (full week grid + DayCards + ScheduleWarnings + per-block edit)
└─ mobile  → read-only week summary + jump-to-Today CTA + "Edit on desktop" notice

/workout/:runId                    [BETA-NEW] live workout execution
├─ desktop → minimal "follow on phone" card + read-only set list
└─ mobile  → LiveLogger (set entry, RIR/RPE wheel, rest timer, MidSessionSwapSheet, "I'm fried" auto-deload trigger)

/library                           [BETA-NEW] exercise library browser
├─ desktop → full ExercisePicker as standalone page + Saved / Mine tab
└─ mobile  → search-only condensed view (read-only — picking an exercise on mobile only happens mid-session inside LiveLogger)

/history                           [BETA-NEW] past sessions, PRs, mesocycle archive
├─ desktop → calendar heatmap + session list + filters
└─ mobile  → vertical session list, swipe to load more

/settings/integrations             (existing — Apple Health tokens etc.)
/settings/equipment                (existing — equipment profile editor)
/settings/account                  (existing — but BETA expands)
/settings/program-prefs            [BETA-NEW] training preferences (units, default RIR target, deload sensitivity, optional landmarks override)
/settings/backups                  [BETA-NEW] *arr-style snapshot list + Backup Now + Restore + Delete
/settings/sessions                 [BETA-NEW] active sessions across devices, Revoke per row, Sign out everywhere
/settings/danger                   [BETA-NEW] destructive actions (delete account, wipe program history) — gated, separate page

/onboarding                        [BETA-NEW] first-run flow (modal-over-app on desktop; full-screen on mobile)
└─ steps: welcome → goal → equipment → program-pick → first-workout-day → done
```

**No `/mobile/*` subtree.** Every URL renders on both viewports. When desktop-primary surfaces (ForkWizard, full ProgramPage editor) are visited on mobile, the page renders a graceful "open on desktop to customize" affordance with a one-tap escape hatch — never a 404, never a redirect, always the same URL.

---

## Multi-user navigation spec

Beta is the moment RepOS leaves single-user alpha. Account UI must exist and be obvious before any non-admin user logs in for the first time.

### Account menu placement

**Desktop.**
The existing user avatar block at the bottom of `Sidebar.tsx` (the monogram + name + email pill, currently showing a settings cog) becomes the **account menu trigger**. Click → popover anchored above the pill (since the sidebar is narrow), opening upward.

```
┌────────────────────────────────┐
│  Signed in as                   │
│  Jason Meyer                    │
│  jmeyer@ironcloudtech.com       │
├────────────────────────────────┤
│  ⚙  Account settings            │ → /settings/account
│  🔧  Preferences                │ → /settings/program-prefs
│  💾  Backups                    │ → /settings/backups
│  📱  Active sessions            │ → /settings/sessions
├────────────────────────────────┤
│  ↪  Sign out                    │ → calls auth.signOut()
└────────────────────────────────┘
```

The cog icon currently in the avatar block is replaced with a small chevron indicating the popover.

**Mobile.**
The hamburger drawer (`Sidebar` rendered as off-canvas) gains the same avatar block at the bottom. Tapping it expands a section in-place (accordion, not a stacked drawer) with the same items. Tapping outside or selecting an item closes the drawer.

A second affordance: a tiny avatar monogram in the **Topbar right side** on mobile, sharing space with the sync pill, opens the same in-drawer account section directly. This gives users a one-tap path to "sign out / sessions / backups" without first opening the drawer's main nav. (On desktop the Topbar avatar is **not** duplicated — sidebar is always visible.)

### Sign-out flow

1. User clicks "Sign out" in account menu.
2. Confirm dialog: **"Sign out of RepOS on this device?"** (single device only — explicit copy distinguishes from "Sign out everywhere"). Buttons: **Cancel** / **Sign out**.
3. Frontend calls `POST /api/auth/signout` (Beta-new endpoint per `05-auth.md`) which clears the session cookie.
4. Frontend sets `auth.status = 'signed_out'`, `AuthGate` rerenders → public sign-in screen.
5. No data flush on the client beyond the auth state — everything else is server-sourced and refetches on next sign-in.

### Account settings reachability

`/settings/account` is reachable from:
- Account-menu popover → "Account settings"
- Sidebar → Settings → Account sub-nav (existing)
- Mobile drawer → Settings → Account

Beta expansion of `SettingsAccount` page:
- Display name (editable)
- Email (read-only — managed by auth provider)
- Timezone (editable, used for sample-time display)
- Default units (lb/kg) — also exposed in `/settings/program-prefs`, but mirror here because users look for it under "account"
- Link to Active Sessions
- Link to Backups
- Danger zone link → `/settings/danger`

### Multiple devices logged in — Active Sessions page

`/settings/sessions` (Beta-new). Lists every live session for the logged-in user. Source of truth: `auth_sessions` table per `05-auth.md`.

Per row:
- Device label (parsed from User-Agent: "iPhone Safari", "Chrome on macOS")
- Created at, last active at
- IP / approximate location (city-level only — never raw IP shown)
- "Current session" badge on the row matching the active cookie
- **Revoke** button (disabled on the current session, with tooltip "Use Sign Out to end this session")

Bottom of the page:
- **Sign out everywhere** button — heavy confirm: "This will sign you out on every device, including this one. Continue?" → calls `POST /api/auth/sessions/revoke-all`.

Reachable from: account menu popover, account settings page, mobile drawer.

---

## Onboarding flow — IA + step sequence

### The "where does onboarding live" decision

**Decision: onboarding works on BOTH desktop and mobile, but the shape differs.**

Justification: a user signing up on their phone (e.g., they followed a share-link from a friend) cannot be told "go find a desktop." That's a brick-wall first impression and a guaranteed churn moment. The device-split principle says authoring tools live on desktop — but **first-run setup is a one-shot ceremony, not authoring**. Once a user is onboarded, future authoring (program customization, equipment edits) properly redirects to desktop. So:

- **Desktop onboarding** — full flow inline. Every step has full editing affordances.
- **Mobile onboarding** — same step sequence, but each step uses presets + minimal customization. The mobile flow is "lite" — pick from a short list of equipment presets (already implemented in `EquipmentWizard`), pick from a short list of recommended programs (no fork-wizard customization), accept defaults. After onboarding, the user is told **once**: "Tip: customize your program on desktop at repos.jpmtech.com — your changes sync."

This honors the device-split spirit (no full ForkWizard on a phone) without bricking phone signup.

### Step sequence

```
┌─────────────────────────────────────────────────────────────┐
│ STEP 0 — Welcome                                            │
│ "Welcome to RepOS. We'll get you to your first workout in   │
│ about 90 seconds."                                          │
│ [ Get started ]   ← only CTA. No "skip" — this is just copy.│
├─────────────────────────────────────────────────────────────┤
│ STEP 1 — Goal                                               │
│ "What are you here to do?"                                  │
│ ○ Build muscle (hypertrophy)                                │
│ ○ Get stronger (strength)                                   │
│ ○ Stay healthy (general fitness)                            │
│ ○ Cardio + conditioning                                     │
│ [ Continue ]   [ Skip — choose later ]                      │
├─────────────────────────────────────────────────────────────┤
│ STEP 2 — Equipment                                          │
│ Existing EquipmentWizard component, but rendered inline as  │
│ a step rather than a forced modal.                          │
│ Presets: Home minimal / Garage gym / Commercial gym /       │
│         Cardio-only (NEW for cardio-first-class)            │
│ [ Continue ]   [ Skip — bodyweight defaults ]               │
├─────────────────────────────────────────────────────────────┤
│ STEP 3 — Pick a program                                     │
│ Filtered by goal (step 1) and equipment (step 2).           │
│ DESKTOP: shows 3-up grid of recommended templates with      │
│   "Customize" + "Use defaults & start" per card.            │
│ MOBILE: shows vertical list, "Use defaults & start" only.   │
│ [ Skip — just log workouts manually ]                       │
├─────────────────────────────────────────────────────────────┤
│ STEP 4 — When do you train?                                 │
│ "Pick the days you want to train. We'll schedule your       │
│ first session for the next one."                            │
│ [ Mon ] [ Tue ] [ Wed ] [ Thu ] [ Fri ] [ Sat ] [ Sun ]     │
│ [ Continue ]                                                │
├─────────────────────────────────────────────────────────────┤
│ STEP 5 — Health sync (optional)                             │
│ "Sync bodyweight from Apple Health? Takes 30 seconds in     │
│  Shortcuts."                                                │
│ [ Show me how ] → opens /settings/integrations              │
│ [ Skip — I'll do it later ]                                 │
├─────────────────────────────────────────────────────────────┤
│ STEP 6 — You're set                                         │
│ "First workout: TUESDAY · MAY 12 · UPPER A"                 │
│ [ Take me home ]   ← navigates to / (Today)                 │
└─────────────────────────────────────────────────────────────┘
```

### Why goal before program, not the reverse

- A user who picks "build muscle" and then sees a strength-focused program in the picker is confused — they expected a hypertrophy meso. The goal field filters/sorts the program catalog upstream.
- Goal also feeds default RIR targets and volume landmarks — it's a more durable signal than program choice (programs change every meso; goal is sticky).

### Skip-able steps

- **Step 0 (welcome)**: not skippable (it's just copy).
- **Step 1 (goal)**: skippable — defaults to "general fitness".
- **Step 2 (equipment)**: skippable — defaults to bodyweight-only.
- **Step 3 (program)**: skippable — user lands on Today with "no active program. Browse → /programs" empty state.
- **Step 4 (schedule)**: skippable iff step 3 was skipped (otherwise required to schedule the meso).
- **Step 5 (health sync)**: always skippable.
- **Step 6 (done)**: not skippable (it's the exit).

### "I'm done" moment

Step 6's **Take me home** button. The transition is intentional: post-onboarding, the user lands on `/` and sees their first scheduled workout (or an empty Today if they skipped program selection). The Today page subtly shows "Welcome — your first session is queued for Tuesday" in place of the usual greeting, ONCE.

### Trigger condition

Onboarding shows when: `auth.status === 'authenticated'` AND `user.onboarding_completed_at IS NULL`. After step 6 we `POST /api/me/onboarding/complete` to set the timestamp.

The current `EquipmentWizard` modal is **demoted** — it no longer auto-renders on empty profile. It only renders inside Step 2 of the onboarding flow.

---

## Exercise picker flow (desktop) — spec

The current `DayCard onSwap` is `alert('Exercise picker not yet wired — coming in next PR.')` (see `MyProgramPage.tsx:169`). Beta wires it up.

### Surface classification

- **Desktop primary**: full picker for program editing (the "swap an exercise inside my forked program" action).
- **Mobile primary** (already exists): `MidSessionSwapSheet` — single-tap reuse of `<ExercisePicker>` rendered as a bottom sheet. Lives inside the live-logger flow.
- **Shared component**: `<ExercisePicker>` (already in `frontend/src/components/library/`) — different chrome per surface but one filter/search engine.

### Beta MVP picker (desktop)

Triggered by clicking a block's "Swap" affordance on `DayCard`. Renders as a centered modal (not a slide-over) at ~720px wide.

**Filters present in Beta MVP:**

1. Free-text search (name + slug substring) — already exists.
2. Muscle group chips (chest / back / shoulders / arms / legs / core) — already exists.
3. **Equipment filter** — defaults to "Available only" (matches user's `equipment_profile`). User can toggle off to see "everything in the catalog." Already exists in component.
4. **NEW for Beta — Movement pattern filter** (push / pull / squat / hinge / carry / isolation) — single-select chip row. Many users think in patterns ("I need a push today") rather than muscles.
5. **NEW for Beta — Show only my saved exercises** toggle — when ON, restricts to user's `mine` collection (saved variants). Off by default.

**Substitution affordances:**

When the picker is opened from a DayCard block, the selected exercise's slug is passed in as `currentSlug`. The picker then shows a top "Suggested swaps" row (rendered by the existing `<SubstitutionRow>` component) with same-pattern + same-primary-muscle + equipment-compatible exercises. Below that, the full filtered catalog. This is the same affordance the mobile mid-session sheet uses — one shared substitution rule.

**Confirm step:**

Selecting an exercise from the catalog **does not immediately mutate the program**. Instead it transitions the modal to a "review swap" state:

```
┌──────────────────────────────────────────────────────┐
│  Swap exercise                                        │
│                                                       │
│  FROM    Barbell Bench Press                          │
│  TO      Dumbbell Incline Press                       │
│                                                       │
│  • Same primary muscle (chest)                        │
│  • Same movement pattern (horizontal push)            │
│  • Available with your current equipment              │
│                                                       │
│  Apply to:                                            │
│  ○ This block only (TUE — UPPER A)                    │
│  ● Every occurrence in this mesocycle                 │
│                                                       │
│  [ Cancel ]                       [ Confirm Swap ]    │
└──────────────────────────────────────────────────────┘
```

The "Apply to" radio is essential: the difference between fixing a one-off and rewriting the meso is huge. Default depends on entry context — if invoked mid-session via DayCard's "right now" affordance, default is "this block only"; if invoked from the program page's edit affordance, default is "every occurrence."

### Injury contraindications — Beta vs GA

**Out of Beta MVP.** Contraindication tagging on exercises (e.g., `contraindicated_for: ['shoulder_impingement']`) is data work that should live in the exercise catalog spec. Beta picker exposes a placeholder filter "Hide flagged exercises" wired to `false` everywhere — we ship the toggle in the UI but it's a no-op until the catalog gets contraindication tags in GA. This avoids a future UI rework when the data lands.

### Evidence-based substitutions — Beta vs GA

**In Beta MVP, substitutions are mechanical:** same primary muscle + same movement pattern + equipment-compatible.

**In GA:** add a "rationale" badge on substitution suggestions ("RECOMMENDED — same biomechanical loading curve" / "OK SUBSTITUTE — different angle, similar fiber recruitment") sourced from the exercise catalog's substitution-graph metadata. Beta does not block on this.

### User-reachability

A logged-in user reaches the desktop exercise picker via:
- Today (desktop) → click the active program day → DayCard's block "..." menu → Swap exercise
- Programs → My program detail → DayCard block "..." menu → Swap exercise
- (Beta-new) Library page → "Edit my program" CTA on any catalog row → opens the picker scoped to that program

---

## Landmarks editor flow (if in Beta)

**Decision: in Beta, behind a feature flag, exposed on desktop only.**

Per the program spec, landmarks (MEV / MAV / MRV per muscle group) drive volume warnings on `ScheduleWarnings`. Currently they're inferred from program defaults; user override is not exposed.

### Placement in IA

`/settings/program-prefs` page, second section ("Volume landmarks").

```
SETTINGS / Program preferences

  Default RIR target          [ 2 ]  ← stepper
  Deload sensitivity          [ Standard ▼ ]
  Units                       [ Pounds ▼ ]

  ─────────────────────────────────────────

  Volume landmarks                              [ Reset to defaults ]
  Override the per-muscle volume thresholds we use to generate
  warnings. Most users should leave these alone.

  Muscle         MEV    MAV    MRV    Source
  ────────────────────────────────────────────
  Chest          [10]   [16]   [22]   Default
  Back           [12]   [20]   [25]   Override
  Shoulders      [ 8]   [16]   [24]   Default
  ...
```

Each input is a stepper. "Source" column shows whether the value matches the program-default landmark or has been overridden. **Reset to defaults** restores all rows to program defaults.

### Per-program override vs global

**Decision: global only in Beta.** Per-program overrides are powerful but adds a confusing dimension ("which set of landmarks apply right now?"). Beta ships global. Per-program lives in GA, exposed inside `MyProgramPage` only when the global value differs from program defaults.

### Mobile

**No mobile editor.** On `/settings/program-prefs` mobile, the landmarks section renders read-only with copy: "Edit landmarks on desktop. They affect every program."

### Why behind a flag

Landmarks are a power-user control. If user research during Beta suggests average users never touch them, the section can be feature-flagged off without removing the underlying API. Default: flag ON for the alpha tester (a self-described power user); design for a future toggle.

### User-reachability

Sidebar → Settings → Program preferences → scroll to "Volume landmarks". Account menu popover → Preferences (alias). Plus a contextual link from `ScheduleWarnings`: "Adjust landmarks" → opens this section.

---

## Restore-from-backup flow

Per `project_arr_style_db_recovery` and the *arr-app pattern. Desktop-only — restoring DB backups from a phone is a foot-gun magnet.

### Site map

`/settings/backups` — sidebar Settings → Backups (Beta-new sub-nav entry).

### Page layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ SETTINGS / Backups                                                    │
│                                                                       │
│ Snapshots are taken automatically every night and on every program   │
│ change. We keep the last 14 daily + last 5 manual.                   │
│                                                                       │
│                                              [ + Backup now ]        │
│                                                                       │
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ TIMESTAMP            TRIGGER       SIZE     ACTIONS              │ │
│ │ 2026-05-07 03:00     Auto · daily  4.2 MB   [Restore]  [Delete]  │ │
│ │ 2026-05-06 18:42     Manual        4.2 MB   [Restore]  [Delete]  │ │
│ │ 2026-05-06 03:00     Auto · daily  4.1 MB   [Restore]  [Delete]  │ │
│ │ 2026-05-05 09:14     Auto · meso   4.0 MB   [Restore]  [Delete]  │ │
│ │ ...                                                              │ │
│ └──────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

### Backup-now flow (low-stakes)

1. Click "Backup now" → button transitions to "Backing up..." with spinner.
2. `POST /api/backups` returns the new row.
3. Row appears at top of the list with a brief flash highlight.
4. No confirm dialog — adding a backup is non-destructive.

### Restore flow (heavy confirm)

1. Click "Restore" on a row.
2. **First confirm modal:**
   ```
   Restore from this backup?
   Created: 2026-05-06 18:42 · 4.2 MB

   This will REPLACE your current data with the contents of this
   snapshot. Anything you've logged since 2026-05-06 18:42 will be
   PERMANENTLY LOST.

   [ Cancel ]   [ I understand, continue → ]
   ```
3. **Second confirm modal — type to confirm:**
   ```
   Type RESTORE to continue.
   [_____________]
   [ Cancel ]   [ Restore ]   ← disabled until input matches exactly
   ```
4. Frontend `POST /api/backups/:id/restore`.
5. **In-flight state:** full-screen overlay "Restoring from snapshot... this may take 30 seconds. Do not close this tab."
6. On success: server returns 202 + a `restore_complete_at` ETag. Frontend force-reloads (`window.location.reload()`) — fresh API state, fresh auth-context bootstrap. The reload is a feature: it guarantees the user sees the restored state immediately without stale cached query data.
7. After reload: a one-shot toast "Restored from snapshot 2026-05-06 18:42." dismisses on first interaction.

### Delete flow

Single confirm: "Delete this backup permanently? It cannot be recovered." → `DELETE /api/backups/:id`. List refreshes.

### Availability

The Backups page is reachable from sign-in. It does NOT gate on having an active program — even pre-program, automatic snapshots run, so there's something to see. If the snapshot list is empty (fresh install): show "No backups yet. The first nightly backup runs at 3am." with a "Backup now" CTA.

### Mobile

On mobile, `/settings/backups` renders the snapshot list **read-only** (timestamp + size + trigger). The "Backup now," "Restore," and "Delete" actions are replaced with an explanatory card: "Backups are managed on desktop." Tapping a row shows its detail; that's it. Heavy confirm + reload flow on a phone in a gym is a recipe for disaster.

---

## Live-data UX hardening checklist

Beta is where the database starts holding non-throwaway data. Every interaction needs a thoughtful destructive/undo/error story.

### Destructive actions — explicit confirm required

| Action | Confirm pattern | Notes |
|---|---|---|
| Delete mesocycle | Heavy (type-to-confirm) | Cascade deletes sessions + sets — irreversible. |
| Abandon mesocycle | Light (single click confirm) | Reversible via "restart from past" tab. |
| Restart program | Light | Creates a new run, doesn't delete old. |
| Change goal mid-meso | Light | Warn that recommendations will shift. |
| Wipe program history | Heavy (type-to-confirm) | Lives in `/settings/danger`. |
| Delete account | Heavy (type-email-to-confirm) | Lives in `/settings/danger`, requires re-auth. |
| Delete backup | Light | Reversible by manual re-backup. |
| Restore from backup | Heavy (type RESTORE) | See backup spec above. |
| Revoke session | Light | Cannot revoke current session. |
| Sign out everywhere | Light, sticky | Single confirm but copy emphasizes "this device too." |
| Bulk-delete logged sets | Light | Per-set undo handles individual mistakes; this is for dev / cleanup. |
| Reset volume landmarks | Light | "Restore defaults?" |

### Undo windows — non-destructive actions

| Action | Undo affordance | Window |
|---|---|---|
| Logged a set | Toast "Set logged. UNDO" → tap to delete | 8 seconds, auto-dismiss |
| Marked workout complete | Toast "Workout saved. UNDO" → reverts to in-progress | 12 seconds |
| Skipped a planned set | Inline "skipped — undo" link inside the set row | until session save |
| Swapped exercise mid-session | Toast "Swapped to X. UNDO" → reverts the planned set's exercise_id | 15 seconds |
| Started rest timer | Tap timer to pause/cancel | always available while running |
| PR celebrated | "Not a PR? Tap to undo" link inside PR toast | until next set logged |
| Marked deload week | Inline link "Cancel deload" inside Today header | until first set of deload week logged |

### Error recovery — offline / signal loss

The mobile live-logger is the only surface where offline behaviour is critical (gym wifi/cell often spotty).

**Beta-MVP offline model: Optimistic local + best-effort sync, no full PWA.**

1. Set submission first writes to IndexedDB (`workout_set_queue` store) keyed by client-generated UUID.
2. UI advances immediately (optimistic) — user sees "Set 3/4 logged."
3. A background sync loop (`navigator.onLine` + `setInterval(5000)`) drains the queue to `POST /api/sets`. On 2xx, the queue entry is removed.
4. On `navigator.onLine === false`, the Topbar shows an offline pill: **"OFFLINE · 3 sets queued"** in amber.
5. On reconnect, the pill flashes green for 2 seconds: **"SYNCED"** then disappears.
6. If a queued set fails server-side (validation error, conflict): the set's row in the UI gets a red dot + "Failed to sync — tap to retry / discard". User keeps control.

**What's NOT in Beta-MVP offline:**
- Reading a fresh program day while fully offline (we cache the *active* day's structure on session start, so a mid-session network outage works; "open the app cold while offline" doesn't).
- Offline rest timer needs no network — it runs purely client-side already.
- Offline weight entry from `MobileWeightChip` — the chip is read-only on mobile per current spec.

**What's NOT supported at all in Beta:**
- Multi-device concurrent live sessions (logging the same workout on phone + tablet simultaneously). The auth_sessions UI shows all logged-in devices but the API does not currently merge concurrent set writes from two devices into one session. If detected, the second write returns 409 with copy: "Looks like you started this session on another device. Continue there, or end that session first." (Edge case — punt to GA.)

### Form-level error UX

Per global CLAUDE.md "NEVER show generic error messages." Every API error in Beta surfaces as: `{action verb} failed: {server-supplied reason}. {what to check}`. Toast-style at the bottom of the viewport, dismissible, with a "Copy details" link for support.

Examples:
- "Set log failed: weight 850 lb is outside the allowed range (1–800 lb). Check the weight value."
- "Couldn't restore backup: snapshot file is corrupted. Try a different snapshot or contact support."
- "Sync failed: server returned 503. Your data is queued locally and will retry automatically."

---

## Mobile-vs-desktop classification (Beta surfaces)

Per `project_device_split` — every Beta-new surface is classified.

| Surface | Device class | Why |
|---|---|---|
| Onboarding flow | **Both** (lite on mobile) | First-run cannot brick on phone signup. Mobile flow is preset-only. |
| Account menu (popover/in-drawer) | **Both** | Sign-out is a universal need. |
| Active sessions list | **Both** | Quick mobile glance OK; revoke action present on both. |
| Sign-out everywhere | **Both** | Universal need. |
| Sign-in / sign-up screens | **Both** | Entry point. |
| Goal picker (in onboarding) | **Both** | Lightweight choice, stays in-flow. |
| Program preferences page | **Desktop primary; mobile read-only** | Steppers + multi-input editor is desktop work. |
| Volume landmarks editor | **Desktop only** | Power-user authoring. Mobile shows read-only summary. |
| Exercise picker (full) — `/library` | **Desktop primary** | Browse + filter + manage saves. Mobile shows search-only condensed view. |
| Exercise picker — mid-session swap | **Mobile primary** (existing `MidSessionSwapSheet`) | Single-tap reuse of `<ExercisePicker>` as bottom sheet. |
| Exercise picker — desktop swap-in-program | **Desktop only** | Full modal with "apply to: this block / every occurrence" radio. |
| ForkWizard | **Desktop only** | Multi-step authoring. Mobile shows "open on desktop" hard-stop. |
| MyProgramPage editor (DayCard set add/remove) | **Desktop only** | Authoring. Mobile shows read-only week summary. |
| Live workout `/workout/:runId` | **Mobile primary** | Glove-friendly set entry, RIR/RPE wheel, rest timer. Desktop shows "follow on phone" + read-only set list. |
| Mid-session "I'm fried" auto-deload trigger | **Mobile primary** | In-the-moment decision. |
| PR celebration toast | **Mobile primary** | Visible inside live logger. Desktop shows in dashboard PR feed. |
| Mesocycle recap | **Both** | Shipped (per `MyProgramPage`). Recap stats render fine on mobile. End-of-meso choice (deload / run-it-back / new program) is a one-tap decision, OK on phone. |
| History page | **Both** | Read-only data review. Calendar heatmap → vertical list on mobile. |
| Backups page | **Desktop primary; mobile read-only** | Restore flow + heavy confirm + force reload is a foot-gun on phone. |
| Backup-now / Restore / Delete actions | **Desktop only** | Per above. |
| Settings → integrations (Apple Health) | **Desktop primary** | Token mint flow + Shortcut setup is a copy/paste-heavy desktop task. Mobile shows existing tokens + "Generate token on desktop." |
| Settings → equipment editor | **Desktop primary** | Multi-section authoring. Mobile shows current preset summary + "Edit on desktop." |
| Settings → account | **Both** | Display name + timezone + units edit OK on phone. |
| Active sessions revoke | **Both** | Per-row action; lightweight. |
| Danger zone (delete account, wipe history) | **Desktop only** | Heavy-confirm flows + re-auth on a phone in a gym = no. |
| Cardio session entry (live) | **Mobile primary** | Same as strength live entry. Treat with equal visual weight in Today and history. |
| Cardio session planning | **Desktop primary** | Same authoring class as strength program editing. |
| Cardio Apple Health Workouts ingestion | **Mobile primary** (passive) | Background sync, no UI surface beyond status indicator. |

---

## User-reachability audit (from home, post-login)

Click-paths for every Beta-bearing feature, recorded explicitly per `feedback_user_reachability_dod`. If a row's path is missing, the feature is not Done.

### Desktop reachability (home = `/`)

- [x] **Today's workout** — `/` → TodayCard "START" button → `/workout/:runId`
- [x] **Program management (active)** — `/` → TodayCard "View program" link → `/my-programs/:id` (existing)
- [x] **Program management (browse)** — Sidebar → Programs → `/programs` (existing)
- [x] **Mesocycle recap** — `/my-programs/:id` after run completes (existing wiring at `MyProgramPage:132`)
- [x] **Exercise swap (in-program)** — `/my-programs/:id` → DayCard block "..." menu → "Swap exercise" → modal *(currently `alert()` placeholder — Beta wires the picker)*
- [x] **Account settings** — Sidebar avatar → popover → Account settings (Beta-new) OR Sidebar → Settings → Account
- [x] **Backups** — Sidebar avatar popover → Backups OR Sidebar → Settings → Backups (Beta-new sub-nav)
- [x] **Active sessions** — Sidebar avatar popover → Active sessions (Beta-new)
- [x] **Sign out** — Sidebar avatar popover → Sign out (Beta-new)
- [x] **Volume landmarks editor** — Sidebar → Settings → Program preferences → "Volume landmarks" section (Beta-new)
- [x] **Exercise library browse** — Sidebar → Library (Beta-new top-level nav item) → `/library`
- [x] **History** — Sidebar → History (Beta-new top-level nav item) → `/history`
- [x] **Equipment editor** — Sidebar → Settings → Units & equipment (existing)
- [x] **Health integration tokens** — Sidebar → Settings → Integrations (existing)
- [x] **Onboarding** — auto-launches when `user.onboarding_completed_at IS NULL` on first sign-in (Beta-new)
- [x] **Cardio session view** — Today (if cardio-only program) OR `/my-programs/:id` (cardio templates render with strength-equivalent weight per `feedback_cardio_first_class`)

### Mobile reachability (home = `/`)

- [x] **Today's workout** — `/` → TodayWorkoutMobile "START" button → `/workout/:runId` (live logger)
- [x] **Mid-session swap** — `/workout/:runId` → block "..." → MidSessionSwapSheet (existing, wired per recent commit)
- [x] **Mid-session "I'm fried" auto-deload** — `/workout/:runId` → header menu → "I'm fried — deload" (Beta-new)
- [x] **Active program (read-only)** — Hamburger drawer → Programs → `/my-programs/:id` (read-only mobile render)
- [x] **Browse templates (read-only)** — Hamburger drawer → Programs → `/programs` (mobile render)
- [x] **Account settings** — Hamburger drawer → avatar block → Account settings
- [x] **Active sessions** — Topbar avatar OR drawer → avatar block → Active sessions
- [x] **Sign out** — Topbar avatar OR drawer → avatar block → Sign out
- [x] **History** — Hamburger drawer → History
- [x] **Library (search-only)** — Hamburger drawer → Library
- [x] **Backups (read-only)** — Hamburger drawer → Settings → Backups
- [x] **Equipment editor (read-only)** — Hamburger drawer → Settings → Units & equipment (read-only on mobile)
- [x] **Onboarding (lite)** — auto-launches first sign-in on phone

### Cross-cutting reachability checklist

For every Beta surface, the integration test is:
1. Sign in fresh (clear cookies).
2. Click click-path verbatim from the table above.
3. Assert: target page renders + key element visible + non-error state.
4. Repeat on the other viewport class.

Per `feedback_user_reachability_dod`, this is the only integration that proves "Done."

---

## Risks / unknowns

1. **Phone-native onboarding tension.** We've spec'd a "lite" mobile onboarding to avoid bricking phone signup, but the device-split memory says authoring happens on desktop. The risk is users complete lite onboarding on phone, never visit desktop, and miss out on customization features that would actually serve them. **Mitigation:** at end of mobile onboarding, the "Take me home" screen includes a one-time card "Tip: customize on desktop" with a copyable URL. Track in metrics whether mobile-onboarded users visit desktop within 7 days.

2. **Account menu trigger on mobile is busy.** The Topbar already has a sync pill + hamburger; adding an avatar trigger on the right makes three icons in 40px-tall chrome. May feel cluttered. **Mitigation A**: drop the Topbar avatar shortcut, require users to open the drawer for account actions. **Mitigation B**: collapse the sync pill into a single dot icon on mobile to reclaim space. Pick during build.

3. **Restore-from-backup force reload.** Reloading the SPA after a restore is robust (no stale cache) but jarring (user sees a flash of the sign-in screen if the restore changed their session token). **Mitigation:** keep the restore overlay visible across the reload by setting a session-storage flag pre-reload, then clearing it post-bootstrap.

4. **Per-set offline UX for failed-to-sync rows.** A red-dot retry-or-discard pattern is honest but adds visual complexity inside the live logger, which is supposed to be brutal-simple. **Mitigation**: investigate whether 99% of failures are network (auto-recovered on reconnect) vs. server-validation (rare). If network-dominant, the red-dot UI may be over-engineering.

5. **No `/workout/:runId` exists today.** TodayCard's `onStart` is `alert()` (`TodayPage.tsx:9`). The live logger route + page is a sibling Beta sub-project; this spec assumes it ships. If it slips, the Today CTA needs a graceful "coming soon" state, not a broken alert.

6. **Cardio first-class but spec is strength-shaped.** Most of this IA was written with strength surfaces as the canonical example. Need to walk through each row with a cardio-only user persona to check the surfaces don't accidentally hide cardio paths.

7. **Sessions-page UA parsing.** "iPhone Safari" / "Chrome on macOS" is fragile if we hand-roll it. Use a maintained library (`ua-parser-js`) or accept a degraded "unknown device" fallback rather than ship a custom regex.

---

## Open questions for cross-team review

For **product** (`01-product.md`):
- Is the cardio-only equipment preset (Beta-new) a hard requirement or nice-to-have? Affects whether onboarding step 2 needs the 4th preset or stays at 3.
- Should the goal picker include a "competitive — powerlifting / bodybuilding / endurance" option, or keep Beta to the four lifestyle goals listed?
- Do we want a "Welcome — first session is queued for Tuesday" one-shot greeting on Today after onboarding, or land users silently?

For **backend** (`02-backend.md`):
- The Active Sessions page assumes a `GET /api/auth/sessions` returning device + last-active + IP-derived city. If `auth_sessions` only stores `(id, user_id, created_at, expires_at)` without UA + IP, that's an ingestion change.
- Restore-from-backup returning a `restore_complete_at` ETag isn't standard — does the backend want a polling pattern instead of synchronous response?
- `POST /api/me/onboarding/complete` is new. Confirm column on `users` table (`onboarding_completed_at TIMESTAMPTZ`).
- Does backend store user goal as a column on `users` or as a typed `user_preferences` row?

For **auth** (`05-auth.md`):
- Sign-out everywhere: does CF Access JWT revocation propagate immediately or is there a TTL? UI copy depends on this.
- Re-auth requirement for "delete account" — does CF Access support a fresh-auth claim, or do we trust the existing session?

For **frontend** (`03-frontend.md`):
- Are we OK adding `ua-parser-js` or equivalent to Beta's bundle for the sessions page, or do we ship a degraded "unknown device" label?
- `useIsMobile()` returns a single boolean. For the picker confirm modal sizing on tablets, do we need a third "tablet" class? Or treat tablet as desktop?

For **data** (`04-data.md`):
- What's the actual snapshot retention default? Spec assumes 14 daily + 5 manual; needs alignment with backup-job spec.
- For the `equipment_profile` cardio addition, do we need new preset rows in the catalog, or extend existing presets?

For **operations / deploy**:
- `npm test` locally is broken per current `CLAUDE.md`. The user-reachability audit's playwright tests need a working local DB or in-container test path. Is that solved before Beta UI work starts?
