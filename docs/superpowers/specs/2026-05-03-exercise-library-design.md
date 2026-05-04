# RepOS · Exercise Library — Design Spec

**Sub-project:** #1 of 8 (Workout Program build)
**Status:** Spec ready for implementation planning
**Date:** 2026-05-03
**Author:** Jason Meyer + Claude (synthesized via 6-specialist review)

---

## 1. Scope

The Exercise Library is the data foundation for the workout side of RepOS. v1 ships:

- A read-only catalog of ~150–200 strength exercises, curated from Wger (CC-BY-SA bootstrap) + hand-corrected against Renaissance Periodization's *Scientific Principles of Hypertrophy Training* and recent (2023–2026) hypertrophy research
- A 12-muscle taxonomy that the heatmap (sub-project #4) renders as a 6-group rollup
- A relational `exercise_muscle_contributions` table holding fractional muscle credits (0.0–1.0) per RP literature
- A per-user `equipment_profile` JSONB with load-range / capability metadata
- A SQL-based substitution engine that ranks viable swaps by `(movement_pattern, primary_muscle, contribution overlap, equipment availability)`
- A first-run wizard with three preset equipment profiles (Home Minimal / Garage Gym / Commercial Gym)
- A grouped Equipment editor in Settings
- An exercise picker component (consumed by future #2 Program model)
- Substitution UX scaffolding (consumed by future #3 Live Logger)

### Explicitly out of scope (deferred to other sub-projects)

| Concern | Where it goes |
|---|---|
| Cardio modalities (walk, cycle, row, swim) | Sub-project #7 — first-class, equal weight to strength |
| Apple Health Workouts ingestion | Sub-project #7 |
| Programs, mesocycles, weekly plans | Sub-project #2 |
| Logging sets, RPE, rest timer | Sub-project #3 (Live Logger) |
| Volume aggregation, MV/MEV/MAV/MRV math | Sub-project #4 (consumes our `exercise_muscle_contributions`) |
| PR computation, est-1RM trends | Sub-project #5 |
| Today dashboard | Sub-project #6 |
| User-created exercises | v3 |
| Substitution learning / personalization (remembering swap picks) | v2 (uses #2's `program_exercises` join table) |
| Off-box Postgres backups | Hard prereq for declaring alpha-end; infra work outside this spec |
| Heatmap mockup update (currently 9 rows, schema is 12) | Cosmetic update in sub-project #4 |

---

## 2. Decisions log

Recorded so the *why* survives the conversation.

| # | Decision | Reasoning |
|---|---|---|
| Q1 | **Curated v1 catalog**, read-only. v3 goal: user-created exercises. | Smallest thing that unlocks the next 4 sub-projects. Forces canonical schema before user-created exercises must honor it. |
| Q2 | **Fractional muscle credits** (RP-style) — `exercise_muscle_contributions(exercise_id, muscle_id, contribution NUMERIC(3,2))` join table. | RP's MV/MEV/MAV/MRV framework is built on fractional volume. Single primary or binary secondary will produce a heatmap that disagrees with RP-aware users' expectations. |
| Q3 | **Equipment-aware substitution engine.** No hand-curated default sub lists. Subs computed from `(movement_pattern, primary_muscle, equipment availability)`. | Different users have different equipment; static sub lists ignore that. Each user gets the right subs for their gym. |
| Q4 | **Tags + load-range capability metadata** for equipment. JSONB on both sides (`users.equipment_profile`, `exercises.required_equipment`), with predicate AST evaluable in SQL. | Captures what the system needs (substitution match, "you've outgrown your DBs" prompts, working-weight suggestions) without forcing inventory-management UX. |
| Q5 | **One row per meaningfully different variant.** ~150–200 entries. | RP literature speaks in this vocabulary. Lifters mentally track variant PRs separately. v3 user-created exercises drop into the variant-row schema naturally. |
| Q6 | **v1 = strength only.** Cardio → sub-project #7 (first-class, not deprioritized). | Cardio's metric shape (distance/duration/HR-zone) doesn't share enough with strength's to justify a polymorphic table. Equipment profile already accommodates cardio gear. |
| Q7 | **Two-axis baseline difficulty + 2 expansion axes** (4 total): `skill_complexity (1–5)`, `loading_demand (1–5)`, `systemic_fatigue (1–5)`, `joint_stress_profile JSONB`. | Two-axis maps to RP's exercise-selection framework; systemic_fatigue is needed for sub-project #4's MRV math (RDL ≠ leg ext recovery cost); joint_stress_profile is needed for downstream age/injury filtering. |

### Schema additions from specialist review

The 6-specialist review surfaced 7 additional schema elements universally agreed to be cheap-now / expensive-later:

| Field | Source | Rationale |
|---|---|---|
| `peak_tension_length` enum | Phys | Pelland 2024 / Wolf 2023: long-length training is ~25% more hypertrophic. Bench-press triceps credit is misleading without knowing tension is at short length. |
| `eccentric_overload_capable` boolean | Phys | Distinct from tempo prescription; categorical capability of accentuated-eccentric / flywheel / slingshot exercises. |
| `contraindications TEXT[]` | Med | Populate during seed curation; act on it in v2 when injury tracking arrives. Migrating 200 rows later is non-trivial. |
| 6 screening BOOLEANs | Med | `requires_shoulder_flexion_overhead`, `loads_spine_in_flexion`, `loads_spine_axially`, `requires_hip_internal_rotation`, `requires_ankle_dorsiflexion`, `requires_wrist_extension_loaded` — enables every downstream injury/age/mobility filter without a schema fight later. |
| `seed_generation INT` + `archived_at TIMESTAMPTZ` | Eng | Catalog-as-code with safe deletion: removed entries soft-archive, never DELETE (preserves FK from future user history). |
| `_v` schema_version inside every JSONB column | Eng | v2 readers must distinguish "key wasn't set yet" from "user predates this key." |
| Catalog excludes high-risk lifts | Med | Drop from curated v1: behind-the-neck press (any), behind-the-neck pulldown, narrow-grip pronated upright row above sternum, kipping pullups, Jefferson curl under load, full-ROM good mornings >BW, sissy squat without assistance, dragon flag. v3 user-created can have them; the curated set will not. |

---

## 3. Architecture

```
Postgres
├── muscles                              (12 rows — enum-shaped lookup)
├── exercises                            (~150–200 rows, seeded from /api/src/seed/exercises.ts)
├── exercise_muscle_contributions        (~1500 rows, ~10 per exercise, fractional credits)
├── _seed_meta                           (1 row per seed key, content hash, generation)
└── users.equipment_profile              JSONB column (added via migration)

api/src/routes/exercises.ts              GET /api/exercises, /:slug, /:slug/substitutions
api/src/routes/equipment.ts              GET/PUT /api/equipment/profile, POST /api/equipment/profile/preset/:name
api/src/routes/muscles.ts                GET /api/muscles
api/src/services/substitutions.ts        SQL ranker + predicate AST → WHERE compiler
api/src/services/equipmentProfile.ts     normalizer, _v upgrader, preset templates

api/src/seed/exercises.ts                typed seed data + Zod schema
api/src/seed/runSeed.ts                  idempotent runner (hash-keyed, runs after migrate.ts)
api/src/seed/validate.ts                 CI-callable validator (slug regex, FK integrity, cycle detection, …)

api/src/db/migrations/00X_*.sql          new schema (one migration per file, additive)

frontend/src/components/onboarding/      first-run wizard (3 preset cards)
frontend/src/components/settings/        Equipment editor (grouped accordion, chip-add UX)
frontend/src/components/library/         Exercise picker (search, muscle filter, equipment toggle)
                                         Substitution row (reason chip + load delta)

scripts/wger-to-repos.ts                 one-time bootstrap: Wger CSV → typed TS seed file
LICENSES.md                              Wger CC-BY-SA attribution
```

---

## 4. Data Model

### 4.1 `muscles` (12 rows)

```sql
CREATE TABLE muscles (
  id            SERIAL PRIMARY KEY,
  slug          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  group_name    TEXT NOT NULL,           -- heatmap rollup: 'chest','back','shoulders','arms','legs','core'
  display_order SMALLINT NOT NULL
);
```

**Initial 12 rows** (slug → group):

| slug | name | group |
|---|---|---|
| chest | Chest | chest |
| lats | Lats | back |
| upper_back | Upper Back / Mid-Traps / Rhomboids | back |
| front_delt | Front Deltoid | shoulders |
| side_delt | Side Deltoid | shoulders |
| rear_delt | Rear Deltoid | shoulders |
| biceps | Biceps + Brachialis | arms |
| triceps | Triceps | arms |
| quads | Quadriceps | legs |
| hamstrings | Hamstrings | legs |
| glutes | Glutes | legs |
| calves | Calves | legs |

(Core is reserved for future use — rectus / obliques / spinal erectors come in a v2 expansion when ab-direct work joins the catalog.)

### 4.2 `exercises` (~150–200 rows)

```sql
CREATE TYPE movement_pattern AS ENUM (
  'push_horizontal','push_vertical','pull_horizontal','pull_vertical',
  'squat','hinge','lunge','carry','rotation','anti_rotation','gait'
);
CREATE TYPE peak_tension_length AS ENUM ('short','mid','long','lengthened_partial_capable');

CREATE TABLE exercises (
  id                                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                                TEXT UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9-]+$'),
  name                                TEXT NOT NULL,
  parent_exercise_id                  UUID REFERENCES exercises(id) ON DELETE SET NULL,
  primary_muscle_id                   INT NOT NULL REFERENCES muscles(id),
  movement_pattern                    movement_pattern NOT NULL,
  peak_tension_length                 peak_tension_length NOT NULL,
  required_equipment                  JSONB NOT NULL DEFAULT '{"_v":1,"requires":[]}',
  skill_complexity                    SMALLINT NOT NULL CHECK (skill_complexity BETWEEN 1 AND 5),
  loading_demand                      SMALLINT NOT NULL CHECK (loading_demand BETWEEN 1 AND 5),
  systemic_fatigue                    SMALLINT NOT NULL CHECK (systemic_fatigue BETWEEN 1 AND 5),
  joint_stress_profile                JSONB NOT NULL DEFAULT '{"_v":1}',
  eccentric_overload_capable          BOOLEAN NOT NULL DEFAULT false,
  contraindications                   TEXT[]  NOT NULL DEFAULT '{}',
  requires_shoulder_flexion_overhead  BOOLEAN NOT NULL DEFAULT false,
  loads_spine_in_flexion              BOOLEAN NOT NULL DEFAULT false,
  loads_spine_axially                 BOOLEAN NOT NULL DEFAULT false,
  requires_hip_internal_rotation      BOOLEAN NOT NULL DEFAULT false,
  requires_ankle_dorsiflexion         BOOLEAN NOT NULL DEFAULT false,
  requires_wrist_extension_loaded     BOOLEAN NOT NULL DEFAULT false,
  created_by                          TEXT NOT NULL DEFAULT 'system' CHECK (created_by IN ('system','user')),
  seed_generation                     INT,
  archived_at                         TIMESTAMPTZ,
  created_at                          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (parent_exercise_id <> id)
);

CREATE INDEX idx_exercises_pattern        ON exercises(movement_pattern)        WHERE archived_at IS NULL;
CREATE INDEX idx_exercises_primary_muscle ON exercises(primary_muscle_id)       WHERE archived_at IS NULL;
CREATE INDEX idx_exercises_parent         ON exercises(parent_exercise_id)      WHERE parent_exercise_id IS NOT NULL;
```

**`joint_stress_profile` JSONB shape:**
```json
{ "_v": 1, "shoulder": "low|mod|high", "knee": "low|mod|high", "lumbar": "low|mod|high", "elbow": "low|mod|high", "wrist": "low|mod|high" }
```
Missing keys default to `"low"` on read. Used by sub-project #4 (cumulative load) and v2 injury-aware filters.

**`required_equipment` JSONB shape:**
```json
{ "_v": 1, "requires": [
  { "type": "dumbbells", "min_pair_lb": 10 },
  { "type": "adjustable_bench", "incline": true }
]}
```
All predicates AND-ed. See §5 for the predicate AST.

**`contraindications TEXT[]`** — populated at curation time. Example values: `shoulder_impingement`, `lumbar_flexion_intolerance`, `cervical_extension_loaded`, `wrist_extension_loaded`. Not acted on in v1 (no injury tracking yet). Fields exist so v2 doesn't need a 200-row backfill.

### 4.3 `exercise_muscle_contributions` (~1500 rows)

```sql
CREATE TABLE exercise_muscle_contributions (
  exercise_id  UUID NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  muscle_id    INT  NOT NULL REFERENCES muscles(id),
  contribution NUMERIC(3,2) NOT NULL CHECK (contribution > 0 AND contribution <= 1.0),
  PRIMARY KEY (exercise_id, muscle_id)
);
CREATE INDEX idx_emc_muscle_contribution ON exercise_muscle_contributions(muscle_id, contribution DESC);
```

**Why a join table instead of `muscle_contributions JSONB`** *(Backend's [BLOCKER] call):*
- Sub-project #4 will constantly run `SUM(sets * contribution) GROUP BY muscle_id`
- Sub-project #4 will run `WHERE contribution >= 0.5` to find "meaningful contributors" — unindexable on JSONB
- FK integrity: dangling muscle_id refs in JSONB are caught only by the seed validator; FKs catch them at write time, free
- Cosine similarity (substitution overlap) becomes a clean self-join

Per-exercise contribution sums typically 1.0–3.5 (see §6 validation rule).

### 4.4 `users.equipment_profile`

```sql
ALTER TABLE users ADD COLUMN equipment_profile JSONB NOT NULL DEFAULT '{"_v":1}';
```

**Shape (v1):**
```json
{
  "_v": 1,
  "dumbbells":          { "min_lb": 10, "max_lb": 100, "increment_lb": 10 },
  "barbell":            false,
  "squat_rack":         false,
  "pullup_bar":         false,
  "dip_station":        false,
  "adjustable_bench":   { "incline": true, "decline": true },
  "flat_bench":         false,
  "cable_stack":        false,
  "machines":           { "leg_press": false, "lat_pulldown": false, "chest_press": false, "leg_extension": false, "leg_curl": false },
  "kettlebells":        false,
  "ez_bar":             false,
  "trap_bar":           false,
  "treadmill":          false,
  "stationary_bike":    false,
  "recumbent_bike":     { "resistance_levels": 12 },
  "rowing_erg":         false,
  "outdoor_walking":    { "loop_mi": 0.42 },
  "outdoor_cycling":    false
}
```

Missing keys are treated as "user does not own" (never as error). Adding new keys in v2 doesn't break v1 reads. PUT validates against a registry; unknown keys → 400.

### 4.5 `_seed_meta`

```sql
CREATE TABLE _seed_meta (
  key        TEXT PRIMARY KEY,            -- 'exercises'
  hash       TEXT NOT NULL,               -- sha256 of seed file content
  generation INT  NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 4.6 Canonical Test User 1 fixture

The design uses this real user's equipment as the canonical test fixture (drives `substitutions/` test cases):

- Walking track, 0.42 mi loop
- Dumbbells, 10–100 lb, 10-lb increments
- Adjustable bench, incline + decline
- Schwinn recumbent bike, 12 resistance levels
- **No** barbell, rack, machines, kettlebells, pullup bar, etc.

This profile must produce a non-empty, sensible substitution list for at least one `Barbell Bench Press` query (expected: `DB Bench Press`, `Incline DB Bench Press`, possibly machine-dependent fallbacks excluded).

---

## 5. Substitution Engine

### 5.1 Algorithm

Pure SQL, deterministic, single round-trip:

```sql
WITH target AS (
  SELECT id, movement_pattern, primary_muscle_id
  FROM exercises WHERE slug = $1 AND archived_at IS NULL
),
target_contribs AS (
  SELECT muscle_id, contribution
  FROM exercise_muscle_contributions
  WHERE exercise_id = (SELECT id FROM target)
),
candidates AS (
  SELECT e.*,
    (e.movement_pattern = (SELECT movement_pattern FROM target))::int * 1000      AS pattern_score,
    (e.primary_muscle_id = (SELECT primary_muscle_id FROM target))::int * 500     AS primary_score,
    COALESCE((
      SELECT SUM(LEAST(t.contribution, c.contribution)) * 100
      FROM target_contribs t
      JOIN exercise_muscle_contributions c
        ON c.exercise_id = e.id AND c.muscle_id = t.muscle_id
    ), 0) AS overlap_score
  FROM exercises e
  WHERE e.id <> (SELECT id FROM target)
    AND e.archived_at IS NULL
    AND <equipment_clause>          -- compiled per-request from $user_profile + e.required_equipment; see §5.2
)
SELECT *,
       (pattern_score + primary_score + overlap_score) AS total_score
FROM candidates
WHERE pattern_score + primary_score + overlap_score >= 100   -- score floor: must at least share primary muscle
ORDER BY total_score DESC, slug ASC                          -- deterministic tiebreak
LIMIT 25;
```

### 5.2 Predicate AST → SQL compilation

The `<equipment_clause>` placeholder in §5.1 is a SQL fragment built per-request in TypeScript. The user's profile (loaded into a JSONB query parameter) and the candidate exercise's `required_equipment.requires[]` (read from the row) are evaluated together: an exercise passes only if every predicate in its `requires[]` is satisfied by the user's profile. Each predicate type has a fixed SQL template:

| Predicate | Compiles to |
|---|---|
| `{type:"dumbbells", min_pair_lb: N}` | `(equipment_profile->'dumbbells'->>'max_lb')::int >= N AND (equipment_profile->'dumbbells'->>'min_lb')::int <= N` |
| `{type:"adjustable_bench", incline: true}` | `equipment_profile->'adjustable_bench'->>'incline' = 'true'` |
| `{type:"barbell"}` | `equipment_profile->>'barbell' = 'true'` OR object form |
| `{type:"machine", name:"X"}` | `equipment_profile->'machines'->>'X' = 'true'` |
| `{type:"recumbent_bike"}` | `(equipment_profile->'recumbent_bike') IS NOT NULL AND equipment_profile->'recumbent_bike' <> 'false'::jsonb` |

**No JS lambdas in the engine** (Engineering's call). Every predicate must be expressible as SQL; this is the v3-scaling insurance — at 10k user-created exercises the planner pushes filtering into the JSONB indexes, no rewrite.

### 5.3 Result envelopes

```json
// happy path
{
  "from": { "slug": "barbell-bench-press", "name": "Barbell Bench Press" },
  "subs": [
    { "slug": "dumbbell-bench-press", "name": "Dumbbell Bench Press", "score": 1620, "reason": "Same pattern · DB available", "load_delta_lb": -45 },
    ...
  ],
  "truncated": false
}

// empty equipment_profile
{ "from": {...}, "subs": [], "reason": "no_equipment_profile" }

// no equipment match (catalog has options but user owns none)
{ "from": {...}, "subs": [], "reason": "no_equipment_match",
  "closest_partial": { "slug": "machine-chest-press", "name": "Machine Chest Press" } }

// truncated
{ "from": {...}, "subs": [...top 25], "truncated": true, "total_matches": 47 }
```

### 5.4 Race semantics

Substitution lists are computed at request time. If a user PUTs a new `equipment_profile` mid-workout, the next call returns subs computed against the new profile. This is observable behavior; spec'd in test case 17.

---

## 6. Read APIs

| Method | Path | Purpose | Cache |
|---|---|---|---|
| GET | `/api/muscles` | Lookup table | `public, max-age=86400` |
| GET | `/api/exercises?include=muscles` | Full catalog | `public, max-age=300, swr=86400`; ETag = `MAX(updated_at)` over non-archived rows |
| GET | `/api/exercises/:slug` | Single exercise w/ contributions | same |
| GET | `/api/exercises/:slug/substitutions` | Per-user filtered, ranked | `private, max-age=60`, `Vary: Authorization` |
| GET | `/api/equipment/profile` | Current user | `no-store` |
| PUT | `/api/equipment/profile` | Replace profile (Zod-validated, `_v` upgraded) | — |
| POST | `/api/equipment/profile/preset/:name` | Apply preset (`home_minimal` / `garage_gym` / `commercial_gym`) | — |

**Validation:** Zod schemas live in `api/src/schemas/`. New routes use Zod throughout. Existing `weight.ts` hand-rolled validators stay as-is; backport noted as nice-to-have, not gating.

**Error responses:** match existing project error style (`{error: string, field?: string}`, see `api/src/routes/weight.ts`).

---

## 7. Seed Catalog Process

### 7.1 Bootstrap

1. **Source:** Wger.de open exercise database, CC-BY-SA license, ~400 strength exercises with muscle mappings.
2. **Filter:** strength only, drop high-risk lifts (see §2 exclusion list), drop duplicates and obviously-wrong entries.
3. **Map:** one-time script `scripts/wger-to-repos.ts` reads Wger CSV → emits a typed TS file at `api/src/seed/exercises.ts`.
4. **Hand-correction:** ~12 hours of curation against RP's *Scientific Principles of Hypertrophy Training*:
   - `muscle_contributions` (the biggest delta — Wger's mappings are coarse)
   - `peak_tension_length`
   - `joint_stress_profile`
   - `contraindications`
   - 6 screening BOOLEANs
   - `skill_complexity`, `loading_demand`, `systemic_fatigue`
5. **Attribution:** Wger CC-BY-SA cited in `LICENSES.md` and the seed file header.

### 7.2 Storage format

`api/src/seed/exercises.ts`:

```ts
import { z } from "zod";
export const ExerciseSeedSchema = z.object({ /* ... */ });
export type ExerciseSeed = z.infer<typeof ExerciseSeedSchema>;

export const exercises: ExerciseSeed[] = [
  {
    slug: "barbell-bench-press",
    name: "Barbell Bench Press",
    primary_muscle: "chest",
    muscle_contributions: { chest: 1.0, triceps: 0.5, front_delt: 0.5 },
    movement_pattern: "push_horizontal",
    peak_tension_length: "mid",
    required_equipment: { _v: 1, requires: [
      { type: "barbell" }, { type: "flat_bench" }
    ]},
    skill_complexity: 3, loading_demand: 4, systemic_fatigue: 3,
    joint_stress_profile: { _v: 1, shoulder: "mod", elbow: "mod", wrist: "mod" },
    eccentric_overload_capable: false,
    contraindications: ["shoulder_impingement"],
    requires_wrist_extension_loaded: true,
    // ...other screening BOOLEANs default false
  },
  // ...~150–200 entries
];
```

### 7.3 Runner

`api/src/seed/runSeed.ts` runs after `migrate.ts` in the container's start sequence. Behavior:

1. SHA-256 hash the seed file content (deterministic since it's source-controlled TS).
2. Lookup `_seed_meta[key='exercises']`. If `hash` matches, log `seed_unchanged generation=N` and exit.
3. Otherwise: open a transaction, **upsert** every entry by `slug` (insert or update all columns), bump `seed_generation` to `prev + 1`, **soft-archive** any system row whose `slug` is no longer in the seed file (`UPDATE exercises SET archived_at = now() WHERE created_by = 'system' AND slug NOT IN (...) AND archived_at IS NULL` — user-created rows from v3 are never touched), update `_seed_meta`, commit.
4. Log `seed_applied generation=N upserts=X archived=Y duration=Zms`.

**Soft-archive, never DELETE.** Future user history will FK to `exercise_id`; deletion would orphan or cascade-delete that history.

**Catalog-as-code policy** (documented in CLAUDE.md): seed file is source of truth. Direct SQL edits to `exercises` are forbidden in production. CI runs a hash-check that fails if `_seed_meta.hash` (live) doesn't match `sha256(seed file in HEAD)`. Hot-fix workflow: edit seed → PR → deploy.

### 7.4 Validator (CI-callable)

`api/src/seed/validate.ts` — pure-TS validator runs in CI before the build:

- Zod schema on every entry
- `slug` regex + uniqueness
- No `parent_exercise_id` cycles (DFS)
- All `muscle_contributions` keys resolve to a `muscles.slug` in the §4.1 list
- All contribution values 0.05–1.0
- Per-exercise contribution sum 1.0–3.5 (warn outside, fail outside 0.8–4.0)
- All `required_equipment` predicate types appear in the equipment-taxonomy registry (`api/src/services/equipmentRegistry.ts` — single source of truth for legal keys)
- `primary_muscle` matches a `muscle_contributions` key with contribution = 1.0

Build fails on any violation. Output is structured (one error per violation) so it's easy to grep in CI logs.

---

## 8. Frontend Touchpoints

### 8.1 First-run wizard

**Trigger:** `equipment_profile` contains only `_v` and no equipment keys (i.e., the column default — user has not configured anything yet). Detected on Today-dashboard load.

**Layout:** modal over the Today dashboard, three preset cards in a row + "Skip & edit later" link below.

**Presets:**
- **Home Minimal:** outdoor_walking (0 mi loop default — user can edit later), bodyweight only (no equipment keys set true)
- **Home Garage Gym:** dumbbells (5–50 lb, 5-lb increments default), adjustable_bench (incline + decline), pullup_bar
- **Commercial Gym:** all common equipment set true with reasonable defaults

User taps a card → modal closes → editor opens pre-populated. "Skip & edit later" → editor opens empty + warning banner ("Set up your equipment to get personalized exercise recommendations").

### 8.2 Equipment editor (Settings → Equipment)

Grouped accordion:
- **Free Weights** — dumbbells, barbell, ez_bar, trap_bar, kettlebells
- **Benches & Racks** — adjustable_bench, flat_bench, squat_rack, pullup_bar, dip_station
- **Machines** — leg_press, lat_pulldown, chest_press, leg_extension, leg_curl, cable_stack
- **Cardio** — treadmill, stationary_bike, recumbent_bike, rowing_erg, outdoor_walking, outdoor_cycling
- **Bodyweight** — always-on (informational)

Chip-add UX: tap an item → expands inline with stepper inputs that hide the JSONB shape. Copy reads "Lightest pair / Heaviest pair / Jumps" not "min_lb / max_lb / increment_lb".

**Mobile = read-only** view in v1, with "Edit on desktop" CTA. Mobile editing parity = v2.

### 8.3 Exercise picker (component)

Used by future #2 Program model and the future v3 user-created flow. v1 ships the component; the live consumer arrives in #2.

- Text search (slug + name)
- Muscle filter (primary mover only — multi-select)
- "Available with my equipment" toggle (default ON; OFF shows the full catalog with non-available rows greyed)
- Source facet (Catalog / Mine) reserved in props but UI hidden in v1 (exposed in v3)
- Difficulty filters, recently-used, favorites = v1.5

### 8.4 Substitution UI (component)

Used by future #3 Live Logger.

- Top 3 by score, "See all" expands to top 25
- Each row: name (Inter Tight 14, t.text) + reason chip (`<Chip color={t.textDim} bg={t.surface2}>` — "Same pattern · DB available") + load delta vs planned (mono, t.warn if negative beyond a threshold)
- Empty state: "No equipment match — closest partial: X" with a single row showing the closest_partial result

Visual language: matches `mobile-live.jsx` density. Reuses `Chip`, `LoggedSetRow`-style row shape, `REPOS_TOKENS` color system, `REPOS_FONTS.mono` for numerics, `letterSpacing: 1.2` mono micro-labels.

---

## 9. Test Acceptance

22 cases, real Postgres, no mocks (project rule). Modeled on `api/tests/weight.test.ts`.

### 9.1 `seed/` (6)
1. Seed runs idempotently — second invocation produces zero row delta and matches `_seed_meta.hash`.
2. Every `muscle_contributions` key resolves to an existing `muscles.id`.
3. No `parent_exercise_id` is self-referential or cyclic; orphans rejected at validation.
4. All `slug` values unique and match `^[a-z0-9-]+$`.
5. Every `required_equipment` predicate `type` appears in the equipment-taxonomy registry.
6. Every exercise's `muscle_contributions` sum within 0.8–4.0; warn at 1.0–3.5 boundary.

### 9.2 `equipment_profile/` (5)
7. PUT with unknown equipment key → 400, `field=equipment`.
8. PUT with `max_lb < min_lb` → 400, `field=range`.
9. PUT with missing `_v` → upgraded to current version on write, GET returns `_v: <current>`.
10. GET after PUT returns exact normalized profile (deterministic key order).
11. v1-shaped profile reads cleanly after v2 taxonomy expansion (forward-compat fixture: simulate adding a new equipment key, ensure no read errors and missing key treated as "not owned").

### 9.3 `substitutions/` (7)
12. Empty `equipment_profile` → `{subs: [], reason: "no_equipment_profile"}`.
13. Exercise with zero viable subs (Test User 1 + an obscure exercise) → `{subs: [], reason: "no_equipment_match", closest_partial: ...}`.
14. Partial-predicate match (user has barbell but no rack, exercise requires both) → excluded, NOT shown with partial credit.
15. Ranking precedence: same `movement_pattern` beats same `primary_muscle` beats contribution overlap (verified by score deltas).
16. Deterministic tiebreak: two calls with identical inputs return identical ordering, `slug ASC` on ties.
17. Profile change between two calls → second call returns different sub set reflecting new profile.
18. Top-25 truncation: a target with >25 viable subs returns 25 + `truncated: true` + `total_matches`.

### 9.4 `read_apis/` (4)
19. GET `/api/exercises` returns full non-archived catalog with stable ordering (by slug).
20. GET `/api/exercises/:slug` 404 for unknown or archived slug.
21. GET `/api/exercises/:slug` includes resolved muscle slugs + names, not just IDs.
22. Perf budget: GET `/api/exercises` p95 <50ms warm at 200 rows; substitution endpoint p95 <100ms.

---

## 10. Open dependencies (called out)

These are real prereqs but live outside the Library spec:

1. **In-app DB recovery (*arr-style snapshots)** — off-box backups are already handled out-of-band by the Unraid host's own backup process; that requirement is satisfied. What's still missing is in-application snapshot/restore for DB corruption recovery, modeled after Sonarr/Radarr/Lidarr: periodic compressed `pg_dump` to `/mnt/user/appdata/repos/backups/` (which the host backup picks up automatically), retention policy (keep last N or X days), Settings UI to list snapshots, trigger a manual snapshot, and restore from any snapshot. Equipment profile is user-authored data; alpha-end declaration is gated on this recovery system shipping. Tracked as a separate small sub-project (~Sub-project #9 — "DB Recovery"), not a Library-spec deliverable.
2. **Heatmap mockup update** — the existing `desktop-dashboard.jsx` shows 9 rows; the schema has 12 muscles rendered as 6 group rollups. Sub-project #4 will reconcile this; not a Library-spec deliverable.
3. **Sub-project #2 (Program model)** — exercise picker has no live consumer until #2 ships. v1 of the Library can be built and tested standalone, but the UI is not exercised end-to-end without #2.

---

## 11. Future state

| Version | Capability | What enables it |
|---|---|---|
| v2 | Per-program / per-user substitution memory ("I always swap Bench for DB Bench in this program") | Sub-project #2's `program_exercises` join table; layer on top of the Library |
| v2 | Injury tracking + contraindication-aware filtering | Acts on existing `contraindications[]` and screening BOOLEANs; no Library schema change needed |
| v2 | Mobile equipment-editor parity | Frontend-only |
| v3 | User-created exercises | `exercises.created_by = 'user'` already supported; needs UI + dedup heuristics |
| v3 | Global equipment encyclopedia with images | Big lift; replaces the JSONB equipment-profile shape with a relational `equipment_items` table |
| v3 | Substitution-engine personalization (learned ranking) | Logs from §11 sampled output feed an offline reranker |

---

## 12. Specialist review record

Synthesized from 6 parallel agents (2026-05-03):
- **Exercise Physiology** — Approve with concerns. Drove `peak_tension_length`, `systemic_fatigue`, `eccentric_overload_capable`, expanded muscle taxonomy, Wger seed bootstrap.
- **Sports Medicine** — Approve with concerns. Drove `contraindications[]`, 6 screening BOOLEANs, `joint_stress_profile`, high-risk-lift exclusions.
- **Backend Dev** — Approve with concerns. Drove `exercise_muscle_contributions` join table (vs JSONB), separate seed runner (migrate.ts limitation), Zod for new code.
- **QA** — Approve with concerns. Drove the 22-case acceptance list, empty-profile defined response, predicate-registry single-source-of-truth, score floor + deterministic tiebreak + truncation cap.
- **UI/UX** — Approve with concerns. Drove first-run wizard with 3 presets, grouped equipment editor, ranked sub UX with reason chips, mobile-read-only equipment editing for v1.
- **Engineering / Systems** — Approve with concerns. Drove `seed_generation` + `archived_at` (soft-delete), `_v` schema_version on all JSONBs, SQL-translatable predicate AST (no JS lambdas), catalog-as-code CI hash check, off-box backup as alpha-end prereq.
