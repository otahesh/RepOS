# /goal — Ship RepOS Beta

**Outcome:** Close every acceptance gate in `docs/superpowers/plans/2026-05-11-repos-beta.md` and merge each wave branch into `main`. The Beta plan is the source of truth; this file is the operating brief that drives one session at a time toward that target.

Drop this prompt into a fresh Claude Code session inside `/Users/jasonmeyer.ict/Projects/RepOS` and follow it.

---

## On every session start

1. Run `git status` + `git log --oneline -10` to learn the branch state.
2. Read `docs/superpowers/plans/2026-05-11-repos-beta.md` — locate the **next unmet acceptance gate** (the lowest-numbered wave whose bullets aren't all green).
3. For that wave:
   - If a sub-plan exists in `docs/superpowers/plans/2026-05-*-beta-W{n}-*.md` → load it and execute the next unchecked step.
   - If no sub-plan exists → invoke `superpowers:brainstorming` with the user, then `superpowers:writing-plans` to author one before touching code.
4. Report what you found and what you're doing next in under 200 words. Wait for any course correction.

## Per-step discipline

Always:
- TDD: failing test first, then implementation. Use `superpowers:test-driven-development` skill on every code change.
- Run `npx tsc --noEmit` + `npm test` before every commit, both `api/` and `frontend/` if either changed.
- Conventional Commits, one logical change per commit, frequent small commits over giant feature commits.
- Update the wave sub-plan inline when reality deviates from the draft (e.g. wrong field names, missed prerequisites). The plan diff explains itself.
- Honor `feedback_ship_clean.md`: fix all Critical + Important review findings before merging. No "v1.5 backlog."

Never:
- Skip hooks (`--no-verify`).
- Force-push to `main` or merge without explicit user approval.
- Start a new wave before the current wave's acceptance gates are all green AND wave-level review is signed off.
- Add features outside the wave's stated scope.

## Stop and ask the user when

- A plan / reality mismatch implies a scope change bigger than ~2 hours of work (e.g. the W1.5.2 rollup case). Surface with `AskUserQuestion`, offer 2–3 options with explicit scope estimates.
- A user-visible UX decision is required (heatmap copy, modal layout, color semantics). Surface; do not unilaterally style.
- A destructive op is on the table (force push, dropping a migration, hard reset).
- The current branch state doesn't match what the plan describes — read more before acting; if still unclear, ask.

## Wave-completion gate (before merging any wave branch)

1. Every acceptance bullet from `2026-05-11-repos-beta.md` for that wave is met. Verify by running the relevant tests, not by reading checkboxes.
2. Dispatch the wave's reviewer matrix per the master plan (frontend / backend / security / QA reviewers — each as a parallel `Agent` invocation; see master plan line ~1525 for the W1 example).
3. Apply every Critical + Important finding the reviewers surface. Defer only Nice-to-have items, and only if the user explicitly OKs deferring.
4. Re-run full `tsc --noEmit` + `npm test` on both sides.
5. Present a "Wave N Complete" summary: what shipped, what reviewer findings landed, test counts, any plan deviations documented inline. Ask the user to approve merge.
6. Only after explicit approval: merge to `main`, push, delete the wave branch.

## What to do when a wave's plan needs writing

1. `superpowers:brainstorming` with the user — explore the scope, the constraints, the trade-offs. Do not skip this.
2. `superpowers:writing-plans` to produce the sub-plan as `docs/superpowers/plans/<date>-beta-W{n}-<slug>.md`. Follow the W1 plan structure: phases ordered with prereqs, every step has its TDD red/green/commit cycle, reviewer matrix at the end.
3. Dispatch the plan to specialist agents for review (backend / frontend / security as appropriate). Apply their findings inline. See `feedback_get_plan_reviewed.md`.
4. Get the user's go-ahead, then start the wave.

## Current state snapshot (2026-05-20)

- **Branch:** `beta/w1-live-data-foundation` — W1.3 (mobile offline logger) complete; W1.5 (e2e + volume rollup) complete; performed_sets feature landed (`3881445`).
- **W1 acceptance bullets:** all five appear met. Wave-level review still owed before merge.
- **Waves done:** W0 (auth flip), W1 (this branch, pending review + merge).
- **Waves remaining:** W2 (onboarding + clinical safety), W3 (recovery flags + sub ranking), W4 (library + swap UI), W5 (desktop swap + landmarks editor + deload), W6/W7/W8 (per master plan).

## Memory + skills you must use

- Read `MEMORY.md` and any relevant linked memories every session start — the user's preferences, project state, and prior corrections live there.
- `superpowers:using-superpowers` (auto on session start), `superpowers:test-driven-development`, `superpowers:brainstorming`, `superpowers:writing-plans`, `superpowers:executing-plans`, `superpowers:verification-before-completion`, `superpowers:dispatching-parallel-agents`, `superpowers:requesting-code-review`, `superpowers:finishing-a-development-branch` — pick the right one for the step you're on.

## End condition

Beta ships when:
- All wave branches are merged to `main`.
- Every acceptance bullet in `2026-05-11-repos-beta.md` is green.
- The user has explicitly tagged the release.

Until then, repeat the loop: orient → plan if needed → execute one step → verify → commit → either continue the wave or surface the wave-complete summary.
