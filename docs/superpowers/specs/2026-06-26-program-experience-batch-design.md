# Design — Program Experience Batch (pre-smoke-test usability)

- **Date:** 2026-06-26
- **Status:** Draft — awaiting user review
- **Author:** Jason Meyer + Claude
- **Context:** Pre-mesocycle-smoke-test usability pass. Three independent program-experience gaps surfaced during live acceptance testing of prod (`https://repos.jpmtech.com`). Each ships as its own PR (8 CI checks + branch protection on `main`).

## Problem statement

While preparing for the Milestone-2 full-mesocycle smoke test, three usability gaps block a clean run:

1. **No way to clear programs.** A pile of program forks created in May persists with no removal path. A never-started `draft` fork is unreachable by any current control (the only "reset" that exists is *abandon the active mesocycle*, which does not apply to drafts).
2. **Beginner has only a 3-day option.** Frequency is locked at the template level and there is no first-class notion of experience "tracks." A 2-day/week beginner option does not exist.
3. **No estimated time commitment.** Strength sessions show sets/reps/rest but never an estimated duration. A user cannot tell whether a program is a 30-minute or a 2-hour commitment before choosing it.

## Goals

- Give the user delete (permanent) **and** archive (reversible hide) control over their own programs, surfaced in the program library.
- Introduce **first-class Tracks** (Beginner / Intermediate / Advanced), classify the existing templates, and author a new **Beginner 2-day** template.
- Compute and display an **estimated session/week duration range** at program-selection and planning surfaces.

## Non-goals (this batch)

- A full template matrix across every track × frequency. Advanced stays thin for now (deliberate — see Feature B). Additional templates are a later authoring pass.
- Storing duration estimates in the DB or calibrating the heuristic against logged data (post-smoke-test tuning, tied to telemetry).
- Any change to the ops-level nightly Postgres backups, or the in-app Backups settings page (tracked separately).
- Changing the mesocycle/materialization engine beyond what a new 2-day template requires.

---

## Feature A — Program management: delete + archive

### Data model

Add a nullable timestamp rather than overloading the `program_status` enum's `archived` value (overloading is lossy — unarchiving would forget the prior status). This mirrors the existing `program_templates.archived_at` convention.

```sql
-- migration NNN_user_programs_archived_at.sql
ALTER TABLE user_programs ADD COLUMN archived_at TIMESTAMPTZ NULL;

-- swap the partial index off the enum value onto the new column
DROP INDEX IF EXISTS idx_user_programs_user;
CREATE INDEX idx_user_programs_user ON user_programs (user_id) WHERE archived_at IS NULL;
```

The `status='archived'` enum value becomes unused going forward (left in place; no data currently uses it in a way that requires migration — verify on prod before shipping). Default list queries filter `archived_at IS NULL`.

### Delete (permanent)

A single `DELETE` on the `user_programs` row cascades the entire subtree via existing `ON DELETE CASCADE` FKs:

```
user_programs
  └─ mesocycle_runs            (FK user_program_id, CASCADE)
       ├─ day_workouts         (FK mesocycle_run_id, CASCADE)
       │    ├─ planned_sets    (FK day_workout_id, CASCADE)
       │    └─ planned_cardio_blocks (FK day_workout_id, CASCADE)
       └─ mesocycle_run_events (FK run_id, CASCADE)
```

**Verification gate (build step):** confirm the logged-set / set-actuals table (logged set results) references its parent with `ON DELETE CASCADE`, not `RESTRICT`. If `RESTRICT`, a program with logged data would fail to delete — add a migration to make it cascade, or delete logged rows explicitly in the same transaction. This must be settled before the delete endpoint ships.

### Archive (reversible hide)

`archived_at = now()` hides the program from the Active and Past tabs; it appears only in the Archived view and can be restored (`archived_at = NULL`).

### API (all `requireBearerOrCfAccess`, ownership enforced by `user_id`)

| Method | Path | Behavior |
|---|---|---|
| `DELETE` | `/api/user-programs/:id` | Permanent cascading delete. `204` on success, `404` if not owned/found. |
| `POST` | `/api/user-programs/:id/archive` | Set `archived_at=now()`. `409` if status is `active` or `paused`. |
| `POST` | `/api/user-programs/:id/unarchive` | Set `archived_at=NULL`. |
| `GET` | `/api/user-programs?include=archived` | New filter returning only `archived_at IS NOT NULL`. |

### Rules / edge cases

- **Delete** allowed on any status. The heavy-tier confirm copy states explicitly that logged data is destroyed and the action is irreversible.
- **Archive** disallowed on `active`/`paused` (`409` with actionable message: "Finish or abandon the active mesocycle first"). Allowed on `draft`, `completed`, `abandoned`.
- The single-active-mesocycle invariant is unaffected (deleting/archiving never creates a second active run).
- Deleting the program backing the current active run is permitted (cascade abandons it) — the confirm copy must call this out.

### Frontend (`frontend/src/components/programs/MyLibrary.tsx`)

- Per-card actions: **Archive** (Active/Past cards, when allowed) and **Delete** (all cards).
- Delete uses the existing `ConfirmDialog` with `tier="heavy"` (type the program name to confirm) — same pattern as mesocycle abandon.
- New **Archived** tab beside Active/Past, listing archived programs with **Restore** (unarchive) + **Delete**.
- Errors surface via toast with actionable detail (no silent swallow — same lesson as the equipment-save fix).

### Tests

- API: delete cascades (children gone); ownership (cannot delete another user's program → 404); archive→unarchive round-trip; archive blocked on active/paused (409); list filter `include=archived`; logged-set cascade behavior.
- Frontend: card actions render per status; heavy confirm gates delete; Archived tab + restore flow.

### One-time cleanup

After the endpoint ships, clear the May cruft via the new `DELETE` (lifting data is wipe-recreatable pre-launch) so the smoke test starts from a clean library.

---

## Feature B — First-class Tracks + Beginner 2-day

### Data model

```sql
-- migration NNN_program_templates_track.sql
ALTER TABLE program_templates ADD COLUMN track TEXT
  CHECK (track IN ('beginner','intermediate','advanced'));

-- backfill existing seeds
UPDATE program_templates SET track='beginner'     WHERE slug='full-body-3-day';
UPDATE program_templates SET track='intermediate' WHERE slug='upper-lower-4-day';
UPDATE program_templates SET track='intermediate' WHERE slug='strength-cardio-3-2';

ALTER TABLE program_templates ALTER COLUMN track SET NOT NULL;
```

- Add `track` to: the Zod template schema (`api/src/schemas/programTemplate.ts`), `ProgramTemplateRecord` (`api/src/types/program.ts`), and the seed adapter so future seeds carry it.
- `track` is orthogonal to cardio content (the strength-cardio hybrid is classified by experience level, not separated into a cardio "track").

### New template: `full-body-2-day` (track: beginner)

- **Shape:** 5 weeks, 2 days/week, day offsets `0` (Mon) and `3` (Thu). Full-body A / Full-body B.
- **Programming intent (draft — to be reviewed):** beginner MEV/MAV (≈2→4 sets/muscle/week ramp), reps 8–12, RIR 3→1 across the block, rest 90–150s. Compound-led with minimal isolation to keep sessions short and learnable.
  - **Day A (squat-emphasis):** squat pattern (e.g. goblet/back squat), horizontal press (bench/DB press), vertical pull (lat pulldown / assisted pull-up), hip hinge accessory (leg curl), core.
  - **Day B (hinge-emphasis):** hip hinge (Romanian deadlift), vertical press (DB overhead press), horizontal pull (chest-supported / cable row), knee accessory (leg extension or split squat), calves/core.
- Exact exercise slugs to be matched against the existing exercise library during implementation.
- **This template gets an independent programming-review pass before merge** (same scrutiny as the existing seeded templates — not hand-waved).

### UX

- **Catalog** (`frontend/src/components/programs/ProgramCatalog.tsx`) and **onboarding** (`frontend/src/components/onboarding/steps/ProgramStep.tsx`) group templates into **Beginner / Intermediate / Advanced**, defaulting to Beginner (safest first impression). Onboarding currently has no experience step (Welcome → Goal → Equipment → Program → Ready); track grouping is added inside the existing Program step rather than as a new step, to keep onboarding short.
- A track with no (or very few) templates renders a "More coming" state, not a dead/empty tab.
- API: `GET /api/program-templates?track=<t>` filter; `track` included in list + detail payloads.

### Tests

- API: `track` schema validation (reject unknown); `?track=` filter; seed loads the new template with `track='beginner'`.
- Materialization: forking + starting `full-body-2-day` produces day_workouts on offsets 0 and 3 only (2 days/week) across all weeks.
- Frontend: catalog groups by track; the 2-day template appears under Beginner; empty Advanced shows the "More coming" state.

---

## Feature C — Estimated session/week duration

### Computation (pure, server-side, no schema change, no storage)

Computed on the fly from the (effective) structure so it always reflects swaps/added sets. Helper module e.g. `api/src/services/durationEstimate.ts`.

**Per strength set:** `time = avg_reps × sec_per_rep + rest_sec`
- `avg_reps = (target_reps_low + target_reps_high) / 2` (and the bounds drive the range — see below).
- `sec_per_rep` from `peak_tension_length`: `short → 2.0s`, `mid → 3.0s`, `long`/`lengthened_partial_capable → 4.0s` (default `3.0s`). Constants centralized + tunable.

**Per strength session:** `Σ(set times) + (num_exercises × setup_overhead) + warmup`
- `setup_overhead ≈ 60s` per exercise; `warmup ≈ 300s` fixed if the session has ≥1 strength block.

**Cardio blocks:** use `target_duration_sec` directly.

**Range (not a point estimate):**
- Low bound computes set times with `target_reps_low`; high bound with `target_reps_high`. `rest_sec`, setup, and warmup are constant across bounds.
- Round each bound to the nearest 5 minutes for display.

**Week total:** sum of per-day low bounds → week low; sum of per-day high bounds → week high.

### Surfaces

- **Catalog / onboarding cards:** `~X–Y min/session · ~H hr/week`.
- **Program preview** (`ProgramTemplateDetail.tsx` / `ForkWizard.tsx`): per-day `~X–Y min` + week total.
- **Workout view** (`TodayWorkoutMobile.tsx` and desktop equivalent): `Est. ~X–Y min` for the day's session.
- A tooltip explains the figure is an estimate and how it is derived (consistent with the term-of-art tooltip convention).

### API

- `GET /api/program-templates` (list): include `est_week_min_low/high` and a typical `est_session_min_low/high` per template.
- `GET /api/program-templates/:slug` (detail): include per-day estimates + week total.
- `GET /api/user-programs/:id`: compute estimates on the **effective** structure (post-customization).

### Tests

- Unit: `estimateSessionMinutes` for a known structure → expected low/high; cardio handled via `target_duration_sec`; empty/rest-day edge case.
- API: detail + list endpoints return estimate fields.
- Frontend: estimate range renders on catalog cards, preview, and workout view.

### Tuning note

The heuristic is explicitly an estimate until calibrated against real logged session times (post-smoke-test, tied to telemetry). Labeled as such in the UI; constants centralized for adjustment without touching call sites.

---

## Sequencing (3 PRs)

1. **PR1 — Program management (delete + archive).** Smallest, highest immediate value; unblocks a clean smoke-test start. Carries this spec doc.
2. **PR2 — Duration estimation.** Purely additive, zero data risk.
3. **PR3 — Tracks + Beginner 2-day.** Largest; schema + seed + onboarding + catalog. The new template gets an independent programming review before merge.

Each PR: Conventional Commits, must pass the 8 required CI checks + branch protection on `main`, frontend `npm run validate` (includes prettier + custom gates) run locally before push, and the relevant new tests.

## Risks / open concerns

1. **Thin Advanced track** is a slightly awkward UX until Advanced templates are authored — mitigated by the "More coming" state.
2. **Duration is a heuristic** — labeled as an estimate, no false precision, constants centralized for tuning.
3. **The 2-day template needs genuine programming review** — adversarial/expert pass before merge.
4. **Delete is destructive and irreversible** — heavy confirm mandatory; logged-set FK cascade verified before shipping.
5. **`status='archived'` enum value** becomes vestigial — confirm no prod rows rely on it before swapping the index.

## Acceptance criteria

- **A:** A draft (never-started) program can be deleted and a finished program archived from the library; archived programs appear in an Archived tab and can be restored; deletes require a heavy typed confirm; the May cruft is cleared.
- **B:** Catalog + onboarding group templates by track; a Beginner 2-day template exists, forks, and materializes to Mon/Thu across the block; Advanced shows a "More coming" state.
- **C:** Catalog, preview, and workout views show an estimated session/week time range computed server-side; cardio duration is included; the figure has an explanatory tooltip.
