# W8 — Beta Entry Gates ("ship the bar") — Design Spec

**Status:** approved (design) — 2026-05-29
**Wave:** W8 (final wave before Beta cutover)
**Master plan:** `docs/superpowers/plans/2026-05-11-repos-beta.md` §"W8 — Beta entry gates"
**Goal dashboard:** `docs/superpowers/goals/beta.md` (G1–G15 burndown)
**Predecessor:** W7 (in-app feedback loop) merged to `main` (PR #20). W0–W7 all shipped.

---

## 1. Goal

W8 ships **no product features**. It ships the **bar**: the test, tooling, runbook, and CI infrastructure required to pass acceptance gates G1–G15. After W8's build-now work merges and its cutover checklist runs in the pre-cutover prod window, Beta cutover is authorized.

## 2. The build-now / cutover split (design decision)

W8's task surface (master plan W8.1–W8.9) divides cleanly by **where the work can happen**:

- **Build-now** — in-repo, CI-gated work that can be implemented and merged today via subagent-driven TDD (same model as W7).
- **Cutover-window** — passes that can *only* run against production (`repos.jpmtech.com`) during the pre-cutover window, because **there is no staging environment** (`project_beta_no_staging`) and the alpha data must be wiped first. These remain `[~]`/`[ ]` until the cutover window.

**This spec defines the build-now plan.** The cutover-window passes are captured as an ordered checklist doc (`docs/runbooks/beta-cutover-checklist.md`, authored as part of WS4/WS7 docs) and executed at cutover — they are **out of scope for the W8 implementation plan's "done."**

## 3. Current-state audit (do not rebuild what exists)

Verified 2026-05-29 against the repo. **Re-verified 2026-05-29 (fresh-context fan-out audit); corrections folded in — see ⚠ rows:**

| Area | Already present | Gap |
|---|---|---|
| CI (`.github/workflows/test.yml`) | `typecheck-api`, `build-frontend`, `validate-frontend`, `e2e-frontend` | **No** `api-unit` / `api-integration` jobs; no `postgres` service |
| Contamination matrix | `mkUserPair()` fixture (`api/tests/helpers/seed-fixtures.ts`:698); **16** `*-contamination.test.ts` files | ⚠ **Re-audit:** ~26 per-user routes total, **~16 currently untested** (enumerated list captured for plan task WS2.1). The "~37-route" figure was imprecise — there are ~26 per-user + ~8 admin auth-gated routes, not 37. Fill the untested ones. |
| Runbooks (`docs/runbooks/`) | `cf-access-aud-drift.md`, `secret-rotation.md`, `dr-dry-fire.md`, `daemon-json-log-rotation.md`, `healthchecks-setup.md`, `beta-triage.md` (W7) | **`bug-triage.md`** (G10), **`beta-exit-criteria.md`** (G15), **`beta-cutover-checklist.md`** |
| DR scripts (`tests/dr/`) | `restore-into-ephemeral.sh`, `integrity-check.test.sh`, `check-cadence.sh` | — (G5 is W5-owned) |
| Rollback tooling | — | **`docker/scripts/rollback.sh`** absent; `docker/scripts/` dir absent |
| Migration dry-run gate | — | **`scripts/check-migration-dryrun.sh`** absent |
| Perf | — | **`tests/perf/`** absent |
| Post-deploy smoke | `docker.yml`, `test.yml` | **`post-deploy-smoke.yml`** absent |
| Reachability | `docs/qa/beta-reachability.md` (W3/W6/W7 sections) | Full audit + prior-mesocycle recap (D6) check |
| Placeholder hygiene | ⚠ `api/src/bootstrap-runtime.ts` **already exists**: `validatePlaceholderPurge()` defines `PLACEHOLDER_UUID` (lines 15/31/35) and **boot-time** rejects the placeholder user existing in `production` | **No ESLint config anywhere** (confirmed); **no _insert-time_ guard** yet (existing guard is boot-time existence-only). Grep guard must **allowlist `bootstrap-runtime.ts`** (it legitimately names the UUID). |
| Security checklist | `docs/superpowers/specs/beta/08-qa.md` §"Pre-Beta security review checklist" | Close open Critical+Important with PR links |
| Hot endpoint | `/api/mesocycles/:id/recap-stats` (`mesocycles.ts:73`) | k6 target; p95 budgets in `08-qa.md` |

## 4. Build-now workstreams

Each workstream lists what it builds, the gate(s) it closes, key constraints, and acceptance. The implementation plan (next artifact) decomposes these into TDD tasks.

### WS1 — CI hardening → **G1**
Add two jobs to `.github/workflows/test.yml`:
- `api-unit` — `npm test` (vitest unit, excludes integration).
- `api-integration` — `npm run test:integration` against a `services: postgres:16-alpine` container, with migrations applied at job start.

**Isolation strategy:** ⚠ **Corrected during planning** — the suites already isolate via `vitest` `singleFork` serial execution + `DELETE FROM` cleanup (NOT per-test BEGIN/ROLLBACK; introducing that would mean refactoring ~72 test files for no benefit at the measured ~25s runtime). Also ⚠ `api-unit` is **not** DB-less — 37/63 non-integration files run real SQL, so **both** jobs need the postgres service + `migrate` + `seed`. **Budget: integration suite <90s on CI**; if exceeded, shard by file. Net CI surface grows to **8 jobs** across W8 (WS1 adds `api-unit` + `api-integration`; WS4 adds `migration-gate`; WS7 adds `placeholder-guard`) — see the plan's "Cross-workstream coordination" section for the authoritative inventory.

> Note: making these *required* checks + branch protection is **W8.5** → cutover checklist (GitHub settings). The G1 proof (deliberately-broken PR blocks merge) is performed at that step.

**Acceptance:** both jobs run on PR + push to main and pass on current `main`; integration job green against the service container within budget.

### WS2 — Contamination matrix completeness → **G2**
Enumerate every per-user and admin route in `api/src/routes/`. For each, confirm a contamination test asserts 404/403 (never 200-with-another-user's-data) when user B touches user A's resource — using the existing `mkUserPair()` fixture (~5 lines each). **Target: every auth-gated route.** Authoritative count produced by the plan's first enumeration task (WS2.1); current re-audit estimate ≈26 per-user routes (≈16 untested — list captured) + ≈8 admin routes. (The earlier "≥37" was imprecise.)

**Acceptance:** documented route→test map; **zero uncovered per-user or admin auth-gated routes**; `npm run test:integration` green.

### WS3 — k6 perf scripts (full) → **G9** (authoring; run is cutover)
Create `tests/perf/`:
- Per hot endpoint, two scenarios: **steady 25 VUs** and **burst 1→50 VUs**. Cold-cache discipline.
- p95 budgets sourced from `08-qa.md`; `/api/mesocycles/:id/recap-stats` is the primary suspect.
- `README.md` (how to run against prod in the window, coordinate with alpha tester) + the `beta-baseline-<date>.json` output schema.

**Pre-budgeted contingency (ND3):** if `recap-stats` p95 > 2× budget at 25 VUs (or any 5xx in the burst), materialize a `recap_stats_cache` table with trigger refresh on session-end (~2 eng-days). The spec flags this; the plan keeps it as a contingency task, not built upfront (YAGNI until the run proves the cliff).

**Acceptance:** scripts run locally against a seeded DB without error and emit the baseline JSON shape; budgets encoded; README complete. (Pass/fail vs budget is the cutover run.)

### WS4 — Runbooks + rollback tooling → **G6 / G10**
- `docs/runbooks/bug-triage.md` — severity tiers (Sev-1/2/3) + time-to-mitigate, rollback decision tree (distinct from `beta-triage.md` which is the feedback-cadence doc).
- `docker/scripts/rollback.sh <sha>` — formalizes `reference_unraid_redeploy` (stop + rm + run `:sha`, env-preserving), with `--memory=2g --cpus=2` resource caps. Also update the canonical `docker run` recipe with those caps.
- `scripts/check-migration-dryrun.sh` — CI script that rejects any PR introducing a Step-2 (destructive) migration unless the PR description links a successful dry-run output (D10 two-step gate).
- **Authors the two cutover docs now** (executing them is cutover-time, but the docs are build-now deliverables so they're ready for the window): `docs/runbooks/beta-cutover-checklist.md` (the §5 ordered passes) and `docs/runbooks/beta-exit-criteria.md` (G15 exit conditions per D13 + the weekly-review cadence definition).

**Acceptance:** `rollback.sh` passes shellcheck + a dry-run (`--help`/no-op path) without touching prod; `check-migration-dryrun.sh` correctly passes a no-migration PR and fails a synthetic Step-2-without-link case; runbook reviewed for accuracy against the real deploy topology; both cutover docs authored and internally consistent with §5.

> Sev-1 dry-fire (declaration→mitigation <10 min, PASSDOWN timestamps) is **operational** → cutover checklist.

### WS5 — Post-deploy smoke workflow → **G13**
`.github/workflows/post-deploy-smoke.yml` — runs after a deploy and verifies, from outside the tunnel:
- logged-out request → **302 → CF Access**,
- `/api/health/sync/status` → **401** from public,
- deployed bundle hash **==** the build artifact hash.

Fails the deploy on any mismatch.

**Acceptance:** workflow lints (actionlint) and its assertion logic is unit-checkable; wiring into the deploy path documented. (Live firing is observed at the next real deploy / cutover.)

### WS6 — Reachability audit → **G7**
Human ≤3-click walk of every Beta surface from `/`; finalize `docs/qa/beta-reachability.md` (consolidated table across W2–W7). Confirm the **prior-mesocycle recap is reachable from MyProgramPage** (D6).

⚠ **Re-audit: the D6 gap is CONFIRMED.** MyProgramPage mounts `MesocycleRecap` (49 LOC, 3 static choices) for the *current* completed run only; there is **no** UI path to prior recaps, **no** frontend API fn to list prior runs, and **no** backend endpoint listing `mesocycle_runs` by `user_program_id` (only single-run fetch at `/mesocycles/:id`). So the conditional **fires** — and it is **larger than ~30 LOC**: it needs a minimal *list* capability, not just a component.

**Plan discipline (YAGNI):** WS6.1 first checks whether an existing endpoint can already surface prior runs (e.g. does `GET /user-programs/:id` return its runs?). Only if none can, add a **minimal** backend list (prefer extending an existing endpoint over inventing a new one) **with its own ownership + contamination test** (feeds WS2), plus a frontend entry point on MyProgramPage. This is the only product-ish code W8 ships, and it ships to close a Beta entry gate (G7).

**Acceptance:** every surface ≤3 clicks documented with selectors; **prior-mesocycle recap reachable** (list shipped + a Playwright/vitest assertion for it, and a contamination test on any new endpoint); `npm run validate` (page-reachability) green.

### WS7 — Pre-Beta security re-review (full) → **G8 / G11**
- **G8 — placeholder hygiene:** `PLACEHOLDER_USER_ID` grep-clean in non-test code (⚠ the one legitimate occurrence is the guard itself in `api/src/bootstrap-runtime.ts` — allowlist it); a **reintroduction guard** (grep, allowlisting `bootstrap-runtime.ts`) + an **insert-time runtime guard** rejecting placeholder-UUID writes in non-test envs. ⚠ **Build on the existing `bootstrap-runtime.ts` boot-time existence guard — do not assume greenfield;** the insert-time guard is the new piece.
- **G11 — security audit:** AuthN/AuthZ audit + IDOR audit across all routes; close every Critical + Important in `08-qa.md` §"Pre-Beta security review checklist" with PR links; **zero deferred to "v1.5"** (`feedback_ship_clean`); any accept-residual-risk gets written sign-off.

**Acceptance:** grep clean; the reintroduction guard fails CI on a synthetic reintroduction; runtime guard has a unit test; every checklist item marked closed-with-PR-link or signed-off; audit findings (if any) fixed.

## 5. Cutover-window checklist (separate doc — not in the build-now "done")
Authored as `docs/runbooks/beta-cutover-checklist.md`. Ordered passes that close the remaining `[~]`/`[ ]` gates during the pre-cutover prod window:
- **G3** — Playwright e2e against `repos.jpmtech.com` over CF Access (auth flow; golden journey sign-in→onboarding→start→log→recap; iOS Shortcut bearer weight POST; W1.5 overreaching toast; restore happy-path; sign-out-everywhere; **bearer mint→use→revoke→401 'f'**).
- **G9** — k6 run against prod (steady + burst); record `beta-baseline-<date>.json`; apply the recap-stats contingency if the cliff appears.
- **G10** — Sev-1 dry-fire <10 min, PASSDOWN timestamps.
- **G12** — feedback prod smoke (W7 carryover): CF-Access non-admin submits → row ≤5s + Discord delivery confirmed.
- **W8.5** — branch protection on `main`: require the 6 status checks + PR review + linear history; then the G1 deliberately-broken-PR proof.
- **G14** — cohort ≤10; each signed PAR-Q-lite; documented contact path; first-run Beta disclaimer.
- **G15** — `docs/runbooks/beta-exit-criteria.md` (exit conditions per D13) + weekly Beta review cadence.

## 6. Open implementation decisions (resolved here; plan executes)
1. **ESLint absent → use a grep-based CI guard, not a new linter.** No ESLint config exists in `api/` or `frontend/`. Standing up ESLint solely for one `no-PLACEHOLDER_USER_ID` rule is disproportionate. Decision: add a small CI script (e.g. `scripts/check-no-placeholder.sh`) wired into CI that greps non-test source and fails on reintroduction. **The script must allowlist `api/src/bootstrap-runtime.ts`** (the enforcement file legitimately references the placeholder UUID). (Revisit a full linter post-Beta if desired.)
2. **Re-confirmed: a _boot-time_ placeholder guard already exists** (`api/src/bootstrap-runtime.ts` → `validatePlaceholderPurge()`, which rejects the placeholder user *existing* in `production` at startup). **No _insert-time_ guard exists.** The plan adds the insert-path guard that throws on placeholder-UUID writes when `NODE_ENV !== 'test'`, with a unit test — **extending/coexisting with `bootstrap-runtime.ts`, not replacing it.**
3. **WS2 matrix gap count → enumerate in the plan's first task.** Produce the route→test map; size the fill work from it.

## 7. Out of scope
- Product features (except the conditional ~30-LOC "past mesocycles" list in WS6 if D6 has a gap).
- The cutover-window executions themselves (checklist-only here).
- Anything in the master plan's post-Beta / GA list (cosign image signing, WAL/PITR, multi-region, etc.).
- Standing up a full ESLint/lint toolchain (see decision #1).

## 8. Acceptance — W8 build-now wave-completion
1. WS1–WS7 merged; the new `api-unit` + `api-integration` CI jobs green on `main` within the 90s budget.
2. Gates **G1, G2, G6, G7, G8, G11, G13** green (or engineering-satisfied where a prod firing is the only remainder, e.g. G13's live ping).
3. Prod-window gates **G3, G9, G10, G12** explicitly tracked `[~]` with the cutover checklist as their predicate.
4. Reviewer matrix (backend / frontend / security / QA / infra) over the W8 diff; all Critical + Important fixed.
5. `docs/superpowers/goals/beta.md` updated: W8 build-now `[x]`; G-rows advanced; "Next dispatch" → cutover.

## 9. Risks
- **CI integration-suite time** could exceed 90s on the runner → mitigation: BEGIN/ROLLBACK isolation first, file-sharding as the next lever (WS1).
- **recap-stats perf cliff** (per master plan ND3) — but this only surfaces in the cutover k6 run; contingency pre-budgeted (WS3).
- **Branch-protection lockout** — requiring checks before they're proven stable could block hotfixes; mitigation: enable protection only after the 6 jobs are green on main for a cycle (cutover-window step, sequenced after WS1 merges).
- **`workflow`-scope push** — WS1/WS5 touch `.github/workflows/*`; push over SSH (`reference_gh_workflow_scope_push`).
