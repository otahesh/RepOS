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

## W8.7 — Post-deploy smoke (G13)

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
