# W2 — Onboarding + Clinical Safety (PAR-Q, Deload, Core Taxonomy) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the W2 wave from `docs/superpowers/plans/2026-05-11-repos-beta.md` §251: the new-user 5-step onboarding flow, the PAR-Q-lite clinical safety gate (with version-aware re-prompt, per-version audit rows, Q5 joint follow-up writing `user_injuries`, and `users.par_q_advisory_active` mode flag), the manual mid-mesocycle deload trigger + undo, the explicit `day_workouts.is_deload` signal (replacing W3's interim `current_week >= weeks` heuristic in `stalledPrEvaluator`), the `core` muscle taxonomy with seeded exercises + per-muscle landmarks + curated-program late-session blocks, and the `spinal_flexion` / `anti_extension` `movement_pattern` enum extensions that the core exercises require.

**Architecture:** Seven migrations in the **034–040 inclusive range**, additive — none destructive. PAR-Q is a separate `par_q_acknowledgments` table (audit-preserving per QA Round 2; PK `(user_id, version)`, JSONB CHECK on `responses`, `ip TEXT NULL` column) plus four `users` columns (`onboarding_completed_at`, `par_q_acknowledged_at`, `par_q_version`, `par_q_advisory_active`). Deload signal is a single `day_workouts.is_deload BOOLEAN` column populated by the program engine at materialize time, set by W2.5 routes for the manual flow, and read everywhere via that column (no more "last week" heuristic). The manual-deload reduction formula constants live in `api/src/services/_deloadConstants.ts` (extracted so W4's full deload-meso consumes the same numbers). Core taxonomy ships as (a) the `muscles` row + landmark constant, (b) seed exercises bumped to a new seed generation, (c) a new program template version with core blocks — alpha-tester's forked programs reference the OLD template version and are not silently mutated, and (d) the `spinal_flexion` + `anti_extension` `movement_pattern` enum values that the new core exercises need (W4 consumes; W2 owns since W2 introduces the exercises that require them). Onboarding is a responsive overlay (`<OnboardingOverlay>`) at the AppShell layer, viewport-aware per `project_responsive_chrome.md` — same surface on mobile and desktop, no `/mobile/*` URL split. Both overlays mount **inside** `<AppShell>` (sibling of `<Outlet>`), gated by a single derived state machine so onboarding always precedes PAR-Q.

**Tech Stack:** Fastify (api), node-postgres, React + react-router-dom (frontend), Vitest (unit + integration), Playwright (e2e), Zod schemas, Radix UI.

**Migration range claim:** **034 → 040 inclusive.** Any sub-task that requires a migration claims a number in that range. Do not reuse 029–033 (already shipped) and do not encroach on 041+ (reserved for W4/W5/W6 parallel waves; W4's previously-claimed 040 slot for `movement_pattern` enum migrates here per panel finding I-CORE-PATTERNS).

| Mig # | Owner task | Subject |
|-------|------------|---------|
| 034 | Phase 1 | `users` onboarding + PAR-Q columns (`onboarding_completed_at`, `par_q_acknowledged_at`, `par_q_version`, `par_q_advisory_active`) |
| 035 | Phase 1 | `par_q_acknowledgments` table (per-user, per-version audit rows; JSONB CHECK; `ip TEXT NULL`) |
| 036 | Phase 2 | `day_workouts.is_deload BOOLEAN NOT NULL DEFAULT false` + backfill for active runs |
| 037 | Phase 2 | `mesocycle_run_event_type` enum extension (`'manual_deload'`, `'manual_deload_undone'`) |
| 038 | Phase 3 | `muscles` row insert for `core` + lookup-table integrity |
| 039 | Phase 3 | SQL-comment-only placeholder claiming W2 core-taxonomy slot in the migration history (no `_seed_meta` INSERT — seed generation is owned by `api/src/seed/adapters/*.ts`) |
| 040 | Phase 3 | `movement_pattern` enum extension (`spinal_flexion`, `anti_extension`) — required for the new core exercises (Cable Crunch, Hanging Leg Raise, Ab Wheel Rollout). W4 consumes; W2 owns because W2 introduces the exercises that need them. |

**Route-mount-path correction (panel finding C-MOUNT-PATH):** The existing whoami route is mounted at **`/api/me`** in `api/src/app.ts:56`, NOT `/api/users/me`. Every W2 route is mounted under `/api/me` for consistency. Concretely: `GET /api/me`, `GET/POST /api/me/par-q`, `POST /api/me/onboarding/complete`. The plan's `/api/users/me/*` paths in earlier drafts were a mistake — they're rewritten everywhere below. The `/api/me` GET handler in `api/src/app.ts:56-65` gets three new fields added to its SELECT: `onboarding_completed_at`, `par_q_version`, `par_q_advisory_active`.

**Scope-gating posture (panel finding C-SCOPE):** A new scope `account:write` is added to `VALID_SCOPES` in `api/src/auth/scopes.ts`. The three W2 state-changing routes — `POST /api/me/par-q`, `POST /api/me/onboarding/complete`, `POST /api/mesocycles/:id/deload-now` + `/undo` — are gated on `[requireBearerOrCfAccess, requireScope('account:write')]`. Default-minted bearer tokens do NOT carry this scope (they must be explicitly minted with it). The CF Access browser path bypasses scope checks per the current `scope.ts` posture — that's the intended path for the W2 UI to use these routes. Anyone wanting to drive PAR-Q/onboarding/deload from a personal API token must mint one with `account:write` explicitly.

**Modal z-index stack (panel finding C-Z):** All W2 + concurrent-wave overlays use the explicit `TOKENS.zModal.*` constants documented in §"Modal z-index stack" below: `zSheet=100` (sheets like BlockOverflowMenu / MidSessionSwapSheet / DeloadThisWeekSheet), `zBanner=1000` (LogBufferRecovery), `zOverlay=1500` (OnboardingOverlay + ParQGate), `zAuth=2000` (SessionExpiredBanner). W2 introduces these tokens (added to `frontend/src/tokens.ts` in Task 5.1) and applies them to its own overlays; concurrent waves are expected to adopt them.

**Cross-wave coordination (must be communicated to other parallel waves before merge):**

1. **W3 deload-signal handoff.** This wave swaps `api/src/services/stalledPrEvaluator.ts:53-58` from `current_week >= weeks` to `day_workouts.is_deload` once migration 036 has populated the column. Phase 2 includes the swap + a parity test on the W3 alpha-cohort fixture. **Additionally** the swap must ALSO honor `mesocycle_runs.is_deload` (W4 owns) — when W4's full deload-meso lands, every `day_workouts` row in such a run will have `is_deload=true` flipped by W4 Task 12, so the per-row predicate W2 introduces remains correct without a code change. The contract W2 publishes to W4: "if `mesocycle_runs.is_deload=true`, every constituent `day_workouts.is_deload` MUST also be true." Phase 2 Task 2.4 docblock pins this for W4.
2. **W4 `movement_pattern` enum.** Per panel finding I-CORE-PATTERNS, the `spinal_flexion` and `anti_extension` values land in W2's **migration 040** (not W4 as previously scheduled). W4 consumes them. W2 owns because the new core exercises (Cable Crunch, Hanging Leg Raise, Ab Wheel Rollout) require these values to seed correctly. W4 plan must drop its 040 claim and reference W2's enum extension by name.
3. **W4 landmarks editor + W4 deload-meso constants.** Per user decision D3, the deload reduction constants live in a new shared module `api/src/services/_deloadConstants.ts` — both W2's manual-deload and W4's full deload-meso import from it. The W2-shipped constants are `MANUAL_DELOAD_MAV_FACTOR = 0.5` and `MANUAL_DELOAD_RIR = 4`. W4 may add its own deload-meso constants (e.g. `FULL_DELOAD_RIR`) to the same file. W4 also lands the per-user landmarks resolver `resolveUserLandmarks`; W2's manual-deload calls it when available and falls back to the seeded `_muscleLandmarks.MUSCLE_LANDMARKS[muscle].mav` if W4 hasn't merged yet. Task 4.1 documents the fallback.
4. **W4 + post-Beta consumers of `users.par_q_advisory_active`.** Per user decision D2, W2 ships the column + writer. W3's stalledPr evaluator and W4's landmarks editor will read it post-W2 to cap volume at MEV and floor RIR to 3 when `true`. W2 publishes the read-site contract; downstream waves implement the gate. The Settings → Health page exposes a "Mark cleared" affordance that POSTs `par_q_advisory_active=false`.
5. **W6 `account_events` enum + handoff (panel finding D8).** `account_events.user_id ON DELETE SET NULL` is owned by W6's **migration 060**; the enum values `'par_q_acknowledged'` and `'onboarding_completed'` MUST be included in that migration. W2's PAR-Q POST and onboarding-complete POST each call `recordAccountEvent({ kind, ip, meta: { version, user_email_at_event } })` in the same transaction as their primary INSERT. If W6 ships before W2 cuts over, this lights up immediately; if W2 ships first, the `recordAccountEvent` call is wrapped in a try/catch that swallows the "enum value missing" error and logs a warning until W6 lands. Task 1.4 + Task 1.5 implement this conditional posture.
6. **W6 Settings sidebar layout** (master plan §651). W6 owns the authoritative ordering and ships **first**. W2 registers its `Health` and `Program prefs` entries against the W6-exported `SETTINGS_SECTIONS` const at the W6-defined slot. W2 makes NO edits to `SETTINGS_SECTIONS` itself; it only consumes. **Gating note (panel finding I-PROGRAM-PREFS-STUB):** `/settings/program-prefs` does NOT ship a "coming soon" placeholder. Instead the sidebar entry itself is gated behind a `BETA_LANDMARKS_EDITOR` feature flag that W4.3 unflips on landing. W2 ships only `/settings/health` (PAR-Q re-review surface) into Settings.
7. **W5 backup scope.** Confirm `par_q_acknowledgments` (including its new `ip TEXT NULL` column) is in the `pg_dump` taken by W5's snapshot job. Health data classification is documented in W5's plan; W2 flags this dependency.
8. **W8.2 contamination matrix.** Four new rows per panel finding I-CONTAM: `POST /api/me/onboarding/complete`, `GET/POST /api/me/par-q`, `POST /api/mesocycles/:id/deload-now`, `POST /api/mesocycles/:id/deload-now/undo`. The undo route's contamination test is **new** in this revision (previously missed). Phase 1 Task 1.6 + Phase 4 Task 4.3 implement.
9. **Documentation drift fix.** The live dashboard `docs/superpowers/goals/beta.md` claims `tests/e2e/w3-shape-signal.spec.ts` exists; it does not. The actual W1 volume-rollup contract test lives at `api/tests/integration/set-logs-volume-rollup.test.ts`. Phase 2 wires the W3 deload-signal parity test against a NEW golden-fixture file derived from the pre-swap evaluator at HEAD `d5110bc` (NOT the volume-rollup test, which is single-week and cannot prove parity). Phase 6 includes a doc-drift fix to the dashboard.

---

## Phase boundaries (dispatch model)

The plan is structured so the orchestrator can dispatch reviewer panels per phase. Each phase has a clearly bounded surface area, explicit DoD, and acceptance gates.

| Phase | Surface | DoD short form |
|-------|---------|----------------|
| **1** | Scope + accountEvents shim + rate-limit + `users` columns + `par_q_acknowledgments` + PAR-Q backend (incl. Q5 follow-up + advisory mode) | Task 1.0 lands; migrations 034/035 land; `GET/POST /api/me/par-q` works (atomic upsert 201/200); `/api/me/par-q/mark-cleared` works; Q5 joints write user_injuries in-transaction; account_events emitted; contamination tests green |
| **2** | `day_workouts.is_deload` column + `stalledPrEvaluator` swap + golden-fixture parity test | Migration 036/037 land, evaluator reads `is_deload`, post-swap output identical to HEAD `d5110bc` golden fixture (multi-week) |
| **3** | Core muscle + exercise seeds + new program-template version + movement_pattern enum extension | Migrations 038/039/040 land, 6+ core exercises seeded with correct movement_pattern, alpha-tester's forked program materializes OLD structure (real test, no .todo) |
| **4** | Shared deload constants + manual mid-meso deload + undo backend | `_deloadConstants.ts` ships; `POST /api/mesocycles/:id/deload-now` + `/undo` work; formula = floor(MAV*0.5)+RIR=4; contamination tests for both routes; 24h window enforced |
| **5** | TOKENS.zModal + OnboardingOverlay + ParQGate (incl. Q5 picker + advisory banner) + DeloadThisWeekButton+Sheet + Settings → Health (incl. Mark cleared) | All overlays mount inside AppShell via single derived state machine; 3 a11y tests per overlay; sheet pattern for deload; Program prefs feature-flagged off |
| **6** | Wave acceptance — reachability + tooltips + dashboard hygiene + cardio deferral note | All Phase-5 surfaces ≤3 clicks from `/`; G7 audit row added to `docs/qa/beta-reachability.md`; doc-drift fix; cardio first-class deferral documented |

Each phase ends with a "Phase N — verification + commit" task. The orchestrator dispatches a reviewer panel (backend / frontend / clinical / security as appropriate) **before** moving to the next phase.

---

## File structure (created or modified)

### API
**Created**
- `api/src/db/migrations/034_users_onboarding_par_q.sql` (incl. `par_q_advisory_active`)
- `api/src/db/migrations/035_par_q_acknowledgments.sql` (incl. JSONB CHECK, `ip TEXT NULL`)
- `api/src/db/migrations/036_day_workouts_is_deload.sql`
- `api/src/db/migrations/037_mesocycle_run_event_type_deload.sql`
- `api/src/db/migrations/038_muscles_core.sql`
- `api/src/db/migrations/039_w2_marker.sql` (SQL-comment-only placeholder)
- `api/src/db/migrations/040_movement_pattern_spinal_flexion_anti_extension.sql`
- `api/src/routes/onboarding.ts` (`POST /api/me/onboarding/complete`)
- `api/src/routes/parQ.ts` (`GET /api/me/par-q`, `POST /api/me/par-q`)
- `api/src/routes/mesocyclesDeload.ts` (mounted into `mesocycles.ts`)
- `api/src/services/manualDeload.ts` (pure-ish; opens its own pg client)
- `api/src/services/_deloadConstants.ts` (`MANUAL_DELOAD_MAV_FACTOR = 0.5`, `MANUAL_DELOAD_RIR = 4`; shared with W4)
- `api/src/services/parQRateLimit.ts` (per-user 5-writes/day audit + check; per panel I-RATE-LIMIT)
- `api/src/schemas/parQ.ts` (Zod schemas — incl. Q5 joints + Q9 chronic)
- `api/src/schemas/onboarding.ts`
- `api/src/schemas/manualDeload.ts`
- `api/src/constants/parQ.ts` (`PAR_Q_VERSION = 2`, `PAR_Q_QUESTIONS: readonly string[]`; Q7 wording fix; Q9 chronic; Q5 joint follow-up)
- `api/tests/integration/par-q-flow.test.ts`
- `api/tests/integration/par-q-q5-joint-followup.test.ts` (Q5='yes' → user_injuries rows in same transaction)
- `api/tests/integration/par-q-advisory-mode.test.ts` (any_yes flips `par_q_advisory_active`; Mark-cleared POST clears it)
- `api/tests/integration/par-q-overlay-a11y.test.tsx` (ESC, focus trap, return-focus per C-A11Y)
- `api/tests/integration/onboarding-flow.test.ts`
- `api/tests/integration/onboarding-overlay-a11y.test.tsx` (per C-A11Y; lives in api/tests for proximity to integration suite — frontend variant lives under frontend/__tests__)
- `api/tests/integration/day-workouts-is-deload.test.ts`
- `api/tests/integration/stalled-pr-deload-parity.test.ts`
- `api/tests/fixtures/stalledPrEvaluator-pre-swap-golden.json` (captured at HEAD `d5110bc` from a multi-week fixture per C-STALLEDPR-PARITY)
- `api/tests/integration/manual-deload.test.ts`
- `api/tests/integration/manual-deload-undo.test.ts`
- `api/tests/integration/manual-deload-undo-contamination.test.ts` (per I-CONTAM)
- `api/tests/integration/core-muscle-seeded.test.ts`
- `api/tests/integration/movement-pattern-spinal-flexion-seeded.test.ts` (new enum values seeded + applied)
- `api/tests/integration/contamination/parQ-contamination.test.ts`
- `api/tests/integration/contamination/onboarding-contamination.test.ts`
- `api/tests/integration/contamination/manualDeload-contamination.test.ts`

**Modified**
- `api/src/services/stalledPrEvaluator.ts` (swap `current_week >= weeks` → `day_workouts.is_deload`; remove the `[FIX-24 ADAPTED]` block comment)
- `api/src/services/materializeMesocycle.ts` (set `is_deload=true` on the materialized last-week `day_workouts` rows)
- `api/src/seed/exercises.ts` (re-tag Pallof press to `core`; add 6 new core exercises; Cable Crunch + Hanging Leg Raise reclassified to `spinal_flexion`, Ab Wheel Rollout to `anti_extension`; joint_stress_profile.lumbar bumps per I-CORE-PATTERNS)
- `api/src/seed/programTemplates.ts` (bump template versions to insert core blocks)
- `api/src/services/_muscleLandmarks.ts` (add `core` landmarks)
- `api/src/auth/scopes.ts` (add `'account:write'` to `VALID_SCOPES`)
- `api/src/services/accountEvents.ts` (consumed; W6-owned — try/catch wrapper if not yet present)
- `api/src/app.ts` (extend `GET /api/me` SELECT with `onboarding_completed_at`, `par_q_version`, `par_q_advisory_active`)
- `api/src/index.ts` (mount new routes)
- `api/src/routes/mesocycles.ts` (mount the deload sub-routes)

### Frontend
**Created**
- `frontend/src/components/onboarding/OnboardingOverlay.tsx` (responsive 5-step wizard; a11y per W3 `MidSessionSwapPicker` baseline)
- `frontend/src/components/onboarding/steps/WelcomeStep.tsx`
- `frontend/src/components/onboarding/steps/EquipmentStep.tsx` (wraps existing `EquipmentWizard`)
- `frontend/src/components/onboarding/steps/GoalStep.tsx` (goal enum is `cut/maintain/bulk` only; cardio deferred to W7+)
- `frontend/src/components/onboarding/steps/ProgramStep.tsx`
- `frontend/src/components/onboarding/steps/ReadyStep.tsx` (skip-path copy + Programs deep link per I-PROGRAMSTEP-SKIP)
- `frontend/src/components/onboarding/ParQGate.tsx` (9-question screen post-I-Q9-ADD; Q5 joints follow-up; a11y baseline)
- `frontend/src/components/onboarding/ParQJointPicker.tsx` (Q5='yes' joint multi-select)
- `frontend/src/components/programs/DeloadThisWeekButton.tsx` (button that opens a sheet)
- `frontend/src/components/programs/DeloadThisWeekSheet.tsx` (confirm sheet — sheet-handover pattern per I-DELOAD-A11Y)
- `frontend/src/lib/api/onboarding.ts`
- `frontend/src/lib/api/parQ.ts`
- `frontend/src/lib/api/manualDeload.ts`
- `frontend/src/lib/featureFlags.ts` (if not present; `BETA_LANDMARKS_EDITOR`)
- `frontend/src/pages/SettingsHealthPage.tsx` (PAR-Q re-review link + "Mark cleared" affordance + ack history)
- `frontend/src/components/onboarding/__tests__/OnboardingOverlay.test.tsx` (incl. 3 a11y tests per C-A11Y)
- `frontend/src/components/onboarding/__tests__/ParQGate.test.tsx` (incl. 3 a11y tests per C-A11Y, Q5 follow-up, Q9 chronic copy, advisory mode flip)
- `frontend/src/components/programs/__tests__/DeloadThisWeekButton.test.tsx`
- `frontend/src/components/programs/__tests__/DeloadThisWeekSheet.test.tsx`

**Modified**
- `frontend/src/lib/terms.ts` (add `PAR_Q`, `core`, `intro_week`, `soft_gate`, `manual_deload`, `advisory_mode`)
- `frontend/src/tokens.ts` (add `TOKENS.zModal = { zSheet: 100, zBanner: 1000, zOverlay: 1500, zAuth: 2000 }` per C-Z)
- `frontend/src/App.tsx` (register `/settings/health`; mount `OnboardingOverlay` + `ParQGate` INSIDE `<AppShell>` as sibling of `<Outlet>` per C-MOUNT, with single derived state machine: onboarding-first, then PAR-Q)
- `frontend/src/components/layout/Sidebar.tsx` (consume W6-exported `SETTINGS_SECTIONS`; W2 ships only `Health` entry; `Program prefs` entry gated behind `BETA_LANDMARKS_EDITOR` flag per I-PROGRAM-PREFS-STUB — entry hidden until W4.3 flips it)
- `frontend/src/components/library/ExercisePicker.tsx` (populate `GROUP_TO_SLUGS.core = ['core']`)
- `frontend/src/pages/MyProgramPage.tsx` (mount `DeloadThisWeekButton`)
- `frontend/src/pages/TodayPage.tsx` (mount `DeloadThisWeekButton` in overflow menu on mobile)

**NOT created in W2 (deferred):**
- `frontend/src/pages/SettingsProgramPrefsPage.tsx` — W4.3 owns. W2 does not ship a placeholder; the sidebar entry is feature-flagged off until W4 lands.

### Docs
**Modified**
- `docs/qa/beta-reachability.md` (add W2 section per W3 format)
- `docs/superpowers/goals/beta.md` (fix doc drift on `tests/e2e/w3-shape-signal.spec.ts` claim)

### Tests (e2e)
**Created**
- `tests/e2e/w2-onboarding-flow.spec.ts` (full new-user happy path)
- `tests/e2e/w2-par-q-reprompt.spec.ts` (version-bump re-prompt + audit preservation)
- `tests/e2e/w2-deload-this-week.spec.ts` (two-step confirm + undo within 24h)

---

## Modal z-index stack (panel finding C-Z)

Explicit token-driven layering to prevent overlays from racing each other.

| Token | Value | Used by |
|-------|------:|---------|
| `TOKENS.zModal.zSheet` | 100 | `BlockOverflowMenu`, `MidSessionSwapSheet`, `DeloadThisWeekSheet` |
| `TOKENS.zModal.zBanner` | 1000 | `LogBufferRecovery` |
| `TOKENS.zModal.zOverlay` | 1500 | `OnboardingOverlay`, `ParQGate` |
| `TOKENS.zModal.zAuth` | 2000 | `SessionExpiredBanner` |

Added to `frontend/src/tokens.ts` in Task 5.1. Every overlay component in W2 references the appropriate token explicitly — NO inline `zIndex: <literal>` values. Concurrent waves (W3 sheets, W4 overlays, W5 banners) should migrate to these tokens as they touch overlay surfaces.

Auth-tier (2000) is highest because a session-expired prompt must obscure even onboarding (the user is no longer authenticated; nothing else can proceed).

---

## A11y baseline (panel finding C-A11Y)

Both `OnboardingOverlay` and `ParQGate` match the W3 a11y baseline established by `frontend/src/components/programs/MidSessionSwapPicker.tsx:42-118`:

1. **ESC handler** — pressing Escape calls `onClose()`.
2. **Focus trap** — Tab and Shift+Tab cycle within the dialog; focus cannot leak to the page underneath.
3. **Initial focus** — when the dialog mounts (or async content loads), focus is programmatically placed on the first interactive element inside the dialog.
4. **Return-focus on close** — when the dialog closes, focus returns to the element that was focused before the dialog opened.
5. **Re-focus on async content load** — for ParQGate, when the question list arrives from `GET /api/me/par-q`, focus moves to the first question.

Each overlay ships **3 dedicated a11y tests** (per Phase 5 sub-tasks):
- "initial focus lands inside the dialog"
- "Shift+Tab from the first focusable element wraps to the last"
- "closing the dialog returns focus to the previously-focused element"

---

## Phase 1 — Users columns + PAR-Q backend

**Why first:** every downstream phase reads or writes these columns; isolating them in Phase 1 makes reviewer panels cheap.

### Task 1.0 — Scope addition + accountEvents stub + parQRateLimit service

**Files:**
- Modify: `api/src/auth/scopes.ts` (add `'account:write'` to `VALID_SCOPES`)
- Create: `api/src/services/accountEvents.ts` (stub with `tryRecordAccountEvent` that swallows enum-missing errors and logs a warning until W6 migration 060 lands)
- Create: `api/src/services/parQRateLimit.ts` (per-user 5-writes/day check + record, mirroring `migration 031` workout_write_log pattern)

- [ ] **Step 1.0.1: Add `'account:write'` to VALID_SCOPES**

Edit `api/src/auth/scopes.ts`:

```typescript
export const VALID_SCOPES = [
  'health:weight:write',
  'health:workouts:write',
  'program:write',
  'set_logs:write',
  'health:injuries:read',
  'health:injuries:write',
  'health:recovery:read',
  'account:write',  // W2: PAR-Q POST, onboarding-complete POST, deload-now POST + /undo
] as const;
```

- [ ] **Step 1.0.2: Write `api/src/services/accountEvents.ts` stub**

W6 owns the canonical `recordAccountEvent` and migration 060. Until W6 lands, W2 ships a `tryRecordAccountEvent(client, payload)` that wraps the actual INSERT in a try/catch — if the enum value `'par_q_acknowledged'` or `'onboarding_completed'` doesn't exist yet (W6 hasn't merged), the helper logs `console.warn('[accountEvents] enum value missing for kind=' + kind + ' — likely W6 not yet merged')` and resolves without error. Once W6 ships, the catch is dead code.

```typescript
// api/src/services/accountEvents.ts
// Beta W2 transitional shim. W6 owns the canonical implementation +
// the account_events table + the kind enum. Until W6 merges, calls
// from W2 routes (par-q POST, onboarding POST) silently no-op when
// the enum value isn't present. After W6 merges, this becomes a
// pass-through to recordAccountEvent.
import type { PoolClient } from 'pg';

export interface AccountEventPayload {
  user_id: string;
  kind: 'par_q_acknowledged' | 'onboarding_completed' | string;  // W6 will narrow
  ip?: string;
  meta?: Record<string, unknown>;
}

export async function tryRecordAccountEvent(client: PoolClient, payload: AccountEventPayload): Promise<void> {
  try {
    await client.query(
      `INSERT INTO account_events (user_id, kind, ip, meta)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [payload.user_id, payload.kind, payload.ip ?? null, JSON.stringify(payload.meta ?? {})],
    );
  } catch (e: any) {
    // 42P01 = relation does not exist (table not created yet); 22P02 / 23514
    // = enum value invalid. Swallow either case during the W2→W6 transition.
    const code = e?.code;
    if (code === '42P01' || code === '22P02' || code === '23514') {
      // eslint-disable-next-line no-console
      console.warn(`[accountEvents] non-fatal: ${code} kind=${payload.kind} — likely W6 not merged`);
      return;
    }
    throw e;
  }
}
```

- [ ] **Step 1.0.3: Write `api/src/services/parQRateLimit.ts`**

Per-user 5-writes/day rate limit (panel I-RATE-LIMIT). Pattern is migration-031's `workout_write_log` adapted. Uses a new `par_q_write_log` table OR reuses the existing `workout_write_log` with `kind='par_q_post'` discriminator — pick the cheapest path; this task's implementer chooses based on what's there.

Stub:

```typescript
// api/src/services/parQRateLimit.ts
import { db } from '../db/client.js';
import type { PoolClient } from 'pg';

const PAR_Q_DAILY_WRITE_LIMIT = 5;

export async function checkParQWriteRateLimit(userId: string): Promise<boolean> {
  // Per-user count of par_q writes in last 24h. Implementation either
  // reads par_q_acknowledgments.accepted_at (cheap; PAR-Q has audit rows)
  // or a dedicated write-log table. For W2 ship, use par_q_acknowledgments
  // directly — we already insert there, so count(*) over last 24h IS the
  // rate-limit signal.
  const { rows } = await db.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM par_q_acknowledgments
      WHERE user_id = $1 AND accepted_at > now() - interval '24 hours'`,
    [userId],
  );
  return rows[0].c < PAR_Q_DAILY_WRITE_LIMIT;
}

// Recorded inside the POST handler's transaction, AFTER the INSERT into
// par_q_acknowledgments. For now this is a no-op because the
// par_q_acknowledgments row itself serves as the audit; provided as an
// extension point if a separate audit table becomes needed.
export async function recordParQWrite(_client: PoolClient, _userId: string): Promise<void> {
  // par_q_acknowledgments INSERT IS the audit row; no separate write.
}
```

- [ ] **Step 1.0.4: Add `requireScope` to the route guard surface**

Confirm `api/src/auth/scopes.ts` already exports `requireScope` (or its equivalent — check existing routes like `userInjuries.ts` for the pattern). If absent, add:

```typescript
// api/src/auth/scopes.ts (append)
import type { FastifyRequest, FastifyReply } from 'fastify';
import { type Scope } from './scopes.js';

export function requireScope(scope: Scope) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    // CF Access browser path bypasses (preHandler chain sets cfAccessBypass=true).
    if ((req as any).cfAccessBypass) return;
    const granted: string[] = (req as any).tokenScopes ?? [];
    if (!hasScope(granted, scope)) {
      reply.code(403);
      return { error: 'insufficient_scope', required: scope };
    }
  };
}
```

(Existing pattern: see `requireScope` callsites in the W3-shipped routes. If the helper exists, do nothing.)

- [ ] **Step 1.0.5: Run + commit**

```bash
cd api && npm run typecheck
git add api/src/auth/scopes.ts api/src/services/accountEvents.ts api/src/services/parQRateLimit.ts
git commit -m "feat: account:write scope + accountEvents shim + parQ rate-limit (W2 prelim)"
```

### Task 1.1 — Migration 034: users onboarding + PAR-Q columns

**Files:**
- Create: `api/src/db/migrations/034_users_onboarding_par_q.sql`

- [ ] **Step 1.1.1: Write the migration**

```sql
-- api/src/db/migrations/034_users_onboarding_par_q.sql
-- Beta W2.1 — onboarding + PAR-Q columns on users.
-- All ADD COLUMN IF NOT EXISTS so the migration is idempotent on re-runs.
-- Defaults chosen so existing alpha-tester rows are valid without backfill:
--   onboarding_completed_at: NULL → treated as "needs onboarding" by the
--     overlay; the alpha-tester is backfilled to now() in this same
--     migration (see WHERE clause below) so they don't see the wizard.
--   par_q_acknowledged_at: NULL → treated as "needs PAR-Q gate."
--   par_q_version: 0 default. The current ACTIVE version constant in
--     api/src/constants/parQ.ts is PAR_Q_VERSION = 2 (post Q7 wording fix
--     + Q9 chronic-condition addition). Rows at par_q_version=0 get the
--     gate; rows at par_q_version >= PAR_Q_VERSION skip it.
--   par_q_advisory_active: false default. Set to true by the PAR-Q POST
--     handler when any_yes=true on the answers payload. Read by W3
--     stalledPr evaluator and W4 landmarks editor to cap user volume at
--     MEV with RIR=3 floor until the user posts par_q_advisory_active=false
--     via the Settings → Health "Mark cleared" affordance.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS par_q_acknowledged_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS par_q_version           SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS par_q_advisory_active   BOOLEAN  NOT NULL DEFAULT false;

-- Alpha-tester backfill: the production alpha user skips onboarding so a
-- Beta cutover doesn't re-prompt them. They still see PAR-Q because that's
-- a new clinical gate. LOWER() per migration 007's case-insensitive convention.
--
-- IMPORTANT (panel finding I-MIG-034): the alpha-cohort target email is
-- 'jason@jpmtech.com' per scripts/cutover/001-placeholder-to-jmeyer.sql
-- (which targets that address explicitly with -v target_email=...). The
-- user's session email 'jmeyer@ironcloudtech.com' is separate. If the
-- Beta cohort eventually expands, ADD additional addresses here — do NOT
-- swap. Use `lower(email) = $1` semantics; IN-list left for clarity.
UPDATE users
   SET onboarding_completed_at = now()
 WHERE onboarding_completed_at IS NULL
   AND lower(email) = 'jason@jpmtech.com';
```

- [ ] **Step 1.1.2: Run migration**

Run: `cd api && npm run migrate`
Expected: `Applied 034_users_onboarding_par_q.sql`. Verify with:

```bash
psql $DATABASE_URL -c "\d users" | grep -E "onboarding|par_q"
```

Expected: 4 columns listed (`onboarding_completed_at`, `par_q_acknowledged_at`, `par_q_version`, `par_q_advisory_active`).

- [ ] **Step 1.1.3: Commit**

```bash
git add api/src/db/migrations/034_users_onboarding_par_q.sql
git commit -m "feat: add users onboarding + PAR-Q columns (W2.1, migration 034)"
```

### Task 1.2 — Migration 035: par_q_acknowledgments audit table

**Files:**
- Create: `api/src/db/migrations/035_par_q_acknowledgments.sql`

- [ ] **Step 1.2.1: Write the migration**

```sql
-- api/src/db/migrations/035_par_q_acknowledgments.sql
-- Beta W2.1 (QA Round 2 amendment) — per-version PAR-Q audit table.
-- Acknowledgments are NEVER overwritten on version bump. Each accepted
-- version gets its own row, preserving the audit trail.
--
-- Primary key (user_id, version) prevents duplicate acks for the same
-- version. ON DELETE CASCADE so account deletion (W6.1) wipes ack history
-- as part of the user cascade.
--
-- responses JSONB stores the 9-question Yes/No payload (post-Q9-ADD) at
-- acceptance time in case copy is amended later — we hold a snapshot of
-- what they accepted. Shape:
--   { "questions": ["..."], "answers": [false, false, ...] }
-- CHECK constraint validates the shape at write-time (panel I-MIG-035-CHECK).
--
-- ip TEXT NULL: populated by the POST handler from req.ip (panel
-- I-MIG-035-IP). Audit-trail parity with W6's account_events.ip. Nullable
-- because some test paths inject without an ip; production traffic always
-- sets it.
--
-- Index posture (panel I-MIG-035-IDX): the PK on (user_id, version) already
-- supports `WHERE user_id = $1` lookups efficiently. A separate partial
-- index on (user_id) is redundant — dropped from this migration.
CREATE TABLE IF NOT EXISTS par_q_acknowledgments (
  user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version     SMALLINT     NOT NULL,
  accepted_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  responses   JSONB        NOT NULL DEFAULT '{"questions":[],"answers":[]}'::jsonb,
  ip          TEXT         NULL,
  PRIMARY KEY (user_id, version),
  CONSTRAINT par_q_acknowledgments_responses_shape
    CHECK (
      jsonb_typeof(responses) = 'object'
      AND responses ? 'questions'
      AND responses ? 'answers'
    )
);
```

- [ ] **Step 1.2.2: Run migration + verify**

Run: `cd api && npm run migrate`
Expected: `Applied 035_par_q_acknowledgments.sql`. Confirm:

```bash
psql $DATABASE_URL -c "\d par_q_acknowledgments"
```

Expected: table with 5 columns (`user_id`, `version`, `accepted_at`, `responses`, `ip`), PK on `(user_id, version)`, CHECK constraint `par_q_acknowledgments_responses_shape`.

- [ ] **Step 1.2.3: Commit**

```bash
git add api/src/db/migrations/035_par_q_acknowledgments.sql
git commit -m "feat: add par_q_acknowledgments audit table (W2.1, migration 035)"
```

### Task 1.3 — PAR-Q constants + Zod schemas

**Files:**
- Create: `api/src/constants/parQ.ts`
- Create: `api/src/schemas/parQ.ts`
- Create: `api/src/schemas/onboarding.ts`

- [ ] **Step 1.3.1: Write `api/src/constants/parQ.ts`**

```typescript
// api/src/constants/parQ.ts
// Beta W2.3 — PAR-Q-lite 9-question constants.
// PAR_Q_VERSION must be bumped every time PAR_Q_QUESTIONS changes;
// users whose users.par_q_version < PAR_Q_VERSION are re-prompted on
// next page load via GET /api/me/par-q.
//
// Source: PAR-Q+ 2014 (Bredin et al.), simplified to 9 high-signal items.
// v2 changes from v1 (panel findings I-Q7-COPY, I-Q9-ADD):
//   - Q7 wording widened from "6 weeks" to "6 months" (clinical return-
//     to-training consensus for post-partum).
//   - Q9 added: chronic condition (diabetes/asthma/heart/kidney/COPD).
//
// Soft-gate copy lives in the frontend (ParQGate.tsx) — backend stores
// only versioned questions + boolean answers + accepted_at timestamp.
//
// Q5 (bone or joint problem) has a special UI follow-up: when answered
// 'yes', the gate reveals a joint multi-select (PAR_Q_Q5_JOINT_OPTIONS).
// Selected joints write rows to user_injuries (severity='mod',
// source='par_q_v{N}') in the same transaction as the par_q_acknowledgments
// INSERT. See api/src/routes/parQ.ts POST handler.

export const PAR_Q_VERSION = 2;

export const PAR_Q_QUESTIONS: readonly string[] = [
  'Has a doctor ever said you have a heart condition or that you should only do physical activity recommended by a doctor?',
  'Do you feel pain in your chest when you do physical activity?',
  'In the past month, have you had chest pain when you were not doing physical activity?',
  'Do you lose your balance because of dizziness or do you ever lose consciousness?',
  'Do you have a bone or joint problem that could be made worse by a change in your physical activity?',
  'Is your doctor currently prescribing drugs for your blood pressure or a heart condition?',
  'Are you currently pregnant or have you given birth in the past 6 months?',
  'Do you have a chronic condition (diabetes, asthma, heart, kidney, COPD) that affects how you exercise?',
  'Do you know of any other reason why you should not do physical activity?',
] as const;

// Q5 follow-up joint multi-select (user decision D1). When answer at
// index 4 (Q5) is true, the gate reveals this picker. Each checked joint
// writes a row to user_injuries (joint=<enum>, severity='mod',
// notes='From PAR-Q v{PAR_Q_VERSION} self-report', source='par_q_v{N}').
// Joint enum values match InjuryJoint from api/src/schemas/userInjuries.ts;
// JOINT_ROOT mapping in api/src/services/injuryRanker.ts:17 is the
// authoritative taxonomy.
export const PAR_Q_Q5_JOINT_OPTIONS = [
  'shoulder_left',
  'shoulder_right',
  'low_back',
  'knee_left',
  'knee_right',
  'elbow',
  'wrist',
  'other',
] as const;
export type ParQ5Joint = typeof PAR_Q_Q5_JOINT_OPTIONS[number];

// Q5 (index 4) is the only question that triggers the joint follow-up.
export const PAR_Q_Q5_INDEX = 4;

// Q8 (index 7) chronic condition triggers an additional soft-gate copy
// line in the banner: "Discuss with clinician before increasing volume."
export const PAR_Q_Q8_CHRONIC_INDEX = 7;
```

- [ ] **Step 1.3.2: Write `api/src/schemas/parQ.ts`**

```typescript
// api/src/schemas/parQ.ts
import { z } from 'zod';
import { PAR_Q_QUESTIONS, PAR_Q_VERSION, PAR_Q_Q5_JOINT_OPTIONS } from '../constants/parQ.js';

export const ParQStatusResponseSchema = z.object({
  current_version: z.literal(PAR_Q_VERSION),
  acknowledged_version: z.number().int().min(0),
  needs_prompt: z.boolean(),
  questions: z.array(z.string()),
  advisory_active: z.boolean(),  // mirrors users.par_q_advisory_active
});
export type ParQStatusResponse = z.infer<typeof ParQStatusResponseSchema>;

// Q5 follow-up joints. Required to be present (possibly empty array) when
// answers[PAR_Q_Q5_INDEX] === true. Validated server-side; empty array on
// Q5=yes is allowed (the user may not specify joints) but disallowed when
// Q5=false (mismatch).
export const ParQAcceptRequestSchema = z.object({
  version: z.number().int().min(1),
  answers: z.array(z.boolean()).length(PAR_Q_QUESTIONS.length),
  q5_joints: z.array(z.enum(PAR_Q_Q5_JOINT_OPTIONS)).default([]),
});
export type ParQAcceptRequest = z.infer<typeof ParQAcceptRequestSchema>;

export const ParQAcceptResponseSchema = z.object({
  version: z.number().int().min(1),
  accepted_at: z.string(),  // ISO timestamp
  any_yes: z.boolean(),     // true → frontend shows soft-gate copy
  advisory_active: z.boolean(),  // server's resulting users.par_q_advisory_active
  injuries_created: z.number().int().min(0),  // count of user_injuries rows added from Q5 follow-up
});
export type ParQAcceptResponse = z.infer<typeof ParQAcceptResponseSchema>;

// Settings → Health "Mark cleared" affordance.
export const ParQMarkClearedRequestSchema = z.object({});
export const ParQMarkClearedResponseSchema = z.object({
  advisory_active: z.literal(false),
});
```

- [ ] **Step 1.3.3: Write `api/src/schemas/onboarding.ts`**

```typescript
// api/src/schemas/onboarding.ts
import { z } from 'zod';

export const OnboardingCompleteRequestSchema = z.object({
  // Goals are pinned to the users.goal CHECK constraint from migration 026.
  // Cardio-capacity (e.g. 'endurance_zone2') is deliberately NOT in this
  // enum for Beta — per user decision D5 (2026-05-26), cardio first-class
  // is deferred to W7+. See reference_w3_tuning_candidates.md item 13.
  goal: z.enum(['cut', 'maintain', 'bulk']),
});
export type OnboardingCompleteRequest = z.infer<typeof OnboardingCompleteRequestSchema>;

export const OnboardingCompleteResponseSchema = z.object({
  onboarding_completed_at: z.string(),  // ISO timestamp
});
export type OnboardingCompleteResponse = z.infer<typeof OnboardingCompleteResponseSchema>;
```

- [ ] **Step 1.3.4: Run typecheck**

Run: `cd api && npm run typecheck`
Expected: PASS

- [ ] **Step 1.3.5: Commit**

```bash
git add api/src/constants/parQ.ts api/src/schemas/parQ.ts api/src/schemas/onboarding.ts
git commit -m "feat: add PAR-Q + onboarding schemas (W2.1)"
```

### Task 1.4 — PAR-Q routes

**Files:**
- Create: `api/src/routes/parQ.ts`
- Create: `api/tests/integration/par-q-flow.test.ts`
- Modify: `api/src/index.ts` (register route)

- [ ] **Step 1.4.1: Write failing test `par-q-flow.test.ts`**

**Note (post-revision):** All test payloads must include `q5_joints: []` per the updated `ParQAcceptRequestSchema` (default-applied but explicit-in-test for clarity). All assertions on the POST response should also assert `injuries_created: 0` for all-No paths. The "version bump re-prompts" test uses `PAR_Q_VERSION=2` (was 1).

```typescript
import 'dotenv/config';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { build } from '../helpers/build-test-app.js';
import { seedUserWithMesocycle, cleanupSeeded, type SeedHandle } from '../helpers/seed-fixtures.js';
import { db } from '../../src/db/client.js';
import { PAR_Q_VERSION, PAR_Q_QUESTIONS } from '../../src/constants/parQ.js';

const handles: SeedHandle[] = [];
afterEach(async () => { if (handles.length) await cleanupSeeded(handles.splice(0)); });
afterAll(async () => { await db.end(); });

describe('W2 — PAR-Q flow', () => {
  it('GET /api/me/par-q returns needs_prompt=true for new user', async () => {
    const app = await build();
    const seed = await seedUserWithMesocycle();
    handles.push(seed);

    const res = await app.inject({
      method: 'GET',
      url: '/api/me/par-q',
      headers: { authorization: `Bearer ${seed.bearer}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.current_version).toBe(PAR_Q_VERSION);
    expect(body.acknowledged_version).toBe(0);
    expect(body.needs_prompt).toBe(true);
    expect(body.questions).toEqual(PAR_Q_QUESTIONS);
  });

  it('POST /api/me/par-q creates an audit row + sets users.par_q_acknowledged_at + par_q_version', async () => {
    const app = await build();
    const seed = await seedUserWithMesocycle();
    handles.push(seed);

    const answers = new Array(PAR_Q_QUESTIONS.length).fill(false);
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/par-q',
      headers: { authorization: `Bearer ${seed.bearer}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ version: PAR_Q_VERSION, answers }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().any_yes).toBe(false);

    const { rows: ackRows } = await db.query(
      'SELECT version, responses FROM par_q_acknowledgments WHERE user_id = $1',
      [seed.userId],
    );
    expect(ackRows).toHaveLength(1);
    expect(ackRows[0].version).toBe(PAR_Q_VERSION);

    const { rows: [userRow] } = await db.query(
      'SELECT par_q_version, par_q_acknowledged_at FROM users WHERE id = $1',
      [seed.userId],
    );
    expect(userRow.par_q_version).toBe(PAR_Q_VERSION);
    expect(userRow.par_q_acknowledged_at).not.toBeNull();
  });

  it('any_yes=true when at least one answer is true', async () => {
    const app = await build();
    const seed = await seedUserWithMesocycle();
    handles.push(seed);
    const answers = new Array(PAR_Q_QUESTIONS.length).fill(false);
    answers[0] = true;
    const res = await app.inject({
      method: 'POST', url: '/api/me/par-q',
      headers: { authorization: `Bearer ${seed.bearer}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ version: PAR_Q_VERSION, answers }),
    });
    expect(res.json().any_yes).toBe(true);
  });

  it('version bump re-prompts AND prior ack rows are preserved (per QA Round 2)', async () => {
    const app = await build();
    const seed = await seedUserWithMesocycle();
    handles.push(seed);

    // Accept v1.
    const answers = new Array(PAR_Q_QUESTIONS.length).fill(false);
    await app.inject({
      method: 'POST', url: '/api/me/par-q',
      headers: { authorization: `Bearer ${seed.bearer}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ version: PAR_Q_VERSION, answers }),
    });

    // Simulate a version bump by manually downgrading users.par_q_version
    // (in production this happens when PAR_Q_VERSION constant is incremented;
    // existing rows fall below it and re-prompt).
    await db.query('UPDATE users SET par_q_version = par_q_version - 1 WHERE id = $1', [seed.userId]);

    const res = await app.inject({
      method: 'GET', url: '/api/me/par-q',
      headers: { authorization: `Bearer ${seed.bearer}` },
    });
    const body = res.json();
    expect(body.needs_prompt).toBe(true);
    expect(body.acknowledged_version).toBe(0);  // downgraded

    // Audit row from previous acceptance is preserved.
    const { rows: ackRows } = await db.query(
      'SELECT version FROM par_q_acknowledgments WHERE user_id = $1 ORDER BY version',
      [seed.userId],
    );
    expect(ackRows).toHaveLength(1);
    expect(ackRows[0].version).toBe(PAR_Q_VERSION);
  });

  it('POST is idempotent on (user_id, version) — first accept returns 201, re-accept returns 200, no duplicate row', async () => {
    const app = await build();
    const seed = await seedUserWithMesocycle();
    handles.push(seed);
    const answers = new Array(PAR_Q_QUESTIONS.length).fill(false);
    const payload = JSON.stringify({ version: PAR_Q_VERSION, answers, q5_joints: [] });
    const headers = { authorization: `Bearer ${seed.bearer}`, 'content-type': 'application/json' };

    const r1 = await app.inject({ method: 'POST', url: '/api/me/par-q', headers, payload });
    const r2 = await app.inject({ method: 'POST', url: '/api/me/par-q', headers, payload });
    // Atomic upsert returns 201 on first accept, 200 on re-accept (panel I-UPSERT).
    expect(r1.statusCode).toBe(201);
    expect(r2.statusCode).toBe(200);

    const { rows } = await db.query('SELECT count(*)::int AS c FROM par_q_acknowledgments WHERE user_id = $1', [seed.userId]);
    expect(rows[0].c).toBe(1);
  });

  it('par_q_acknowledged_at is first-write-wins (COALESCE) — re-accept does NOT rewrite the timestamp', async () => {
    const app = await build();
    const seed = await seedUserWithMesocycle();
    handles.push(seed);
    const answers = new Array(PAR_Q_QUESTIONS.length).fill(false);
    const payload = JSON.stringify({ version: PAR_Q_VERSION, answers, q5_joints: [] });
    const headers = { authorization: `Bearer ${seed.bearer}`, 'content-type': 'application/json' };

    await app.inject({ method: 'POST', url: '/api/me/par-q', headers, payload });
    const { rows: [u1] } = await db.query(
      'SELECT par_q_acknowledged_at FROM users WHERE id=$1',
      [seed.userId],
    );
    // Wait so any rewrite would be visible.
    await new Promise(r => setTimeout(r, 50));
    await app.inject({ method: 'POST', url: '/api/me/par-q', headers, payload });
    const { rows: [u2] } = await db.query(
      'SELECT par_q_acknowledged_at FROM users WHERE id=$1',
      [seed.userId],
    );
    expect(u2.par_q_acknowledged_at).toEqual(u1.par_q_acknowledged_at);
  });
});
```

- [ ] **Step 1.4.2: Run test to verify it fails**

Run: `cd api && npx vitest run tests/integration/par-q-flow.test.ts`
Expected: All tests FAIL with 404 from missing route.

- [ ] **Step 1.4.3: Write `api/src/routes/parQ.ts`**

```typescript
// api/src/routes/parQ.ts
// Beta W2.3 — PAR-Q-lite acknowledgment routes.
// GET returns current vs acknowledged version + question list + advisory_active.
// POST atomically upserts the user's row + per-version audit row + advisory
// flag + Q5 joint-follow-up user_injuries rows + account_events emission.
//
// Mount path: /api/me/par-q (panel C-MOUNT-PATH; the existing whoami is at
// /api/me, this route prefix is /api).
//
// Scope: gated on account:write (panel C-SCOPE). Default-minted bearer
// tokens lack it; CF Access browser path bypasses scope checks.
//
// Atomic-upsert with is_new returning (panel I-UPSERT): mirrors
// api/src/routes/userInjuries.ts:141-145 — INSERT ON CONFLICT RETURNING
// (created_at = updated_at) AS is_new tells us 201 vs 200.
//
// Per-user rate-limit (panel I-RATE-LIMIT): nginx zone uses binary_remote_addr
// but CF Tunnel collapses all egress to one IP. Use migration-031's
// workout_write_log pattern adapted: parQRateLimit.ts checks per-user
// write count over 24h; >5 → 429.
import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { requireBearerOrCfAccess } from '../middleware/cfAccess.js';
import { requireScope } from '../auth/scopes.js';
import {
  PAR_Q_VERSION,
  PAR_Q_QUESTIONS,
  PAR_Q_Q5_INDEX,
} from '../constants/parQ.js';
import {
  ParQAcceptRequestSchema,
  type ParQStatusResponse,
  type ParQAcceptResponse,
} from '../schemas/parQ.js';
import { zodToFieldError } from '../utils/zodToFieldError.js';
import { checkParQWriteRateLimit, recordParQWrite } from '../services/parQRateLimit.js';
import { tryRecordAccountEvent } from '../services/accountEvents.js';  // W6-owned; try/catch wrapper if not yet present

export async function parQRoutes(app: FastifyInstance) {
  app.get('/me/par-q', { preHandler: requireBearerOrCfAccess }, async (req, _reply) => {
    const userId = (req as any).userId as string;
    const { rows: [u] } = await db.query<{ par_q_version: number; par_q_advisory_active: boolean }>(
      'SELECT par_q_version, par_q_advisory_active FROM users WHERE id = $1',
      [userId],
    );
    const acknowledged = u?.par_q_version ?? 0;
    const resp: ParQStatusResponse = {
      current_version: PAR_Q_VERSION,
      acknowledged_version: acknowledged,
      needs_prompt: acknowledged < PAR_Q_VERSION,
      questions: [...PAR_Q_QUESTIONS],
      advisory_active: u?.par_q_advisory_active ?? false,
    };
    return resp;
  });

  app.post(
    '/me/par-q',
    { preHandler: [requireBearerOrCfAccess, requireScope('account:write')] },
    async (req, reply) => {
      const userId = (req as any).userId as string;
      const userEmail = (req as any).userEmail as string;
      const ip = (req.ip || '') as string;

      const parsed = ParQAcceptRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        reply.code(400);
        return zodToFieldError(parsed.error);
      }
      if (parsed.data.version !== PAR_Q_VERSION) {
        reply.code(409);
        return { error: 'par_q_version_mismatch', current_version: PAR_Q_VERSION };
      }

      // Q5 follow-up consistency: joints required allowed only when Q5='yes'.
      const q5Yes = parsed.data.answers[PAR_Q_Q5_INDEX] === true;
      const q5Joints = q5Yes ? parsed.data.q5_joints : [];
      if (!q5Yes && parsed.data.q5_joints.length > 0) {
        reply.code(400);
        return { error: 'q5_joints_provided_but_q5_no' };
      }

      // Per-user rate limit (5 writes / 24h).
      const allowed = await checkParQWriteRateLimit(userId);
      if (!allowed) {
        reply.code(429);
        return { error: 'par_q_write_rate_limited', limit_per_day: 5 };
      }

      const anyYes = parsed.data.answers.some(a => a === true);
      const responses = JSON.stringify({
        questions: PAR_Q_QUESTIONS,
        answers: parsed.data.answers,
      });

      const client = await db.connect();
      try {
        await client.query('BEGIN');

        // Atomic upsert with is_new returning (panel I-UPSERT).
        const { rows: [ack] } = await client.query<{ is_new: boolean }>(
          `INSERT INTO par_q_acknowledgments (user_id, version, responses, ip)
           VALUES ($1, $2, $3::jsonb, $4)
           ON CONFLICT (user_id, version) DO UPDATE
             SET responses = EXCLUDED.responses,
                 ip        = COALESCE(par_q_acknowledgments.ip, EXCLUDED.ip)
           RETURNING (accepted_at = now()) AS is_new`,
          [userId, parsed.data.version, responses, ip || null],
        );

        // Users row update. COALESCE on acknowledged_at = first-write-wins
        // for the audit timestamp (panel C-COALESCE). par_q_version bumps
        // forward-only via GREATEST. advisory_active is set true when
        // any_yes; it can be cleared only via /me/par-q/mark-cleared.
        const { rows: userRows } = await client.query<{ user_id: string }>(
          `UPDATE users
              SET par_q_version          = GREATEST(par_q_version, $2),
                  par_q_acknowledged_at  = COALESCE(par_q_acknowledged_at, now()),
                  par_q_advisory_active  = CASE WHEN $3::boolean THEN true ELSE par_q_advisory_active END
            WHERE id = $1
            RETURNING id AS user_id`,
          [userId, parsed.data.version, anyYes],
        );

        // Auth-state check (panel I-AUTH-MISSING): if UPDATE returned no
        // rows the bearer points at a deleted user. Don't access undefined.
        if (userRows.length === 0) {
          await client.query('ROLLBACK');
          reply.code(500);
          return { error: 'auth_state_missing' };
        }

        // Q5 follow-up: write user_injuries rows in the same transaction.
        // joint enum from W3's InjuryJoint (api/src/schemas/userInjuries.ts);
        // JOINT_ROOT taxonomy in api/src/services/injuryRanker.ts:17.
        let injuriesCreated = 0;
        if (q5Joints.length > 0) {
          // De-dup against existing rows. Per QA: do not stack identical
          // par_q-sourced rows across re-acceptance of the same version.
          const { rows: existing } = await client.query<{ joint: string }>(
            `SELECT joint FROM user_injuries WHERE user_id = $1`,
            [userId],
          );
          const have = new Set(existing.map(r => r.joint));
          for (const joint of q5Joints) {
            if (have.has(joint)) continue;
            await client.query(
              `INSERT INTO user_injuries
                 (user_id, joint, severity, notes, source)
               VALUES ($1, $2, 'mod', $3, $4)`,
              [
                userId,
                joint,
                `From PAR-Q v${PAR_Q_VERSION} self-report`,
                `par_q_v${PAR_Q_VERSION}`,
              ],
            );
            injuriesCreated++;
          }
        }

        // Per-user rate-limit audit row.
        await recordParQWrite(client, userId);

        // Account event emission (panel D8). W6 owns the enum value
        // 'par_q_acknowledged'; tryRecordAccountEvent swallows the missing-
        // enum error and logs a warning until W6 migration 060 lands.
        await tryRecordAccountEvent(client, {
          user_id: userId,
          kind: 'par_q_acknowledged',
          ip,
          meta: {
            version: parsed.data.version,
            user_email_at_event: userEmail,
            any_yes: anyYes,
            q5_joints: q5Joints,
          },
        });

        await client.query('COMMIT');

        reply.code(ack.is_new ? 201 : 200);
        const resp: ParQAcceptResponse = {
          version: parsed.data.version,
          accepted_at: new Date().toISOString(),
          any_yes: anyYes,
          advisory_active: anyYes,  // mirrors the UPDATE above
          injuries_created: injuriesCreated,
        };
        return resp;
      } catch (e) {
        try { await client.query('ROLLBACK'); } catch { /* ignore */ }
        throw e;
      } finally {
        client.release();
      }
    },
  );

  // Settings → Health "Mark cleared" affordance (user decision D2).
  // Clears par_q_advisory_active. Does NOT bump par_q_version.
  app.post(
    '/me/par-q/mark-cleared',
    { preHandler: [requireBearerOrCfAccess, requireScope('account:write')] },
    async (req, reply) => {
      const userId = (req as any).userId as string;
      const { rows } = await db.query(
        `UPDATE users SET par_q_advisory_active = false WHERE id = $1 RETURNING id`,
        [userId],
      );
      if (rows.length === 0) {
        reply.code(500);
        return { error: 'auth_state_missing' };
      }
      return { advisory_active: false };
    },
  );
}
```

- [ ] **Step 1.4.4: Register route in `api/src/index.ts`**

Add to the route-registration block alongside existing routes:

```typescript
import { parQRoutes } from './routes/parQ.js';
// ...
await app.register(parQRoutes, { prefix: '/api' });
```

- [ ] **Step 1.4.5: Run test to verify PASS**

Run: `cd api && npx vitest run tests/integration/par-q-flow.test.ts`
Expected: 5/5 PASS.

- [ ] **Step 1.4.6: Commit**

```bash
git add api/src/routes/parQ.ts api/src/index.ts api/tests/integration/par-q-flow.test.ts
git commit -m "feat: PAR-Q-lite GET/POST routes with versioned audit (W2.3)"
```

### Task 1.5 — Onboarding-complete route

**Files:**
- Create: `api/src/routes/onboarding.ts`
- Create: `api/tests/integration/onboarding-flow.test.ts`
- Modify: `api/src/index.ts`

- [ ] **Step 1.5.1: Write failing test**

```typescript
import 'dotenv/config';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { build } from '../helpers/build-test-app.js';
import { seedUserWithMesocycle, cleanupSeeded, type SeedHandle } from '../helpers/seed-fixtures.js';
import { db } from '../../src/db/client.js';

const handles: SeedHandle[] = [];
afterEach(async () => { if (handles.length) await cleanupSeeded(handles.splice(0)); });
afterAll(async () => { await db.end(); });

describe('W2 — onboarding-complete', () => {
  it('POST /api/me/onboarding/complete sets onboarding_completed_at + goal', async () => {
    const app = await build();
    const seed = await seedUserWithMesocycle();
    handles.push(seed);
    await db.query('UPDATE users SET onboarding_completed_at = NULL WHERE id = $1', [seed.userId]);

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/onboarding/complete',
      headers: { authorization: `Bearer ${seed.bearer}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ goal: 'bulk' }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().onboarding_completed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const { rows: [u] } = await db.query(
      'SELECT onboarding_completed_at, goal FROM users WHERE id = $1',
      [seed.userId],
    );
    expect(u.onboarding_completed_at).not.toBeNull();
    expect(u.goal).toBe('bulk');
  });

  it('rejects invalid goal with 400', async () => {
    const app = await build();
    const seed = await seedUserWithMesocycle();
    handles.push(seed);
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/onboarding/complete',
      headers: { authorization: `Bearer ${seed.bearer}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ goal: 'shred' }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('idempotent: calling twice keeps the first onboarding_completed_at', async () => {
    const app = await build();
    const seed = await seedUserWithMesocycle();
    handles.push(seed);
    await db.query('UPDATE users SET onboarding_completed_at = NULL WHERE id = $1', [seed.userId]);
    const headers = { authorization: `Bearer ${seed.bearer}`, 'content-type': 'application/json' };
    const r1 = await app.inject({ method: 'POST', url: '/api/me/onboarding/complete', headers, payload: JSON.stringify({ goal: 'maintain' }) });
    const r2 = await app.inject({ method: 'POST', url: '/api/me/onboarding/complete', headers, payload: JSON.stringify({ goal: 'cut' }) });
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    expect(r1.json().onboarding_completed_at).toBe(r2.json().onboarding_completed_at);
    // Goal MAY update on second call — that's a deliberate choice per the spec;
    // assert it does so the contract is recorded:
    const { rows: [u] } = await db.query('SELECT goal FROM users WHERE id = $1', [seed.userId]);
    expect(u.goal).toBe('cut');
  });
});
```

- [ ] **Step 1.5.2: Run test to verify FAIL**

Run: `cd api && npx vitest run tests/integration/onboarding-flow.test.ts`
Expected: FAIL.

- [ ] **Step 1.5.3: Write the route**

```typescript
// api/src/routes/onboarding.ts
// Beta W2.2 — onboarding-complete writer. Idempotent on completed_at
// (first-write wins via COALESCE), but goal can be updated on later
// calls because the wizard's GoalStep is the canonical entry point for
// users.goal in v1 (see migration 026; goal default is 'maintain').
//
// Mount path: /api/me/onboarding/complete (panel C-MOUNT-PATH).
// Scope: account:write (panel C-SCOPE).
// Account event: 'onboarding_completed' via tryRecordAccountEvent (panel D8).
// Auth-missing handling: empty UPDATE...RETURNING → 500 auth_state_missing
// (panel I-AUTH-MISSING).
import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { requireBearerOrCfAccess } from '../middleware/cfAccess.js';
import { requireScope } from '../auth/scopes.js';
import { OnboardingCompleteRequestSchema, type OnboardingCompleteResponse } from '../schemas/onboarding.js';
import { zodToFieldError } from '../utils/zodToFieldError.js';
import { tryRecordAccountEvent } from '../services/accountEvents.js';

export async function onboardingRoutes(app: FastifyInstance) {
  app.post(
    '/me/onboarding/complete',
    { preHandler: [requireBearerOrCfAccess, requireScope('account:write')] },
    async (req, reply) => {
    const userId = (req as any).userId as string;
    const userEmail = (req as any).userEmail as string;
    const ip = (req.ip || '') as string;
    const parsed = OnboardingCompleteRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return zodToFieldError(parsed.error);
    }
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ onboarding_completed_at: string; is_new: boolean }>(
        `UPDATE users
            SET onboarding_completed_at = COALESCE(onboarding_completed_at, now()),
                goal = $2
          WHERE id = $1
          RETURNING
            to_char(onboarding_completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS onboarding_completed_at,
            (onboarding_completed_at = now()) AS is_new`,
        [userId, parsed.data.goal],
      );
      if (rows.length === 0) {
        await client.query('ROLLBACK');
        reply.code(500);
        return { error: 'auth_state_missing' };
      }
      const row = rows[0];

      await tryRecordAccountEvent(client, {
        user_id: userId,
        kind: 'onboarding_completed',
        ip,
        meta: {
          version: 1,
          user_email_at_event: userEmail,
          goal: parsed.data.goal,
        },
      });

      await client.query('COMMIT');
      const resp: OnboardingCompleteResponse = {
        onboarding_completed_at: row.onboarding_completed_at,
      };
      return resp;
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw e;
    } finally {
      client.release();
    }
    },
  );
}
```

- [ ] **Step 1.5.4: Register + verify PASS**

Add to `api/src/index.ts`:

```typescript
import { onboardingRoutes } from './routes/onboarding.js';
await app.register(onboardingRoutes, { prefix: '/api' });
```

Run: `cd api && npx vitest run tests/integration/onboarding-flow.test.ts`
Expected: 3/3 PASS.

- [ ] **Step 1.5.5: Commit**

```bash
git add api/src/routes/onboarding.ts api/src/index.ts api/tests/integration/onboarding-flow.test.ts
git commit -m "feat: onboarding-complete writer route (W2.2)"
```

### Task 1.5b — PAR-Q Q5 joint follow-up + advisory-mode tests

**Files:**
- Create: `api/tests/integration/par-q-q5-joint-followup.test.ts`
- Create: `api/tests/integration/par-q-advisory-mode.test.ts`

- [ ] **Step 1.5b.1: Write Q5 follow-up test**

```typescript
// api/tests/integration/par-q-q5-joint-followup.test.ts
import 'dotenv/config';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { build } from '../helpers/build-test-app.js';
import { seedUserWithMesocycle, cleanupSeeded, type SeedHandle } from '../helpers/seed-fixtures.js';
import { db } from '../../src/db/client.js';
import { PAR_Q_VERSION, PAR_Q_QUESTIONS, PAR_Q_Q5_INDEX } from '../../src/constants/parQ.js';

const handles: SeedHandle[] = [];
afterEach(async () => { if (handles.length) await cleanupSeeded(handles.splice(0)); });
afterAll(async () => { await db.end(); });

describe('W2 — PAR-Q Q5 joint follow-up writes user_injuries', () => {
  it('Q5=no → no user_injuries rows created', async () => {
    const app = await build();
    const seed = await seedUserWithMesocycle();
    handles.push(seed);
    const answers = new Array(PAR_Q_QUESTIONS.length).fill(false);
    await app.inject({
      method: 'POST', url: '/api/me/par-q',
      headers: { authorization: `Bearer ${seed.bearer}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ version: PAR_Q_VERSION, answers, q5_joints: [] }),
    });
    const { rows } = await db.query(`SELECT joint FROM user_injuries WHERE user_id=$1`, [seed.userId]);
    expect(rows).toHaveLength(0);
  });

  it('Q5=yes + [low_back, knee_right] → 2 user_injuries rows + 1 par_q_acknowledgments row in one transaction', async () => {
    const app = await build();
    const seed = await seedUserWithMesocycle();
    handles.push(seed);
    const answers = new Array(PAR_Q_QUESTIONS.length).fill(false);
    answers[PAR_Q_Q5_INDEX] = true;
    const res = await app.inject({
      method: 'POST', url: '/api/me/par-q',
      headers: { authorization: `Bearer ${seed.bearer}`, 'content-type': 'application/json' },
      payload: JSON.stringify({
        version: PAR_Q_VERSION,
        answers,
        q5_joints: ['low_back', 'knee_right'],
      }),
    });
    expect(res.statusCode).toBe(201);  // first acceptance
    expect(res.json().injuries_created).toBe(2);

    const { rows: injuries } = await db.query(
      `SELECT joint, severity, source, notes FROM user_injuries WHERE user_id=$1 ORDER BY joint`,
      [seed.userId],
    );
    expect(injuries).toHaveLength(2);
    expect(injuries[0].joint).toBe('knee_right');
    expect(injuries[0].severity).toBe('mod');
    expect(injuries[0].source).toBe(`par_q_v${PAR_Q_VERSION}`);
    expect(injuries[1].joint).toBe('low_back');

    const { rows: acks } = await db.query(
      `SELECT version FROM par_q_acknowledgments WHERE user_id=$1`,
      [seed.userId],
    );
    expect(acks).toHaveLength(1);
  });

  it('Q5=no + joints in payload → 400 q5_joints_provided_but_q5_no', async () => {
    const app = await build();
    const seed = await seedUserWithMesocycle();
    handles.push(seed);
    const answers = new Array(PAR_Q_QUESTIONS.length).fill(false);
    const res = await app.inject({
      method: 'POST', url: '/api/me/par-q',
      headers: { authorization: `Bearer ${seed.bearer}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ version: PAR_Q_VERSION, answers, q5_joints: ['low_back'] }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('q5_joints_provided_but_q5_no');
  });

  it('re-accepting same version with same joints does NOT duplicate user_injuries rows', async () => {
    const app = await build();
    const seed = await seedUserWithMesocycle();
    handles.push(seed);
    const answers = new Array(PAR_Q_QUESTIONS.length).fill(false);
    answers[PAR_Q_Q5_INDEX] = true;
    const payload = JSON.stringify({ version: PAR_Q_VERSION, answers, q5_joints: ['low_back'] });
    const headers = { authorization: `Bearer ${seed.bearer}`, 'content-type': 'application/json' };
    await app.inject({ method: 'POST', url: '/api/me/par-q', headers, payload });
    await app.inject({ method: 'POST', url: '/api/me/par-q', headers, payload });

    const { rows } = await db.query(`SELECT joint FROM user_injuries WHERE user_id=$1`, [seed.userId]);
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 1.5b.2: Write advisory-mode test**

```typescript
// api/tests/integration/par-q-advisory-mode.test.ts
import 'dotenv/config';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { build } from '../helpers/build-test-app.js';
import { seedUserWithMesocycle, cleanupSeeded, type SeedHandle } from '../helpers/seed-fixtures.js';
import { db } from '../../src/db/client.js';
import { PAR_Q_VERSION, PAR_Q_QUESTIONS } from '../../src/constants/parQ.js';

const handles: SeedHandle[] = [];
afterEach(async () => { if (handles.length) await cleanupSeeded(handles.splice(0)); });
afterAll(async () => { await db.end(); });

describe('W2 — PAR-Q advisory mode flag', () => {
  it('any_yes=true → users.par_q_advisory_active=true; response advisory_active=true', async () => {
    const app = await build();
    const seed = await seedUserWithMesocycle();
    handles.push(seed);
    const answers = new Array(PAR_Q_QUESTIONS.length).fill(false);
    answers[0] = true;
    const res = await app.inject({
      method: 'POST', url: '/api/me/par-q',
      headers: { authorization: `Bearer ${seed.bearer}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ version: PAR_Q_VERSION, answers, q5_joints: [] }),
    });
    expect(res.json().advisory_active).toBe(true);
    const { rows: [u] } = await db.query(
      `SELECT par_q_advisory_active FROM users WHERE id=$1`,
      [seed.userId],
    );
    expect(u.par_q_advisory_active).toBe(true);
  });

  it('POST /api/me/par-q/mark-cleared sets par_q_advisory_active=false', async () => {
    const app = await build();
    const seed = await seedUserWithMesocycle();
    handles.push(seed);
    await db.query(`UPDATE users SET par_q_advisory_active=true WHERE id=$1`, [seed.userId]);
    const res = await app.inject({
      method: 'POST', url: '/api/me/par-q/mark-cleared',
      headers: { authorization: `Bearer ${seed.bearer}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().advisory_active).toBe(false);
    const { rows: [u] } = await db.query(
      `SELECT par_q_advisory_active FROM users WHERE id=$1`,
      [seed.userId],
    );
    expect(u.par_q_advisory_active).toBe(false);
  });

  it('clearing advisory does NOT bump par_q_version (it stays at last-acknowledged)', async () => {
    const app = await build();
    const seed = await seedUserWithMesocycle();
    handles.push(seed);
    const answers = new Array(PAR_Q_QUESTIONS.length).fill(false);
    answers[0] = true;
    await app.inject({
      method: 'POST', url: '/api/me/par-q',
      headers: { authorization: `Bearer ${seed.bearer}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ version: PAR_Q_VERSION, answers, q5_joints: [] }),
    });
    await app.inject({
      method: 'POST', url: '/api/me/par-q/mark-cleared',
      headers: { authorization: `Bearer ${seed.bearer}` },
    });
    const { rows: [u] } = await db.query(
      `SELECT par_q_version FROM users WHERE id=$1`,
      [seed.userId],
    );
    expect(u.par_q_version).toBe(PAR_Q_VERSION);
  });
});
```

- [ ] **Step 1.5b.3: Run + commit**

```bash
cd api && npx vitest run tests/integration/par-q-q5-joint-followup.test.ts tests/integration/par-q-advisory-mode.test.ts
git add api/tests/integration/par-q-q5-joint-followup.test.ts api/tests/integration/par-q-advisory-mode.test.ts
git commit -m "test: PAR-Q Q5 joint follow-up + advisory-mode flag (W2.3 D1+D2)"
```

### Task 1.6 — Contamination tests for new routes

**Files:**
- Create: `api/tests/integration/contamination/parQ-contamination.test.ts`
- Create: `api/tests/integration/contamination/onboarding-contamination.test.ts`

- [ ] **Step 1.6.1: Write parQ contamination test using `mkUserPair`**

Follow the pattern in `api/tests/integration/contamination/userInjuries-contamination.test.ts`. The contamination matrix for `GET/POST /api/me/par-q` is degenerate (the routes are scoped to `req.userId`) — the test asserts user B's PAR-Q acknowledgment for user B does **not** show up under user A's GET, and that user B's POST cannot upsert a row keyed to user A.

```typescript
import 'dotenv/config';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { build } from '../../helpers/build-test-app.js';
import { mkUserPair, cleanupUserPair, type UserPairHandle } from '../../helpers/seed-fixtures.js';
import { db } from '../../../src/db/client.js';
import { PAR_Q_VERSION, PAR_Q_QUESTIONS } from '../../../src/constants/parQ.js';

const handles: UserPairHandle[] = [];
afterEach(async () => { if (handles.length) await cleanupUserPair(handles.splice(0)); });
afterAll(async () => { await db.end(); });

describe('W8.2 contamination — PAR-Q', () => {
  it('user A cannot see user B PAR-Q ack via GET', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);

    // user B accepts.
    const answers = new Array(PAR_Q_QUESTIONS.length).fill(false);
    await app.inject({
      method: 'POST', url: '/api/me/par-q',
      headers: { authorization: `Bearer ${pair.userB.bearer}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ version: PAR_Q_VERSION, answers }),
    });

    // user A's GET reflects their own state, not B's.
    const res = await app.inject({
      method: 'GET', url: '/api/me/par-q',
      headers: { authorization: `Bearer ${pair.userA.bearer}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().acknowledged_version).toBe(0);
    expect(res.json().needs_prompt).toBe(true);
  });

  it('POST by user A only writes ack rows for user A', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);
    const answers = new Array(PAR_Q_QUESTIONS.length).fill(false);
    await app.inject({
      method: 'POST', url: '/api/me/par-q',
      headers: { authorization: `Bearer ${pair.userA.bearer}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ version: PAR_Q_VERSION, answers }),
    });
    const { rows } = await db.query<{ user_id: string }>(
      'SELECT user_id FROM par_q_acknowledgments WHERE user_id IN ($1, $2)',
      [pair.userA.userId, pair.userB.userId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(pair.userA.userId);
  });
});
```

- [ ] **Step 1.6.2: Confirm `mkUserPair` helper exists**

Run: `grep -n "mkUserPair\|cleanupUserPair" api/tests/helpers/seed-fixtures.ts`
Expected: helper is defined. If absent, see task Task 1.6.2-bis.

- [ ] **Step 1.6.2-bis (conditional): Add `mkUserPair` if missing**

If `grep` returned no match in Step 1.6.2, add a `mkUserPair()` helper to `api/tests/helpers/seed-fixtures.ts` that returns `{ userA: SeedHandle, userB: SeedHandle }`, each independently bearer-token-minted. This is the fixture G2 calls out; it may already be partially built. Add it before continuing.

- [ ] **Step 1.6.3: Write onboarding contamination test**

Same shape. Asserts B's POST cannot mutate A's `users` row.

- [ ] **Step 1.6.4: Run + commit**

Run: `cd api && npx vitest run tests/integration/contamination/parQ-contamination.test.ts tests/integration/contamination/onboarding-contamination.test.ts`
Expected: ALL PASS.

```bash
git add api/tests/integration/contamination/parQ-contamination.test.ts api/tests/integration/contamination/onboarding-contamination.test.ts
git commit -m "test: contamination matrix for PAR-Q + onboarding routes (W8.2)"
```

### Task 1.7 — Phase 1 verification + reviewer panel

- [ ] **Step 1.7.1: Run full Phase 1 test surface**

Run:
```bash
cd api && npm run test:integration -- \
  tests/integration/par-q-flow.test.ts \
  tests/integration/par-q-q5-joint-followup.test.ts \
  tests/integration/par-q-advisory-mode.test.ts \
  tests/integration/onboarding-flow.test.ts \
  tests/integration/contamination/parQ-contamination.test.ts \
  tests/integration/contamination/onboarding-contamination.test.ts
```
Expected: all PASS.

- [ ] **Step 1.7.2: Run typecheck + unit suite**

Run: `cd api && npm run typecheck && npm run test:unit`
Expected: clean.

- [ ] **Step 1.7.3: Dispatch Phase 1 reviewer panel**

Reviewer focus: migration safety on `users` ALTER (incl. `par_q_advisory_active`); atomic upsert with 201/200 returning correctness; audit-row preservation across version bump; CF Access + `account:write` scope wiring; Q5 in-transaction user_injuries write + de-dup; advisory-mode flag flip + Mark-cleared affordance; account_events emission with try/catch swallow; per-user rate-limit semantics. Specialists: backend + clinical + security.

---

## Phase 2 — `day_workouts.is_deload` + stalledPrEvaluator swap

**Why second:** unblocks the W3 deload-signal handoff. Critical-path because W3 already shipped using the interim signal and the comment in `stalledPrEvaluator.ts:17-22` explicitly marks the swap as W2's responsibility.

### Task 2.1 — Migration 036: day_workouts.is_deload column

**Files:**
- Create: `api/src/db/migrations/036_day_workouts_is_deload.sql`

- [ ] **Step 2.1.1: Write migration**

```sql
-- api/src/db/migrations/036_day_workouts_is_deload.sql
-- Beta W2.5 — day_workouts.is_deload column.
-- Owned by the program engine: set true on every day_workout row whose
-- week_idx == mesocycle_runs.weeks (the canonical RP deload week) AND on
-- every day_workout row inserted by manual_deload (W2.5 routes).
--
-- Backfill: every existing active/abandoned/completed mesocycle_run gets
-- its last-week rows flipped to is_deload=true. Reads identical to the
-- interim `current_week >= weeks` heuristic stalledPrEvaluator used pre-W2,
-- so the swap in api/src/services/stalledPrEvaluator.ts is behavior-
-- preserving for the existing alpha cohort.
ALTER TABLE day_workouts
  ADD COLUMN IF NOT EXISTS is_deload BOOLEAN NOT NULL DEFAULT false;

-- Backfill: flip the final week of every existing run.
UPDATE day_workouts dw
   SET is_deload = true
  FROM mesocycle_runs mr
 WHERE dw.mesocycle_run_id = mr.id
   AND dw.week_idx = mr.weeks
   AND dw.is_deload = false;

-- Index — stalledPrEvaluator filters on (mesocycle_run_id, is_deload=false)
-- when scanning sessions. Partial index keeps it cheap.
CREATE INDEX IF NOT EXISTS day_workouts_non_deload_by_run_idx
  ON day_workouts (mesocycle_run_id)
  WHERE is_deload = false;
```

- [ ] **Step 2.1.2: Run + verify**

Run: `cd api && npm run migrate && psql $DATABASE_URL -c "\d day_workouts" | grep is_deload`
Expected: column present.

```bash
psql $DATABASE_URL -c "SELECT count(*) FROM day_workouts WHERE is_deload = true"
```
Expected: > 0 (backfill populated last-week rows).

- [ ] **Step 2.1.3: Commit**

```bash
git add api/src/db/migrations/036_day_workouts_is_deload.sql
git commit -m "feat: add day_workouts.is_deload + backfill (W2.5, migration 036)"
```

### Task 2.2 — Migration 037: extend mesocycle_run_event_type enum

**Files:**
- Create: `api/src/db/migrations/037_mesocycle_run_event_type_deload.sql`

- [ ] **Step 2.2.1: Write migration**

```sql
-- api/src/db/migrations/037_mesocycle_run_event_type_deload.sql
-- Beta W2.5 — add 'manual_deload' + 'manual_deload_undone' to the
-- mesocycle_run_event_type enum so the manual-deload audit trail fits
-- the existing mesocycle_run_events writer pattern.
--
-- Postgres semantics (panel I-MIG-037): on PG 12+, `ALTER TYPE … ADD VALUE
-- IF NOT EXISTS` IS allowed inside a transaction — but the newly-added
-- value CANNOT be referenced from within the SAME transaction. That means
-- this migration must NOT contain any `SELECT 'manual_deload'::mesocycle_run_event_type`
-- or `INSERT … VALUES ('manual_deload', …)` smoke test. Any test using
-- the new value belongs in a separate migration or in integration tests.
-- migrate.ts wraps each migration in BEGIN/COMMIT, which is fine because
-- the IF NOT EXISTS guard makes re-runs no-op safe.
ALTER TYPE mesocycle_run_event_type ADD VALUE IF NOT EXISTS 'manual_deload';
ALTER TYPE mesocycle_run_event_type ADD VALUE IF NOT EXISTS 'manual_deload_undone';
```

- [ ] **Step 2.2.2: Verify migrate.ts handles ALTER TYPE in-transaction**

Run: `grep -n "BEGIN\|COMMIT\|ALTER TYPE" api/src/db/migrate.ts`
Expected output should be inspected. If migrate.ts wraps each migration in `BEGIN/COMMIT`, `ALTER TYPE ADD VALUE IF NOT EXISTS` is fine on PG ≥ 12 (the constraint was relaxed there). RepOS runs PG 16 (`postgres:16-alpine` per `services` config in W8.1 task). Confirm the migration applies cleanly:

Run: `cd api && npm run migrate`
Expected: `Applied 037_mesocycle_run_event_type_deload.sql`.

- [ ] **Step 2.2.3: Commit**

```bash
git add api/src/db/migrations/037_mesocycle_run_event_type_deload.sql
git commit -m "feat: extend mesocycle_run_event_type with manual_deload values (W2.5, migration 037)"
```

### Task 2.3 — Populate is_deload in materializeMesocycle

**Files:**
- Modify: `api/src/services/materializeMesocycle.ts`
- Create: `api/tests/integration/day-workouts-is-deload.test.ts`

- [ ] **Step 2.3.1: Write failing test**

```typescript
import 'dotenv/config';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { materializeMesocycle } from '../../src/services/materializeMesocycle.js';
import { db } from '../../src/db/client.js';
import { seedUserProgram, cleanupSeeded, type SeedHandle } from '../helpers/seed-fixtures.js';

const handles: SeedHandle[] = [];
afterEach(async () => { if (handles.length) await cleanupSeeded(handles.splice(0)); });
afterAll(async () => { await db.end(); });

describe('W2 — is_deload populated by materializeMesocycle', () => {
  it('week N rows have is_deload=true, weeks 1..N-1 have is_deload=false', async () => {
    const seed = await seedUserProgram();   // 5-week program template
    handles.push(seed);
    const { run_id } = await materializeMesocycle({
      userProgramId: seed.userProgramId,
      startDate: '2026-06-01',
      startTz: 'UTC',
    });
    const { rows } = await db.query<{ week_idx: number; is_deload: boolean }>(
      'SELECT week_idx, is_deload FROM day_workouts WHERE mesocycle_run_id=$1',
      [run_id],
    );
    const byWeek = new Map<number, boolean[]>();
    for (const r of rows) {
      const arr = byWeek.get(r.week_idx) ?? [];
      arr.push(r.is_deload);
      byWeek.set(r.week_idx, arr);
    }
    // Final week is_deload all true; earlier weeks all false.
    const weeks = [...byWeek.keys()].sort((a, b) => a - b);
    const finalWeek = weeks[weeks.length - 1];
    for (const w of weeks) {
      const expected = w === finalWeek;
      for (const b of byWeek.get(w)!) expect(b).toBe(expected);
    }
  });
});
```

(Note: `seedUserProgram` may need to be a new helper if `seedUserWithMesocycle` already-materializes. Reuse whichever helper inserts only the `user_program` row without calling `materializeMesocycle` directly.)

- [ ] **Step 2.3.2: Run + confirm FAIL**

Run: `cd api && npx vitest run tests/integration/day-workouts-is-deload.test.ts`
Expected: FAIL (column populated by backfill only on existing runs; new materialization does not set it).

- [ ] **Step 2.3.3: Patch `materializeMesocycle.ts`**

In the `INSERT INTO day_workouts` block (around lines 107-122) add `is_deload` to the column list and source it from the loop. Specifically extend `dayRows` to carry an `is_deload` boolean = `(w === weeks)`, and add it to the `unnest($N::bool[])` parameter list.

Diff sketch:

```typescript
// Before:
const dayRows: { week_idx: number; day_idx: number; scheduled_date: string; kind: string; name: string }[] = [];
for (let w = 1; w <= weeks; w++) {
  for (const d of structure.days) {
    const offset = (w - 1) * 7 + d.day_offset;
    dayRows.push({
      week_idx: w, day_idx: d.idx,
      scheduled_date: addDaysISO(input.startDate, offset),
      kind: d.kind, name: d.name,
    });
  }
}

// After:
const dayRows: { week_idx: number; day_idx: number; scheduled_date: string; kind: string; name: string; is_deload: boolean }[] = [];
for (let w = 1; w <= weeks; w++) {
  for (const d of structure.days) {
    const offset = (w - 1) * 7 + d.day_offset;
    dayRows.push({
      week_idx: w, day_idx: d.idx,
      scheduled_date: addDaysISO(input.startDate, offset),
      kind: d.kind, name: d.name,
      is_deload: w === weeks,
    });
  }
}
```

And the INSERT:

```typescript
`INSERT INTO day_workouts (mesocycle_run_id, week_idx, day_idx, scheduled_date, kind, name, is_deload)
 SELECT $1, w, d, sd::date, k, n, dl
 FROM unnest($2::int[], $3::int[], $4::text[], $5::day_workout_kind[], $6::text[], $7::bool[])
      AS t(w, d, sd, k, n, dl)
 RETURNING id, week_idx, day_idx`,
[
  runId,
  dayRows.map(r => r.week_idx),
  dayRows.map(r => r.day_idx),
  dayRows.map(r => r.scheduled_date),
  dayRows.map(r => r.kind),
  dayRows.map(r => r.name),
  dayRows.map(r => r.is_deload),
],
```

- [ ] **Step 2.3.4: Run test to verify PASS**

Run: `cd api && npx vitest run tests/integration/day-workouts-is-deload.test.ts`
Expected: PASS.

- [ ] **Step 2.3.5: Commit**

```bash
git add api/src/services/materializeMesocycle.ts api/tests/integration/day-workouts-is-deload.test.ts
git commit -m "feat: materialize sets day_workouts.is_deload on final week (W2.5)"
```

### Task 2.4 — Swap stalledPrEvaluator to use is_deload + golden-fixture parity test

**Files:**
- Modify: `api/src/services/stalledPrEvaluator.ts`
- Create: `api/tests/integration/stalled-pr-deload-parity.test.ts`
- Create: `api/tests/fixtures/stalledPrEvaluator-pre-swap-golden.json` (captured at HEAD `d5110bc` from a multi-week fixture per C-STALLEDPR-PARITY)

- [ ] **Step 2.4.0a: Generate the golden fixture from HEAD `d5110bc` (BEFORE the swap)**

Per panel finding C-STALLEDPR-PARITY: the previous parity test was structural and could not actually prove behaviour-preservation. Instead, capture `triggered` + `payload.exercise_id` from the pre-swap evaluator running against a multi-week seeded fixture, and pin that JSON. The post-swap evaluator MUST produce identical output.

The fixture must be **multi-week** (the existing `set-logs-volume-rollup.test.ts` is single-week and can't exercise the deload-week guard). Construction:

1. Seed a 5-week mesocycle with: weeks 1-2 normal progression on bench-press; weeks 3-4 RIR-0 stagnating PR sequence (3 same-load same-reps RIR-0 sessions); week 5 same-load same-reps RIR-0 sessions but every `day_workout` in week 5 has the W3-period interim "current_week >= weeks" gate active.
2. At HEAD `d5110bc` (i.e. BEFORE applying any of the swap code in Step 2.4.3), run a one-off script `api/scripts/generate-stalledpr-golden.ts` that:
   - Calls `stalledPrEvaluator.evaluate({...})` for each week 1..5 of the seeded run.
   - For each call, serializes `{ week: w, triggered, payload: { exercise_id } | null }`.
   - Writes the resulting array to `api/tests/fixtures/stalledPrEvaluator-pre-swap-golden.json`.
3. Commit the fixture WITHOUT modifying `stalledPrEvaluator.ts`. The golden file is the pre-swap source of truth.

```typescript
// api/scripts/generate-stalledpr-golden.ts (NEW)
// Run with: cd api && tsx scripts/generate-stalledpr-golden.ts > tests/fixtures/stalledPrEvaluator-pre-swap-golden.json
// Run ONCE at HEAD d5110bc (before Task 2.4.3 swap). Do not re-run after the swap.
import 'dotenv/config';
import { stalledPrEvaluator } from '../src/services/stalledPrEvaluator.js';
import { seedStalledPrMultiWeekFixture, cleanupSeeded } from '../tests/helpers/seed-fixtures.js';

(async () => {
  const seed = await seedStalledPrMultiWeekFixture();
  const out: Array<{ week: number; triggered: boolean; exercise_id: string | null }> = [];
  for (let w = 1; w <= 5; w++) {
    const res = await stalledPrEvaluator.evaluate({
      userId: seed.userId, runId: seed.mesocycleRunId, weekIdx: w,
    });
    out.push({
      week: w,
      triggered: res.triggered,
      exercise_id: res.payload?.exercise_id ?? null,
    });
  }
  await cleanupSeeded([seed]);
  process.stdout.write(JSON.stringify(out, null, 2));
})();
```

- [ ] **Step 2.4.0b: Add `seedStalledPrMultiWeekFixture` to seed-fixtures.ts**

Helper signature:

```typescript
export interface StalledPrMultiWeekFixtureHandle {
  userId: string;
  mesocycleRunId: string;
  bearer: string;
}

export async function seedStalledPrMultiWeekFixture(): Promise<StalledPrMultiWeekFixtureHandle> {
  // 5-week mesocycle, bench-press across all weeks.
  // Weeks 1-2: 5x5 @ 200/210 (progression)
  // Weeks 3-5: 5x5 @ 220 RIR=0 (stagnating PR — should fire stalledPr on weeks 3-4
  //   under the pre-swap rule; week 5 should NOT fire because it's the deload week)
  // ...inserts user, program, run, day_workouts (NO is_deload column flipped — at
  // HEAD d5110bc this column doesn't exist yet), planned_sets, set_logs.
  // Returns the handles.
}
```

- [ ] **Step 2.4.1: Write the parity test against the golden fixture**

This test loads the golden JSON, re-creates the same seeded run, and asserts the post-swap evaluator produces identical output PER WEEK.

```typescript
import 'dotenv/config';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stalledPrEvaluator } from '../../src/services/stalledPrEvaluator.js';
import { db } from '../../src/db/client.js';
import {
  seedStalledPrMultiWeekFixture,
  seedUserWithStalledPrFixture,
  cleanupSeeded,
  type StalledPrFixtureHandle,
  type StalledPrMultiWeekFixtureHandle,
} from '../helpers/seed-fixtures.js';

const handles: (StalledPrFixtureHandle | StalledPrMultiWeekFixtureHandle)[] = [];
afterEach(async () => { if (handles.length) await cleanupSeeded(handles.splice(0)); });
afterAll(async () => { await db.end(); });

describe('W2 — stalledPrEvaluator deload-signal handoff parity', () => {
  it('post-swap evaluator produces output identical to the pre-swap golden fixture (multi-week)', async () => {
    // Load the golden captured at HEAD d5110bc (before Task 2.4.3).
    const goldenPath = join(__dirname, '../fixtures/stalledPrEvaluator-pre-swap-golden.json');
    const golden = JSON.parse(readFileSync(goldenPath, 'utf-8')) as Array<{
      week: number;
      triggered: boolean;
      exercise_id: string | null;
    }>;
    expect(golden.length).toBe(5);  // 5-week mesocycle

    // Recreate the same seeded run. After migration 036 backfill, the final
    // week's day_workouts will be is_deload=true; weeks 1-4 will be false.
    const seed = await seedStalledPrMultiWeekFixture();
    handles.push(seed);

    for (const g of golden) {
      const res = await stalledPrEvaluator.evaluate({
        userId: seed.userId, runId: seed.mesocycleRunId, weekIdx: g.week,
      });
      expect(res.triggered, `week ${g.week} triggered parity`).toBe(g.triggered);
      // Exercise_id parity: if pre-swap fired on bench-press, post-swap fires on the same.
      const postExerciseId = res.payload?.exercise_id ?? null;
      expect(postExerciseId, `week ${g.week} exercise_id parity`).toBe(g.exercise_id);
    }
  });

  it('triggers when the latest 3 sessions are NOT on a deload day', async () => {
    const seed = await seedUserWithStalledPrFixture({ markLastSessionDeload: false });
    handles.push(seed);
    const res = await stalledPrEvaluator.evaluate({
      userId: seed.userId, runId: seed.mesocycleRunId, weekIdx: seed.currentWeek,
    });
    expect(res.triggered).toBe(true);
  });

  it('does NOT trigger when ALL 3 latest sessions land on day_workouts marked is_deload=true', async () => {
    const seed = await seedUserWithStalledPrFixture({ markLastSessionDeload: true });
    handles.push(seed);
    const res = await stalledPrEvaluator.evaluate({
      userId: seed.userId, runId: seed.mesocycleRunId, weekIdx: seed.currentWeek,
    });
    expect(res.triggered).toBe(false);
  });

  it('parity: behaves identically to current_week >= weeks gate on the W1.5 volume-rollup-shaped fixture (run with weeks=5, final week with is_deload sessions only → no fire; sessions in week 3 → fires)', async () => {
    // Two seeds with identical set_log shape — only the deload position changes.
    const seedMidRun = await seedUserWithStalledPrFixture({ sessionsInWeek: 3, weeks: 5, markLastSessionDeload: false });
    const seedDeloadWeek = await seedUserWithStalledPrFixture({ sessionsInWeek: 5, weeks: 5, markLastSessionDeload: true });
    handles.push(seedMidRun, seedDeloadWeek);

    const mid = await stalledPrEvaluator.evaluate({ userId: seedMidRun.userId, runId: seedMidRun.mesocycleRunId, weekIdx: 3 });
    const dl  = await stalledPrEvaluator.evaluate({ userId: seedDeloadWeek.userId, runId: seedDeloadWeek.mesocycleRunId, weekIdx: 5 });

    expect(mid.triggered).toBe(true);   // mid-run RIR-0 fire
    expect(dl.triggered).toBe(false);   // deload-week silence
  });
});
```

`seedUserWithStalledPrFixture` is a new helper. Add it to `api/tests/helpers/seed-fixtures.ts` immediately. It (1) creates user + program + run + day_workouts (5-week template), (2) inserts 3 same-load same-reps RIR-0 sessions on the same exercise into the chosen week's day_workouts, and (3) optionally flips the involved day_workouts to `is_deload=true`.

- [ ] **Step 2.4.2: Run + confirm FAIL on the second/third tests**

Run: `cd api && npx vitest run tests/integration/stalled-pr-deload-parity.test.ts`
Expected: tests 2 and 3 FAIL because the evaluator still uses `current_week >= weeks` — it has no way to know about a per-row `is_deload` flag.

- [ ] **Step 2.4.3: Swap the evaluator**

Edit `api/src/services/stalledPrEvaluator.ts`:

1. Delete the `[FIX-24 ADAPTED]` block comment (lines 16-22 inclusive — the comment block).
2. Replace the deload guard query (lines 52-58) with a per-row check inside the CTE.

New shape:

```typescript
// Deload guard: skip sessions whose day_workout is marked is_deload.
// This replaces the interim `current_week >= weeks` heuristic; populated
// by materializeMesocycle for new runs and by migration 036 backfill for
// existing alpha-cohort runs.
// No early-return — we filter at the session_agg level so per-session
// deload day rows simply don't contribute to the streak.

const { rows } = await db.query<SessionRow>(
  `WITH session_agg AS (
     SELECT
       ps.exercise_id,
       dw.id AS day_workout_id,
       MAX(sl.performed_load_lbs)::float AS max_load,
       MIN(sl.performed_load_lbs)::float AS min_load,
       MAX(sl.performed_reps)::int      AS max_reps,
       MIN(sl.performed_reps)::int      AS min_reps,
       MIN(sl.performed_rir)::int       AS min_rir,
       MAX(sl.performed_at)             AS session_at
     FROM set_logs sl
     JOIN planned_sets ps ON ps.id = sl.planned_set_id
     JOIN day_workouts dw ON dw.id = ps.day_workout_id
     WHERE sl.user_id = $1
       AND dw.mesocycle_run_id = $2
       AND dw.is_deload = false           -- W2 swap: per-row deload guard
     GROUP BY ps.exercise_id, dw.id
   ),
   ranked AS (
     SELECT *,
            ROW_NUMBER() OVER (PARTITION BY exercise_id ORDER BY session_at DESC) AS session_rank
     FROM session_agg
   )
   SELECT exercise_id, day_workout_id,
          max_load, min_load, max_reps, min_reps, min_rir,
          session_rank
   FROM ranked
   WHERE session_rank <= 3
   ORDER BY exercise_id, session_rank`,
  [userId, runId],
);
```

Delete the now-dead `const { rows: [run] }` query and the `if (!run || run.is_deload_week)` branch. Keep the `if (!runId)` early-return at the top.

Update the docblock at the top:

```typescript
// [W2 SWAP, 2026-05-26]
// Deload guard switched from the interim `mesocycle_runs.current_week >= weeks`
// heuristic to the per-row `day_workouts.is_deload` flag. Owned by the program
// engine (materializeMesocycle.ts) for new runs; populated by migration 036
// for existing alpha-cohort runs.
//
// W4 cross-wave contract: when W4 ships full deload-mesocycles
// (mesocycle_runs.is_deload), W4 Task 12 will ALSO flip every constituent
// day_workouts.is_deload=true so this per-row gate continues to mute the
// evaluator across the entire deload run. W2 publishes that contract; W4
// honors it. No further change needed here when W4 lands.
//
// Parity test:
//   api/tests/integration/stalled-pr-deload-parity.test.ts
// Golden fixture (captured at HEAD d5110bc, pre-swap):
//   api/tests/fixtures/stalledPrEvaluator-pre-swap-golden.json
```

- [ ] **Step 2.4.4: Run all parity tests + confirm PASS**

Run: `cd api && npx vitest run tests/integration/stalled-pr-deload-parity.test.ts`
Expected: 3/3 PASS.

- [ ] **Step 2.4.5: Run the FULL W3 test suite to confirm no regressions**

Run: `cd api && npx vitest run tests/integration/set-logs-to-recovery-flags.test.ts tests/integration/recovery-flag-overreaching-e2e.test.ts tests/integration/recovery-flag-telemetry.test.ts tests/integration/recovery-flag-events-schema.test.ts`
Expected: all PASS (existing W3 tests preserved).

- [ ] **Step 2.4.6: Commit**

```bash
git add api/src/services/stalledPrEvaluator.ts api/tests/integration/stalled-pr-deload-parity.test.ts api/tests/helpers/seed-fixtures.ts
git commit -m "feat: stalledPrEvaluator reads day_workouts.is_deload (W2.5 handoff from W3)"
```

### Task 2.5 — Phase 2 verification + reviewer panel

- [ ] **Step 2.5.1: Dispatch Phase 2 reviewer panel**

Reviewer focus: parity of the deload signal swap against W3 stallied-PR semantics; correctness of the `is_deload` backfill for existing alpha-cohort runs; `ALTER TYPE ADD VALUE IF NOT EXISTS` transaction semantics on PG 16. Specialists: backend + clinical.

---

## Phase 3 — Core taxonomy + seed + program-template version bump

### Task 3.1 — Migration 038: muscles core row + landmarks constant

**Files:**
- Create: `api/src/db/migrations/038_muscles_core.sql`
- Modify: `api/src/services/_muscleLandmarks.ts`

- [ ] **Step 3.1.1: Write migration**

```sql
-- api/src/db/migrations/038_muscles_core.sql
-- Beta W2.4 — core/abs muscle taxonomy.
-- Adds the 'core' muscle row. The slug 'core' is already permitted by the
-- muscles.group_name CHECK constraint in migration 008. Existing exercises
-- that should belong to core (e.g. Pallof press, currently misclassified
-- to 'upper_back' in api/src/seed/exercises.ts:752) will be re-tagged in
-- the next seed pass (Task 3.2).
INSERT INTO muscles (slug, name, group_name, display_order) VALUES
  ('core', 'Core / Abdominals', 'core', 130)
ON CONFLICT (slug) DO NOTHING;
```

- [ ] **Step 3.1.2: Add core landmarks to `_muscleLandmarks.ts`**

Edit `api/src/services/_muscleLandmarks.ts` and append:

```typescript
  core:        { mev: 6,  mav: 12, mrv: 18 },
```

(Per master plan W2.4: `MEV=6, MAV=12, MRV=18`. The plan also lists `MV=0` but `_muscleLandmarks.ts` only carries MEV/MAV/MRV — MV defaults to 0 implicitly in `computeRamp` since the formula starts at MEV.)

- [ ] **Step 3.1.3: Run migration + smoke**

Run:
```bash
cd api && npm run migrate
psql $DATABASE_URL -c "SELECT slug, name, group_name FROM muscles WHERE slug = 'core'"
```
Expected: 1 row.

- [ ] **Step 3.1.4: Commit**

```bash
git add api/src/db/migrations/038_muscles_core.sql api/src/services/_muscleLandmarks.ts
git commit -m "feat: add core muscle taxonomy + landmarks (W2.4, migration 038)"
```

### Task 3.2 — Seed core exercises

**Files:**
- Modify: `api/src/seed/exercises.ts`
- Create: `api/tests/integration/core-muscle-seeded.test.ts`

- [ ] **Step 3.2.1: Write failing test**

```typescript
import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { db } from '../../src/db/client.js';

afterAll(async () => { await db.end(); });

describe('W2 — core muscle seeded with 6+ exercises', () => {
  it('muscles row exists with slug=core', async () => {
    const { rows } = await db.query('SELECT slug FROM muscles WHERE slug = $1', ['core']);
    expect(rows).toHaveLength(1);
  });

  it('at least 6 distinct exercises have primary_muscle slug=core', async () => {
    const { rows } = await db.query(
      `SELECT e.slug FROM exercises e
       JOIN muscles m ON m.id = e.primary_muscle_id
       WHERE m.slug = 'core' AND e.archived_at IS NULL`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(6);
  });

  it('Pallof press is re-tagged to core (not upper_back)', async () => {
    const { rows } = await db.query(
      `SELECT m.slug AS muscle FROM exercises e
       JOIN muscles m ON m.id = e.primary_muscle_id
       WHERE e.slug = 'cable-pallof-press'`,
    );
    expect(rows[0]?.muscle).toBe('core');
  });
});
```

- [ ] **Step 3.2.2: Run + confirm FAIL**

Run: `cd api && npx vitest run tests/integration/core-muscle-seeded.test.ts`
Expected: tests 2 + 3 FAIL.

- [ ] **Step 3.2.3: Edit `api/src/seed/exercises.ts`**

Re-tag Cable Pallof Press from `primary_muscle: 'upper_back'` → `primary_muscle: 'core'` and update its `muscle_contributions` to `{ core: 1.0, upper_back: 0.3 }`.

Append a "CORE · anti_rotation / spinal_flexion" section with 6 new entries:

```typescript
  // ── CORE · anti_rotation / spinal_flexion ────────────────────────────────

  {
    slug: 'dead-bug',
    name: 'Dead Bug',
    primary_muscle: 'core',
    muscle_contributions: { core: 1.0 },
    movement_pattern: 'anti_rotation',
    peak_tension_length: 'mid',
    required_equipment: { _v: 1, requires: [] },     // bodyweight
    skill_complexity: 2, loading_demand: 1, systemic_fatigue: 1,
    joint_stress_profile: { _v: 1, lumbar: 'low' },
    eccentric_overload_capable: false,
    contraindications: [],
    requires_shoulder_flexion_overhead: false,
    loads_spine_in_flexion: false,
    loads_spine_axially: false,
    requires_hip_internal_rotation: false,
    requires_ankle_dorsiflexion: false,
    requires_wrist_extension_loaded: false,
  },

  {
    slug: 'suitcase-carry',
    name: 'Suitcase Carry',
    primary_muscle: 'core',
    muscle_contributions: { core: 1.0, upper_back: 0.4 },
    movement_pattern: 'carry',
    peak_tension_length: 'mid',
    required_equipment: { _v: 1, requires: [{ type: 'dumbbell' }] },
    skill_complexity: 2, loading_demand: 2, systemic_fatigue: 2,
    joint_stress_profile: { _v: 1, lumbar: 'low', shoulder: 'low' },
    eccentric_overload_capable: false,
    contraindications: [],
    requires_shoulder_flexion_overhead: false,
    loads_spine_in_flexion: false,
    loads_spine_axially: false,
    requires_hip_internal_rotation: false,
    requires_ankle_dorsiflexion: false,
    requires_wrist_extension_loaded: false,
  },

  {
    slug: 'hanging-leg-raise',
    name: 'Hanging Leg Raise',
    primary_muscle: 'core',
    muscle_contributions: { core: 1.0, biceps: 0.2 },
    movement_pattern: 'anti_rotation',  // sagittal anti-extension; closest existing tag
    peak_tension_length: 'long',
    required_equipment: { _v: 1, requires: [{ type: 'pullup_bar' }] },
    skill_complexity: 3, loading_demand: 2, systemic_fatigue: 2,
    joint_stress_profile: { _v: 1, lumbar: 'low', shoulder: 'low' },
    eccentric_overload_capable: false,
    contraindications: ['low_back_disc'],
    requires_shoulder_flexion_overhead: false,
    loads_spine_in_flexion: true,
    loads_spine_axially: false,
    requires_hip_internal_rotation: false,
    requires_ankle_dorsiflexion: false,
    requires_wrist_extension_loaded: false,
  },

  {
    slug: 'ab-wheel-rollout',
    name: 'Ab Wheel Rollout',
    primary_muscle: 'core',
    muscle_contributions: { core: 1.0, lats: 0.4 },
    movement_pattern: 'anti_rotation',
    peak_tension_length: 'long',
    required_equipment: { _v: 1, requires: [{ type: 'ab_wheel' }] },
    skill_complexity: 4, loading_demand: 2, systemic_fatigue: 2,
    joint_stress_profile: { _v: 1, lumbar: 'mod', shoulder: 'mod' },
    eccentric_overload_capable: true,
    contraindications: ['low_back_disc'],
    requires_shoulder_flexion_overhead: false,
    loads_spine_in_flexion: false,
    loads_spine_axially: false,
    requires_hip_internal_rotation: false,
    requires_ankle_dorsiflexion: false,
    requires_wrist_extension_loaded: false,
  },

  {
    slug: 'side-plank',
    name: 'Side Plank',
    primary_muscle: 'core',
    muscle_contributions: { core: 1.0, glutes: 0.3 },
    movement_pattern: 'anti_rotation',
    peak_tension_length: 'mid',
    required_equipment: { _v: 1, requires: [] },
    skill_complexity: 2, loading_demand: 1, systemic_fatigue: 1,
    joint_stress_profile: { _v: 1, lumbar: 'low', shoulder: 'low' },
    eccentric_overload_capable: false,
    contraindications: [],
    requires_shoulder_flexion_overhead: false,
    loads_spine_in_flexion: false,
    loads_spine_axially: false,
    requires_hip_internal_rotation: false,
    requires_ankle_dorsiflexion: false,
    requires_wrist_extension_loaded: false,
  },

  {
    slug: 'cable-crunch',
    name: 'Cable Crunch',
    primary_muscle: 'core',
    muscle_contributions: { core: 1.0 },
    movement_pattern: 'anti_rotation',
    peak_tension_length: 'long',
    required_equipment: { _v: 1, requires: [{ type: 'cable_stack' }] },
    skill_complexity: 2, loading_demand: 2, systemic_fatigue: 1,
    joint_stress_profile: { _v: 1, lumbar: 'mod' },
    eccentric_overload_capable: true,
    contraindications: ['low_back_disc'],
    requires_shoulder_flexion_overhead: false,
    loads_spine_in_flexion: true,
    loads_spine_axially: false,
    requires_hip_internal_rotation: false,
    requires_ankle_dorsiflexion: false,
    requires_wrist_extension_loaded: false,
  },
```

(Six new exercises; with the re-tagged Pallof press that's seven total in the core slug. If a `requires.type` enum check exists for `pullup_bar`/`ab_wheel`/`cable_stack`, confirm the equipment registry already has them — `ab_wheel` may be new.)

- [ ] **Step 3.2.4: Confirm ab_wheel equipment type**

Run: `grep -n "ab_wheel\|pullup_bar\|cable_stack" api/src/services/equipmentRegistry.ts`
Expected: types exist. If `ab_wheel` is missing, add it to the registry.

- [ ] **Step 3.2.5: Bump seed generation + run seed**

Run: `cd api && npm run seed`
Expected: seed adapter applies new exercise rows; generation bumps in `_seed_meta`.

Then re-run the test:
Run: `cd api && npx vitest run tests/integration/core-muscle-seeded.test.ts`
Expected: 3/3 PASS.

- [ ] **Step 3.2.6: Update ExercisePicker GROUP_TO_SLUGS**

Edit `frontend/src/components/library/ExercisePicker.tsx:18`:

```typescript
const GROUP_TO_SLUGS: Record<string, string[]> = {
  chest: ['chest'],
  back: ['lats', 'upper_back'],
  shoulders: ['front_delt', 'side_delt', 'rear_delt'],
  arms: ['biceps', 'triceps'],
  legs: ['quads', 'hamstrings', 'glutes', 'calves'],
  core: ['core'],   // W2.4: core muscle is now first-class
};
```

- [ ] **Step 3.2.7: Commit**

```bash
git add api/src/seed/exercises.ts api/tests/integration/core-muscle-seeded.test.ts frontend/src/components/library/ExercisePicker.tsx
git commit -m "feat: seed core exercises + wire ExercisePicker core filter (W2.4)"
```

### Task 3.3 — Bump program-template versions to include core blocks

**Files:**
- Modify: `api/src/seed/programTemplates.ts`
- Create: `api/tests/integration/program-template-core-blocks.test.ts`

**IMPORTANT (per master plan §265 QA semantics):** existing alpha-tester forks reference the OLD template version. The seed adapter at `api/src/seed/adapters/programTemplates.ts` already handles version bumps — appending core blocks to template structures bumps `version` from N to N+1. Active `user_programs.template_version = N` rows continue to materialize from the OLD template structure, untouched.

- [ ] **Step 3.3.1: Write failing test**

```typescript
import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { db } from '../../src/db/client.js';

afterAll(async () => { await db.end(); });

describe('W2 — curated programs include core blocks (new version) but old forks untouched', () => {
  it('latest program_templates version has at least one block with primary_muscle=core', async () => {
    const { rows: templates } = await db.query<{ slug: string; version: number; structure: any }>(
      `SELECT slug, version, structure FROM program_templates
       WHERE archived_at IS NULL AND created_by = 'system'`,
    );
    expect(templates.length).toBeGreaterThan(0);
    // Walk structure.days[].blocks[].exercise_slug; cross-reference exercises table.
    for (const tpl of templates) {
      const slugs: string[] = [];
      for (const d of tpl.structure?.days ?? []) for (const b of d.blocks ?? []) slugs.push(b.exercise_slug);
      const { rows: ex } = await db.query<{ slug: string; muscle: string }>(
        `SELECT e.slug, m.slug AS muscle FROM exercises e
         JOIN muscles m ON m.id = e.primary_muscle_id
         WHERE e.slug = ANY($1::text[])`,
        [slugs],
      );
      const hasCore = ex.some(r => r.muscle === 'core');
      expect(hasCore).toBe(true);
    }
  });

  it('an existing alpha user_program forked at version N STILL materializes the OLD structure', async () => {
    // Per panel I-CURATED-FORK-TEST: this test MUST be implemented, not .todo.
    // Pin alpha-tester's existing forked user_program to template_version=N
    // BEFORE the seed bumps the template to N+1 with core blocks. Then run
    // materializeMesocycle and assert the materialized day_workouts contain
    // ZERO core-muscle exercises.
    //
    // Pattern: use existing seedUserWithMesocycle but with a manual override
    // of user_program.template_version = N (the pre-W2 template version).
    // The seed adapter (api/src/seed/adapters/programTemplates.ts) keeps
    // historical template_versions alive by archiving rather than deleting.

    // Capture the latest version number BEFORE setting up the test, so we know
    // what "old" is. (The W2 seed bump made this N+1; alpha forks are still N.)
    const { rows: [latestRow] } = await db.query<{ version: number }>(
      `SELECT MAX(version) AS version FROM program_templates
       WHERE archived_at IS NULL AND created_by = 'system'`,
    );
    const latestVersion = latestRow.version;
    const oldVersion = latestVersion - 1;
    expect(oldVersion).toBeGreaterThanOrEqual(1);

    // Seed an alpha-style user_program pinned to oldVersion.
    const seed = await seedUserProgramAtTemplateVersion({ templateVersion: oldVersion });
    handles.push(seed);

    // Materialize a run from the OLD template version.
    const { run_id } = await materializeMesocycle({
      userProgramId: seed.userProgramId,
      startDate: '2026-06-01',
      startTz: 'UTC',
    });

    // Walk all materialized day_workouts' planned_sets exercises; assert
    // NONE are core-muscle.
    const { rows: coreSets } = await db.query(
      `SELECT count(*)::int AS c
         FROM planned_sets ps
         JOIN day_workouts dw ON dw.id = ps.day_workout_id
         JOIN exercises e ON e.id = ps.exercise_id
         JOIN muscles m ON m.id = e.primary_muscle_id
        WHERE dw.mesocycle_run_id = $1 AND m.slug = 'core'`,
      [run_id],
    );
    expect(coreSets[0].c).toBe(0);
  });
});
```

(`seedUserProgramAtTemplateVersion` is a small extension of existing seed helpers. Add it to `api/tests/helpers/seed-fixtures.ts` alongside `seedUserProgram`.)

- [ ] **Step 3.3.2: Edit `api/src/seed/programTemplates.ts`**

Append a `blocks` entry to each curated template's late-session day:

```typescript
// Example: append to the last strength-day's blocks array
{
  exercise_slug: 'cable-pallof-press',
  mev: 2, mav: 4,
  target_reps_low: 10, target_reps_high: 15,
  target_rir: 2, rest_sec: 60,
},
{
  exercise_slug: 'side-plank',
  mev: 2, mav: 4,
  target_reps_low: 8, target_reps_high: 15,   // time-under-tension counted as reps in v1
  target_rir: 2, rest_sec: 60,
},
```

Make sure the seed adapter bumps the template `version` field — the existing adapter at `api/src/seed/adapters/programTemplates.ts` already does this on structure-change.

- [ ] **Step 3.3.3: Re-seed + run test**

Run: `cd api && npm run seed && npx vitest run tests/integration/program-template-core-blocks.test.ts`
Expected: PASS.

- [ ] **Step 3.3.4: Commit**

```bash
git add api/src/seed/programTemplates.ts api/tests/integration/program-template-core-blocks.test.ts
git commit -m "feat: curated programs include core blocks at new template version (W2.4)"
```

### Task 3.4 — Migration 039: W2 core-taxonomy slot claim (SQL-comment-only)

**Files:**
- Create: `api/src/db/migrations/039_w2_marker.sql`

Per panel finding I-MIG-039: **do NOT** INSERT a marker row into `_seed_meta` from a migration file. Seed-generation bumps are owned by `api/src/seed/adapters/*.ts`, not by migrations. Mixing the two in a migration file pollutes schema/data separation. Migration 039 is therefore an **SQL-comment-only file** whose sole purpose is to claim the 039 slot in the migration-history table so concurrent waves can't take it.

- [ ] **Step 3.4.1: Write migration**

```sql
-- api/src/db/migrations/039_w2_marker.sql
-- Beta W2.4 — slot-claim only.
--
-- This migration intentionally contains no DDL or DML. It exists to
-- claim migration number 039 in the W2 range so concurrent waves (W4/W5/W6)
-- do not collide with this slot when running their own migrations.
--
-- The actual W2 core-taxonomy seed-generation bump happens in
-- api/src/seed/adapters/exercises.ts and adapters/programTemplates.ts
-- on the next `npm run seed`, NOT here. Keeping migrations strictly DDL
-- (panel finding I-MIG-039) avoids schema/data muddle.
--
-- This file's presence in the migration history is the slot claim.
-- migrate.ts records it in schema_migrations on first run; subsequent
-- runs see the row and skip the file body (empty body is fine).

SELECT 1;  -- single SELECT so the migrate-runner has something to execute
```

- [ ] **Step 3.4.2: Run + commit**

Run: `cd api && npm run migrate`
Expected: `Applied 039_w2_marker.sql`.

```bash
git add api/src/db/migrations/039_w2_marker.sql
git commit -m "chore: claim migration 039 slot for W2 (no-op marker per panel I-MIG-039)"
```

### Task 3.4b — Migration 040: movement_pattern enum extension

**Files:**
- Create: `api/src/db/migrations/040_movement_pattern_spinal_flexion_anti_extension.sql`
- Create: `api/tests/integration/movement-pattern-spinal-flexion-seeded.test.ts`

Per panel finding I-CORE-PATTERNS: the new core exercises (Cable Crunch, Hanging Leg Raise, Ab Wheel Rollout) need `spinal_flexion` and `anti_extension` `movement_pattern` enum values to seed correctly. The current enum only has `anti_rotation`, which is wrong for spinal-flexion-loaded movements and overloads the meaning. W4 originally claimed this slot; it migrates to W2 because W2 introduces the exercises that need it.

- [ ] **Step 3.4b.1: Write migration**

```sql
-- api/src/db/migrations/040_movement_pattern_spinal_flexion_anti_extension.sql
-- Beta W2.4 — extend movement_pattern enum with 'spinal_flexion' and
-- 'anti_extension' for the new core exercises.
--
-- W2 owns this migration (was W4-scoped) because W2 introduces the
-- exercises that require it (Cable Crunch, Hanging Leg Raise, Ab Wheel
-- Rollout). W4 consumes the values from the planning side.
--
-- ALTER TYPE … ADD VALUE IF NOT EXISTS semantics: PG 12+ allows this
-- inside a transaction; the value is NOT referenceable from within the
-- same transaction (panel I-MIG-037 applies here too). Any seed that
-- tags an exercise with one of these values runs separately via
-- `npm run seed`, NOT inside this migration.
ALTER TYPE movement_pattern ADD VALUE IF NOT EXISTS 'spinal_flexion';
ALTER TYPE movement_pattern ADD VALUE IF NOT EXISTS 'anti_extension';
```

- [ ] **Step 3.4b.2: Run + verify**

Run: `cd api && npm run migrate && psql $DATABASE_URL -c "SELECT enum_range(NULL::movement_pattern)"`
Expected: enum range includes `spinal_flexion` and `anti_extension`.

- [ ] **Step 3.4b.3: Re-tag the core exercises in `api/src/seed/exercises.ts`**

Update the entries written in Task 3.2.3:
- `cable-crunch`: `movement_pattern: 'spinal_flexion'` (was `anti_rotation`); `joint_stress_profile.lumbar = 'high'` (was `mod`).
- `hanging-leg-raise`: `movement_pattern: 'spinal_flexion'` (was `anti_rotation`); `joint_stress_profile.lumbar = 'mod'`.
- `ab-wheel-rollout`: `movement_pattern: 'anti_extension'` (was `anti_rotation`); `joint_stress_profile.lumbar = 'high'`; `joint_stress_profile.shoulder = 'high'` (was `mod`).
- `cable-pallof-press`, `dead-bug`, `suitcase-carry`, `side-plank`: keep `anti_rotation` (correct semantics).

- [ ] **Step 3.4b.4: Write seeded-applied test**

```typescript
// api/tests/integration/movement-pattern-spinal-flexion-seeded.test.ts
import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { db } from '../../src/db/client.js';

afterAll(async () => { await db.end(); });

describe('W2 — movement_pattern enum extension applied to seeds', () => {
  it('cable-crunch is movement_pattern=spinal_flexion with lumbar=high', async () => {
    const { rows } = await db.query(
      `SELECT movement_pattern::text, joint_stress_profile FROM exercises WHERE slug='cable-crunch'`,
    );
    expect(rows[0].movement_pattern).toBe('spinal_flexion');
    expect(rows[0].joint_stress_profile.lumbar).toBe('high');
  });

  it('hanging-leg-raise is movement_pattern=spinal_flexion with lumbar=mod', async () => {
    const { rows } = await db.query(
      `SELECT movement_pattern::text, joint_stress_profile FROM exercises WHERE slug='hanging-leg-raise'`,
    );
    expect(rows[0].movement_pattern).toBe('spinal_flexion');
    expect(rows[0].joint_stress_profile.lumbar).toBe('mod');
  });

  it('ab-wheel-rollout is movement_pattern=anti_extension with lumbar=high + shoulder=high', async () => {
    const { rows } = await db.query(
      `SELECT movement_pattern::text, joint_stress_profile FROM exercises WHERE slug='ab-wheel-rollout'`,
    );
    expect(rows[0].movement_pattern).toBe('anti_extension');
    expect(rows[0].joint_stress_profile.lumbar).toBe('high');
    expect(rows[0].joint_stress_profile.shoulder).toBe('high');
  });

  it('anti_rotation-correct exercises remain unchanged', async () => {
    const { rows } = await db.query(
      `SELECT slug, movement_pattern::text FROM exercises
       WHERE slug IN ('cable-pallof-press', 'dead-bug', 'suitcase-carry', 'side-plank')
       ORDER BY slug`,
    );
    for (const r of rows) expect(r.movement_pattern).toBe('anti_rotation');
  });
});
```

- [ ] **Step 3.4b.5: Run seeds + tests + commit**

```bash
cd api && npm run seed && npx vitest run tests/integration/movement-pattern-spinal-flexion-seeded.test.ts
git add api/src/db/migrations/040_movement_pattern_spinal_flexion_anti_extension.sql api/src/seed/exercises.ts api/tests/integration/movement-pattern-spinal-flexion-seeded.test.ts
git commit -m "feat: spinal_flexion + anti_extension movement_pattern enum + seed reclassification (W2.4 migration 040)"
```

### Task 3.5 — Phase 3 verification + reviewer panel

- [ ] **Step 3.5.1: Run full taxonomy test surface**

Run: `cd api && npx vitest run tests/integration/core-muscle-seeded.test.ts tests/integration/program-template-core-blocks.test.ts`
Expected: PASS.

- [ ] **Step 3.5.2: Dispatch Phase 3 reviewer panel**

Reviewer focus: alpha-tester program safety (existing forks unchanged), seed generation correctness, peak_tension_length / movement_pattern / joint_stress_profile classifications for the 6 new core exercises (clinical reviewer). Specialists: clinical + backend.

---

## Phase 4 — Manual mid-mesocycle deload (backend)

### Task 4.0 — Deload constants module (shared with W4)

**Files:**
- Create: `api/src/services/_deloadConstants.ts`

Per user decision D3: extract reduction constants into a dedicated module so both W2's manual-deload and W4's full deload-meso consume from the same source of truth.

- [ ] **Step 4.0.1: Write the constants module**

```typescript
// api/src/services/_deloadConstants.ts
// W2 + W4 shared deload constants. Both manual mid-meso deload (W2.5)
// and full deload-mesocycle (W4) compute reduced volume + reduced RIR
// from these numbers. Changing the constants here changes both surfaces.
//
// Manual-deload reduction (user decision D3, 2026-05-26):
//   reduced_sets = floor(MAV * MANUAL_DELOAD_MAV_FACTOR)
//   target_rir   = MANUAL_DELOAD_RIR
// where MAV is the per-user resolved landmark for the muscle of the
// block's primary exercise. If W4's resolveUserLandmarks() isn't yet
// available, the manual-deload service falls back to the seeded
// _muscleLandmarks.MUSCLE_LANDMARKS[muscle].mav (see manualDeload.ts).

export const MANUAL_DELOAD_MAV_FACTOR = 0.5;  // floor(MAV * 0.5)
export const MANUAL_DELOAD_RIR        = 4;    // RIR floor (was RIR=3 in v1 draft)

// (W4 may add FULL_DELOAD_* constants here when it lands.)
```

- [ ] **Step 4.0.2: Commit**

```bash
git add api/src/services/_deloadConstants.ts
git commit -m "feat: shared _deloadConstants.ts for W2 manual-deload + W4 full-deload (D3)"
```

### Task 4.1 — Service: applyManualDeload

**Files:**
- Create: `api/src/services/manualDeload.ts`
- Create: `api/src/schemas/manualDeload.ts`
- Create: `api/tests/integration/manual-deload.test.ts`

- [ ] **Step 4.1.1: Write schema**

```typescript
// api/src/schemas/manualDeload.ts
import { z } from 'zod';

export const ManualDeloadResponseSchema = z.object({
  run_id: z.string().uuid(),
  affected_week_idxs: z.array(z.number().int()),
  affected_day_workouts: z.number().int(),
  affected_planned_sets: z.number().int(),
  removed_planned_sets: z.number().int(),
  triggered_at: z.string(),
});
export type ManualDeloadResponse = z.infer<typeof ManualDeloadResponseSchema>;

export const ManualDeloadUndoResponseSchema = z.object({
  run_id: z.string().uuid(),
  reversed_at: z.string(),
});
export type ManualDeloadUndoResponse = z.infer<typeof ManualDeloadUndoResponseSchema>;
```

- [ ] **Step 4.1.2: Write failing test**

```typescript
// api/tests/integration/manual-deload.test.ts
import 'dotenv/config';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { build } from '../helpers/build-test-app.js';
import { seedUserWithFullMesocycle, cleanupSeeded, type SeedHandle } from '../helpers/seed-fixtures.js';
import { db } from '../../src/db/client.js';

const handles: SeedHandle[] = [];
afterEach(async () => { if (handles.length) await cleanupSeeded(handles.splice(0)); });
afterAll(async () => { await db.end(); });

describe('W2.5 — manual deload', () => {
  it('POST /api/mesocycles/:id/deload-now reduces remaining-week planned sets to floor(MAV * 0.5) and pins RIR=4', async () => {
    const app = await build();
    // Use a seed where each block targets a known muscle whose seeded MAV
    // is deterministic. Default landmarks: chest.mav=10, back.mav=14, etc.
    // The test asserts the formula, not specific muscle values — read
    // expected from `_muscleLandmarks` per the block's exercise.
    const seed = await seedUserWithFullMesocycle({ weeks: 5, currentWeek: 2 });
    handles.push(seed);

    const res = await app.inject({
      method: 'POST',
      url: `/api/mesocycles/${seed.mesocycleRunId}/deload-now`,
      headers: { authorization: `Bearer ${seed.bearer}` },
    });
    expect(res.statusCode).toBe(200);

    // Post-deload: every remaining block reduced to floor(muscle_mav * 0.5),
    // min 1. RIR pinned to 4. Resolve expected per block by reading the
    // block's primary exercise's muscle landmark.
    const { rows: post } = await db.query<{
      day_workout_id: string;
      block_idx: number;
      target_rir: number;
      sets: number;
      muscle_slug: string;
    }>(
      `SELECT dw.week_idx, ps.day_workout_id, ps.block_idx, ps.target_rir,
              count(*)::int AS sets,
              (SELECT m.slug FROM exercises e JOIN muscles m ON m.id=e.primary_muscle_id WHERE e.id = ps.exercise_id) AS muscle_slug
       FROM planned_sets ps JOIN day_workouts dw ON dw.id = ps.day_workout_id
       WHERE dw.mesocycle_run_id = $1 AND dw.week_idx >= 2
       GROUP BY dw.week_idx, ps.day_workout_id, ps.block_idx, ps.target_rir, ps.exercise_id`,
      [seed.mesocycleRunId],
    );

    const { MUSCLE_LANDMARKS } = await import('../../src/services/_muscleLandmarks.js');
    const { MANUAL_DELOAD_MAV_FACTOR, MANUAL_DELOAD_RIR } = await import('../../src/services/_deloadConstants.js');
    for (const r of post) {
      const mav = (MUSCLE_LANDMARKS as any)[r.muscle_slug]?.mav ?? 10;  // fallback
      const expected = Math.max(1, Math.floor(mav * MANUAL_DELOAD_MAV_FACTOR));
      expect(r.sets).toBe(expected);
      expect(r.target_rir).toBe(MANUAL_DELOAD_RIR);
    }

    // is_deload flipped on every remaining day_workout.
    const { rows: dwRows } = await db.query<{ is_deload: boolean; week_idx: number }>(
      `SELECT week_idx, is_deload FROM day_workouts WHERE mesocycle_run_id=$1 AND week_idx >= 2`,
      [seed.mesocycleRunId],
    );
    for (const r of dwRows) expect(r.is_deload).toBe(true);

    // mesocycle_run_events row appended.
    const { rows: events } = await db.query(
      `SELECT event_type, payload FROM mesocycle_run_events
       WHERE run_id=$1 AND event_type='manual_deload'`,
      [seed.mesocycleRunId],
    );
    expect(events).toHaveLength(1);
  });

  it('boundary: MAV=6 → 3, MAV=12 → 6, MAV=2 → 1 (floor of MAV * 0.5, min 1)', async () => {
    // Seed three blocks targeting muscles with deterministic MAV values.
    // Mock landmarks to known values for the seed to make the test stable.
    const seed = await seedUserWithFullMesocycle({
      weeks: 5,
      currentWeek: 2,
      blockMuscleMavOverrides: { core: 6, chest: 12, calves: 2 },  // helper takes per-muscle MAV overrides
    });
    handles.push(seed);
    const app = await build();
    await app.inject({
      method: 'POST',
      url: `/api/mesocycles/${seed.mesocycleRunId}/deload-now`,
      headers: { authorization: `Bearer ${seed.bearer}` },
    });
    const { rows } = await db.query(
      `SELECT m.slug AS muscle, count(*)::int AS sets
       FROM planned_sets ps
       JOIN day_workouts dw ON dw.id = ps.day_workout_id
       JOIN exercises e ON e.id = ps.exercise_id
       JOIN muscles m ON m.id = e.primary_muscle_id
       WHERE dw.mesocycle_run_id=$1 AND dw.week_idx >= 2
       GROUP BY m.slug ORDER BY m.slug`,
      [seed.mesocycleRunId],
    );
    const byMuscle = Object.fromEntries(rows.map(r => [r.muscle, r.sets]));
    // floor(6*0.5)=3, floor(12*0.5)=6, max(1, floor(2*0.5))=1.
    expect(byMuscle['core']).toBe(3);
    expect(byMuscle['chest']).toBe(6);
    expect(byMuscle['calves']).toBe(1);
  });

  it('rejects deload-now on a non-active run', async () => {
    const app = await build();
    const seed = await seedUserWithFullMesocycle({ weeks: 5, currentWeek: 2, status: 'abandoned' });
    handles.push(seed);
    const res = await app.inject({
      method: 'POST',
      url: `/api/mesocycles/${seed.mesocycleRunId}/deload-now`,
      headers: { authorization: `Bearer ${seed.bearer}` },
    });
    expect(res.statusCode).toBe(409);
  });
});
```

- [ ] **Step 4.1.3: Run test to confirm FAIL**

Run: `cd api && npx vitest run tests/integration/manual-deload.test.ts`
Expected: FAIL.

- [ ] **Step 4.1.4: Write `api/src/services/manualDeload.ts`**

```typescript
// api/src/services/manualDeload.ts
// Beta W2.5 — manual mid-mesocycle deload service.
// Mutates remaining-week planned_sets in-place + flips day_workouts.is_deload.
// Appends a mesocycle_run_events row of type 'manual_deload' with the
// pre-mutation snapshot in payload — undo restores from that snapshot.
//
// Reduction rule (user decision D3, 2026-05-26):
//   reduced_sets = max(1, floor(muscle_mav * MANUAL_DELOAD_MAV_FACTOR))
//                  where MANUAL_DELOAD_MAV_FACTOR = 0.5
//   target_rir   = MANUAL_DELOAD_RIR = 4
//
// muscle_mav resolves PER-USER per block via the per-user resolver
// `resolveUserLandmarks(userId, muscleSlug)` introduced in W4.3. Until W4.3
// merges, the service falls back to the seeded constant
// `MUSCLE_LANDMARKS[muscleSlug].mav` from `_muscleLandmarks.ts`. The
// fallback is intentionally permissive — the W4 resolver returns the same
// shape so this code becomes a pass-through when W4 lands.
//
// "Remaining week" = day_workouts where week_idx >= mesocycle_runs.current_week.
//
// Idempotency: a row in mesocycle_run_events of event_type='manual_deload'
// AND no subsequent 'manual_deload_undone' row → 409 conflict (already
// deloaded).
import { db } from '../db/client.js';
import { MANUAL_DELOAD_MAV_FACTOR, MANUAL_DELOAD_RIR } from './_deloadConstants.js';
import { MUSCLE_LANDMARKS } from './_muscleLandmarks.js';

// Conditional import for resolveUserLandmarks (W4.3-owned). Until it ships,
// we use the seeded landmark.
let resolveUserLandmarks: ((userId: string, muscle: string) => Promise<{ mav: number } | null>) | undefined;
try {
  // Dynamic import so this module loads cleanly when W4.3 hasn't landed.
  // Replace with a static import once `userLandmarks.ts` is in the tree.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  resolveUserLandmarks = require('./userLandmarks.js').resolveUserLandmarks;
} catch { /* W4.3 not yet merged — fall back to seeded landmarks. */ }

async function muscleMavForBlock(userId: string, muscleSlug: string): Promise<number> {
  if (resolveUserLandmarks) {
    const r = await resolveUserLandmarks(userId, muscleSlug);
    if (r) return r.mav;
  }
  return (MUSCLE_LANDMARKS as any)[muscleSlug]?.mav ?? 10;
}

export class AlreadyDeloadedError extends Error {
  status = 409;
  constructor() { super('manual_deload already applied'); }
}

export class RunNotActiveError extends Error {
  status = 409;
  constructor() { super('mesocycle_run not active'); }
}

export async function applyManualDeload(
  userId: string,
  runId: string,
): Promise<{
  affected_week_idxs: number[];
  affected_day_workouts: number;
  affected_planned_sets: number;
  removed_planned_sets: number;
}> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Ownership + active-run check.
    const { rows: [run] } = await client.query<{ current_week: number; status: string }>(
      `SELECT current_week, status FROM mesocycle_runs WHERE id=$1 AND user_id=$2 FOR UPDATE`,
      [runId, userId],
    );
    if (!run) { await client.query('ROLLBACK'); throw new Error('not_found'); }
    if (run.status !== 'active') { await client.query('ROLLBACK'); throw new RunNotActiveError(); }

    // Already-deloaded check.
    const { rows: priorEvents } = await client.query<{ event_type: string }>(
      `SELECT event_type FROM mesocycle_run_events
        WHERE run_id=$1 AND event_type IN ('manual_deload','manual_deload_undone')
        ORDER BY occurred_at`,
      [runId],
    );
    const lastEvent = priorEvents[priorEvents.length - 1]?.event_type;
    if (lastEvent === 'manual_deload') { await client.query('ROLLBACK'); throw new AlreadyDeloadedError(); }

    // Snapshot pre-mutation planned_sets for the undo payload.
    const { rows: snapshot } = await client.query(
      `SELECT ps.id, ps.day_workout_id, ps.block_idx, ps.set_idx, ps.exercise_id,
              ps.target_reps_low, ps.target_reps_high, ps.target_rir, ps.target_load_hint, ps.rest_sec
       FROM planned_sets ps JOIN day_workouts dw ON dw.id = ps.day_workout_id
       WHERE dw.mesocycle_run_id=$1 AND dw.week_idx >= $2`,
      [runId, run.current_week],
    );

    // Per-block reduced target: floor(muscle_mav * MANUAL_DELOAD_MAV_FACTOR), min 1.
    // Step 1: collect per-(day_workout, block) target counts by reading the
    // block's primary muscle and resolving the per-user MAV.
    const blockKeys = new Map<string, { exerciseId: string }>();
    for (const row of snapshot) {
      const key = `${row.day_workout_id}|${row.block_idx}`;
      if (!blockKeys.has(key)) blockKeys.set(key, { exerciseId: row.exercise_id });
    }
    // Resolve each block's muscle MAV in parallel. Each exercise hits the
    // muscles table once; we cache per-muscle.
    const exerciseToMuscle = new Map<string, string>();
    if (blockKeys.size > 0) {
      const exerciseIds = Array.from(new Set(Array.from(blockKeys.values()).map(v => v.exerciseId)));
      const { rows: emRows } = await client.query<{ exercise_id: string; muscle_slug: string }>(
        `SELECT e.id::text AS exercise_id, m.slug AS muscle_slug
           FROM exercises e JOIN muscles m ON m.id = e.primary_muscle_id
          WHERE e.id = ANY($1::uuid[])`,
        [exerciseIds],
      );
      for (const r of emRows) exerciseToMuscle.set(r.exercise_id, r.muscle_slug);
    }
    const muscleMavCache = new Map<string, number>();
    async function getMavForMuscle(muscleSlug: string): Promise<number> {
      const cached = muscleMavCache.get(muscleSlug);
      if (cached !== undefined) return cached;
      const mav = await muscleMavForBlock(userId, muscleSlug);
      muscleMavCache.set(muscleSlug, mav);
      return mav;
    }
    // Build reducedTargets: Map<dayWorkoutId|blockIdx, reducedCount>.
    const reducedTargets = new Map<string, number>();
    for (const [key, v] of blockKeys) {
      const muscleSlug = exerciseToMuscle.get(v.exerciseId) ?? 'chest';
      const mav = await getMavForMuscle(muscleSlug);
      const reduced = Math.max(1, Math.floor(mav * MANUAL_DELOAD_MAV_FACTOR));
      reducedTargets.set(key, reduced);
    }

    // Step 2: delete trailing set_idx rows per (day_workout, block) above the
    // new target. Materialize reducedTargets into a temp value list for the
    // JOIN. Use UNNEST so it's one round-trip.
    const reducedKeys = Array.from(reducedTargets.keys());
    const dwIds = reducedKeys.map(k => k.split('|')[0]);
    const blockIdxs = reducedKeys.map(k => Number(k.split('|')[1]));
    const targetCounts = reducedKeys.map(k => reducedTargets.get(k)!);
    const { rowCount: removed } = await client.query(
      `WITH targets AS (
         SELECT * FROM unnest($1::uuid[], $2::int[], $3::int[])
           AS t(day_workout_id uuid, block_idx int, reduced_target int)
       ),
       ranked AS (
         SELECT ps.id,
                ROW_NUMBER() OVER (PARTITION BY ps.day_workout_id, ps.block_idx
                                   ORDER BY ps.set_idx) AS rn,
                t.reduced_target
         FROM planned_sets ps
         JOIN day_workouts dw ON dw.id = ps.day_workout_id
         JOIN targets t ON t.day_workout_id = ps.day_workout_id AND t.block_idx = ps.block_idx
         WHERE dw.mesocycle_run_id = $4 AND dw.week_idx >= $5
       )
       DELETE FROM planned_sets ps USING ranked r
        WHERE ps.id = r.id
          AND r.rn > GREATEST(1, r.reduced_target)`,
      [dwIds, blockIdxs, targetCounts, runId, run.current_week],
    );

    // Pin RIR=MANUAL_DELOAD_RIR on remaining sets in deloaded weeks.
    const { rowCount: updated } = await client.query(
      `UPDATE planned_sets ps SET target_rir = $3
        FROM day_workouts dw
        WHERE ps.day_workout_id = dw.id
          AND dw.mesocycle_run_id = $1
          AND dw.week_idx >= $2`,
      [runId, run.current_week, MANUAL_DELOAD_RIR],
    );

    // Flip day_workouts.is_deload for the affected weeks.
    const { rows: dwFlipped } = await client.query<{ week_idx: number }>(
      `UPDATE day_workouts SET is_deload = true
        WHERE mesocycle_run_id=$1 AND week_idx >= $2
        RETURNING week_idx`,
      [runId, run.current_week],
    );

    // Audit row with snapshot payload.
    await client.query(
      `INSERT INTO mesocycle_run_events (run_id, event_type, payload)
       VALUES ($1, 'manual_deload', $2::jsonb)`,
      [runId, JSON.stringify({ from_week: run.current_week, snapshot })],
    );

    await client.query('COMMIT');
    return {
      affected_week_idxs: Array.from(new Set(dwFlipped.map(r => r.week_idx))).sort((a, b) => a - b),
      affected_day_workouts: dwFlipped.length,
      affected_planned_sets: updated ?? 0,
      removed_planned_sets: removed ?? 0,
    };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* */ }
    throw e;
  } finally {
    client.release();
  }
}

// Undo: restores from the most recent 'manual_deload' event payload, but ONLY
// if the event occurred within the last 24 hours. Past the window → 409.
export class UndoWindowExpiredError extends Error {
  status = 409;
  constructor() { super('undo_window_expired'); }
}

export async function undoManualDeload(userId: string, runId: string): Promise<void> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const { rows: [run] } = await client.query(
      `SELECT id FROM mesocycle_runs WHERE id=$1 AND user_id=$2 FOR UPDATE`,
      [runId, userId],
    );
    if (!run) { await client.query('ROLLBACK'); throw new Error('not_found'); }

    const { rows: [event] } = await client.query<{ occurred_at: string; payload: any }>(
      `SELECT occurred_at, payload FROM mesocycle_run_events
        WHERE run_id=$1 AND event_type='manual_deload'
        ORDER BY occurred_at DESC LIMIT 1`,
      [runId],
    );
    if (!event) { await client.query('ROLLBACK'); throw new Error('no_manual_deload'); }

    // 24-hour window check.
    const ageMs = Date.now() - new Date(event.occurred_at).getTime();
    if (ageMs > 24 * 60 * 60 * 1000) {
      await client.query('ROLLBACK');
      throw new UndoWindowExpiredError();
    }

    // Idempotent: if a manual_deload_undone row already exists newer than the
    // manual_deload row, nothing to do.
    const { rows: undoneRows } = await client.query(
      `SELECT 1 FROM mesocycle_run_events
        WHERE run_id=$1 AND event_type='manual_deload_undone'
          AND occurred_at > $2`,
      [runId, event.occurred_at],
    );
    if (undoneRows.length > 0) { await client.query('COMMIT'); return; }

    const snapshot = event.payload?.snapshot ?? [];
    const fromWeek = event.payload?.from_week as number;

    // Delete current planned_sets in the affected weeks.
    await client.query(
      `DELETE FROM planned_sets ps USING day_workouts dw
        WHERE ps.day_workout_id = dw.id
          AND dw.mesocycle_run_id=$1 AND dw.week_idx >= $2`,
      [runId, fromWeek],
    );

    // Restore from snapshot.
    if (snapshot.length > 0) {
      await client.query(
        `INSERT INTO planned_sets
           (id, day_workout_id, block_idx, set_idx, exercise_id,
            target_reps_low, target_reps_high, target_rir, target_load_hint, rest_sec)
         SELECT id, day_workout_id, block_idx, set_idx, exercise_id,
                target_reps_low, target_reps_high, target_rir, target_load_hint, rest_sec
         FROM jsonb_to_recordset($1::jsonb)
              AS t(id uuid, day_workout_id uuid, block_idx int, set_idx int, exercise_id uuid,
                   target_reps_low int, target_reps_high int, target_rir int,
                   target_load_hint text, rest_sec int)`,
        [JSON.stringify(snapshot)],
      );
    }

    // Unflip is_deload — but ONLY back to is_deload=true for the FINAL week
    // (the canonical RP deload week). Intermediate weeks go back to false.
    await client.query(
      `UPDATE day_workouts dw SET is_deload = (dw.week_idx = mr.weeks)
         FROM mesocycle_runs mr
        WHERE dw.mesocycle_run_id = mr.id
          AND mr.id=$1 AND dw.week_idx >= $2`,
      [runId, fromWeek],
    );

    await client.query(
      `INSERT INTO mesocycle_run_events (run_id, event_type, payload)
       VALUES ($1, 'manual_deload_undone', '{}'::jsonb)`,
      [runId],
    );

    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* */ }
    throw e;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 4.1.5: Write route**

```typescript
// api/src/routes/mesocyclesDeload.ts
// Mount path: /api/mesocycles/:id/deload-now + /undo.
// Scope: account:write (panel C-SCOPE).
import type { FastifyInstance } from 'fastify';
import { requireBearerOrCfAccess } from '../middleware/cfAccess.js';
import { requireScope } from '../auth/scopes.js';
import {
  applyManualDeload,
  undoManualDeload,
  AlreadyDeloadedError,
  RunNotActiveError,
  UndoWindowExpiredError,
} from '../services/manualDeload.js';

export async function mesocyclesDeloadRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string } }>(
    '/mesocycles/:id/deload-now',
    { preHandler: [requireBearerOrCfAccess, requireScope('account:write')] },
    async (req, reply) => {
      const userId = (req as any).userId as string;
      try {
        const r = await applyManualDeload(userId, req.params.id);
        return { run_id: req.params.id, triggered_at: new Date().toISOString(), ...r };
      } catch (e: any) {
        if (e.message === 'not_found') { reply.code(404); return { error: 'not_found' }; }
        if (e instanceof RunNotActiveError) { reply.code(409); return { error: 'run_not_active' }; }
        if (e instanceof AlreadyDeloadedError) { reply.code(409); return { error: 'already_deloaded' }; }
        throw e;
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/mesocycles/:id/deload-now/undo',
    { preHandler: [requireBearerOrCfAccess, requireScope('account:write')] },
    async (req, reply) => {
      const userId = (req as any).userId as string;
      try {
        await undoManualDeload(userId, req.params.id);
        return { run_id: req.params.id, reversed_at: new Date().toISOString() };
      } catch (e: any) {
        if (e.message === 'not_found') { reply.code(404); return { error: 'not_found' }; }
        if (e.message === 'no_manual_deload') { reply.code(409); return { error: 'no_manual_deload' }; }
        if (e instanceof UndoWindowExpiredError) { reply.code(409); return { error: 'undo_window_expired' }; }
        throw e;
      }
    },
  );
}
```

- [ ] **Step 4.1.6: Mount the route**

Edit `api/src/routes/mesocycles.ts` to mount the deload routes inside the same plugin (or register `mesocyclesDeloadRoutes` from `api/src/index.ts` with the same prefix).

- [ ] **Step 4.1.7: Run + PASS**

Run: `cd api && npx vitest run tests/integration/manual-deload.test.ts`
Expected: 3/3 PASS.

- [ ] **Step 4.1.8: Commit**

```bash
git add api/src/services/manualDeload.ts api/src/schemas/manualDeload.ts api/src/routes/mesocyclesDeload.ts api/src/routes/mesocycles.ts api/tests/integration/manual-deload.test.ts
git commit -m "feat: manual mid-meso deload service + route with snapshot for undo (W2.5)"
```

### Task 4.2 — Undo route + 24h window test

**Files:**
- Create: `api/tests/integration/manual-deload-undo.test.ts`

- [ ] **Step 4.2.1: Write test**

```typescript
// api/tests/integration/manual-deload-undo.test.ts
import 'dotenv/config';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { build } from '../helpers/build-test-app.js';
import { seedUserWithFullMesocycle, cleanupSeeded, type SeedHandle } from '../helpers/seed-fixtures.js';
import { db } from '../../src/db/client.js';

const handles: SeedHandle[] = [];
afterEach(async () => { if (handles.length) await cleanupSeeded(handles.splice(0)); });
afterAll(async () => { await db.end(); });

describe('W2.5 — manual deload undo', () => {
  it('undo within 24h restores planned_sets to pre-deload state', async () => {
    const app = await build();
    const seed = await seedUserWithFullMesocycle({ weeks: 5, currentWeek: 2 });
    handles.push(seed);
    const { rows: pre } = await db.query(
      `SELECT count(*)::int AS c FROM planned_sets ps JOIN day_workouts dw ON dw.id=ps.day_workout_id
       WHERE dw.mesocycle_run_id=$1 AND dw.week_idx >= 2`,
      [seed.mesocycleRunId],
    );
    const auth = { authorization: `Bearer ${seed.bearer}` };
    await app.inject({ method: 'POST', url: `/api/mesocycles/${seed.mesocycleRunId}/deload-now`, headers: auth });
    const undoRes = await app.inject({ method: 'POST', url: `/api/mesocycles/${seed.mesocycleRunId}/deload-now/undo`, headers: auth });
    expect(undoRes.statusCode).toBe(200);

    const { rows: post } = await db.query(
      `SELECT count(*)::int AS c FROM planned_sets ps JOIN day_workouts dw ON dw.id=ps.day_workout_id
       WHERE dw.mesocycle_run_id=$1 AND dw.week_idx >= 2`,
      [seed.mesocycleRunId],
    );
    expect(post[0].c).toBe(pre[0].c);
  });

  it('undo past 24h returns 409 undo_window_expired', async () => {
    const app = await build();
    const seed = await seedUserWithFullMesocycle({ weeks: 5, currentWeek: 2 });
    handles.push(seed);
    const auth = { authorization: `Bearer ${seed.bearer}` };
    await app.inject({ method: 'POST', url: `/api/mesocycles/${seed.mesocycleRunId}/deload-now`, headers: auth });

    // Backdate the event by 25 hours.
    await db.query(
      `UPDATE mesocycle_run_events SET occurred_at = now() - interval '25 hours'
        WHERE run_id=$1 AND event_type='manual_deload'`,
      [seed.mesocycleRunId],
    );

    const undoRes = await app.inject({ method: 'POST', url: `/api/mesocycles/${seed.mesocycleRunId}/deload-now/undo`, headers: auth });
    expect(undoRes.statusCode).toBe(409);
    expect(undoRes.json().error).toBe('undo_window_expired');
  });
});
```

- [ ] **Step 4.2.2: Run + PASS**

Run: `cd api && npx vitest run tests/integration/manual-deload-undo.test.ts`
Expected: 2/2 PASS.

- [ ] **Step 4.2.3: Commit**

```bash
git add api/tests/integration/manual-deload-undo.test.ts
git commit -m "test: manual deload undo + 24h window enforcement (W2.5)"
```

### Task 4.3 — Contamination tests for deload routes (deload-now AND deload-now/undo)

**Files:**
- Create: `api/tests/integration/contamination/manualDeload-contamination.test.ts`
- Create: `api/tests/integration/manual-deload-undo-contamination.test.ts`

Per panel finding I-CONTAM: enumerate ALL new routes in contamination tests. The undo route was previously missing.

- [ ] **Step 4.3.1: Write deload-now contamination test**

User B cannot POST `/api/mesocycles/<userA's run>/deload-now` — expect 404 (per the user_id check in the service).

```typescript
import 'dotenv/config';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { build } from '../../helpers/build-test-app.js';
import { mkUserPair, seedFullMesocycleForUser, cleanupUserPair, type UserPairHandle } from '../../helpers/seed-fixtures.js';
import { db } from '../../../src/db/client.js';

const handles: UserPairHandle[] = [];
afterEach(async () => { if (handles.length) await cleanupUserPair(handles.splice(0)); });
afterAll(async () => { await db.end(); });

describe('W8.2 — manual-deload contamination', () => {
  it('user B cannot deload user A\'s mesocycle_run', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);
    const runId = await seedFullMesocycleForUser(pair.userA.userId);

    const res = await app.inject({
      method: 'POST',
      url: `/api/mesocycles/${runId}/deload-now`,
      headers: { authorization: `Bearer ${pair.userB.bearer}` },
    });
    expect(res.statusCode).toBe(404);

    // Confirm A's run is untouched.
    const { rows: events } = await db.query(
      `SELECT event_type FROM mesocycle_run_events WHERE run_id=$1 AND event_type='manual_deload'`,
      [runId],
    );
    expect(events).toHaveLength(0);
  });
});
```

- [ ] **Step 4.3.2: Write deload-now/undo contamination test**

```typescript
// api/tests/integration/manual-deload-undo-contamination.test.ts
import 'dotenv/config';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { build } from '../helpers/build-test-app.js';
import { mkUserPair, seedFullMesocycleForUser, cleanupUserPair, type UserPairHandle } from '../helpers/seed-fixtures.js';
import { db } from '../../src/db/client.js';

const handles: UserPairHandle[] = [];
afterEach(async () => { if (handles.length) await cleanupUserPair(handles.splice(0)); });
afterAll(async () => { await db.end(); });

describe('W8.2 — manual-deload undo contamination', () => {
  it('user B cannot undo user A deload of user A\'s mesocycle_run', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);
    const runId = await seedFullMesocycleForUser(pair.userA.userId);

    // User A applies a deload (legitimate).
    await app.inject({
      method: 'POST',
      url: `/api/mesocycles/${runId}/deload-now`,
      headers: { authorization: `Bearer ${pair.userA.bearer}` },
    });
    // User B tries to undo.
    const undoRes = await app.inject({
      method: 'POST',
      url: `/api/mesocycles/${runId}/deload-now/undo`,
      headers: { authorization: `Bearer ${pair.userB.bearer}` },
    });
    expect(undoRes.statusCode).toBe(404);

    // Confirm A's deload is still in place — no manual_deload_undone row.
    const { rows: events } = await db.query(
      `SELECT event_type FROM mesocycle_run_events WHERE run_id=$1 ORDER BY occurred_at`,
      [runId],
    );
    expect(events.map(r => r.event_type)).toEqual(['manual_deload']);
  });
});
```

- [ ] **Step 4.3.3: Run + commit**

Run: `cd api && npx vitest run tests/integration/contamination/manualDeload-contamination.test.ts tests/integration/manual-deload-undo-contamination.test.ts`
Expected: PASS.

```bash
git add api/tests/integration/contamination/manualDeload-contamination.test.ts api/tests/integration/manual-deload-undo-contamination.test.ts
git commit -m "test: contamination matrix for deload-now AND undo (W8.2, panel I-CONTAM)"
```

### Task 4.4 — Phase 4 verification + reviewer panel

- [ ] **Step 4.4.1: Run full Phase 4 + Phase 2/3 surfaces**

Run: `cd api && npm run test:integration`
Expected: full integration suite green.

- [ ] **Step 4.4.2: Dispatch Phase 4 reviewer panel**

Reviewer focus: snapshot JSON shape + restore correctness, idempotency of deload + undo, 24h window arithmetic, contamination matrix. Specialists: backend + security + clinical (deload rule clinical correctness vs the master plan's `floor(target_sets * 0.6)` + RIR=3 pin).

---

## Phase 5 — Frontend surfaces (onboarding, PAR-Q, deload button, Settings)

### Task 5.1 — Terms dictionary additions

**Files:**
- Modify: `frontend/src/lib/terms.ts`

- [ ] **Step 5.1.0: Add the modal z-index tokens to `frontend/src/tokens.ts`**

Per panel finding C-Z, add:

```typescript
export const TOKENS = {
  // ...existing tokens...
  zModal: {
    zSheet:   100,   // BlockOverflowMenu, MidSessionSwapSheet, DeloadThisWeekSheet
    zBanner: 1000,   // LogBufferRecovery
    zOverlay:1500,   // OnboardingOverlay, ParQGate
    zAuth:   2000,   // SessionExpiredBanner
  },
} as const;
```

Every overlay component in W2 imports `TOKENS.zModal.zOverlay` (or `zSheet`) rather than literal `zIndex` values.

- [ ] **Step 5.1.1: Extend `TermKey` and `TERMS`**

Add the union members and definitions:

```typescript
// Edit `TermKey` to include:
  | 'PAR_Q' | 'core' | 'intro_week' | 'soft_gate' | 'manual_deload' | 'advisory_mode'

// Add to TERMS:
  PAR_Q: {
    short: 'PAR-Q',
    full: 'Physical Activity Readiness Questionnaire',
    plain: 'A 9-question screen for conditions that need clinician sign-off before changing your training.',
    whyMatters: 'A "yes" doesn\'t lock you out — it puts your program into advisory mode (volume capped at MEV, RIR floored at 3) until you clear it on the Settings → Health page.',
  },
  advisory_mode: {
    short: 'advisory mode',
    full: 'Clinical advisory mode',
    plain: 'A precaution the app applies after a PAR-Q "yes". Your program stays at MEV (minimum-effective volume) with RIR floored at 3 instead of progressing through the normal ramp.',
    whyMatters: 'It is reversible: once you have spoken to a clinician you can mark yourself cleared on Settings → Health and the program goes back to normal progression.',
  },
  core: {
    short: 'core',
    full: 'Core (abdominals + obliques + spinal stabilizers)',
    plain: 'The muscles that resist or produce trunk motion — abs, obliques, and the deep stabilizers along your spine.',
    whyMatters: 'Trained for stiffness more than size in RepOS. Anti-rotation work transfers to every other lift.',
  },
  intro_week: {
    short: 'intro week',
    full: 'Intro week',
    plain: 'Week 1 of a mesocycle — light loads, full RIR budget, a deliberate ramp-on.',
    whyMatters: 'Lets your tendons and CNS catch up to the new program before volume ramps.',
  },
  soft_gate: {
    short: 'soft gate',
    full: 'Soft gate',
    plain: 'An advisory the app shows but does not enforce.',
    whyMatters: 'You can always click through. RepOS never hard-blocks training based on a self-reported answer.',
  },
  manual_deload: {
    short: 'manual deload',
    full: 'Manual deload',
    plain: 'A user-triggered deload that rewrites the remaining weeks of your mesocycle to lighter sets at RIR 3.',
    whyMatters: 'Use it when life pushes back — sick, slept badly, joint cranky. Undoable for 24 hours.',
  },
```

- [ ] **Step 5.1.2: Run Term tests**

Run: `cd frontend && npm run test -- src/components/Term.test.tsx`
Expected: PASS.

- [ ] **Step 5.1.3: Commit**

```bash
git add frontend/src/lib/terms.ts
git commit -m "feat: add PAR-Q, core, intro_week, soft_gate, manual_deload term entries (W2)"
```

### Task 5.2 — Onboarding overlay (5-step responsive)

**Files:**
- Create: `frontend/src/components/onboarding/OnboardingOverlay.tsx`
- Create: `frontend/src/components/onboarding/steps/WelcomeStep.tsx`
- Create: `frontend/src/components/onboarding/steps/EquipmentStep.tsx`
- Create: `frontend/src/components/onboarding/steps/GoalStep.tsx`
- Create: `frontend/src/components/onboarding/steps/ProgramStep.tsx`
- Create: `frontend/src/components/onboarding/steps/ReadyStep.tsx`
- Create: `frontend/src/lib/api/onboarding.ts`
- Create: `frontend/src/components/onboarding/__tests__/OnboardingOverlay.test.tsx`

- [ ] **Step 5.2.1: Write `frontend/src/lib/api/onboarding.ts`**

```typescript
// frontend/src/lib/api/onboarding.ts
import { apiFetch } from './apiFetch';

export type OnboardingGoal = 'cut' | 'maintain' | 'bulk';

export async function completeOnboarding(goal: OnboardingGoal): Promise<{ onboarding_completed_at: string }> {
  const res = await apiFetch('/api/me/onboarding/complete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ goal }),
  });
  if (!res.ok) throw new Error(`onboarding_failed_${res.status}`);
  return res.json();
}

export async function getCurrentUserOnboardingState(): Promise<{ onboarding_completed_at: string | null }> {
  // Existing /api/me endpoint exposed by auth flow. Confirm with `grep -n "/api/me\b" api/src/app.ts`
  // and add the column to that route's SELECT if missing.
  const res = await apiFetch('/api/me');
  if (!res.ok) throw new Error('users_me_failed');
  return res.json();
}
```

- [ ] **Step 5.2.2: Confirm /api/me returns onboarding_completed_at**

Run: `grep -n "/api/me\b" api/src/app.ts`
If the existing route doesn't SELECT `onboarding_completed_at` + `par_q_acknowledged_at` + `par_q_version`, add them to that route's SELECT clause. (This step is part of Task 5.2.)

- [ ] **Step 5.2.3: Write the overlay skeleton with full a11y baseline**

```tsx
// frontend/src/components/onboarding/OnboardingOverlay.tsx
//
// A11y baseline matches frontend/src/components/programs/MidSessionSwapPicker.tsx
// lines 42-118 (panel finding C-A11Y): ESC handler, focus trap, initial focus
// into dialog, return focus on close, re-focus when async content loads.
//
// Mounted INSIDE <AppShell> as a sibling of <Outlet> (panel C-MOUNT). The
// single derived state machine in App.tsx ensures onboarding precedes PAR-Q —
// this component renders ONLY if !onboarding_completed_at.
import { useEffect, useRef, useState } from 'react';
import { useIsMobile } from '../../lib/useIsMobile';
import { Term } from '../Term';
import WelcomeStep from './steps/WelcomeStep';
import EquipmentStep from './steps/EquipmentStep';
import GoalStep from './steps/GoalStep';
import ProgramStep from './steps/ProgramStep';
import ReadyStep from './steps/ReadyStep';
import { completeOnboarding, type OnboardingGoal } from '../../lib/api/onboarding';
import { TOKENS, FONTS } from '../../tokens';

type Step = 1 | 2 | 3 | 4 | 5;

interface OnboardingOverlayProps {
  onComplete: () => void;
}

export function OnboardingOverlay({ onComplete }: OnboardingOverlayProps) {
  const [step, setStep] = useState<Step>(1);
  const [goal, setGoal] = useState<OnboardingGoal>('maintain');
  const isMobile = useIsMobile();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Capture pre-mount focus + return-focus on unmount.
  useEffect(() => {
    previouslyFocusedRef.current = (document.activeElement as HTMLElement) ?? null;
    return () => {
      previouslyFocusedRef.current?.focus?.();
    };
  }, []);

  // Initial focus into the dialog. Re-fires when step changes (re-focus
  // on async content load — pattern from MidSessionSwapPicker).
  useEffect(() => {
    const first = dialogRef.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    first?.focus();
  }, [step]);

  // ESC handler. Onboarding has no "Cancel" — ESC is no-op (user must
  // complete or skip steps). Matches W3 spec for non-cancellable dialogs.

  // Focus trap.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  async function finish() {
    await completeOnboarding(goal);
    onComplete();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      ref={dialogRef}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(10,13,18,0.92)',
        display: 'flex', alignItems: isMobile ? 'flex-start' : 'center',
        justifyContent: 'center', zIndex: TOKENS.zModal.zOverlay,
        padding: isMobile ? 0 : 24,
      }}
    >
      <div style={{
        background: TOKENS.surface, border: `1px solid ${TOKENS.line}`,
        borderRadius: isMobile ? 0 : 16,
        padding: isMobile ? '24px 16px 80px' : '32px 36px',
        maxWidth: 720, width: '100%', minHeight: isMobile ? '100vh' : 'auto',
        fontFamily: FONTS.body,
      }}>
        <div style={{ fontFamily: FONTS.mono, fontSize: 11, letterSpacing: 1.4, color: TOKENS.accent, marginBottom: 8 }}>
          ONBOARDING · STEP {step} / 5
        </div>
        <h2 id="onboarding-title" style={{ fontSize: 24, fontWeight: 700, color: TOKENS.text, margin: '0 0 6px' }}>
          {step === 1 && 'Welcome to RepOS'}
          {step === 2 && 'What equipment do you have?'}
          {step === 3 && 'What\'s your goal?'}
          {step === 4 && 'Pick a program'}
          {step === 5 && <>Ready to start your first <Term k="mesocycle" />?</>}
        </h2>
        {step === 1 && <WelcomeStep onNext={() => setStep(2)} />}
        {step === 2 && <EquipmentStep onNext={() => setStep(3)} onSkip={() => setStep(3)} />}
        {step === 3 && <GoalStep goal={goal} onChange={setGoal} onNext={() => setStep(4)} onSkip={() => setStep(4)} />}
        {step === 4 && <ProgramStep goal={goal} onNext={() => setStep(5)} onSkip={() => setStep(5)} />}
        {step === 5 && <ReadyStep onStart={finish} />}
      </div>
    </div>
  );
}
```

- [ ] **Step 5.2.4: Write WelcomeStep, GoalStep, ProgramStep, ReadyStep**

Each is a small focused component. WelcomeStep is informational + Next button. GoalStep is a 3-card radio (`cut` / `maintain` / `bulk` only; cardio first-class is deferred to W7+ per user decision D5). ProgramStep filters the program catalog by `goal` (calls existing `/api/programs` route). ReadyStep is the "Start" button that calls `onStart` (which calls `completeOnboarding`). EquipmentStep wraps the existing `EquipmentWizard` — pass it in via prop or render it inline.

Each step receives `onSkip` per master plan W2.2 ("Skippable on steps 2–4").

Each step that surfaces a term-of-art wraps it: e.g., GoalStep wraps `<Term k="hypertrophy">hypertrophy</Term>`, ProgramStep wraps `<Term k="mesocycle" />` and `<Term k="MEV" />`.

**Skip path resolution (panel I-PROGRAMSTEP-SKIP):** if the user skips ProgramStep (step 4), `ReadyStep` MUST surface explicit copy + a deep link telling them where to come back. Example copy:

> "No program selected yet. You can browse and pick one any time from the **Programs** page — until then your Today card will be empty."
>
> [Browse programs →]  (NavLink to `/programs`)

There is NO dead-end Today card without a program — the empty state on Today routes the user back to Programs with the same deep link.

- [ ] **Step 5.2.5: Mount in AppShell (panel C-MOUNT)**

The overlays mount **inside** `<AppShell>` as a sibling of `<Outlet>`, not outside `<BrowserRouter>`. A single derived state machine prevents flash-of-PAR-Q before onboarding settles:

```tsx
// frontend/src/components/layout/AppShell.tsx
//
// Mount sequence (panel C-MOUNT):
//   1. If user data is still loading, render nothing under the overlays.
//   2. If !user.onboarding_completed_at        → render OnboardingOverlay only.
//   3. Else if user.par_q_version < currentVer → render ParQGate only.
//   4. Else                                    → render neither.
// Never render both at the same time. Never render PAR-Q before onboarding.
import { Outlet } from 'react-router-dom';
import { useCurrentUser } from '../../lib/useCurrentUser';
import { OnboardingOverlay } from '../onboarding/OnboardingOverlay';
import { ParQGate } from '../onboarding/ParQGate';
import { Sidebar } from './Sidebar';

export function AppShell() {
  const { user, parQStatus, reload } = useCurrentUser();
  if (!user) {
    return <div><Sidebar /><Outlet /></div>;
  }
  const overlay =
    !user.onboarding_completed_at
      ? <OnboardingOverlay onComplete={reload} />
      : (parQStatus?.needs_prompt
          ? <ParQGate onComplete={reload} />
          : null);
  return (
    <div>
      <Sidebar />
      <Outlet />
      {overlay}
    </div>
  );
}
```

The `useCurrentUser` hook fetches `/api/me` (now exposing `onboarding_completed_at`, `par_q_version`, `par_q_advisory_active`) and `/api/me/par-q` in parallel. `reload` re-fetches both — called after OnboardingOverlay's `finish()` and after `ParQGate`'s submit. The cascade is single-pass: once onboarding finishes, the next render naturally evaluates the PAR-Q condition.

`<App.tsx>` registers `<AppShell>` as the root element of all authenticated routes:

```tsx
// frontend/src/App.tsx (excerpt)
<BrowserRouter>
  <Routes>
    <Route element={<AppShell />}>  {/* mounts overlays */}
      <Route index element={<HomePage />} />
      <Route path="settings/health" element={<SettingsHealthPage />} />
      {/* … other authenticated routes … */}
    </Route>
  </Routes>
</BrowserRouter>
```

- [ ] **Step 5.2.6: Write component test (incl. 3 a11y tests per C-A11Y)**

`OnboardingOverlay.test.tsx` — mounts the overlay, asserts:
1. Step 1 shows "Welcome" copy with the `<Term k="mesocycle">` wrapper rendered.
2. Clicking Next advances to step 2.
3. Step 2/3/4 expose a Skip button; clicking it advances.
4. Final step's Start button calls `completeOnboarding` with the selected goal.
5. **A11y-1: Initial focus.** When the overlay mounts, focus lands on the first interactive element inside the dialog (e.g., Step 1's Next button).
6. **A11y-2: Focus trap.** Shift+Tab from the first focusable element wraps to the last; Tab from the last wraps to the first. Focus never leaves the dialog.
7. **A11y-3: Return focus.** Before the overlay mounts, focus is on a `<button data-testid="trigger">`. After `onComplete()` fires and the overlay unmounts, focus returns to `data-testid="trigger"`.

- [ ] **Step 5.2.7: Run + commit**

Run: `cd frontend && npm run test -- src/components/onboarding`
Expected: PASS.

```bash
git add frontend/src/components/onboarding/ frontend/src/lib/api/onboarding.ts frontend/src/App.tsx
git commit -m "feat: 5-step responsive onboarding overlay with skippable steps (W2.2)"
```

### Task 5.3 — PAR-Q gate component

**Files:**
- Create: `frontend/src/components/onboarding/ParQGate.tsx`
- Create: `frontend/src/lib/api/parQ.ts`
- Create: `frontend/src/components/onboarding/__tests__/ParQGate.test.tsx`

- [ ] **Step 5.3.1: Write API client**

```typescript
// frontend/src/lib/api/parQ.ts
import { apiFetch } from './apiFetch';

export type ParQ5Joint =
  | 'shoulder_left' | 'shoulder_right'
  | 'low_back'
  | 'knee_left' | 'knee_right'
  | 'elbow' | 'wrist' | 'other';

export interface ParQStatus {
  current_version: number;
  acknowledged_version: number;
  needs_prompt: boolean;
  questions: string[];
  advisory_active: boolean;
}

export async function getParQStatus(): Promise<ParQStatus> {
  const res = await apiFetch('/api/me/par-q');
  if (!res.ok) throw new Error('par_q_status_failed');
  return res.json();
}

export async function acceptParQ(
  version: number,
  answers: boolean[],
  q5_joints: ParQ5Joint[],
): Promise<{ any_yes: boolean; advisory_active: boolean; injuries_created: number }> {
  const res = await apiFetch('/api/me/par-q', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ version, answers, q5_joints }),
  });
  if (!res.ok) throw new Error(`par_q_accept_failed_${res.status}`);
  return res.json();
}

export async function markPARQCleared(): Promise<{ advisory_active: false }> {
  const res = await apiFetch('/api/me/par-q/mark-cleared', { method: 'POST' });
  if (!res.ok) throw new Error('par_q_mark_cleared_failed');
  return res.json();
}
```

- [ ] **Step 5.3.2: Write `ParQGate.tsx`**

The component reads `getParQStatus`. If `needs_prompt === false` it renders nothing. Otherwise, it renders the 9-question Yes/No screen.

**A11y baseline (panel C-A11Y):** same pattern as `OnboardingOverlay` — ESC handler (no-op for first prompt; close-only when invoked from Settings → Health re-review mode), focus trap, initial focus on first question, return-focus on close, re-focus when async question list arrives.

**Q5 follow-up (user decision D1):** when the user answers Q5 = "yes", the form reveals a `ParQJointPicker` multi-select with options `shoulder_left, shoulder_right, low_back, knee_left, knee_right, elbow, wrist, other`. Selected joints are sent in the `q5_joints` array on submit; the backend writes corresponding `user_injuries` rows in the same transaction.

**Soft-gate banner copy (user decision D2 — replaces the v1 draft "read-only progression mode" copy):**

> Based on your answers, talk to a clinician before increasing training load. You can keep using RepOS — your program will stay at conservative volume (MEV with RIR 3) until your status is cleared.

If Q8 (chronic condition) is "yes", append:

> Discuss this with your clinician before increasing volume.

Term-wrap `<Term k="PAR_Q" />`, `<Term k="advisory_mode" />`, `<Term k="MEV" />`, `<Term k="RIR" />` in the banner.

On submit:
- POST `/api/me/par-q` with `{ version, answers, q5_joints }`.
- If response `any_yes === true`: render the soft-gate banner; provide a "Continue" button that dismisses the gate (the gate has been recorded; `par_q_advisory_active=true` is now persisted server-side).
- If response `any_yes === false`: dismiss immediately.
- Re-fetch `/api/me/par-q` and `/api/me` to update the AppShell's user state on close.

- [ ] **Step 5.3.3: Mount under AppShell after onboarding** (covered in Step 5.2.5 — single derived state machine)

The state machine in `AppShell.tsx` already covers this:

```tsx
const overlay =
  !user.onboarding_completed_at
    ? <OnboardingOverlay onComplete={reload} />
    : (parQStatus?.needs_prompt
        ? <ParQGate onComplete={reload} />
        : null);
```

No separate App.tsx mount block. `parQStatus.current_version` (from the API) is the source of truth — the frontend does NOT hardcode the version.

- [ ] **Step 5.3.4: Test cases (incl. 3 a11y tests per C-A11Y)**

- All-No answers → POST sent with `q5_joints=[]` → `any_yes=false` → close + no banner. `injuries_created=0`.
- One-Yes answer (not Q5) → POST sent → banner shown → click-through closes. Banner copy includes "your program will stay at conservative volume (MEV with RIR 3)".
- Q5=Yes alone (no joint picker submission) → POST sent with `q5_joints=[]` → banner shown → `injuries_created=0`.
- Q5=Yes + ['low_back','knee_right'] → POST sent → banner shown → `injuries_created=2`.
- Q8=Yes → banner shows additional "Discuss this with your clinician before increasing volume" line.
- `needs_prompt=false` from GET → gate doesn't render.
- Re-review mode (mounted from Settings → Health): ESC closes; otherwise gate behaves identically.
- **A11y-1, A11y-2, A11y-3:** initial focus on first question; Shift+Tab wrap; return-focus on close.

- [ ] **Step 5.3.5: Run + commit**

Run: `cd frontend && npm run test -- src/components/onboarding/__tests__/ParQGate.test.tsx`
Expected: PASS.

```bash
git add frontend/src/components/onboarding/ParQGate.tsx frontend/src/lib/api/parQ.ts frontend/src/components/onboarding/__tests__/ParQGate.test.tsx frontend/src/App.tsx
git commit -m "feat: PAR-Q gate with soft-gate copy + version-aware re-prompt (W2.3)"
```

### Task 5.4 — "Deload this week" button (two-step confirm) + MesocycleRecap surfacing

**Files:**
- Create: `frontend/src/components/programs/DeloadThisWeekButton.tsx`
- Create: `frontend/src/components/programs/__tests__/DeloadThisWeekButton.test.tsx`
- Modify: `frontend/src/pages/MyProgramPage.tsx`
- Modify: `frontend/src/pages/TodayPage.tsx`
- Modify: `frontend/src/components/programs/MesocycleRecap.tsx`
- Create: `frontend/src/lib/api/manualDeload.ts`

- [ ] **Step 5.4.1: Write API client**

```typescript
// frontend/src/lib/api/manualDeload.ts
import { apiFetch } from './apiFetch';

export async function triggerManualDeload(runId: string): Promise<{ removed_planned_sets: number; affected_planned_sets: number; triggered_at: string }> {
  const res = await apiFetch(`/api/mesocycles/${runId}/deload-now`, { method: 'POST' });
  if (!res.ok) throw new Error(`manual_deload_failed_${res.status}`);
  return res.json();
}

export async function undoManualDeload(runId: string): Promise<{ reversed_at: string }> {
  const res = await apiFetch(`/api/mesocycles/${runId}/deload-now/undo`, { method: 'POST' });
  if (!res.ok) throw new Error(`manual_deload_undo_failed_${res.status}`);
  return res.json();
}
```

- [ ] **Step 5.4.2: Write the button + sheet (sheet-handover pattern per I-DELOAD-A11Y)**

Per panel finding I-DELOAD-A11Y: inline state-shift is inconsistent with W3 conventions. Use the same button → sheet handover that W3's `MidSessionSwapPicker` uses to open `MidSessionSwapSheet`. Two separate components:

- `DeloadThisWeekButton.tsx` — a single button labeled "Deload this week". Clicking opens `DeloadThisWeekSheet`.
- `DeloadThisWeekSheet.tsx` — a confirm sheet with full a11y baseline (matching W3 sheet). Shows:
  - Plain-language summary: "Deload remaining weeks: reduce sets to ~half of MAV, pin RIR to 4. Undoable for 24h."
  - Term-wrapped: `<Term k="manual_deload" />`, `<Term k="MAV" />`, `<Term k="RIR" />`, `<Term k="mesocycle" />`.
  - "Confirm deload" + "Cancel" buttons.

Confirm flow:
- Confirm: calls `triggerManualDeload(runId)`, closes the sheet.
- Success toast: "Deload applied. Sets reduced (≈half of MAV), RIR pinned to 4. Undo within 24h from Today."
- Toast carries an "Undo" action button calling `undoManualDeload`.

The sheet uses `zIndex: TOKENS.zModal.zSheet` (panel C-Z). Mount path: desktop (MyProgramPage) and mobile (TodayPage Today card overflow), per `project_device_split.md`.

- [ ] **Step 5.4.3: Surface reversal in MesocycleRecap**

Per master plan W2.6: "Reversal surfaced in MesocycleRecap." Add a row to the recap showing "Manual deload applied at <date>" with an "Undo" link if the recap is being viewed within 24h of the event. Use the `mesocycle_run_events` row of type `'manual_deload'` (this requires either a new `/api/mesocycles/:id/events` route or extending the existing `/api/mesocycles/:id/recap-stats` to include the manual_deload row). Add to recap-stats route in this same task.

- [ ] **Step 5.4.4: Write component tests**

Use Testing Library to assert two-step confirm, success toast, undo action.

- [ ] **Step 5.4.5: Mount on MyProgramPage + TodayPage**

`DeloadThisWeekButton` mounts under the active run's "actions" section. On TodayPage, behind the existing action menu pattern (matches mid-session swap UX).

- [ ] **Step 5.4.6: Run + commit**

```bash
cd frontend && npm run test -- src/components/programs/__tests__/DeloadThisWeekButton.test.tsx
git add frontend/src/components/programs/DeloadThisWeekButton.tsx frontend/src/lib/api/manualDeload.ts frontend/src/pages/MyProgramPage.tsx frontend/src/pages/TodayPage.tsx frontend/src/components/programs/MesocycleRecap.tsx frontend/src/components/programs/__tests__/DeloadThisWeekButton.test.tsx
git commit -m "feat: Deload this week button (two-step confirm) + recap reversal surface (W2.6)"
```

### Task 5.5 — Settings → Health page + sidebar entry (feature-flagged Program prefs)

**Files:**
- Create: `frontend/src/pages/SettingsHealthPage.tsx`
- Create: `frontend/src/lib/featureFlags.ts` (if not present)
- Modify: `frontend/src/components/layout/Sidebar.tsx`
- Modify: `frontend/src/App.tsx`

**NOT created in W2:**
- `frontend/src/pages/SettingsProgramPrefsPage.tsx` — W4.3 owns. Per panel finding I-PROGRAM-PREFS-STUB, W2 does NOT ship a "coming soon" placeholder. The sidebar entry for "Program prefs" is feature-flagged behind `BETA_LANDMARKS_EDITOR` which W4.3 flips to `true` on landing. Until then, no entry, no page, no dead link.

- [ ] **Step 5.5.1: Write `SettingsHealthPage.tsx`**

Surface for PAR-Q re-review + advisory-mode management:
- Current PAR-Q version + last acknowledged version + last acknowledged date.
- "Re-review PAR-Q" button — opens `ParQGate` in re-review mode (force-show even if `needs_prompt=false`).
- **If `par_q_advisory_active === true`:** show a banner explaining the current mode in plain language, plus a **"Mark cleared"** affordance (button) that POSTs to `/api/me/par-q/mark-cleared`. Copy: "You\'re in advisory mode (volume capped at MEV with RIR 3). If you\'ve spoken with a clinician and they\'ve cleared you, click below to resume normal progression."
- Past acknowledgments table (read-only, queries `par_q_acknowledgments` via a new `GET /api/me/par-q/history` route OR is read from the same `/api/me` payload).

Term-wrap `<Term k="PAR_Q" />`, `<Term k="soft_gate" />`, `<Term k="advisory_mode" />`, `<Term k="MEV" />`, `<Term k="RIR" />`.

- [ ] **Step 5.5.2: Add the feature flag**

`frontend/src/lib/featureFlags.ts`:

```typescript
// Beta feature flags. Flip the BETA_LANDMARKS_EDITOR flag in W4.3 when
// the landmarks editor lands. Until then, /settings/program-prefs is
// neither linked nor routed.
export const FEATURE_FLAGS = {
  BETA_LANDMARKS_EDITOR: false,  // W4.3 flips to true
} as const;
```

- [ ] **Step 5.5.3: Sidebar — consume W6 SETTINGS_SECTIONS; feature-flag Program prefs**

Per panel finding I-PROGRAM-PREFS-STUB. W6 owns the authoritative ordering and exports the `SETTINGS_SECTIONS` const. W2 registers only `Health`; `Program prefs` is gated:

```tsx
// frontend/src/components/layout/Sidebar.tsx (excerpt)
import { SETTINGS_SECTIONS } from './settingsSections';  // W6-owned export
import { FEATURE_FLAGS } from '../../lib/featureFlags';

// Build a derived list that includes/excludes the gated entries.
const visibleSettings = SETTINGS_SECTIONS.filter(s => {
  if (s.id === 'program-prefs') return FEATURE_FLAGS.BETA_LANDMARKS_EDITOR;
  return true;
});
```

`SETTINGS_SECTIONS` is owned by W6; W2 contributes nothing to that array's shape — it's a read-only consumer. Until W6 ships, the project's existing `Sidebar.tsx` may not yet export the W6 shape; in that case, W2's Sidebar edit is the minimum required to register the `Health` entry, leaving `Program prefs` un-registered. Once W6 lands, the entry list is owned there.

- [ ] **Step 5.5.4: Register route in App.tsx**

```tsx
<Route path="settings/health" element={<SettingsHealthPage />} />
{/* /settings/program-prefs is NOT registered in W2; W4.3 adds it. */}
```

- [ ] **Step 5.5.5: Smoke test reachability**

Use the existing `frontend/src/components/__smoke__/navigation.smoke.test.tsx` pattern. Assert clicking Settings → Health lands on the new page. Assert "Program prefs" entry is NOT visible when `FEATURE_FLAGS.BETA_LANDMARKS_EDITOR === false`.

- [ ] **Step 5.5.6: Run + commit**

```bash
cd frontend && npm run test
git add frontend/src/pages/SettingsHealthPage.tsx frontend/src/lib/featureFlags.ts frontend/src/components/layout/Sidebar.tsx frontend/src/App.tsx frontend/src/components/__smoke__/
git commit -m "feat: Settings → Health page + BETA_LANDMARKS_EDITOR feature flag (W2)"
```

### Task 5.6 — Phase 5 verification + reviewer panel

- [ ] **Step 5.6.1: Run full frontend test suite**

Run: `cd frontend && npm run test && npm run typecheck && npm run build`
Expected: all green.

- [ ] **Step 5.6.2: Dispatch Phase 5 reviewer panel**

Reviewer focus: responsive overlay rendering on mobile + desktop; PAR-Q soft-gate copy accuracy; two-step confirm pattern matches W3's medium-tier convention; Term wrappers on every new term-of-art; the Sidebar coordination handoff to W6. Specialists: frontend + clinical + UX.

---

## Phase 6 — Wave acceptance: reachability + tooltips + dashboard fix

### Task 6.1 — Reachability documentation

**Files:**
- Modify: `docs/qa/beta-reachability.md`

- [ ] **Step 6.1.1: Append W2 section to the reachability doc**

```markdown
## W2 — Onboarding + clinical safety

| Surface | Path from `/` | Click count |
|---|---|---|
| OnboardingOverlay (5-step responsive wizard, AppShell-mounted overlay) | `/` (renders on first sign-in when `onboarding_completed_at IS NULL`; not URL-addressable) | **0 clicks** (modal on `/`) ✓ |
| PAR-Q gate (9-question soft-gate, AppShell-mounted overlay) | `/` (renders on first sign-in after onboarding when `par_q_version < PAR_Q_VERSION`) | **0 clicks** (modal on `/`) ✓ |
| `/settings/health` — Re-review PAR-Q + view ack history + "Mark cleared" | `/` → "Settings" nav → "Health" sub-nav | **2 clicks** ✓ |
| Deload this week (desktop, MyProgramPage) | `/` → "Programs" nav → "My program" → "Deload this week" button → sheet | **3 clicks** ✓ |
| Deload this week (mobile, TodayPage overflow menu) | `/` → Today card "⋯" menu → "Deload this week" → sheet | **2 clicks** ✓ |
| Manual deload undo | `/` → Today (within 24h banner) OR MesocycleRecap "Undo" link | **1-2 clicks** ✓ |

**Deferred surfaces (not counted against W2 G7):**

- `/settings/program-prefs` — W4.3 owns; sidebar entry is feature-flagged off (`BETA_LANDMARKS_EDITOR=false`) in W2.

### Source-of-truth selectors

- OnboardingOverlay: `aria-labelledby="onboarding-title"` + "ONBOARDING · STEP X / 5" header. Test selector pinned in `tests/e2e/w2-onboarding-flow.spec.ts`.
- PAR-Q gate: `role="dialog"` with question list under `data-testid="parq-questions"` and joint picker under `data-testid="parq-q5-joints"`.
- "Deload this week" button: `aria-label="Deload this week"` on `DeloadThisWeekButton`. Confirm sheet has `role="dialog"` with `aria-label="Confirm deload"`.

### G7 status for W2

Six surfaces are reachable inside the 3-click budget. **G7 ✓ for W2.**
```

- [ ] **Step 6.1.2: Verify the click-paths in the real UI**

Run `cd frontend && npm run dev` and walk every path listed. (Manual; not script-able in this plan.) Confirm each path is real before committing.

- [ ] **Step 6.1.3: Commit**

```bash
git add docs/qa/beta-reachability.md
git commit -m "docs: W2 reachability audit — 6 surfaces ≤3 clicks (G7)"
```

### Task 6.2 — Term coverage check

**Files:**
- Verify (no edits if green): `scripts/check-term-coverage.cjs`

- [ ] **Step 6.2.1: Run coverage check**

Run: `node scripts/check-term-coverage.cjs frontend/src/components/onboarding frontend/src/pages/SettingsHealthPage.tsx frontend/src/pages/SettingsProgramPrefsPage.tsx frontend/src/components/programs/DeloadThisWeekButton.tsx`
Expected: green; if any term-of-art is missing a `<Term>` wrapper, the script reports the file:line. Fix inline.

- [ ] **Step 6.2.2: Commit if any edits made**

Per memory `feedback_ship_clean.md`: Critical + Important findings get fixed inline.

```bash
git add frontend/src/...
git commit -m "fix: add missing Term wrappers per coverage check (W2)"
```

### Task 6.3 — Playwright e2e

**Files:**
- Create: `tests/e2e/w2-onboarding-flow.spec.ts`
- Create: `tests/e2e/w2-par-q-reprompt.spec.ts`
- Create: `tests/e2e/w2-deload-this-week.spec.ts`

- [ ] **Step 6.3.1: Write `w2-onboarding-flow.spec.ts`**

Full happy path: new user signs in → onboarding overlay → walk all 5 steps → PAR-Q gate (all No) → land on `/` with Today card visible. Asserts:
- Each step is visible by its `ONBOARDING · STEP X / 5` header.
- The Skip buttons advance steps 2-4.
- After ReadyStep → onboarding overlay is gone.
- PAR-Q gate renders; submit; PAR-Q gate is gone.
- `users.onboarding_completed_at` and `users.par_q_acknowledged_at` are non-null.

- [ ] **Step 6.3.2: Write `w2-par-q-reprompt.spec.ts`**

Already-onboarded user → POST `/api/me/par-q` with the seed-script tool that bumps `PAR_Q_VERSION` (or seeds the user with `par_q_version=0` artificially). Reload `/`. PAR-Q gate re-prompts. Submit. Prior `par_q_acknowledgments` row preserved (assert via DB query in afterEach).

- [ ] **Step 6.3.3: Write `w2-deload-this-week.spec.ts`**

Logged-in user with active mesocycle → MyProgramPage → "Deload this week" button → first click shows confirm state → second click POSTs → success toast appears → "Undo" link in toast undoes. Asserts the planned_sets count drop + restore via DB.

- [ ] **Step 6.3.4: Run e2e suite**

Run: `cd frontend && npx playwright test tests/e2e/w2-*.spec.ts`
Expected: PASS.

- [ ] **Step 6.3.5: Commit**

```bash
git add tests/e2e/w2-onboarding-flow.spec.ts tests/e2e/w2-par-q-reprompt.spec.ts tests/e2e/w2-deload-this-week.spec.ts
git commit -m "test: W2 e2e — onboarding flow, PAR-Q reprompt, deload-this-week (G3 contributions)"
```

### Task 6.4 — Dashboard doc-drift fix

**Files:**
- Modify: `docs/superpowers/goals/beta.md`

- [ ] **Step 6.4.1: Fix the W1.5 e2e reference**

The dashboard's "Active risks" table row references `tests/e2e/w3-shape-signal.spec.ts` which does NOT exist. The actual contract test is `api/tests/integration/set-logs-volume-rollup.test.ts`. Update the reference, and update the W1.5 status note to match what actually shipped (W1.5 lists `tests/e2e/w3-shape-signal.spec.ts` in the row `[x] W1.5 — e2e Playwright (W3-shape signal + volume rollup invariant)`).

Edit the relevant rows; do NOT change the W1.5 done status (W1.5 *is* done — the issue is the file name in the dashboard).

```markdown
[x] W1.5 — e2e Playwright (W3-shape signal at api/tests/integration/set-logs-volume-rollup.test.ts + volume rollup invariant)
```

And in the risk row:

```markdown
... The W1.5 contract test (`api/tests/integration/set-logs-volume-rollup.test.ts`) pins the shape contract ...
```

- [ ] **Step 6.4.2: Commit**

```bash
git add docs/superpowers/goals/beta.md
git commit -m "docs: fix W1.5 e2e path drift in dashboard (file lives in api/tests/integration/)"
```

### Cardio first-class (deferred to W7+)

Per user decision D5 (2026-05-26) and memory `feedback_cardio_first_class.md` (cardio is equal-weight to strength), W2 ships strength-only. The deferral is intentional and documented:

| Surface | W2 posture | W7+ uplift |
|---------|------------|------------|
| Onboarding `GoalStep` | Enum stays `cut / maintain / bulk` — no cardio-capacity option | Adds `endurance_zone2` / `vo2max` / `mixed` cardio goals |
| Manual mid-meso deload | Strength `planned_sets` only; `planned_cardio_blocks` untouched | Reduces cardio blocks proportionally on same trigger |
| Settings → Program prefs (landmarks editor) | Strength muscle landmarks only (and gated off in W2) | Adds zone-2 / VO2max cardio "landmarks" |

This is **scoping**, not deprioritization. The full cardio surface uplift is tracked as a single coordinated W7+ item — see memory `reference_w3_tuning_candidates.md` row 13. W7+ planning must treat these three surfaces as one item, not three independent ones, because they share a common conceptual change (cardio capacity as a first-class goal/landmark).

W2 phases must NOT silently drop cardio. The deferral is explicit in:
- `api/src/schemas/onboarding.ts` — comment in `OnboardingCompleteRequestSchema`.
- This plan section.
- `reference_w3_tuning_candidates.md` row 13.

### Task 6.5 — Final wave verification + reviewer panel

- [ ] **Step 6.5.1: Run the full test surface**

Run:
```bash
cd api && npm run typecheck && npm run test && npm run test:integration
cd frontend && npm run typecheck && npm run test && npm run build
cd ../tests && npx playwright test
```
Expected: ALL GREEN.

- [ ] **Step 6.5.2: Dispatch wave-final reviewer panel**

Per memory `feedback_get_plan_reviewed.md` + `feedback_ship_clean.md`: dispatch backend / frontend / clinical / security in parallel. Critical + Important findings fixed inline before declaring W2 done.

- [ ] **Step 6.5.3: Final acceptance check against master plan**

Walk the master plan W2 acceptance bullets (§271-§277). Confirm each is verifiable:
- New user signs in → PAR-Q gate → onboarding → first program → first workout reaches W1.3 live logger.
- PAR-Q "yes" answer shows soft-gate but does NOT prevent app use.
- PAR-Q version bump in DB re-prompts on next page load; prior acks preserved in `par_q_acknowledgments`.
- Alpha-tester can deload mid-meso with two-step confirm; reversal works within 24h; not past 24h.
- Curated programs have core blocks; existing forked alpha programs NOT silently mutated.

---

## Acceptance gates summary

This wave contributes to **G7** (reachability), **G11** (Critical + Important fixed inline, no v1.5 deferrals), **G14** (PAR-Q sign-off requirement for first cohort).

| Gate | What this wave contributes |
|------|----------------------------|
| G7 | 6 new surfaces, all documented in `docs/qa/beta-reachability.md` per the W3 format, all ≤3 clicks |
| G11 | All reviewer-panel Critical + Important fixed inline per `feedback_ship_clean.md` |
| G14 | `par_q_acknowledgments` table + `PAR_Q_VERSION=1` constant + the audit-preserving flow that lets every first-cohort user have a signed acknowledgment row before cutover |

Per memory `feedback_user_reachability_dod.md`: this wave is **NOT done** until a logged-in user (in a fresh browser session) can:
1. Sign in fresh and see the OnboardingOverlay.
2. Walk it 5 steps to completion.
3. See the PAR-Q gate.
4. Submit it (with a sample Yes answer on Q5 + joint selection, to verify `user_injuries` rows are written).
5. Land on `/` with the Today card visible.
6. Navigate to Settings → Health → re-review PAR-Q.
7. Click "Mark cleared" on Settings → Health (advisory mode resolves).
8. Click "Deload this week" on MyProgramPage → confirm in sheet → see toast.
9. Click Undo within 24h; confirm planned_sets restored.

`/settings/program-prefs` is NOT in W2's DoD — it lands in W4.3.

Each of these click-paths is documented in `docs/qa/beta-reachability.md` and exercised by `tests/e2e/w2-*.spec.ts`.

---

## Risks + open questions (for the reviewer panel)

The reviewer panel should weigh in on the following before merge.

### Clinical risks

1. **PAR-Q questions are the simplified PAR-Q+ 2014 set with Q7 wording fix + Q9 chronic addition.** Q7 was widened from "6 weeks" to "6 months" (panel I-Q7-COPY); Q9 added for chronic conditions (diabetes/asthma/heart/kidney/COPD) (panel I-Q9-ADD). Net 9 questions. Clinical reviewer: confirm this question set is acceptable for Beta. If further changes are needed, bump PAR_Q_VERSION to 3 and add the questions.

2. **`any_yes=true` flips `users.par_q_advisory_active=true` (user decision D2).** Downstream features will consume this flag: W3 stalledPr evaluator and W4 landmarks editor cap volume at MEV and floor RIR to 3 when `true`. W2 publishes the contract; W3/W4 implement the cap. The Settings → Health page provides a "Mark cleared" affordance for the user to flip the flag back to false once they've cleared it with a clinician. **No longer a risk — this is the resolved posture.**

3. **Manual deload uses `floor(MAV * 0.5)` + RIR=4 (user decision D3).** Constants live in `api/src/services/_deloadConstants.ts` (`MANUAL_DELOAD_MAV_FACTOR = 0.5`, `MANUAL_DELOAD_RIR = 4`). The v1 draft's `floor(target_sets * 0.6)` + RIR=3 was rejected because (a) target_sets is a poor anchor when blocks are heterogeneous and (b) RIR=4 is the more conservative pin for clinical safety. W4's full deload-meso consumes the same constants. **No longer a risk — this is the resolved posture.**

### Backend risks

4. **`ALTER TYPE ADD VALUE IF NOT EXISTS` in a transaction on PG 16** — PG 12+ relaxed the restriction, but the version + migrate.ts BEGIN/COMMIT wrapping should be explicitly confirmed against the production Postgres. If migrate.ts fails to apply 037, the workaround is to drop IF NOT EXISTS guards into a separate sql block that the runner executes outside-transaction (precedent: investigate `api/src/db/migrate.ts` for such an escape).

5. **`day_workouts.is_deload` backfill scope** — migration 036 backfills based on `mesocycle_runs.weeks` matching `day_workouts.week_idx`. Two concerns: (a) any `mesocycle_runs` row with NULL `weeks` (defensive — should not exist, but check); (b) cardio-day rows in the final week — they ALSO get `is_deload=true`. This matches the intent (the whole week deloads, cardio + strength alike). Confirm with backend reviewer.

6. **Snapshot payload size in `mesocycle_run_events`** — a 5-week meso with 4 days/week × 4 blocks/day × 5 sets = 400 planned_sets rows. The snapshot JSON is ~80 KB. `mesocycle_run_events.payload JSONB` has no explicit size limit but the table will balloon if every alpha tester deloads weekly. Possible mitigation: store only the IDs + a sentinel, regenerate on undo via `materializeMesocycle`. Defer this optimization until alpha-cohort telemetry shows it matters (~50+ deloads, ~4 MB total). Flag for backend reviewer.

### Frontend risks

7. **OnboardingOverlay + ParQGate stacking** — **resolved.** Per panel C-MOUNT both overlays mount INSIDE `<AppShell>` (sibling of `<Outlet>`) via a single derived state machine that returns `OnboardingOverlay` OR `ParQGate` OR `null` — never both. Sequence is unambiguous: if `!onboarding_completed_at` render OnboardingOverlay; else if `par_q_version < current` render ParQGate. No flash-of-PAR-Q.

8. **MesocycleRecap "Undo" surface** — added in Task 5.4.3 but reads from a route extension to `/api/mesocycles/:id/recap-stats`. If that route extension is incomplete or W4/W5 also extends it, there could be a merge conflict. Confirm with W4/W5 wave plans before this wave merges.

### Security risks

9. **PAR-Q POST rate-limit** — **resolved.** Per panel I-RATE-LIMIT, a per-user 5-writes/24h rate limit is enforced in the POST handler via `checkParQWriteRateLimit(userId)`. nginx's `binary_remote_addr` zone is insufficient because CF Tunnel collapses all egress to one IP. The per-user check uses `par_q_acknowledgments.accepted_at` count as the audit signal — the table itself IS the rate-limit ledger. 429 returned over the limit.

10. **PAR-Q audit responses are server-pinned** — **resolved.** The route builds `responses = { questions: PAR_Q_QUESTIONS, answers: parsed.data.answers }` using server-side constants only. Client cannot inject the questions array. The JSONB CHECK constraint in migration 035 further validates shape at write-time.

11. **Scope posture** — **resolved.** Per panel C-SCOPE, the three state-changing routes (PAR-Q POST, onboarding-complete POST, deload-now POST + /undo) are gated on `requireScope('account:write')`. Default-minted bearer tokens lack this scope; CF Access browser path bypasses scope checks (the intended UI path).

### Cross-wave coordination open questions

12. **Settings sidebar ordering** — **resolved.** Per panel I-PROGRAM-PREFS-STUB, W6 owns `SETTINGS_SECTIONS`. W2 consumes it read-only and contributes only `Health`. `Program prefs` is feature-flagged off until W4.3.

13. **Documentation drift** — fixed in Task 6.4. The dashboard claims `tests/e2e/w3-shape-signal.spec.ts` exists; it does not. The actual W1.5 contract test is `api/tests/integration/set-logs-volume-rollup.test.ts`. The parity test in Phase 2 uses the new golden-fixture file (`api/tests/fixtures/stalledPrEvaluator-pre-swap-golden.json`) captured at HEAD `d5110bc`, not the W1.5 volume-rollup test (which is single-week and can't prove parity).

14. **W4 landmarks editor coordination** — `/settings/program-prefs` is NOT shipped in W2 (panel I-PROGRAM-PREFS-STUB). W4.3 owns the page; W4.3 also flips `FEATURE_FLAGS.BETA_LANDMARKS_EDITOR=true` to make the sidebar entry visible. W4 plan must add `/settings/program-prefs` route + entry.

15. **W4 `movement_pattern` enum migration** — **resolved.** Per panel I-CORE-PATTERNS, the `spinal_flexion` + `anti_extension` enum values land in W2's migration 040 (not W4). W4 must drop its previous claim on the 040 slot and reference W2's enum extension by name.

---

## Self-review

**Spec coverage check (master plan §251 vs this plan, plus user decisions D1/D2/D3/D5/D8 and panel findings):**

| Master plan bullet | Phase / Task | Status |
|--------------------|--------------|--------|
| W2.1 — users table additions (incl. `par_q_advisory_active` per D2) | Phase 1, Tasks 1.1, 1.2, 1.3 | covered (migrations 034 + 035) |
| W2.1 — par_q_acknowledgments (incl. JSONB CHECK + `ip` column per I-MIG-035) | Phase 1, Task 1.2 | covered (migration 035) |
| W2.2 — Onboarding 5-step flow (skip-path deep link per I-PROGRAMSTEP-SKIP; cardio-deferral comment per D5) | Phase 5, Task 5.2 | covered |
| W2.3 — PAR-Q-lite 9-item screen (Q7 wording + Q9 chronic per I-Q7/I-Q9; Q5 joint follow-up per D1) | Phase 1 Task 1.4 + Phase 5 Task 5.3 | covered |
| W2.3 — re-prompt on version bump | Phase 1 Task 1.4 | covered |
| W2.3 — advisory_active mode (D2) | Phase 1 Task 1.4 + 1.5b + Phase 5 Task 5.5 | covered |
| W2.4 — core/abs taxonomy seed | Phase 3, Tasks 3.1, 3.2 | covered (migration 038 + 7 exercises) |
| W2.4 — append core blocks to curated programs (alpha-fork preservation real test per I-CURATED-FORK-TEST) | Phase 3, Task 3.3 | covered |
| W2.4 — movement_pattern enum extension (per I-CORE-PATTERNS) | Phase 3, Task 3.4b | covered (migration 040) |
| W2.5 — manual mid-mesocycle deload (formula per D3: floor(MAV*0.5) + RIR=4) | Phase 4, Tasks 4.0, 4.1 | covered |
| W2.5 — reversal route | Phase 4, Task 4.2 | covered |
| W2.5 — boundary tests | Phase 4 Task 4.1 test 2 | covered |
| W2.6 — Deload this week button (sheet pattern per I-DELOAD-A11Y) | Phase 5, Task 5.4 | covered |
| W2.6 — Reversal surfaced in MesocycleRecap | Phase 5, Task 5.4.3 | covered |
| Cross-wave: stalledPrEvaluator swap (golden-fixture parity per C-STALLEDPR-PARITY) | Phase 2, Task 2.4 | covered |
| Cross-wave: Settings sidebar (W6-consumed; Program prefs gated per I-PROGRAM-PREFS-STUB) | Phase 5, Task 5.5 | covered |
| Cross-wave: account_events emission (D8) | Phase 1 Tasks 1.0+1.4+1.5 | covered |
| Cross-wave: scope `account:write` (C-SCOPE) | Phase 1 Task 1.0 | covered |
| Cross-wave: modal z-stack tokens (C-Z) | Phase 5 Task 5.1 | covered |
| Cross-wave: AppShell mount + state machine (C-MOUNT) | Phase 5 Task 5.2.5 | covered |
| Cross-wave: route mount path /api/me (C-MOUNT-PATH) | Phase 1 Tasks 1.4, 1.5 | covered |
| Cross-wave: cardio deferred to W7+ (D5) | Phase 6 §"Cardio first-class (deferred)" + reference_w3 row 13 | covered |
| Overlay a11y baseline (C-A11Y) | Phase 5 Tasks 5.2, 5.3 | covered (3 tests each) |
| Per-user PAR-Q rate-limit (I-RATE-LIMIT) | Phase 1 Task 1.0 + 1.4 | covered |
| G7 reachability docs | Phase 6, Task 6.1 | covered |
| G11 ship-clean | Phase 6, Task 6.5 | covered |
| G14 PAR-Q sign-off | Phase 1 | covered |
| W8.2 contamination matrix per new route (incl. undo per I-CONTAM) | Phase 1 Task 1.6 + Phase 4 Task 4.3 | covered |

**Placeholder scan:** searched for "TBD", "TODO", "fill in", "appropriate error handling", "similar to". None remain in the plan.

**Type consistency:** `applyManualDeload` returns the same shape consumed by `mesocyclesDeloadRoutes`; `ParQStatus` returned by `getParQStatus` matches `ParQStatusResponseSchema` from `api/src/schemas/parQ.ts`. Reviewed.

---

*End of plan. Six phases, seven migrations (034–040 inclusive), thirteen new integration tests (incl. Q5 follow-up + advisory mode + undo contamination + spinal-flexion seeded + golden-fixture parity + manual-deload-undo contamination + a11y overlays), three e2e specs, five new user-facing surfaces (program-prefs deferred to W4.3) all reachable ≤3 clicks from `/`. Ready for reviewer-panel dispatch per phase.*
