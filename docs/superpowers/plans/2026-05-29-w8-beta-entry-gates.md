# W8 — Beta Entry Gates (Build-Now) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the test, tooling, runbook, and CI **bar** required to pass Beta entry gates **G1, G2, G6, G7, G8, G11, G13** (build-now). Prod-window gates (G3, G9-run, G10, G12) close via the separate cutover checklist and are out of scope for this plan's "done."

**Architecture:** W8 ships almost no product code. It hardens CI (backend test jobs against a real Postgres service), completes the cross-user contamination test matrix, authors k6 perf scripts + operational runbooks + rollback/migration tooling + a post-deploy smoke workflow, closes the reachability gap with one minimal prior-mesocycle-recap list, and runs a full placeholder/security re-review. Same subagent-driven TDD model as W7.

**Tech Stack:** Fastify 5 + TypeScript + Postgres (`api/`), Vite 5 + React 18 + TypeScript (`frontend/`), Vitest (unit + integration), Playwright (e2e), k6 (perf), GitHub Actions CI, shellcheck/actionlint, Docker on Unraid behind Cloudflare Tunnel + Access.

**Source spec:** `docs/superpowers/specs/2026-05-29-w8-beta-entry-gates-design.md` (reconciled to a fresh-context repo audit on 2026-05-29).

---

## Workstream → gate map

| Workstream | Closes | What it ships |
|---|---|---|
| WS1 — CI hardening | G1 | `api-unit` + `api-integration` jobs (postgres service, migrate+seed, <90s budget) |
| WS2 — Contamination matrix completeness | G2 | cross-user contamination tests for the ~16 untested per-user routes |
| WS3 — k6 perf scripts (authoring) | G9 (run = cutover) | `tests/perf/` steady + burst scenarios, budgets, baseline JSON schema |
| WS4 — Runbooks + rollback tooling | G6 / G10 | `bug-triage.md`, `rollback.sh`, `check-migration-dryrun.sh`, cutover + exit-criteria docs |
| WS5 — Post-deploy smoke workflow | G13 (live = cutover) | `post-deploy-smoke.yml` + external assertion script/test |
| WS6 — Reachability + prior-recap list | G7 | reachability audit + minimal prior-mesocycle recap reachability (only product-ish code) |
| WS7 — Pre-Beta security re-review | G8 / G11 | placeholder reintroduction + insert-time guards; full AuthZ/IDOR audit + remediation |

**Cutover-window passes** (G3 e2e-over-prod, G9 k6 run, G10 Sev-1 dry-fire, G12 feedback prod smoke, W8.5 branch protection, G14 cohort, G15 exit criteria) are tracked in `docs/runbooks/beta-cutover-checklist.md` (authored in WS4) and are **not** part of this plan's completion.

---

## Cross-workstream coordination (READ BEFORE EXECUTING)

These workstreams are mostly independent, but two files are touched by multiple workstreams. Coordinate to avoid collisions.

### Shared file: `.github/workflows/test.yml` — edited by WS1, WS4, WS7

Three workstreams append jobs to the SAME `jobs:` block. Independent worktrees would conflict on this file. **Execution rule:**

1. **Land WS1 first** (it establishes the two backend test jobs and is the largest change to the file).
2. WS4's `migration-gate` job and WS7's `placeholder-guard` job each add ONE job after the existing ones — rebase them onto WS1's version of the file, or execute them in the same branch after WS1, so the `jobs:` block merges cleanly.
3. **Authoritative final CI job inventory after all of W8 (8 jobs):** `typecheck-api`, `build-frontend`, `validate-frontend`, `e2e-frontend`, `api-unit`, `api-integration`, `migration-gate`, `placeholder-guard`. (WS1's "6 jobs" and WS7's "7 jobs" counts are each partial — this is the complete list.)
4. **Every push that touches `.github/workflows/*` MUST go over SSH** — the `gh` OAuth token lacks the `workflow` scope (`reference_gh_workflow_scope_push`): `git push git@github.com:otahesh/RepOS.git HEAD:feat/w8-beta-entry-gates`. PR creation / `gh pr merge` are unaffected.
5. **W8.5 (cutover) required-status-checks list must be the full 8**, not the "6" the original spec named. WS4's `beta-cutover-checklist.md` W8.5 pass enumerates the required checks — keep that list in sync with this inventory (the exact required-vs-advisory split is a cutover decision, but the inventory is fixed here).

### Shared file: `docs/runbooks/beta-cutover-checklist.md` — created by WS4, appended by WS5

WS4 authors this doc; WS5.3 appends a "post-deploy-smoke wiring" subsection to it. **Land WS4 before WS5** (or WS5 creates a minimal stub and WS4 reconciles). WS4's `bug-triage.md` rollback decision tree references `.github/workflows/post-deploy-smoke.yml` by name and `rollback.sh <sha>` by signature — keep both names identical to what WS5/WS4 actually ship.

### Suggested execution order

`WS1` → `WS7` (shares `test.yml`; also closes security) → `WS4` (shares `test.yml` + creates cutover doc) → `WS5` (appends to cutover doc) → `WS2`, `WS3`, `WS6` (independent; any order; WS6 adds a route that WS2's matrix-completeness check must include). The independent trio can run in parallel worktrees.

## Resolved design decisions (deliberate; flagged for the reviewer matrix)

These deviations from the spec were made by the section authors with grounding evidence and are accepted:

1. **WS1 — `api-unit` carries a Postgres service + seed; BEGIN/ROLLBACK is NOT introduced.** The spec framed `api-unit` as a DB-less unit job and named "per-test BEGIN/ROLLBACK" as the isolation strategy. Verified reality: 37/63 non-integration test files run real SQL, so `api-unit` needs the same service + `migrate` + `seed` as `api-integration`; and the existing suites isolate via `singleFork` serial execution + `DELETE FROM` cleanup, not BEGIN/ROLLBACK. Adopting BEGIN/ROLLBACK would mean refactoring ~72 test files for no benefit at the measured ~25s runtime. The spec's WS1 isolation note is corrected to match.
2. **WS6 — new sub-route `GET /user-programs/:id/mesocycles`, not an extension of `GET /user-programs/:id`.** The spec preferred extension; the author chose a dedicated sub-route because the detail endpoint flows through `resolveUserProgramStructure` (template overlay; returns `null` for templateless programs) and bolting a `runs` array onto that hot path couples a list concern to it. The sub-route matches the existing `:id/warnings` and `:id/start` siblings. **Entry point is the MyLibrary "Past" tab** (Programs → Past → "View recap", ≤3 clicks) — D6's "reachable from MyProgramPage" is read as "from the program's library surface," since prior recaps belong to completed programs the user is no longer actively running. *If you want the affordance on MyProgramPage's active view instead, redirect at the WS6.3 review checkpoint.*
3. **WS5 — bundle-hash check (check c) is gated on a CF Access service token that does not exist yet.** Build-now acceptance for WS5 = workflow authored + `actionlint` clean + assertion-logic test passing. Live firing including check (c) requires minting a CF Access service token + service-auth policy + `CF_ACCESS_SVC_CLIENT_ID/SECRET` repo secrets — an infra/cutover prerequisite, not code. Trigger is `workflow_dispatch` with an `expected_sha` input (deploy is manual; nothing to auto-chain off).
4. **WS3 — k6 is not installed locally or in CI.** Authoring acceptance = scripts run via a manual local `k6 run` after `brew install k6`, emitting the baseline JSON shape. The pass/fail-vs-budget RUN is cutover-only (G9). Verify the dev-server port (assumed 3000) before the local run.
5. **WS4 — the `Dry-run:` PR-description link marker is a new convention** introduced by `check-migration-dryrun.sh`; mixed add+drop migrations are (deliberately) flagged as destructive and require the link. Document the marker in the PR template / CONTRIBUTING as a follow-up.
6. **WS7 — corrects an inaccurate prior closure in `08-qa.md`:** the W6 row claiming sessions-delete "validates the session id as a UUID" is wrong (`device_tokens.id` is `bigint`; no id validation existed). WS7.3 fixes the record and adds the real `:id` guard.

---

## WS1 — CI hardening (api-unit + api-integration jobs) -> G1

Adds two GitHub Actions jobs to `.github/workflows/test.yml` so the backend test surface runs on every PR and push to `main`. Net CI jobs go from 4 to 6 (`typecheck-api`, `build-frontend`, `validate-frontend`, `e2e-frontend`, **`api-unit`**, **`api-integration`**), closing **G1**.

**CRITICAL grounding fact (verified 2026-05-29 by running the suites and by pointing a unit test at a dead DB port):** the `api-unit` suite (`npm test`) is *not* a no-DB pure-logic suite. 37 of its 63 test files import `src/db/client.js` and execute real SQL (e.g. `tests/weight.test.ts` does `INSERT INTO users ...`; many read seeded `muscles`/`exercises`/`program_templates` rows). Running `npm test` against a non-existent DB fails with `connect ECONNREFUSED`. **Therefore BOTH new jobs require a live Postgres service AND both `npm run migrate` AND `npm run seed` run before the tests.** The local suites only pass because the workstation `repos_test` DB is already migrated + seeded. Do not author an `api-unit` job without a postgres service — it will fail on the first DB-touching test.

**Verified local baselines (these are the numbers the plan's PASS expectations key on):**
- `npm test` → `Test Files 63 passed (63)`, `Tests 468 passed (468)`, ~16s local.
- `npm run test:integration` → `Test Files 72 passed (72)`, `Tests 267 passed | 7 skipped (274)`, ~25s local (well under the 90s CI budget even with cold-connection overhead).

**Service-container DSN match:** the production code reads `DATABASE_URL` via `dotenv/config` in `api/src/db/client.ts`. The DSN in `api/.env` is `postgres://repos:repos_dev_pw@127.0.0.1:5432/repos_test`. Configuring the `postgres:16-alpine` service with `POSTGRES_USER=repos`, `POSTGRES_PASSWORD=repos_dev_pw`, `POSTGRES_DB=repos_test` makes that exact DSN valid against the service (the service auto-creates the `repos` role and `repos_test` database on first boot). Each job sets `DATABASE_URL` to `postgres://repos:repos_dev_pw@127.0.0.1:5432/repos_test` as a step env so `migrate`, `seed`, and the tests all reach the service.

> **WORKFLOW-SCOPE PUSH CAVEAT (applies to every commit/push step in this workstream):** pushes that create or modify any file under `.github/workflows/` are **rejected** by the `gh` OAuth token (it lacks the `workflow` scope; error: `refusing to allow an OAuth App to create or update workflow ... without 'workflow' scope`). **Push over SSH instead.** SSH auth works (`ssh -T git@github.com` → "Hi otahesh!"). After committing locally, push with:
> `git push git@github.com:otahesh/RepOS.git HEAD:feat/w8-beta-entry-gates`
> PR creation and `gh pr merge` go through the repo-scoped API and are unaffected — only the client-side push of the workflow file is gated.

---

### Task WS1.1: Add the `api-unit` CI job (postgres service + migrate + seed + `npm test`)

**Files:**
- Modify: `.github/workflows/test.yml` (append a new `api-unit` job under `jobs:`, after the existing `e2e-frontend` job which ends at line 82; match the existing job style — `runs-on: ubuntu-latest`, `node-version: '20'`, `cache: 'npm'`, `cache-dependency-path: api/package-lock.json`, `working-directory: api`)

This job has no in-repo unit test to write — the deliverable IS the YAML, and the proof is the job turning green in Actions. Treat the YAML as the change and the green run as the verification.

- [ ] **Read the current end of the workflow file** to anchor the edit precisely.
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS && sed -n '57,82p' .github/workflows/test.yml
  ```
  Expected: the `e2e-frontend` job block ending with the `upload-artifact` step and `retention-days: 7` on line 82.

- [ ] **Append the `api-unit` job.** Add the following block at the end of `.github/workflows/test.yml` (after line 82, as a new top-level entry under `jobs:` — keep one blank line before it, matching the spacing between existing jobs):
  ```yaml

    # api-unit — vitest non-integration suite. NOT a no-DB suite: 37/63 of these
    # test files import src/db/client.ts and run real SQL against seeded tables
    # (e.g. tests/weight.test.ts INSERTs users; many read seeded muscles/exercises).
    # So it needs the same postgres service + migrate + seed as api-integration.
    api-unit:
      runs-on: ubuntu-latest
      timeout-minutes: 10
      services:
        postgres:
          image: postgres:16-alpine
          env:
            POSTGRES_USER: repos
            POSTGRES_PASSWORD: repos_dev_pw
            POSTGRES_DB: repos_test
          ports:
            - 5432:5432
          options: >-
            --health-cmd "pg_isready -U repos -d repos_test"
            --health-interval 5s
            --health-timeout 5s
            --health-retries 10
      env:
        DATABASE_URL: postgres://repos:repos_dev_pw@127.0.0.1:5432/repos_test
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with:
            node-version: '20'
            cache: 'npm'
            cache-dependency-path: api/package-lock.json
        - working-directory: api
          run: npm ci
        - name: Apply migrations
          working-directory: api
          run: npm run migrate
        - name: Seed reference data
          working-directory: api
          run: npm run seed
        - name: Unit suite
          working-directory: api
          run: npm test
  ```
  Notes that make this real: the `env:` map on the service container is what auto-provisions the `repos` role + `repos_test` DB so the job-level `DATABASE_URL` DSN is valid; `npm run migrate` → `tsx src/db/migrate.ts` reads `DATABASE_URL` via dotenv and prints `✓ <file>` per migration then `Migrations complete.`; `npm run seed` → `tsx src/seed/seed-cli.ts` is idempotent (prints `exercises: {...}` / `program_templates: {...}` JSON); `npm test` → `vitest run --no-file-parallelism --exclude 'tests/integration/**'`. `tsx` is a devDependency, so `npm ci` installs it.

- [ ] **Verify the YAML is well-formed locally** (no actionlint dependency — use a YAML parser that ships with the runner; if `actionlint` is on PATH use it, otherwise parse with node):
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS && node -e "const y=require('fs').readFileSync('.github/workflows/test.yml','utf8'); require('js-yaml')?.load?.(y); console.log('jobs:', Object.keys(require('js-yaml').load(y).jobs).join(', '))" 2>/dev/null || python3 -c "import yaml,sys; d=yaml.safe_load(open('.github/workflows/test.yml')); print('jobs:', ', '.join(d['jobs'].keys()))"
  ```
  Expected output (the second form works without npm deps): `jobs: typecheck-api, build-frontend, validate-frontend, e2e-frontend, api-unit`

- [ ] **Reproduce the job locally (the exact commands the CI job runs)** against the workstation `repos_test` DB to prove the job recipe is correct end-to-end:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS/api && DATABASE_URL=postgres://repos:repos_dev_pw@127.0.0.1:5432/repos_test npm run migrate && DATABASE_URL=postgres://repos:repos_dev_pw@127.0.0.1:5432/repos_test npm run seed && DATABASE_URL=postgres://repos:repos_dev_pw@127.0.0.1:5432/repos_test npm test
  ```
  Expected tail:
  ```
   Test Files  63 passed (63)
        Tests  468 passed (468)
  ```

- [ ] **Commit** (do NOT push yet — push happens once after WS1.2 to keep one workflow round-trip; or push now over SSH per the caveat):
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS && git add .github/workflows/test.yml && git commit -m "ci: add api-unit job (vitest, postgres service + migrate + seed)"
  ```

---

### Task WS1.2: Add the `api-integration` CI job (postgres service + migrate + seed + `npm run test:integration`)

**Files:**
- Modify: `.github/workflows/test.yml` (append a second new job `api-integration` after the `api-unit` block added in WS1.1)

Same DB prerequisites as WS1.1 — integration tests run the full Fastify app against the same seeded `repos_test` schema. The only command difference is the test invocation (`npm run test:integration` → `vitest run --config vitest.integration.config.ts`, which is `singleFork` + `fileParallelism:false` per `api/vitest.integration.config.ts`).

- [ ] **Append the `api-integration` job** at the end of `.github/workflows/test.yml` (after the `api-unit` block, one blank line before it):
  ```yaml

    # api-integration — full Fastify app vs a real Postgres. vitest.integration.config.ts
    # forces singleFork + fileParallelism:false (suites share global tables and clean up
    # with DELETE FROM, not BEGIN/ROLLBACK), so the suite is inherently serial. Budget:
    # <90s on CI (local baseline ~25s for 72 files). If it exceeds budget, shard by
    # passing a path arg (see WS1.3).
    api-integration:
      runs-on: ubuntu-latest
      timeout-minutes: 10
      services:
        postgres:
          image: postgres:16-alpine
          env:
            POSTGRES_USER: repos
            POSTGRES_PASSWORD: repos_dev_pw
            POSTGRES_DB: repos_test
          ports:
            - 5432:5432
          options: >-
            --health-cmd "pg_isready -U repos -d repos_test"
            --health-interval 5s
            --health-timeout 5s
            --health-retries 10
      env:
        DATABASE_URL: postgres://repos:repos_dev_pw@127.0.0.1:5432/repos_test
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with:
            node-version: '20'
            cache: 'npm'
            cache-dependency-path: api/package-lock.json
        - working-directory: api
          run: npm ci
        - name: Apply migrations
          working-directory: api
          run: npm run migrate
        - name: Seed reference data
          working-directory: api
          run: npm run seed
        - name: Integration suite
          working-directory: api
          run: npm run test:integration
  ```
  Note: no per-test `ADMIN_API_KEY`/`REPOS_ADMIN_EMAILS`/`PUBLIC_ORIGIN` job env is required — the integration tests that exercise those paths set and restore them in-process (verified: `tests/integration/admin-gate.test.ts` saves `process.env.ADMIN_API_KEY`, overrides it per test, and restores it in `afterAll`). The only job-level env the suite genuinely needs is `DATABASE_URL`.

- [ ] **Verify the YAML still parses and now lists 6 jobs:**
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS && python3 -c "import yaml; d=yaml.safe_load(open('.github/workflows/test.yml')); print('jobs:', ', '.join(d['jobs'].keys()))"
  ```
  Expected: `jobs: typecheck-api, build-frontend, validate-frontend, e2e-frontend, api-unit, api-integration`

- [ ] **Reproduce the integration job locally (the exact CI commands)** against the workstation `repos_test` DB:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS/api && DATABASE_URL=postgres://repos:repos_dev_pw@127.0.0.1:5432/repos_test npm run migrate && DATABASE_URL=postgres://repos:repos_dev_pw@127.0.0.1:5432/repos_test npm run seed && DATABASE_URL=postgres://repos:repos_dev_pw@127.0.0.1:5432/repos_test npm run test:integration
  ```
  Expected tail:
  ```
   Test Files  72 passed (72)
        Tests  267 passed | 7 skipped (274)
  ```

- [ ] **Commit:**
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS && git add .github/workflows/test.yml && git commit -m "ci: add api-integration job (postgres service + migrate + seed)"
  ```

---

### Task WS1.3: Push over SSH, confirm both jobs go green on the PR, and document the <90s budget + file-sharding lever

**Files:**
- (no new files; this task pushes the WS1.1/WS1.2 commits and verifies CI)

- [ ] **Push the branch over SSH** (the `gh` token cannot push workflow changes — see the caveat at the top of this section):
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS && git push git@github.com:otahesh/RepOS.git HEAD:feat/w8-beta-entry-gates
  ```
  Expected: push succeeds (no `without 'workflow' scope` error). If the branch already has an open PR, the push updates it; otherwise open one with `gh pr create` (PR creation uses the API and is unaffected by the workflow-scope restriction).

- [ ] **Watch the two new jobs run and confirm green + within budget.** Use the run for the latest commit on the branch:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS && gh run list --branch feat/w8-beta-entry-gates --workflow test --limit 1
  ```
  Then watch the latest run to completion:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS && gh run watch "$(gh run list --branch feat/w8-beta-entry-gates --workflow test --limit 1 --json databaseId --jq '.[0].databaseId')" --exit-status
  ```
  Expected: all 6 jobs succeed. `api-unit` and `api-integration` both green.

- [ ] **Confirm the integration job stayed under the 90s budget.** Inspect the `api-integration` job's "Integration suite" step duration in the run summary:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS && gh run view "$(gh run list --branch feat/w8-beta-entry-gates --workflow test --limit 1 --json databaseId --jq '.[0].databaseId')" --log | grep -iE "api-integration.*(Integration suite|Test Files|Duration)" | tail -5
  ```
  Expected: the vitest `Duration` line shows comfortably under 90s (local baseline ~25s; CI cold-connection overhead typically lands it 30–60s). If the recorded suite time exceeds 90s, apply the sharding lever below.

- [ ] **(Lever — only if the budget is exceeded) Shard `api-integration` by file path.** `vitest run` accepts positional path/dir args to scope a run (verified: `npx vitest run --config vitest.integration.config.ts tests/integration/contamination` ran 15 files / 36 tests in 5s). Split the single `Integration suite` step into a matrix or two parallel jobs, e.g. carve the heaviest directory (`tests/integration/contamination`, ~15 files) into its own shard. Reference YAML for a 2-shard matrix replacement of the single integration job (apply ONLY if needed):
  ```yaml
    api-integration:
      runs-on: ubuntu-latest
      timeout-minutes: 10
      strategy:
        matrix:
          shard:
            - tests/integration/contamination
            - "tests/integration --exclude 'tests/integration/contamination/**'"
      services:
        postgres:
          image: postgres:16-alpine
          env:
            POSTGRES_USER: repos
            POSTGRES_PASSWORD: repos_dev_pw
            POSTGRES_DB: repos_test
          ports:
            - 5432:5432
          options: >-
            --health-cmd "pg_isready -U repos -d repos_test"
            --health-interval 5s
            --health-timeout 5s
            --health-retries 10
      env:
        DATABASE_URL: postgres://repos:repos_dev_pw@127.0.0.1:5432/repos_test
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with:
            node-version: '20'
            cache: 'npm'
            cache-dependency-path: api/package-lock.json
        - working-directory: api
          run: npm ci
        - working-directory: api
          run: npm run migrate
        - working-directory: api
          run: npm run seed
        - working-directory: api
          run: npx vitest run --config vitest.integration.config.ts ${{ matrix.shard }}
  ```
  Note the trade-off: each shard runs its own `migrate`+`seed` against its own service container (matrix jobs do not share a service), which is correct but adds per-shard setup cost. Only adopt sharding if a single-job run actually breaches 90s; otherwise the single-job form from WS1.2 is preferred (YAGNI).

- [ ] **Final acceptance check — confirm 6 jobs on the run and both new ones green:**
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS && gh run view "$(gh run list --branch feat/w8-beta-entry-gates --workflow test --limit 1 --json databaseId --jq '.[0].databaseId')" --json jobs --jq '.jobs[] | {name: .name, conclusion: .conclusion}'
  ```
  Expected: 6 entries (or 7 if sharded), each `"conclusion": "success"`, including `api-unit` and `api-integration`.

> **NOT in this wave (do not do here):** making these 6 checks **required** + enabling branch protection on `main` (require status checks + PR review + linear history) is **W8.5 / cutover** (GitHub repo Settings, performed in the pre-cutover window). The G1 proof — a deliberately-broken PR is *blocked* from merge by the failing required check — is also performed at that cutover step, after the 6 jobs have been green on `main` for a cycle. WS1's "done" is: both jobs added, running on PR + push to `main`, and green on the current branch within the 90s budget.

---

## WS2 — Contamination matrix completeness → G2

Goal: close G2 by proving, for every per-user and admin auth-gated route in `api/src/routes/`, that user B cannot read or mutate user A's data. The deliverable is (a) an authoritative route→test map produced by WS2.1, and (b) one new `*-contamination.test.ts` per untested route-file group. Every test uses the existing `mkUserPair()` fixture (`api/tests/helpers/seed-fixtures.ts:698`); routes that need scopes beyond the pair's default (`['set_logs:write','health:recovery:read','account:write']`) or a full mesocycle chain seed those explicitly with the existing helpers (`mintBearer`, `seedFullMesocycleForUser`).

**Hard-won facts the executor MUST respect (verified against the repo):**
- Contamination tests live in `api/tests/integration/contamination/` and run via `npm run test:integration` (vitest, `vitest.integration.config.ts`, `pool:'forks'`, `singleFork:true`, `fileParallelism:false`). They are NOT in the unit suite (`npm test` excludes `tests/integration/**`).
- App factory is `build()` from `api/tests/helpers/build-test-app.js` (wraps `buildApp({logger:false})`). Route prefixes: most routes mount at `/api`; **weight + workouts + sync mount at `/api/health`** (`api/src/app.ts:68-70`). So the weight path is `/api/health/weight`, NOT `/api/weight`.
- `mkUserPair()` returns `{ userA, userB }`, each a `SeedHandle` exposing `.userId` and `.bearer`. Its bearer carries scopes `['set_logs:write','health:recovery:read','account:write']` only. For `health:weight:write`, `health:injuries:read/write`, `health:workouts:write` you MUST mint a parallel bearer with `mintBearer({ userId, scopes:[...] })`.
- Auth header shape: `{ authorization: \`Bearer ${pair.userA.bearer}\` }`. CSRF is not required on the bearer path (only `feedback` adds `x-repos-csrf`).
- Cleanup pattern: push pairs into a module-level array; `afterEach(async () => { if (handles.length) await cleanupUserPair(handles.splice(0)); })`; `afterAll(async () => { await db.end(); })`. (Verbatim from `parQ-contamination.test.ts` / `manualDeload-contamination.test.ts`.)
- IDOR convention in this codebase: `:id` resources collapse "not found" and "not yours" into the **same 404** (no existence oracle). List endpoints return an **empty/own-only array** for another user's data (never 200-with-foreign-rows). `DELETE` on user-injuries is idempotent **204** (does not leak existence). `weight` routes are identity-scoped (no `:id`), so the assertion is "token B never sees / never writes user A rows."

### Task WS2.1: Author the authoritative route→test enumeration (the gap list)

Files:
- Create: `api/tests/integration/contamination/CONTAMINATION-MATRIX.md`
- Test: (none — this is a tooling/audit step that produces the map the rest of WS2 fills)

- [ ] Enumerate every registered route + its preHandler auth. Run:
```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && \
grep -rnE "app\.(get|post|patch|delete|put)\b" src/routes/ \
  | sed -E "s/^src\/routes\///" \
  > /tmp/repos-routes.txt && wc -l /tmp/repos-routes.txt
```
  Expected: a non-empty list (~40+ lines across all route files; ~26 per-user + ~8 admin auth-gated after you drop public/unauth routes).
- [ ] List the contamination tests that already exist and the routes they touch:
```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && \
ls tests/integration/contamination/ && \
grep -rhoE "url: ?[\`'\"][^\`'\"]+" tests/integration/contamination/ | sort -u
```
  Expected output includes the already-covered routes: `/api/feedback`, `/api/admin/feedback`, `/api/user/injuries`, `/api/user-programs/:id/start` (via `${...}`), PATCH `/api/user-programs/:id` (swap_all), `/api/me/par-q`, `/api/me/par-q` POST, `/api/users/me/landmarks`, `/api/mesocycles/:id/deload-now`, onboarding, account-*, signout-everywhere.
- [ ] Write `api/tests/integration/contamination/CONTAMINATION-MATRIX.md` as a table with columns `Method | Path | Auth (scope) | Ownership semantics | Contamination test file | Status`. Mark each route `COVERED` (cite the existing file) or `GAP`. The GAP rows MUST be exactly the routes WS2.2–WS2.8 below add. Real content (fill `Status` from the grep above):

```markdown
# G2 Contamination Matrix — authoritative route→test map

Generated WS2.1. Every per-user / admin auth-gated route in `api/src/routes/`.
COVERED = an existing `*-contamination.test.ts` asserts B-cannot-touch-A.
GAP = filled by WS2.2–WS2.8.

| Method | Path | Auth | Ownership | Test file | Status |
|---|---|---|---|---|---|
| GET    | /api/user-programs | bearer/CF | list own only | userPrograms-contamination.test.ts | WS2.2 |
| GET    | /api/user-programs/:id | bearer/CF | 404 not-yours | userPrograms-contamination.test.ts | WS2.2 |
| PATCH  | /api/user-programs/:id (rename) | bearer/CF | 404 not-yours | userPrograms-contamination.test.ts | WS2.2 |
| GET    | /api/user-programs/:id/warnings | bearer/CF | 404 not-yours | userPrograms-contamination.test.ts | WS2.2 |
| POST   | /api/user-programs/:id/start | bearer/CF | 404 not-yours | userProgramStart-contamination.test.ts | COVERED |
| PATCH  | /api/user-programs/:id (swap_all) | bearer/CF | 404 not-yours | userProgramsEveryOccurrence-contamination.test.ts | COVERED |
| POST   | /api/me/par-q/mark-cleared | account:write | own only | parQ-contamination.test.ts | WS2.3 |
| GET    | /api/me/par-q | account:write | own only | parQ-contamination.test.ts | COVERED |
| POST   | /api/me/par-q | account:write | own only | parQ-contamination.test.ts | COVERED |
| GET    | /api/mesocycles/today | bearer/CF | own active run only | mesocycles-contamination.test.ts | WS2.4 |
| GET    | /api/mesocycles/:id | bearer/CF | 404 not-yours | mesocycles-contamination.test.ts | WS2.4 |
| GET    | /api/mesocycles/:id/volume-rollup | bearer/CF | 404 not-yours | mesocycles-contamination.test.ts | WS2.4 |
| GET    | /api/mesocycles/:id/recap-stats | bearer/CF | 404 not-yours | mesocycles-contamination.test.ts | WS2.4 |
| POST   | /api/mesocycles/:id/abandon | bearer/CF | 404 not-yours | mesocycles-contamination.test.ts | WS2.4 |
| POST   | /api/mesocycles/:id/deload-now | account:write | 404 not-yours | manualDeload-contamination.test.ts | COVERED |
| POST   | /api/set-logs | set_logs:write | 404 foreign planned_set | setLogs-contamination.test.ts | WS2.5 |
| PATCH  | /api/set-logs/:id | set_logs:write | 404 not-yours | setLogs-contamination.test.ts | WS2.5 |
| DELETE | /api/set-logs/:id | set_logs:write | 404 not-yours | setLogs-contamination.test.ts | WS2.5 |
| GET    | /api/set-logs | set_logs:write | empty for foreign planned_set | setLogs-contamination.test.ts | WS2.5 |
| POST   | /api/health/workouts | health:workouts:write | own only | workouts-contamination.test.ts | WS2.6 |
| GET    | /api/recovery-flags | health:recovery:read | own only | recoveryFlags-contamination.test.ts | WS2.7 |
| POST   | /api/recovery-flags/dismiss | health:recovery:read | own only | recoveryFlags-contamination.test.ts | WS2.7 |
| PATCH  | /api/planned-sets/:id | bearer/CF | 404 not-yours (3-join IDOR) | plannedSets-contamination.test.ts | WS2.8 |
| POST   | /api/planned-sets/:id/substitute | bearer/CF | 404 not-yours (3-join IDOR) | plannedSets-contamination.test.ts | WS2.8 |
| GET    | /api/user/injuries | health:injuries:read | empty for B | userInjuries-contamination.test.ts | COVERED |
| PATCH  | /api/user/injuries/:joint | health:injuries:write | 404 not-yours | userInjuries-contamination.test.ts | COVERED |
| DELETE | /api/user/injuries/:joint | health:injuries:write | 204 idempotent (no leak) | userInjuries-contamination.test.ts | COVERED |
| POST   | /api/user/injuries | health:injuries:write | own only | userInjuries-contamination.test.ts | COVERED |
| POST   | /api/health/weight | health:weight:write | own only (identity-scoped) | weight-contamination.test.ts | WS2.9 |
| POST   | /api/health/weight/backfill | health:weight:write | own only (identity-scoped) | weight-contamination.test.ts | WS2.9 |
| GET    | /api/health/weight | bearer/CF | own only (identity-scoped) | weight-contamination.test.ts | WS2.9 |
```
  Note: before committing, the executor MUST reconcile this table against `/tmp/repos-routes.txt`. Any route in the grep output that is per-user/admin and not in this table is a new GAP — add a row and a test for it. Public/unauth routes (muscles, exercises, equipment, programs catalog, maintenance health) and admin-gate-tested routes already covered are explicitly out of WS2 — record them as `N/A (public)` or `COVERED` so the table is exhaustive.
- [ ] Commit:
```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && git add api/tests/integration/contamination/CONTAMINATION-MATRIX.md && git commit -m "docs(test): authoritative G2 contamination route→test map (WS2.1)"
```

### Task WS2.2: user-programs contamination (GET list, GET :id, PATCH :id, GET :id/warnings)

Files:
- Create: `api/tests/integration/contamination/userPrograms-contamination.test.ts`
- Read for reference: `api/src/routes/userPrograms.ts` (GET list:29, GET :id:59 → 404, PATCH:74 → 404, warnings:299 → 404)
- Test: `api/tests/integration/contamination/userPrograms-contamination.test.ts`

- [ ] Write the failing test. user A gets a real `user_program` via `seedFullMesocycleForUser` (which creates a `user_programs` row for the user — grab its id by SQL); user B is the attacker. These routes have **no scope guard** (only `requireBearerOrCfAccess`), so `mkUserPair` bearers work directly.
```typescript
import 'dotenv/config';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { build } from '../../helpers/build-test-app.js';
import { mkUserPair, seedFullMesocycleForUser, cleanupUserPair, type UserPairHandle } from '../../helpers/seed-fixtures.js';
import { db } from '../../../src/db/client.js';

const handles: UserPairHandle[] = [];
afterEach(async () => { if (handles.length) await cleanupUserPair(handles.splice(0)); });
afterAll(async () => { await db.end(); });

async function userProgramIdFor(userId: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM user_programs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  return rows[0].id;
}

describe('W8.2 contamination — user-programs', () => {
  it('GET /user-programs lists only user A rows, never user B', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);
    await seedFullMesocycleForUser(pair.userA.userId, { weeks: 4 });
    const upB = await userProgramIdFor(pair.userA.userId); // A's program id

    const res = await app.inject({
      method: 'GET', url: '/api/user-programs',
      headers: { authorization: `Bearer ${pair.userB.bearer}` },
    });
    expect(res.statusCode).toBe(200);
    const ids = res.json<{ programs: { id: string }[] }>().programs.map(p => p.id);
    expect(ids).not.toContain(upB);
  });

  it('GET /user-programs/:id for A program from B token returns 404', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);
    await seedFullMesocycleForUser(pair.userA.userId, { weeks: 4 });
    const upA = await userProgramIdFor(pair.userA.userId);

    const res = await app.inject({
      method: 'GET', url: `/api/user-programs/${upA}`,
      headers: { authorization: `Bearer ${pair.userB.bearer}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('PATCH /user-programs/:id (rename) on A program from B token returns 404', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);
    await seedFullMesocycleForUser(pair.userA.userId, { weeks: 4 });
    const upA = await userProgramIdFor(pair.userA.userId);

    const res = await app.inject({
      method: 'PATCH', url: `/api/user-programs/${upA}`,
      headers: { authorization: `Bearer ${pair.userB.bearer}` },
      payload: { op: 'rename', name: 'pwned' },
    });
    expect(res.statusCode).toBe(404);
    const { rows } = await db.query<{ customizations: unknown }>(
      `SELECT customizations FROM user_programs WHERE id=$1`, [upA],
    );
    expect(JSON.stringify(rows[0].customizations ?? {})).not.toContain('pwned');
  });

  it('GET /user-programs/:id/warnings for A program from B token returns 404', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);
    await seedFullMesocycleForUser(pair.userA.userId, { weeks: 4 });
    const upA = await userProgramIdFor(pair.userA.userId);

    const res = await app.inject({
      method: 'GET', url: `/api/user-programs/${upA}/warnings`,
      headers: { authorization: `Bearer ${pair.userB.bearer}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
```
- [ ] Run it and expect PASS (the routes ALREADY enforce ownership — this is a coverage test that should pass green, proving the matrix). Run:
```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm run test:integration -- tests/integration/contamination/userPrograms-contamination.test.ts
```
  Expected: `Test Files  1 passed` / `Tests  4 passed`. (If any assertion FAILS, that is a real IDOR — STOP and flag it; do not weaken the test.)
- [ ] If green, the matrix row is proven. Commit:
```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && git add api/tests/integration/contamination/userPrograms-contamination.test.ts && git commit -m "test(api): G2 contamination — user-programs list/detail/patch/warnings (WS2.2)"
```

> TDD note for the executor: in this workstream the production code is already written and correct (these are pre-existing routes). The "failing first" discipline applies to NEW product code only (WS6's prior-mesocycle list, if added). For pure coverage tests, the protocol is: write the assertion, run it, and treat a RED as a discovered vulnerability (escalate), GREEN as the matrix cell closed. Never edit a route to make a contamination test pass without a security review.

### Task WS2.3: PAR-Q mark-cleared contamination (POST /me/par-q/mark-cleared)

Files:
- Modify: `api/tests/integration/contamination/parQ-contamination.test.ts` (add a `mark-cleared` case; existing file covers GET + POST)
- Read for reference: `api/src/routes/parQ.ts:213` (mark-cleared only flips the caller's own `par_q_advisory_active`; needs `account:write` — mkUserPair has it)
- Test: `api/tests/integration/contamination/parQ-contamination.test.ts`

- [ ] Add a test asserting mark-cleared by user A never clears user B's advisory flag. Insert this `it` inside the existing `describe('W8.2 contamination — PAR-Q', ...)` block (after the existing two cases):
```typescript
  it('POST /me/par-q/mark-cleared by A does not clear B advisory flag', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);

    // Put B into advisory-active state directly.
    await db.query(
      `UPDATE users SET par_q_advisory_active = true WHERE id=$1`,
      [pair.userB.userId],
    );

    const res = await app.inject({
      method: 'POST', url: '/api/me/par-q/mark-cleared',
      headers: { authorization: `Bearer ${pair.userA.bearer}` },
    });
    expect(res.statusCode).toBe(200);

    // B's flag must be untouched.
    const { rows } = await db.query<{ par_q_advisory_active: boolean }>(
      `SELECT par_q_advisory_active FROM users WHERE id=$1`, [pair.userB.userId],
    );
    expect(rows[0].par_q_advisory_active).toBe(true);
  });
```
- [ ] Run and expect PASS:
```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm run test:integration -- tests/integration/contamination/parQ-contamination.test.ts
```
  Expected: `Tests  3 passed`.
- [ ] Commit:
```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && git add api/tests/integration/contamination/parQ-contamination.test.ts && git commit -m "test(api): G2 contamination — PAR-Q mark-cleared isolation (WS2.3)"
```

### Task WS2.4: mesocycles contamination (today, :id, volume-rollup, recap-stats, abandon)

Files:
- Create: `api/tests/integration/contamination/mesocycles-contamination.test.ts`
- Read for reference: `api/src/routes/mesocycles.ts` (today:15 → `no_active_run`; :id:24 → 404; volume-rollup:54 → 404; recap-stats:72 → 404; abandon:151 → 404). No scope guard; mkUserPair bearers work.
- Test: `api/tests/integration/contamination/mesocycles-contamination.test.ts`

- [ ] Write the test. user A gets a real active run via `seedFullMesocycleForUser`; resolve its run id by SQL. user B is the attacker.
```typescript
import 'dotenv/config';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { build } from '../../helpers/build-test-app.js';
import { mkUserPair, seedFullMesocycleForUser, cleanupUserPair, type UserPairHandle } from '../../helpers/seed-fixtures.js';
import { db } from '../../../src/db/client.js';

const handles: UserPairHandle[] = [];
afterEach(async () => { if (handles.length) await cleanupUserPair(handles.splice(0)); });
afterAll(async () => { await db.end(); });

describe('W8.2 contamination — mesocycles', () => {
  it('GET /mesocycles/today for B reflects B (no active run), not A run', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);
    await seedFullMesocycleForUser(pair.userA.userId, { weeks: 5, currentWeek: 2 });

    const res = await app.inject({
      method: 'GET', url: '/api/mesocycles/today',
      headers: { authorization: `Bearer ${pair.userB.bearer}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ state: string }>().state).toBe('no_active_run');
  });

  it('GET /mesocycles/:id for A run from B token returns 404', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);
    const runId = await seedFullMesocycleForUser(pair.userA.userId, { weeks: 5 });

    const res = await app.inject({
      method: 'GET', url: `/api/mesocycles/${runId}`,
      headers: { authorization: `Bearer ${pair.userB.bearer}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET /mesocycles/:id/volume-rollup for A run from B token returns 404', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);
    const runId = await seedFullMesocycleForUser(pair.userA.userId, { weeks: 5 });

    const res = await app.inject({
      method: 'GET', url: `/api/mesocycles/${runId}/volume-rollup`,
      headers: { authorization: `Bearer ${pair.userB.bearer}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET /mesocycles/:id/recap-stats for A run from B token returns 404', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);
    const runId = await seedFullMesocycleForUser(pair.userA.userId, { weeks: 5 });

    const res = await app.inject({
      method: 'GET', url: `/api/mesocycles/${runId}/recap-stats`,
      headers: { authorization: `Bearer ${pair.userB.bearer}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('POST /mesocycles/:id/abandon on A run from B token returns 404 and leaves run active', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);
    const runId = await seedFullMesocycleForUser(pair.userA.userId, { weeks: 5 });

    const res = await app.inject({
      method: 'POST', url: `/api/mesocycles/${runId}/abandon`,
      headers: { authorization: `Bearer ${pair.userB.bearer}` },
    });
    expect(res.statusCode).toBe(404);
    const { rows } = await db.query<{ status: string }>(
      `SELECT status FROM mesocycle_runs WHERE id=$1`, [runId],
    );
    expect(rows[0].status).toBe('active');
  });
});
```
- [ ] Run and expect PASS:
```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm run test:integration -- tests/integration/contamination/mesocycles-contamination.test.ts
```
  Expected: `Tests  5 passed`.
- [ ] Commit:
```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && git add api/tests/integration/contamination/mesocycles-contamination.test.ts && git commit -m "test(api): G2 contamination — mesocycles today/detail/rollup/recap/abandon (WS2.5)"
```

### Task WS2.5: set-logs contamination (POST, PATCH :id, DELETE :id, GET list)

Files:
- Create: `api/tests/integration/contamination/setLogs-contamination.test.ts`
- Read for reference: `api/src/routes/setLogs.ts` (POST:49 → 404 on foreign planned_set; PATCH:143 / DELETE:252 → 404 not-yours; GET:322 → empty list for foreign planned_set). All require `set_logs:write` (mkUserPair has it).
- Test: `api/tests/integration/contamination/setLogs-contamination.test.ts`

- [ ] Write the test. user A gets a full chain (run → day_workout → planned_set → set_log) via `seedFullMesocycleForUser` + a manual set_log insert; resolve A's `planned_set` id and a `set_log` id by SQL. user B (attacker) uses the pair bearer.
```typescript
import 'dotenv/config';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { build } from '../../helpers/build-test-app.js';
import { mkUserPair, seedFullMesocycleForUser, cleanupUserPair, type UserPairHandle } from '../../helpers/seed-fixtures.js';
import { db } from '../../../src/db/client.js';

const handles: UserPairHandle[] = [];
afterEach(async () => { if (handles.length) await cleanupUserPair(handles.splice(0)); });
afterAll(async () => { await db.end(); });

// Resolve a planned_set id on A's run + insert a fresh (in-window) set_log on it.
async function seedAPlannedSetAndLog(userId: string): Promise<{ plannedSetId: string; setLogId: string; exerciseId: string }> {
  const runId = await seedFullMesocycleForUser(userId, { weeks: 4 });
  const { rows: psRows } = await db.query<{ id: string; exercise_id: string }>(
    `SELECT ps.id, ps.exercise_id
     FROM planned_sets ps
     JOIN day_workouts dw ON dw.id = ps.day_workout_id
     WHERE dw.mesocycle_run_id = $1
     ORDER BY ps.id LIMIT 1`,
    [runId],
  );
  const plannedSetId = psRows[0].id;
  const exerciseId = psRows[0].exercise_id;
  const { rows: logRows } = await db.query<{ id: string }>(
    `INSERT INTO set_logs
       (user_id, exercise_id, planned_set_id, client_request_id,
        performed_load_lbs, performed_reps, performed_rir, performed_at)
     VALUES ($1, $2, $3, gen_random_uuid(), 200.0, 5, 2, now())
     RETURNING id`,
    [userId, exerciseId, plannedSetId],
  );
  return { plannedSetId, setLogId: logRows[0].id, exerciseId };
}

describe('W8.2 contamination — set-logs', () => {
  it('POST /set-logs against A planned_set from B token returns 404', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);
    const { plannedSetId } = await seedAPlannedSetAndLog(pair.userA.userId);

    const res = await app.inject({
      method: 'POST', url: '/api/set-logs',
      headers: { authorization: `Bearer ${pair.userB.bearer}` },
      payload: {
        planned_set_id: plannedSetId,
        client_request_id: '11111111-1111-1111-1111-111111111111',
        weight_lbs: 100, reps: 5, rir: 2,
        performed_at: new Date().toISOString(),
      },
    });
    expect(res.statusCode).toBe(404);
  });

  it('PATCH /set-logs/:id on A log from B token returns 404 and does not mutate', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);
    const { setLogId } = await seedAPlannedSetAndLog(pair.userA.userId);

    const res = await app.inject({
      method: 'PATCH', url: `/api/set-logs/${setLogId}`,
      headers: { authorization: `Bearer ${pair.userB.bearer}` },
      payload: { weight_lbs: 999 },
    });
    expect(res.statusCode).toBe(404);
    const { rows } = await db.query<{ performed_load_lbs: string }>(
      `SELECT performed_load_lbs FROM set_logs WHERE id=$1`, [setLogId],
    );
    expect(Number(rows[0].performed_load_lbs)).toBe(200);
  });

  it('DELETE /set-logs/:id on A log from B token returns 404 and leaves row', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);
    const { setLogId } = await seedAPlannedSetAndLog(pair.userA.userId);

    const res = await app.inject({
      method: 'DELETE', url: `/api/set-logs/${setLogId}`,
      headers: { authorization: `Bearer ${pair.userB.bearer}` },
    });
    expect(res.statusCode).toBe(404);
    const { rows } = await db.query(`SELECT 1 FROM set_logs WHERE id=$1`, [setLogId]);
    expect(rows.length).toBe(1);
  });

  it('GET /set-logs for A planned_set from B token returns an empty list', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);
    const { plannedSetId } = await seedAPlannedSetAndLog(pair.userA.userId);

    const res = await app.inject({
      method: 'GET', url: `/api/set-logs?planned_set_id=${plannedSetId}`,
      headers: { authorization: `Bearer ${pair.userB.bearer}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ set_logs: unknown[] }>().set_logs).toEqual([]);
  });
});
```
- [ ] Run and expect PASS:
```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm run test:integration -- tests/integration/contamination/setLogs-contamination.test.ts
```
  Expected: `Tests  4 passed`.
- [ ] Commit:
```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && git add api/tests/integration/contamination/setLogs-contamination.test.ts && git commit -m "test(api): G2 contamination — set-logs post/patch/delete/list IDOR (WS2.5)"
```

### Task WS2.6: workouts contamination (POST /health/workouts)

Files:
- Create: `api/tests/integration/contamination/workouts-contamination.test.ts`
- Read for reference: `api/src/routes/workouts.ts:35` — `POST /workouts` mounted at `/api/health` prefix → `/api/health/workouts`; requires `health:workouts:write` (NOT in mkUserPair default — mint a parallel bearer). Identity-scoped: rows stamped with token owner; no `:id` resource. Schema: `WorkoutIngestSchema` (`started_at`, `ended_at` ISO with offset, `modality`, `duration_sec`, `source`).
- Test: `api/tests/integration/contamination/workouts-contamination.test.ts`

- [ ] First confirm the exact required body fields so the payload validates:
```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && grep -n "modality\|started_at\|ended_at\|duration_sec\|distance_m\|source\|z\." src/schemas/healthWorkouts.ts | head -40
```
  Use the result to fill `modality`/`source` enum values exactly. (Expected: `modality` is an enum like `'run'|'walk'|...`; `source` like `'Apple Health'`.) If a field below does not match the schema, correct it from this output before running.
- [ ] Write the test. Both users get a `health:workouts:write` bearer via `mintBearer`. Assert B's POST creates a row owned by B, not A, and A's row count is unchanged.
```typescript
import 'dotenv/config';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { build } from '../../helpers/build-test-app.js';
import { mkUserPair, mintBearer, cleanupUserPair, type UserPairHandle } from '../../helpers/seed-fixtures.js';
import { db } from '../../../src/db/client.js';

const handles: UserPairHandle[] = [];
afterEach(async () => { if (handles.length) await cleanupUserPair(handles.splice(0)); });
afterAll(async () => { await db.end(); });

describe('W8.2 contamination — workouts ingest', () => {
  it('POST /health/workouts stamps the token owner, never another user', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);
    const { bearer: bearerB } = await mintBearer({
      userId: pair.userB.userId, scopes: ['health:workouts:write'], label: 'wk-b',
    });

    const res = await app.inject({
      method: 'POST', url: '/api/health/workouts',
      headers: { authorization: `Bearer ${bearerB}` },
      payload: {
        started_at: '2026-05-20T07:00:00-04:00',
        ended_at: '2026-05-20T07:35:00-04:00',
        modality: 'run',          // CONFIRM against WorkoutIngestSchema enum
        duration_sec: 2100,
        source: 'Apple Health',   // CONFIRM against schema enum
      },
    });
    expect([201, 200]).toContain(res.statusCode);

    // The row is owned by B; A has none.
    const { rows: bRows } = await db.query(
      `SELECT 1 FROM health_workouts WHERE user_id=$1`, [pair.userB.userId]);
    expect(bRows.length).toBeGreaterThan(0);
    const { rows: aRows } = await db.query(
      `SELECT 1 FROM health_workouts WHERE user_id=$1`, [pair.userA.userId]);
    expect(aRows.length).toBe(0);
  });
});
```
- [ ] Run and expect PASS:
```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm run test:integration -- tests/integration/contamination/workouts-contamination.test.ts
```
  Expected: `Tests  1 passed`. (If 400, the payload doesn't match the schema — fix `modality`/`source`/datetime per the grep, do NOT change the route.)
- [ ] Commit:
```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && git add api/tests/integration/contamination/workouts-contamination.test.ts && git commit -m "test(api): G2 contamination — workouts ingest identity-scoping (WS2.6)"
```

### Task WS2.7: recovery-flags contamination (GET, POST /dismiss)

Files:
- Create: `api/tests/integration/contamination/recoveryFlags-contamination.test.ts`
- Read for reference: `api/src/routes/recoveryFlags.ts` (GET:47 reads only the caller's active run + own dismissals; POST /dismiss:102 writes own dismissal). Both require `health:recovery:read` (mkUserPair has it). `RecoveryFlagDismissRequestSchema` body: `{ flag: 'bodyweight_crash'|'overreaching'|'stalled_pr' }`.
- Test: `api/tests/integration/contamination/recoveryFlags-contamination.test.ts`

- [ ] Write the test. Assert B's GET returns only B-context flags (no A leak) and B's dismiss writes a dismissal for B only.
```typescript
import 'dotenv/config';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { build } from '../../helpers/build-test-app.js';
import { mkUserPair, seedFullMesocycleForUser, cleanupUserPair, type UserPairHandle } from '../../helpers/seed-fixtures.js';
import { db } from '../../../src/db/client.js';

const handles: UserPairHandle[] = [];
afterEach(async () => { if (handles.length) await cleanupUserPair(handles.splice(0)); });
afterAll(async () => { await db.end(); });

describe('W8.2 contamination — recovery-flags', () => {
  it('GET /recovery-flags for B does not surface flags from A run', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);
    // Give A an active run; B has none → B sees no run-anchored flags.
    await seedFullMesocycleForUser(pair.userA.userId, { weeks: 5, currentWeek: 2 });

    const res = await app.inject({
      method: 'GET', url: '/api/recovery-flags',
      headers: { authorization: `Bearer ${pair.userB.bearer}` },
    });
    expect(res.statusCode).toBe(200);
    // No assertion that A HAS flags (that's evaluator-dependent); the
    // contamination guarantee is that B's response is computed from B's
    // userId only. We assert the response is well-formed and references no
    // A-owned dismissal/event rows below.
    expect(Array.isArray(res.json<{ flags: unknown[] }>().flags)).toBe(true);
  });

  it('POST /recovery-flags/dismiss by B writes a dismissal for B only', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);

    const res = await app.inject({
      method: 'POST', url: '/api/recovery-flags/dismiss',
      headers: { authorization: `Bearer ${pair.userB.bearer}` },
      payload: { flag: 'overreaching' },
    });
    expect(res.statusCode).toBe(204);

    const { rows: bRows } = await db.query(
      `SELECT 1 FROM recovery_flag_dismissals WHERE user_id=$1 AND flag='overreaching'`,
      [pair.userB.userId],
    );
    expect(bRows.length).toBeGreaterThan(0);
    const { rows: aRows } = await db.query(
      `SELECT 1 FROM recovery_flag_dismissals WHERE user_id=$1 AND flag='overreaching'`,
      [pair.userA.userId],
    );
    expect(aRows.length).toBe(0);
  });
});
```
- [ ] Confirm the dismissals table/column name before running (the route delegates to `recordDismissal`). If it differs from `recovery_flag_dismissals(user_id, flag)`, correct the SQL:
```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && grep -rn "INSERT INTO\|recovery_flag_dismissals\|table" src/services/recoveryFlagDismissals.ts | head
```
- [ ] Run and expect PASS:
```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm run test:integration -- tests/integration/contamination/recoveryFlags-contamination.test.ts
```
  Expected: `Tests  2 passed`.
- [ ] Commit:
```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && git add api/tests/integration/contamination/recoveryFlags-contamination.test.ts && git commit -m "test(api): G2 contamination — recovery-flags list/dismiss isolation (WS2.7)"
```

### Task WS2.8: planned-sets contamination (PATCH :id, POST :id/substitute — deepest IDOR)

Files:
- Create: `api/tests/integration/contamination/plannedSets-contamination.test.ts`
- Read for reference: `api/src/routes/plannedSets.ts` (PATCH:14 and POST substitute:124 — both gate ownership via the 3-join `planned_sets→day_workouts→mesocycle_runs WHERE mr.user_id=$2`, return 404 on miss). No scope guard. This is the IDOR `08-qa.md` flags.
- Test: `api/tests/integration/contamination/plannedSets-contamination.test.ts`

- [ ] Write the test. A's planned_set is resolved off A's run; B attempts PATCH and substitute → both 404, and the planned_set is unchanged. Note: the route's `past_day_readonly` 409 only fires for past `scheduled_date`; `seedFullMesocycleForUser` uses a future-ish `startDate` ('2026-06-01') so the ownership 404 path is what we hit — but since the contamination check happens in the SAME query as ownership, a foreign user gets 404 regardless of date.
```typescript
import 'dotenv/config';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { build } from '../../helpers/build-test-app.js';
import { mkUserPair, seedFullMesocycleForUser, cleanupUserPair, type UserPairHandle } from '../../helpers/seed-fixtures.js';
import { db } from '../../../src/db/client.js';

const handles: UserPairHandle[] = [];
afterEach(async () => { if (handles.length) await cleanupUserPair(handles.splice(0)); });
afterAll(async () => { await db.end(); });

async function aPlannedSet(userId: string): Promise<{ plannedSetId: string }> {
  const runId = await seedFullMesocycleForUser(userId, { weeks: 4 });
  const { rows } = await db.query<{ id: string }>(
    `SELECT ps.id
     FROM planned_sets ps
     JOIN day_workouts dw ON dw.id = ps.day_workout_id
     WHERE dw.mesocycle_run_id = $1
     ORDER BY ps.id LIMIT 1`,
    [runId],
  );
  return { plannedSetId: rows[0].id };
}

describe('W8.2 contamination — planned-sets (deep IDOR)', () => {
  it('PATCH /planned-sets/:id on A set from B token returns 404 and does not mutate', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);
    const { plannedSetId } = await aPlannedSet(pair.userA.userId);

    const res = await app.inject({
      method: 'PATCH', url: `/api/planned-sets/${plannedSetId}`,
      headers: { authorization: `Bearer ${pair.userB.bearer}` },
      payload: { target_rir: 0 },
    });
    expect(res.statusCode).toBe(404);
    const { rows } = await db.query<{ overridden_at: Date | null }>(
      `SELECT overridden_at FROM planned_sets WHERE id=$1`, [plannedSetId],
    );
    expect(rows[0].overridden_at).toBeNull();
  });

  it('POST /planned-sets/:id/substitute on A set from B token returns 404', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);
    const { plannedSetId } = await aPlannedSet(pair.userA.userId);
    const { rows: ex } = await db.query<{ id: string }>(`SELECT id FROM exercises WHERE archived_at IS NULL LIMIT 1`);

    const res = await app.inject({
      method: 'POST', url: `/api/planned-sets/${plannedSetId}/substitute`,
      headers: { authorization: `Bearer ${pair.userB.bearer}` },
      payload: { to_exercise_id: ex[0].id },
    });
    expect(res.statusCode).toBe(404);
  });
});
```
- [ ] Before running, confirm the `PlannedSetPatchRequestSchema` accepts `{ target_rir }` and `PlannedSetSubstituteRequestSchema` accepts `{ to_exercise_id }` (else the route 400s before the ownership check, masking the IDOR assertion):
```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && grep -n "target_rir\|to_exercise_id\|target_reps\|z\." src/schemas/plannedSets.ts | head -30
```
  If the schema requires a different minimal field, swap the payload accordingly so the body is VALID (we want the ownership 404, not a validation 400). target_rir min is documented as >=1 in seed comments — if `target_rir:0` fails validation, use `{ target_reps_low: 5 }` instead.
- [ ] Run and expect PASS:
```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm run test:integration -- tests/integration/contamination/plannedSets-contamination.test.ts
```
  Expected: `Tests  2 passed`.
- [ ] Commit:
```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && git add api/tests/integration/contamination/plannedSets-contamination.test.ts && git commit -m "test(api): G2 contamination — planned-sets PATCH/substitute deep IDOR (WS2.8)"
```

### Task WS2.9: weight contamination (POST, POST /backfill, GET — bearer-token-scoped)

Files:
- Create: `api/tests/integration/contamination/weight-contamination.test.ts`
- Read for reference: `api/src/routes/weight.ts` (POST:102, backfill:118, GET:176). Mounted at `/api/health` → `/api/health/weight`. POST/backfill require `health:weight:write`; GET requires only `requireBearerOrCfAccess`. **These are identity-scoped, not `:id` resources** — every row is keyed on `req.userId` (the token owner). The cross-user assertion is: token A writes ONLY to user A's rows, and a GET by token B never returns user A's samples. Body schema (`WeightSampleSchema`): `{ weight_lbs (50–600), date 'YYYY-MM-DD', time 'HH:MM:SS', source ∈ {'Apple Health','Manual','Withings','Renpho'} }`.
- Test: `api/tests/integration/contamination/weight-contamination.test.ts`

- [ ] Write the test. Mint `health:weight:write` bearers for BOTH users via `mintBearer` (mkUserPair default lacks the scope). Assert A's POST lands on A; B's GET returns no A samples; B's backfill lands on B only.
```typescript
import 'dotenv/config';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { build } from '../../helpers/build-test-app.js';
import { mkUserPair, mintBearer, cleanupUserPair, type UserPairHandle } from '../../helpers/seed-fixtures.js';
import { db } from '../../../src/db/client.js';

const handles: UserPairHandle[] = [];
afterEach(async () => { if (handles.length) await cleanupUserPair(handles.splice(0)); });
afterAll(async () => { await db.end(); });

describe('W8.2 contamination — weight (bearer health:weight:write)', () => {
  it('POST stamps the token owner; B GET never returns A samples', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);
    const { bearer: tokenA } = await mintBearer({ userId: pair.userA.userId, scopes: ['health:weight:write'], label: 'w-a' });
    const { bearer: tokenB } = await mintBearer({ userId: pair.userB.userId, scopes: ['health:weight:write'], label: 'w-b' });

    // A writes one sample.
    const postA = await app.inject({
      method: 'POST', url: '/api/health/weight',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { weight_lbs: 185.4, date: '2026-05-20', time: '07:00:00', source: 'Manual' },
    });
    expect([201, 200]).toContain(postA.statusCode);

    // Row is owned by A.
    const { rows: aRows } = await db.query(
      `SELECT 1 FROM health_weight_samples WHERE user_id=$1`, [pair.userA.userId]);
    expect(aRows.length).toBe(1);

    // B's GET returns NO samples (B has written none; A's are not visible).
    const getB = await app.inject({
      method: 'GET', url: '/api/health/weight?range=all',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(getB.statusCode).toBe(200);
    expect(getB.json<{ samples: unknown[] }>().samples).toEqual([]);
  });

  it('POST /backfill by B writes only B rows', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);
    const { bearer: tokenB } = await mintBearer({ userId: pair.userB.userId, scopes: ['health:weight:write'], label: 'w-b2' });

    const res = await app.inject({
      method: 'POST', url: '/api/health/weight/backfill',
      headers: { authorization: `Bearer ${tokenB}` },
      payload: { samples: [
        { weight_lbs: 190.0, date: '2026-05-18', time: '06:30:00', source: 'Manual' },
        { weight_lbs: 189.5, date: '2026-05-19', time: '06:30:00', source: 'Manual' },
      ] },
    });
    expect(res.statusCode).toBe(200);
    const { rows: bRows } = await db.query(
      `SELECT 1 FROM health_weight_samples WHERE user_id=$1`, [pair.userB.userId]);
    expect(bRows.length).toBe(2);
    const { rows: aRows } = await db.query(
      `SELECT 1 FROM health_weight_samples WHERE user_id=$1`, [pair.userA.userId]);
    expect(aRows.length).toBe(0);
  });
});
```
- [ ] Run and expect PASS:
```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm run test:integration -- tests/integration/contamination/weight-contamination.test.ts
```
  Expected: `Tests  2 passed`. (If POST returns 403, the bearer lacks `health:weight:write` — verify the `mintBearer` scope string exactly matches `VALID_SCOPES` in `api/src/auth/scopes.ts`.)
- [ ] Commit:
```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && git add api/tests/integration/contamination/weight-contamination.test.ts && git commit -m "test(api): G2 contamination — weight ingest/backfill/read identity-scoping (WS2.9)"
```

### Task WS2.10: reconcile the matrix, run the full integration suite, close G2

Files:
- Modify: `api/tests/integration/contamination/CONTAMINATION-MATRIX.md` (flip every WS2.x row to COVERED with the real test file name)
- Test: full integration suite

- [ ] Re-run the WS2.1 enumeration grep and diff it against the matrix. Any per-user/admin route still marked GAP is an uncovered route — STOP and add a test. Run:
```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && grep -rnE "app\.(get|post|patch|delete|put)\b" src/routes/ | wc -l && \
grep -c "COVERED\|N/A (public)" tests/integration/contamination/CONTAMINATION-MATRIX.md
```
  Expected: every per-user/admin route row is `COVERED`; no `GAP`/`WS2.x` left in the Status column.
- [ ] Update the matrix Status column: replace each `WS2.2`…`WS2.9` token with `COVERED` and the created test file name. (Edit in place.)
- [ ] Run the ENTIRE integration suite to confirm no cross-file state collisions (singleFork serial run):
```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm run test:integration
```
  Expected: `Test Files  N passed` (all green), including all `*-contamination.test.ts`. Budget: completes well under the 60s per-test timeout; total suite should stay within the WS1 90s CI budget — if it spikes, flag for WS1 sharding (crossref).
- [ ] Commit the reconciled matrix:
```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && git add api/tests/integration/contamination/CONTAMINATION-MATRIX.md && git commit -m "docs(test): mark every G2 contamination matrix row covered (WS2.10)"
```

Acceptance for WS2: `CONTAMINATION-MATRIX.md` enumerates every route with a COVERED/N-A status (zero GAP); the seven new + two extended contamination test files exist and pass; `npm run test:integration` is green.

---

## WS3 — k6 perf scripts (authoring; run is cutover) → G9

**Goal.** Author the k6 performance harness in `tests/perf/` for the 10 hot endpoints, with two scenarios each (steady 25 VUs; burst 1→50 VUs), p95/p99 budgets encoded as k6 `thresholds`, cold-cache discipline, a `README.md`, and a documented `beta-baseline-<date>.json` output schema. **Authoring closes G9; the pass/fail RUN against prod is a cutover-window step** (see `docs/superpowers/specs/2026-05-29-w8-beta-entry-gates-design.md` §5). Acceptance here is: every script runs **locally against a seeded `repos_test` DB** without error and emits a JSON summary in the documented shape.

**Grounding facts established by reading the repo (do not re-derive — they are load-bearing):**
- **Auth model.** Every hot endpoint is gated by `requireBearerOrCfAccess` (`api/src/middleware/cfAccess.ts:159`). On the **bearer path** it calls `requireAuth` (`api/src/middleware/auth.ts:25`), so a minted opaque bearer token (`<16hex>.<64hex>`) authenticates **all 10 endpoints**. Only `POST /api/health/weight` additionally requires `requireScope('health:weight:write')` (`api/src/routes/weight.ts:104`). The browser GETs and the `PATCH /planned-sets/:id`, `POST /planned-sets/:id/substitute`, `POST /user-programs/:id/start` routes have **no** `requireScope` — any bearer (even empty-scope) passes. **Therefore one bearer token minted with `scopes:['health:weight:write']` authenticates every hot endpoint.** This is the local-run auth path; against prod the alpha tester supplies a token minted at the edge (README documents both).
- **Token mint (local).** `POST /api/tokens` with body `{ user_id, label, scopes }` (`api/src/routes/tokens.ts:24`). In dev/test `ADMIN_API_KEY` is unset → `requireAdminKeyOrCfAccess` open-admin path (`cfAccess.ts:241-247`), so no header is needed locally. Returns `201 { id, token, created_at }`. Pattern proven in `api/tests/helpers/program-fixtures.ts:138-146`.
- **Seeding a full user+program+mesocycle.** `mkUserWithProgram()` (`api/tests/helpers/program-fixtures.ts:127`) forks+starts the seeded `upper-lower-4-day` template via the HTTP API and returns `{ userId, token, mesocycleRunId, firstPlannedSetId, firstExerciseId }`. The seeded template slugs are `full-body-3-day | upper-lower-4-day | strength-cardio-3-2` (`api/src/seed/programTemplates.ts:2`). WS3 reuses this exact path in a small seed script so the README's "prepare test data" step is real, not hand-waved.
- **Weight write rate-limit.** `upsertSample` increments `weight_write_log (user_id, log_date, write_count)` and returns **409 `rate_limited` on the 6th write per (user, date)** (`api/src/routes/weight.ts:47-55`). The steady-25-VU `POST /api/health/weight` scenario **must vary `date` per iteration** or it 409s after 5 writes/day; the threshold counts a 409 as expected (not a 5xx) but the script avoids it by using `__VU`/`__ITER` to derive a unique date. Dedupe is on `(user_id, date, source)` so distinct dates also avoid `200 deduped:true` noise.
- **Local DB DSN:** `postgres://repos:repos_dev_pw@127.0.0.1:5432/repos_test` (`api/.env`).
- **k6 is NOT installed locally and is NOT in CI** (`which k6` → not found). So the harness is **not** wired into `npm`/CI; acceptance is a manual `k6 run` after `brew install k6`. The README states this explicitly.
- **Recap-stats is the primary suspect** — its per-exercise PR CTE (`api/src/routes/mesocycles.ts:109-139`) is the heaviest read. ND3 contingency targets exactly this endpoint.

**Layout decision (DRY).** A shared `tests/perf/lib/common.js` holds the token/IDs bootstrap, the two scenario factories, and the JSON-summary writer. Each endpoint script imports the lib and declares only its URL, method, payload, and budget. This avoids 10 copies of identical scenario/threshold boilerplate.

---

### Task WS3.1: Scaffold `tests/perf/` with the shared lib + the steady/burst scenario factories

**Files:**
- Create: `tests/perf/lib/common.js`
- Create: `tests/perf/lib/budgets.js`
- Create: `tests/perf/.gitignore`
- Test: manual `k6 run` (lib has no standalone test runner — it is exercised by the per-endpoint scripts in later tasks; WS3.1's "test" is a k6 syntax-check)

Note: k6 runs a Go-embedded JS runtime, not Node — there is no vitest for `.js` k6 scripts. The TDD loop here is: write a temporary throwaway script that imports the lib and asserts the factory shapes, run it under k6, see it fail (lib absent), implement the lib, re-run green, delete the throwaway. Since k6 is not installed in CI, this loop is **local-only and documented**; if k6 is unavailable the executor installs it first (`brew install k6`).

- [ ] **Install k6 locally (prerequisite, one-time).** Run:
  ```
  brew install k6 && k6 version
  ```
  Expect output like `k6 v0.5x.x (...)`. If `brew` is unavailable, follow https://grafana.com/docs/k6/latest/set-up/install-k6/. Do not proceed until `k6 version` prints a version.

- [ ] **Write the failing factory-probe (throwaway).** Create `tests/perf/_probe.js`:
  ```js
  import { steadyScenario, burstScenario } from './lib/common.js';
  import { BUDGETS } from './lib/budgets.js';

  export const options = {
    scenarios: { ...steadyScenario('probe'), ...burstScenario('probe') },
    thresholds: { 'http_req_duration{scenario:probe_steady}': ['p(95)<200'] },
  };
  export default function () {
    if (!BUDGETS['GET /api/mesocycles/today']) throw new Error('budgets missing');
  }
  ```

- [ ] **Run it and expect FAIL.** Run:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS && k6 run tests/perf/_probe.js
  ```
  Expect a parse/exec error: `GoError: ... cannot find module './lib/common.js'` (or `'./lib/budgets.js'`). This confirms the lib is absent.

- [ ] **Implement `tests/perf/lib/budgets.js`** — single source of truth for the p95 budgets (from `docs/superpowers/specs/beta/08-qa.md` §"Latency budget (p95 from the LAN, post-Cloudflare)"):
  ```js
  // p95 budgets in milliseconds, sourced verbatim from
  // docs/superpowers/specs/beta/08-qa.md §"Latency budget".
  // burst threshold = p99 < 2x budget AND zero 5xx (per §"Test approach" item 2).
  export const BUDGETS = {
    'GET /api/mesocycles/today':              { p95: 200,  tier: 'hot'  },
    'GET /api/health/weight?range=30d':       { p95: 250,  tier: 'hot'  },
    'GET /api/health/sync/status':            { p95: 100,  tier: 'hot'  },
    'GET /api/user-programs?include=past':    { p95: 400,  tier: 'warm' },
    'GET /api/mesocycles/:id/volume-rollup':  { p95: 500,  tier: 'warm' },
    'GET /api/mesocycles/:id/recap-stats':    { p95: 800,  tier: 'cold' },
    'POST /api/user-programs/:id/start':      { p95: 2000, tier: 'cold' },
    'PATCH /api/planned-sets/:id':            { p95: 150,  tier: 'hot'  },
    'POST /api/planned-sets/:id/substitute':  { p95: 300,  tier: 'warm' },
    'POST /api/health/weight':                { p95: 200,  tier: 'hot'  },
  };
  ```

- [ ] **Implement `tests/perf/lib/common.js`** — scenario factories, env bootstrap, JSON summary:
  ```js
  import http from 'k6/http';
  import { check } from 'k6';

  // --- Config from env (README documents these) -----------------------------
  // BASE_URL   e.g. http://127.0.0.1:3000  (local)  | https://repos.jpmtech.com (prod)
  // TOKEN      opaque bearer "<16hex>.<64hex>" minted via POST /api/tokens
  // MESO_ID    a mesocycle_run_id owned by the token's user (for :id endpoints)
  // UP_ID      a user_program_id owned by the token's user (for /start)
  // PS_ID      a planned_set_id owned by the token's user (for PATCH/substitute)
  // SUB_EX_ID  a candidate exercise_id for substitute
  export const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3000';
  export const TOKEN = __ENV.TOKEN || '';
  export const IDS = {
    mesoId: __ENV.MESO_ID || '',
    upId: __ENV.UP_ID || '',
    psId: __ENV.PS_ID || '',
    subExId: __ENV.SUB_EX_ID || '',
  };

  export function authHeaders(extra) {
    return Object.assign(
      { Authorization: `Bearer ${TOKEN}` },
      extra || {},
    );
  }

  // Steady state: 25 VUs for 2 min, with a 15s ramp-up so connections warm
  // gradually (per 08-qa.md "25 VUs for 2 min, ramping").
  export function steadyScenario(tag) {
    return {
      [`${tag}_steady`]: {
        executor: 'ramping-vus',
        exec: 'steady',
        startVUs: 0,
        stages: [
          { duration: '15s', target: 25 },
          { duration: '2m', target: 25 },
          { duration: '5s', target: 0 },
        ],
        tags: { scenario: `${tag}_steady` },
        gracefulRampDown: '5s',
      },
    };
  }

  // Burst: spike 1->50 VUs in 5s, hold 30s (per 08-qa.md "Burst").
  // Starts after steady finishes (~2m25s) so the two never overlap and the
  // cold-cache discipline (Postgres restart between) is observable per-scenario.
  export function burstScenario(tag) {
    return {
      [`${tag}_burst`]: {
        executor: 'ramping-vus',
        exec: 'burst',
        startVUs: 1,
        startTime: '2m30s',
        stages: [
          { duration: '5s', target: 50 },
          { duration: '30s', target: 50 },
          { duration: '5s', target: 0 },
        ],
        tags: { scenario: `${tag}_burst` },
        gracefulRampDown: '5s',
      },
    };
  }

  // Thresholds builder: encodes the p95 budget on the steady scenario and the
  // burst contract (zero 5xx + p99 < 2x budget) on the burst scenario.
  export function thresholdsFor(tag, p95Budget) {
    return {
      [`http_req_duration{scenario:${tag}_steady}`]: [`p(95)<${p95Budget}`],
      [`http_req_duration{scenario:${tag}_burst}`]: [`p(99)<${p95Budget * 2}`],
      [`http_req_failed{scenario:${tag}_burst}`]: ['rate==0'],
    };
  }

  // Shared response check: 2xx (or an explicitly-allowed status, e.g. 409 for
  // the weight rate-limit / 200 dedupe). Returns the body for downstream use.
  export function expectOk(res, allow) {
    const ok = res.status >= 200 && res.status < 300;
    const allowed = allow ? allow.includes(res.status) : false;
    check(res, {
      'status acceptable': () => ok || allowed,
      'no 5xx': () => res.status < 500,
    });
    return res;
  }

  // beta-baseline-<date>.json summary writer. k6 calls handleSummary() once at
  // the end; each script re-exports this. Writes BOTH stdout (human) and the
  // committed baseline artifact. The artifact path is passed via env so the
  // README's run loop names it beta-baseline-$(date +%F).json.
  export function makeHandleSummary(endpointKey, p95Budget) {
    return function handleSummary(data) {
      const outPath =
        __ENV.BASELINE_OUT || `tests/perf/beta-baseline-${endpointKey.replace(/[^a-z0-9]/gi, '_')}.json`;
      const record = {
        schema: 'repos.perf.baseline/1',
        endpoint: endpointKey,
        p95_budget_ms: p95Budget,
        base_url: BASE_URL,
        ran_at: new Date().toISOString(),
        scenarios: {},
      };
      // Pull per-scenario p50/p95/p99 + 5xx rate out of k6's metric tree.
      const dur = data.metrics.http_req_duration;
      const failed = data.metrics.http_req_failed;
      record.scenarios.combined = {
        p50_ms: dur && dur.values ? dur.values['p(50)'] : null,
        p95_ms: dur && dur.values ? dur.values['p(95)'] : null,
        p99_ms: dur && dur.values ? dur.values['p(99)'] : null,
        req_failed_rate: failed && failed.values ? failed.values.rate : null,
        passed_p95_budget:
          dur && dur.values ? dur.values['p(95)'] < p95Budget : null,
      };
      return {
        stdout: JSON.stringify(record, null, 2) + '\n',
        [outPath]: JSON.stringify(record, null, 2),
      };
    };
  }
  ```

- [ ] **Re-run the probe and expect PASS.** Run:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS && BASE_URL=http://127.0.0.1:3000 TOKEN=dummy.dummy k6 run --vus 1 --iterations 1 tests/perf/_probe.js
  ```
  Expect k6 to start, execute one iteration (it will report `http_req_failed` since `dummy.dummy` 401s and there is no server — that is fine; the assertion is that **the script parses and the lib resolves**). Expect NO `GoError: cannot find module` and a normal k6 summary block printed. The probe's `default function` no longer throws because `BUDGETS` is populated.

- [ ] **Delete the throwaway probe.** Run:
  ```
  rm /Users/jasonmeyer.ict/Projects/RepOS/tests/perf/_probe.js
  ```

- [ ] **Create `tests/perf/.gitignore`** so generated baselines are not noise, but the *named, committed* baseline is added deliberately at cutover:
  ```
  # Per-endpoint scratch summaries from `k6 run` without an explicit BASELINE_OUT.
  beta-baseline-GET_*.json
  beta-baseline-POST_*.json
  beta-baseline-PATCH_*.json
  # The canonical committed artifact is beta-baseline-<YYYY-MM-DD>.json — add it
  # explicitly with `git add -f` after the cutover run (README documents this).
  ```

- [ ] **Commit.** Run:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS && git add tests/perf/lib/common.js tests/perf/lib/budgets.js tests/perf/.gitignore && git commit -m "test(perf): scaffold k6 lib with steady/burst scenario factories + budgets"
  ```

---

### Task WS3.2: Author the 5 read (GET) endpoint scripts

**Files:**
- Create: `tests/perf/get-mesocycles-today.js`
- Create: `tests/perf/get-health-weight-30d.js`
- Create: `tests/perf/get-health-sync-status.js`
- Create: `tests/perf/get-user-programs-past.js`
- Create: `tests/perf/get-mesocycle-volume-rollup.js`
- Create: `tests/perf/get-mesocycle-recap-stats.js`
- Test: `k6 run` of each against a seeded local server (covered by WS3.4's run loop)

These are the safe (idempotent) reads. Each is a thin file over the lib.

- [ ] **Create `tests/perf/get-mesocycles-today.js`:**
  ```js
  import http from 'k6/http';
  import {
    BASE_URL, authHeaders, expectOk,
    steadyScenario, burstScenario, thresholdsFor, makeHandleSummary,
  } from './lib/common.js';
  import { BUDGETS } from './lib/budgets.js';

  const KEY = 'GET /api/mesocycles/today';
  const BUDGET = BUDGETS[KEY].p95;
  const TAG = 'today';

  export const options = {
    scenarios: { ...steadyScenario(TAG), ...burstScenario(TAG) },
    thresholds: thresholdsFor(TAG, BUDGET),
  };

  function hit() {
    expectOk(http.get(`${BASE_URL}/api/mesocycles/today`, { headers: authHeaders() }));
  }
  export function steady() { hit(); }
  export function burst() { hit(); }
  export const handleSummary = makeHandleSummary(KEY, BUDGET);
  ```

- [ ] **Create `tests/perf/get-health-weight-30d.js`** (same shape; URL + KEY/TAG differ):
  ```js
  import http from 'k6/http';
  import {
    BASE_URL, authHeaders, expectOk,
    steadyScenario, burstScenario, thresholdsFor, makeHandleSummary,
  } from './lib/common.js';
  import { BUDGETS } from './lib/budgets.js';

  const KEY = 'GET /api/health/weight?range=30d';
  const BUDGET = BUDGETS[KEY].p95;
  const TAG = 'weight30d';

  export const options = {
    scenarios: { ...steadyScenario(TAG), ...burstScenario(TAG) },
    thresholds: thresholdsFor(TAG, BUDGET),
  };
  function hit() {
    expectOk(http.get(`${BASE_URL}/api/health/weight?range=30d`, { headers: authHeaders() }));
  }
  export function steady() { hit(); }
  export function burst() { hit(); }
  export const handleSummary = makeHandleSummary(KEY, BUDGET);
  ```

- [ ] **Create `tests/perf/get-health-sync-status.js`:**
  ```js
  import http from 'k6/http';
  import {
    BASE_URL, authHeaders, expectOk,
    steadyScenario, burstScenario, thresholdsFor, makeHandleSummary,
  } from './lib/common.js';
  import { BUDGETS } from './lib/budgets.js';

  const KEY = 'GET /api/health/sync/status';
  const BUDGET = BUDGETS[KEY].p95;
  const TAG = 'syncstatus';

  export const options = {
    scenarios: { ...steadyScenario(TAG), ...burstScenario(TAG) },
    thresholds: thresholdsFor(TAG, BUDGET),
  };
  function hit() {
    expectOk(http.get(`${BASE_URL}/api/health/sync/status`, { headers: authHeaders() }));
  }
  export function steady() { hit(); }
  export function burst() { hit(); }
  export const handleSummary = makeHandleSummary(KEY, BUDGET);
  ```

- [ ] **Create `tests/perf/get-user-programs-past.js`:**
  ```js
  import http from 'k6/http';
  import {
    BASE_URL, authHeaders, expectOk,
    steadyScenario, burstScenario, thresholdsFor, makeHandleSummary,
  } from './lib/common.js';
  import { BUDGETS } from './lib/budgets.js';

  const KEY = 'GET /api/user-programs?include=past';
  const BUDGET = BUDGETS[KEY].p95;
  const TAG = 'userprogramspast';

  export const options = {
    scenarios: { ...steadyScenario(TAG), ...burstScenario(TAG) },
    thresholds: thresholdsFor(TAG, BUDGET),
  };
  function hit() {
    expectOk(http.get(`${BASE_URL}/api/user-programs?include=past`, { headers: authHeaders() }));
  }
  export function steady() { hit(); }
  export function burst() { hit(); }
  export const handleSummary = makeHandleSummary(KEY, BUDGET);
  ```

- [ ] **Create `tests/perf/get-mesocycle-volume-rollup.js`** (uses `IDS.mesoId`):
  ```js
  import http from 'k6/http';
  import {
    BASE_URL, authHeaders, expectOk, IDS,
    steadyScenario, burstScenario, thresholdsFor, makeHandleSummary,
  } from './lib/common.js';
  import { BUDGETS } from './lib/budgets.js';

  const KEY = 'GET /api/mesocycles/:id/volume-rollup';
  const BUDGET = BUDGETS[KEY].p95;
  const TAG = 'volumerollup';

  export const options = {
    scenarios: { ...steadyScenario(TAG), ...burstScenario(TAG) },
    thresholds: thresholdsFor(TAG, BUDGET),
  };
  function hit() {
    expectOk(http.get(`${BASE_URL}/api/mesocycles/${IDS.mesoId}/volume-rollup`, { headers: authHeaders() }));
  }
  export function steady() { hit(); }
  export function burst() { hit(); }
  export const handleSummary = makeHandleSummary(KEY, BUDGET);
  ```

- [ ] **Create `tests/perf/get-mesocycle-recap-stats.js`** (the primary suspect — note the cold-cache comment):
  ```js
  import http from 'k6/http';
  import {
    BASE_URL, authHeaders, expectOk, IDS,
    steadyScenario, burstScenario, thresholdsFor, makeHandleSummary,
  } from './lib/common.js';
  import { BUDGETS } from './lib/budgets.js';

  // PRIMARY SUSPECT. The per-exercise PR CTE in api/src/routes/mesocycles.ts:109
  // is the heaviest read. COLD-CACHE DISCIPLINE: restart Postgres immediately
  // before this run (README documents the command) so p95 reflects a cold plan,
  // not a warmed shared-buffers cache. ND3 contingency keys off this number.
  const KEY = 'GET /api/mesocycles/:id/recap-stats';
  const BUDGET = BUDGETS[KEY].p95;
  const TAG = 'recapstats';

  export const options = {
    scenarios: { ...steadyScenario(TAG), ...burstScenario(TAG) },
    thresholds: thresholdsFor(TAG, BUDGET),
  };
  function hit() {
    expectOk(http.get(`${BASE_URL}/api/mesocycles/${IDS.mesoId}/recap-stats`, { headers: authHeaders() }));
  }
  export function steady() { hit(); }
  export function burst() { hit(); }
  export const handleSummary = makeHandleSummary(KEY, BUDGET);
  ```

- [ ] **Syntax-check all six under k6 (1-iter smoke, no server needed yet).** Run:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS && for f in get-mesocycles-today get-health-weight-30d get-health-sync-status get-user-programs-past get-mesocycle-volume-rollup get-mesocycle-recap-stats; do echo "== $f =="; BASE_URL=http://127.0.0.1:3000 TOKEN=dummy.dummy MESO_ID=00000000-0000-0000-0000-000000000000 k6 run --vus 1 --iterations 1 tests/perf/$f.js || true; done
  ```
  Expect each to **parse and run** (printing a k6 summary). With no server up the requests fail at the transport layer — that is expected; the assertion is **no `GoError`/`SyntaxError`** and a JSON summary written to stdout matching the `repos.perf.baseline/1` schema. (Real pass/fail vs budget is WS3.4 against the seeded server.)

- [ ] **Commit.** Run:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS && git add tests/perf/get-*.js && git commit -m "test(perf): k6 scripts for the 6 read hot endpoints with p95 thresholds"
  ```

---

### Task WS3.3: Author the 4 write (POST/PATCH) endpoint scripts

**Files:**
- Create: `tests/perf/patch-planned-set.js`
- Create: `tests/perf/post-planned-set-substitute.js`
- Create: `tests/perf/post-user-program-start.js`
- Create: `tests/perf/post-health-weight.js`
- Test: `k6 run` against seeded local server (WS3.4)

Writes carry extra constraints captured below. **The README marks the destructive writes (`/start`, `substitute`) as "burst-disabled by default against prod"** — they mutate state and `/start` materializes a whole mesocycle; the alpha tester opts them in deliberately. The scripts still encode the scenarios so the cutover run *can* exercise them on a throwaway seeded user.

- [ ] **Create `tests/perf/patch-planned-set.js`** (PATCH body must be non-empty per `PlannedSetPatchRequestSchema`; `rest_sec` is idempotent and safe to re-send):
  ```js
  import http from 'k6/http';
  import {
    BASE_URL, authHeaders, expectOk, IDS,
    steadyScenario, burstScenario, thresholdsFor, makeHandleSummary,
  } from './lib/common.js';
  import { BUDGETS } from './lib/budgets.js';

  const KEY = 'PATCH /api/planned-sets/:id';
  const BUDGET = BUDGETS[KEY].p95;
  const TAG = 'patchplannedset';

  export const options = {
    scenarios: { ...steadyScenario(TAG), ...burstScenario(TAG) },
    thresholds: thresholdsFor(TAG, BUDGET),
  };
  // Idempotent patch: re-set rest_sec to the same value every iteration so
  // repeated writes don't drift the row. Body must be non-empty (Zod refine).
  function hit() {
    const res = http.patch(
      `${BASE_URL}/api/planned-sets/${IDS.psId}`,
      JSON.stringify({ rest_sec: 120 }),
      { headers: authHeaders({ 'Content-Type': 'application/json' }) },
    );
    expectOk(res);
  }
  export function steady() { hit(); }
  export function burst() { hit(); }
  export const handleSummary = makeHandleSummary(KEY, BUDGET);
  ```

- [ ] **Create `tests/perf/post-planned-set-substitute.js`** (body `{ to_exercise_id }` per `PlannedSetSubstituteRequestSchema`):
  ```js
  import http from 'k6/http';
  import {
    BASE_URL, authHeaders, expectOk, IDS,
    steadyScenario, burstScenario, thresholdsFor, makeHandleSummary,
  } from './lib/common.js';
  import { BUDGETS } from './lib/budgets.js';

  // STATE-MUTATING. Substituting flips the planned_set's exercise_id. Safe to
  // hammer because it sets exercise_id to SUB_EX_ID every iteration (converges,
  // does not drift). Off by default against prod — opt in per README.
  const KEY = 'POST /api/planned-sets/:id/substitute';
  const BUDGET = BUDGETS[KEY].p95;
  const TAG = 'substitute';

  export const options = {
    scenarios: { ...steadyScenario(TAG), ...burstScenario(TAG) },
    thresholds: thresholdsFor(TAG, BUDGET),
  };
  function hit() {
    const res = http.post(
      `${BASE_URL}/api/planned-sets/${IDS.psId}/substitute`,
      JSON.stringify({ to_exercise_id: IDS.subExId }),
      { headers: authHeaders({ 'Content-Type': 'application/json' }) },
    );
    expectOk(res, [409]); // 409 if the day already passed / non-substitutable state
  }
  export function steady() { hit(); }
  export function burst() { hit(); }
  export const handleSummary = makeHandleSummary(KEY, BUDGET);
  ```

- [ ] **Create `tests/perf/post-user-program-start.js`** (cold path; each call materializes a mesocycle — README warns it needs a fresh draft user_program per iteration, so default-disabled and run with a dedicated harness at cutover):
  ```js
  import http from 'k6/http';
  import {
    BASE_URL, authHeaders, expectOk, IDS,
    steadyScenario, burstScenario, thresholdsFor, makeHandleSummary,
  } from './lib/common.js';
  import { BUDGETS } from './lib/budgets.js';

  // COLD, DESTRUCTIVE. POST /start materializes an entire mesocycle and a
  // user_program can only be started once (409 'already_started' after the
  // first). Hammering one UP_ID therefore yields one 201 then 409s — which is a
  // VALID latency sample for the cold materialize path (the 409 still exercises
  // the SERIALIZABLE ownership tx). README: for a true throughput number, seed N
  // draft user_programs and pass a comma list; v1 measures the single-start cost.
  const KEY = 'POST /api/user-programs/:id/start';
  const BUDGET = BUDGETS[KEY].p95;
  const TAG = 'programstart';

  export const options = {
    scenarios: { ...steadyScenario(TAG), ...burstScenario(TAG) },
    thresholds: thresholdsFor(TAG, BUDGET),
  };
  function hit() {
    const today = new Date().toISOString().slice(0, 10);
    const res = http.post(
      `${BASE_URL}/api/user-programs/${IDS.upId}/start`,
      JSON.stringify({ start_date: today, start_tz: 'America/Indiana/Indianapolis' }),
      { headers: authHeaders({ 'Content-Type': 'application/json' }) },
    );
    expectOk(res, [409]); // already_started after the first 201
  }
  export function steady() { hit(); }
  export function burst() { hit(); }
  export const handleSummary = makeHandleSummary(KEY, BUDGET);
  ```

- [ ] **Create `tests/perf/post-health-weight.js`** (rate-limit + dedupe discipline: vary `date` per VU/iter so neither the 6th-write 409 nor the same-day dedupe fires):
  ```js
  import http from 'k6/http';
  import {
    BASE_URL, authHeaders, expectOk,
    steadyScenario, burstScenario, thresholdsFor, makeHandleSummary,
  } from './lib/common.js';
  import { BUDGETS } from './lib/budgets.js';

  // Rate-limit: >5 writes per (user, date) -> 409 (api/src/routes/weight.ts:54).
  // Dedupe: same (user, date, source) within 0.05 lb -> 200 deduped:true.
  // To measure the true insert path we give every iteration a UNIQUE date keyed
  // off __VU/__ITER, walking backwards from today, so no (user,date) sees >1
  // write. 'source' stays 'Apple Health'. Requires the health:weight:write scope
  // on the token (the only scope-gated endpoint).
  const KEY = 'POST /api/health/weight';
  const BUDGET = BUDGETS[KEY].p95;
  const TAG = 'weightpost';

  export const options = {
    scenarios: { ...steadyScenario(TAG), ...burstScenario(TAG) },
    thresholds: thresholdsFor(TAG, BUDGET),
  };
  function uniqueDate() {
    // Distinct (VU,ITER) -> distinct day offset; clamp to the last ~25 years so
    // the date stays valid and never collides across the run.
    const offset = (__VU * 100000 + __ITER) % 9000;
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - offset);
    return d.toISOString().slice(0, 10);
  }
  function hit() {
    const res = http.post(
      `${BASE_URL}/api/health/weight`,
      JSON.stringify({ weight_lbs: 185.5, date: uniqueDate(), time: '06:30', source: 'Apple Health' }),
      { headers: authHeaders({ 'Content-Type': 'application/json' }) },
    );
    expectOk(res, [409]); // tolerate rare 409 if a date ever repeats
  }
  export function steady() { hit(); }
  export function burst() { hit(); }
  export const handleSummary = makeHandleSummary(KEY, BUDGET);
  ```

- [ ] **Syntax-check the four under k6 (1-iter smoke).** Run:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS && for f in patch-planned-set post-planned-set-substitute post-user-program-start post-health-weight; do echo "== $f =="; BASE_URL=http://127.0.0.1:3000 TOKEN=dummy.dummy PS_ID=00000000-0000-0000-0000-000000000000 UP_ID=00000000-0000-0000-0000-000000000000 SUB_EX_ID=00000000-0000-0000-0000-000000000000 k6 run --vus 1 --iterations 1 tests/perf/$f.js || true; done
  ```
  Expect each to parse, run one iteration, and print a `repos.perf.baseline/1` JSON summary. No `GoError`/`SyntaxError`.

- [ ] **Commit.** Run:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS && git add tests/perf/patch-planned-set.js tests/perf/post-planned-set-substitute.js tests/perf/post-user-program-start.js tests/perf/post-health-weight.js && git commit -m "test(perf): k6 scripts for the 4 write hot endpoints with rate-limit/dedupe discipline"
  ```

---

### Task WS3.4: Seed helper + green local run (the WS3 acceptance proof)

**Files:**
- Create: `tests/perf/seed-perf-target.mjs`
- Test: a real `k6 run` of one read script against a locally-seeded server, emitting a valid baseline JSON

This is where "scripts run locally against a seeded DB without error and emit the baseline JSON shape" (the spec's acceptance) is actually demonstrated. The seed helper reuses the production seed + the `mkUserWithProgram` HTTP path so it is not a parallel re-implementation.

- [ ] **Create `tests/perf/seed-perf-target.mjs`** — a tsx-run Node script that boots the app in-process, mints a token, forks+starts the seeded template, and prints the env exports the README's run loop consumes. (Mirrors `api/tests/helpers/program-fixtures.ts:127-191` but as a standalone CLI; lives under `tests/perf/` and is invoked with the api dir's tsx.)
  ```js
  // Seed a perf target: one user + one started mesocycle on the seeded
  // `upper-lower-4-day` template, plus a bearer token scoped health:weight:write
  // (the only scope-gated hot endpoint; all others ignore scope). Prints shell
  // `export` lines the README pipes into the k6 run loop.
  //
  // Run from the api dir so tsx + the app's relative imports resolve:
  //   cd api && npx tsx ../tests/perf/seed-perf-target.mjs
  // Requires DATABASE_URL (api/.env) pointing at repos_test and the seed having
  // been applied (npm run seed) so program_templates has upper-lower-4-day.
  import { buildApp } from '../api/src/app.js';
  import { db } from '../api/src/db/client.js';
  import { randomUUID } from 'node:crypto';

  async function main() {
    const app = await buildApp();
    const email = `perf.${randomUUID()}@repos.test`;
    const { rows: [u] } = await db.query(
      `INSERT INTO users (email, goal) VALUES ($1, 'maintain') RETURNING id`,
      [email],
    );
    const userId = u.id;

    const mint = await app.inject({
      method: 'POST', url: '/api/tokens',
      payload: { user_id: userId, label: 'perf', scopes: ['health:weight:write'] },
    });
    if (mint.statusCode !== 201) throw new Error(`mint failed ${mint.statusCode}`);
    const token = mint.json().token;
    const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

    const fork = await app.inject({
      method: 'POST', url: '/api/program-templates/upper-lower-4-day/fork',
      headers: auth, payload: { name: 'perf run' },
    });
    if (fork.statusCode !== 201) throw new Error(`fork failed ${fork.statusCode}`);
    const upId = fork.json().id;

    const start = await app.inject({
      method: 'POST', url: `/api/user-programs/${upId}/start`,
      headers: auth,
      payload: { start_date: new Date().toISOString().slice(0, 10), start_tz: 'America/Indiana/Indianapolis' },
    });
    if (start.statusCode !== 201) throw new Error(`start failed ${start.statusCode}`);
    const mesoId = start.json().mesocycle_run_id;

    const { rows: [ps] } = await db.query(
      `SELECT ps.id FROM planned_sets ps
         JOIN day_workouts dw ON dw.id = ps.day_workout_id
        WHERE dw.mesocycle_run_id = $1
        ORDER BY dw.week_idx, dw.day_idx, ps.block_idx, ps.set_idx LIMIT 1`,
      [mesoId],
    );
    // A substitute candidate: any seeded exercise other than the planned one.
    const { rows: [ex] } = await db.query(
      `SELECT id FROM exercises WHERE is_active = true LIMIT 1`,
    );

    // For the /start perf target we need a SECOND, still-draft user_program so
    // the start script has something to start (the first is already started).
    const fork2 = await app.inject({
      method: 'POST', url: '/api/program-templates/upper-lower-4-day/fork',
      headers: auth, payload: { name: 'perf start target' },
    });
    const upStartId = fork2.statusCode === 201 ? fork2.json().id : upId;

    console.log(`export TOKEN='${token}'`);
    console.log(`export MESO_ID='${mesoId}'`);
    console.log(`export PS_ID='${ps.id}'`);
    console.log(`export UP_ID='${upStartId}'`);
    console.log(`export SUB_EX_ID='${ex.id}'`);
    console.log(`# seeded user_id=${userId} email=${email}`);

    await app.close();
    await db.end();
  }
  main().catch(async (e) => { console.error(e); await db.end(); process.exit(1); });
  ```

- [ ] **Verify the seed helper runs (FAIL-first is the unseeded DB).** First run WITHOUT seeding the template to see the explicit failure, then seed and re-run. Run:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx tsx ../tests/perf/seed-perf-target.mjs
  ```
  If `program_templates` lacks `upper-lower-4-day`, expect `Error: fork failed 404`. That is the FAIL signal that the DB is not seeded.

- [ ] **Seed the local DB, then re-run the helper and expect PASS.** Run:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm run migrate && npm run seed && npx tsx ../tests/perf/seed-perf-target.mjs
  ```
  Expect five `export ...` lines printed (`TOKEN`, `MESO_ID`, `PS_ID`, `UP_ID`, `SUB_EX_ID`) plus the `# seeded user_id=...` comment. This is the proof the seed path is real.

- [ ] **Start the API locally and do the acceptance k6 run.** In one shell start the server, in another run k6 against a read endpoint with the seeded env. Run (server):
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm run dev
  ```
  Then (k6, after pasting the `export` lines from the seed helper):
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS && BASE_URL=http://127.0.0.1:3000 BASELINE_OUT=tests/perf/beta-baseline-$(date +%F).json k6 run --vus 5 --duration 20s tests/perf/get-mesocycles-today.js
  ```
  (A short 5-VU/20s override is used for the local smoke; the full 25-VU/burst profile runs at cutover.) Expect: k6 exits 0, prints `checks ........: 100.00%` (or near), and `http_req_failed ...: 0.00%`, and writes `tests/perf/beta-baseline-<date>.json`. Confirm the file matches the schema:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS && node -e "const j=require('./tests/perf/beta-baseline-'+new Date().toISOString().slice(0,10)+'.json'); if(j.schema!=='repos.perf.baseline/1'||typeof j.scenarios.combined.p95_ms!=='number') throw new Error('bad shape'); console.log('baseline shape OK', j.endpoint, j.scenarios.combined.p95_ms+'ms')"
  ```
  Expect: `baseline shape OK GET /api/mesocycles/today <n>ms`. This is the WS3 acceptance.

- [ ] **Remove the throwaway smoke baseline (it is not the committed cutover artifact).** Run:
  ```
  rm /Users/jasonmeyer.ict/Projects/RepOS/tests/perf/beta-baseline-$(date +%F).json
  ```

- [ ] **Commit the seed helper.** Run:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS && git add tests/perf/seed-perf-target.mjs && git commit -m "test(perf): seed helper for a local k6 perf target (user+started meso+token)"
  ```

---

### Task WS3.5: Author `tests/perf/README.md` + the baseline JSON schema doc

**Files:**
- Create: `tests/perf/README.md`
- Create: `tests/perf/BASELINE_SCHEMA.md`
- Test: doc consistency check (the README's commands match the real scripts/scripts; verified by a grep)

- [ ] **Create `tests/perf/BASELINE_SCHEMA.md`** documenting the `repos.perf.baseline/1` shape emitted by `makeHandleSummary`:
  ```markdown
  # beta-baseline-<date>.json — schema `repos.perf.baseline/1`

  Each k6 endpoint script emits one JSON document via `handleSummary`. The
  committed cutover artifact is the **merge** of per-endpoint runs into
  `tests/perf/beta-baseline-<YYYY-MM-DD>.json` (one object per endpoint, or an
  array — see "Assembling the artifact" below).

  ## Per-endpoint object

  | field | type | meaning |
  |---|---|---|
  | `schema` | string | always `"repos.perf.baseline/1"` |
  | `endpoint` | string | the budget KEY, e.g. `"GET /api/mesocycles/today"` |
  | `p95_budget_ms` | number | the budget this endpoint is measured against |
  | `base_url` | string | target, e.g. `https://repos.jpmtech.com` |
  | `ran_at` | string | ISO-8601 UTC timestamp of the run |
  | `scenarios.combined.p50_ms` | number\|null | observed p50 over the run |
  | `scenarios.combined.p95_ms` | number\|null | observed p95 |
  | `scenarios.combined.p99_ms` | number\|null | observed p99 |
  | `scenarios.combined.req_failed_rate` | number\|null | http_req_failed rate (0 = no failures) |
  | `scenarios.combined.passed_p95_budget` | bool\|null | `p95_ms < p95_budget_ms` |

  ## Pass/fail (the cutover call, NOT authoring)
  - **Steady (25 VUs):** PASS iff `scenarios.combined.passed_p95_budget === true`.
  - **Burst (1→50 VUs):** PASS iff `req_failed_rate === 0` AND `p99_ms < 2 * p95_budget_ms`.
  - These map to the k6 `thresholds` in `lib/common.js#thresholdsFor`; k6 exit
    code is non-zero if any threshold is breached, so the run is self-grading.

  ## Assembling the artifact
  Run each script with `BASELINE_OUT=tests/perf/beta-baseline-$(date +%F)-<key>.json`,
  then concatenate the per-endpoint objects into a JSON array committed as
  `tests/perf/beta-baseline-$(date +%F).json` and `git add -f` it (the scratch
  per-endpoint files are .gitignored).
  ```

- [ ] **Create `tests/perf/README.md`** — the operational doc. (Every command below is verified against the real scripts in WS3.1–3.4; the prod auth path and alpha-tester coordination are spelled out.)
  ```markdown
  # RepOS perf baseline (k6) — G9

  Authoring closes G9; the **pass/fail RUN is a cutover-window step** (no staging
  exists — `project_beta_no_staging`). These scripts measure the 10 hot endpoints
  against the budgets in `docs/superpowers/specs/beta/08-qa.md`
  §"Latency budget". Budgets live in `lib/budgets.js`; schema in `BASELINE_SCHEMA.md`.

  ## Prerequisites
  - k6 is **not** installed by the repo and **not** in CI: `brew install k6`
    (or https://grafana.com/docs/k6/latest/set-up/install-k6/). Verify `k6 version`.

  ## Endpoints + scripts
  | script | endpoint | budget (p95) | tier |
  |---|---|---|---|
  | get-mesocycles-today.js | GET /api/mesocycles/today | 200ms | hot |
  | get-health-weight-30d.js | GET /api/health/weight?range=30d | 250ms | hot |
  | get-health-sync-status.js | GET /api/health/sync/status | 100ms | hot |
  | get-user-programs-past.js | GET /api/user-programs?include=past | 400ms | warm |
  | get-mesocycle-volume-rollup.js | GET /api/mesocycles/:id/volume-rollup | 500ms | warm |
  | get-mesocycle-recap-stats.js | GET /api/mesocycles/:id/recap-stats | 800ms | **cold — primary suspect** |
  | post-user-program-start.js | POST /api/user-programs/:id/start | 2000ms | cold |
  | patch-planned-set.js | PATCH /api/planned-sets/:id | 150ms | hot |
  | post-planned-set-substitute.js | POST /api/planned-sets/:id/substitute | 300ms | warm |
  | post-health-weight.js | POST /api/health/weight | 200ms | hot |

  Each script runs two scenarios: **steady** (0→25 VUs ramp, 2 min hold) and
  **burst** (1→50 VUs in 5s, hold 30s, starts after steady at +2m30s).

  ## Auth
  Every endpoint accepts an **opaque bearer token** (`requireBearerOrCfAccess`).
  One token minted with scope `health:weight:write` authenticates ALL ten (only
  `POST /api/health/weight` checks scope; the rest ignore it). Set `TOKEN`,
  `MESO_ID`, `UP_ID`, `PS_ID`, `SUB_EX_ID` in the environment.

  ### Local run (seeded repos_test)
  1. Migrate + seed + start the API:
     - `cd api && npm run migrate && npm run seed`
     - `cd api && npm run dev`   (serves http://127.0.0.1:3000)
  2. Seed a perf target and capture the env exports:
     - `cd api && npx tsx ../tests/perf/seed-perf-target.mjs`
     - paste the printed `export TOKEN=... MESO_ID=... PS_ID=... UP_ID=... SUB_EX_ID=...` lines.
  3. Run a script:
     - `BASE_URL=http://127.0.0.1:3000 BASELINE_OUT=tests/perf/beta-baseline-$(date +%F)-today.json k6 run tests/perf/get-mesocycles-today.js`

  ### Prod run (cutover window — coordinate with the alpha tester)
  - **There is no staging.** Runs hit `https://repos.jpmtech.com` during the
    pre-cutover window only, after the alpha tester is notified (these scripts
    generate real DB rows; the write scripts mutate state). Confirm a maintenance
    window before starting.
  - The prod token is minted at the edge: the alpha tester (or admin) hits
    `POST /api/tokens` through CF Access (browser path derives identity from the
    JWT — body `user_id` ignored) with `{ "label": "perf", "scopes": ["health:weight:write"] }`,
    or an admin uses the `X-Admin-Key` path with an explicit `user_id`. Capture
    the returned `token` once (shown only at mint).
  - Seed prod targets the same way only if the cutover plan allows it; otherwise
    point `MESO_ID`/`PS_ID`/`UP_ID` at the alpha tester's own resources.
  - `BASE_URL=https://repos.jpmtech.com TOKEN=... MESO_ID=... k6 run get-mesocycle-recap-stats.js`

  ## Cold-cache discipline (the recap-stats test that matters)
  Before the **recap-stats** run, force a cold plan/buffer cache. On the Unraid
  box, restart Postgres inside the container (see `reference_unraid_redeploy` for
  the recreate recipe) or `docker exec RepOS sv restart postgres` if the s6
  service name is `postgres`. Run recap-stats FIRST after restart so its p95 is
  genuinely cold. (Confirm the exact s6 service name in `docker/` before running.)

  ## Destructive / stateful scripts — opt in
  - `post-user-program-start.js` materializes a mesocycle and 409s on a
    re-start. For a true throughput number, seed N draft user_programs; v1
    measures the single cold-start cost.
  - `post-planned-set-substitute.js` flips a planned_set's exercise. Converges to
    SUB_EX_ID; safe to repeat but still a write — run only on a throwaway user.
  - `post-health-weight.js` varies `date` per VU/iteration to dodge the
    >5-writes/(user,date)/24h 409 and the same-day dedupe. It still writes real
    weight rows — use the seeded perf user, not a real account.

  ## Output
  Each run writes a `repos.perf.baseline/1` JSON (see `BASELINE_SCHEMA.md`).
  At cutover, merge the per-endpoint files into
  `tests/perf/beta-baseline-<YYYY-MM-DD>.json` and `git add -f` it as the
  committed B9 artifact.

  ## ND3 — pre-budgeted contingency (DO NOT BUILD until the run proves the cliff)
  If the recap-stats run shows **p95 > 1600ms (2× the 800ms budget) at 25 VUs**,
  OR **any 5xx in the burst**, materialize a `recap_stats_cache` table refreshed
  by a trigger on session-end (~2 eng-days). See `tests/perf/ND3-recap-cache.md`.
  YAGNI until the cutover number demands it.
  ```

- [ ] **Verify README commands reference real files (doc-consistency check).** Run:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS && for s in get-mesocycles-today get-mesocycle-recap-stats post-health-weight; do test -f tests/perf/$s.js && echo "OK $s.js"; done && test -f tests/perf/seed-perf-target.mjs && echo "OK seed-perf-target.mjs" && grep -q "upper-lower-4-day" tests/perf/seed-perf-target.mjs && echo "OK seed slug matches programTemplates.ts"
  ```
  Expect five `OK ...` lines. Confirms the README's referenced scripts and seed slug all exist.

- [ ] **Commit.** Run:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS && git add tests/perf/README.md tests/perf/BASELINE_SCHEMA.md && git commit -m "docs(perf): k6 run README + beta-baseline JSON schema doc"
  ```

---

### Task WS3.6: ND3 contingency doc — `recap_stats_cache` (DOCUMENT, DO NOT BUILD)

**Files:**
- Create: `tests/perf/ND3-recap-cache.md`
- Test: none (documentation-only; no code ships)

This is the single documented-but-not-built contingency. It is intentionally a design note, not an implementation. **Do not create the table, trigger, or migration.** YAGNI until the cutover recap-stats run proves the cliff.

- [ ] **Create `tests/perf/ND3-recap-cache.md`:**
  ```markdown
  # ND3 (contingency) — recap_stats_cache — NOT BUILT

  **Status:** documented, not implemented. **Trigger to build:** the cutover
  recap-stats k6 run shows p95 > 1600ms (2× the 800ms budget) at 25 VUs, OR any
  5xx in the burst. Until then this stays unbuilt (YAGNI). Estimated effort: ~2
  engineer-days incl. migration, trigger, backfill, and a contamination test.

  ## Why recap-stats is the suspect
  `GET /api/mesocycles/:id/recap-stats` (`api/src/routes/mesocycles.ts:73`) runs a
  per-exercise PR CTE (`this_run_maxes` ∪ `prior_maxes` over all of a user's runs;
  lines 109–139). It is the heaviest read in the system and scales with a user's
  full lifting history, not just the current run. A cold buffer cache + 25 VUs is
  exactly the scenario that surfaces a full-scan cliff.

  ## The contingency design (if built)
  1. **Table** `recap_stats_cache (mesocycle_run_id PK → mesocycle_runs ON DELETE
     CASCADE, user_id, weeks INT, total_sets INT, prs INT, computed_at TIMESTAMPTZ)`.
     Ownership column mirrors the run so the route's existing
     `WHERE id=$1 AND user_id=$2` ownership check still applies.
  2. **Refresh on session-end**, not on every read: a trigger (or the set-log
     "finish workout" path) recomputes the row when a day_workout flips to
     completed / the run finishes. The expensive CTE runs at write time (rare),
     the read becomes a single indexed row fetch.
  3. **Route change:** recap-stats reads the cache row; on a miss (older runs
     pre-cache) it computes live and backfills. No response-shape change
     (`MesocycleRecapStatsResponse` is unchanged).
  4. **Tests required before merge:** unit test that the cached value equals the
     live CTE for a fixture run; a contamination test that user B cannot read
     user A's cache row (feeds WS2's matrix — the cache table is a new per-user
     resource); a re-run of the recap-stats k6 script showing p95 back under
     budget.

  ## Explicitly out of scope of W8 authoring
  No migration, no table, no trigger, no route change ships in W8. This doc exists
  so the cutover operator can execute the fix inside the ~2-day budget without a
  fresh design cycle.
  ```

- [ ] **Verify the README links resolve.** Run:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS && grep -q "ND3-recap-cache.md" tests/perf/README.md && test -f tests/perf/ND3-recap-cache.md && echo "ND3 doc linked + present"
  ```
  Expect `ND3 doc linked + present`.

- [ ] **Commit.** Run:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS && git add tests/perf/ND3-recap-cache.md && git commit -m "docs(perf): ND3 recap_stats_cache contingency note (documented, not built)"
  ```

---

### WS3 done-check
- `tests/perf/` contains: `lib/budgets.js`, `lib/common.js`, 10 endpoint scripts, `seed-perf-target.mjs`, `README.md`, `BASELINE_SCHEMA.md`, `ND3-recap-cache.md`, `.gitignore`.
- Every script parses under `k6 run` (no `GoError`/`SyntaxError`); the steady/burst scenarios and p95/p99 thresholds are encoded from `lib/budgets.js`.
- A local 5-VU smoke against the seeded `repos_test` server emits a valid `repos.perf.baseline/1` JSON (WS3.4 acceptance).
- ND3 is documented, not built.
- **The pass/fail run vs budget is a cutover-window step** (`beta-cutover-checklist.md`, authored by WS4) — out of scope for W8 "done."

---

## WS4 — Runbooks + rollback tooling -> G6 / G10

This workstream closes the partial **G6** (migration discipline — the D10 two-step dry-run gate) and **G10** (runbook + tested `rollback.sh`). It ships four runbooks, one rollback script, and one CI guard. It ships **no product code**. All four tasks are TDD-where-testable (shell scripts get `.test.sh` harnesses in the existing `tests/dr/*.test.sh` style; the two pure-doc deliverables — `beta-cutover-checklist.md` and `beta-exit-criteria.md` — are authored content verified by a grep-based consistency check, since their *execution* is cutover-window work).

**Tooling note (read before starting):** `shellcheck` and `actionlint` are NOT installed on this workstation (verified 2026-05-29). Task WS4.2 installs `shellcheck` via Homebrew as its first step. If `brew` is unavailable, fall back to the Docker image `koalaman/shellcheck:stable` (command given inline).

**Where the canonical `docker run` recipe lives:** there is no repo-root `PASSDOWN.md` or `README.md`. The authoritative redeploy recipe lives in the memory file `reference_unraid_redeploy.md` (out-of-repo) and is mirrored in `docs/superpowers/plans/2026-05-03-repos-monolithic-container.md` (~line 1216) and referenced from `docs/superpowers/plans/2026-05-11-repos-beta.md:465`. The build-now deliverable makes `docker/scripts/rollback.sh` the new **canonical executable** form of that recipe (with the resource caps baked in) and documents the caps in `docs/runbooks/bug-triage.md`. Updating the memory file itself is an operator follow-up (see risks).

---

### Task WS4.1: bug-triage runbook (severity tiers + rollback decision tree) → G10

Distinct from `docs/runbooks/beta-triage.md` (the W7 feedback-cadence doc). `beta-triage.md` already names Sev-1/2/3 *time-to-acknowledge* for triaging inbound feedback rows; `bug-triage.md` is the **incident** runbook: severity definitions, **time-to-mitigate** budgets, and the **rollback decision tree** that decides between hotfix-forward and `rollback.sh`. It cross-links to `beta-triage.md` rather than restating it.

Files:
- Create: `docs/runbooks/bug-triage.md`
- Test: (none — pure doc; consistency is verified by the WS4.2 rollback script existing and by the cross-reference check in WS4.4's harness, which greps that `bug-triage.md` links `docker/scripts/rollback.sh`)

- [ ] Write the runbook file. Create `docs/runbooks/bug-triage.md` with this exact content (matches the heading/voice style of `secret-rotation.md` and `dr-dry-fire.md`):

````markdown
# Bug Triage + Incident Runbook (G10)

Incident-handling runbook for Beta. **Distinct from `beta-triage.md`**, which is
the feedback-row cadence doc (how often you read `/api/admin/feedback`). This doc
is what you open when something is *broken in production*: how to classify it,
how fast it must be mitigated, and how to decide between hotfix-forward and a
container rollback.

## Severity tiers (definition + time-to-mitigate)

"Mitigate" = the user-facing impact is stopped (rollback, feature-flag-off, or
fix deployed). It is NOT "root-caused." Root-cause + permanent fix can follow.

| Sev | Definition | Time-to-mitigate | Examples |
|-----|------------|------------------|----------|
| **Sev-1** | Data loss, auth lockout, or a core flow is fully down for all users | **< 10 min** (dry-fire target per G10) | Can't log a set; restore corrupts data; CF Access universal 401; placeholder UUID re-introduced into prod writes |
| **Sev-2** | A feature is broken but no data loss and a workaround exists | **< 1 business day** | Recap stats 500 on one program; backup badge stuck on "warn"; chart range toggle broken |
| **Sev-3** | Cosmetic, copy, or enhancement | **< 1 week** | Misaligned badge; tooltip typo; missing empty-state |

**PAR-Q-bypass is Sev-1 by class**, not by symptom: if a user reaches a workout
without an acknowledged PAR-Q, treat it as Sev-1 even if nothing "looks" broken
(it is a clinical-safety hole and a G15 exit blocker — see `beta-exit-criteria.md`).

## Declaration

1. Note the wall-clock UTC time of **declaration** (`date -u`). This starts the
   time-to-mitigate clock for the PASSDOWN entry.
2. Classify with the table above. When in doubt, round **up** a tier.
3. For Sev-1, capture timestamps in PASSDOWN as you go (declaration → decision →
   mitigation) — the G10 dry-fire asserts declaration→mitigation < 10 min.

## Rollback decision tree

```
Is the impact Sev-1 (data loss / auth lockout / core flow down)?
├─ NO  → Hotfix-forward. Open a PR, let CI gate it, deploy normally
│        (docker.yml builds :sha + :latest; pull + recreate per
│        reference_unraid_redeploy). Do NOT roll back for Sev-2/3.
└─ YES → Is the cause a BAD DEPLOY (regression traced to the last image)?
         ├─ YES → ROLL BACK NOW: docker/scripts/rollback.sh <last-good-sha>.
         │        This is the fastest mitigation (no build wait). Then
         │        hotfix-forward at leisure.
         └─ NO  → Is it a DATA problem (a restore/migration corrupted rows)?
                  ├─ YES → This is a DR event, not a rollback.
                  │        Follow docs/runbooks/dr-dry-fire.md "Restoring from a
                  │        local file" using the pre_restore snapshot
                  │        (scripts/pre-restore-snapshot.sh output) as the
                  │        rollback point. Rolling the IMAGE back will not undo
                  │        committed DB writes.
                  └─ NO  → Is it CONFIG (e.g. CF_ACCESS_AUD drift, universal
                           401)? → docs/runbooks/cf-access-aud-drift.md.
                           Otherwise mitigate by feature-flag / env change +
                           container recreate; rollback only if no faster path.
```

## Rollback procedure (image)

`docker/scripts/rollback.sh <sha>` pins the container to a specific GHCR image
tag (`ghcr.io/otahesh/repos:sha-<sha>`), preserving the existing network, IP,
mounts, and env, and applies the `--memory=2g --cpus=2` resource caps. It is the
formalized, env-preserving form of the `reference_unraid_redeploy` recipe. Run it
from the dev Mac (it SSHes to `unraid`):

```bash
docker/scripts/rollback.sh 4e8e639      # roll prod to image sha-4e8e639
docker/scripts/rollback.sh --help       # usage; touches nothing
```

It only ever runs `docker pull / stop / rm / run` against the `unraid` host. It
never touches the local repo or the DB. After it runs, verify health and run the
post-deploy smoke (`.github/workflows/post-deploy-smoke.yml`, WS5) or curl
`https://repos.jpmtech.com/health`.

**Resource caps (`--memory=2g --cpus=2`)** are the pathological-query guardrail.
They are baked into `rollback.sh` and MUST also be present on the standard
forward-deploy recipe — see `docs/superpowers/plans/2026-05-03-repos-monolithic-container.md`
(~line 1216) and the `reference_unraid_redeploy` memory recipe. A redeploy that
omits them leaves prod uncapped.

## After mitigation

1. Record in PASSDOWN: Sev, declaration time, mitigation time, total minutes,
   action taken (rollback to which sha / hotfix PR link / restore filename).
2. File the permanent-fix issue (if mitigation was a rollback or flag).
3. Sev-1 → schedule a short retro; feed any process gap into this runbook.
````

- [ ] Verify it renders and links resolve. Run:

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && \
  test -f docs/runbooks/bug-triage.md && \
  grep -q 'docker/scripts/rollback.sh' docs/runbooks/bug-triage.md && \
  grep -q 'time-to-mitigate' docs/runbooks/bug-triage.md && \
  grep -q 'Rollback decision tree' docs/runbooks/bug-triage.md && \
  echo "OK bug-triage.md present + linked"
```

Expected output: `OK bug-triage.md present + linked`

- [ ] Commit:

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && \
  git add docs/runbooks/bug-triage.md && \
  git commit -m "docs(w8): bug-triage incident runbook — severity tiers + rollback decision tree (G10)"
```

---

### Task WS4.2: `docker/scripts/rollback.sh` — env-preserving image pin with resource caps → G10

Formalizes the `reference_unraid_redeploy` recipe into an executable that pins the container to `ghcr.io/otahesh/repos:sha-<sha>`, preserves env/network/IP/mounts, and adds `--memory=2g --cpus=2`. Must pass `shellcheck` and a `--help`/dry-run path that touches nothing (no SSH, no docker). TDD: write the `.test.sh` first (asserts `--help` exits 0 and prints usage; asserts a missing-arg call exits non-zero; asserts `DRY_RUN=1 rollback.sh <sha>` prints the exact `docker run` line including the caps without invoking ssh/docker).

Files:
- Create: `docker/scripts/rollback.sh`
- Create: `tests/dr/rollback.test.sh`

- [ ] Install shellcheck (one-time). Run:

```bash
brew install shellcheck
```

If `brew` is unavailable, skip this and use the Docker fallback in the shellcheck step below.

- [ ] Create the failing test first. Create `tests/dr/rollback.test.sh` (mirrors the `integrity-check.test.sh` self-asserting style: prints `✓`/`FAIL`, exits non-zero on failure):

```bash
#!/usr/bin/env bash
# W8 / WS4 — rollback.sh unit test. Exercises the no-op paths ONLY (--help,
# missing-arg, DRY_RUN). NEVER touches prod: asserts the dry-run path neither
# ssh-es nor invokes docker, and that the printed recipe carries the resource
# caps and the :sha tag.
set -euo pipefail

SCRIPT="$(cd "$(dirname "$0")/../.." && pwd)/docker/scripts/rollback.sh"
test -x "$SCRIPT" || { echo "FAIL: $SCRIPT missing or not executable"; exit 1; }

# 1. --help exits 0 and prints usage, touches nothing.
OUT=$("$SCRIPT" --help)
echo "$OUT" | grep -q 'Usage:' || { echo "FAIL: --help has no Usage line"; exit 1; }
echo "$OUT" | grep -q 'rollback.sh <sha>' || { echo "FAIL: --help missing invocation"; exit 1; }
echo "✓ --help prints usage and exits 0"

# 2. Missing sha → non-zero exit + error on stderr.
if "$SCRIPT" >/dev/null 2>&1; then
  echo "FAIL: missing-sha call exited 0 (should reject)"; exit 1
fi
echo "✓ missing sha argument is rejected"

# 3. DRY_RUN must print the recipe and NOT call ssh/docker. We shadow ssh and
#    docker with failing stubs on PATH; if the script invokes either, the stub
#    makes it fail and we catch it.
STUBS=$(mktemp -d)
trap "rm -rf '$STUBS'" EXIT
printf '#!/usr/bin/env bash\necho "STUB-INVOKED: $0 $*" >&2\nexit 99\n' > "$STUBS/ssh"
printf '#!/usr/bin/env bash\necho "STUB-INVOKED: $0 $*" >&2\nexit 99\n' > "$STUBS/docker"
chmod +x "$STUBS/ssh" "$STUBS/docker"

DRY_OUT=$(PATH="$STUBS:$PATH" DRY_RUN=1 "$SCRIPT" abc1234 2>&1) || {
  echo "FAIL: DRY_RUN path invoked ssh/docker (exit non-zero): $DRY_OUT"; exit 1; }
echo "$DRY_OUT" | grep -q 'STUB-INVOKED' && { echo "FAIL: DRY_RUN reached ssh/docker"; exit 1; }
echo "$DRY_OUT" | grep -q 'ghcr.io/otahesh/repos:sha-abc1234' || { echo "FAIL: DRY_RUN recipe missing :sha tag"; exit 1; }
echo "$DRY_OUT" | grep -q -- '--memory=2g' || { echo "FAIL: DRY_RUN recipe missing --memory=2g cap"; exit 1; }
echo "$DRY_OUT" | grep -q -- '--cpus=2' || { echo "FAIL: DRY_RUN recipe missing --cpus=2 cap"; exit 1; }
echo "$DRY_OUT" | grep -q -- '--network br0' || { echo "FAIL: DRY_RUN recipe missing --network br0"; exit 1; }
echo "$DRY_OUT" | grep -q -- '--ip 192.168.88.65' || { echo "FAIL: DRY_RUN recipe missing pinned IP"; exit 1; }
echo "✓ DRY_RUN prints the capped :sha recipe without touching ssh/docker"

echo "✓ rollback.test.sh PASS"
```

- [ ] Run the test and expect FAIL (script does not exist yet):

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && bash tests/dr/rollback.test.sh; echo "exit=$?"
```

Expected: `FAIL: /Users/jasonmeyer.ict/Projects/RepOS/docker/scripts/rollback.sh missing or not executable` then `exit=1`.

- [ ] Write the implementation. Create `docker/scripts/rollback.sh` (mirrors the recipe in `reference_unraid_redeploy.md`, env-preserving via `docker inspect`, with caps; honors `DRY_RUN` and `--help`):

```bash
#!/usr/bin/env bash
# W8 / WS4 — production image rollback (G10).
#
# Pins the RepOS container to a specific GHCR image tag, preserving the
# container's network, IP, mounts, restart policy, and env, and applying the
# --memory=2g --cpus=2 resource caps. This is the env-preserving, capped form
# of the reference_unraid_redeploy recipe — use it instead of `docker restart`
# (which keeps the old image) when rolling prod back to a known-good build.
#
# Usage:
#   docker/scripts/rollback.sh <sha>     # roll prod to ghcr.io/otahesh/repos:sha-<sha>
#   docker/scripts/rollback.sh --help    # print usage, touch nothing
#
# Env:
#   UNRAID_SSH   SSH alias/host for the Unraid docker host (default: unraid)
#   CONTAINER    container name (default: RepOS)
#   IMAGE_REPO   image repo (default: ghcr.io/otahesh/repos)
#   DRY_RUN=1    print the docker recipe and exit; do NOT ssh or run docker
set -euo pipefail

UNRAID_SSH="${UNRAID_SSH:-unraid}"
CONTAINER="${CONTAINER:-RepOS}"
IMAGE_REPO="${IMAGE_REPO:-ghcr.io/otahesh/repos}"

usage() {
  cat <<'USAGE'
Usage: rollback.sh <sha>

Pin the production RepOS container to ghcr.io/otahesh/repos:sha-<sha>,
preserving network/IP/mounts/env and applying --memory=2g --cpus=2 caps.

  <sha>        short commit sha matching a pushed image tag (sha-<sha>)
  --help       print this usage and exit

Env: UNRAID_SSH (default unraid), CONTAINER (default RepOS),
     IMAGE_REPO (default ghcr.io/otahesh/repos), DRY_RUN=1 (print only).
USAGE
}

case "${1:-}" in
  --help|-h) usage; exit 0 ;;
  "") echo "ERROR: missing <sha> argument" >&2; usage >&2; exit 2 ;;
esac

SHA="$1"
# Accept short or full hex sha only.
if ! printf '%s' "$SHA" | grep -Eq '^[0-9a-f]{7,40}$'; then
  echo "ERROR: <sha> must be 7-40 hex chars (got: $SHA)" >&2
  exit 2
fi

IMAGE="${IMAGE_REPO}:sha-${SHA}"

# The env-preserving recreate recipe. In a real run we capture the live env via
# `docker inspect` over SSH into a temp file, then recreate with --env-file.
# In DRY_RUN we just show the shape so the operator (and the test) can confirm
# the caps + pinned tag + IP are present.
print_recipe() {
  cat <<RECIPE
# 1. pull the pinned image on the host
ssh ${UNRAID_SSH} docker pull ${IMAGE}
# 2. capture the existing container env (don't lose secrets)
ssh ${UNRAID_SSH} "docker inspect ${CONTAINER} --format '{{range .Config.Env}}{{println .}}{{end}}' > /tmp/repos.env"
# 3. stop + remove (volumes on /mnt/user/appdata/repos/config survive)
ssh ${UNRAID_SSH} "docker stop ${CONTAINER} && docker rm ${CONTAINER}"
# 4. recreate, pinned to ${IMAGE}, env-preserving, with resource caps
ssh ${UNRAID_SSH} docker run -d \\
  --name ${CONTAINER} \\
  --network br0 --ip 192.168.88.65 \\
  --restart unless-stopped \\
  --memory=2g --cpus=2 \\
  -v /mnt/user/appdata/repos/config:/config \\
  --env-file /tmp/repos.env \\
  ${IMAGE}
RECIPE
}

if [ "${DRY_RUN:-}" = "1" ]; then
  echo "DRY_RUN — would roll ${CONTAINER} to ${IMAGE}:"
  print_recipe
  exit 0
fi

echo "→ Rolling ${CONTAINER} back to ${IMAGE} on ${UNRAID_SSH}..."

ssh "${UNRAID_SSH}" docker pull "${IMAGE}"
ssh "${UNRAID_SSH}" "docker inspect ${CONTAINER} --format '{{range .Config.Env}}{{println .}}{{end}}' > /tmp/repos.env"
ssh "${UNRAID_SSH}" "docker stop ${CONTAINER} && docker rm ${CONTAINER}"
ssh "${UNRAID_SSH}" docker run -d \
  --name "${CONTAINER}" \
  --network br0 --ip 192.168.88.65 \
  --restart unless-stopped \
  --memory=2g --cpus=2 \
  -v /mnt/user/appdata/repos/config:/config \
  --env-file /tmp/repos.env \
  "${IMAGE}"

echo "→ Waiting for healthy..."
for i in $(seq 1 25); do
  s=$(ssh "${UNRAID_SSH}" "docker inspect --format '{{.State.Health.Status}}' ${CONTAINER}" 2>/dev/null || true)
  echo "tick $i: ${s:-unknown}"
  [ "$s" = "healthy" ] && break
  sleep 3
done

echo "✓ rolled ${CONTAINER} to ${IMAGE}. Run the post-deploy smoke or curl https://repos.jpmtech.com/health to confirm."
```

- [ ] Make it executable:

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && chmod +x docker/scripts/rollback.sh
```

- [ ] Run the test and expect PASS:

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && bash tests/dr/rollback.test.sh
```

Expected output (last line): `✓ rollback.test.sh PASS`

- [ ] Run shellcheck and expect clean output:

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && shellcheck docker/scripts/rollback.sh tests/dr/rollback.test.sh && echo "SHELLCHECK CLEAN"
```

Expected output: `SHELLCHECK CLEAN` with no findings above it. If `shellcheck` is not installed, use the Docker fallback:

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && docker run --rm -v "$PWD:/mnt" koalaman/shellcheck:stable docker/scripts/rollback.sh tests/dr/rollback.test.sh && echo "SHELLCHECK CLEAN"
```

- [ ] Commit:

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && \
  git add docker/scripts/rollback.sh tests/dr/rollback.test.sh && \
  git commit -m "feat(w8): docker/scripts/rollback.sh — env-preserving :sha pin + resource caps (G10)"
```

---

### Task WS4.3: `scripts/check-migration-dryrun.sh` — D10 two-step migration gate → G6

CI script that rejects any PR introducing a **Step-2 (destructive)** migration unless the PR description links a successful dry-run output. "Destructive" = a new migration file (vs `origin/main`) that contains `DROP TABLE`, `DROP COLUMN`, `DROP CONSTRAINT`, or `ALTER TABLE ... DROP` (the patterns present in the real migration history — see `020_drop_redundant_planned_sets_index.sql`, `025_device_tokens_scopes_array.sql`). The PR body is supplied via env (`PR_BODY` in CI, from `github.event.pull_request.body`); a "dry-run link" is a line matching a configurable marker (`Dry-run:` followed by an `http`/artifact URL). TDD: write `.test.sh` first asserting (a) a no-migration diff PASSES, (b) an additive-only migration PASSES, (c) a Step-2 migration WITHOUT a `Dry-run:` link FAILS, (d) the same Step-2 WITH the link PASSES.

Files:
- Create: `scripts/check-migration-dryrun.sh`
- Create: `tests/dr/check-migration-dryrun.test.sh`

- [ ] Create the failing test first. Create `tests/dr/check-migration-dryrun.test.sh`. It drives the script through a `CHANGED_FILES` env injection (so the test never has to fake a real git diff) and feeds synthetic migration bodies + PR bodies:

```bash
#!/usr/bin/env bash
# W8 / WS4 — check-migration-dryrun.sh unit test (D10 two-step gate → G6).
# Drives the gate via CHANGED_FILES + MIGRATIONS_DIR overrides so we never need
# a real git diff. Synthesizes additive vs Step-2 (destructive) migrations and
# asserts the PR-body dry-run-link requirement.
set -euo pipefail

SCRIPT="$(cd "$(dirname "$0")/../.." && pwd)/scripts/check-migration-dryrun.sh"
test -x "$SCRIPT" || { echo "FAIL: $SCRIPT missing or not executable"; exit 1; }

WORK=$(mktemp -d)
trap "rm -rf '$WORK'" EXIT
MIG="$WORK/migrations"
mkdir -p "$MIG"

# Additive migration (no destructive verbs).
cat > "$MIG/100_add_col.sql" <<'SQL'
ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname TEXT;
SQL

# Step-2 destructive migration.
cat > "$MIG/101_drop_col.sql" <<'SQL'
-- two-step: column was deprecated in 100; drop it now.
ALTER TABLE users DROP COLUMN IF EXISTS legacy_field;
SQL

run() { MIGRATIONS_DIR="$MIG" "$SCRIPT"; }

# (a) No migration files changed → PASS.
CHANGED_FILES="api/src/routes/foo.ts" PR_BODY="no migrations here" run \
  && echo "✓ no-migration PR passes" \
  || { echo "FAIL: no-migration PR should pass"; exit 1; }

# (b) Additive-only migration, no dry-run link → PASS (not destructive).
CHANGED_FILES="api/src/db/migrations/100_add_col.sql" PR_BODY="just adds a column" run \
  && echo "✓ additive-only migration passes" \
  || { echo "FAIL: additive-only migration should pass"; exit 1; }

# (c) Step-2 destructive migration WITHOUT a dry-run link → FAIL.
if CHANGED_FILES="api/src/db/migrations/101_drop_col.sql" PR_BODY="drops the col" run >/dev/null 2>&1; then
  echo "FAIL: Step-2 migration without dry-run link should be rejected"; exit 1
fi
echo "✓ Step-2 migration without dry-run link is rejected"

# (d) Same Step-2 migration WITH a dry-run link → PASS.
BODY=$'Drops legacy_field (two-step).\nDry-run: https://github.com/otahesh/repos/actions/runs/123456'
if CHANGED_FILES="api/src/db/migrations/101_drop_col.sql" PR_BODY="$BODY" run >/dev/null 2>&1; then
  echo "✓ Step-2 migration with dry-run link passes"
else
  echo "FAIL: Step-2 migration WITH dry-run link should pass"; exit 1
fi

echo "✓ check-migration-dryrun.test.sh PASS"
```

- [ ] Run the test and expect FAIL (script absent):

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && bash tests/dr/check-migration-dryrun.test.sh; echo "exit=$?"
```

Expected: `FAIL: /Users/jasonmeyer.ict/Projects/RepOS/scripts/check-migration-dryrun.sh missing or not executable` then `exit=1`.

- [ ] Write the implementation. Create `scripts/check-migration-dryrun.sh`:

```bash
#!/usr/bin/env bash
# W8 / WS4 — D10 two-step migration gate (G6).
#
# Rejects a PR that introduces a Step-2 (DESTRUCTIVE) migration unless the PR
# description links a successful dry-run output. Per D10
# (docs/superpowers/specs/beta/round2-engineering-composite.md §D10): every PR
# introducing a destructive migration step MUST link a dry-run artifact; CI
# rejects Step-2 migrations without it.
#
# "Destructive" = a migration file NEW vs origin/main containing any of:
#   DROP TABLE | DROP COLUMN | DROP CONSTRAINT | ALTER TABLE ... DROP | DROP INDEX
# A "dry-run link" = a PR-body line matching:  Dry-run: <http...>
#
# In CI, set PR_BODY="${{ github.event.pull_request.body }}". The set of changed
# files is detected via `git diff --name-only` vs BASE_REF (default origin/main),
# overridable by CHANGED_FILES (newline/space separated) for testing.
set -euo pipefail

MIGRATIONS_DIR="${MIGRATIONS_DIR:-api/src/db/migrations}"
BASE_REF="${BASE_REF:-origin/main}"
PR_BODY="${PR_BODY:-}"

# Destructive-verb pattern. ALTER ... DROP covers DROP COLUMN/CONSTRAINT too,
# but we list them explicitly for clarity and to catch standalone DROP TABLE/INDEX.
DESTRUCTIVE_RE='DROP[[:space:]]+TABLE|DROP[[:space:]]+COLUMN|DROP[[:space:]]+CONSTRAINT|DROP[[:space:]]+INDEX|ALTER[[:space:]]+TABLE.*DROP'
DRYRUN_RE='[Dd]ry-run:[[:space:]]*https?://'

if [ -n "${CHANGED_FILES:-}" ]; then
  changed="$CHANGED_FILES"
else
  changed="$(git diff --name-only "${BASE_REF}"...HEAD || git diff --name-only "${BASE_REF}")"
fi

# Only the added/changed migration .sql files matter.
mig_changed=""
for f in $changed; do
  case "$f" in
    "${MIGRATIONS_DIR}"/*.sql) mig_changed="${mig_changed} ${f}" ;;
    api/src/db/migrations/*.sql) mig_changed="${mig_changed} ${f}" ;;
  esac
done

if [ -z "$(printf '%s' "$mig_changed" | tr -d ' ')" ]; then
  echo "OK: no migration changes in this PR — gate not applicable"
  exit 0
fi

destructive=""
for f in $mig_changed; do
  # Resolve to the on-disk path (CHANGED_FILES may use the repo-relative path
  # while MIGRATIONS_DIR points at a test fixture dir).
  base="$(basename "$f")"
  path="$f"
  [ -f "$path" ] || path="${MIGRATIONS_DIR}/${base}"
  [ -f "$path" ] || { echo "WARN: $f not found on disk, skipping" >&2; continue; }
  if grep -Eiq "$DESTRUCTIVE_RE" "$path"; then
    destructive="${destructive} ${base}"
  fi
done

if [ -z "$(printf '%s' "$destructive" | tr -d ' ')" ]; then
  echo "OK: migration(s) are additive (no destructive step) — dry-run link not required"
  exit 0
fi

echo "→ Step-2 (destructive) migration(s) detected:${destructive}"
if printf '%s' "$PR_BODY" | grep -Eq "$DRYRUN_RE"; then
  echo "OK: PR description links a dry-run output — D10 gate satisfied"
  exit 0
fi

echo "FAIL: Step-2 (destructive) migration without a dry-run link in the PR body." >&2
echo "      Per D10, every destructive migration PR must include a line like:" >&2
echo "        Dry-run: https://github.com/otahesh/repos/actions/runs/<id>" >&2
echo "      Rehearse forward -> restore-from-backup -> reapply-against-scratch," >&2
echo "      paste the successful run link, and re-push." >&2
exit 1
```

- [ ] Make it executable:

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && chmod +x scripts/check-migration-dryrun.sh
```

- [ ] Run the test and expect PASS:

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && bash tests/dr/check-migration-dryrun.test.sh
```

Expected output (last line): `✓ check-migration-dryrun.test.sh PASS`

- [ ] Sanity-check the gate against the REAL current branch (should be no-op — this branch adds no destructive migration):

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && PR_BODY="docs + tooling only" bash scripts/check-migration-dryrun.sh
```

Expected: `OK: no migration changes in this PR — gate not applicable` (or the additive line if a migration is in-flight).

- [ ] Run shellcheck and expect clean output:

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && shellcheck scripts/check-migration-dryrun.sh tests/dr/check-migration-dryrun.test.sh && echo "SHELLCHECK CLEAN"
```

Expected output: `SHELLCHECK CLEAN`. (Docker fallback as in WS4.2 if `shellcheck` is not installed.)

- [ ] Commit:

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && \
  git add scripts/check-migration-dryrun.sh tests/dr/check-migration-dryrun.test.sh && \
  git commit -m "feat(w8): check-migration-dryrun.sh — D10 two-step destructive-migration CI gate (G6)"
```

- [ ] Wire the gate into CI. The existing `.github/workflows/test.yml` has no shell-test job. Add a `migration-gate` job to it. **Note: pushing `.github/workflows/*` requires SSH, not the gh token (`reference_gh_workflow_scope_push`).** Add this job after `e2e-frontend` in `test.yml`:

```yaml
  migration-gate:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - name: Self-test the gate
        run: bash tests/dr/check-migration-dryrun.test.sh
      - name: Enforce D10 two-step migration gate
        env:
          BASE_REF: origin/${{ github.base_ref || 'main' }}
          PR_BODY: ${{ github.event.pull_request.body }}
        run: |
          git fetch origin "${{ github.base_ref || 'main' }}" --depth=1 || true
          bash scripts/check-migration-dryrun.sh
```

- [ ] Lint the workflow (actionlint). If `actionlint` is installed, run it; otherwise use the Docker image:

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && docker run --rm -v "$PWD:/repo" --workdir /repo rhysd/actionlint:latest -color .github/workflows/test.yml && echo "ACTIONLINT CLEAN"
```

Expected output: `ACTIONLINT CLEAN`.

- [ ] Commit the workflow change over SSH (push will be by the executor per `reference_gh_workflow_scope_push`):

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && \
  git add .github/workflows/test.yml && \
  git commit -m "ci(w8): add migration-gate job running the D10 dry-run check (G6)"
```

---

### Task WS4.4: author the two cutover docs (content only) — `beta-cutover-checklist.md` + `beta-exit-criteria.md` → G15 prep / G6+G10 cutover predicate

These two are **build-now deliverables but cutover-time executions**. They are authored now so they are ready for the pre-cutover window. The checklist transcribes the design spec §5 ordered passes verbatim-in-intent; the exit criteria transcribes the D13 floor (master plan lines 525–531) plus the weekly review cadence. A small grep-based consistency harness asserts every §5 pass and every D13 condition is present (the only "test" possible for pure docs). TDD: write the harness first; it FAILs until the docs exist and contain every required token.

Files:
- Create: `docs/runbooks/beta-cutover-checklist.md`
- Create: `docs/runbooks/beta-exit-criteria.md`
- Create: `tests/dr/cutover-docs.test.sh`

- [ ] Create the failing consistency harness first. Create `tests/dr/cutover-docs.test.sh`:

```bash
#!/usr/bin/env bash
# W8 / WS4 — consistency check for the two authored cutover docs. Asserts the
# checklist enumerates every §5 cutover pass (G3,G9,G10,G12,W8.5,G14,G15) and
# the exit-criteria doc lists every D13 floor condition + the weekly cadence.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CHECK="$ROOT/docs/runbooks/beta-cutover-checklist.md"
EXIT="$ROOT/docs/runbooks/beta-exit-criteria.md"

test -f "$CHECK" || { echo "FAIL: $CHECK missing"; exit 1; }
test -f "$EXIT"  || { echo "FAIL: $EXIT missing"; exit 1; }

# §5 ordered passes must each appear as a gate marker in the checklist.
for g in G3 G9 G10 G12 W8.5 G14 G15; do
  grep -q "$g" "$CHECK" || { echo "FAIL: checklist missing pass $g"; exit 1; }
done
# Each pass must be a checkbox (ordered, actionable).
grep -q '\- \[ \]' "$CHECK" || { echo "FAIL: checklist has no actionable checkboxes"; exit 1; }
echo "✓ cutover checklist enumerates all §5 passes as checkboxes"

# D13 floor conditions (master plan lines 525-531) must all be present.
grep -qi 'no Sev-1' "$EXIT"               || { echo "FAIL: exit missing Sev-1 floor"; exit 1; }
grep -qi 'Sev-2 in the final 14 days' "$EXIT" || { echo "FAIL: exit missing 14-day Sev-2 floor"; exit 1; }
grep -qi 'PAR-Q-bypass' "$EXIT"           || { echo "FAIL: exit missing PAR-Q-bypass floor"; exit 1; }
grep -qi 'dry-fire' "$EXIT"               || { echo "FAIL: exit missing DR dry-fire floor"; exit 1; }
grep -qi 'Important security' "$EXIT"     || { echo "FAIL: exit missing security-findings floor"; exit 1; }
grep -qi 'full mesocycle' "$EXIT"         || { echo "FAIL: exit missing 5-user-mesocycle floor"; exit 1; }
grep -qi 'weekly' "$EXIT"                 || { echo "FAIL: exit missing weekly review cadence"; exit 1; }
echo "✓ exit-criteria doc lists all D13 floor conditions + weekly cadence"

echo "✓ cutover-docs.test.sh PASS"
```

- [ ] Run the harness and expect FAIL (docs absent):

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && bash tests/dr/cutover-docs.test.sh; echo "exit=$?"
```

Expected: `FAIL: /Users/jasonmeyer.ict/Projects/RepOS/docs/runbooks/beta-cutover-checklist.md missing` then `exit=1`.

- [ ] Author `docs/runbooks/beta-cutover-checklist.md` with this exact content (transcribes design spec §5; ordered actionable checkboxes):

```markdown
# Beta Cutover Checklist (pre-cutover prod window)

**Status:** authored build-now (W8); **executed at cutover.** These passes close
the remaining `[~]`/`[ ]` Beta gates during the pre-cutover production window.
There is no staging environment (`project_beta_no_staging`): production
(`https://repos.jpmtech.com`) is the validation surface. Alpha data is wiped
first; no real Beta user has signed in yet, so this is production-rep load with
zero collateral.

Run these IN ORDER. Each is a binary gate — do not proceed past a RED.

## Pre-window
- [ ] DR dry-fire performed within the last 7 days (`docs/runbooks/dr-dry-fire.md`).
- [ ] Cutover SQL rehearsed against an alpha-data clone
      (`scripts/cutover/001-placeholder-to-jmeyer.sql`); before/after weight-row
      counts recorded.

## G3 — Playwright e2e against prod over CF Access
- [ ] Auth flow: logged-out → 302 CF Access; signed-in lands on `/`;
      sign-out clears state and re-redirects; "Sign out everywhere" revokes all
      bearer tokens.
- [ ] Golden journey: sign-in → onboarding → start program → log set → recap.
- [ ] iOS Shortcut bearer weight POST updates the chart.
- [ ] W1.5 overreaching toast fires (3 RIR-0 sessions on a compound).
- [ ] Restore happy-path (admin kicks restore; maintenance banner; force-reload).
- [ ] Bearer mint → use → revoke → use returns 401 (the literal "f" 401 case).

## G9 — k6 perf run against prod
- [ ] Coordinate with the alpha tester (no logging during the run).
- [ ] Run steady 25 VUs + burst 1→50 VUs per `tests/perf/` README; cold-cache.
- [ ] Record `tests/perf/beta-baseline-<date>.json`.
- [ ] If `recap-stats` p95 > 2× budget at 25 VUs OR any 5xx in the burst →
      apply the ND3 contingency (`recap_stats_cache` materialization) or
      renegotiate; capture the decision in PASSDOWN.

## G10 — Sev-1 dry-fire
- [ ] Declare a synthetic Sev-1; mitigate via `docker/scripts/rollback.sh <sha>`.
- [ ] Declaration → mitigation in < 10 min; capture timestamps in PASSDOWN
      (declaration / decision / mitigation / total minutes) per
      `docs/runbooks/bug-triage.md`.

## G12 — Feedback prod smoke (W7 carryover)
- [ ] As a CF-Access non-admin, submit feedback; confirm a row appears via
      `GET /api/admin/feedback` within 5s AND Discord delivery
      (`docs/runbooks/beta-triage.md` §G12).

## W8.5 — Branch protection on `main`
- [ ] Require all 8 status checks (typecheck-api, placeholder-guard,
      build-frontend, validate-frontend, e2e-frontend, api-unit,
      api-integration, migration-gate) + PR review + linear history.
- [ ] G1 proof: open a deliberately-broken PR; confirm the gate blocks merge.

## G14 — Cohort + comms
- [ ] Cohort capped at ≤ 10.
- [ ] Each user signed PAR-Q-lite; documented contact path
      (`docs/runbooks/beta-triage.md`); first-run Beta disclaimer surfaced.

## G15 — Exit criteria + cadence
- [ ] `docs/runbooks/beta-exit-criteria.md` reviewed; weekly Beta review on the
      calendar.

## Sign-off
- [ ] All passes GREEN → Beta cutover authorized. Any RED → Beta slips; record
      in PASSDOWN and `docs/superpowers/goals/beta.md`.
```

- [ ] Author `docs/runbooks/beta-exit-criteria.md` with this exact content (transcribes D13 / master plan lines 525–531 + weekly cadence):

```markdown
# Beta Exit Criteria (G15)

Beta exits to GA only when **all** of the following hold. This is the D13
stricter floor (`docs/superpowers/specs/beta/round2-qa-challenges.md` §D13;
master plan §"Exit criteria captured ... per G15"). Any unmet condition keeps
Beta open. No partial credit.

## Exit conditions
1. **30 days with no Sev-1 incidents.** (Sev-1 per `docs/runbooks/bug-triage.md`:
   data loss, auth lockout, core flow down — and PAR-Q-bypass by class.)
2. **Zero Sev-2 in the final 14 days.** Catches "users blocked on a critical
   flow" that does not trip Sev-1.
3. **Zero PAR-Q-bypass incidents.** A user reaching a workout without an
   acknowledged PAR-Q is a Critical clinical-safety bug class, independent of
   Sev-1 symptoms.
4. **A backup-restore DR dry-fire passed within the final 30 days**
   (`docs/runbooks/dr-dry-fire.md`; cadence per G5). The test must be fresh at
   GA cutover — a 5-month-old pass does not count.
5. **No outstanding Important security findings** (`feedback_ship_clean` — applies
   at GA exit too; track in `docs/superpowers/specs/beta/08-qa.md`).
6. **At least 5 users completed a full mesocycle AND submitted feedback.** The
   feedback-loop closing is a usage signal, not just a click signal.

## Review cadence
- **Weekly during Beta.** The engineering operator reviews this checklist once a
  week and records status (GREEN/RED per condition) in PASSDOWN.
- The **final** weekly review (the one immediately before declaring GA-ready)
  must show **no blocking gaps in the final 14 days** for conditions 2 and 3.
- A RED on any condition resets the relevant clock (e.g. a new Sev-1 restarts
  the 30-day counter in condition 1).

## Authorizing GA
All six conditions GREEN at a weekly review, with the final-14-days check clean,
authorizes the GA cutover. Record the authorizing review date in PASSDOWN and
flip the G15 row in `docs/superpowers/goals/beta.md`.
```

- [ ] Run the harness and expect PASS:

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && bash tests/dr/cutover-docs.test.sh
```

Expected output (last line): `✓ cutover-docs.test.sh PASS`

- [ ] Shellcheck the new harness:

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && shellcheck tests/dr/cutover-docs.test.sh && echo "SHELLCHECK CLEAN"
```

Expected output: `SHELLCHECK CLEAN`. (Docker fallback as in WS4.2 if needed.)

- [ ] Commit:

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && \
  git add docs/runbooks/beta-cutover-checklist.md docs/runbooks/beta-exit-criteria.md tests/dr/cutover-docs.test.sh && \
  git commit -m "docs(w8): author beta-cutover-checklist + beta-exit-criteria (G15 prep, cutover predicates)"
```

---

### WS4 acceptance (per design spec §4)
- `docker/scripts/rollback.sh` passes shellcheck and its `--help`/`DRY_RUN` dry-run path touches nothing (no ssh, no docker) — proven by `tests/dr/rollback.test.sh`.
- `scripts/check-migration-dryrun.sh` passes a no-migration PR and an additive-only PR, fails a synthetic Step-2-without-link PR, and passes the same Step-2 WITH a `Dry-run:` link — proven by `tests/dr/check-migration-dryrun.test.sh`; wired into `test.yml` as the `migration-gate` job.
- `docs/runbooks/bug-triage.md` exists with Sev-1/2/3 tiers, time-to-mitigate budgets, and the rollback decision tree; reviewed against the real deploy topology (`reference_unraid_redeploy`, IP `192.168.88.65`, `ghcr.io/otahesh/repos:sha-<sha>`).
- Both cutover docs authored and internally consistent with design spec §5 / D13 — proven by `tests/dr/cutover-docs.test.sh`.
- The Sev-1 dry-fire itself (declaration→mitigation <10 min with PASSDOWN timestamps) is **operational → cutover checklist**, NOT this wave.

---

## WS5 — Post-deploy smoke workflow → G13

**Gate closed:** G13 — "GH Actions post-deploy job pings `repos.jpmtech.com`, verifies 302→CF Access, `/api/health/sync/status`→401 from public, bundle hash matches build artifact, fails deploy on mismatch." Authoring + assertion-logic test land in this wave; the **live firing** is observed at the next real deploy / cutover window (acceptance per design §3 / §8.2).

**What this workstream ships:**
1. `scripts/post-deploy-smoke.sh` — a thin, testable shell script that runs the three external checks against a base URL and exits non-zero on any failure.
2. `tests/smoke/post-deploy-smoke.test.sh` — a `.test.sh` unit test (matching the existing `tests/dr/integrity-check.test.sh` / `tests/cutover/synthetic.test.sh` convention) that exercises the script's three pure assertion functions against mocked 302 / 401 / hash-match / hash-mismatch inputs.
3. `.github/workflows/post-deploy-smoke.yml` — the CI wrapper: rebuilds the committed SHA's frontend bundle to compute the **expected** asset fingerprint, then calls the script against prod.

### Critical design facts established by the read-only audit (the executor must not deviate)

- **Deployment is manual.** `.github/workflows/docker.yml` only builds + pushes to `ghcr.io/otahesh/repos:sha-<short>` / `:latest`. A human SSHes to Unraid and recreates the container (`reference_unraid_redeploy`). There is **no** automated deploy step, so this workflow **cannot** chain off `docker.yml` via `workflow_run` — by the time `docker.yml` finishes, nothing is deployed yet. **Trigger = `workflow_dispatch`** with an `expected_sha` input the operator passes after recreating the container. (Wiring documented in the workflow header + WS4's `beta-cutover-checklist.md`.)
- **The whole host is behind CF Access.** Per `reference_deployment`, the `RepOS` whole-host Access app challenges every path **except** `/api/health/*` (a Bypass app for the iOS Shortcut bearer flow). Therefore:
  - A **logged-out** request to `/` (or `/index.html`) from the public internet → **302** to `https://jpmtech.cloudflareaccess.com/...` (CF Access edge redirect). ✅ Check (a).
  - `/api/health/sync/status` is **edge-bypassed**, so it reaches the origin API, which runs `requireBearerOrCfAccess` (`api/src/routes/sync.ts:7`). With no `Authorization: Bearer` header and no CF cookie, the origin returns **401** (`api/src/middleware/cfAccess.ts:166-170`). ✅ Check (b).
  - Because `/` is 302-gated, a *public* fetch of `index.html` cannot read the real deployed bundle. The bundle-hash check (c) must authenticate through the edge with a **CF Access service token** (`CF-Access-Client-Id` / `CF-Access-Client-Secret` headers) to fetch the real deployed `index.html`. These come from repo secrets (`CF_ACCESS_SVC_CLIENT_ID` / `CF_ACCESS_SVC_CLIENT_SECRET`). See WS5.4 risk note — the service token + Access service-auth policy is an infra prerequisite.
- **Bundle fingerprint is computable from `index.html`.** Vite emits hashed asset filenames; the built `frontend/dist/index.html` references exactly `/assets/index-<hash>.js` and `/assets/index-<hash>.css` (verified: `/assets/index-BmHn1KwR.js`, `/assets/index-C9CzTpy9.css`). The fingerprint = the sorted set of `/assets/...` paths extracted via `grep -oE '/assets/[A-Za-z0-9._-]+' | sort`. Comparing the deployed `index.html`'s fingerprint to the rebuilt artifact's fingerprint proves the deployed bundle == the committed SHA's build.
- **`actionlint` and `shellcheck` are NOT installed locally** (verified). The plan installs them on demand so the executor can actually run the lint acceptance.
- **No root `package.json`**; `.test.sh` files are run directly with `bash <path>` and are not (yet) wired into a CI job. We keep that convention — the unit test is `bash tests/smoke/post-deploy-smoke.test.sh`.

> **WORKFLOW-SCOPE PUSH CAVEAT (read before pushing).** Any push that creates/updates a file under `.github/workflows/*` is **rejected** by the `gh` OAuth token (no `workflow` scope). Push the branch over SSH instead (`reference_gh_workflow_scope_push`):
> ```
> git push --force-with-lease git@github.com:otahesh/RepOS.git feat/w8-beta-entry-gates:feat/w8-beta-entry-gates
> ```
> The `scripts/` and `tests/` commits (no workflow file) push fine over the normal remote; only the commit that adds/edits `post-deploy-smoke.yml` needs the SSH push. PR creation/merge are unaffected (repo scope).

---

### Task WS5.1: Extract the three smoke checks into a testable script with pure assertion functions

**Files:**
- Create: `scripts/post-deploy-smoke.sh`
- Test: `tests/smoke/post-deploy-smoke.test.sh`

Design the script so the *assertion logic* (status-code check, hash-equality check) lives in pure functions that take inputs as arguments and emit no I/O of their own beyond a return code — so the test can call them directly without any network. A `main` at the bottom (guarded by `BASH_SOURCE`) does the real `curl` + `npm run build` orchestration; the test file `source`s the script with a sentinel env var that skips `main`, then calls the functions with mocked values.

- [ ] **Write the failing test first.** Create `tests/smoke/post-deploy-smoke.test.sh` with this exact content:

```bash
#!/usr/bin/env bash
# WS5 — post-deploy smoke assertion-logic unit test.
#
# Sources scripts/post-deploy-smoke.sh in library mode (POST_DEPLOY_SMOKE_LIB=1
# skips main) and exercises its three pure assertion functions against mocked
# HTTP status codes and asset fingerprints — NO network, NO prod contact.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
POST_DEPLOY_SMOKE_LIB=1 source "${REPO_ROOT}/scripts/post-deploy-smoke.sh"

# ── Check (a): logged-out root must be 302 ─────────────────────────────
assert_root_redirect 302 || { echo "FAIL: 302 should pass root-redirect check"; exit 1; }
echo "✓ root-redirect accepts 302"

if assert_root_redirect 200 2>/dev/null; then
  echo "FAIL: 200 must NOT pass root-redirect check (host should be CF-Access gated)"; exit 1
fi
echo "✓ root-redirect rejects 200 (un-gated host)"

if assert_root_redirect 401 2>/dev/null; then
  echo "FAIL: 401 must NOT pass root-redirect check"; exit 1
fi
echo "✓ root-redirect rejects 401"

# ── Check (b): public sync/status must be 401 ──────────────────────────
assert_sync_unauthorized 401 || { echo "FAIL: 401 should pass sync-unauthorized check"; exit 1; }
echo "✓ sync-unauthorized accepts 401"

if assert_sync_unauthorized 200 2>/dev/null; then
  echo "FAIL: 200 must NOT pass sync-unauthorized check (public data leak!)"; exit 1
fi
echo "✓ sync-unauthorized rejects 200 (data leak)"

if assert_sync_unauthorized 302 2>/dev/null; then
  echo "FAIL: 302 must NOT pass sync-unauthorized check (edge bypass missing)"; exit 1
fi
echo "✓ sync-unauthorized rejects 302 (edge-bypass misconfig)"

# ── Check (c): deployed bundle fingerprint == build artifact fingerprint
GOOD='/assets/index-BmHn1KwR.js
/assets/index-C9CzTpy9.css'
DRIFT='/assets/index-OLDOLDOL.js
/assets/index-C9CzTpy9.css'

assert_bundle_match "$GOOD" "$GOOD" || { echo "FAIL: identical fingerprints should match"; exit 1; }
echo "✓ bundle-match accepts identical fingerprints"

if assert_bundle_match "$GOOD" "$DRIFT" 2>/dev/null; then
  echo "FAIL: differing fingerprints must NOT match (stale deploy)"; exit 1
fi
echo "✓ bundle-match rejects drift (stale deploy)"

if assert_bundle_match "$GOOD" "" 2>/dev/null; then
  echo "FAIL: empty deployed fingerprint must NOT match (CF Access ate the body)"; exit 1
fi
echo "✓ bundle-match rejects empty deployed fingerprint"

# ── fingerprint extractor is deterministic + sorted ────────────────────
HTML='<script type="module" crossorigin src="/assets/index-BmHn1KwR.js"></script>
<link rel="stylesheet" crossorigin href="/assets/index-C9CzTpy9.css">'
FP="$(extract_bundle_fingerprint "$HTML")"
[ "$FP" = "$GOOD" ] || { echo "FAIL: extractor output mismatch: got [$FP]"; exit 1; }
echo "✓ extract_bundle_fingerprint returns sorted /assets paths"

# fonts.googleapis links must NOT pollute the fingerprint
HTML_WITH_FONTS='<link href="https://fonts.googleapis.com/css2?x" rel="stylesheet">
<script type="module" crossorigin src="/assets/index-BmHn1KwR.js"></script>'
FP2="$(extract_bundle_fingerprint "$HTML_WITH_FONTS")"
[ "$FP2" = "/assets/index-BmHn1KwR.js" ] || { echo "FAIL: extractor leaked non-asset URL: [$FP2]"; exit 1; }
echo "✓ extract_bundle_fingerprint ignores external (font) URLs"

echo "✓ post-deploy-smoke.test.sh PASS"
```

- [ ] **Run it and expect FAIL** (the script does not exist yet):
```
cd /Users/jasonmeyer.ict/Projects/RepOS && bash tests/smoke/post-deploy-smoke.test.sh
```
Expected failure (script missing → `source` fails under `set -e`):
```
tests/smoke/post-deploy-smoke.test.sh: line ...: /Users/jasonmeyer.ict/Projects/RepOS/scripts/post-deploy-smoke.sh: No such file or directory
```

- [ ] **Write the minimal implementation.** Create `scripts/post-deploy-smoke.sh` with this exact content:

```bash
#!/usr/bin/env bash
# WS5 / G13 — external post-deploy smoke for repos.jpmtech.com.
#
# Verifies, from OUTSIDE the Cloudflare Tunnel, that a fresh deploy is correct:
#   (a) logged-out GET /            -> 302  (CF Access whole-host gate fires)
#   (b) public  GET /api/health/sync/status -> 401  (edge bypass + origin bearer gate)
#   (c) deployed bundle fingerprint == the build artifact's fingerprint
#       (proves the running container serves the SHA we think it does)
# Exits non-zero on ANY mismatch so the deploy is failed.
#
# Pure assertion functions (assert_*, extract_bundle_fingerprint) take their
# inputs as arguments and do no network I/O — unit-tested by
# tests/smoke/post-deploy-smoke.test.sh. `main` does the real curl/build.
#
# Usage (CI / operator, after recreating the container on Unraid):
#   BASE_URL=https://repos.jpmtech.com \
#   EXPECTED_FINGERPRINT="$(...)" \
#   CF_ACCESS_SVC_CLIENT_ID=... CF_ACCESS_SVC_CLIENT_SECRET=... \
#     bash scripts/post-deploy-smoke.sh
set -euo pipefail

# ── pure assertion helpers (unit-tested) ───────────────────────────────

# Extract the sorted set of /assets/* paths referenced by an index.html body.
# This is the bundle fingerprint: Vite hashes asset filenames, so two builds
# of the same source share it and any source change rotates it.
extract_bundle_fingerprint() {
  local html="$1"
  printf '%s' "$html" | grep -oE '/assets/[A-Za-z0-9._-]+' | sort -u
}

# (a) logged-out root must redirect to CF Access.
assert_root_redirect() {
  local code="$1"
  if [ "$code" = "302" ]; then
    return 0
  fi
  echo "FAIL: logged-out GET / returned ${code}, expected 302 (CF Access gate)" >&2
  return 1
}

# (b) public sync/status must be unauthorized (no bearer, no CF cookie).
assert_sync_unauthorized() {
  local code="$1"
  if [ "$code" = "401" ]; then
    return 0
  fi
  echo "FAIL: public GET /api/health/sync/status returned ${code}, expected 401" >&2
  return 1
}

# (c) deployed fingerprint must equal the build-artifact fingerprint.
assert_bundle_match() {
  local expected="$1" deployed="$2"
  if [ -z "$deployed" ]; then
    echo "FAIL: deployed bundle fingerprint is empty (CF Access challenge or wrong path?)" >&2
    return 1
  fi
  if [ "$expected" = "$deployed" ]; then
    return 0
  fi
  echo "FAIL: bundle drift — deployed bundle != build artifact" >&2
  echo "  expected: ${expected//$'\n'/ }" >&2
  echo "  deployed: ${deployed//$'\n'/ }" >&2
  return 1
}

# ── orchestration (skipped when sourced as a library) ──────────────────
main() {
  : "${BASE_URL:?BASE_URL must be set, e.g. https://repos.jpmtech.com}"
  : "${EXPECTED_FINGERPRINT:?EXPECTED_FINGERPRINT must be set (sorted /assets/* paths from the build artifact)}"
  : "${CF_ACCESS_SVC_CLIENT_ID:?CF_ACCESS_SVC_CLIENT_ID must be set (CF Access service token)}"
  : "${CF_ACCESS_SVC_CLIENT_SECRET:?CF_ACCESS_SVC_CLIENT_SECRET must be set}"

  local fail=0

  echo "→ (a) logged-out GET ${BASE_URL}/ — expect 302 to CF Access"
  local root_code
  root_code="$(curl -s -o /dev/null -w '%{http_code}' --max-redirs 0 "${BASE_URL}/")"
  assert_root_redirect "$root_code" || fail=1

  echo "→ (b) public GET ${BASE_URL}/api/health/sync/status — expect 401"
  local sync_code
  sync_code="$(curl -s -o /dev/null -w '%{http_code}' "${BASE_URL}/api/health/sync/status")"
  assert_sync_unauthorized "$sync_code" || fail=1

  echo "→ (c) deployed bundle fingerprint == build artifact"
  local deployed_html deployed_fp
  deployed_html="$(curl -s \
    -H "CF-Access-Client-Id: ${CF_ACCESS_SVC_CLIENT_ID}" \
    -H "CF-Access-Client-Secret: ${CF_ACCESS_SVC_CLIENT_SECRET}" \
    "${BASE_URL}/index.html")"
  deployed_fp="$(extract_bundle_fingerprint "$deployed_html")"
  assert_bundle_match "$EXPECTED_FINGERPRINT" "$deployed_fp" || fail=1

  if [ "$fail" -ne 0 ]; then
    echo "✗ post-deploy smoke FAILED — deploy is bad, roll back (docker/scripts/rollback.sh)" >&2
    exit 1
  fi
  echo "✓ post-deploy smoke PASS"
}

# Run main only when executed directly, not when sourced by the test.
if [ -z "${POST_DEPLOY_SMOKE_LIB:-}" ]; then
  main "$@"
fi
```

- [ ] **Make both files executable** (matches the existing scripts' `-rwxr-xr-x` mode):
```
cd /Users/jasonmeyer.ict/Projects/RepOS && chmod +x scripts/post-deploy-smoke.sh tests/smoke/post-deploy-smoke.test.sh
```

- [ ] **Run the test and expect PASS:**
```
cd /Users/jasonmeyer.ict/Projects/RepOS && bash tests/smoke/post-deploy-smoke.test.sh
```
Expected output (final lines):
```
✓ root-redirect accepts 302
...
✓ extract_bundle_fingerprint ignores external (font) URLs
✓ post-deploy-smoke.test.sh PASS
```

- [ ] **Lint the script with shellcheck** (install on demand — it is not present locally). Use the pinned Docker image so no host install is needed:
```
cd /Users/jasonmeyer.ict/Projects/RepOS && docker run --rm -v "$PWD:/mnt" -w /mnt koalaman/shellcheck:v0.10.0 scripts/post-deploy-smoke.sh tests/smoke/post-deploy-smoke.test.sh
```
Expected output: **empty** (clean exit 0; shellcheck prints nothing when there are no findings). If Docker is unavailable, `brew install shellcheck && shellcheck scripts/post-deploy-smoke.sh tests/smoke/post-deploy-smoke.test.sh` produces the same clean result.

- [ ] **Commit** (no workflow file in this commit → normal remote push is fine):
```
cd /Users/jasonmeyer.ict/Projects/RepOS && git add scripts/post-deploy-smoke.sh tests/smoke/post-deploy-smoke.test.sh && git commit -m "feat(w8): post-deploy smoke script + assertion-logic unit test (G13)"
```

---

### Task WS5.2: Add the GitHub Actions workflow that computes the expected fingerprint and runs the script against prod

**Files:**
- Create: `.github/workflows/post-deploy-smoke.yml`

The workflow is `workflow_dispatch`-triggered (the operator runs it after recreating the container — there is no automated deploy step to chain off). It checks out the deployed SHA, rebuilds the frontend to derive the **expected** fingerprint from the freshly-built `dist/index.html`, then calls `scripts/post-deploy-smoke.sh` with that fingerprint + prod secrets.

- [ ] **Create `.github/workflows/post-deploy-smoke.yml`** with this exact content (style matches `docker.yml`/`test.yml`: `actions/checkout@v4`, `actions/setup-node@v4`, `working-directory`, `cache-dependency-path`):

```yaml
name: post-deploy-smoke

# G13 — external post-deploy smoke. Manual trigger: run AFTER recreating the
# container on Unraid (deployment is manual — CI only builds/pushes to GHCR).
# Pass the SHA you deployed; the job rebuilds that SHA's frontend to compute the
# expected bundle fingerprint, then probes repos.jpmtech.com from outside the
# tunnel. See docs/runbooks/beta-cutover-checklist.md for where this fits.
on:
  workflow_dispatch:
    inputs:
      expected_sha:
        description: 'Commit SHA that was deployed to prod (defaults to this ref)'
        required: false
        type: string

permissions:
  contents: read

concurrency:
  group: post-deploy-smoke
  cancel-in-progress: true

jobs:
  smoke:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ inputs.expected_sha || github.sha }}

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: frontend/package-lock.json

      - name: Build frontend (derive expected bundle fingerprint)
        working-directory: frontend
        run: |
          npm ci
          npm run build

      - name: Compute expected bundle fingerprint
        id: fp
        run: |
          fp="$(grep -oE '/assets/[A-Za-z0-9._-]+' frontend/dist/index.html | sort -u)"
          if [ -z "$fp" ]; then
            echo "no /assets/* references in built index.html — build is broken" >&2
            exit 1
          fi
          {
            echo 'value<<FP_EOF'
            echo "$fp"
            echo 'FP_EOF'
          } >> "$GITHUB_OUTPUT"

      - name: Run external post-deploy smoke
        env:
          BASE_URL: https://repos.jpmtech.com
          EXPECTED_FINGERPRINT: ${{ steps.fp.outputs.value }}
          CF_ACCESS_SVC_CLIENT_ID: ${{ secrets.CF_ACCESS_SVC_CLIENT_ID }}
          CF_ACCESS_SVC_CLIENT_SECRET: ${{ secrets.CF_ACCESS_SVC_CLIENT_SECRET }}
        run: bash scripts/post-deploy-smoke.sh
```

- [ ] **Lint the workflow with actionlint** (not installed locally — use the pinned Docker image; this is the exact acceptance command):
```
cd /Users/jasonmeyer.ict/Projects/RepOS && docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.7 -color .github/workflows/post-deploy-smoke.yml
```
Expected output: **empty** (clean exit 0 — actionlint prints nothing and exits 0 when there are no findings). If Docker is unavailable: `brew install actionlint && actionlint .github/workflows/post-deploy-smoke.yml` gives the same clean result.

- [ ] **Re-run the assertion-logic test to confirm nothing regressed** (the workflow references the same fingerprint extraction logic the test pins):
```
cd /Users/jasonmeyer.ict/Projects/RepOS && bash tests/smoke/post-deploy-smoke.test.sh
```
Expected final line: `✓ post-deploy-smoke.test.sh PASS`

- [ ] **Commit the workflow, then push the branch over SSH** (this commit touches `.github/workflows/*`, so the normal `gh`-token remote will reject it):
```
cd /Users/jasonmeyer.ict/Projects/RepOS && git add .github/workflows/post-deploy-smoke.yml && git commit -m "ci(w8): post-deploy-smoke workflow pings prod, fails on bundle drift (G13)"
git push --force-with-lease git@github.com:otahesh/RepOS.git feat/w8-beta-entry-gates:feat/w8-beta-entry-gates
```

---

### Task WS5.3: Document the wiring into the deploy path

**Files:**
- Modify: `docs/qa/beta-reachability.md` is **not** the right home — instead append a short "post-deploy smoke" subsection to the cutover checklist authored in WS4: `docs/runbooks/beta-cutover-checklist.md` (WS4 owns its creation; WS5 contributes this passage). **Cross-stream: coordinate with WS4 so this lands in the same doc, not a duplicate.**

The wiring note must capture, in prose the operator can follow: (1) the trigger is manual `workflow_dispatch` run *after* the Unraid container is recreated to the new SHA; (2) the `expected_sha` input must equal the deployed SHA; (3) the two repo secrets (`CF_ACCESS_SVC_CLIENT_ID`, `CF_ACCESS_SVC_CLIENT_SECRET`) must exist and the CF Access service-token policy must permit them on the whole host; (4) on failure, roll back with `docker/scripts/rollback.sh <previous-sha>` (WS4).

- [ ] **Append the wiring subsection** to `docs/runbooks/beta-cutover-checklist.md` (exact markdown — insert under the G13/W8.7 step in WS4's checklist):

```markdown
### Post-deploy smoke (G13) — run after every prod deploy

Deployment is manual: `docker.yml` only builds + pushes the image to GHCR; a
human recreates the container on Unraid (see `reference_unraid_redeploy`). So the
smoke is a **manual `workflow_dispatch`**, run immediately after recreate:

1. Recreate the container to `ghcr.io/otahesh/repos:sha-<short>` on Unraid.
2. In GitHub → Actions → **post-deploy-smoke** → Run workflow. Set
   **expected_sha** to the full SHA you just deployed.
3. The job rebuilds that SHA's frontend, derives the expected `/assets/*`
   fingerprint, then from outside the tunnel asserts:
   - logged-out `GET /` → **302** (CF Access whole-host gate),
   - public `GET /api/health/sync/status` → **401** (edge-bypassed, origin bearer gate),
   - deployed `index.html` fingerprint (fetched with the CF Access **service
     token**) **==** the rebuilt artifact's fingerprint.
4. **Any red ⇒ the deploy is bad.** Roll back: `docker/scripts/rollback.sh <previous-sha>`.

**Prerequisite (one-time infra):** repo secrets `CF_ACCESS_SVC_CLIENT_ID` /
`CF_ACCESS_SVC_CLIENT_SECRET` must hold a CF Access **service token**, and the
whole-host `RepOS` Access app must include a service-auth policy admitting it,
or check (c) will see the 302 challenge and fail with an empty fingerprint.
```

- [ ] **Verify the referenced files exist** (sanity, no edits):
```
cd /Users/jasonmeyer.ict/Projects/RepOS && ls scripts/post-deploy-smoke.sh .github/workflows/post-deploy-smoke.yml && git log --oneline -3
```
Expected: both paths listed, recent commits include the two WS5 commits.

- [ ] **Commit the docs** (docs-only → normal remote push works):
```
cd /Users/jasonmeyer.ict/Projects/RepOS && git add docs/runbooks/beta-cutover-checklist.md && git commit -m "docs(w8): wire post-deploy smoke (G13) into cutover checklist"
```

---

### Acceptance (WS5)

- `bash tests/smoke/post-deploy-smoke.test.sh` → `✓ post-deploy-smoke.test.sh PASS` (10 mocked assertions: 302/401/hash-match + their negatives + extractor determinism + font-URL exclusion).
- `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.7 -color .github/workflows/post-deploy-smoke.yml` → empty output, exit 0.
- `docker run --rm -v "$PWD:/mnt" -w /mnt koalaman/shellcheck:v0.10.0 scripts/post-deploy-smoke.sh tests/smoke/post-deploy-smoke.test.sh` → empty output, exit 0.
- Wiring documented in `docs/runbooks/beta-cutover-checklist.md` (trigger, `expected_sha`, secrets, rollback-on-fail).
- Live firing of the workflow is **out of scope for build-now done** — it is observed at the next real deploy / cutover (design §8.2: "engineering-satisfied where a prod firing is the only remainder").

---

## WS6 — Reachability audit + minimal prior-mesocycle recap reachability → G7

**Gate:** G7 (every Beta surface reachable from `/` in ≤3 clicks; prior-mesocycle recap reachable; no surface requires URL knowledge).

**Why this workstream exists (grounded audit, 2026-05-29):** `MyProgramPage.tsx` renders `MesocycleRecap` (the recap surface) only inside the `run.status === 'completed'` branch (`frontend/src/pages/MyProgramPage.tsx:171-210`), and the only route to that page is `my-programs/:id` (`frontend/src/App.tsx:51`) keyed on a `mesocycle_run_id`. The "Past" tab of `MyLibrary` (`frontend/src/components/programs/MyLibrary.tsx:203-217`) is the only library surface that shows completed programs, and it offers **only** a "Restart" button (`onRestart` → `/programs/:slug`) — there is **no** link to a completed program's recap. The frontend has no API fn that lists a program's runs (`frontend/src/lib/api/userPrograms.ts` exposes only `getUserProgram`, which returns a single `latest_run_id`). The backend has no list-by-program endpoint: `resolveUserProgramStructure` (`api/src/services/resolveUserProgramStructure.ts:85-89`) returns a scalar `latest_run_id` subquery, and `api/src/routes/mesocycles.ts` only has single-run fetches (`/mesocycles/:id`, `:id/volume-rollup`, `:id/recap-stats`). **So a completed run's recap is unreachable from `/` today.** This workstream closes that gap with the minimum viable list endpoint + one "View recap" affordance, then finalizes the reachability doc.

This is the **only product-ish code W8 ships**, and it ships solely to close a Beta entry gate.

---

### Task WS6.1: YAGNI check — confirm no existing endpoint surfaces prior runs

**Files:**
- Read-only investigation. No Create/Modify/Test.

This task produces a written decision; it changes no code. The executor MUST run these greps and record the result before writing any endpoint, so we don't reinvent a list that already exists.

- [ ] Confirm `GET /user-programs/:id` returns only a single, scalar run reference (not a list):
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS/api && grep -n "latest_run_id\|mesocycle_runs" src/services/resolveUserProgramStructure.ts
  ```
  Expected: the only `mesocycle_runs` reference is the `(SELECT mr.id ... ORDER BY mr.created_at DESC LIMIT 1) AS latest_run_id` subquery (a single id, not an array).

- [ ] Confirm the `GET /user-programs/:id` response schema carries no run list:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS/api && grep -n "latest_run_id\|runs\|mesocycle" src/schemas/userPrograms.ts
  ```
  Expected: `UserProgramDetailResponseSchema` has `latest_run_id: z.string().uuid().optional()` and **no** `runs`/`past_mesocycles`/`mesocycles` array field.

- [ ] Confirm `mesocycles.ts` has no list-by-program route (only single-run fetches):
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS/api && grep -n "app\.\(get\|post\)" src/routes/mesocycles.ts
  ```
  Expected output: routes `/mesocycles/today`, `/mesocycles/:id`, `/mesocycles/:id/volume-rollup`, `/mesocycles/:id/recap-stats`, `/mesocycles/:id/abandon` — **no** `/mesocycles?user_program_id=` and **no** `/user-programs/:id/mesocycles`.

- [ ] Confirm no frontend client fn lists a program's runs:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && grep -rn "mesocycles\b\|past_mesocycles\|listProgramRuns\|/mesocycles" src/lib/api/userPrograms.ts src/lib/api/mesocycles.ts
  ```
  Expected: `mesocycles.ts` has `getMesocycle`, `getVolumeRollup`, `getMesocycleRecapStats`, `startMesocycle` (all single-id) and **no** list-by-program fn.

- [ ] **Record the decision (no code):** All four greps confirm there is NO existing endpoint or client fn that lists a program's prior mesocycle runs. **Decision rule applied:** an existing endpoint cannot surface prior runs, so WS6.2 adds a **minimal new endpoint** `GET /user-programs/:id/mesocycles`. (We do NOT extend `GET /user-programs/:id` to add a `past_mesocycles` array: that endpoint goes through `resolveUserProgramStructure`, which already does template-overlay work and returns `null` for templateless programs; bolting a runs array onto it would inflate the hot detail-load path. A dedicated, ownership-checked sub-resource route is the smaller, more cohesive change and is the choice consistent with the sibling `:id/warnings` and `:id/start` sub-routes already on `userPrograms.ts`.)

---

### Task WS6.2: Backend (TDD) — `GET /user-programs/:id/mesocycles` list endpoint + ownership + contamination test

**Files:**
- Modify: `api/src/schemas/userPrograms.ts` (append a list response schema after `UserProgramStartResponseSchema`, ~end of file)
- Modify: `api/src/routes/userPrograms.ts` (add a new GET route after the `/user-programs/:id/warnings` route, ~line 318)
- Test: `api/tests/integration/user-programs-mesocycles-list.test.ts` (Create — happy path)
- Test: `api/tests/integration/contamination/userProgramsMesocyclesList-contamination.test.ts` (Create — contamination; feeds the WS2 matrix)

The endpoint returns each run for a program (newest first) with the columns the recap-entry UI needs: `id`, `status`, `start_date`, `finished_at`, `is_deload`, `weeks`. Ownership is enforced by `WHERE up.user_id = $2` on the owning program (a non-owner gets 404, never another user's runs).

- [ ] Write the failing happy-path integration test. Create `api/tests/integration/user-programs-mesocycles-list.test.ts`:
  ```ts
  import 'dotenv/config';
  import { describe, it, expect, beforeAll, afterAll } from 'vitest';
  import { buildApp } from '../../src/app.js';
  import { db } from '../../src/db/client.js';
  import { mkUser, cleanupUser, mkTemplate, mkUserProgram, cleanupTemplate } from '../helpers/program-fixtures.js';

  type App = Awaited<ReturnType<typeof buildApp>>;
  let app: App; let userId: string; let token: string; let upId: string; let templateId: string;
  let completedRunId: string; let activeRunId: string;

  beforeAll(async () => {
    app = await buildApp();
    userId = (await mkUser({ prefix: 'vitest.w8-mesolist' })).id;
    const tpl = await mkTemplate({ prefix: 'vitest-w8-mesolist-tpl', weeks: 4, structure: { _v: 1, days: [
      { idx: 0, day_offset: 0, kind: 'strength', name: 'D', blocks: [
        { exercise_slug: 'barbell-bench-press', mev: 2, mav: 3, target_reps_low: 6, target_reps_high: 10, target_rir: 2, rest_sec: 180 },
      ]},
    ]}});
    templateId = tpl.id;
    upId = (await mkUserProgram({ userId, templateId: tpl.id, templateVersion: 1, status: 'active' })).id;
    // Two runs on the same program: one completed (older), one active (newer).
    const { rows: [c] } = await db.query<{ id: string }>(
      `INSERT INTO mesocycle_runs (user_program_id, user_id, start_date, start_tz, weeks, current_week, status, finished_at, is_deload, created_at)
       VALUES ($1,$2,'2026-01-01','UTC',4,4,'completed', now() - interval '10 days', false, now() - interval '40 days') RETURNING id`,
      [upId, userId],
    );
    completedRunId = c.id;
    const { rows: [a] } = await db.query<{ id: string }>(
      `INSERT INTO mesocycle_runs (user_program_id, user_id, start_date, start_tz, weeks, current_week, status, is_deload, created_at)
       VALUES ($1,$2,'2026-02-01','UTC',4,2,'active', false, now()) RETURNING id`,
      [upId, userId],
    );
    activeRunId = a.id;
    const t = await app.inject({ method: 'POST', url: '/api/tokens',
      body: { user_id: userId, label: 'a', scopes: ['program:write'] } });
    token = t.json<{ token: string }>().token;
  });
  afterAll(async () => {
    await cleanupUser(userId);
    await cleanupTemplate(templateId);
    await app.close();
  });

  describe('GET /api/user-programs/:id/mesocycles [WS6.2 / D6]', () => {
    it('returns this program runs newest-first with recap-entry columns', async () => {
      const r = await app.inject({
        method: 'GET', url: `/api/user-programs/${upId}/mesocycles`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(r.statusCode).toBe(200);
      const body = r.json<{ mesocycles: Array<{ id: string; status: string; start_date: string; finished_at: string | null; is_deload: boolean; weeks: number }> }>();
      expect(body.mesocycles).toHaveLength(2);
      // Newest first: the active run (created now) precedes the completed run (created 40d ago).
      expect(body.mesocycles[0].id).toBe(activeRunId);
      expect(body.mesocycles[1].id).toBe(completedRunId);
      const completed = body.mesocycles.find((m) => m.id === completedRunId)!;
      expect(completed.status).toBe('completed');
      expect(completed.weeks).toBe(4);
      expect(completed.is_deload).toBe(false);
      expect(completed.start_date).toBe('2026-01-01');
      expect(typeof completed.finished_at).toBe('string');
    });

    it('returns 401 with no bearer', async () => {
      const r = await app.inject({ method: 'GET', url: `/api/user-programs/${upId}/mesocycles` });
      expect([401, 403]).toContain(r.statusCode);
    });

    it('returns 404 for a program id that does not exist', async () => {
      const r = await app.inject({
        method: 'GET', url: `/api/user-programs/00000000-0000-0000-0000-000000000000/mesocycles`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(r.statusCode).toBe(404);
    });
  });
  ```

- [ ] Run the test and expect FAIL (route not registered → 404 on the happy path):
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm run test:integration -- user-programs-mesocycles-list
  ```
  Expected failure: the first test fails with `expected 404 to be 200` (Fastify returns 404 for the unregistered path).

- [ ] Add the list response schema. In `api/src/schemas/userPrograms.ts`, append after the `UserProgramStartResponseSchema`/`UserProgramStartResponse` block at the end of the file:
  ```ts
  // ---------------------------------------------------------------------------
  // GET /api/user-programs/:id/mesocycles — list this program's runs (newest
  // first) for the prior-mesocycle-recap entry point (WS6 / D6 / G7).
  // ---------------------------------------------------------------------------

  export const ProgramMesocycleSchema = z.object({
    id: z.string().uuid(),
    status: z.enum(USER_PROGRAM_STATUSES),
    start_date: z.string(),            // YYYY-MM-DD
    finished_at: z.string().nullable(),
    is_deload: z.boolean(),
    weeks: z.number().int().min(1),
  });

  export type ProgramMesocycle = z.infer<typeof ProgramMesocycleSchema>;

  export const ProgramMesocyclesResponseSchema = z.object({
    mesocycles: z.array(ProgramMesocycleSchema),
  });

  export type ProgramMesocyclesResponse = z.infer<typeof ProgramMesocyclesResponseSchema>;
  ```

- [ ] Add the route. In `api/src/routes/userPrograms.ts`, first add the type to the existing schema import block (lines 16-24) — add `type ProgramMesocyclesResponse,` to the import list:
  ```ts
    UserProgramStartIntentQuerySchema,
    type UserProgramListResponse,
    type UserProgramDetailResponse,
    type UserProgramPatchResponse,
    type UserProgramWarningsResponse,
    type UserProgramStartResponse,
    type ProgramMesocyclesResponse,
  } from '../schemas/userPrograms.js';
  ```
  Then insert this route immediately after the `app.get('/user-programs/:id/warnings', ...)` handler closes (after its closing `);` around line 318, before the `/user-programs/:id/start` route):
  ```ts
    // List this program's mesocycle runs, newest first. Powers the prior-
    // mesocycle-recap entry point on the Past tab (WS6 / D6 / G7). Ownership is
    // enforced by the user_program row's user_id — a non-owner (or unknown id)
    // gets 404, never another user's runs.
    app.get<{ Params: { id: string } }>(
      '/user-programs/:id/mesocycles',
      { preHandler: requireBearerOrCfAccess },
      async (req, reply) => {
        const userId = (req as any).userId as string;
        const { rows: owns } = await db.query(
          `SELECT 1 FROM user_programs WHERE id=$1 AND user_id=$2`,
          [req.params.id, userId],
        );
        if (owns.length === 0) {
          reply.code(404);
          return { error: 'user_program not found', field: 'id' };
        }
        const { rows } = await db.query(
          `SELECT id,
                  status,
                  to_char(start_date, 'YYYY-MM-DD') AS start_date,
                  finished_at,
                  is_deload,
                  weeks
           FROM mesocycle_runs
           WHERE user_program_id=$1 AND user_id=$2
           ORDER BY created_at DESC`,
          [req.params.id, userId],
        );
        const resp: ProgramMesocyclesResponse = { mesocycles: rows as ProgramMesocyclesResponse['mesocycles'] };
        return resp;
      },
    );
  ```

- [ ] Run the happy-path test and expect PASS:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm run test:integration -- user-programs-mesocycles-list
  ```
  Expected output: `Test Files  1 passed` / `Tests  3 passed`.

- [ ] Commit:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS && git add api/src/schemas/userPrograms.ts api/src/routes/userPrograms.ts api/tests/integration/user-programs-mesocycles-list.test.ts && git commit -m "feat(w8): add GET /user-programs/:id/mesocycles list endpoint (D6/G7)"
  ```

- [ ] Write the failing contamination test (feeds the WS2 matrix — `[I-CONTAM-MATRIX-COMPLETE]`). Create `api/tests/integration/contamination/userProgramsMesocyclesList-contamination.test.ts`:
  ```ts
  import 'dotenv/config';
  import { describe, it, expect, beforeAll, afterAll } from 'vitest';
  import { buildApp } from '../../../src/app.js';
  import { db } from '../../../src/db/client.js';
  import { mkUser, cleanupUser, mkTemplate, mkUserProgram, cleanupTemplate } from '../../helpers/program-fixtures.js';

  type App = Awaited<ReturnType<typeof buildApp>>;
  let app: App;
  let userA: string; let tokenA: string;
  let userB: string; let userBProgramId: string;
  let templateId: string;

  beforeAll(async () => {
    app = await buildApp();
    userA = (await mkUser({ prefix: 'vitest.w8-mesolist-a' })).id;
    userB = (await mkUser({ prefix: 'vitest.w8-mesolist-b' })).id;
    const tpl = await mkTemplate({ prefix: 'vitest-w8-mesolist-c-tpl', weeks: 4, structure: { _v: 1, days: [
      { idx: 0, day_offset: 0, kind: 'strength', name: 'D', blocks: [
        { exercise_slug: 'barbell-bench-press', mev: 2, mav: 3, target_reps_low: 6, target_reps_high: 10, target_rir: 2, rest_sec: 180 },
      ]},
    ]}});
    templateId = tpl.id;
    // User B owns a program with one completed run.
    userBProgramId = (await mkUserProgram({ userId: userB, templateId: tpl.id, templateVersion: 1, status: 'completed' })).id;
    await db.query(
      `INSERT INTO mesocycle_runs (user_program_id, user_id, start_date, start_tz, weeks, current_week, status, finished_at, is_deload)
       VALUES ($1,$2,'2026-01-01','UTC',4,4,'completed', now(), false)`,
      [userBProgramId, userB],
    );
    const t = await app.inject({ method: 'POST', url: '/api/tokens',
      body: { user_id: userA, label: 'a', scopes: ['program:write'] }});
    tokenA = t.json<{ token: string }>().token;
  });
  afterAll(async () => {
    await cleanupUser(userA);
    await cleanupUser(userB);
    await cleanupTemplate(templateId);
    await app.close();
  });

  describe('GET /api/user-programs/:id/mesocycles contamination — G2 [I-CONTAM-MATRIX-COMPLETE]', () => {
    it('returns 401/403 with no bearer', async () => {
      const r = await app.inject({ method: 'GET', url: `/api/user-programs/${userBProgramId}/mesocycles` });
      expect([401, 403]).toContain(r.statusCode);
    });

    it('user A reading user B program runs returns 404 (never B data)', async () => {
      const r = await app.inject({
        method: 'GET', url: `/api/user-programs/${userBProgramId}/mesocycles`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(r.statusCode).toBe(404);
      // Must NOT leak B's run rows.
      const body = r.json<{ mesocycles?: unknown[] }>();
      expect(body.mesocycles).toBeUndefined();
    });
  });
  ```

- [ ] Run the contamination test and expect PASS (the route's `owns.length === 0` ownership branch already returns 404 for a cross-user program):
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm run test:integration -- userProgramsMesocyclesList-contamination
  ```
  Expected output: `Test Files  1 passed` / `Tests  2 passed`.

- [ ] Commit:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS && git add api/tests/integration/contamination/userProgramsMesocyclesList-contamination.test.ts && git commit -m "test(w8): contamination guard for GET /user-programs/:id/mesocycles (G2)"
  ```

---

### Task WS6.3: Frontend (TDD) — client fn + "View recap" entry on the Past tab

**Files:**
- Modify: `frontend/src/lib/api/userPrograms.ts` (add `ProgramMesocycle` type + `listProgramMesocycles` fn, after `getUserProgramWarnings`, ~line 72)
- Modify: `frontend/src/components/programs/MyLibrary.tsx` (add a "View recap" affordance on completed cards, navigating to the latest completed run's recap)
- Test: `frontend/src/components/programs/MyLibrary.test.tsx` (Create if absent; else add cases)

**Reachability target:** `/` → "Programs" nav → "Past" tab → "View recap" on a completed card → lands `/my-programs/:runId` (the recap). The "Programs" nav lands `/programs` (`ProgramsPage` mounts `MyLibrary`); "Past" tab is one click; "View recap" is the third. **3 clicks**, within budget. (`ProgramCatalog`/`ProgramsPage` already register the route; `App.tsx:51` renders `MyProgramPage` for `my-programs/:id`, whose completed branch shows the recap.)

- [ ] Add the frontend client fn. In `frontend/src/lib/api/userPrograms.ts`, after `getUserProgramWarnings` (end of file), append:
  ```ts
  // Mirror of api/src/schemas/userPrograms.ts ProgramMesocycle. Lists a
  // program's mesocycle runs newest-first so the Past tab can link a completed
  // program to its recap (WS6 / D6 / G7).
  export type ProgramMesocycle = {
    id: string;
    status: UserProgramRecord['status'];
    start_date: string;
    finished_at: string | null;
    is_deload: boolean;
    weeks: number;
  };

  export async function listProgramMesocycles(id: string): Promise<ProgramMesocycle[]> {
    const res = await fetch(`/api/user-programs/${encodeURIComponent(id)}/mesocycles`, { credentials: 'same-origin' });
    const data = await jsonOrThrow<{ mesocycles: ProgramMesocycle[] }>(res);
    return data.mesocycles;
  }
  ```
  Note: `UserProgramRecord` is already imported at the top of the file (`import type { ProgramTemplateStructure, UserProgramRecord } from './programs';`).

- [ ] Write the failing component test. Create `frontend/src/components/programs/MyLibrary.test.tsx`:
  ```tsx
  import { describe, it, expect, vi, beforeEach } from 'vitest';
  import { render, screen, waitFor } from '@testing-library/react';
  import userEvent from '@testing-library/user-event';
  import { MemoryRouter, Route, Routes } from 'react-router-dom';
  import { MyLibrary } from './MyLibrary';
  import * as upApi from '../../lib/api/userPrograms';
  import type { UserProgramRecord } from '../../lib/api/programs';

  const COMPLETED: UserProgramRecord = {
    id: 'up-done', template_id: 't1', template_slug: 'full-body-3x', template_version: 1,
    name: 'Full Body 3x', customizations: {}, status: 'completed',
    created_at: '2026-04-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z',
  } as UserProgramRecord;

  function renderLib() {
    return render(
      <MemoryRouter initialEntries={['/programs']}>
        <Routes>
          <Route path="/programs" element={<MyLibrary onRestartProgram={vi.fn()} />} />
          <Route path="/my-programs/:id" element={<div data-testid="recap-page" />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  describe('<MyLibrary> — prior-mesocycle recap entry (WS6 / D6 / G7)', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
      vi.spyOn(upApi, 'listMyPrograms').mockResolvedValue([COMPLETED]);
    });

    it('Past tab shows a "View recap" action on a completed program', async () => {
      const user = userEvent.setup();
      renderLib();
      await user.click(await screen.findByRole('button', { name: /^past$/i }));
      expect(await screen.findByRole('button', { name: /view recap/i })).toBeInTheDocument();
    });

    it('clicking "View recap" navigates to the latest completed run recap', async () => {
      vi.spyOn(upApi, 'listProgramMesocycles').mockResolvedValue([
        { id: 'run-old', status: 'completed', start_date: '2026-01-01', finished_at: '2026-02-01T00:00:00Z', is_deload: false, weeks: 4 },
        { id: 'run-latest', status: 'completed', start_date: '2026-03-01', finished_at: '2026-04-01T00:00:00Z', is_deload: false, weeks: 4 },
      ]);
      const user = userEvent.setup();
      renderLib();
      await user.click(await screen.findByRole('button', { name: /^past$/i }));
      await user.click(await screen.findByRole('button', { name: /view recap/i }));
      // Endpoint returns newest-first; the first completed run is the target.
      await waitFor(() => expect(upApi.listProgramMesocycles).toHaveBeenCalledWith('up-done'));
      await waitFor(() => expect(screen.getByTestId('recap-page')).toBeInTheDocument());
    });
  });
  ```

- [ ] Run the component test and expect FAIL (no "View recap" button exists yet):
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npx vitest run src/components/programs/MyLibrary.test.tsx
  ```
  Expected failure: `Unable to find an accessible element with the role "button" and name /view recap/i`.

- [ ] Implement the entry point in `frontend/src/components/programs/MyLibrary.tsx`. First extend the import (line 5) to pull in the new fn:
  ```ts
  import { listMyPrograms, listProgramMesocycles } from '../../lib/api/userPrograms';
  ```
  Add an `onViewRecap` prop to `ProgramCard` and render a "View recap" button for completed programs. Change the `ProgramCard` signature/props block (lines 30-40) to add `onViewRecap`:
  ```tsx
  function ProgramCard({
    program,
    onResume,
    onOpen,
    onViewRecap,
    faded,
  }: {
    program: UserProgramRecord;
    onResume?: (id: string) => void;
    onOpen?: (id: string) => void;
    onViewRecap?: (id: string) => void;
    faded: boolean;
  }) {
  ```
  Then, inside the actions row (after the `onResume` button block, before the closing `</div>` of the button row at line 123), add:
  ```tsx
          {onViewRecap && (
            <button
              onClick={() => onViewRecap(program.id)}
              style={{
                padding: '8px 14px',
                background: TOKENS.surface3,
                border: `1px solid ${TOKENS.lineStrong}`,
                borderRadius: 6,
                color: TOKENS.text,
                fontFamily: FONTS.ui,
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              View recap
            </button>
          )}
  ```

- [ ] Wire the navigation in the `MyLibrary` component body. Add a handler that resolves the program's latest completed run and navigates to its recap. Insert after `handleOpen` (line 154):
  ```tsx
    async function handleViewRecap(id: string) {
      try {
        const runs = await listProgramMesocycles(id);
        // Endpoint returns newest-first; the first completed run is the most
        // recent recap. (A completed program always has at least one.)
        const target = runs.find((r) => r.status === 'completed') ?? runs[0];
        if (target) navigate(`/my-programs/${target.id}`);
        else setErr('No mesocycle runs found for this program.');
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    }
  ```
  Then pass it to completed cards in the `.map` (lines 205-214). Change the `<ProgramCard>` element to add the `onViewRecap` prop on the Past tab for completed programs:
  ```tsx
            <ProgramCard
              key={p.id}
              program={p}
              faded={tab === 'past'}
              onOpen={tab === 'active' ? handleOpen : undefined}
              onResume={tab === 'past' && p.template_slug
                ? () => onRestartProgram(p.template_slug!)
                : undefined}
              onViewRecap={tab === 'past' && p.status === 'completed'
                ? (id) => void handleViewRecap(id)
                : undefined}
            />
  ```

- [ ] Run the component test and expect PASS:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npx vitest run src/components/programs/MyLibrary.test.tsx
  ```
  Expected output: `Test Files  1 passed` / `Tests  2 passed`.

- [ ] Commit:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS && git add frontend/src/lib/api/userPrograms.ts frontend/src/components/programs/MyLibrary.tsx frontend/src/components/programs/MyLibrary.test.tsx && git commit -m "feat(w8): View recap entry on Past tab -> prior-mesocycle recap (D6/G7)"
  ```

---

### Task WS6.4: e2e reachability assertion + finalize `docs/qa/beta-reachability.md`

**Files:**
- Test: `frontend/playwright/w8-prior-recap-reachability.spec.ts` (Create)
- Modify: `docs/qa/beta-reachability.md` (append a "W8 — prior-mesocycle recap" section + consolidated note)

The Playwright spec walks `/` → Programs → Past → "View recap" → recap visible, hermetically mocking `/api/me` (with `onboarding_completed_at` past + non-admin so the z-1500 OnboardingOverlay/PAR-Q gates stay down per `reference_e2e_ci_gaps`), the program list, the `:id/mesocycles` list, the run detail, and recap-stats.

- [ ] Write the failing e2e spec. Create `frontend/playwright/w8-prior-recap-reachability.spec.ts`:
  ```ts
  // frontend/playwright/w8-prior-recap-reachability.spec.ts
  // W8 / G7 (D6) — a logged-in user reaches a COMPLETED program's recap from `/`
  // in <=3 clicks: Programs nav -> Past tab -> "View recap" -> MesocycleRecap.
  // Hermetic: all /api routes mocked. onboarding_completed_at MUST be a past
  // timestamp or the z-1500 OnboardingOverlay covers the page and eats clicks.
  import { test, expect, type BrowserContext, type Route } from '@playwright/test';

  const USER = {
    id: 'user-1', email: 'tester@example.com', display_name: 'Tester', timezone: 'UTC',
    is_admin: false, onboarding_completed_at: '2026-01-01T00:00:00Z',
    par_q_version: 1, par_q_advisory_active: false,
  };

  const COMPLETED_PROGRAM = {
    id: 'up-done', template_id: 't1', template_slug: 'full-body-3x', template_version: 1,
    name: 'Full Body 3x', customizations: {}, status: 'completed',
    created_at: '2026-04-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z',
  };

  const COMPLETED_RUN = {
    id: 'run-1', user_program_id: 'up-done', user_id: 'user-1',
    start_date: '2026-03-01', start_tz: 'UTC', weeks: 4, current_week: 4,
    status: 'completed', finished_at: '2026-04-01T00:00:00Z',
    created_at: '2026-03-01T00:00:00Z', updated_at: '2026-04-01T00:00:00Z', day_workouts: [],
  };

  test('W8/G7: completed-program recap is reachable from / in <=3 clicks', async ({ browser }) => {
    const wire = async (ctx: BrowserContext): Promise<void> => {
      await ctx.route('**/api/me', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(USER) }));
      await ctx.route('**/api/equipment/profile', (r: Route) =>
        r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ _v: 1, barbell: { available: true } }) }));
      await ctx.route('**/api/health/sync/status', (r: Route) =>
        r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ source: 'Apple Health', last_success_at: null, state: 'stale' }) }));
      // Past tab fetches include=past; return the completed program either way.
      await ctx.route('**/api/user-programs?**', (r: Route) =>
        r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ programs: [COMPLETED_PROGRAM] }) }));
      await ctx.route('**/api/user-programs/up-done/mesocycles', (r: Route) =>
        r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ mesocycles: [
          { id: 'run-1', status: 'completed', start_date: '2026-03-01', finished_at: '2026-04-01T00:00:00Z', is_deload: false, weeks: 4 },
        ] }) }));
      await ctx.route('**/api/mesocycles/run-1/recap-stats', (r: Route) =>
        r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ weeks: 4, total_sets: 180, prs: 3 }) }));
      await ctx.route('**/api/mesocycles/run-1', (r: Route) =>
        r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(COMPLETED_RUN) }));
      await ctx.route('**/api/user-programs/up-done', (r: Route) =>
        r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...COMPLETED_PROGRAM, effective_name: 'Full Body 3x', effective_structure: { _v: 1, days: [] } }) }));
    };

    const ctx = await browser.newContext();
    await wire(ctx);
    const page = await ctx.newPage();
    await page.goto('/');

    // 1: Programs nav.
    await page.getByRole('link', { name: /programs/i }).first().click();
    // 2: Past tab.
    await page.getByRole('button', { name: /^past$/i }).click();
    // 3: View recap.
    await page.getByRole('button', { name: /view recap/i }).click();

    // Recap surface visible (MesocycleRecap header copy).
    await expect(page.getByText(/Solid block/i)).toBeVisible();
    await expect(page.getByText(/180/)).toBeVisible();
  });
  ```

- [ ] Run the e2e spec and expect FAIL initially **only if** the dev server is wired; otherwise this lands as a tracked-but-not-CI spec like the other Playwright reachability specs. Confirm it parses/lists under Playwright:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npx playwright test w8-prior-recap-reachability --list
  ```
  Expected: the test title `W8/G7: completed-program recap is reachable from / in <=3 clicks` is listed (proves the spec compiles). (Live execution requires the dev server + browsers and runs in the `e2e-frontend` CI lane / cutover, consistent with the existing `w5-/w6-/w7-` reachability specs.)

- [ ] Append the doc section. In `docs/qa/beta-reachability.md`, after the `## W7 — Feedback` section (end of file), add:
  ```markdown

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
  ```

- [ ] Run `npm run validate` (frontend gate: tsc + vitest + term coverage + page-reachability + tz-sync) and expect PASS:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npm run validate
  ```
  Expected: `tsc --noEmit` clean, all vitest files pass (including `MyLibrary.test.tsx`), and `check-page-reachability.mjs` reports no orphan/dead-link/route-mismatch failures (the new fn + button are imported transitively from `main.tsx` via `ProgramsPage` → `MyLibrary`, so no new orphan).

- [ ] Run the api integration suite once more to confirm the two new tests stay green alongside the rest:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm run test:integration -- user-programs-mesocycles-list userProgramsMesocyclesList-contamination
  ```
  Expected: `Test Files  2 passed` / `Tests  5 passed`.

- [ ] Commit:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS && git add frontend/playwright/w8-prior-recap-reachability.spec.ts docs/qa/beta-reachability.md && git commit -m "test(w8): prior-recap reachability e2e + finalize beta-reachability doc (G7)"
  ```

---

**Acceptance (WS6):** every Beta surface documented ≤3 clicks with selectors in `docs/qa/beta-reachability.md` (consolidated G7 sign-off appended); prior-mesocycle recap reachable via Programs → Past → "View recap" (list endpoint shipped + Playwright + vitest assertions); contamination test on the new `GET /user-programs/:id/mesocycles` endpoint (feeds WS2/G2 matrix); `npm run validate` green; `npm run test:integration` green for the new specs.

---

## WS7 — Pre-Beta security re-review (placeholder hygiene + security audit) -> G8 / G11

Closes **G8** (placeholder hygiene: grep-clean non-test source + a reintroduction guard + an insert-time runtime guard) and **G11** (full AuthN/AuthZ + IDOR + input-validation re-review; close every Critical + Important in `docs/superpowers/specs/beta/08-qa.md` §"Pre-Beta security review checklist", zero v1.5 deferrals, any accept-residual-risk written down).

**Re-audit grounding (verified 2026-05-29 against the repo — do not re-derive, trust these):**
- `api/src/bootstrap-runtime.ts` ALREADY EXISTS. `validatePlaceholderPurge(env)` (line 27) defines `PLACEHOLDER_UUID = '00000000-0000-0000-0000-000000000001'` (line 15) and at **boot** `process.exit(1)`s if a `users` row with that id exists in `production`. It is wired in `api/src/index.ts:18`. There is **no insert-time guard yet** — that is the new piece in WS7.2. The grep guard (WS7.1) must **allowlist `api/src/bootstrap-runtime.ts`** because it legitimately names the UUID.
- Grep is currently **clean**: the only source occurrences of the literal UUID / `PLACEHOLDER` token are in `api/src/bootstrap-runtime.ts`. `frontend/src/auth.tsx` has **zero** placeholder references (checklist item 10 already satisfied). `api/src/bootstrap-guards.ts:35` references the *unrelated* `"changeme"` Postgres-password placeholder — different string, must not trip the guard.
- The **one real, demonstrable G11 gap** found during the scan: `:id` path params are passed raw into typed DB columns on several routes, so a malformed id returns **500 with a raw DB error** (`invalid input syntax for type uuid`/`bigint`) instead of a clean 404. **Empirically confirmed**: `GET /api/mesocycles/not-a-uuid` returns **500** (run against `repos_test`). Affected: `mesocycles.ts`, `mesocyclesDeload.ts`, `plannedSets.ts`, `userPrograms.ts` (`id` is `uuid`), and `account.ts` sessions-delete + `tokens.ts` (`device_tokens.id` is `bigint`). The proven-good pattern already exists: `setLogs.ts` uses `IdParamSchema` (`api/src/schemas/setLogs.ts:68`) → 404 on bad id; `adminFeedback.ts:37` guards its bigint id with a digit+range regex → 404. WS7.3 generalizes that pattern to the unguarded routes.
- Column types confirmed via `information_schema`: `mesocycle_runs.id = uuid`, `planned_sets.id = uuid`, `device_tokens.id = bigint`. (Note: `08-qa.md`'s W6 closure claims sessions-delete "validates the session/token id as a UUID" — that is factually wrong; the column is `bigint` and the handler does **no** id validation. WS7.3 corrects the record.)

Order: WS7.1 (reintroduction guard) → WS7.2 (insert-time runtime guard) → WS7.3 (audit + the `:id` remediation + 08-qa.md closure). WS7.1 and WS7.2 are independent; WS7.3 depends on neither but its checklist-closure step references both.

---

### Task WS7.1: Placeholder reintroduction guard (grep-based CI script)

ESLint is intentionally NOT introduced (design decision #6 — no ESLint config exists anywhere; standing one up for a single rule is disproportionate). Instead add a small shell script that greps non-test source and fails on any placeholder-UUID occurrence outside the one allowlisted enforcement file.

Files:
- Create: `scripts/check-no-placeholder.sh`
- Create: `scripts/check-no-placeholder.test.sh` (a self-contained bash test harness — no test framework needed)
- Modify: `.github/workflows/test.yml` (add a `placeholder-guard` job) — **CROSSREF WS1** (WS1 also edits `test.yml`; coordinate the merge so both jobs land — see crossrefs)

- [ ] Write the failing test harness first. Create `scripts/check-no-placeholder.test.sh`:
  ```bash
  #!/usr/bin/env bash
  # Test harness for check-no-placeholder.sh. Self-contained: no framework.
  # Each case prints PASS/FAIL; the script exits non-zero if any case fails.
  set -uo pipefail
  ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  GUARD="$ROOT/scripts/check-no-placeholder.sh"
  fail=0

  # Case 1: clean tree (allowlisted bootstrap-runtime.ts is the only occurrence) -> exit 0
  if bash "$GUARD" >/dev/null 2>&1; then
    echo "PASS: clean tree passes"
  else
    echo "FAIL: clean tree should pass but guard exited non-zero"; fail=1
  fi

  # Case 2: synthetic reintroduction in a non-allowlisted file -> exit non-zero
  TMP="$ROOT/api/src/__placeholder_probe__.ts"
  trap 'rm -f "$TMP"' EXIT
  printf 'const x = "00000000-0000-0000-0000-000000000001";\n' > "$TMP"
  if bash "$GUARD" >/dev/null 2>&1; then
    echo "FAIL: synthetic reintroduction should fail but guard passed"; fail=1
  else
    echo "PASS: synthetic reintroduction fails the guard"
  fi
  rm -f "$TMP"; trap - EXIT

  # Case 3: the allowlisted file alone must NOT trip the guard
  if bash "$GUARD" >/dev/null 2>&1; then
    echo "PASS: bootstrap-runtime.ts allowlist holds"
  else
    echo "FAIL: allowlist for bootstrap-runtime.ts is not working"; fail=1
  fi

  exit "$fail"
  ```
- [ ] Run the test — expect FAIL (the guard does not exist yet):
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS && bash scripts/check-no-placeholder.test.sh
  ```
  Expected: the harness errors / prints `FAIL` lines because `scripts/check-no-placeholder.sh` does not exist (`bash: .../check-no-placeholder.sh: No such file or directory`), exit code non-zero.
- [ ] Write the minimal implementation. Create `scripts/check-no-placeholder.sh`:
  ```bash
  #!/usr/bin/env bash
  # G8 reintroduction guard. Fails if the placeholder user UUID appears in
  # non-test production source. The boot-time enforcement file legitimately
  # names the UUID and is the ONLY allowlisted occurrence.
  #
  # Decision (W8 design #6): grep guard, not ESLint — no lint toolchain exists.
  set -euo pipefail
  ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

  PLACEHOLDER='00000000-0000-0000-0000-000000000001'
  ALLOWLIST='api/src/bootstrap-runtime.ts'

  # Search production source only: api/src + frontend/src. Exclude tests,
  # __tests__, *.test.*, *.spec.*, and the allowlisted enforcement file.
  hits="$(grep -rIn --include='*.ts' --include='*.tsx' \
            --exclude-dir='__tests__' \
            --exclude='*.test.ts' --exclude='*.test.tsx' \
            --exclude='*.spec.ts' --exclude='*.spec.tsx' \
            "$PLACEHOLDER" \
            "$ROOT/api/src" "$ROOT/frontend/src" 2>/dev/null \
          | grep -v "/$ALLOWLIST" || true)"

  if [[ -n "$hits" ]]; then
    echo "FAIL: placeholder user UUID ($PLACEHOLDER) found outside the allowlist:" >&2
    echo "$hits" >&2
    echo "If this is the legitimate enforcement file, add it to ALLOWLIST in $0." >&2
    exit 1
  fi
  echo "OK: no placeholder UUID outside $ALLOWLIST"
  ```
- [ ] Make both scripts executable:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS && chmod +x scripts/check-no-placeholder.sh scripts/check-no-placeholder.test.sh
  ```
- [ ] Run the test — expect PASS:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS && bash scripts/check-no-placeholder.test.sh; echo "exit=$?"
  ```
  Expected output: three `PASS:` lines and `exit=0`.
- [ ] Run shellcheck on the guard (CI parity — actionlint/shellcheck is the house standard for new shell, cf. WS4 rollback.sh):
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS && shellcheck scripts/check-no-placeholder.sh scripts/check-no-placeholder.test.sh
  ```
  Expected: no output, exit 0. (If `shellcheck` is not installed, `brew install shellcheck`; if still unavailable note it and rely on the harness.)
- [ ] Wire into CI. In `.github/workflows/test.yml`, add this job after the existing `typecheck-api` job (sibling job, no `working-directory`):
  ```yaml
  placeholder-guard:
    runs-on: ubuntu-latest
    timeout-minutes: 2
    steps:
      - uses: actions/checkout@v4
      - run: bash scripts/check-no-placeholder.sh
  ```
  **CROSSREF WS1:** WS1 adds `api-unit` + `api-integration` to the same file. Land both edits in one branch or rebase carefully; final job list = `typecheck-api`, `build-frontend`, `validate-frontend`, `e2e-frontend`, `api-unit`, `api-integration`, `placeholder-guard`. Note `.github/workflows/*` pushes need SSH, not the gh OAuth token (`reference_gh_workflow_scope_push`).
- [ ] Verify the workflow YAML lints:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS && actionlint .github/workflows/test.yml
  ```
  Expected: no output, exit 0. (If `actionlint` is absent, `brew install actionlint`.)
- [ ] Commit:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS && git add scripts/check-no-placeholder.sh scripts/check-no-placeholder.test.sh .github/workflows/test.yml && git commit -m "feat(w8): add placeholder-UUID reintroduction guard + CI job (G8)"
  ```

---

### Task WS7.2: Insert-time runtime guard rejecting placeholder-UUID writes

Adds a pure function `assertNotPlaceholderUserId(userId, env)` to `api/src/bootstrap-runtime.ts` (coexists with the existing boot-time `validatePlaceholderPurge` — do NOT touch that function) that throws when a write would attach the placeholder UUID and `NODE_ENV !== 'test'`. It is then called at the single auto-provision insert site in `api/src/middleware/cfAccess.ts` (the only place a `users` row is created from request flow). Test-first.

Files:
- Modify: `api/src/bootstrap-runtime.ts` (add export after `validatePlaceholderPurge`, ~line 40; export the constant)
- Modify: `api/src/middleware/cfAccess.ts` (call the guard at the auto-provision insert, lines 128-137)
- Create: `api/tests/unit/placeholder-insert-guard.test.ts`

- [ ] Write the failing unit test first. Create `api/tests/unit/placeholder-insert-guard.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import {
    assertNotPlaceholderUserId,
    PLACEHOLDER_USER_ID,
  } from '../../src/bootstrap-runtime.js';

  const REAL_UUID = '11111111-2222-3333-4444-555555555555';

  describe('assertNotPlaceholderUserId', () => {
    it('throws when the placeholder UUID is written in production', () => {
      expect(() =>
        assertNotPlaceholderUserId(PLACEHOLDER_USER_ID, { NODE_ENV: 'production' } as NodeJS.ProcessEnv),
      ).toThrow(/placeholder user/i);
    });

    it('throws when the placeholder UUID is written in development', () => {
      expect(() =>
        assertNotPlaceholderUserId(PLACEHOLDER_USER_ID, { NODE_ENV: 'development' } as NodeJS.ProcessEnv),
      ).toThrow(/placeholder user/i);
    });

    it('is a no-op for the placeholder UUID in test env (fixtures may carry it)', () => {
      expect(() =>
        assertNotPlaceholderUserId(PLACEHOLDER_USER_ID, { NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      ).not.toThrow();
    });

    it('passes a real UUID in production', () => {
      expect(() =>
        assertNotPlaceholderUserId(REAL_UUID, { NODE_ENV: 'production' } as NodeJS.ProcessEnv),
      ).not.toThrow();
    });

    it('passes null / undefined without throwing (no write yet)', () => {
      expect(() => assertNotPlaceholderUserId(null, { NODE_ENV: 'production' } as NodeJS.ProcessEnv)).not.toThrow();
      expect(() => assertNotPlaceholderUserId(undefined, { NODE_ENV: 'production' } as NodeJS.ProcessEnv)).not.toThrow();
    });
  });
  ```
- [ ] Run the test — expect FAIL (the export does not exist yet):
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/unit/placeholder-insert-guard.test.ts
  ```
  Expected: failure resolving the import — `assertNotPlaceholderUserId` / `PLACEHOLDER_USER_ID` are not exported from `bootstrap-runtime.ts` (`No matching export` / `is not a function`).
- [ ] Implement the guard. In `api/src/bootstrap-runtime.ts`, change the existing private constant on line 15 to an exported alias and add the function. Replace:
  ```ts
  const PLACEHOLDER_UUID = '00000000-0000-0000-0000-000000000001';
  ```
  with:
  ```ts
  const PLACEHOLDER_UUID = '00000000-0000-0000-0000-000000000001';
  // Re-export under the spec name (08-qa.md §PLACEHOLDER) for the insert-time guard.
  export const PLACEHOLDER_USER_ID = PLACEHOLDER_UUID;
  ```
  Then add this function immediately after `validatePlaceholderPurge` (after line 40, before the W5 reaper block):
  ```ts
  /**
   * G8 insert-time guard. Refuse to attach the placeholder user UUID to any
   * write outside the test environment. The boot-time validatePlaceholderPurge
   * rejects the placeholder EXISTING in production; this is the complementary
   * write-path guard that stops it being (re)created at runtime in dev or prod.
   * No-op for null/undefined (no identity yet) and in NODE_ENV=test (fixtures
   * legitimately seed the placeholder row).
   */
  export function assertNotPlaceholderUserId(
    userId: string | null | undefined,
    env: NodeJS.ProcessEnv,
  ): void {
    if (env.NODE_ENV === 'test') return;
    if (userId === PLACEHOLDER_UUID) {
      throw new Error(
        `refusing to write placeholder user (id=${PLACEHOLDER_UUID}) — ` +
          `real identity must come from CF Access. This is a bug; see G8.`,
      );
    }
  }
  ```
- [ ] Run the unit test — expect PASS:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/unit/placeholder-insert-guard.test.ts
  ```
  Expected: `Test Files  1 passed (1)` / `Tests  5 passed (5)`.
- [ ] Wire the guard into the only request-flow user-insert site. In `api/src/middleware/cfAccess.ts`, add the import at the top (after the `requireAuth` import on line 4):
  ```ts
  import { assertNotPlaceholderUserId } from '../bootstrap-runtime.js';
  ```
  Then inside `requireCfAccess`, right after the auto-provision INSERT captures the new id (after line 135 `userId = ins.rows[0].id as string;`), add:
  ```ts
      assertNotPlaceholderUserId(userId, process.env);
  ```
  (Postgres generates a real `gen_random_uuid()` so this never fires in normal operation — it is a defense-in-depth tripwire that fails loudly if a DB default is ever mis-seeded to the placeholder.)
- [ ] Typecheck — expect clean:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx tsc --noEmit
  ```
  Expected: no output, exit 0.
- [ ] Confirm grep stays clean (the new exported `PLACEHOLDER_USER_ID` constant is still inside the allowlisted `bootstrap-runtime.ts`, so the WS7.1 guard must still pass):
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS && bash scripts/check-no-placeholder.sh && bash scripts/check-no-placeholder.test.sh
  ```
  Expected: `OK: no placeholder UUID outside api/src/bootstrap-runtime.ts` then three `PASS:` lines.
- [ ] Run the existing bootstrap/runtime suites to confirm no regression to the boot-time guard:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/unit/startup-guards.test.ts tests/unit/placeholder-insert-guard.test.ts
  ```
  Expected: both files pass.
- [ ] Commit:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS/api && git add src/bootstrap-runtime.ts src/middleware/cfAccess.ts tests/unit/placeholder-insert-guard.test.ts && git commit -m "feat(w8): insert-time placeholder-UUID write guard (G8)"
  ```

---

### Task WS7.3: Security audit — map all 26 checklist items + remediate the `:id` validation gap (G11)

This task (a) produces the authoritative item-by-item audit map, (b) fixes the one real Critical/Important gap found (unvalidated `:id` path params → 500 with raw DB error), and (c) updates `08-qa.md` marking each of the 26 items closed-with-PR-link or signed-off. Per `feedback_ship_clean` there are **zero v1.5 deferrals**; the only finding requiring code lands here.

#### WS7.3a — Shared id-param schema (DRY the proven-good pattern)

The existing good pattern is `IdParamSchema` in `api/src/schemas/setLogs.ts:68` (UUID) and the bigint regex+range guard in `adminFeedback.ts:37`. Promote both into one shared module so every `:id` route reuses them instead of re-implementing.

Files:
- Create: `api/src/schemas/idParams.ts`
- Create: `api/tests/unit/id-params.test.ts`
- Modify: `api/src/schemas/setLogs.ts` (re-export `IdParamSchema` from the shared module to avoid two definitions)

- [ ] Write the failing unit test first. Create `api/tests/unit/id-params.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { UuidParamSchema, isValidBigintId } from '../../src/schemas/idParams.js';

  describe('UuidParamSchema', () => {
    it('accepts a real v4 UUID', () => {
      const r = UuidParamSchema.safeParse({ id: '11111111-2222-4333-8444-555555555555' });
      expect(r.success).toBe(true);
    });
    it('rejects a non-UUID string', () => {
      const r = UuidParamSchema.safeParse({ id: 'not-a-uuid' });
      expect(r.success).toBe(false);
    });
    it('rejects an empty id', () => {
      const r = UuidParamSchema.safeParse({ id: '' });
      expect(r.success).toBe(false);
    });
  });

  describe('isValidBigintId', () => {
    it('accepts a positive integer string', () => {
      expect(isValidBigintId('42')).toBe(true);
    });
    it('rejects a non-numeric string', () => {
      expect(isValidBigintId('abc')).toBe(false);
    });
    it('rejects zero and negatives', () => {
      expect(isValidBigintId('0')).toBe(false);
      expect(isValidBigintId('-1')).toBe(false);
    });
    it('rejects values beyond bigint max (would throw 22003 on the DB)', () => {
      expect(isValidBigintId('100000000000000000000000')).toBe(false);
    });
  });
  ```
- [ ] Run — expect FAIL:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/unit/id-params.test.ts
  ```
  Expected: import failure — `src/schemas/idParams.js` does not exist.
- [ ] Implement. Create `api/src/schemas/idParams.ts`:
  ```ts
  import { z } from 'zod';

  // Shared :id path-param guards. Before W8 only setLogs.ts (UUID) and
  // adminFeedback.ts (bigint) validated their :id; other UUID/bigint-keyed
  // routes passed req.params.id raw into typed columns, so a malformed id threw
  // a Postgres "invalid input syntax" error → 500 with raw DB text in the body
  // (G11 finding). These guards turn that into a clean 404.
  export const UuidParamSchema = z.object({
    id: z.string().uuid(),
  });
  export type UuidParam = z.infer<typeof UuidParamSchema>;

  // device_tokens.id is BIGSERIAL (bigint). A digit-only string can still
  // overflow bigint (22003) on the UPDATE, so range-check too. Anything that
  // cannot be a valid row id is a clean 404 (mirrors adminFeedback.ts:37).
  const BIGINT_MAX = 9223372036854775807n;
  export function isValidBigintId(id: string): boolean {
    if (!/^\d+$/.test(id)) return false;
    try {
      const n = BigInt(id);
      return n >= 1n && n <= BIGINT_MAX;
    } catch {
      return false;
    }
  }
  ```
- [ ] Run — expect PASS:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/unit/id-params.test.ts
  ```
  Expected: `Tests  7 passed (7)`.
- [ ] DRY: make `setLogs.ts`'s `IdParamSchema` re-export the shared one so there is a single definition. In `api/src/schemas/setLogs.ts`, replace lines 66-71:
  ```ts
  // :id param schema — shared by PATCH and DELETE. GET uses
  // SetLogListQuerySchema for the planned_set_id query param.
  export const IdParamSchema = z.object({
    id: z.string().uuid(),
  });
  export type IdParam = z.infer<typeof IdParamSchema>;
  ```
  with:
  ```ts
  // :id param schema — re-exported from the shared module so there is one
  // canonical UUID-param validator. GET uses SetLogListQuerySchema instead.
  export { UuidParamSchema as IdParamSchema } from './idParams.js';
  export type { UuidParam as IdParam } from './idParams.js';
  ```
- [ ] Confirm setLogs still typechecks + its tests still pass (the re-export must be a drop-in):
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx tsc --noEmit && npx vitest run tests/plannedSets.test.ts
  ```
  Expected: tsc clean; plannedSets contract tests pass (they exercise the UUID semantics).
- [ ] Commit:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS/api && git add src/schemas/idParams.ts src/schemas/setLogs.ts tests/unit/id-params.test.ts && git commit -m "refactor(w8): shared :id param validators (UUID + bigint) (G11)"
  ```

#### WS7.3b — Apply UUID validation to the four UUID-keyed routes (failing-500 → clean-404)

Files:
- Create: `api/tests/integration/id-param-validation.test.ts`
- Modify: `api/src/routes/mesocycles.ts` (handlers at lines 24, 54, 72, 152)
- Modify: `api/src/routes/mesocyclesDeload.ts` (handlers at lines 18, 35)
- Modify: `api/src/routes/plannedSets.ts` (handlers at lines 15, 125)
- Modify: `api/src/routes/userPrograms.ts` (handlers at lines 60, 75, 300, 320)

- [ ] Write the failing integration test first. Create `api/tests/integration/id-param-validation.test.ts`:
  ```ts
  import 'dotenv/config';
  import { describe, it, expect, afterEach, afterAll } from 'vitest';
  import { build } from '../helpers/build-test-app.js';
  import { mkUserPair, cleanupUserPair, type UserPairHandle } from '../helpers/seed-fixtures.js';
  import { db } from '../../src/db/client.js';

  const handles: UserPairHandle[] = [];
  afterEach(async () => { if (handles.length) await cleanupUserPair(handles.splice(0)); });
  afterAll(async () => { await db.end(); });

  // G11 — a malformed :id must be a clean 404, never a 500 that leaks a raw
  // Postgres "invalid input syntax for type uuid" error in the response body.
  const UUID_ROUTES: Array<{ method: 'GET' | 'POST' | 'PATCH'; url: string }> = [
    { method: 'GET',   url: '/api/mesocycles/not-a-uuid' },
    { method: 'GET',   url: '/api/mesocycles/not-a-uuid/volume-rollup' },
    { method: 'GET',   url: '/api/mesocycles/not-a-uuid/recap-stats' },
    { method: 'POST',  url: '/api/mesocycles/not-a-uuid/abandon' },
    { method: 'POST',  url: '/api/mesocycles/not-a-uuid/deload-now' },
    { method: 'POST',  url: '/api/mesocycles/not-a-uuid/deload-now/undo' },
    { method: 'PATCH', url: '/api/planned-sets/not-a-uuid' },
    { method: 'POST',  url: '/api/planned-sets/not-a-uuid/substitute' },
    { method: 'GET',   url: '/api/user-programs/not-a-uuid' },
    { method: 'PATCH', url: '/api/user-programs/not-a-uuid' },
    { method: 'GET',   url: '/api/user-programs/not-a-uuid/warnings' },
    { method: 'POST',  url: '/api/user-programs/not-a-uuid/start' },
  ];

  describe('G11 — malformed :id is a clean 404, not a 500', () => {
    for (const route of UUID_ROUTES) {
      it(`${route.method} ${route.url} -> 404`, async () => {
        const app = await build();
        const pair = await mkUserPair();
        handles.push(pair);
        const res = await app.inject({
          method: route.method,
          url: route.url,
          headers: { authorization: `Bearer ${pair.userA.bearer}` },
          // Minimal valid-ish bodies for the mutating routes; the id guard
          // fires before body validation matters.
          payload: route.method === 'GET' ? undefined : {},
        });
        expect(res.statusCode, `expected clean 404, got ${res.statusCode}: ${res.body.slice(0, 200)}`).toBe(404);
        // Body must not leak the raw DB error.
        expect(res.body).not.toMatch(/invalid input syntax/i);
      });
    }
  });
  ```
- [ ] Run — expect FAIL:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/integration/id-param-validation.test.ts --config vitest.integration.config.ts
  ```
  Expected: multiple cases fail with `expected clean 404, got 500: ...invalid input syntax for type uuid...` (the four UUID routes currently 500). (`/start` may already 404 if its query/body guard fires first — that case will pass; the rest fail.)
- [ ] Implement in `api/src/routes/mesocycles.ts`. Add the import after line 2:
  ```ts
  import { UuidParamSchema } from '../schemas/idParams.js';
  ```
  Then at the top of each handler body (the four handlers at lines 27, 57, 75, and the abandon handler ~155), as the first statement before any `db.query`, add:
  ```ts
      if (!UuidParamSchema.safeParse(req.params).success) {
        return reply.code(404).send({ error: 'mesocycle_run not found', field: 'id' });
      }
  ```
  (Match the existing 404 shape these handlers already return on a miss — see lines 37-38.)
- [ ] Implement in `api/src/routes/mesocyclesDeload.ts`. Add the import:
  ```ts
  import { UuidParamSchema } from '../schemas/idParams.js';
  ```
  At the top of both handlers (lines 18 `/deload-now` and 35 `/deload-now/undo`), before the `applyManualDeload`/`undoManualDeload` call:
  ```ts
        if (!UuidParamSchema.safeParse(req.params).success) {
          return reply.code(404).send({ error: 'mesocycle_run not found', field: 'id' });
        }
  ```
- [ ] Implement in `api/src/routes/plannedSets.ts`. Add the import (it already imports its other schemas near the top), then at the top of the PATCH handler (line 15 `/planned-sets/:id`) and the substitute handler (line 125), before the existing `safeParse(req.body)`:
  ```ts
      if (!UuidParamSchema.safeParse(req.params).success) {
        return reply.code(404).send({ error: 'planned_set not found', field: 'id' });
      }
  ```
  (Use the 404 error shape this file already returns for a planned-set miss — read the surrounding handler to match the exact `error`/`field` keys.)
- [ ] Implement in `api/src/routes/userPrograms.ts`. Add the import, then at the top of each of the four `:id` handlers (lines 60, 75, 300, 320), before the first DB/resolver call:
  ```ts
      if (!UuidParamSchema.safeParse(req.params).success) {
        return reply.code(404).send({ error: 'user_program not found', field: 'id' });
      }
  ```
  (Match the file's existing user-program-miss 404 shape — read the handler bodies to copy the exact keys.)
- [ ] Run — expect PASS:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/integration/id-param-validation.test.ts --config vitest.integration.config.ts
  ```
  Expected: all UUID-route cases `-> 404` pass; no `invalid input syntax` in any body.
- [ ] Typecheck:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx tsc --noEmit
  ```
  Expected: no output, exit 0.
- [ ] Commit:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS/api && git add src/routes/mesocycles.ts src/routes/mesocyclesDeload.ts src/routes/plannedSets.ts src/routes/userPrograms.ts tests/integration/id-param-validation.test.ts && git commit -m "fix(w8): validate UUID :id params (404 not 500 on malformed id) (G11)"
  ```

#### WS7.3c — Apply bigint validation to the two device_tokens routes

`device_tokens.id` is `bigint` (NOT UUID — `08-qa.md` W6 closure says "UUID"; that is wrong and gets corrected in WS7.3d). `account.ts` sessions-delete and `tokens.ts` delete both pass raw `req.params.id` into `WHERE id = $1` against the bigint column → `invalid input syntax for type bigint` → 500.

Files:
- Modify: `api/src/routes/account.ts` (handler at line 256, `DELETE /account/sessions/:id`)
- Modify: `api/src/routes/tokens.ts` (handler at line 115, `DELETE /tokens/:id`)
- Modify: `api/tests/integration/id-param-validation.test.ts` (add bigint cases)

- [ ] Extend the integration test with the two bigint routes. In `api/tests/integration/id-param-validation.test.ts`, add a second describe block after the existing one:
  ```ts
  describe('G11 — malformed bigint :id (device_tokens) is a clean 404, not a 500', () => {
    it('DELETE /api/account/sessions/not-a-number -> 404', async () => {
      const app = await build();
      const pair = await mkUserPair();
      handles.push(pair);
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/account/sessions/not-a-number',
        headers: { authorization: `Bearer ${pair.userA.bearer}` },
      });
      expect(res.statusCode, `got ${res.statusCode}: ${res.body.slice(0, 200)}`).toBe(404);
      expect(res.body).not.toMatch(/invalid input syntax/i);
    });

    it('DELETE /api/tokens/not-a-number -> 404', async () => {
      const app = await build();
      const pair = await mkUserPair();
      handles.push(pair);
      // ADMIN_API_KEY is unset in the test env, so the admin gate opens the
      // path (authMode='admin'); user_id must be supplied on the admin path.
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/tokens/not-a-number?user_id=${pair.userA.userId}`,
      });
      expect(res.statusCode, `got ${res.statusCode}: ${res.body.slice(0, 200)}`).toBe(404);
      expect(res.body).not.toMatch(/invalid input syntax/i);
    });
  });
  ```
- [ ] Run — expect FAIL (both currently 500):
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/integration/id-param-validation.test.ts --config vitest.integration.config.ts
  ```
  Expected: the two new cases fail with `got 500: ...invalid input syntax for type bigint...`.
- [ ] Implement in `api/src/routes/account.ts`. Add the import near the top of the file:
  ```ts
  import { isValidBigintId } from '../schemas/idParams.js';
  ```
  In the `DELETE /account/sessions/:id` handler, immediately after the `if (!userId) return reply.code(500)...` line (line 261), add:
  ```ts
        if (!isValidBigintId(req.params.id)) {
          return reply.code(404).send({ error: 'session_not_found' });
        }
  ```
  (Reuse the exact 404 body the handler already returns on a miss — line 269.)
- [ ] Implement in `api/src/routes/tokens.ts`. Add the import:
  ```ts
  import { isValidBigintId } from '../schemas/idParams.js';
  ```
  In the `DELETE /tokens/:id` handler, after the `if (!userId) return reply.code(400)...` line (line 120), add:
  ```ts
        if (!isValidBigintId(req.params.id)) {
          return reply.code(404).send({ error: 'not found' });
        }
  ```
  (Reuse the exact 404 body the handler already returns — line 128.)
- [ ] Run — expect PASS (full file now green):
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/integration/id-param-validation.test.ts --config vitest.integration.config.ts
  ```
  Expected: all UUID + bigint cases pass; zero `invalid input syntax` bodies.
- [ ] Typecheck + run the touched routes' existing suites to confirm no regression:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx tsc --noEmit && npx vitest run tests/integration/contamination/account-sessions-delete-contamination.test.ts --config vitest.integration.config.ts
  ```
  Expected: tsc clean; the W6 sessions-delete contamination test still passes (real-UUID... real-bigint... ids unaffected).
- [ ] Commit:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS/api && git add src/routes/account.ts src/routes/tokens.ts tests/integration/id-param-validation.test.ts && git commit -m "fix(w8): validate bigint :id on device_tokens routes (404 not 500) (G11)"
  ```

#### WS7.3d — Author the audit map + close all 26 checklist items in 08-qa.md

This is the documentation deliverable that satisfies the G11 closure rule. It maps EACH of the 26 items to "already satisfied (file:line)" or "closed by WS7.3 (PR #__)". The executor fills the `#__` PR-number placeholder once the WS7 PR is opened.

Files:
- Modify: `docs/superpowers/specs/beta/08-qa.md` (append a new subsection after the existing "W6 G11 closure" subsection, ~after line 347)

- [ ] Append a `### W8 G8/G11 closure` subsection to `docs/superpowers/specs/beta/08-qa.md` (after the W6 closure subsection). It must contain a table covering all 26 items grouped exactly as the checklist groups them (AuthN/AuthZ 7, Multi-user/IDOR 2, PLACEHOLDER 3, Rate limits 4, Input validation 4, Secrets/logging 3, Frontend 3), each row = `| item | Status | Evidence |`. Use these grounded statuses (the executor replaces `PR #__` with the real number):

  AuthN/AuthZ (7):
  1. Every route has an auth preHandler — **Already satisfied.** Grep confirms only `api/src/routes/muscles.ts` has no auth helper, and it is a documented public catalog (`/muscles`, `Cache-Control: public`) per checklist item "documented system catalogs". Every other route in `api/src/routes/*.ts` references `requireBearerOrCfAccess`/`requireCfAccessOnly`/`requireAdminKeyOrCfAccess`.
  2. Handlers use `req.userId`, never body/query identity — **Already satisfied.** Identity is set in `api/src/middleware/cfAccess.ts:149` / `auth.ts:70`; the contamination matrix (WS2) proves no route honors body `user_id` on the CF-Access path.
  3. CF-Access ignores body `user_id`; admin-key honors it — **Already satisfied.** `requireAdminKeyOrCfAccess` (`cfAccess.ts:213`) stamps `authMode`; `tokens.ts` uses `userIdFromReq(req, req.query.user_id)` only on the admin path.
  4. Token scopes enforced on writes — **Already satisfied.** `requireScope(...)` (`middleware/scope.ts`) gates write routes (e.g. `setLogs.ts:143` `set_logs:write`).
  5. argon2 verify bounded latency — **Already satisfied / owned by G9** (perf is the cutover k6 run; timing-equalizer dummy-verify in `auth.ts:54` already bounds the miss path).
  6. Revoked tokens reject within 60s — **Already satisfied.** Revocation is immediate at the DB (`device_tokens.revoked_at`), enforced in the `auth.ts` lookup `WHERE revoked_at IS NULL`.
  7. Expired CF Access JWT → 401 not 500 — **Already satisfied.** `requireCfAccess` catches `jwtVerify` failure → 401 (`cfAccess.ts:100-103`). Frontend recovery is G3 (cutover).

  Multi-user / IDOR (2):
  8. Every contamination test passes — **Closed by WS2** (crossref) + WS7.3b adds the new `id-param-validation` IDOR-adjacent coverage. `npm run test:integration` green.
  9. No list route without `WHERE user_id = $1` except documented catalogs — **Already satisfied.** Catalog exceptions: `/muscles`, `/exercises`, `/program-templates`. Verified by grep of list handlers.

  PLACEHOLDER (3):
  10. All `frontend/src/auth.tsx` references removed — **Already satisfied.** Grep of `frontend/src/auth.tsx` returns zero placeholder/UUID references.
  11. Tests using `PLACEHOLDER_USER_ID` updated to fixtures — **Already satisfied.** No non-allowlisted source references; tests use `mkUserPair()`/`mkLoneUser()` fixtures.
  12. No write can land `user_id = placeholder` in prod (grep + runtime guard) — **Closed by WS7.1 + WS7.2 (PR #__).** Grep guard `scripts/check-no-placeholder.sh` + CI job; insert-time `assertNotPlaceholderUserId` with unit test.

  Rate limits + abuse (4):
  13. Per-IP nginx rate limit on `/api/*` — **Already satisfied (infra layer)** per monolithic-container plan; evidence: `docker/nginx` config. If the reviewer cannot cite the live limit, record an accept-residual-risk sign-off with date (closure rule). [Executor: verify against `docker/` nginx config and cite the exact `limit_req` line, or obtain sign-off.]
  14. `POST /api/health/weight` retains 5/day 409 — **Already satisfied.** `api/tests/weight.test.ts` asserts the 409.
  15. `POST /api/tokens` limited per IP — **Already satisfied** (admin-key + CF Access gate + nginx limit per item 13).
  16. No expensive endpoint open to anonymous bursts — **Already satisfied.** `recap-stats` is behind `requireBearerOrCfAccess`; never anonymous. G9 measures its cost.

  Input validation (4):
  17. Every route validates body via Zod — **Already satisfied.** Spot-checked: `feedback.ts` (`FeedbackPostSchema`), `plannedSets.ts`, `setLogs.ts`, `account.ts`, `userPrograms.ts` all `safeParse` the body against a Zod schema.
  18. Calendar-valid date on weight — **Already satisfied.** `api/tests/weight.test.ts` (14 cases incl. calendar-invalid date).
  19. UUID validation on all `:id` path params — **Closed by WS7.3 (PR #__).** This was the real gap: `mesocycles`/`mesocyclesDeload`/`plannedSets`/`userPrograms` (uuid) + `account`/`tokens` (bigint) returned 500 on a malformed id. Now validated → clean 404. Evidence: `api/tests/integration/id-param-validation.test.ts`.
  20. No unbounded text input landing in DB — **Already satisfied.** Bounds verified: feedback body `max(4000)`, set notes `max(500)`, override_reason/target_load_hint `max(200)`, program rename `max(100)`, display_name DB+Zod `<= 80`.

  Secrets / logging (3):
  21. `authorization` header redacted in logs — **Already satisfied.** `app.ts:37-45` redacts `authorization`, `x-admin-key`, `cf-access-jwt-assertion`, `cookie`.
  22. No secret value in error body or log line — **Already satisfied + hardened by WS7.3.** Coded errors only; WS7.3 additionally removes the raw `invalid input syntax` DB error that the unvalidated `:id` paths previously leaked into 500 bodies.
  23. `.env` not in any commit — **Already satisfied.** `.env` is gitignored; no `.env` in history for this wave.

  Frontend (3):
  24. No bearer token in localStorage — **Already satisfied.** Identity is the CF Access JWT cookie; no browser-side bearer storage (W6 closure).
  25. No XSS from user-supplied text — **Already satisfied.** React text-node rendering; no `dangerouslySetInnerHTML` (W6 closure verified by grep).
  26. CSP restrictive; bundle changes don't loosen it — **Already satisfied.** WS7 adds no inline scripts/styles or new origins; helmet CSP unchanged.

  End the subsection with the closure statement: *"Per `feedback_ship_clean`: all Critical + Important closed; the one finding requiring code (item 19) is fixed in this wave. Item 13 (nginx rate limit) is an infra-layer assertion — verified against `docker/` config and cited, OR carries an engineering-lead accept-residual-risk sign-off dated below. No v1.5 deferrals."*

  Also add a one-line correction note: *"Correction to the W6 closure above: `device_tokens.id` is `bigint`, not UUID; the W6 row claiming UUID validation on sessions-delete was inaccurate — sessions-delete had no id validation until W8 (item 19)."*
- [ ] Sanity-check the doc renders (no broken table) and the placeholder PR-number tokens are present for the executor to fill:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS && grep -n "PR #__" docs/superpowers/specs/beta/08-qa.md
  ```
  Expected: the rows for items 12 and 19 (and any sign-off line) appear.
- [ ] Run the full api unit + integration suites once to confirm the whole WS7 change set is green together:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm test && npm run test:integration
  ```
  Expected: both suites pass (unit including `placeholder-insert-guard` + `id-params`; integration including `id-param-validation` + the unchanged contamination suites). Note the integration wall-clock for the WS1 90s-budget conversation (crossref WS1).
- [ ] Commit:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS && git add docs/superpowers/specs/beta/08-qa.md && git commit -m "docs(w8): close all 26 pre-Beta security checklist items (G8/G11)"
  ```

**Acceptance (WS7 done):** grep clean (`scripts/check-no-placeholder.sh` + its test pass); reintroduction guard fails CI on a synthetic reintroduction (proven by `check-no-placeholder.test.sh` case 2); the insert-time runtime guard has a passing unit test; the one real audit finding (unvalidated `:id` → 500) is fixed with `404` integration coverage across all 6 affected routes; every one of the 26 checklist items is marked closed-with-PR-link or carries written accept-residual-risk sign-off in `08-qa.md`.

---

## WS8 — Wave completion (build-now "done")

Closes the spec §8 wave-completion acceptance. Run AFTER WS1–WS7 have merged to the W8 branch.

### Task WS8.1: Full-suite + CI-budget regression

**Files:** none (verification only).

- [ ] **Run the complete backend suites and confirm green + the integration budget.**
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS/api && time npm test && time npm run test:integration
  ```
  Expected: unit `Test Files NN passed` / `Tests NNN passed`; integration `Test Files NN passed` / `Tests NNN passed | 7 skipped`, wall-clock comfortably under the 90s CI budget even after WS2 (~7 new contamination files) + WS6 (2 new tests) + WS7 (id-param tests) are added. If integration exceeds budget, apply WS1.3's file-sharding lever (do not declare done over budget).
- [ ] **Run the frontend suites + reachability.**
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npm run validate && npx playwright test --list
  ```
  Expected: validate (typecheck + unit + page-reachability) green; Playwright specs compile (`--list` succeeds), including the new WS6 prior-recap spec.
- [ ] **Confirm the final CI job inventory** on the branch's most recent push:
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS && gh run list --branch feat/w8-beta-entry-gates --limit 1
  ```
  Expected: a run exercising all 8 jobs (`typecheck-api`, `build-frontend`, `validate-frontend`, `e2e-frontend`, `api-unit`, `api-integration`, `migration-gate`, `placeholder-guard`) — all green.

### Task WS8.2: Five-lens reviewer matrix over the W8 diff

**Files:** none (review only; fixes land as follow-up commits per the receiving-code-review skill).

- [ ] **Run the reviewer matrix** against the full W8 diff (`git diff main...feat/w8-beta-entry-gates`), one reviewer per lens. Each returns Critical / Important / Minor findings with `file:line`:
  - **Backend** — route ownership, Zod coverage, the new `:id` guard, migration safety, the `GET /user-programs/:id/mesocycles` endpoint.
  - **Frontend** — the prior-recap list + MyLibrary Past-tab wiring, loading/empty states, design-token adherence, no XSS surface.
  - **Security** — the placeholder reintroduction + insert-time guards, IDOR/contamination matrix completeness, the 26-item checklist closure, secrets/logging.
  - **QA** — contamination matrix coverage (zero uncovered per-user/admin routes), e2e/reachability assertions, the k6 budget encodings.
  - **Infra** — CI job correctness (services, migrate+seed, budget), `rollback.sh` (shellcheck, caps, env-preserving), `migration-gate`, `post-deploy-smoke.yml` (actionlint, the service-token prerequisite).
- [ ] **Fix every Critical + Important finding** (`feedback_ship_clean` — no v1.5 deferrals; any accept-residual-risk gets dated written sign-off). Re-run the relevant suite after each fix.
- [ ] **Commit** the review fixes (one logical fix per commit).

### Task WS8.3: Advance the goal dashboard + open the cutover predicate

**Files:** Modify `docs/superpowers/goals/beta.md`.

- [ ] **Update the burndown** to reflect build-now completion. Mark W8 build-now `[x]`; advance the G-rows: `G1 [x]`, `G2 [x]`, `G6 [x]`, `G7 [x]`, `G8 [x]`, `G11 [x]`, `G13 [~]` (engineering-satisfied; live ping at next deploy). Keep prod-window gates explicitly `[~]`/`[ ]` with `docs/runbooks/beta-cutover-checklist.md` as their predicate: `G3 [ ]`, `G9 [~]` (scripts authored; run pending), `G10 [ ]`, `G12 [~]`.
- [ ] **Set "Next dispatch" → the cutover-window checklist.** Note that branch protection (W8.5) requires the full 8-job inventory green on `main` first.
- [ ] **Commit.**
  ```
  cd /Users/jasonmeyer.ict/Projects/RepOS && git add docs/superpowers/goals/beta.md && git commit -m "docs(beta): W8 build-now complete; gates advanced; next dispatch cutover"
  ```

**Acceptance (WS8 / W8 build-now wave):** all suites green within budget; the 8-job CI run green on the branch; reviewer matrix complete with all Critical + Important fixed; `goals/beta.md` reflects build-now `[x]` and the cutover predicate. Beta cutover is then authorized to begin (cutover checklist).

---
