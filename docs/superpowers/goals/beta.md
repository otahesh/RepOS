# RepOS Beta — Goal Condition

> Operating dashboard for the alpha→Beta transition. Source-of-truth for *what's true right now*; the master plan is `docs/superpowers/plans/2026-05-11-repos-beta.md`. When this file conflicts with the master plan, the master plan wins — correct this file.

**Last updated:** 2026-07-13 (Measurement-model wave shipped off-plan 2026-07-12 — PRs #61–#66 merged + deployed, prod now on `bddfdce`, smoke green, MESO run undisturbed. Nightly backups: 3 consecutive green since the 07-11 flake. Prior entry follows.) (**MILESTONE 1 EXECUTED — Beta cutover complete. All G1–G15 green.** G14 closed by building the missing first-run Beta disclaimer (PR #58, surfaced + acked live) on top of the verified PAR-Q row and documented contact path; G15 closed with exit-criteria review + weekly cadence (review #1 recorded in PASSDOWN; operator adds the recurring calendar entry). Cutover sign-off + post-cutover scaling plan (N=1 → N=5 → N=10) in PASSDOWN. Prod on `bc026fc`, healthy, smoke green. **Next: Milestone 2 — the alpha tester completes one full mesocycle end-to-end on production with no Sev-1 (~4 training weeks). Weekly Beta reviews each Friday.**)
---

## Done predicate (the actual goal condition)

Beta is **fully operational** when **both milestones** below are satisfied. Milestone 1 authorizes cohort cutover; Milestone 2 proves the product actually delivers usable results.

### Milestone 1 — Beta cutover authorized

1. **G1–G15 are all green** (see burndown below; each gate is binary, no partial credit).
2. **Cutover executed** — CF Access default-on in production, alpha data wiped per the split-cutover SQL (weight history preserved), the alpha tester (jmeyer) is CF-Access-provisioned with a signed PAR-Q-lite acknowledgment, and the post-cutover scaling plan is documented in PASSDOWN (N=1 first 48h → N=5 mid-week-1 → N=10 EOW1, per master-plan risk row). Growing the cohort past N=1 is operational follow-through, not a cutover precondition.

### Milestone 2 — Alpha-tester usable-results proof

3. **One full mesocycle completed end-to-end through production.** Alpha tester runs a full mesocycle (typically 4 training weeks ending in a deload week) on `https://repos.jpmtech.com` using the production live logger. Every planned set logged. Weekly volume rollup + recovery flags surfaced when triggered. MesocycleRecap renders with usable end-of-meso results (set/rep/weight trend per exercise, PR list, volume-vs-landmarks). **No Sev-1 fired in the mesocycle window.**

Until Milestone 2 lands the system is "Beta-launched" but not "Beta-validated." Per memory `feedback_user_reachability_dod.md`, tests green ≠ shipped.

**Out of scope for this goal:** the master-plan G15 "5 users completed a full mesocycle AND submitted feedback" exit criterion is the **GA-readiness** signal, not the Beta-operational signal. That's a separate, later milestone (likely months out) and not in this doc's done-predicate.

---

## Status snapshot

```
[x] W0 — Auth flip + cutover (merged PR #11)
[x] W1 — Live data foundation (merged to main at 2ce4c82)
    [x] W1.1 — set_logs schema + migration 029
    [x] W1.2 — set-logs CRUD (POST/PATCH/DELETE/GET) with 24h audit window + IDOR tests
    [x] W1.4 — health_workouts table + ingest + iOS Shortcuts runbook
        [x] W1.4.0 scope-enforcement middleware (backported)
    [x] W1.3 — TodayLoggerMobile + offline foundation
        [x] W1.3.1 idbQueue (Dexie wrapper)
        [x] W1.3.2 logBuffer (flush + exponential backoff)
        [x] W1.3.3 useNetworkState + useRestTimer hooks
        [x] W1.3.4 TodayLoggerMobile component + /today/:runId/log route + useIdbQueueStatus
        [x] W1.3.5 LogBufferRecovery banner + useIdbQueueCounts hook
        [x] W1.3.6 O1–O8 offline Playwright matrix + companion specs
        [x] W1.3.7 SessionExpiredBanner + auth-state purge + CF-Access expiry
        [x] W1.3.8 /settings/storage clear-rejected page
        [x] W1.3.9 typecheck + tests final sweep
    [x] W1.5 — e2e Playwright (W3-shape signal + volume rollup invariant)
[x] W2 — Onboarding + clinical safety (PAR-Q, deload, core) — integrated (stacked PR → main)
[x] W3 — Clinical signals + injury swap (merged to main at 0d5a2cd)
    [x] W3.1 — Recovery flag evaluators (overreaching + stalled-PR) + recovery_flag_events telemetry
    [x] W3.2 — injuryRanker + applyInjuryAdvisory wired into substitutions
    [x] W3.3 — Mid-session swap UI (BlockOverflowMenu + MidSessionSwapPicker → MidSessionSwapSheet)
    [x] W3.4 — Injury chips Settings (InjuryChipsEditor + /settings/injuries + Settings nav link)
    [x] W3 reviewer matrix (backend/frontend/clinical/security) — 2 Critical + 7 Important fixed inline; 5 Important deferred per [[reference_w3_tuning_candidates]]
[x] W4 — Desktop authoring + landmarks editor — integrated (stacked PR → main)
[x] W5 — Backups + restore UI (maintenance-mode) — integrated (stacked PR → main)
[x] W6 — Account ops + sign-out-everywhere (merged PR #12 at dc4a059)
[x] W7 — In-app feedback loop — merged (PR #20); G12 `[~]` pending prod smoke
[x] W8 — Beta entry gates (build-now) — merged to `main` (PR #22 @ `e4765e1`); W8.5 branch protection + G1 done; cutover-window gates remain
─── MILESTONE 1 (Beta cutover authorized) ───
[x] CUT — Executed 2026-07-11 (sign-off in PASSDOWN)
─── MILESTONE 2 (alpha-tester usable-results proof) ───
[~] MESO — IN FLIGHT since 2026-07-11 — alpha tester's active run continues on prod
```

Legend: `[x]` done, `[~]` in-flight, `[ ]` not started.

---

## G1–G15 burndown

| Gate | Predicate (one line; verbatim summary) | Status | Blocking wave(s) | Verification |
|------|----------------------------------------|--------|------------------|--------------|
| **G1** | CI has api-unit + api-integration + frontend-unit + typecheck + build as required checks; deliberate-break PR confirmed gate blocks merge. | `[x]` (W8.5: `main` branch protection requires all 8 checks (typecheck-api, build-frontend, validate-frontend, e2e-frontend, api-unit, api-integration, placeholder-guard, migration-gate) — strict + `enforce_admins` + linear history + 0-approval PR-gate; deliberate-break PR #23 with a failing `api-unit` was merge-blocked — API merge → `405 Required status check "api-unit" is failing` — then closed) | W8.1 ✓ / W8.5 ✓ | branch-protection JSON (`gh api repos/otahesh/RepOS/branches/main/protection`) + closed PR #23 |
| **G2** | Every per-user route has a contamination integration test asserting 404/403 (never 200-with-other-user-data); matrix ≥35 routes; `mkUserPair()` fixture exists. | `[x]` (W8/PR #22: `CONTAMINATION-MATRIX.md` reconciled against all 67 route handlers — every per-user/admin route COVERED or N/A, zero GAP; 9 new/extended `*-contamination.test.ts`; cross-user attempts → 404/empty/own-only asserted with no-mutation + row-count checks) | W8.2 ✓ | `api/tests/integration/contamination/` |
| **G3** | Playwright suite covers (a) unauth→CF Access, (b) signed-in→`/`, (c) sign-out clears, (d) sign-out-everywhere revokes bearers, (e) expired JWT mid-set-log buffers + recovers, (f) bearer mint→use→revoke→401. Run against prod CF Access topology in pre-cutover window. | `[x]` (2026-07-11 browser block against prod: (a)(b)(c)(d) verified live incl. golden-journey set-log 201 via mobile logger; overreaching advisory rendered + dismissed live (UI shipped PR #51 — it had never been built); sign-out-everywhere fixed (PR #54) then verified end-to-end; (f) verified 2026-07-10; (e) covered by CI e2e + W1.3 offline suite) | done | PASSDOWN §browser block + `frontend/playwright/` |
| **G4** | All 8 offline scenarios O1–O8 pass with Playwright + IndexedDB inspection; zero silent set loss on O1/O2/O4/O5/O8. | `[x]` | — | `frontend/src/components/programs/__offline__/` (W1.3.6) |
| **G5** | Manual backup → sidecar JSON; `gunzip\|pg_restore -l` integrity check; `tests/dr/restore-into-ephemeral.sh` green; 4 restore tests pass (happy / crash-mid-restore / sigterm-drain / migration-failure-rollback); DR dry-fire within 7 days of cutover. | `[x]` (2026-07-11 on-prod rehearsal GREEN: fresh backup → typed-RESTORE → banner ≤5s → restore ok in 4s → clear → smoke 201 → device_tokens wiped → Shortcut re-minted. First attempt RED exposed that the restore had NEVER been executable in prod (scripts-path mismatch, fixed PR #56). Timestamps in PASSDOWN) | done | PASSDOWN §DR dry-fire 2026-07-11 + `tests/dr/last-run.txt` |
| **G6** | Every post-alpha migration is two-step destructive (Step 2 in next migration); every Step-2 PR links a successful dry-run; most recent migration rehearsed forward→restore→reapply with zero data loss. | `[x]` (W8/PR #22: `check-migration-dryrun.sh` D10 gate + `migration-gate` CI job live + self-tested — destructive migrations without a `Dry-run:` link are blocked going forward) | W8.6 ✓ | `scripts/check-migration-dryrun.sh` + PR-description links |
| **G7** | Every Beta surface reachable from `/` in ≤3 clicks for a logged-in user; prior-mesocycle recap reachable; no surface requires URL knowledge. | `[x]` (W8/PR #22: prior-mesocycle recap now reachable — Programs → Past → "View recap" ≤3 clicks via new `GET /user-programs/:id/mesocycles`; consolidated G7 sign-off + selectors in `docs/qa/beta-reachability.md`; Playwright `w8-prior-recap-reachability.spec.ts` green) | W8.8 ✓ | `docs/qa/beta-reachability.md` |
| **G8** | Zero `PLACEHOLDER_USER_ID` in non-test code; ESLint rule blocks re-introduction; runtime guard rejects placeholder inserts in non-test envs; cutover script ran with documented before/after counts. | `[x]` (W0 grep + runtime guard + cutover; W8/PR #22 added the `placeholder-guard` CI reintroduction guard + insert-time `assertNotPlaceholderUserId` write guard — ESLint replaced by a grep guard per W8 design decision, no lint toolchain exists) | W0 ✓ + W8.9 ✓ | `scripts/check-no-placeholder.sh` + `scripts/cutover/001-placeholder-to-jmeyer.sql` results in PASSDOWN |
| **G9** | k6 baseline at `tests/perf/beta-baseline-<date>.json` shows p95 within budget for every hot endpoint at 25 VUs; zero 5xx during 1→50 VU burst; contingency window used (or not) captured in PASSDOWN. | `[x]` (2026-07-10 run committed as `tests/perf/beta-baseline-2026-07-10.json`: zero 5xx/failed requests; recap-stats 232ms vs 800ms — **ND3 contingency NOT needed**; 8/10 in budget, `today` + `patch-planned-set` renegotiated with rationale + profiling evidence in PASSDOWN. Getting an honest run required 3 shipped fixes — nginx per-IP limiter bypass procedure, bearer verify-cache PR #47/#48, stop-api-first Postgres cold-restart) | done | `tests/perf/beta-baseline-2026-07-10.json` + PASSDOWN |
| **G10** | `docs/runbooks/bug-triage.md` with severity tiers + TTM; `docker/scripts/rollback.sh <sha>` tested; Sev-1 dry-fire timestamped <10 min declaration→mitigation. | `[x]` (2026-07-10 dry-fire: synthetic Sev-1 → `rollback.sh 69c5a09` → verified image pin + healthy + outside-in 302 in **40 seconds** declaration→mitigation; roll-forward verified. Timestamps in PASSDOWN. Two ops fixes shipped from findings: APP_SHA env-carryover strip, redeploy.sh resource-cap parity) | done | `docs/PASSDOWN.md` §Sev-1 dry-fire |
| **G11** | All Critical + Important findings from `08-qa.md` §"Pre-Beta security review checklist" closed with PR links; zero deferred to "v1.5 backlog"; any accept-residual-risk has engineering sign-off in writing. | `[x]` (W8/PR #22: all 26 pre-Beta security checklist items closed with file:line evidence; the one real finding — unvalidated `:id` → 500 with raw DB text — fixed across 6 routes via shared `idParams.ts`; zero v1.5 deferrals) | W8.9 ✓ | PR-link checklist in `08-qa.md` |
| **G12** | Test feedback submission as non-admin user lands in `feedback` table ≤5s; webhook delivery confirmed; triage cadence in `docs/runbooks/beta-triage.md`. Run against prod in pre-cutover window. | `[x]` (2026-07-10 prod smoke: non-admin bearer submit → 201, row via `GET /api/admin/feedback` immediately, `webhook_delivered_at` stamped +5s, Discord 2xx — `FEEDBACK_WEBHOOK_URL` live in prod `.env`) | done | PASSDOWN §G12 |
| **G13** | GH Actions post-deploy job pings `repos.jpmtech.com`, verifies 302→CF Access, `/api/health/sync/status`→401 from public, bundle hash matches build artifact, fails deploy on mismatch. | `[x]` (2026-07-10: CF Access service token minted + Service Auth policy on the `repos` app; repo secrets set; live `workflow_dispatch` against deployed `e03562e` → **success, all assertions green** — run 29123394516) | done | PASSDOWN §G13 + Actions run |
| **G14** | First cohort capped at 10 users; each has signed PAR-Q-lite; each has documented contact path; each saw first-run Beta disclaimer. | `[x]` (2026-07-11: N=1 cohort; CF Access allow-list caps admission; PAR-Q row verified (v2, 2026-06-26); contact path = beta-triage.md feedback→Discord; first-run disclaimer BUILT this window (PR #58 — it never existed) + surfaced + acked live 17:51 UTC) | done | PASSDOWN §G14 + `par_q_acknowledgments` + `users.beta_disclaimer_ack_at` |
| **G15** | `docs/runbooks/beta-exit-criteria.md` lists exit conditions per D13; weekly Beta review cadence documented; last review showed no blocking gaps in final 14 days. | `[x]` (cutover scope: doc reviewed 2026-07-11, cadence documented, weekly review #1 recorded in PASSDOWN; the final-14-day clause is the GA-exit check evaluated by the ongoing weekly cadence) | done | PASSDOWN §Weekly Beta review #1 + `docs/runbooks/beta-exit-criteria.md` |

**Beta cutover authorized when every row above is `[x]`.** Any `[ ]` or `[~]` at cutover-review time = Beta slips.

---

## Critical path + parallelization

```
W0 ✓ ─► W1 ✓ ─► W3 ✓ ─► W6 ✓ ─► [ W2 ✓ + W4 ✓ + W5 ✓ ] (stacked PR) ─► W7 ✓ ─► W8 build-now ✓ (PR #22) ─► CUTOVER (next)
```

**Dispatch model (single-engineer + agents per master plan):**
- W2 + W4 + W5 implemented in parallel + integrated as a stacked PR (W2→W4→W5). **W7 (in-app feedback) is the next dispatch**; W8 entry-gates close after W7.
- W7 trails the UI surfaces it observes. W8.x rows land per-wave-as-they-ship; W8.3/W8.4 final passes run in the pre-cutover prod window.

**Per memory `feedback_worktree_isolation.md`:** dispatched-agent prompts must NOT contain absolute paths into `/Users/jasonmeyer.ict/Projects/RepOS` when using `isolation: "worktree"` — that silently bypasses worktree isolation.

---

## Next dispatch

**Supervised browser block ran 2026-07-11** (full narrative + DR timestamps in `docs/PASSDOWN.md` §browser block): G3 + G5 closed with verified evidence — **all 15 build-time gates are now green**. Eight defects found and fixed same-day: two prod env gaps (`REPOS_ADMIN_EMAILS`, `PUBLIC_ORIGIN`), the never-built W3 recovery-flag UI (PR #51), CSP-blocked fonts (PRs #52/#53), sign-out-everywhere never ending the CF session (PR #54), the never-working Backups page (nginx slash-redirect, PR #55), and the never-executable prod restore (scripts-path mismatch, PR #56). Perf user + smoke feedback rows deleted; iOS Shortcut token re-minted (id 8) and verified.

**Next dispatch: cutover.** G14 (PAR-Q ack, first-run disclaimer, contact path for the N=1 cohort) and G15 (exit-criteria review + weekly cadence on the calendar) are cutover-day paperwork; then execute the cutover per `docs/runbooks/beta-cutover-checklist.md` (CF Access default-on is already live; alpha lifting data wipe per split-cutover SQL, weight history preserved).

Watch items: tonight's 03:15 UTC nightly backup (intermittent integrity-check failure — 2 of ~45 nights, suspect Unraid FUSE read-after-write; retry-once fix candidate in `repos-backup.sh`); the malformed `buildLoginUrl()` for `/api/*` 401s; one transient `invalid_cf_access_jwt` JWKS stall.

| Wave | Plan | Migrations | Status |
|------|------|------------|--------|
| **W6** | `docs/superpowers/plans/2026-05-25-w6-account-ops.md` | 060–062 | **Shipped** (PR #12 @ `dc4a059`) — published `SETTINGS_SECTIONS` + `ConfirmDialog` + `ToastHost` + `REPOS_ADMIN_EMAILS` admin gate |
| **W2** | `docs/superpowers/plans/2026-05-25-w2-onboarding-clinical-safety.md` | 034–040 | **Ready** — onboarding + PAR-Q (Q5→`user_injuries` pipeline + `par_q_advisory_active` mode); deload signal owns `day_workouts.is_deload`; `_deloadConstants.ts` published here. **Pre-flight: run the 6-test-helper inventory before dispatch.** |
| **W4** | `docs/superpowers/plans/2026-05-25-w4-desktop-authoring.md` | 041–042 | **Ready** — desktop authoring + landmarks editor with clinical floors/ceilings; `run-it-back` collapsed into `POST /user-programs/:id/start?intent=` |
| **W5** | `docs/superpowers/plans/2026-05-25-w5-backups-restore.md` | 050–051 | **Ready** — backups + restore (atomic ordering: flag → SIGTERM API → drain → pre-snapshot → pg_restore → migrate → device_tokens wipe → restart) |

**Cross-wave contracts pinned in plans:** (a) `SETTINGS_SECTIONS` const (8 entries, W6-owned, all other waves register routes only); (b) `account_events.kind` app-layer union (`par_q_acknowledged`, `onboarding_completed`, `restore_replayed` consumed cross-wave); (c) `_deloadConstants.ts` (`MANUAL_DELOAD_MAV_FACTOR=0.5`, `MANUAL_DELOAD_RIR=4`); (d) `mesocycle_runs.is_deload=true` ↔ `day_workouts.is_deload=true` invariant; (e) `device_tokens.revoke_reason` enum (`user_revoked, signout_everywhere, account_deleted, restore_replayed, legacy_revoke, cf_access_logout`).

**Deferred to W7+ with written reasons** (per `reference_w3_tuning_candidates.md` rows 13–14): cardio first-class surfaces (onboarding goal, landmarks, manual-deload coverage) and lbs/kg units conversion (full-pipeline render-layer work).

W3 closed clean (merge `0d5a2cd`): overreaching + stalled-PR evaluators with recovery_flag_events telemetry, joint_root injury_advisory wiring, mid-session swap UI with click-through, injury chip Settings page at /settings/injuries. Deferred items captured in `reference_w3_tuning_candidates` (post-Beta tuning, gated on alpha-cohort `recovery_flag_events` telemetry).

**W7 shipped** (PR #20) — the feedback loop landed after the UI surfaces it observes had stabilized. **W8.x rows** land continuously per-wave-as-they-ship; W8.3/W8.4 final passes (and the G12 prod smoke) run in the pre-cutover prod window.

---

## Active risks (next 1–2 waves only)

Full register lives in master plan. These are the ones likely to fire imminently:

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| **W3 clinical-signal thresholds drift** from what W1's volume-rollup actually emits (`performed_sets`, set-volume, RPE distribution) | Medium-high | The W1.5 e2e (`tests/e2e/w3-shape-signal.spec.ts`) pins the shape contract; W3 plan must consume it as a fixture rather than re-deriving thresholds. Audit at plan-review checkpoint per [[feedback_get_plan_reviewed]]. |
| **Parallel-wave schema collisions** (W2 `par_q_acknowledgments`, W3 `injury_swaps`, W6 `account_events`) clash on migration numbering or shared enum types | Medium | Each per-wave plan must claim its migration number range upfront in the plan front-matter; reviewer-pass per wave checks `api/migrations/` for collisions before merge. |
| **First post-W1 user-reachability gap** — W3's recovery flags + W4's landmarks editor may not be linked from `/` (per [[feedback_user_reachability_dod]]) | Medium | G7 audit (W8.8) runs after every UI-touching wave merges, not just at end. Each per-wave plan must list its entry-point link from `/` in acceptance gates. |
| **Worktree-isolation regression** when dispatching the parallel fan-out (4 waves at once, per [[feedback_worktree_isolation]]) | High if not enforced | Every parallel-agent prompt must omit absolute paths into the project root; use `isolation: "worktree"` and verify via `git worktree list` before dispatch. |

---

## Update protocol

- **After each wave merges to `main`:** flip its `[ ]` → `[x]`, update relevant G-gate rows, refresh "Next dispatch" to the next critical-path action, and update the **Last updated** date.
- **After each PR merges within an in-flight wave:** flip the sub-task `[ ]` → `[x]` under the in-flight wave block.
- **When a G-gate flips from `[~]` → `[x]`:** verify by running the listed verification command/test; do not flip green on inference.
- **If this file and the master plan disagree:** the master plan wins; correct this file.
- This file is meant to be `@`-imported at session start (`@docs/superpowers/goals/beta.md`) so a fresh chat picks up state without re-reading the 650-line master plan.
