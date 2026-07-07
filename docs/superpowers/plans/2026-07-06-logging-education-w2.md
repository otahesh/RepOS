# Workout Logging Redesign — Wave 2: Education Content Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship exercise education — a seeded `exercise_guides` table with authored setup-card content for all 44 exercises, a `GET /api/exercises/:slug/guide` endpoint, and a ⓘ setup-card sheet on the focus screen (photo slot shows a placeholder until W3).

**Architecture:** Same seed/review pattern as `program_templates` (`runSeed` + adapter + `_seed_meta` hash-gating; content ships in the repo, reviewed like any PR, auto-applied by the container's s6 `init-seed` oneshot on deploy). Guide content is public/static, so the endpoint is unauthenticated with public caching like `GET /api/exercises/:slug`. The frontend container (`TodayLoggerMobile`) fetches the guide per focused exercise (non-blocking, cached per slug in state — same shape as W1's `histBySlug`), shows the ⓘ button only when a guide exists (404 → hidden, per spec), and opens a `SetupCardSheet` that mirrors `HistorySheet`'s focus-trap bottom-sheet pattern.

**Tech Stack:** Fastify 5 + TypeScript + pg (api), Zod seed validation, Vite + React 18 + vitest + Testing Library (frontend).

**Spec:** `docs/superpowers/specs/2026-07-06-workout-logging-redesign-design.md` §4 (setup card), §Phasing W2.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `api/src/db/migrations/080_exercise_guides.sql` | Create | `exercise_guides` table (additive — D10 migration gate) |
| `api/tests/exerciseGuides-schema.test.ts` | Create | DB constraint tests (cues=3, donts=2, unique exercise_id) |
| `api/src/schemas/exerciseGuide.ts` | Create | Zod seed schema + guide response type |
| `api/src/seed/adapters/exerciseGuides.ts` | Create | Seed adapter (validate / upsert by slug / archive stale) |
| `api/tests/seed/exerciseGuides.test.ts` | Create | Adapter + schema validation tests, seed round-trip (seed tests live under `tests/seed/`) |
| `api/src/seed/exerciseGuides.ts` | Create | 44 authored guide entries |
| `api/tests/seed/exerciseGuideContent.test.ts` | Create | Coverage test: every active seed exercise has a valid guide |
| `api/src/seed/seed-cli.ts` | Modify | Third `runSeed` call for guides |
| `api/src/routes/exercises.ts` | Modify | `GET /exercises/:slug/guide` |
| `api/tests/exerciseGuides.test.ts` | Create | Route tests (200 shape, 404s, cache headers) |
| `frontend/src/lib/api/exerciseGuide.ts` (+ `.test.ts`) | Create | `getExerciseGuide(slug)` client, 404 → null |
| `frontend/src/components/programs/logger/SetupCardSheet.tsx` (+ `.test.tsx`) | Create | The ⓘ bottom sheet (photo placeholder, Set up, Cues, Don't) |
| `frontend/src/components/programs/logger/ExerciseFocus.tsx` (+ test) | Modify | ⓘ button in header (renders only when `onOpenGuide` provided) |
| `frontend/src/components/programs/TodayLoggerMobile.tsx` (+ test) | Modify | Guide fetch/cache, ⓘ wiring, sheet mount |

**Not touched:** offline Playwright specs (`__offline__`) — ⓘ is additive; existing selectors unaffected. No e2e changes required (hub→focus nav specs don't interact with the header buttons).

---

### Task 1: `exercise_guides` migration

**Files:**
- Create: `api/src/db/migrations/080_exercise_guides.sql`
- Test: `api/tests/exerciseGuides-schema.test.ts`

- [ ] **Step 1: Write the failing schema test**

```typescript
// api/tests/exerciseGuides-schema.test.ts
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../src/db/client.js';

let exerciseId: string;

beforeAll(async () => {
  const {
    rows: [ex],
  } = await db.query<{ id: string }>(
    `INSERT INTO exercises (slug, name, primary_muscle_id, movement_pattern, peak_tension_length,
                            skill_complexity, loading_demand, systemic_fatigue)
     VALUES ('test-guide-schema-ex','x',
             (SELECT id FROM muscles WHERE slug='chest'),
             'push_horizontal','mid', 3, 3, 3)
     RETURNING id`,
  );
  exerciseId = ex.id;
});

afterAll(async () => {
  // Restore state: cascade removes any guide rows hung on the fixture exercise.
  await db.query(`DELETE FROM exercises WHERE id=$1`, [exerciseId]);
  await db.end();
});

const GOOD = {
  cues: ['a cue', 'b cue', 'c cue'],
  donts: ['a mistake', 'b mistake'],
};

// Callout must satisfy the migration's length CHECK (40–600 chars).
const CALLOUT = 'Bench: 30 degrees. Feet flat, slight arch, shoulder blades pinched together.';

function insertGuide(overrides: Partial<{ cues: string[]; donts: string[] }> = {}) {
  const g = { ...GOOD, ...overrides };
  return db.query(
    `INSERT INTO exercise_guides (exercise_id, setup_callout, setup_facts, cues, donts, media)
     VALUES ($1, $2, '{}'::jsonb, $3, $4, '{}'::jsonb)`,
    [exerciseId, CALLOUT, g.cues, g.donts],
  );
}

describe('exercise_guides schema (migration 080)', () => {
  it('accepts a well-formed guide and enforces one guide per exercise', async () => {
    await insertGuide();
    await expect(insertGuide()).rejects.toThrow(); // UNIQUE (exercise_id)
    await db.query(`DELETE FROM exercise_guides WHERE exercise_id=$1`, [exerciseId]);
  });

  it('rejects cues count other than 3', async () => {
    await expect(insertGuide({ cues: ['only', 'two'] })).rejects.toThrow();
    await expect(insertGuide({ cues: ['1', '2', '3', '4'] })).rejects.toThrow();
  });

  it('rejects donts count other than 2', async () => {
    await expect(insertGuide({ donts: ['just one'] })).rejects.toThrow();
  });

  it('cascades when the exercise is deleted', async () => {
    await insertGuide();
    await db.query(`DELETE FROM exercises WHERE id=$1`, [exerciseId]);
    const { rows } = await db.query(`SELECT 1 FROM exercise_guides WHERE exercise_id=$1`, [
      exerciseId,
    ]);
    expect(rows).toHaveLength(0);
    // Re-create the fixture exercise for any later test in this file (none today,
    // but afterAll's DELETE expects the row; recreate to keep teardown uniform).
    const {
      rows: [ex],
    } = await db.query<{ id: string }>(
      `INSERT INTO exercises (slug, name, primary_muscle_id, movement_pattern, peak_tension_length,
                              skill_complexity, loading_demand, systemic_fatigue)
       VALUES ('test-guide-schema-ex','x',
               (SELECT id FROM muscles WHERE slug='chest'),
               'push_horizontal','mid', 3, 3, 3)
       RETURNING id`,
    );
    exerciseId = ex.id;
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/exerciseGuides-schema.test.ts`
Expected: FAIL — `relation "exercise_guides" does not exist`

- [ ] **Step 3: Write the migration**

```sql
-- api/src/db/migrations/080_exercise_guides.sql
-- W2 of the logging redesign (spec 2026-07-06 §4): seeded setup-card content.
-- ADDITIVE only (D10 migration gate). Content rows arrive via the seed CLI
-- (same pattern as program_templates), not via this migration.
--
-- setup_facts: structured numbers for W3's app-rendered annotation tags
--   (e.g. {"bench_angle_deg": 30}); never baked into images.
-- media: {"start": "/exercise-media/<slug>-start.webp", "end": ...} — empty
--   until W3 commits approved photos.
CREATE TABLE IF NOT EXISTS exercise_guides (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exercise_id     UUID NOT NULL UNIQUE REFERENCES exercises(id) ON DELETE CASCADE,
  setup_callout   TEXT NOT NULL CHECK (length(setup_callout) BETWEEN 40 AND 600),
  setup_facts     JSONB NOT NULL DEFAULT '{}'::jsonb,
  cues            TEXT[] NOT NULL CHECK (cardinality(cues) = 3),
  donts           TEXT[] NOT NULL CHECK (cardinality(donts) = 2),
  media           JSONB NOT NULL DEFAULT '{}'::jsonb,
  seed_key        TEXT,
  seed_generation INT,
  archived_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- [ ] **Step 4: Run migrations, then the test**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm run migrate && npx vitest run tests/exerciseGuides-schema.test.ts`
Expected: migration `080_exercise_guides.sql` applied; 4 tests PASS

(If `npm run migrate` isn't the script name, check `api/package.json` — the migration runner is `src/db/migrate.ts`.)

- [ ] **Step 5: Commit**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && git add api/src/db/migrations/080_exercise_guides.sql api/tests/exerciseGuides-schema.test.ts && git commit -m "feat(api): exercise_guides table for W2 setup cards"
```

---

### Task 2: Seed schema + adapter

**Files:**
- Create: `api/src/schemas/exerciseGuide.ts`
- Create: `api/src/seed/adapters/exerciseGuides.ts`
- Test: `api/tests/seed/exerciseGuides.test.ts` (seed tests live under `tests/seed/` — match the existing `programTemplates.test.ts` siblings)

- [ ] **Step 1: Write the failing tests**

```typescript
// api/tests/seed/exerciseGuides.test.ts
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/db/client.js';
import { runSeed } from '../../src/seed/runSeed.js';
import { makeExerciseGuideAdapter } from '../../src/seed/adapters/exerciseGuides.js';
import type { ExerciseGuideSeed } from '../../src/schemas/exerciseGuide.js';

const SEED_KEY = 'vitest_exercise_guides';
let exerciseId: string;
const SLUG = 'test-guide-seed-ex';

const GUIDE: ExerciseGuideSeed = {
  exercise_slug: SLUG,
  setup_callout:
    'Bench: 30 degrees — usually the 2nd incline notch. Feet flat, slight arch, shoulder blades pinched.',
  setup_facts: { bench_angle_deg: 30 },
  cues: ['Pinch your shoulder blades', 'Lower to the outside of your chest', 'Press up and slightly in'],
  donts: ['Setting the bench too steep', 'Bouncing the weights off your chest'],
  media: {},
};

beforeAll(async () => {
  const {
    rows: [ex],
  } = await db.query<{ id: string }>(
    `INSERT INTO exercises (slug, name, primary_muscle_id, movement_pattern, peak_tension_length,
                            skill_complexity, loading_demand, systemic_fatigue)
     VALUES ($1,'x',(SELECT id FROM muscles WHERE slug='chest'),'push_horizontal','mid',3,3,3)
     RETURNING id`,
    [SLUG],
  );
  exerciseId = ex.id;
});

afterAll(async () => {
  // Restore state: guide rows cascade with the exercise; clear the seed-meta key.
  await db.query(`DELETE FROM exercises WHERE id=$1`, [exerciseId]);
  await db.query(`DELETE FROM _seed_meta WHERE key=$1`, [SEED_KEY]);
  await db.end();
});

describe('exercise guide seed adapter', () => {
  it('rejects a guide referencing an unknown exercise slug', async () => {
    const adapter = makeExerciseGuideAdapter(new Set([SLUG]));
    const result = adapter.validate([{ ...GUIDE, exercise_slug: 'no-such-exercise' }]);
    expect(result.success).toBe(false);
  });

  it('rejects wrong cue/dont counts at validation time', () => {
    const adapter = makeExerciseGuideAdapter(new Set([SLUG]));
    expect(adapter.validate([{ ...GUIDE, cues: GUIDE.cues.slice(0, 2) }]).success).toBe(false);
    expect(adapter.validate([{ ...GUIDE, donts: [...GUIDE.donts, 'a third'] }]).success).toBe(
      false,
    );
  });

  it('upserts, is idempotent on re-run, and archives dropped entries', async () => {
    // Seed under a vitest-scoped key: the adapter stamps rows with it, so the
    // archive sweep targets only this test's rows — never the CI-seeded 44.
    const adapter = makeExerciseGuideAdapter(new Set([SLUG]), SEED_KEY);
    const first = await runSeed({ key: SEED_KEY, entries: [GUIDE], adapter });
    expect(first.applied).toBe(true);

    const { rows: after } = await db.query(
      `SELECT setup_callout, cues, donts, archived_at FROM exercise_guides WHERE exercise_id=$1`,
      [exerciseId],
    );
    expect(after).toHaveLength(1);
    expect(after[0].cues).toHaveLength(3);
    expect(after[0].archived_at).toBeNull();

    // Same entries → hash-unchanged skip.
    const second = await runSeed({ key: SEED_KEY, entries: [GUIDE], adapter });
    expect(second.applied).toBe(false);

    // Changed content → re-applied, row updated in place (still one row).
    const edited = { ...GUIDE, setup_callout: GUIDE.setup_callout + ' Brace before every rep.' };
    const third = await runSeed({ key: SEED_KEY, entries: [edited], adapter });
    expect(third.applied).toBe(true);
    const { rows: updated } = await db.query(
      `SELECT setup_callout FROM exercise_guides WHERE exercise_id=$1 AND archived_at IS NULL`,
      [exerciseId],
    );
    expect(updated).toHaveLength(1);
    expect(updated[0].setup_callout).toContain('Brace before every rep.');

    // Entry removed from the seed → archived, not deleted.
    const fourth = await runSeed({ key: SEED_KEY, entries: [], adapter });
    expect(fourth.applied).toBe(true);
    const { rows: archived } = await db.query(
      `SELECT archived_at FROM exercise_guides WHERE exercise_id=$1`,
      [exerciseId],
    );
    expect(archived[0].archived_at).not.toBeNull();
  });
});
```

Note the empty-entries run: `runSeed` hashes `[]` — that differs from the prior hash, so it applies and `archiveMissing` sweeps. This matches `runSeed.ts` semantics (no special-casing needed).

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/seed/exerciseGuides.test.ts`
Expected: FAIL — cannot resolve `../../src/seed/adapters/exerciseGuides.js`

- [ ] **Step 3: Write the schema**

```typescript
// api/src/schemas/exerciseGuide.ts
import { z } from 'zod';

// Seed-authoring shape for exercise setup cards (W2 of the logging redesign).
// Content rules mirror the DB CHECKs in migration 080 so authoring errors
// fail at validate() time with a path, not as a constraint violation mid-tx.
export const ExerciseGuideSeedSchema = z.object({
  exercise_slug: z.string().regex(/^[a-z0-9-]+$/, 'lowercase-kebab'),
  // The "30-second answer": concrete equipment settings / angles / positions.
  setup_callout: z.string().min(40).max(600),
  // Structured numbers behind W3's app-rendered annotation tags
  // (e.g. { bench_angle_deg: 30 }). Never baked into images.
  setup_facts: z
    .record(z.string().regex(/^[a-z0-9_]+$/), z.union([z.number(), z.string()]))
    .default({}),
  cues: z.array(z.string().min(8).max(120)).length(3),
  donts: z.array(z.string().min(8).max(120)).length(2),
  // Populated in W3: { start: "/exercise-media/<slug>-start.webp", end: ... }
  media: z
    .object({ start: z.string().optional(), end: z.string().optional() })
    .default({}),
});

export type ExerciseGuideSeed = z.infer<typeof ExerciseGuideSeedSchema>;

// Response shape for GET /api/exercises/:slug/guide — mirrored manually in
// frontend/src/lib/api/exerciseGuide.ts (see api/src/schemas/README.md).
export type ExerciseGuideResponse = {
  slug: string;
  setup_callout: string;
  setup_facts: Record<string, number | string>;
  cues: string[];
  donts: string[];
  media: { start?: string; end?: string };
};
```

- [ ] **Step 4: Write the adapter**

```typescript
// api/src/seed/adapters/exerciseGuides.ts
import { z } from 'zod';
import { ExerciseGuideSeedSchema, type ExerciseGuideSeed } from '../../schemas/exerciseGuide.js';
import type { SeedAdapter } from '../runSeed.js';

// seedKey is parameterized (like makeExerciseSeedAdapter('exercises')) so tests
// can seed under a vitest-scoped key: upsertOne stamps rows with it and
// archiveMissing receives the same key from runSeed — a hardcoded literal here
// would desync the two under any non-production key, and pointing tests at the
// REAL key would archive the CI-seeded 44 guides mid-suite. Don't "simplify".
export function makeExerciseGuideAdapter(
  knownExerciseSlugs: Set<string>,
  seedKey = 'exercise_guides',
): SeedAdapter<ExerciseGuideSeed> {
  const ArraySchema = z.array(ExerciseGuideSeedSchema).superRefine((arr, ctx) => {
    const seen = new Set<string>();
    arr.forEach((g, i) => {
      if (seen.has(g.exercise_slug)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate exercise_slug: ${g.exercise_slug}`,
          path: [i, 'exercise_slug'],
        });
      }
      seen.add(g.exercise_slug);
      if (!knownExerciseSlugs.has(g.exercise_slug)) {
        ctx.addIssue({
          code: 'custom',
          message: `unknown exercise_slug: ${g.exercise_slug}`,
          path: [i, 'exercise_slug'],
        });
      }
    });
  });

  return {
    validate: (entries) => ArraySchema.safeParse(entries),

    upsertOne: async (tx, g, generation) => {
      const { rowCount } = await tx.query(
        `INSERT INTO exercise_guides (
           exercise_id, setup_callout, setup_facts, cues, donts, media,
           seed_key, seed_generation, archived_at, updated_at
         )
         SELECT e.id, $2, $3::jsonb, $4, $5, $6::jsonb, $7, $8, NULL, now()
         FROM exercises e WHERE e.slug=$1 AND e.archived_at IS NULL
         ON CONFLICT (exercise_id) DO UPDATE SET
           setup_callout=EXCLUDED.setup_callout,
           setup_facts=EXCLUDED.setup_facts,
           cues=EXCLUDED.cues,
           donts=EXCLUDED.donts,
           media=EXCLUDED.media,
           seed_key=EXCLUDED.seed_key,
           seed_generation=EXCLUDED.seed_generation,
           archived_at=NULL,
           updated_at=now()`,
        [
          g.exercise_slug,
          g.setup_callout,
          JSON.stringify(g.setup_facts),
          g.cues,
          g.donts,
          JSON.stringify(g.media),
          seedKey,
          generation,
        ],
      );
      // validate() already vetted the slug against the seed list; a zero-row
      // insert means the DB disagrees with the seed (archived/renamed row) —
      // fail the transaction loudly rather than silently skipping content.
      if (rowCount === 0) {
        throw new Error(`exercise_guides seed: no active exercise for slug ${g.exercise_slug}`);
      }
    },

    archiveMissing: async (tx, key, generation) => {
      const { rowCount } = await tx.query(
        `UPDATE exercise_guides SET archived_at=now(), updated_at=now()
         WHERE archived_at IS NULL AND seed_key=$1
           AND seed_generation IS NOT NULL AND seed_generation < $2`,
        [key, generation],
      );
      return rowCount ?? 0;
    },
  };
}
```

- [ ] **Step 5: Run the tests**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/seed/exerciseGuides.test.ts`
Expected: 3 tests PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && git add api/src/schemas/exerciseGuide.ts api/src/seed/adapters/exerciseGuides.ts api/tests/seed/exerciseGuides.test.ts && git commit -m "feat(api): exercise guide seed schema + adapter"
```

---

### Task 3: Author the 44 guides + wire the seed CLI

**Files:**
- Create: `api/src/seed/exerciseGuides.ts`
- Modify: `api/src/seed/seed-cli.ts`
- Test: `api/tests/seed/exerciseGuideContent.test.ts`

This task is mostly **content authoring**. The code scaffolding is small; the deliverable is 44 well-written entries the user reviews in the PR like prose.

- [ ] **Step 1: Write the failing coverage test**

```typescript
// api/tests/seed/exerciseGuideContent.test.ts
// Pure content test — no DB. Guards the "all 44 exercises get authored
// content" spec requirement and keeps future seed-exercise additions honest:
// adding an exercise without a guide fails here, not in production.
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { exercises } from '../../src/seed/exercises.js';
import { exerciseGuides } from '../../src/seed/exerciseGuides.js';
import { ExerciseGuideSeedSchema } from '../../src/schemas/exerciseGuide.js';

describe('exercise guide seed content', () => {
  it('every seed exercise has exactly one guide, and no guide is orphaned', () => {
    const exerciseSlugs = new Set(exercises.map((e) => e.slug));
    const guideSlugs = exerciseGuides.map((g) => g.exercise_slug);

    const missing = [...exerciseSlugs].filter((s) => !guideSlugs.includes(s));
    const orphaned = guideSlugs.filter((s) => !exerciseSlugs.has(s));
    const dupes = guideSlugs.filter((s, i) => guideSlugs.indexOf(s) !== i);

    expect(missing, `exercises without a guide: ${missing.join(', ')}`).toHaveLength(0);
    expect(orphaned, `guides without an exercise: ${orphaned.join(', ')}`).toHaveLength(0);
    expect(dupes, `duplicate guides: ${dupes.join(', ')}`).toHaveLength(0);
  });

  it('every guide validates against the seed schema', () => {
    const result = z.array(ExerciseGuideSeedSchema).safeParse(exerciseGuides);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      expect.fail(issues.join('\n'));
    }
  });

  it('media stays empty until W3 lands photos', () => {
    for (const g of exerciseGuides) {
      expect(g.media).toEqual({});
    }
  });

  it('content avoids unexplained jargon', () => {
    // Beginner surfaces never show raw RIR/MEV/MAV jargon (feedback memory:
    // terms-of-art need tooltips; seed prose can't carry tooltips, so plain
    // language only).
    const jargon = /\b(RIR|MEV|MAV|MRV|RPE)\b/;
    for (const g of exerciseGuides) {
      const all = [g.setup_callout, ...g.cues, ...g.donts].join(' ');
      expect(jargon.test(all), `${g.exercise_slug} uses raw jargon`).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/seed/exerciseGuideContent.test.ts`
Expected: FAIL — cannot resolve `../../src/seed/exerciseGuides.js`

- [ ] **Step 3: Author `api/src/seed/exerciseGuides.ts` — all 44 entries**

File skeleton and three complete entries below establish the format and voice. Author the remaining 41 to the same standard — this is the core W2 deliverable; the user reviews every word in the PR.

**Authoring rules (binding):**
- **Voice:** RepOS voice — short sentences, verbs first, plain language. No unexplained jargon (no "RIR", "MEV", "scapular retraction"; say "shoulder blades pinched"). The content test enforces the acronym subset mechanically; the reviewer enforces the rest.
- **`setup_callout`:** the 30-second answer. Concrete numbers first — bench angle, notch position, stance width, grip. 2–4 sentences, 40–600 chars. Style reference (from the spec): *"Bench: 30° — usually the 2nd incline notch. 15–30° hits upper chest; past 45° it becomes a shoulder press. Feet flat, slight arch, shoulder blades pinched."*
- **`setup_facts`:** only facts a W3 photo annotation could point at — angles, stance, grip width. Keys snake_case with units in the name (`bench_angle_deg`). `{}` when nothing is annotatable. Values must agree with the callout text.
- **`cues`:** exactly 3, imperative, one thought each ("Drive the floor apart as you stand up").
- **`donts`:** exactly 2, phrased as the mistake ("Bouncing the weights off your chest").
- **`media`:** `{}` for every entry (W3 fills these).
- **Cardio entries** (`outdoor-walking-z2`, `recumbent-bike-steady-state`) get guides too — cardio is first-class (feedback memory). Their "setup" is effort calibration and equipment setup.

```typescript
// api/src/seed/exerciseGuides.ts
// Setup-card content for every seed exercise (spec 2026-07-06 §4, W2).
// One entry per exercise in ./exercises.ts — coverage enforced by
// tests/exerciseGuideContent.test.ts. Authored prose, reviewed like any PR.
// media stays {} until W3 commits approved photos.
import type { ExerciseGuideSeed } from '../schemas/exerciseGuide.js';

export const exerciseGuides: ExerciseGuideSeed[] = [
  {
    exercise_slug: 'incline-dumbbell-bench-press',
    setup_callout:
      'Bench: 30° — usually the 2nd incline notch. 15–30° hits upper chest; past 45° it becomes a shoulder press. Feet flat, slight arch, shoulder blades pinched.',
    setup_facts: { bench_angle_deg: 30 },
    cues: [
      'Lower the dumbbells to the outside of your chest',
      'Keep your shoulder blades pinched the whole set',
      'Press up and slightly together at the top',
    ],
    donts: [
      'Setting the bench too steep — past 45° your shoulders take over',
      'Bouncing the weights out of the bottom position',
    ],
    media: {},
  },
  {
    exercise_slug: 'barbell-back-squat',
    setup_callout:
      'Bar sits on your upper traps, not your neck. Grip just outside your shoulders, elbows pointed down. Feet shoulder-width, toes out about 20°. Take a big breath and brace before every rep.',
    setup_facts: { toe_angle_deg: 20, stance: 'shoulder-width' },
    cues: [
      'Brace your core before each rep, not during it',
      'Sit down between your heels with your chest proud',
      'Drive the floor apart as you stand up',
    ],
    donts: [
      'Letting your knees cave inward on the way up',
      'Cutting depth short — aim for thighs at least parallel',
    ],
    media: {},
  },
  {
    exercise_slug: 'outdoor-walking-z2',
    setup_callout:
      'Zone 2 means a pace where you can talk in full sentences but singing would be hard. Pick a mostly flat route and comfortable shoes. If you are panting, slow down — easy is the point.',
    setup_facts: { effort: 'conversational pace' },
    cues: [
      'Hold a pace you could keep up for an hour',
      'Relax your shoulders and let your arms swing',
      'Check yourself: can you still speak in full sentences?',
    ],
    donts: [
      'Racing the clock — this session builds your base, not your ego',
      'Stopping and starting — keep continuous movement for the full time',
    ],
    media: {},
  },
  // … author the remaining 41 entries here, same format, covering every slug in
  // the checklist below. The coverage test fails until all are present.
];
```

**Slug checklist (44):** `ab-wheel-rollout`, `barbell-back-squat`, `barbell-bench-press`, `barbell-bent-over-row`, `barbell-overhead-press-standing`, `barbell-romanian-deadlift`, `cable-crunch`, `cable-face-pull`, `cable-pallof-press`, `cable-tricep-pressdown`, `cable-woodchop-high-to-low`, `chest-supported-dumbbell-row`, `conventional-deadlift`, `dead-bug`, `dumbbell-bench-press`, `dumbbell-bulgarian-split-squat`, `dumbbell-curl`, `dumbbell-farmers-carry`, `dumbbell-goblet-squat`, `dumbbell-hammer-curl`, `dumbbell-hip-thrust`, `dumbbell-lateral-raise`, `dumbbell-overhead-carry`, `dumbbell-rear-delt-raise`, `dumbbell-reverse-lunge`, `dumbbell-romanian-deadlift`, `dumbbell-rotational-chop`, `dumbbell-row-1arm`, `dumbbell-shoulder-press-seated`, `dumbbell-skull-crusher`, `dumbbell-standing-calf-raise`, `dumbbell-suitcase-carry`, `dumbbell-walking-lunge`, `hanging-leg-raise`, `incline-dumbbell-bench-press`, `lat-pulldown-machine`, `leg-curl-machine`, `leg-extension-machine`, `outdoor-walking-z2`, `pullup`, `recumbent-bike-steady-state`, `side-plank`, `slingshot-bench-press`, `suitcase-carry`

- [ ] **Step 4: Run the content test until green**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/seed/exerciseGuideContent.test.ts`
Expected: 4 tests PASS (44/44 coverage, schema-valid, empty media, no jargon)

- [ ] **Step 5: Wire the seed CLI**

In `api/src/seed/seed-cli.ts`, add after the `program_templates` run (imports at top with the others):

```typescript
import { exerciseGuides } from './exerciseGuides.js';
import { makeExerciseGuideAdapter } from './adapters/exerciseGuides.js';
```

```typescript
  const guideResult = await runSeed({
    key: 'exercise_guides',
    entries: exerciseGuides,
    adapter: makeExerciseGuideAdapter(knownSlugs),
  });
  console.log('exercise_guides:', JSON.stringify(guideResult));
```

(`knownSlugs` already exists in `main()` — reuse it.)

- [ ] **Step 6: Run the seed against the local DB and verify**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm run seed && psql postgres://repos:repos_dev_pw@127.0.0.1:5432/repos_test -c "SELECT count(*) FROM exercise_guides WHERE archived_at IS NULL"`
Expected: `exercise_guides: {"applied":true,"upserted":44,...}` then `count = 44`

(If `npm run seed` isn't the script name, check `api/package.json` for the `seed-cli` entry point.)

- [ ] **Step 7: Commit**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && git add api/src/seed/exerciseGuides.ts api/src/seed/seed-cli.ts api/tests/seed/exerciseGuideContent.test.ts && git commit -m "feat(api): authored setup-card content for all 44 exercises"
```

---

### Task 4: `GET /api/exercises/:slug/guide`

**Files:**
- Modify: `api/src/routes/exercises.ts` (add route after `/exercises/:slug`, before `/history`)
- Test: `api/tests/exerciseGuides.test.ts`

Guide content is static authored prose — not user data — so the route is unauthenticated with public caching, exactly like `GET /exercises/:slug`.

- [ ] **Step 1: Write the failing tests**

```typescript
// api/tests/exerciseGuides.test.ts
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/client.js';

type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;
let withGuideId: string, withoutGuideId: string, archivedGuideId: string;

async function mkEx(slug: string): Promise<string> {
  const {
    rows: [ex],
  } = await db.query<{ id: string }>(
    `INSERT INTO exercises (slug, name, primary_muscle_id, movement_pattern, peak_tension_length,
                            skill_complexity, loading_demand, systemic_fatigue)
     VALUES ($1,'x',(SELECT id FROM muscles WHERE slug='chest'),'push_horizontal','mid',3,3,3)
     RETURNING id`,
    [slug],
  );
  return ex.id;
}

beforeAll(async () => {
  app = await buildApp();
  withGuideId = await mkEx('test-guide-route-yes');
  withoutGuideId = await mkEx('test-guide-route-no');
  archivedGuideId = await mkEx('test-guide-route-archived');
  await db.query(
    `INSERT INTO exercise_guides (exercise_id, setup_callout, setup_facts, cues, donts, media, archived_at)
     VALUES ($1, 'Bench: 30 degrees. Feet flat, slight arch, shoulder blades pinched together.',
             '{"bench_angle_deg":30}'::jsonb,
             ARRAY['cue one here','cue two here','cue three here'],
             ARRAY['mistake one here','mistake two here'], '{}'::jsonb, NULL),
            ($2, 'Archived guide callout text long enough to satisfy the length check.',
             '{}'::jsonb,
             ARRAY['cue one here','cue two here','cue three here'],
             ARRAY['mistake one here','mistake two here'], '{}'::jsonb, now())`,
    [withGuideId, archivedGuideId],
  );
});

afterAll(async () => {
  // Restore state: guides cascade with their exercises.
  await db.query(`DELETE FROM exercises WHERE id = ANY($1::uuid[])`, [
    [withGuideId, withoutGuideId, archivedGuideId],
  ]);
  await app.close();
  await db.end();
});

describe('GET /api/exercises/:slug/guide', () => {
  it('returns the guide with public caching', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/exercises/test-guide-route-yes/guide' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('public');
    const body = res.json();
    expect(body).toEqual({
      slug: 'test-guide-route-yes',
      setup_callout: expect.stringContaining('Bench: 30 degrees'),
      setup_facts: { bench_angle_deg: 30 },
      cues: ['cue one here', 'cue two here', 'cue three here'],
      donts: ['mistake one here', 'mistake two here'],
      media: {},
    });
  });

  it('404s when the exercise has no guide', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/exercises/test-guide-route-no/guide' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'guide not found', field: 'slug' });
  });

  it('404s for an archived guide', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/exercises/test-guide-route-archived/guide',
    });
    expect(res.statusCode).toBe(404);
  });

  it('404s for an unknown exercise', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/exercises/no-such-slug/guide' });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/exerciseGuides.test.ts`
Expected: FAIL — 404 route-not-found on the happy-path test

- [ ] **Step 3: Implement the route**

Add to `api/src/routes/exercises.ts` (after the `/exercises/:slug` handler; import `ExerciseGuideResponse` from `../schemas/exerciseGuide.js` at the top):

```typescript
  // Setup-card content (W2 logging redesign). Static authored prose — public
  // cache like /exercises/:slug. 404 when no active guide: the UI hides ⓘ.
  app.get<{ Params: { slug: string } }>('/exercises/:slug/guide', async (req, reply) => {
    const { rows } = await db.query(
      `SELECT e.slug, g.setup_callout, g.setup_facts, g.cues, g.donts, g.media
       FROM exercise_guides g
       JOIN exercises e ON e.id = g.exercise_id
       WHERE e.slug=$1 AND e.archived_at IS NULL AND g.archived_at IS NULL`,
      [req.params.slug],
    );
    if (rows.length === 0) {
      reply.code(404);
      return { error: 'guide not found', field: 'slug' };
    }
    reply.header('cache-control', 'public, max-age=300, stale-while-revalidate=86400');
    return rows[0] as ExerciseGuideResponse;
  });
```

- [ ] **Step 4: Run the tests**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/exerciseGuides.test.ts`
Expected: 4 tests PASS

- [ ] **Step 5: API-wide verification + commit**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm test && npm run lint && npm run format:check`
Expected: all green (typecheck-api CI runs lint + prettier — see `reference_ci_api_gates_d10_migration` memory)

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && git add api/src/routes/exercises.ts api/tests/exerciseGuides.test.ts && git commit -m "feat(api): GET /api/exercises/:slug/guide"
```

---

### Task 5: Frontend guide client

**Files:**
- Create: `frontend/src/lib/api/exerciseGuide.ts`
- Test: `frontend/src/lib/api/exerciseGuide.test.ts`

- [ ] **Step 1: Write the failing tests**

Follow the repo's client-test convention: spy on `globalThis.fetch` (see `frontend/src/lib/api/exerciseHistory.test.ts` and `userLandmarks.test.ts` — `apiFetch` wraps `fetch`, and `Response` is available in the jsdom env). Match the exact setup those files use (auth-related mocks included, if any); the shape below shows the assertions:

```typescript
// frontend/src/lib/api/exerciseGuide.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getExerciseGuide } from './exerciseGuide';

const GUIDE = {
  slug: 'incline-dumbbell-bench-press',
  setup_callout: 'Bench: 30°.',
  setup_facts: { bench_angle_deg: 30 },
  cues: ['a', 'b', 'c'],
  donts: ['x', 'y'],
  media: {},
};

afterEach(() => vi.restoreAllMocks());

function mockFetch(status: number, body: unknown) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

describe('getExerciseGuide', () => {
  it('fetches the guide from the guide endpoint', async () => {
    const spy = mockFetch(200, GUIDE);
    const guide = await getExerciseGuide('incline-dumbbell-bench-press');
    expect(guide).toEqual(GUIDE);
    const url = String(spy.mock.calls[0][0]);
    expect(url).toContain('/api/exercises/incline-dumbbell-bench-press/guide');
  });

  it('returns null on 404 (no guide → UI hides the button)', async () => {
    mockFetch(404, { error: 'guide not found' });
    await expect(getExerciseGuide('no-guide')).resolves.toBeNull();
  });

  it('throws on non-404 errors', async () => {
    mockFetch(500, { error: 'boom' });
    await expect(getExerciseGuide('x')).rejects.toThrow();
  });

  it('URL-encodes the slug', async () => {
    const spy = mockFetch(200, GUIDE);
    await getExerciseGuide('a b');
    expect(String(spy.mock.calls[0][0])).toContain('/api/exercises/a%20b/guide');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npx vitest run src/lib/api/exerciseGuide.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the client**

```typescript
// frontend/src/lib/api/exerciseGuide.ts
/**
 * Frontend client for GET /api/exercises/:slug/guide (W2 setup cards).
 * Manually kept in sync with api/src/schemas/exerciseGuide.ts
 * (ExerciseGuideResponse) — see api/src/schemas/README.md.
 */

import { apiFetch } from '../../auth';
import { ApiError, jsonOrThrow } from './_http';

export type ExerciseGuide = {
  slug: string;
  setup_callout: string;
  setup_facts: Record<string, number | string>;
  cues: string[];
  donts: string[];
  media: { start?: string; end?: string };
};

/** 404 → null: "no guide" is an expected state (the UI hides ⓘ), not an error. */
export async function getExerciseGuide(slug: string): Promise<ExerciseGuide | null> {
  const res = await apiFetch(`/api/exercises/${encodeURIComponent(slug)}/guide`, {});
  try {
    return await jsonOrThrow<ExerciseGuide>(res);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npx vitest run src/lib/api/exerciseGuide.test.ts`
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && git add frontend/src/lib/api/exerciseGuide.ts frontend/src/lib/api/exerciseGuide.test.ts && git commit -m "feat(frontend): exercise guide API client"
```

---

### Task 6: SetupCardSheet component

**Files:**
- Create: `frontend/src/components/programs/logger/SetupCardSheet.tsx`
- Test: `frontend/src/components/programs/logger/SetupCardSheet.test.tsx`

Presentational: receives the already-fetched guide as a prop (the container fetched it to decide ⓘ visibility — no second fetch, unlike HistorySheet which self-fetches). Focus management (capture/steer/trap/restore) mirrors `HistorySheet.tsx:55-96` verbatim.

- [ ] **Step 1: Write the failing tests**

```typescript
// frontend/src/components/programs/logger/SetupCardSheet.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SetupCardSheet } from './SetupCardSheet';
import type { ExerciseGuide } from '../../../lib/api/exerciseGuide';

const GUIDE: ExerciseGuide = {
  slug: 'incline-dumbbell-bench-press',
  setup_callout: 'Bench: 30° — usually the 2nd incline notch.',
  setup_facts: { bench_angle_deg: 30 },
  cues: ['Cue one', 'Cue two', 'Cue three'],
  donts: ['Mistake one', 'Mistake two'],
  media: {},
};

describe('SetupCardSheet', () => {
  it('renders callout, 3 cues, 2 donts, and the photo placeholder', () => {
    render(
      <SetupCardSheet exerciseName="Incline DB Bench Press" guide={GUIDE} onClose={() => {}} />,
    );
    expect(screen.getByRole('dialog', { name: /how to set up/i })).toBeInTheDocument();
    expect(screen.getByText(/Bench: 30°/)).toBeInTheDocument();
    expect(screen.getByText('Cue one')).toBeInTheDocument();
    expect(screen.getByText('Cue three')).toBeInTheDocument();
    expect(screen.getByText('Mistake two')).toBeInTheDocument();
    // W2: no photos yet — the media slot shows a placeholder, never a broken img.
    expect(screen.getByTestId('setup-photo-placeholder')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('closes on backdrop click, close button, and Escape', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <SetupCardSheet exerciseName="X" guide={GUIDE} onClose={onClose} />,
    );
    fireEvent.click(screen.getByRole('dialog', { name: /how to set up/i }));
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<SetupCardSheet exerciseName="X" guide={GUIDE} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('does not propagate clicks inside the sheet to the backdrop', () => {
    const onClose = vi.fn();
    render(<SetupCardSheet exerciseName="X" guide={GUIDE} onClose={onClose} />);
    fireEvent.click(screen.getByText('Cue one'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npx vitest run src/components/programs/logger/SetupCardSheet.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the component**

```tsx
// frontend/src/components/programs/logger/SetupCardSheet.tsx
import { useEffect, useRef } from 'react';
import { TOKENS, FONTS } from '../../../tokens';
import type { ExerciseGuide } from '../../../lib/api/exerciseGuide';

// =============================================================================
// SetupCardSheet — the ⓘ setup card (spec §4): photo slot, "Set up" callout,
// 3 cues, 2 don'ts. Presentational: the container fetched the guide already
// (it needed it to decide ⓘ visibility), so this receives data as a prop —
// deliberately unlike HistorySheet, which self-fetches.
//
// W2: media is always {} — the photo slot renders a placeholder. W3 wires
// committed WebP photos + app-rendered annotation tags from setup_facts.
//
// Focus management mirrors HistorySheet.tsx:55-96 verbatim: capture the
// pre-mount focus target, steer initial focus into the dialog, trap
// Tab/Shift+Tab inside it, restore focus to the trigger on unmount.
// =============================================================================

export type SetupCardSheetProps = {
  exerciseName: string;
  guide: ExerciseGuide;
  onClose: () => void;
};

export function SetupCardSheet({ exerciseName, guide, onClose }: SetupCardSheetProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const first = dialogRef.current?.querySelector<HTMLElement>(
      'button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])',
    );
    first?.focus();
    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusables = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`How to set up: ${exerciseName}`}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        zIndex: TOKENS.zModal.zSheet,
      }}
    >
      <div
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 480,
          maxHeight: '85vh',
          background: TOKENS.surface,
          color: TOKENS.text,
          borderTop: `1px solid ${TOKENS.line}`,
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          fontFamily: FONTS.ui,
          overflowY: 'auto',
          boxSizing: 'border-box',
        }}
      >
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div
            style={{
              fontFamily: FONTS.mono,
              fontSize: 10,
              letterSpacing: 1,
              color: TOKENS.textDim,
              textTransform: 'uppercase',
            }}
          >
            How to set up
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 44,
              height: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: 'none',
              color: TOKENS.textDim,
              fontSize: 18,
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </header>

        {/* Photo slot — placeholder until W3 lands committed photos. */}
        {guide.media.start ? (
          <img
            src={guide.media.start}
            alt={`${exerciseName} setup position`}
            style={{ width: '100%', borderRadius: 12, display: 'block' }}
          />
        ) : (
          <div
            data-testid="setup-photo-placeholder"
            aria-hidden="true"
            style={{
              width: '100%',
              aspectRatio: '4 / 3',
              borderRadius: 12,
              background: TOKENS.surface2,
              border: `1px dashed ${TOKENS.line}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: TOKENS.textMute,
              fontFamily: FONTS.mono,
              fontSize: 11,
              letterSpacing: 1,
              textTransform: 'uppercase',
            }}
          >
            Photo coming soon
          </div>
        )}

        <section aria-label="Set up">
          <SectionLabel>Set up</SectionLabel>
          <div
            style={{
              background: TOKENS.surface2,
              border: `1px solid ${TOKENS.line}`,
              borderLeft: `3px solid ${TOKENS.accent}`,
              borderRadius: 8,
              padding: 12,
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            {guide.setup_callout}
          </div>
        </section>

        <section aria-label="Cues">
          <SectionLabel>Cues</SectionLabel>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {guide.cues.map((cue) => (
              <li key={cue} style={{ fontSize: 14, lineHeight: 1.4 }}>
                {cue}
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="Common mistakes">
          <SectionLabel color={TOKENS.danger}>Don&rsquo;t</SectionLabel>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {guide.donts.map((dont) => (
              <li key={dont} style={{ fontSize: 14, lineHeight: 1.4, color: TOKENS.textDim }}>
                {dont}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function SectionLabel({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <div
      style={{
        fontFamily: FONTS.mono,
        fontSize: 10,
        letterSpacing: 1,
        color: color ?? TOKENS.textDim,
        textTransform: 'uppercase',
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  );
}
```

(Verify token names `TOKENS.surface2`, `TOKENS.textMute`, `TOKENS.zModal.zSheet` against `frontend/src/tokens.ts` — HistorySheet uses all three, so they exist; match whatever it imports.)

- [ ] **Step 4: Run the tests**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npx vitest run src/components/programs/logger/SetupCardSheet.test.tsx`
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && git add frontend/src/components/programs/logger/SetupCardSheet.tsx frontend/src/components/programs/logger/SetupCardSheet.test.tsx && git commit -m "feat(frontend): SetupCardSheet — the exercise setup card"
```

---

### Task 7: ⓘ button in ExerciseFocus

**Files:**
- Modify: `frontend/src/components/programs/logger/ExerciseFocus.tsx` (header, lines ~62-117)
- Test: `frontend/src/components/programs/logger/ExerciseFocus.test.tsx` (extend)

- [ ] **Step 1: Write the failing tests**

Add to `ExerciseFocus.test.tsx`. The file's convention is a `baseProps(overrides)` builder + direct `render(<ExerciseFocus {...baseProps(...)} />)` (see `ExerciseFocus.test.tsx:52-69`) — extend the defaults with `onOpenGuide: null`:

```typescript
describe('ⓘ how-to button', () => {
  it('renders and fires when onOpenGuide is provided', () => {
    const onOpenGuide = vi.fn();
    render(<ExerciseFocus {...baseProps({ onOpenGuide })} />);
    const btn = screen.getByRole('button', { name: /how to do this exercise/i });
    fireEvent.click(btn);
    expect(onOpenGuide).toHaveBeenCalledTimes(1);
  });

  it('is absent when onOpenGuide is null (no guide → hide ⓘ, per spec)', () => {
    render(<ExerciseFocus {...baseProps({ onOpenGuide: null })} />);
    expect(
      screen.queryByRole('button', { name: /how to do this exercise/i }),
    ).not.toBeInTheDocument();
  });

  it('history button still renders alongside ⓘ', () => {
    render(<ExerciseFocus {...baseProps({ onOpenGuide: vi.fn() })} />);
    expect(screen.getByRole('button', { name: /exercise history/i })).toBeInTheDocument();
  });
});
```

Also update the stale W1 guard at `ExerciseFocus.test.tsx:79-80`: the existing header test asserts the wave-2 info button does NOT exist (`queryByRole('button', { name: /^info$/i })` with a `// No wave-2 info button.` comment). That assertion is now dead — replace it with the real check: ⓘ (`name: /how to do this exercise/i`) is absent when `onOpenGuide` is not provided, and delete the "no wave-2" comment.

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npx vitest run src/components/programs/logger/ExerciseFocus.test.tsx`
Expected: new tests FAIL (button not found / prop not accepted)

- [ ] **Step 3: Implement**

In `ExerciseFocus.tsx`:

1. Add to the props type (after `onOpenHistory`):

```typescript
  /** null = no guide exists for this exercise → ⓘ is hidden (spec §4). */
  onOpenGuide?: (() => void) | null;
```

and destructure `onOpenGuide` in the parameter list.

2. Replace the lone history `<button>` in the header (lines ~101-116) with a right-aligned group so ⓘ sits beside ⟲:

```tsx
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {onOpenGuide ? (
              <button
                type="button"
                aria-label="How to do this exercise"
                onClick={onOpenGuide}
                style={{
                  minWidth: 44,
                  minHeight: 44,
                  background: 'none',
                  border: 'none',
                  color: TOKENS.textDim,
                  fontSize: 18,
                  cursor: 'pointer',
                }}
              >
                ⓘ
              </button>
            ) : null}
            <button
              type="button"
              aria-label="Exercise history"
              onClick={onOpenHistory}
              style={{
                minWidth: 44,
                minHeight: 44,
                background: 'none',
                border: 'none',
                color: TOKENS.textDim,
                fontSize: 18,
                cursor: 'pointer',
              }}
            >
              ⟲
            </button>
          </div>
```

- [ ] **Step 4: Run the component's full test file**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npx vitest run src/components/programs/logger/ExerciseFocus.test.tsx`
Expected: all tests PASS (existing + 3 new)

- [ ] **Step 5: Commit**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && git add frontend/src/components/programs/logger/ExerciseFocus.tsx frontend/src/components/programs/logger/ExerciseFocus.test.tsx && git commit -m "feat(frontend): conditional ⓘ how-to button on the focus screen"
```

---

### Task 8: Container wiring in TodayLoggerMobile

**Files:**
- Modify: `frontend/src/components/programs/TodayLoggerMobile.tsx`
- Test: `frontend/src/components/programs/TodayLoggerMobile.test.tsx` (extend)

Mirror the W1 `histBySlug` pattern exactly: per-slug cache in state, fetch on focus change, non-blocking on failure, sheet-open state reset when focus changes.

- [ ] **Step 1: Write the failing tests**

Add to `TodayLoggerMobile.test.tsx`. The file already mocks `lib/api` modules (it mocks `exerciseHistory`) — add a `getExerciseGuide` mock alongside, defaulting to a resolved guide:

```typescript
// With the existing mocks, alongside the exerciseHistory mock:
vi.mock('../../lib/api/exerciseGuide', () => ({
  getExerciseGuide: vi.fn(),
}));
import { getExerciseGuide } from '../../lib/api/exerciseGuide';

const GUIDE = {
  slug: 'barbell-bench-press',
  setup_callout: 'Feet flat, slight arch, shoulder blades pinched together on the bench.',
  setup_facts: {},
  cues: ['Cue A', 'Cue B', 'Cue C'],
  donts: ['Mistake A', 'Mistake B'],
  media: {},
};

The file's existing helpers are `renderLogger()` (hub route) and `renderFocused()` (renders directly at the focus route `/today/mr-1/log/0` — no hub tap needed); see `TodayLoggerMobile.test.tsx:76-99`. Use `renderFocused()`:

```typescript
describe('setup card (ⓘ) wiring', () => {
  it('shows ⓘ once the guide loads, and opens the setup card', async () => {
    vi.mocked(getExerciseGuide).mockResolvedValue(GUIDE);
    renderFocused();
    const btn = await screen.findByRole('button', { name: /how to do this exercise/i });
    fireEvent.click(btn);
    expect(await screen.findByRole('dialog', { name: /how to set up/i })).toBeInTheDocument();
    expect(screen.getByText('Cue A')).toBeInTheDocument();
  });

  it('hides ⓘ when the exercise has no guide (404 → null)', async () => {
    vi.mocked(getExerciseGuide).mockResolvedValue(null);
    renderFocused();
    // Let the guide fetch settle, then assert absence.
    await waitFor(() => expect(getExerciseGuide).toHaveBeenCalled());
    expect(
      screen.queryByRole('button', { name: /how to do this exercise/i }),
    ).not.toBeInTheDocument();
  });

  it('hides ⓘ when the guide fetch fails — guides are a nicety, logging must not depend on them', async () => {
    vi.mocked(getExerciseGuide).mockRejectedValue(new Error('network down'));
    renderFocused();
    await waitFor(() => expect(getExerciseGuide).toHaveBeenCalled());
    expect(
      screen.queryByRole('button', { name: /how to do this exercise/i }),
    ).not.toBeInTheDocument();
    // Logging UI is intact:
    expect(screen.getAllByRole('button', { name: /^log$/i }).length).toBeGreaterThan(0);
  });

  it('closes the setup card when leaving the focus screen', async () => {
    vi.mocked(getExerciseGuide).mockResolvedValue(GUIDE);
    renderFocused();
    fireEvent.click(await screen.findByRole('button', { name: /how to do this exercise/i }));
    expect(await screen.findByRole('dialog', { name: /how to set up/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /back to plan/i }));
    expect(screen.queryByRole('dialog', { name: /how to set up/i })).not.toBeInTheDocument();
  });
});
```

(Verify the mock path `'../../lib/api/exerciseGuide'` matches the relative style the file already uses for its `exerciseHistory` mock, and set the test-file-wide default in `beforeEach` so pre-existing tests get `getExerciseGuide` resolving to `null` — existing assertions must not be disturbed by an unmocked rejection.)

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npx vitest run src/components/programs/TodayLoggerMobile.test.tsx`
Expected: new tests FAIL (ⓘ never appears)

- [ ] **Step 3: Implement the wiring**

In `TodayLoggerMobile.tsx`:

1. Imports:

```typescript
import { getExerciseGuide, type ExerciseGuide } from '../../lib/api/exerciseGuide';
import { SetupCardSheet } from './logger/SetupCardSheet';
```

2. Guide cache + fetch — place next to the `histBySlug` effect (~line 260-295), same shape:

```typescript
  // Guide cache: slug → ExerciseGuide (has guide), null (404/failed — hide ⓘ),
  // undefined (not fetched yet). Guides are a nicety — logging must not
  // depend on them, so failures degrade to "no ⓘ" silently.
  const [guideBySlug, setGuideBySlug] = useState<Record<string, ExerciseGuide | null>>({});
  useEffect(() => {
    if (!focusedEntry) return;
    const slug = focusedEntry[1][0].exercise.slug;
    if (slug in guideBySlug) return; // cached (including cached "no guide")
    let cancelled = false;
    getExerciseGuide(slug)
      .then((guide) => {
        if (cancelled) return;
        setGuideBySlug((prev) => ({ ...prev, [slug]: guide }));
      })
      .catch(() => {
        if (cancelled) return;
        setGuideBySlug((prev) => ({ ...prev, [slug]: null }));
      });
    return () => {
      cancelled = true;
    };
    // guideBySlug intentionally omitted: the `in` check reads latest state via
    // the effect only re-running on focus change; including it would refetch-loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedEntry]);
```

(If the repo's lint config forbids the disable comment, restructure with a `useRef<Set<string>>` of in-flight/fetched slugs instead — same behavior, no suppression. Follow whichever pattern the `histBySlug` effect already uses.)

3. Sheet-open state — next to `historyOpen` (~line 302):

```typescript
  const [guideOpen, setGuideOpen] = useState(false);
  useEffect(() => {
    setGuideOpen(false);
  }, [focusedEntry]);
```

4. In the focus-screen return branch (~line 439-471): derive `const guide = guideBySlug[slug] ?? null;` next to the existing `const meta = exMeta[slug];`, pass to `ExerciseFocus`:

```tsx
        onOpenGuide={guide ? () => setGuideOpen(true) : null}
```

and mount the sheet beside `HistorySheet`:

```tsx
      {guideOpen && guide ? (
        <SetupCardSheet
          exerciseName={focusedSets[0].exercise.name}
          guide={guide}
          onClose={() => setGuideOpen(false)}
        />
      ) : null}
```

- [ ] **Step 4: Run the container's full test file**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npx vitest run src/components/programs/TodayLoggerMobile.test.tsx`
Expected: all tests PASS (19 existing + 4 new)

- [ ] **Step 5: Commit**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && git add frontend/src/components/programs/TodayLoggerMobile.tsx frontend/src/components/programs/TodayLoggerMobile.test.tsx && git commit -m "feat(frontend): wire setup card into the workout logger"
```

---

### Task 9: Full verification + PR

**Files:** none new — verification and integration only.

- [ ] **Step 1: Reset the local test DB, then run the full api suite**

Local persistent DBs mask seed/backfill gaps that CI's fresh DB exposes (`reference_ci_fresh_db_masks_backfill` memory), and interrupted runs leave cruft (`reference_test_db_cruft`):

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && psql postgres://repos:repos_dev_pw@127.0.0.1:5432/postgres -c "DROP DATABASE IF EXISTS repos_test WITH (FORCE)" -c "CREATE DATABASE repos_test OWNER repos" && npm run migrate && npm run seed && npm test && npm run lint && npm run format:check
```

Expected: migrate applies through 080, seed reports `exercise_guides … upserted:44`, all unit + integration tests pass, lint + prettier clean. (Check `api/package.json` for exact script names; if the DB is bootstrapped a different way — e.g. a `db:reset` script — use that.)

- [ ] **Step 2: Frontend suite + build**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npm test -- --run && npm run build && npm run lint
```

Expected: all vitest green, `tsc`/Vite build clean.

- [ ] **Step 3: Offline Playwright regression**

The offline specs drive the logger UI; ⓘ is additive but verify nothing regressed:

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npx playwright test src/components/programs/__offline__
```

Expected: 8/8 PASS. (Exact invocation: check how W1 ran these — see `package.json` scripts.)

- [ ] **Step 4: Verify the shipped surface end-to-end locally**

Component tests aren't user-reachability (`feedback_user_reachability_dod` memory). Run the app locally (api + frontend dev servers against the local DB with the seed applied), log in, navigate Home → TODAY → open an exercise → tap ⓘ → confirm the setup card renders authored content with the photo placeholder. Use the `verify` skill / dev-server workflow established in W1.

- [ ] **Step 5: Branch, push, PR**

All changes must land via PR — main is branch-protected, 8 required checks (`reference_branch_protection_main` memory). The work should have been on a branch from Task 1 (e.g. `feat/logging-education-w2`); if any commits landed on local main, move them to a branch now (`git branch feat/logging-education-w2 && git reset --hard origin/main && git switch feat/logging-education-w2`).

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && git push -u origin feat/logging-education-w2 && gh pr create --title "feat: exercise education — setup cards for all 44 exercises (redesign wave 2)" --body "$(cat <<'EOF'
## Wave 2 of the workout logging redesign — education content

Spec: docs/superpowers/specs/2026-07-06-workout-logging-redesign-design.md §4

- `exercise_guides` table (migration 080, additive) + seed pipeline (same runSeed/adapter pattern as program_templates; auto-applies via the container init-seed oneshot on deploy)
- **44 authored setup cards** — setup callout, 3 cues, 2 don'ts, structured setup_facts for W3 annotations. Please review the content in `api/src/seed/exerciseGuides.ts` like prose.
- `GET /api/exercises/:slug/guide` (public cache; 404 → UI hides ⓘ)
- ⓘ button on the focus screen → SetupCardSheet (photo slot shows a placeholder until W3)

## Testing
- api: schema, seed adapter round-trip, content coverage (44/44 + no-jargon gate), route tests
- frontend: client, SetupCardSheet, ExerciseFocus ⓘ variants, container wiring (guide 404/failure degrade to no-ⓘ)
- offline Playwright regression suite green

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: Merge after checks + content review, deploy**

Wait for 8/8 checks and the user's content review of the 44 guides. After squash-merge: redeploy per `reference_unraid_redeploy` memory (stop+rm+run, not restart), then verify outside-in — curl `https://repos.jpmtech.com` (expect 302) and `curl -s https://repos.jpmtech.com/api/exercises/barbell-back-squat/guide` via an authenticated path if CF Access intercepts, or verify on-phone: TODAY → exercise → ⓘ shows the authored card. The s6 `init-seed` oneshot applies the guide seed automatically on container start — confirm its log line `exercise_guides: {"applied":true,"upserted":44,...}` in the container logs.

---

## Deferred from spec (explicit)

- **Photos + annotation-tag overlay** — W3 by design; `setup_facts` and `media` columns land now so W3 is seed-content-only + frontend overlay.
- **Guides reachable from the exercise library** — spec marks library surfacing out of scope for this effort.
- **`Term` tooltips inside guide prose** — guide content is written jargon-free instead (enforced by the content test); if a term of art ever becomes necessary in a card, that's the point to add rich-text support, not before (YAGNI).
