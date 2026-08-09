# Workout Logging Redesign — Design Spec

**Date:** 2026-07-06
**Status:** Approved direction (brainstormed with visual companion; user selections recorded below)
**Surfaces:** Mobile-first, responsive on desktop (no viewport-exclusive features — see memory rule `no-desktop-exclusive-features`)

## Problem

The current logger (`TodayLoggerMobile.tsx`, ~750 lines) is a single scrolling page: every exercise and every set stacked together. It works, but:

- No sense of place — mid-workout you scroll to find your exercise.
- No exercise education — a beginner facing "Incline DB Bench Press" gets a name and rep range. Nothing tells them what angle the bench goes to, how to set up, or what good form looks like.
- No history — "what did I lift last time?" (the #1 mid-workout question) is unanswerable in the UI even though the data exists.
- Set inputs are small; the visual language is denser than it is helpful.

Reference the user liked: RP Hypertrophy App's exercise card (muscle chip, name + equipment subtitle, video/history icons on the card, big WEIGHT / REPS / LOG table).

## Decisions (from brainstorm)

| Question | Choice |
|---|---|
| Flow shape | **B — Hub + focus screens** (over linear stepper or polished scroll) |
| Exercise info depth | **A — Setup card** (30-second answer; not the long-form lesson) |
| Imagery | **Gemini-generated photorealistic photos** + app-rendered annotations (SVG line-art rejected as not good enough) |
| Focus screen layout | **B — Logging-forward** (compact header, ⓘ/⟲ buttons; photo behind ⓘ, not a hero header) |

## Architecture

### 1. Hub screen (the day's whiteboard)

Replaces the top level of the logger at the existing route (`/today/:mesocycleRunId/log`). Offline logging queue (`logBuffer`/IDB) is unchanged underneath.

- One row per exercise block: muscle chip (existing color tokens), exercise name, status — `✓ n/n sets` (done, green), `▶ up next` (accented border), `0/n` (dim).
- Rows are tappable → focus screen for that block.
- Persistent **CONTINUE →** button targets the first unfinished exercise.
- Cardio blocks and the existing deload button/banner stay on the hub.

### 2. Focus screen (one exercise)

Route: hub + block index (e.g. `/today/:runId/log/:blockIdx`) so refresh/back behave.

- **Header:** muscle chip, exercise name, equipment subtitle (derived from `required_equipment`), and two buttons: **ⓘ how-to** (opens setup card) and **⟲ history**.
- **Set table (RP-style):** one row per planned set — WEIGHT / REPS inputs (large, monospace) + LOG button. Logged rows collapse to `✓ weight × reps` and stay visible.
- **Prefill:** weight/reps inputs pre-populate from the user's most recent logged performance of this exercise (per set_idx where available, else last session's top set). Never prefill from a different exercise.
- **Last-time line:** `last time: 25 lbs × 9, 9` under the table (same data source as prefill).
- **Effort cue** pinned below the table: plain-language on beginner track ("Leave 3 reps in the tank"), `RIR n` otherwise — reuses the shipped `effortCue`/`isBeginnerTrack` helpers.
- **Rest timer:** starts automatically when a set is logged, counts down `rest_sec`, visible on the focus screen. Client-side only; no persistence requirements v1.
- **DONE → back to plan** returns to the hub; hub state reflects completion.
- Existing per-block features carry over: suggested substitutions, mid-session swap (BlockOverflowMenu → MidSessionSwapPicker), skip.

### 3. History sheet (⟲)

Bottom sheet listing the last ~8 performances of this exercise: date, per-set `weight × reps` (+ RIR when non-beginner). Data from `set_logs` joined through planned sets; needs a small API endpoint:

- `GET /api/exercises/:slug/history?limit=8` → `[{ date, sets: [{weight_lbs, reps, rir}] }]`, scoped to the authenticated user. Also powers prefill (limit=1 case).

### 4. Setup card (ⓘ) — exercise education

One screen, no long scroll:

1. **Photo** (see §5) with app-rendered annotation tags (e.g. `bench 30°`).
2. **Set up** — callout box with the concrete numbers: equipment settings, angles, positions. Example content style: *"Bench: 30° — usually the 2nd incline notch. 15–30° hits upper chest; past 45° it becomes a shoulder press. Feet flat, slight arch, shoulder blades pinched."*
3. **Cues** — 3 bullet form cues.
4. **Don't** — 2 common mistakes.

Opens as a sheet from the focus screen ⓘ; later also reachable from the exercise library (out of scope this effort).

**Content model:** new seeded table `exercise_guides` (same seed/review pattern as `program_templates`):

```
exercise_guides (
  exercise_id     → exercises.id (unique),
  setup_callout   text,          -- the "Set up" paragraph
  setup_facts     jsonb,         -- structured: { bench_angle_deg: 30, ... } for annotation tags
  cues            text[],        -- exactly 3
  donts           text[],        -- exactly 2
  media           jsonb          -- { start: "/exercise-media/<slug>-start.webp", end: ... }
)
```

Served on `GET /api/exercises/:slug/guide` (404 when no guide exists — the UI hides ⓘ). All 44 exercises get authored content, written by Claude, reviewed by the user like any PR.

### 5. Imagery pipeline

- **Generation:** batch script (repo `scripts/`, run manually, NOT in CI) calls the Gemini image API with the key from the project-root `.env` (`GEMINI_API_KEY`, git-ignored). One shared style block ensures consistency (same athlete, same gym, same lighting); per-exercise prompt describes position. Two frames per exercise: start + end position.
- **Review loop:** generated images land in a staging folder; user reviews; misses get regenerated with prompt tweaks.
- **Storage:** approved images committed to the repo as WebP (~200–400 KB each) under `frontend/public/exercise-media/`; served same-origin → works offline-ish and inside the CSP.
- **Annotations are never baked into images.** The app overlays angle tags/labels from `setup_facts` — crisp typography, no AI-garbled text (the user's Gemini reference image contains "3squenie" — this is the failure mode we're avoiding), and text stays in sync with guide edits.

## Phasing (three shippable waves)

1. **W1 — Logging shell:** hub + focus screens, set-table UI, prefill + last-time line, rest timer, history endpoint + sheet. No education content yet (ⓘ hidden or pointing at a minimal fallback).
2. **W2 — Education:** `exercise_guides` migration + seed content for all 44 exercises, setup card sheet behind ⓘ (photo slot shows a placeholder).
3. **W3 — Photos:** generation script, batch + review, commit approved images, wire into setup card with annotation overlay.

Each wave: TDD, full validate suites, PR through branch protection, deploy.

## Testing

- Component tests per screen (hub status states, focus-screen logging round-trip, prefill source, history sheet, setup card rendering, beginner-cue variants).
- Offline-queue regression: the existing `__offline__` Playwright specs must keep passing against the new shell (they drive the logger UI).
- API: history endpoint unit + integration (scoping: user A cannot read user B's history).
- e2e: logger smoke specs updated for hub → focus navigation (note `reference_e2e_ci_gaps` memory: mock `/api/me` + mobile viewport).

## Out of scope

- Exercise library browsing surface for guides (guides are reachable from the logger only, v1).
- Video embeds / external media.
- Long-form lesson content (FAQ, how-to steps) — the rejected Option B.
- Desktop-specific logger layout beyond responsive rendering of these components.

## Open items

- Gemini image model choice + exact prompt style block — settled empirically in W3's first batch.
- Whether `/api/exercises/:slug/history` also back-fills the desktop ProgramPage "last performance" display — nice-to-have, not required.
