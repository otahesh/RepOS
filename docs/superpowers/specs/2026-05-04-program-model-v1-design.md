# RepOS Sub-project #2 — Program Model v1 (design spec)

**Sub-project:** #2 of 8 (Workout Program build)
**Status:** Spec ready for implementation planning
**Date:** 2026-05-04
**Prior art:** Sub-project #1 Library v1 — `docs/superpowers/specs/2026-05-03-exercise-library-design.md`
**Downstream consumers:** #3 Live Logger (today's-workout feed), #4 Volume Heatmap (volume rollup feed)

This spec was synthesized from a 5-specialist parallel review (exercise physiology, sports medicine, backend architect, frontend/UX architect, QA), then critically re-reviewed by the backend specialist on the integrated design. All taste decisions are recorded with their rationale in §2.

---

## 1. Goals

The v1 Program model turns a curated template into a real, day-by-day plan a user is currently running, and exposes that plan as structured data to downstream sub-projects.

### Explicitly in scope

- Curated catalog of **3 templates**: `full-body-3-day`, `upper-lower-4-day`, `strength-cardio-3+2`
- Templates **+** customize at fork-time and inline on the program page (swap exercise, add/remove sets, change RIR target this week, shift weekday, skip a day, rename the program)
- **Hybrid auto-progression**: RP-style volume ramp materialized into `planned_sets` rows at mesocycle-run start; per-day override allowed without disrupting subsequent weeks' baseline
- **One active `mesocycle_run` per user**, globally, enforced by partial unique index
- `GET /api/mesocycles/today` — the hot path for sub-project #3 Live Logger
- `GET /api/mesocycles/:id/volume-rollup` — the feed for sub-project #4 Heatmap
- **Cardio first-class**: separate `planned_cardio_blocks` table; modality + duration/distance + HR/RPE zone targets
- **Term-of-art tooltip** component + dictionary applied across every term-of-art surface (Library v1 backfill included)
- **Adherence / recovery flags** as advisory toasts (overreaching, bodyweight crash via `health_weight_samples`, stalled-PR)
- **Stub schema** for v2 contraindication filtering (`users.injury_flags`, `exercises.contraindications`)
- **`set_logs` and `mesocycle_run_events` tables** created as prereqs for #3 and for forensic auditing
- **Seed runner refactor** to adapter-driven generic, so `program_templates` reuses the same hash-keyed runner Library v1 introduced

### Explicitly out of scope (deferred)

| Concern | Where it goes |
|---|---|
| Set logging / RIR entry / rest timer | Sub-project #3 (Live Logger) — `set_logs` is created here as a prereq, written by #3 |
| Full muscle × week heatmap viz | Sub-project #4 (consumes volume rollup feed) |
| Stimulus reports (SF / JFR / Pump / Burn per Israetel) | v2 |
| RIR 0 (true failure) targets | v2 (capped at RIR 1 in v1 globally) |
| Multiple concurrent active mesocycles | v2 |
| Auto-upgrade of customized programs when template version bumps | v2 (re-fork from latest is the v1 answer) |
| Backend-served glossary dictionary | v1.1 (frontend constant in v1) |
| Per-injury contraindication filtering UI/logic | v2 (stub schema lands now) |
| Manual mid-meso deload trigger | v1.5 |
| Pure cardio programs (5K plan, marathon plan) | Sub-project #7 |
| User-authored programs (blank-slate) | v3 |
| Ad-hoc workouts (no program picked) | Out of scope: user must pick a program before app is functional |
| Mobile-side authoring tools | Out of scope: authoring is desktop-only per device-split principle |
| Warmup / cooldown / mobility module | v2 (compound warmup hint is in v1; no per-exercise mobility) |

---

## 2. Decisions log

Every decision below was reached during the brainstorm / specialist review, with a stated rationale. The "ship clean" principle applies — these are not v1.5 backlog items, they are the v1 contract.

| # | Question | Resolution | Rationale |
|---|---|---|---|
| Q1 | How does a user get a program in v1? | **Templates + customize** (fork, swap, add/remove sets, shift days) | Smallest scope that proves the model + matches RepOS's opinionated voice. Blank-slate authoring is v3. |
| Q2 | How does the program progress across the mesocycle? | **Hybrid**: auto RP-style volume ramp + per-session override | Auto ramp makes RepOS feel "smart"; override is the escape hatch real users need (missed days, beat-up, PR-push). |
| Q3 | Mesocycle default length | **5 weeks (4 accumulation + 1 deload)**, template-defined override | RP-classic; matches both physiology and sports-med. Templates can override to 4w. |
| Q4 | RIR 0 ceiling | **Hard cap at RIR 1 globally in v1** | Sports-med safer answer for alpha. Relax to "isolation last week" in v2 once we see real adherence data. |
| Q5 | Deload cadence | **Every 5th week, fixed in template structure** | Matches mesocycle default. Manual mid-meso deload trigger deferred to v1.5. |
| Q6 | Active mesocycles per user | **One active `mesocycle_run` per user globally** | Smaller mental model; simpler today-query; matches "today's workout" as singular. Concurrent strength + 5K-train deferred to v2. |
| Q7 | Customize-then-template-upgrade | **Take-it-when-you-fork.** No auto-upgrade of active runs | Re-forking from latest is explicit; ships clean. |
| Q8 | Customize granularity | **Per-day operations** (swap, add/remove sets, change RIR target this week, shift weekday, skip day, rename); per-set numerical override is a separate row update | Matches user's mental model of programs (days), not data model |
| Q9 | Override expiry | **Strictly today's session.** Past planned-set rows are read-only history | Don't retroactively edit yesterday |
| Q10 | Stimulus reports (SF/JFR/Pump/Burn) | **Defer to v2** | Both physiology and sports-med agree — needs onboarding to be meaningful |
| Q11 | Warmup sets | **Yes for compounds (auto 2-3 sets at 40 / 60 / 80 % working load), display-only** | No cooldown, no mobility module — those are own sub-projects |
| Q12 | Glossary location | **Frontend `lib/terms.ts` constant in v1** | Smaller change, no migration. Backend route is a v1.1 follow-up |
| Q13 | Cardio in volume budget | **Track interference, don't subtract.** Z2 ≤ 30 min same-day-as-heavy-lower allowed; intervals ≥4h gap or different day; volume rollup emits `minutes_by_modality`, not strength sets | Strict subtraction punishes runners; interference-flag is the pragmatic middle |
| Q14 | Auto-ramp materialization | **Materialize at run-start** (write all ~400 `planned_sets` rows when user clicks "Start") | Trivial reads for #3 and #4, stable IDs for logging, simpler service code, ~200 KB/user is rounding error. Override-sticks-to-day killed compute-on-read's main appeal. |
| Q15 | Cardio storage | **Separate `planned_cardio_blocks` table** (not CHECK-gated columns on `planned_sets`) | Cardio's dimension is minutes/week not sets/week; CHECK gating bleeds into every read query. BE re-review delta. |
| Q16 | `user_programs.structure` post-fork | **Drop it.** Relational rows are the source of truth post-fork. Add `customizations JSONB` for non-relational user-level (rename, week-trim) | Removes two-source-of-truth bug surface. BE re-review delta. |
| Q17 | Exercise FK delete behavior | **`ON DELETE RESTRICT`** on `planned_sets.exercise_id` and `planned_cardio_blocks.exercise_id` | Forces soft-delete pattern on `exercises`; deleting a curated exercise mid-mesocycle won't silently nuke history. BE re-review delta. |
| Q18 | TZ correctness for travelers | **Add `mesocycle_runs.start_tz TEXT NOT NULL`** + document "your program follows the timezone you started in"; offer a future "shift schedule" action | Small now, saves a migration on populated user table later. BE re-review delta. |
| Q19 | Set-execution storage | **`set_logs` table created as prereq for #3** (separate from `planned_sets` prescription) | Mutating `planned_sets` in place during workout execution would silently corrupt the auto-ramp baseline + #4's volume rollup. Hard prereq. BE re-review delta. |
| Q20 | Audit log | **`mesocycle_run_events` table** (append-only, started/paused/resumed/day_overridden/completed/abandoned) | Cheap forensics for support. BE re-review delta. |
| Q21 | Curated programs lineup | **`full-body-3-day` + `upper-lower-4-day` + `strength-cardio-3+2`** (3 of 5 candidates) | Beginner / classic-hypertrophy / hybrid-cardio coverage. Opinionated rather than buffet-like. PPL variants deferred to v1.5 once we see what users actually pick. |
| Q22 | Empty state behavior | **Catalog-only until program picked.** No ad-hoc workout logging in v1 | "RepOS is a programmed-training app" — fights the positioning otherwise |
| Q23 | Tooltip density | **Full dotted underlines on desktop / management surfaces; muted (info-icon-only on tap) on mobile live-workout screen** | Don't pollute mid-set screen with visual noise |
| Q24 | End-of-mesocycle | **Recap + 3-choice screen** (deload recommended, run-it-back-adjusted, pick-new-program). Deload visually defaulted but never forced | Lifters need agency at this transition |

---

## 3. Architecture

### 3.1 Device split

Per project memory `project_device_split.md`, every UI surface is classified:

| Surface | Device | Notes |
|---|---|---|
| Browse curated catalog | Desktop primary, Mobile read-only | Equipment-fit chip per program |
| Fork wizard with customize | **Desktop only** | Drag-to-reorder days; click-to-swap via `<ExercisePicker>` |
| Program page (week schedule + mini-heatmap + PR feed) | Desktop | Mirrors `desktop-dashboard.jsx` pattern |
| Inline customize on program page | **Desktop only** | Same components as the fork wizard |
| Today peek (mid-week glance) | Desktop dashboard | No logging here |
| **Today's workout view** + START WORKOUT CTA | **Mobile primary** | Hands off to sub-project #3 |
| Mid-session "swap exercise" | Mobile | Compact `<ExercisePicker>` in a focused sheet |
| Mesocycle progression view (5 × 6 mini-heatmap) | Desktop | Full version is sub-project #4 |
| End-of-mesocycle recap + decision | Desktop | Analytical recap |
| Settings → Programs (list, archive, fork-from-latest) | Desktop | Pattern from existing settings pages |
| Term-of-art tooltips | Both | Hover desktop, tap mobile, same `<Term>` component |

### 3.2 Schema

Six new tables + two stub fields on existing tables. Migration numbering starts at `014`.

#### 3.2.1 Enums (migration `014_program_kind_enums.sql`)

```sql
CREATE TYPE day_workout_kind   AS ENUM ('strength','cardio','hybrid','rest');
CREATE TYPE program_status     AS ENUM ('draft','active','paused','completed','archived');
CREATE TYPE mesocycle_run_event_type AS ENUM (
  'started','paused','resumed','day_overridden','set_overridden',
  'day_skipped','customized','completed','abandoned'
);
```

(Cardio is split into its own table per Q15 — no `planned_set_kind` enum needed.)

#### 3.2.2 `program_templates` (migration `015_program_templates.sql`)

```sql
CREATE TABLE IF NOT EXISTS program_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9-]+$'),
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  weeks           SMALLINT NOT NULL CHECK (weeks BETWEEN 1 AND 16),
  days_per_week   SMALLINT NOT NULL CHECK (days_per_week BETWEEN 1 AND 7),
  -- canonical structure: { _v:1, days:[ { idx, kind, name, blocks:[ { exercise_slug, mev, mav, target_reps_low, target_reps_high, target_rir, rest_sec, cardio?:{...} } ] } ] }
  structure       JSONB NOT NULL,
  version         INT  NOT NULL DEFAULT 1,
  created_by      TEXT NOT NULL DEFAULT 'system' CHECK (created_by IN ('system','user')),
  seed_key        TEXT,
  seed_generation INT,
  archived_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_program_templates_seed_key
  ON program_templates(seed_key) WHERE seed_key IS NOT NULL;
```

#### 3.2.3 `user_programs` (migration `016_user_programs.sql`)

`structure` is **NOT** carried after fork; relational rows under `mesocycle_runs` are the source of truth. `customizations JSONB` carries user-level non-relational overrides (program name, week-trim).

```sql
CREATE TABLE IF NOT EXISTS user_programs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id     UUID REFERENCES program_templates(id),
  template_version INT,
  name            TEXT NOT NULL,
  customizations  JSONB NOT NULL DEFAULT '{}',
  status          program_status NOT NULL DEFAULT 'draft',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_programs_user
  ON user_programs(user_id) WHERE status <> 'archived';
```

#### 3.2.4 `mesocycle_runs` (migration `017_mesocycle_runs.sql`)

Partial unique index enforces one active run per user globally.

```sql
CREATE TABLE IF NOT EXISTS mesocycle_runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_program_id  UUID NOT NULL REFERENCES user_programs(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date       DATE NOT NULL,
  start_tz         TEXT NOT NULL,
  weeks            SMALLINT NOT NULL,
  current_week     SMALLINT NOT NULL DEFAULT 1,
  status           program_status NOT NULL DEFAULT 'active',
  finished_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_meso_one_active_per_user
  ON mesocycle_runs(user_id) WHERE status = 'active';
```

#### 3.2.5 `day_workouts` (migration `018_day_workouts.sql`)

```sql
CREATE TABLE IF NOT EXISTS day_workouts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mesocycle_run_id  UUID NOT NULL REFERENCES mesocycle_runs(id) ON DELETE CASCADE,
  week_idx          SMALLINT NOT NULL,
  day_idx           SMALLINT NOT NULL,        -- 0..days_per_week-1
  scheduled_date    DATE NOT NULL,            -- materialized at run-start in user's start_tz
  kind              day_workout_kind NOT NULL,
  name              TEXT NOT NULL,
  notes             TEXT,
  status            TEXT NOT NULL DEFAULT 'planned'
                    CHECK (status IN ('planned','in_progress','completed','skipped')),
  completed_at      TIMESTAMPTZ,
  UNIQUE (mesocycle_run_id, week_idx, day_idx)
);
CREATE INDEX IF NOT EXISTS idx_day_workouts_lookup
  ON day_workouts(mesocycle_run_id, scheduled_date);
```

#### 3.2.6 `planned_sets` (strength-only) — migration `019_planned_sets.sql`

```sql
CREATE TABLE IF NOT EXISTS planned_sets (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  day_workout_id              UUID NOT NULL REFERENCES day_workouts(id) ON DELETE CASCADE,
  block_idx                   SMALLINT NOT NULL,
  set_idx                     SMALLINT NOT NULL,
  exercise_id                 UUID NOT NULL REFERENCES exercises(id) ON DELETE RESTRICT,
  target_reps_low             SMALLINT NOT NULL,
  target_reps_high            SMALLINT NOT NULL,
  target_rir                  SMALLINT NOT NULL CHECK (target_rir >= 1),
  target_load_hint            TEXT,                     -- "RPE7" / "+2.5lb" / etc., service-rendered
  rest_sec                    SMALLINT NOT NULL,
  overridden_at               TIMESTAMPTZ,
  override_reason             TEXT,
  substituted_from_exercise_id UUID REFERENCES exercises(id) ON DELETE RESTRICT,
  UNIQUE (day_workout_id, block_idx, set_idx),
  CHECK (target_reps_low <= target_reps_high)
);
CREATE INDEX IF NOT EXISTS idx_planned_sets_day
  ON planned_sets(day_workout_id, block_idx, set_idx);
```

#### 3.2.7 `planned_cardio_blocks` — migration `020_planned_cardio_blocks.sql`

```sql
CREATE TABLE IF NOT EXISTS planned_cardio_blocks (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  day_workout_id      UUID NOT NULL REFERENCES day_workouts(id) ON DELETE CASCADE,
  block_idx           SMALLINT NOT NULL,
  exercise_id         UUID NOT NULL REFERENCES exercises(id) ON DELETE RESTRICT,
  target_duration_sec INT,
  target_distance_m   INT,
  target_zone         SMALLINT CHECK (target_zone BETWEEN 1 AND 5),
  overridden_at       TIMESTAMPTZ,
  override_reason     TEXT,
  UNIQUE (day_workout_id, block_idx),
  CHECK (target_duration_sec IS NOT NULL OR target_distance_m IS NOT NULL)
);
```

#### 3.2.8 `set_logs` (prereq for sub-project #3) — migration `021_set_logs.sql`

```sql
CREATE TABLE IF NOT EXISTS set_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  planned_set_id    UUID NOT NULL REFERENCES planned_sets(id) ON DELETE CASCADE,
  performed_reps    SMALLINT,
  performed_load_kg NUMERIC(6,2),
  performed_rir     SMALLINT,
  performed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes             TEXT
);
CREATE INDEX IF NOT EXISTS idx_set_logs_planned ON set_logs(planned_set_id);
```

Sub-project #2 creates the table; sub-project #3 writes to it. **#3's PR is gated on this table existing.**

#### 3.2.9 `mesocycle_run_events` — migration `022_mesocycle_run_events.sql`

```sql
CREATE TABLE IF NOT EXISTS mesocycle_run_events (
  id           BIGSERIAL PRIMARY KEY,
  run_id       UUID NOT NULL REFERENCES mesocycle_runs(id) ON DELETE CASCADE,
  event_type   mesocycle_run_event_type NOT NULL,
  payload      JSONB NOT NULL DEFAULT '{}',
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_meso_events_run ON mesocycle_run_events(run_id, occurred_at);
```

#### 3.2.10 Stub fields on existing tables — migration `023_v2_contraindication_stubs.sql`

```sql
ALTER TABLE users      ADD COLUMN IF NOT EXISTS injury_flags     JSONB    NOT NULL DEFAULT '{}';
ALTER TABLE exercises  ADD COLUMN IF NOT EXISTS contraindications TEXT[]  NOT NULL DEFAULT '{}';
```

Plus matching TypeScript anchor types so v2 widens rather than reinvents:

- `frontend/src/lib/types/injuryFlags.ts` → `export type InjuryFlags = Record<string, never>;` (empty in v1)
- `api/src/types/injuryFlags.ts` → mirror

### 3.3 Service layer — three primitives

#### `materializeMesocycle(user_program_id, start_date, start_tz)`

Called from `POST /api/programs/:id/start`. In a single SERIALIZABLE transaction:
1. Verify no active run for this user (rely on partial unique index; translate `23505` → 409).
2. Resolve `template_id` + `template_version` → load `template.structure`.
3. Apply `customizations` JSONB to derive the effective structure.
4. INSERT `mesocycle_run`.
5. For each `(week_idx, day_idx)`, compute `scheduled_date = start_date + (week_idx - 1) * 7 + day_idx` (in `start_tz`); INSERT `day_workout`.
6. For each block in each day, run the **auto-ramp formula** (§6.2) to compute `(target_reps_low/high, target_rir, sets_count)` for that week; bulk INSERT all `planned_sets` rows via `INSERT ... SELECT FROM unnest(...)` form. Cardio blocks bulk INSERT into `planned_cardio_blocks`.
7. Append `mesocycle_run_events` row with `event_type='started'`.

Expected ~400 `planned_sets` + ~10 `planned_cardio_blocks` + ~30 `day_workouts` rows for a 5-week × 4-day program. Single tx, ~30 ms warm.

#### `getTodayWorkout(user_id, today_local)`

Indexed equality lookup on `(mesocycle_run_id, scheduled_date)` joined to `exercises`. For each block whose `required_equipment` predicate fails against current `users.equipment_profile`, attaches a `suggested_substitution` from Library v1's existing `findSubstitutions(slug, profile)` ranker. **Read-only; does not auto-rewrite the plan** — substitution becomes plan-of-record only when user accepts via `POST /api/planned-sets/:id/substitute`.

```ts
// pseudocode
async function getTodayWorkout(userId: string): Promise<TodayWorkout> {
  const todayLocal = computeUserLocalDate(userId);   // uses mesocycle_runs.start_tz
  const day = await db.query(`SELECT ... FROM day_workouts ...`, [...]);
  if (!day) return { state: 'rest_or_no_run' };
  const sets = await db.query(`SELECT ... FROM planned_sets JOIN exercises ...`, [day.id]);
  const cardio = await db.query(`SELECT ... FROM planned_cardio_blocks JOIN exercises ...`, [day.id]);
  const profile = await loadEquipmentProfile(userId);
  return attachSubstitutionSuggestions({ day, sets, cardio }, profile);
}
```

#### `computeVolumeRollup(mesocycle_run_id)`

Returns sets-per-week per muscle via `planned_sets × exercise_muscle_contributions` (Library v1's join table) summed by `week_idx`, plus per-muscle MEV/MAV/MRV landmarks. Cardio emits `minutes_by_modality`, not strength sets.

### 3.4 API surface

All routes under `/api/programs/*`, `/api/user-programs/*`, `/api/mesocycles/*`, `/api/planned-sets/*`. Token scope new key: `program:write` (extends `device_tokens.scopes TEXT[]` enum-validator constant — verify `\d device_tokens` confirms `TEXT[]` not `ENUM` before assuming no migration).

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/program-templates` | public | `Cache-Control: public, max-age=300` |
| GET | `/api/program-templates/:slug` | public | full structure |
| POST | `/api/program-templates/:slug/fork` | bearer/cf | → `user_program` (status='draft') |
| GET | `/api/user-programs` | bearer/cf | list mine |
| GET | `/api/user-programs/:id` | bearer/cf | detail (effective structure resolved) |
| PATCH | `/api/user-programs/:id` | bearer/cf | swap exercise / add-remove sets / shift day / rename / skip day; mutates `customizations` |
| POST | `/api/user-programs/:id/start` | bearer/cf | materialize `mesocycle_run` (SERIALIZABLE tx) |
| GET | `/api/mesocycles/:id` | bearer/cf | run detail |
| GET | `/api/mesocycles/today` | bearer/cf | **#3 hot path** |
| PATCH | `/api/planned-sets/:id` | bearer/cf | per-day override; 409 if `scheduled_date < today_local` |
| POST | `/api/planned-sets/:id/substitute` | bearer/cf | accept substitution suggestion |
| POST | `/api/planned-sets/:id/log` | bearer/cf | hint hook for #3 — accepts logged set, marks complete (writes `set_logs` once #3 wires it) |
| GET | `/api/mesocycles/:id/volume-rollup` | bearer/cf | **#4 feed** |

All inputs validated with Zod schemas under `api/src/schemas/`.

### 3.5 Frontend integration points

- **Reused from Library v1**: `<ExercisePicker>`, `<SubstitutionRow>`, `getEquipmentProfile()`, `<Term>` (new — see §3.6) is also reused by retroactive Library v1 backfill.
- **New components**:
  - `<ProgramCatalog>` — desktop, lists curated templates (3 cards)
  - `<ProgramTemplateDetail>` — desktop, full structure preview before fork
  - `<ForkWizard>` — desktop, customize editor at fork-time (drag days, swap exercises, edit sets/reps/RIR/rest)
  - `<ProgramPage>` — desktop, week schedule + 5×6 mini-heatmap + PR feed + inline customize affordances
  - `<TodayCard>` — both devices, mid-week peek + START WORKOUT CTA
  - `<MesocycleRecap>` — desktop, end-of-mesocycle screen
  - `<TodayWorkoutMobile>` — mobile, single-column today view feeding sub-project #3
  - `<MidSessionSwapSheet>` — mobile, focused single-action `<ExercisePicker>` wrapper

### 3.6 Term-of-art tooltip component

```tsx
// frontend/src/components/Term.tsx
import { TERMS, type TermKey } from '../lib/terms';

export function Term({ k, children }: { k: TermKey; children?: ReactNode }) {
  // Radix Popover; underline + (?) handle; hover-after-200ms desktop, tap mobile.
  // role="tooltip" if no citation, role="dialog" aria-modal="false" if citation link.
  // aria-describedby points at panel.
  // Compact mode (no underline, info-icon tap-only) prop for live-workout screen.
}
```

```ts
// frontend/src/lib/terms.ts
export type TermDef = {
  short: string;        // 'RIR'
  full: string;         // 'Reps in Reserve'
  plain: string;        // plain-language definition
  whyMatters: string;   // why-it-matters sentence
  citation?: { label: string; url: string };
};
export type TermKey = 'RIR'|'RPE'|'MEV'|'MAV'|'MRV'|'mesocycle'|'deload'|'hypertrophy'
  |'AMRAP'|'Z2'|'Z4'|'Z5'|'peak_tension_length'|'push_horizontal'|'pull_horizontal'
  |'push_vertical'|'pull_vertical'|'hinge'|'squat'|'lunge'|'carry'|'rotation'|'anti_rotation'
  |'compound'|'isolation'|'accumulation'|'working_set';
export const TERMS: Record<TermKey, TermDef> = { /* ... */ };
```

**Coverage rule**: any term keyed in the `TERMS` dictionary, when it appears in JSX outside of `frontend/src/lib/terms.ts` and outside of a `<Term k="…">` wrapper, is a CI failure. Implementation: a Node script that imports `TERMS`, derives the regex of all keys + their `short`/`full` forms, and `grep`s the React tree. Wired into the same `npm run validate` step the seed validator already uses.

### 3.7 Seed runner refactor

`api/src/seed/runSeed.ts` becomes adapter-driven:

```ts
type SeedAdapter<T> = {
  validate: (entries: T[]) => z.SafeParseReturnType<T[], T[]>;
  upsertOne: (tx: PoolClient, entry: T, generation: number) => Promise<void>;
  archiveMissing: (tx: PoolClient, key: string, generation: number) => Promise<number>;
};

export async function runSeed<T>(opts: { key: string; entries: T[]; adapter: SeedAdapter<T> }) {
  // hash check via _seed_meta — preserved
  // generation bump — preserved
  // soft-archive scoped by seed_key — preserved
}
```

Library v1's exercise-specific logic moves into `adapters/exercises.ts`. New `adapters/programTemplates.ts` validates `ProgramTemplateSeed` (Zod schema mirroring `structure` JSON: refs `exercises.slug` → must exist; week_idx contiguous; MEV ≤ MAV ≤ MRV; cardio block must reference cardio-modality exercise; etc.).

---

## 4. Curated programs lineup (v1)

All three templates seeded via the refactored runner under `seed_key='program_templates'`.

### 4.1 `full-body-3-day` — Full Body 3-Day Foundation

- **Weeks**: 5 (4 accumulation + 1 deload)
- **Days/week**: 3 (Mon / Wed / Fri)
- **Session length**: ~50 min
- **Equipment minimum**: dumbbells + bench (works on home minimal)
- **Best for**: beginners, anyone with limited time
- **Shape**: each day rotates through one squat/hinge primary, one push primary, one pull primary, plus 1–2 isolation accessories. Volume per muscle/week starts at MEV; ramps modestly given the 3x/week frequency.

### 4.2 `upper-lower-4-day` — Upper/Lower 4-Day Hypertrophy

- **Weeks**: 5 (4 accumulation + 1 deload)
- **Days/week**: 4 (Mon Upper Heavy / Tue Lower Heavy / Thu Upper Volume / Fri Lower Volume; Wed/Sat optional Z2 walk)
- **Session length**: ~58–62 min
- **Equipment minimum**: garage gym (DBs + bench + bar/rack)
- **Best for**: intermediate hypertrophy; the canonical RP shape
- **Shape**: matches the existing `desktop-dashboard.jsx` mockup. Heavy days = lower rep range, higher RIR floor; Volume days = higher rep range, more sets per muscle.

### 4.3 `strength-cardio-3+2` — Strength + Z2 3 + 2

- **Weeks**: 5 (4 accumulation + 1 deload)
- **Days/week**: 5 (3 full-body strength + 2 Z2 cardio)
- **Session length**: strength ~50 min, cardio 30–45 min
- **Equipment minimum**: garage gym + any one cardio modality (treadmill, bike, rowing erg, or outdoor walking)
- **Best for**: runners/cyclists who lift, hybrid trainees
- **Shape**: lower-volume strength compared to `full-body-3-day`; cardio days carry HR Zone 2 targets and modality binding to user's equipment_profile.

---

## 5. Volume model

### 5.1 Landmarks (sets / week, defaults — user-editable in v2)

Sourced from RP `Scientific Principles of Hypertrophy Training` (Israetel 2021). 12-muscle taxonomy matching Library v1.

| Muscle (Library slug) | MV | MEV | MAV | MRV |
|---|---|---|---|---|
| chest                  | 8 | 10 | 14 | 22 |
| lats                   | 8 | 10 | 16 | 22 |
| upper_back             | 8 | 10 | 16 | 24 |
| front_delt             | 0 | 6  | 10 | 16 |
| side_delt              | 8 | 12 | 18 | 26 |
| rear_delt              | 6 | 10 | 16 | 24 |
| biceps                 | 5 | 8  | 14 | 20 |
| triceps                | 4 | 8  | 14 | 22 |
| quads                  | 6 | 8  | 14 | 20 |
| hamstrings             | 3 | 6  | 12 | 18 |
| glutes                 | 0 | 4  | 12 | 16 |
| calves                 | 6 | 10 | 14 | 22 |

(Abs/Core deferred — Library v1 has no abs taxonomy entry; v2 adds.)

### 5.2 Auto-ramp formula

For week `w` of an `N`-week mesocycle (deload = week N):

```
sets_in_week(w) = round( MEV + (MRV_target - MEV) × (w - 1) / max(N - 2, 1) )
where MRV_target = min(MRV - 2, MAV + 2)
sets_in_week(N) = round(MEV / 2)         // deload
```

- **Compound increment**: +1 set/muscle/week
- **Isolation increment**: +2 set/muscle/week

The formula is encoded in `materializeMesocycle` service code and writes concrete `planned_sets` rows. Templates carry `mev` + `mav` per block; `MRV` per muscle is referenced from the per-muscle landmark table (above) until v2 makes it user-editable.

### 5.3 RIR schedule

Capped at RIR 1 globally in v1 (Q4). Typical 5-week mesocycle:

| Week | Compound RIR | Isolation RIR |
|------|--------------|---------------|
| 1    | 3            | 2             |
| 2    | 2            | 1             |
| 3    | 1            | 1             |
| 4    | 1            | 1             |
| 5 (deload) | 4      | 4             |

For 4-week meso, drop week 1.

---

## 6. Cardio integration

`day_workouts.kind = 'cardio'` or `'hybrid'` for cardio-bearing days. `planned_cardio_blocks` carries:

| Field | Meaning |
|---|---|
| `exercise_id` | Bound to a Library v1 cardio modality (treadmill, stationary_bike, recumbent_bike, rowing_erg, outdoor_walking, outdoor_cycling) |
| `target_duration_sec` | OR target_distance_m (one or both) |
| `target_zone` | HR zone 1–5 (`Z1`–`Z5`) |

Volume rollup emits `minutes_by_modality`, not strength sets. Cardio does **not** subtract from strength MAV; instead, the recovery-flag service tracks interference (Q13).

---

## 7. Safety / recovery

### 7.1 Joint-stress aggregation

A weekly job (or on-write trigger from `materializeMesocycle`) computes `weekly_joint_load JSONB` per `mesocycle_run × week_idx`:

```json
{ "knee": {"sets": 18, "score": 32}, "hip": {...}, "lumbar": {...}, "shoulder": {...}, "elbow": {...} }
```

`score = Σ(working_sets × stress_level)` reading `exercises.joint_stress_profile`. Soft caps (warn-only):
- lumbar high-stress sets ≤ 16/wk
- knee high-stress ≤ 20/wk
- shoulder high-stress ≤ 14/wk
- ≥2 high-lumbar exercises in one session → warn

Service-layer function (no public endpoint in v1 — sub-project #4 will expose it). Customize editor calls the service directly to warn at edit time.

### 7.2 Adherence / recovery flags

Daily job evaluates and surfaces advisory toasts (dismissible, store dismissals to avoid nagging):

- **Overreaching**: ≥3 sessions in past 7d at RIR 0 on compounds AND weekly volume ≥ MAV → "Recovery debt accumulating — consider deload."
- **Bodyweight crash**: `health_weight_samples.trend_7d_lbs ≤ -2.0` AND program goal ≠ cut → "Weight dropping fast — under-fueling will stall progress."
- **Stalled PR**: 3 consecutive sessions same exercise, no load/rep increase, RIR=0 → "Plateau — deload or substitute."

### 7.3 Frequency limits

- Default 3–5 strength days/week
- Cap at 6 (warn at 5–6 if same primary pattern consecutive at RIR ≤ 2)
- 7 = block in editor
- Same primary `movement_pattern` consecutive days at RIR ≤ 2 → warn

### 7.4 Warmup sets

Compounds only. Auto-render 2–3 warmup sets at 40 / 60 / 80 % of working load, RIR 5 — display-only, **not** stored as `planned_sets`. Sub-project #3 may surface them as guidance during the live session.

### 7.5 Cardio scheduling rules

- Strength before cardio within a session (default order)
- Z2 ≤ 30 min same-day-as-heavy-lower → allow
- Intervals/HIIT ≥4h gap from heavy lower OR different day; warn if violated
- HIIT day-before heavy lower → warn

Editor enforces warnings at edit time, not save time (lets advanced users override).

---

## 8. Testing strategy

Acceptance: ~40 API test cases + ~10 service-layer tests + ~6 service-layer edge-case tests. Fixture set: 3 `program_templates` (the lineup above) + 1 minimal 1-day template for unit tests.

### 8.1 API acceptance highlights

- `GET /api/program-templates` → 200 returns 3 entries, `archived_at IS NULL`, includes both strength and cardio templates, `Cache-Control: public, max-age=300`
- `POST /api/program-templates/:slug/fork` → 201 `user_program` deep-copies template structure into `customizations` overlay; `template_id` + `template_version` recorded; status='draft'
- Two forks of same template → independent rows
- `POST /api/user-programs/:id/start` → 201 materializes ~400 `planned_sets` + ~10 `planned_cardio_blocks` + 25 `day_workouts`; returns mesocycle_run id
- Concurrent `POST /start` x50 hammer test → exactly one active mesocycle_run survives, all others 409
- `GET /api/mesocycles/today` → 200 today's day in user TZ; DST spring-forward day still resolves once; user travels TZ → still resolves to start_tz; rest day → 204
- `PATCH /api/planned-sets/:id` → 200 records override on that row; W+1 planned_sets unaffected; past-day → 409
- `GET /api/mesocycles/:id/volume-rollup` → uses Library v1 `exercise_muscle_contributions`; cardio emits `minutes_by_modality`
- Bearer revoked mid-mesocycle → next PATCH 401, no partial write
- User revokes equipment that template requires → today's-workout surfaces `substitution_required[]` referencing Library v1 ranker

### 8.2 Service-layer tests

- `computeRamp(MEV, MAV, MRV, week, N)` — boundary weeks; clamps at MRV-2; floors at MEV; deload week = round(MEV/2)
- `resolveTodayLocal(start_date, start_tz, today)` — DST forward + back, leap year (Feb 29 → Mar 1), TZ change mid-week
- `applyOverride(planned_set, override)` — week N affected only; week N+1 baseline preserved
- `volumeRollup(mesocycle_run_id)` — fractional muscle credits sum correctly; cardio emits minutes
- `materializeMesocycle` bulk INSERT path uses UNNEST form, single tx

### 8.3 Edge cases

- Empty template (zero days) → fork 400
- Template removed from seed mid-active-run → soft-archived; existing user_programs unaffected (FK not CASCADE for templates)
- User updates equipment_profile mid-mesocycle → today endpoint surfaces substitution_required without 500
- Customize-then-start race: `POST /start` against draft `user_program` while PATCH in flight → SERIALIZABLE serializes
- `mesocycle_runs.weeks=1` (smoke test for minimal template) → materializes correctly

### 8.4 Migration / seed tests

Mirror existing `tests/seed/runner.test.ts` patterns. Re-run identical seed → `applied=false`. Remove a template from seed → soft-archive; existing forks unaffected. Validator rejects: duplicate slug, unknown exercise slug ref, day_idx out of range, week_idx gap, MEV > MAV violation, cardio block referencing non-cardio exercise.

---

## 9. Implementation guardrails

1. **Fork transaction must be SERIALIZABLE** or use explicit row-lock on the user; partial unique index protects the invariant but won't clean up orphaned `user_programs`. Translate `23505` → 409. Hammer test required.
2. **Bulk INSERT must use UNNEST form** (`INSERT ... SELECT FROM unnest($1::uuid[], ...)`) for `planned_sets` materialization. Row-by-row loop is unacceptable.
3. **Verify `device_tokens.scopes` is `TEXT[]` not Postgres ENUM** before assuming the `program:write` scope needs no migration. Check `\d device_tokens` in PR description.
4. **`set_logs` is a hard prereq for sub-project #3** — #3's PR is gated on this table existing. Documented in #2's spec, not #3's.
5. **Materialize-at-start drift on travel**: instrument a metric for `now()::date - scheduled_date` skew; spikes >1 day mean a TZ crossing. "Shift schedule" action prepared but not shipped in v1.
6. **`<Term>` coverage CI check**: grep / ESLint rule fails build if a term-of-art keyword appears outside `<Term>` or `lib/terms.ts`. Backfill Library v1 surfaces as part of #2's frontend work.
7. **Library v1 backfill scope**: `peak_tension_length`, `push_horizontal`, `pull_horizontal`, `push_vertical`, `pull_vertical`, `hinge`, `squat`, `lunge`, `carry`, `rotation`, `anti_rotation` — all appear in `<ExercisePicker>` and need `<Term>` wrapping.

---

## 10. Top risks (consolidated from specialist reports)

| # | Risk | Specialist | Mitigation |
|---|---|---|---|
| 1 | RIR self-reporting drift (novices over-estimate by ~2 reps) | Physiology | Load hints framed as "suggestions" not "targets"; logger never blocks |
| 2 | Compound stacking destroys recovery | Physiology | Editor warns on consecutive same-pattern days at RIR ≤ 2 |
| 3 | Fractional muscle credit double-counting | Physiology | Cap incoming-set credit per muscle per session; volume rollup query uses fractional sums |
| 4 | Hidden cumulative joint load from same-day stacking | Sports med | Daily check ≥2 high-lumbar in one session → warn at edit time |
| 5 | Customize-vs-template-upgrade silent overwrite | QA | No auto-upgrade in v1; re-fork from latest is the only path |
| 6 | Override leakage into W+1 ramp baseline | QA | Override scoped to single `planned_set` row; W+1 stays at materialized baseline (test-covered) |
| 7 | Materialize tx leaving orphans on race | Backend | SERIALIZABLE tx; hammer test in CI |
| 8 | TZ drift on travel | Backend | `start_tz` fixed at run-start; "shift schedule" action prepared for v1.5 |
| 9 | Tooltip fatigue on dense screens | Frontend | First-occurrence-per-section underline rule; compact mode on live workout |
| 10 | `set_logs` missing when #3 starts | Backend | Hard prereq documented and gated |

---

## 11. Critical files / impl pointers

### New
- `api/src/db/migrations/014_program_kind_enums.sql` … `023_v2_contraindication_stubs.sql` (10 migrations)
- `api/src/seed/programTemplates.ts` (3 program_template entries)
- `api/src/seed/adapters/exercises.ts` (extracted from existing runSeed)
- `api/src/seed/adapters/programTemplates.ts`
- `api/src/schemas/programTemplate.ts` (Zod)
- `api/src/schemas/userProgramPatch.ts` (Zod)
- `api/src/services/materializeMesocycle.ts`
- `api/src/services/getTodayWorkout.ts`
- `api/src/services/volumeRollup.ts`
- `api/src/services/autoRamp.ts` (ramp formula)
- `api/src/services/recoveryFlags.ts`
- `api/src/routes/programs.ts`
- `api/src/routes/mesocycles.ts`
- `api/src/routes/plannedSets.ts`
- `api/tests/programs.test.ts`, `mesocycles.test.ts`, `plannedSets.test.ts`, `autoRamp.test.ts`, `volumeRollup.test.ts`, `seed/programTemplates.test.ts`
- `frontend/src/lib/api/programs.ts`, `mesocycles.ts`, `plannedSets.ts`
- `frontend/src/lib/terms.ts` (new)
- `frontend/src/components/Term.tsx`
- `frontend/src/components/programs/*` (ProgramCatalog, ForkWizard, ProgramPage, TodayCard, MesocycleRecap, TodayWorkoutMobile, MidSessionSwapSheet)
- `frontend/src/lib/types/injuryFlags.ts`, `api/src/types/injuryFlags.ts`

### Refactored (touched, not rewritten)
- `api/src/seed/runSeed.ts` — adapter-driven generic runner
- `api/src/seed/exercises.ts` — moved into `api/src/seed/adapters/exercises.ts`
- `api/src/auth/scopes.ts` — add `program:write`
- `frontend/src/components/library/ExercisePicker.tsx` — backfill `<Term>` wrapping for term-of-art labels
- `frontend/src/components/library/SubstitutionRow.tsx` — same backfill

---

## 12. Open follow-ups (out of v1)

| Priority | Item | Where |
|---|---|---|
| v1.1 | Backend-served glossary route + table (i18n + edit-without-redeploy) | Spec'd in this doc as a deferred decision |
| v1.5 | Manual mid-meso deload trigger | Tracked here |
| v1.5 | Curated PPL programs (3-day, 6-day) once we see what users actually pick | Tracked here |
| v1.5 | "Shift schedule" action for travelers | `mesocycle_runs.start_tz` already in place |
| v2 | RIR 0 ceiling for isolation final week | Tracked here |
| v2 | Stimulus reports (SF/JFR/Pump/Burn) with onboarding | Tracked here |
| v2 | User-editable per-muscle MEV/MAV/MRV | Tracked here |
| v2 | Per-injury contraindication filtering | Stub schema lands now |
| v2 | Multiple concurrent active mesocycles | Tracked here |
| v2 | Auto-upgrade of customized programs on template version bump | Tracked here |
| v3 | Blank-slate program authoring | Tracked here |
| #7 | Pure cardio programs (5K plan, marathon plan) | Tracked here |
| #4 | Full muscle × week volume heatmap viz | Volume rollup feed shipped here |

---

*End of design spec.*
