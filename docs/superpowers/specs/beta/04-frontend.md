# Beta Scope — Frontend

Author: Frontend Engineering specialist · 2026-05-07
Branch baseline: `main` @ b6a8a47 (Mesocycle recap merged, MidSessionSwap merged)
Charter source: scoping prompt, `Engineering Handoff.md`, `CLAUDE.md`, design memories.

Beta = "usable, live data, full featured." After Beta the loop is squash-and-polish to GA.
The frontend today is functionally complete for **happy-path program forking and mid-session swap on mobile** but cannot stand alone with multiple users, has at least three `alert()` placeholders on user-reachable paths, no onboarding outside the EquipmentWizard popover, no exercise picker on desktop, and no live-set-logging surface (Today's `handleStart` is `alert('Workout execution flow not yet wired')`).

The single largest open question — auth scheme — is being scoped by Backend in a parallel dispatch. This spec presents UI for the **leading scheme (Cloudflare Access pass-through, already partially wired via `/api/me` in `auth.tsx`)** and notes adaptations for the two realistic alternatives.

---

## Must-have for Beta (blockers)

### B1. Live workout logger — mobile (L)
Currently `pages/TodayPage.tsx:9` triggers `alert('Workout execution flow not yet wired — coming in next PR.')` when the user taps **Start Workout** on the existing `TodayWorkoutMobile`. Without a logger you cannot ingest set data, which means the volume heatmap, recap stats, PR detection, and "we ship clean" aspiration of Beta all collapse. **This is the largest single Beta gap by cost and the highest-priority blocker.** See spec section "Live workout logger spec" below.

### B2. Real auth — sign-in / sign-out / account identity (M, plus L for backend coordination)
`PLACEHOLDER_USER_ID = '00000000-0000-0000-0000-000000000001'` (`auth.tsx:28`) is still the fallback when `/api/me` returns 503 `cf_access_disabled`. Production already proxies through Cloudflare Access, but:
- There is no **sign-out** affordance anywhere in the UI (Sidebar's avatar block is decorative).
- There is no graceful "you've been signed out" flow when CF Access cookie expires mid-session (the API client redirects via `WWW-Authenticate: CFAccess url=…` — fine for fresh requests, jarring during a mid-set log POST).
- "Profile editing, password changes, and session management land in v2" copy in `SettingsAccount.tsx:73` — Beta needs at minimum a sign-out button and a clear identity pill.

### B3. Desktop exercise picker, wired (M)
`pages/MyProgramPage.tsx:169` and `components/programs/ForkWizard.tsx:195` are `alert(...)` and `// TODO` respectively. The ExercisePicker component already exists (`components/library/ExercisePicker.tsx`) and is reachable in dev at `/dev/picker`. Beta-blocker because customizing a forked program (the entire point of "make this template mine") is broken without it.

### B4. Mid-session swap success toast (S)
Open thread from last session: `MidSessionSwapSheet.confirm()` calls `onClose(true)` and `TodayWorkoutMobile` re-fetches — but the user gets no confirmation. A working swap and a no-op swap are visually identical to the user. Add a 2.5s toast: "Swapped to <new exercise name>. Undo." Undo for 5s only.

### B5. Onboarding flow — first-time user path (M)
The EquipmentWizard popover (`components/onboarding/EquipmentWizard.tsx`) is the **only** onboarding surface and only fires when `isProfileEmpty(profile)` is true on app mount. A new user lands on `/` (TodayPage) with `state: 'no_active_run'` and the only copy is "No active mesocycle. Pick a program on desktop." — they have no idea what to do next. Add a multi-step onboarding (see spec below).

### B6. User-editable landmarks editor — Sports Med blocker pending (M, conditional)
Landmarks are currently template-fixed (`api/src/services/_muscleLandmarks.ts` is a read-only constant). If Sports Med specialist deems user-editable MEV/MAV/MRV per-muscle a Beta blocker (they likely will because individual recovery varies), the frontend needs an editor surface. **Cost is M only if the backend ships `GET/PUT /api/users/me/landmarks`** in the same Beta cycle. If backend defers the landmark API, this becomes "Defer to GA." Treat the schema change as the gating dependency and conditionally include.

### B7. Account menu — sign-out, account settings, version (S)
The Sidebar avatar is currently decorative. Make it a popover (Radix, already a dep) with: display name + email, "Account settings" link to `/settings/account`, "Sign out" action, app version + commit SHA. Sign-out for CF Access pass-through means `window.location.assign('/cdn-cgi/access/logout')` — a one-liner, but undiscoverable today.

### B8. Replace remaining `alert()` calls with toasts (S)
4 remaining: `MyProgramPage.tsx:169`, `TodayPage.tsx:10`, `SettingsIntegrations.tsx:104`, `:121`. After B3 lands, the first two go away as actual flows. The settings ones become inline error banners (we already have a pattern in `ForkWizard` — `role="alert"` block).

### B9. Term audit on new Beta surfaces (S)
Per `feedback_terms_of_art_tooltips.md`: every new term-of-art on a Beta surface must wrap in `<Term>`. Surfaces touched in Beta: live logger (RIR field, working set badges, rest timer), landmarks editor (MEV/MAV/MRV — already wrapped where they appear today), onboarding flow (mesocycle, deload), account menu (none expected). The AST-coverage check (`scripts/check-term-coverage.cjs` per the program plan) must run green in CI.

### B10. Live-data destructive-action confirmation hardening (S)
With real data, `Abandon current mesocycle` (`ForkWizard.tsx:137`) goes from "throw away three weeks of testing" to "throw away two months of real lifting." Wrap in a confirm modal with the actual program name typed-to-confirm. Same for any future "delete program" / "restart mesocycle." Cheap; ships clean.

### B11. Sign-in screen / unauth state (S, depends on B2 scheme)
Today there's no sign-in screen because CF Access redirects you out of the app entirely. If Backend stays on CF Access pass-through, this stays a no-op — the gate is at the edge, the SPA never renders for an unauthenticated request. If Backend picks email/password or magic link, we need a `<SignInPage>` component, route, and redirect-to-intended-destination logic. **Cost is S for CF Access, M for email/password, M for magic link.**

---

## Nice-to-have for Beta

- **NH1. Swap-undo persistence (M)** — undo toast exists for 5s in B4; persist last swap in component state until next swap so the user can undo even after the toast dismisses.
- **NH2. Volume heatmap mobile rendering (S)** — `ProgramPage.tsx` heatmap is desktop-only by design, but mobile users opening `/my-programs/:id` get the full grid which scrolls awkwardly. Switch to a vertical-week list on mobile.
- **NH3. PR celebration toast (S)** — when a logged set beats prior best at the same exercise/rep range, surface a `+5 lb PR!` toast. Spec'd in `feedback_cardio_first_class.md`-adjacent territory; cheap.
- **NH4. Empty-state for Today on rest day (S)** — current copy is `<strong>Rest day.</strong>` — ship something more useful (last workout summary, next workout preview, weight chart).
- **NH5. Light keyboard shortcuts on desktop authoring (S)** — `j/k` nav between days in DayCard grid, `s` to swap. Power-user polish, no blocker.
- **NH6. Skeleton loaders replacing "Loading…" text (S)** — there are 11+ "Loading…" string-fallbacks in the codebase. Per `CLAUDE.md`'s loading-state guidance, skeletons should replace these. Polish, not blocker.
- **NH7. Mesocycle recap "deload-intent" UX clarity (S)** — `MyProgramPage.tsx:80-85` navigates to `/programs/:slug?intent=deload` but the API doesn't currently honor `?intent=deload`. The user sees a normal fork wizard with no indication of deload intent. **Either (a) frontend strips the link (just goes to fork wizard, user picks a lighter week manually), with adjusted recap copy, OR (b) we wait for backend deload-intent support.** Per the prompt, this is a "frontend may need different UX if API doesn't honor" case. Recommend (a) for Beta — change the button label from "Take a deload" to "Pick a lighter week" until v2.

---

## Defer to GA / post-Beta

- **D1. Multi-user account management** — adding/removing family members, role changes. Out of scope for single-user CF Access deployment.
- **D2. Account deletion / GDPR self-service** — stub link to `mailto:` for Beta, real flow at GA.
- **D3. Email change / password reset** — depends on B2's scheme.
- **D4. PWA install prompt + offline writes** — Beta gym-basement reliability (B12) is a thinner version: cache the active workout day so set logging works briefly offline. Full PWA + offline-first is GA territory.
- **D5. Notification settings panel** — no email/push wired yet. Defer.
- **D6. Withings/Renpho integration UI** — backend v2 per spec.
- **D7. Cardio session live logger** — strength logger first (B1); cardio logger reuses 70% of the surface, ships in patch release post-Beta. Per `feedback_cardio_first_class.md` this is "scheduling, not deprioritizing" — flag in PASSDOWN.
- **D8. Theme switcher (light mode)** — dark glassmorphism is The Theme per `CLAUDE.md`. Don't.
- **D9. Source-priority UI for weight syncs** — multi-source enabled in v1 backend but only Apple Health + Manual exist; UI for priority is post-Beta when Withings lands.
- **D10. Fully responsive volume heatmap (NH2 above is the cheap version)** — the rich version with pinch-zoom etc. is GA.

---

## Auth UI specs

### Leading scheme: Cloudflare Access pass-through (already partially wired)

**Why this is the leading scheme:** `auth.tsx` already implements the `/api/me` bootstrap, the 401-with-`WWW-Authenticate: CFAccess url=...` redirect, and a `'disabled'` fallback for the transitional flag. Production deploy at `https://repos.jpmtech.com` is already gated by CF Access. Backend will likely confirm pass-through stays.

**Surfaces:**
1. **Sign-in screen — does not exist in our SPA.** CF Access intercepts at the edge. We render nothing for unauthenticated users; they see the CF Access challenge page (Google/email OTP per Access policy). Acceptable as long as the policy UI is themed (separate Cloudflare config item, out of frontend scope).
2. **Identity pill + account menu — Sidebar avatar block becomes a Radix Popover.** Click → menu with: `{display_name}\n{email}`, separator, "Account settings → /settings/account", "Sign out → /cdn-cgi/access/logout".
3. **Account settings page (`/settings/account`)** — replace the v2-deferred copy with: identity card (read-only — managed by Cloudflare), timezone selector (writes to `users.timezone`), "Sign out of this device" button (alias for header sign-out).
4. **Mid-session 401 handling — graceful redirect is the bug.** Current `apiFetch` does `window.location.assign(loginUrl)` on 401 which mid-set-log destroys the user's input. Fix: catch 401 in the live logger, save log buffer to `localStorage`, then redirect; on return, hydrate from buffer.
5. **No sign-up screen.** New users are added by adding their email to the CF Access policy. Frontend has no role here; document in PASSDOWN.

**Adaptations if Backend picks email/password instead:**
- Add `<SignInPage>` route at `/sign-in`, `<SignUpPage>` at `/sign-up`, `<ForgotPasswordPage>` at `/forgot-password`. AuthGate redirects unauthenticated users to `/sign-in`.
- Replace CF Access logout link with `POST /api/auth/logout` then redirect to `/sign-in`.
- Replace `/api/me` 401-CFAccess-redirect with 401-redirect-to-sign-in.
- Wire forgot-password emailer (depends on backend email infra).
- Cost delta: **+M** vs CF Access pass-through.

**Adaptations if Backend picks magic-link:**
- `/sign-in` is a single email field + "Send link." Submit-disabled while pending.
- New route `/auth/callback` consumes the magic-link token, sets the session cookie, redirects to intended destination.
- No password field anywhere.
- Same logout flow as email/password.
- Cost delta: **+M** vs CF Access pass-through, similar to email/password.

### Auth UI components needed (regardless of scheme)

- `<AccountMenu>` — Radix Popover anchored to Sidebar avatar.
- `<SignOutButton>` — branched on scheme via build-time const.
- `<SessionExpiredBanner>` — shows when 401 hits mid-mutation; offers re-auth.
- `<LogBufferRecovery>` — silent restore of localStorage'd unsaved set logs after re-auth.

---

## Onboarding flow spec

**Trigger:** First app open after sign-in succeeds AND `equipment_profile` is empty AND user has zero `user_programs` AND `flags.onboarded_at IS NULL`.

**Device split per `project_device_split.md`:** Onboarding is **desktop-primary** because picking a program is a desktop activity. On mobile we show a CTA "Open RepOS on a desktop browser to set up your first program" with a fallback "Continue on mobile (limited)" link that runs an abbreviated flow. **Recommend desktop-required for Beta** — punts mobile-first onboarding to GA with no pain.

**Steps (desktop):**
1. **Welcome.** "RepOS is a hypertrophy-first training planner." 4 dot-pager. CTA: Continue.
2. **Equipment.** Reuses existing `<EquipmentWizard>` content but inlined (not modal). 3 presets + "Customize later" link.
3. **Goal.** Single-pick: "Build muscle (hypertrophy)" / "Get strong (strength — coming v2)" / "Just train consistently." For Beta, only hypertrophy is fully supported; the others get "We'll start you with hypertrophy and unlock that goal in a future release" and proceed.
4. **Program pick.** Inlined `<ProgramCatalog>` filtered to ≤2 templates compatible with their equipment + goal. Click → fork → first DayCard preview. CTA: Start Mesocycle (calls existing `startUserProgram`).
5. **First-workout primer.** Once program is started: brief explainer "Your first workout is on `<weekday>`. Open RepOS on your phone in the gym, log every set, and we'll auto-ramp you week to week." CTA: Done.

**Persistence:** `flags.onboarded_at = now()` after step 5; user lands on TodayPage. If they bail mid-flow (close browser), `flags.onboarded_at` stays null and they re-enter at last completed step.

**Term tooltips required:** `<Term k="hypertrophy">`, `<Term k="mesocycle">` in step 1 and step 4.

---

## Desktop exercise picker spec

**Trigger:** `onSwap` callback in `<DayCard>` (currently `alert(...)` in `MyProgramPage` and `// TODO` in `ForkWizard`).

**UI shape:** Right-side **slide-in sheet** (480px) anchored to the page, NOT a modal. Lets the user see the program structure on the left while picking. Mobile already has `<MidSessionSwapSheet>` as a bottom sheet — desktop is a side sheet of the same component family.

**Component:** Reuse existing `<ExercisePicker>` (already does search, muscle filter, equipment toggle). New wrapper `<DesktopSwapSheet>` adds:
- Header: "Swap `<from-name>`" with close button.
- Top of body: "Suggested" section showing top 3 from `<SubstitutionRow>` (already a built component).
- Body: full `<ExercisePicker>` with `defaultEquipmentToggle=true`.
- Pick → confirms inline (no second-step confirm — user already chose by clicking) → calls `patchUserProgram({op: 'swap_exercise', day_idx, block_idx, to_exercise_slug})` → closes sheet → toast "Swapped to <new>" with 5s undo.

**State management:** Sheet is uncontrolled inside a parent. Parent passes `{open, fromBlock, onClose}`. Open state lives in `MyProgramPage`/`ForkWizard`.

**Accessibility:** `role="dialog"` `aria-modal="true"`, focus-trap on open (use `focus-trap-react`, already a dep — see `Sidebar.tsx`), Escape closes, click-outside closes.

**Term tooltips:** `<Term k="peak_tension_length">` if shown in substitution reasons; `<Term k="push_horizontal">` etc. for movement-pattern badges.

**File suggestion:** `frontend/src/components/programs/DesktopSwapSheet.tsx` (new) + test.

---

## Live workout logger spec (Beta-blocker B1)

This is the largest single piece of Beta work. The full spec belongs in its own document; here is the frontend-side summary.

**Surfaces:**
- **Mobile primary** per `project_device_split.md`. Rendered when `useIsMobile()` is true and the user taps **Start Workout** in `TodayWorkoutMobile`.
- **Desktop is read-only** — the user can see *that* a workout is in progress but cannot log sets from desktop. (Stretch — desktop logging behind a "advanced" toggle is post-Beta.)

**Component:** `<TodayLoggerMobile runId={...} dayId={...} />` in `frontend/src/components/programs/TodayLoggerMobile.tsx`.

**Per-set UI:**
- Exercise name + set N of M.
- Big inputs: **weight** (lbs, JetBrains Mono) and **reps** (number).
- **RIR slider** 0–4 with `<Term k="RIR">` tooltip.
- **Rest timer** auto-starts on log; large mm:ss readout, vibrate at 0.
- **Skip** / **swap** affordances.
- **Log set** = primary CTA, full-width, all-caps per design system.

**State:** Set logs accumulate in component state, flushed to `POST /api/set-logs` on each log (single-source-of-truth: server). On 5xx or network error, queue in `localStorage` keyed by `runId+dayId+blockIdx+setIdx`, retry on reconnect.

**Offline / weak signal (PWA-thin per D4):**
- Service worker caches the day's planned sets at workout start.
- Set logs queue in `localStorage` if offline; banner: "Offline — 2 sets queued. We'll sync when you reconnect."
- Reconnect: drain queue with backoff. UI shows a green check on each successfully-flushed set.

**Term tooltips:** `<Term k="RIR">`, `<Term k="working_set">`, `<Term k="AMRAP">` if last-set is AMRAP-eligible.

**Cost:** L (sole biggest Beta item).

**Dependencies on backend:** `POST /api/set-logs` and read-after-write semantics. Backend specialist owns; flag in cross-team review.

---

## Landmarks editor spec (if Beta-blocker)

**Conditional on B6 — Sports Med specialist call.**

**Surface:** New page at `/settings/landmarks`, sub-nav under Settings (alongside Integrations, Equipment, Account).

**UI:**
- Card per muscle group (chest, lats, upper_back, front_delt, side_delt, rear_delt, biceps, triceps, quads, hamstrings, glutes, calves — pulled from `_muscleLandmarks.ts`).
- Each card: muscle name, three numeric inputs (`<Term k="MEV">`, `<Term k="MAV">`, `<Term k="MRV">`), a "Reset to defaults" link.
- Validation: MEV ≤ MAV ≤ MRV, all ≥ 0, all ≤ 30.
- Save button at top — saves all dirty muscles in one PATCH.

**State:** Loads from `GET /api/users/me/landmarks` (backend dependency); falls back to `_muscleLandmarks` defaults if 404.

**Side effects to surface:** Any active mesocycle's volume distribution is **frozen at materialization** (per `Engineering Handoff.md` — week+1 baselines preserved). So changing landmarks only affects **future mesocycle starts**. Surface this as inline copy: "Changes apply to your next program. Active programs use the values that were in effect at start."

**Term tooltips:** All three landmark abbreviations on every card.

**Cost:** M, conditional on backend API (B6 in must-haves).

---

## Live-data UX hardening checklist

For Beta, every destructive or hard-to-undo action needs treatment per `CLAUDE.md` UI/UX section.

- [ ] **Abandon mesocycle** — type-to-confirm modal showing program name, week, set count logged.
- [ ] **Restart from Past** — explicit "you'll start a new mesocycle from <Template>; your finished one stays in Past" copy. Already roughly OK; verify post-fork wizard adds clarity.
- [ ] **Swap exercise (desktop + mobile)** — already inline-undo'd via toast (B4); confirm 5s window is enough.
- [ ] **Delete a custom program** — n/a in v1; surface only when feature lands.
- [ ] **Sign out** — confirm modal not needed (sign-out is recoverable). Just a one-click action.
- [ ] **Equipment profile reset / change preset** — confirm modal IF user has any active program (changes ripple through future swaps), else bare action.
- [ ] **Apple Health token revoke** — already in `SettingsIntegrations`, has confirm. Verify after auth scheme lands so token flows still work.
- [ ] **Form input loss on auth redirect** — `apiFetch` 401 handler currently nukes pending state. Add `LogBufferRecovery` per auth UI specs.
- [ ] **Error toasts that don't lose input** — never replace a form with an error. Always inline error + preserve fields.
- [ ] **Network failures during set-log** — queue + retry banner, never lose a logged set.
- [ ] **Concurrent-edit conflicts** — backend's 409 surface for `active_run_exists` and `template_outdated` is well-handled in `ForkWizard.tsx:73-86`. Verify same pattern in any future PATCH points.
- [ ] **Replace `Loading…` text fallbacks with skeletons** (NH6) — bulk-touch in one PR if Beta time allows.
- [ ] **`alert()` → toast** (B8) — sweep all 4 remaining call sites.
- [ ] **Keyboard nav on critical desktop flows** — at minimum Escape closes any sheet/modal, Enter submits primary action. Tab order must be logical through ForkWizard's customize-then-start flow.

---

## Risks / unknowns

**R1. Auth-scheme decision blocks B2/B11.** If Backend picks something other than CF Access pass-through, B2/B11 grow from S to M each. **Mitigation:** spec all three; commit to component contracts (`useCurrentUser`, `apiFetch`) that are scheme-agnostic so the leaf components don't change.

**R2. Live logger backend surface (`POST /api/set-logs`) doesn't exist yet.** This is a hard prereq for B1. **Mitigation:** flag in cross-team review; coordinate sequencing so backend ships set-logs API before frontend logger work starts. Frontend can mock-stub during dev.

**R3. Landmarks editor depends on backend `users.landmarks` table + API not yet planned.** B6 is conditional; if Sports Med says blocker, backend has to do schema+API work in same Beta cycle. **Mitigation:** dispatch decision early.

**R4. Small-icu Intl gotcha on prod (`project_alpine_smallicu.md`).** Any new date/number formatting in onboarding, landmarks editor, or live logger must use `formatToParts` not `.format()` with locale tags. Add to PR-checklist for Beta.

**R5. Mobile responsive heatmap is post-Beta (NH2)** — but if real users open `/my-programs/:id` on mobile (likely once they have programs), the desktop-grid render is bad. Either NH2 ships in Beta or the route does a `useIsMobile()` redirect to a simplified mobile view.

**R6. Unauth state interaction with React Router.** When CF Access expires mid-session, our SPA is mounted but every fetch 401s. Today this triggers a hard redirect on the next fetch. We need to make sure no in-flight mutation dies silently — see B2.

**R7. Existing tests pass with placeholder user.** Smoke tests assume `PLACEHOLDER_USER_ID`; once auth ships, tests have to mock real auth state. Audit all `__smoke__/*.smoke.test.tsx` and `*.test.tsx` that import `PLACEHOLDER_USER_ID` (currently 2 — `navigation.smoke.test.tsx`, `AppShell.test.tsx`). Update before merge.

**R8. The `/dev/picker` route is reachable in dev only.** Confirm it's gated by `import.meta.env.DEV` for prod (it is — `App.tsx:34`), but the `<ExercisePickerDemo>` calls `alert()` on a substitute pick. Cosmetic, but flag for cleanup.

**R9. Time-zone display drift.** Workout dates rely on `users.timezone`, but TodayPage and TodayWorkoutMobile don't currently render the user's TZ anywhere. If someone travels, "Today" can be confusing. Out-of-scope for Beta probably, but flag — could be NH if cheap.

---

## Open questions for cross-team review

1. **Backend (auth):** CF Access pass-through, email/password, or magic link? Prefer the first; ETA on decision?
2. **Backend (landmarks):** Will `GET/PUT /api/users/me/landmarks` ship in Beta? Sports Med specialist is the priority arbiter — what did they say?
3. **Backend (set logs):** When does `POST /api/set-logs` land? It's the critical path for B1.
4. **Backend (deload-intent):** Will `?intent=deload` on fork actually generate a lighter mesocycle, or do we strip the param and update the recap copy (NH7 option a)?
5. **QA:** Will QA require offline-mode test coverage for the live logger? If yes, that's a "+M" cost addition for B1 around Service Worker + Vitest mocking.
6. **QA:** Does the Beta sign-off include cross-browser (Safari iOS, Chrome Android) live-logger smoke? If yes, we need a Playwright device-emulation suite — we currently have none, so that's a +M.
7. **Sports Med:** Are user-editable landmarks a Beta blocker (B6 conditional)?
8. **Product (user, single-user today):** Is multi-device session sync (start logging on mobile, see progress on desktop) Beta or GA? Affects live-logger architecture decisions.
9. **Product:** Should onboarding be desktop-required (recommended) or mobile-supported (more work, more graceful)?
10. **Backend (rate-limit / write conflicts):** What's the expected error shape for set-log POST conflicts? Need to design the offline-queue retry policy around it.

---

## Beta-blocker user reachability checklist (per `feedback_user_reachability_dod.md`)

**Click-path that must work end-to-end before Beta sign-off:**

1. New user lands on `https://repos.jpmtech.com` → CF Access challenge → SPA loads at `/`.
2. Onboarding triggers (B5). User picks equipment → goal → program → starts mesocycle.
3. User lands on TodayPage with active workout for today (or a "next workout is <day>" banner).
4. User opens app on mobile → TodayWorkoutMobile shows today's sets.
5. User taps **Start Workout** → live logger renders (B1).
6. User logs a set: weight + reps + RIR + Log → set persists, rest timer counts down.
7. User logs all sets in a block → moves to next block automatically.
8. User finishes the day → "Day complete" summary → returns to TodayPage.
9. User opens desktop → `/my-programs/:id` shows volume heatmap with the day's sets reflected.
10. User taps avatar → menu → Sign out → redirected to CF Access logout → page shows signed-out state.

If any step in this chain breaks, **we are not in Beta yet**. This list is the definition of "user-reachable" for Beta.
