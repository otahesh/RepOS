# RepOS Beta — Goal Condition

> Operating dashboard for the alpha→Beta transition. Source-of-truth for *what's true right now*; the master plan is `docs/superpowers/plans/2026-05-11-repos-beta.md`. When this file conflicts with the master plan, the master plan wins — correct this file.

**Last updated:** 2026-05-31 (**W8 — Beta entry gates (build-now) — complete on `feat/w8-beta-entry-gates`, PR #22 ready for review** via per-workstream subagent-driven TDD + a final 5-lens reviewer matrix with adversarial verification (0 Critical, 0 false positives; 2 Important fixed — k6 burst-threshold + weight-date-collision — plus the audit/UX Minors). All 8 CI jobs green; full tree green — api unit 480, api integration 308/7-skip, frontend validate 400, playwright green. Build-now gates **G2/G6/G7/G8/G11 → `[x]`**; **G1/G9/G10/G13/G15 → `[~]`** (artifacts built; required-checks enforcement, the k6 run, the Sev-1 dry-fire, live smoke firing, and the weekly exit reviews are pre-cutover/Beta-period steps — no staging, `project_beta_no_staging`). **Next: merge PR #22 → W8.5 branch protection → cutover checklist.**)

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
[x] W8 — Beta entry gates (build-now) — PR #22 ready for review; cutover-window gates remain
─── MILESTONE 1 (Beta cutover authorized) ───
[ ] CUT — Execute first-cohort cutover                           after W8 green
─── MILESTONE 2 (alpha-tester usable-results proof) ───
[ ] MESO — Alpha-tester completes ≥1 full mesocycle on prod      ~4 training weeks post-cutover
```

Legend: `[x]` done, `[~]` in-flight, `[ ]` not started.

---

## G1–G15 burndown

| Gate | Predicate (one line; verbatim summary) | Status | Blocking wave(s) | Verification |
|------|----------------------------------------|--------|------------------|--------------|
| **G1** | CI has api-unit + api-integration + frontend-unit + typecheck + build as required checks; deliberate-break PR confirmed gate blocks merge. | `[~]` 8 CI jobs built + green on `feat/w8-beta-entry-gates` (typecheck-api, build-frontend, validate-frontend, e2e-frontend, api-unit, api-integration, placeholder-guard, migration-gate); **required-status-checks enforcement + deliberate-break merge-block proof are W8.5/cutover** | W8.1 ✓ / W8.5 (cutover) | `.github/workflows/test.yml` + branch-protection screenshot |
| **G2** | Every per-user route has a contamination integration test asserting 404/403 (never 200-with-other-user-data); matrix ≥35 routes; `mkUserPair()` fixture exists. | `[x]` (W8/PR #22: `CONTAMINATION-MATRIX.md` reconciled against all 67 route handlers — every per-user/admin route COVERED or N/A, zero GAP; 9 new/extended `*-contamination.test.ts`; cross-user attempts → 404/empty/own-only asserted with no-mutation + row-count checks) | W8.2 ✓ | `api/tests/integration/contamination/` |
| **G3** | Playwright suite covers (a) unauth→CF Access, (b) signed-in→`/`, (c) sign-out clears, (d) sign-out-everywhere revokes bearers, (e) expired JWT mid-set-log buffers + recovers, (f) bearer mint→use→revoke→401. Run against prod CF Access topology in pre-cutover window. | `[~]` partial (W0 a/b/c; W1.3.7 e; W6 d via `frontend/playwright/w6-signout-everywhere-g3d.spec.ts`) | W8.3 (suite + prod-window pass; f pending) | `tests/e2e/` |
| **G4** | All 8 offline scenarios O1–O8 pass with Playwright + IndexedDB inspection; zero silent set loss on O1/O2/O4/O5/O8. | `[x]` | — | `frontend/src/components/programs/__offline__/` (W1.3.6) |
| **G5** | Manual backup → sidecar JSON; `gunzip\|pg_restore -l` integrity check; `tests/dr/restore-into-ephemeral.sh` green; 4 restore tests pass (happy / crash-mid-restore / sigterm-drain / migration-failure-rollback); DR dry-fire within 7 days of cutover. | `[ ]` | W5 entirely | `api/tests/integration/restore*.test.ts` + `tests/dr/` |
| **G6** | Every post-alpha migration is two-step destructive (Step 2 in next migration); every Step-2 PR links a successful dry-run; most recent migration rehearsed forward→restore→reapply with zero data loss. | `[x]` (W8/PR #22: `check-migration-dryrun.sh` D10 gate + `migration-gate` CI job live + self-tested — destructive migrations without a `Dry-run:` link are blocked going forward) | W8.6 ✓ | `scripts/check-migration-dryrun.sh` + PR-description links |
| **G7** | Every Beta surface reachable from `/` in ≤3 clicks for a logged-in user; prior-mesocycle recap reachable; no surface requires URL knowledge. | `[x]` (W8/PR #22: prior-mesocycle recap now reachable — Programs → Past → "View recap" ≤3 clicks via new `GET /user-programs/:id/mesocycles`; consolidated G7 sign-off + selectors in `docs/qa/beta-reachability.md`; Playwright `w8-prior-recap-reachability.spec.ts` green) | W8.8 ✓ | `docs/qa/beta-reachability.md` |
| **G8** | Zero `PLACEHOLDER_USER_ID` in non-test code; ESLint rule blocks re-introduction; runtime guard rejects placeholder inserts in non-test envs; cutover script ran with documented before/after counts. | `[x]` (W0 grep + runtime guard + cutover; W8/PR #22 added the `placeholder-guard` CI reintroduction guard + insert-time `assertNotPlaceholderUserId` write guard — ESLint replaced by a grep guard per W8 design decision, no lint toolchain exists) | W0 ✓ + W8.9 ✓ | `scripts/check-no-placeholder.sh` + `scripts/cutover/001-placeholder-to-jmeyer.sql` results in PASSDOWN |
| **G9** | k6 baseline at `tests/perf/beta-baseline-<date>.json` shows p95 within budget for every hot endpoint at 25 VUs; zero 5xx during 1→50 VU burst; contingency window used (or not) captured in PASSDOWN. | `[~]` (W8/PR #22: k6 harness authored — `tests/perf/` lib + 10 hot-endpoint scripts + budgets + seed helper + README/schema/ND3 note; burst threshold corrected to count only 5xx; **the pass/fail RUN vs budget is the pre-cutover prod window — k6 not installed in CI**) | W8.4 (run in prod window) | `tests/perf/beta-baseline-<date>.json` |
| **G10** | `docs/runbooks/bug-triage.md` with severity tiers + TTM; `docker/scripts/rollback.sh <sha>` tested; Sev-1 dry-fire timestamped <10 min declaration→mitigation. | `[~]` (W8/PR #22: `bug-triage.md` severity tiers + time-to-mitigate + rollback decision tree; `docker/scripts/rollback.sh` env-preserving `:sha` pin + `--memory=2g --cpus=2` caps + no-op dry-run, tested by `tests/dr/rollback.test.sh`; **Sev-1 dry-fire <10min execution is cutover**) | W8.6 ✓ build / cutover dry-fire | `docs/runbooks/` + PASSDOWN timestamps |
| **G11** | All Critical + Important findings from `08-qa.md` §"Pre-Beta security review checklist" closed with PR links; zero deferred to "v1.5 backlog"; any accept-residual-risk has engineering sign-off in writing. | `[x]` (W8/PR #22: all 26 pre-Beta security checklist items closed with file:line evidence; the one real finding — unvalidated `:id` → 500 with raw DB text — fixed across 6 routes via shared `idParams.ts`; zero v1.5 deferrals) | W8.9 ✓ | PR-link checklist in `08-qa.md` |
| **G12** | Test feedback submission as non-admin user lands in `feedback` table ≤5s; webhook delivery confirmed; triage cadence in `docs/runbooks/beta-triage.md`. Run against prod in pre-cutover window. | `[~]` engineering-satisfied (insert ≤5s + webhook delivery + runbook all proven in test, PR #20); prod CF-Access smoke PENDING | W8 (prod-window smoke) | `api/tests/integration/feedback*` (incl. end-to-end POST→webhook→`webhook_delivered_at` ≤5s) + `frontend/playwright/w7-feedback-smoke.spec.ts` + `docs/runbooks/beta-triage.md` |
| **G13** | GH Actions post-deploy job pings `repos.jpmtech.com`, verifies 302→CF Access, `/api/health/sync/status`→401 from public, bundle hash matches build artifact, fails deploy on mismatch. | `[~]` (W8/PR #22: `post-deploy-smoke.yml` workflow + `scripts/post-deploy-smoke.sh` + 10-assertion unit test authored, YAML/parse clean; **live firing needs a CF Access service token + a real deploy — cutover**) | W8.7 build ✓ / cutover firing | `.github/workflows/post-deploy-smoke.yml` |
| **G14** | First cohort capped at 10 users; each has signed PAR-Q-lite; each has documented contact path; each saw first-run Beta disclaimer. | `[ ]` | cutover-time (post-W7) | `par_q_acknowledgments` rows + comms log in PASSDOWN |
| **G15** | `docs/runbooks/beta-exit-criteria.md` lists exit conditions per D13; weekly Beta review cadence documented; last review showed no blocking gaps in final 14 days. | `[~]` (W8/PR #22: `beta-exit-criteria.md` authored — D13 floor conditions + weekly cadence, verified by `tests/dr/cutover-docs.test.sh`; **the weekly reviews + final-14-day check run during the Beta period**) | W8 docs ✓ / Beta-period | `docs/runbooks/beta-exit-criteria.md` |

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

**W8 (Beta entry gates — build-now) is complete** on `feat/w8-beta-entry-gates` (PR #22, ready for review) via per-workstream subagent-driven TDD + a final 5-lens reviewer matrix (0 Critical; the 2 Important k6 burst-threshold findings + the audit/UX Minors fixed; adversarial verification found 0 false positives). All 8 CI jobs green; full local tree green (api unit 480, api integration 308/7-skip, frontend validate 400, playwright green). Shipped: **WS1** CI api-unit/api-integration jobs (G1 mechanism); **WS7** placeholder reintroduction + insert-time guards, `:id` validation across 6 routes, 26-item security closure (G8/G11); **WS4** incident runbook + `rollback.sh` + `migration-gate` D10 gate + cutover/exit-criteria docs (G6/G10); **WS5** post-deploy-smoke workflow + script + test (G13); **WS2** exhaustive contamination matrix + 9 new/extended tests (G2); **WS6** prior-mesocycle-recap reachability via new `GET /user-programs/:id/mesocycles` (G7); **WS3** k6 perf harness for the 10 hot endpoints (G9). **Next dispatch: merge PR #22 → W8.5 branch protection (require all 8 status checks + the deliberate-break merge-block proof) → the pre-cutover prod-window passes per `docs/runbooks/beta-cutover-checklist.md` (G3 e2e-over-prod, G9 k6 run, G10 Sev-1 dry-fire, G12 feedback smoke, G13 live smoke firing), then execute the cutover.** Residual: `shellcheck`/`actionlint`/`k6` are not runnable in this authoring env — run them at cutover/in a Docker-capable env (artifacts pass `bash -n`/`node --check`/YAML-parse + their own `.test.sh` harnesses). Accepted non-blocking follow-ups (noted in PR #22): `adminFeedback.ts` bigint-dedup onto `isValidBigintId`, an optional `mesocycle_runs(user_program_id, created_at)` index, `rollback.sh --mac-address` parity.

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
