# RepOS Beta — Goal Condition

> Operating dashboard for the alpha→Beta transition. Source-of-truth for *what's true right now*; the master plan is `docs/superpowers/plans/2026-05-11-repos-beta.md`. When this file conflicts with the master plan, the master plan wins — correct this file.

**Last updated:** 2026-05-18 (mid-W1, branch `beta/w1-live-data-foundation`).

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
[~] W1 — Live data foundation (branch: beta/w1-live-data-foundation, 24 commits, no PR open)
    [x] W1.1 — set_logs schema + migration 029
    [x] W1.2 — set-logs CRUD (POST/PATCH/DELETE/GET) with 24h audit window + IDOR tests
    [x] W1.4 — health_workouts table + ingest + iOS Shortcuts runbook
        [x] W1.4.0 scope-enforcement middleware (backported)
    [ ] W1.3 — TodayLoggerMobile + O1–O8 offline matrix         ← NEXT (longest pole)
    [ ] W1.5 — e2e Playwright (overreaching toast / W1→W3 proof)
[ ] W2 — Onboarding + clinical safety (PAR-Q, deload, core)     parallel-eligible from now
[ ] W3 — Clinical signals + injury swap                          gated on W1 fully merged
[ ] W4 — Desktop authoring + landmarks editor                    parallel from W1 close
[ ] W5 — Backups + restore UI (maintenance-mode)                 parallel from W1 close
[ ] W6 — Account ops + sign-out-everywhere                       parallel from W1 close
[ ] W7 — In-app feedback loop                                    trailing
[ ] W8 — Beta entry gates                                        continuous; closes after W7
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
| **G1** | CI has api-unit + api-integration + frontend-unit + typecheck + build as required checks; deliberate-break PR confirmed gate blocks merge. | `[ ]` | W8.1, W8.5 | `.github/workflows/test.yml` + branch-protection screenshot |
| **G2** | Every per-user route has a contamination integration test asserting 404/403 (never 200-with-other-user-data); matrix ≥35 routes; `mkUserPair()` fixture exists. | `[~]` partial | W8.2 (per-route as routes land) | `api/tests/integration/contamination/` |
| **G3** | Playwright suite covers (a) unauth→CF Access, (b) signed-in→`/`, (c) sign-out clears, (d) sign-out-everywhere revokes bearers, (e) expired JWT mid-set-log buffers + recovers, (f) bearer mint→use→revoke→401. Run against prod CF Access topology in pre-cutover window. | `[~]` partial (W0 covers a/b/c) | W1.3 (e), W6.7 (d), W8.3 (suite) | `tests/e2e/` |
| **G4** | All 8 offline scenarios O1–O8 pass with Playwright + IndexedDB inspection; zero silent set loss on O1/O2/O4/O5/O8. | `[ ]` | W1.3 entirely | `frontend/playwright/` + `src/components/programs/__offline__/` |
| **G5** | Manual backup → sidecar JSON; `gunzip\|pg_restore -l` integrity check; `tests/dr/restore-into-ephemeral.sh` green; 4 restore tests pass (happy / crash-mid-restore / sigterm-drain / migration-failure-rollback); DR dry-fire within 7 days of cutover. | `[ ]` | W5 entirely | `api/tests/integration/restore*.test.ts` + `tests/dr/` |
| **G6** | Every post-alpha migration is two-step destructive (Step 2 in next migration); every Step-2 PR links a successful dry-run; most recent migration rehearsed forward→restore→reapply with zero data loss. | `[~]` enforce-going-forward | W8.6 (CI script `check-migration-dryrun.sh`) | `scripts/check-migration-dryrun.sh` + PR-description links |
| **G7** | Every Beta surface reachable from `/` in ≤3 clicks for a logged-in user; prior-mesocycle recap reachable; no surface requires URL knowledge. | `[ ]` | W8.8 (audit), all UI waves | `docs/qa/beta-reachability.md` |
| **G8** | Zero `PLACEHOLDER_USER_ID` in non-test code; ESLint rule blocks re-introduction; runtime guard rejects placeholder inserts in non-test envs; cutover script ran with documented before/after counts. | `[~]` (W0 covers grep + runtime guard + cutover; ESLint rule pending W8.9) | W0 ✓ + W8.9 | `scripts/cutover/001-placeholder-to-jmeyer.sql` results in PASSDOWN + ESLint config |
| **G9** | k6 baseline at `tests/perf/beta-baseline-<date>.json` shows p95 within budget for every hot endpoint at 25 VUs; zero 5xx during 1→50 VU burst; contingency window used (or not) captured in PASSDOWN. | `[ ]` | W8.4 (run in pre-cutover prod window) | `tests/perf/beta-baseline-<date>.json` |
| **G10** | `docs/runbooks/bug-triage.md` with severity tiers + TTM; `docker/scripts/rollback.sh <sha>` tested; Sev-1 dry-fire timestamped <10 min declaration→mitigation. | `[ ]` | W8.6 | `docs/runbooks/` + PASSDOWN timestamps |
| **G11** | All Critical + Important findings from `08-qa.md` §"Pre-Beta security review checklist" closed with PR links; zero deferred to "v1.5 backlog"; any accept-residual-risk has engineering sign-off in writing. | `[ ]` | W8.9 | PR-link checklist in `08-qa.md` |
| **G12** | Test feedback submission as non-admin user lands in `feedback` table ≤5s; webhook delivery confirmed; triage cadence in `docs/runbooks/beta-triage.md`. Run against prod in pre-cutover window. | `[ ]` | W7 entirely | `api/tests/integration/feedback*` + smoke in `tests/e2e/` |
| **G13** | GH Actions post-deploy job pings `repos.jpmtech.com`, verifies 302→CF Access, `/api/health/sync/status`→401 from public, bundle hash matches build artifact, fails deploy on mismatch. | `[ ]` | W8.7 | `.github/workflows/post-deploy-smoke.yml` |
| **G14** | First cohort capped at 10 users; each has signed PAR-Q-lite; each has documented contact path; each saw first-run Beta disclaimer. | `[ ]` | cutover-time (post-W7) | `par_q_acknowledgments` rows + comms log in PASSDOWN |
| **G15** | `docs/runbooks/beta-exit-criteria.md` lists exit conditions per D13; weekly Beta review cadence documented; last review showed no blocking gaps in final 14 days. | `[ ]` | W8 docs task | `docs/runbooks/beta-exit-criteria.md` |

**Beta cutover authorized when every row above is `[x]`.** Any `[ ]` or `[~]` at cutover-review time = Beta slips.

---

## Critical path + parallelization

```
W0 ✓ ───► W1 (W1.3, W1.5) ───► W3 ───► (W8 continuous closes)
                │
                ├─ W2 parallel (start NOW; no W1 dependency)
                ├─ W4 parallel (after W1 closes — uses W1.2 routes)
                ├─ W5 parallel (no W1 dependency; can start NOW)
                ├─ W6 parallel (no W1 dependency; can start NOW)
                └─ W7 trailing
```

**Dispatch model (single-engineer + agents per master plan):**
- Serialize W1.3 → W1.5 → W1 PR → merge.
- In parallel with W1.3/W1.5: dispatch W2 or W5 (both unblocked).
- After W1 merges: dispatch W3.
- After W3 merges: parallelize W4 + W6 (W5 already running).
- W7 trails. W8.x rows land per-wave-as-they-ship; W8.3/W8.4 final passes run in pre-cutover prod window.

**Per memory `feedback_worktree_isolation.md`:** dispatched-agent prompts must NOT contain absolute paths into `/Users/jasonmeyer.ict/Projects/RepOS` when using `isolation: "worktree"` — that silently bypasses worktree isolation.

---

## Next dispatch

**Immediate next action: W1.3 — TodayLoggerMobile + O1–O8 offline matrix.**

The W1 per-wave plan at `docs/superpowers/plans/2026-05-12-beta-W1-live-data-foundation.md` enumerates W1.3 as five sub-tasks (W1.3.1–W1.3.5: idbQueue, logBuffer, hooks, component, status banner) plus the O1–O8 Playwright scenarios. Backend is green so the frontend can integrate against real endpoints. Pre.4 (install `dexie`) and Pre.5 (scaffold Playwright) need to land first if they haven't.

**After W1.3 merges to branch:** dispatch W1.5 (single Playwright case asserting set-log POSTs surface the overreaching evaluator via `/api/recovery-flags` poll — this case folds into G3's suite and proves the W1→W3 data flow).

**Parallel-dispatchable from now:** W2 (onboarding + PAR-Q + deload) and W5 (backups + restore UI) have no W1 dependency. Each gets its own per-wave plan written via `superpowers:writing-plans` before dispatch.

---

## Active risks (next 1–2 waves only)

Full register lives in master plan. These are the ones likely to fire imminently:

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| **W1.3 IndexedDB quota / Safari private-mode** kills offline queue silently | Medium | O6 (quota-exceeded banner) and Safari-private-mode blocking modal are in spec; W1.3.5 status-banner test must cover both. Verify in Playwright with simulated quota cap. |
| **First user-reachability gap** surfaces when W1.3 lands — route `/today/:mesocycleRunId/log` may not be linked from `/` | Medium | W1.3.4.3 explicitly mounts the new route AND adds the entry-point link from MyProgramPage; G7 audit pass after W1.3 merge will catch a regression. |
| **W1 PR review velocity** stalls the branch (24 commits in already; split risk on W1.3 size) | Medium | Master plan permits splitting into `beta/w1-backend` (mergeable now) + `beta/w1-frontend` post-W1.3 if review backs up. Decision at W1.3 50%-built checkpoint. |

---

## Update protocol

- **After each wave merges to `main`:** flip its `[ ]` → `[x]`, update relevant G-gate rows, refresh "Next dispatch" to the next critical-path action, and update the **Last updated** date.
- **After each PR merges within an in-flight wave:** flip the sub-task `[ ]` → `[x]` under the in-flight wave block.
- **When a G-gate flips from `[~]` → `[x]`:** verify by running the listed verification command/test; do not flip green on inference.
- **If this file and the master plan disagree:** the master plan wins; correct this file.
- This file is meant to be `@`-imported at session start (`@docs/superpowers/goals/beta.md`) so a fresh chat picks up state without re-reading the 650-line master plan.
