# W3 — Exercise Photos (Gemini Pipeline) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate photorealistic start/end photos for all 44 exercises via the Gemini image API, run them through a human review loop, commit the approved WebP files, and render them in the setup card with app-rendered annotation chips from `setup_facts`.

**Architecture:** A self-contained tooling package at `scripts/exercise-media/` (own `package.json`; `sharp` + `tsx` never touch the api/frontend dependency trees or CI, and a `.dockerignore` entry keeps it out of the prod image — `docker/Dockerfile` COPYs the whole `scripts/` tree) generates PNGs into a git-ignored staging folder with a contact-sheet HTML for review. A `promote` script converts approved staging images to WebP under `frontend/public/exercise-media/` and regenerates a checked-in manifest module `api/src/seed/exerciseMediaManifest.ts` by scanning that folder — the committed files are the source of truth. The existing seed merges manifest media into `exercise_guides` rows (prod re-seeds on every container start, so media paths deploy with a normal redeploy). The frontend `SetupCardSheet` renders the photo with annotation chips derived from `setup_facts` (text is never baked into images — spec §5) and a Start/End toggle.

**Tech Stack:** TypeScript via `tsx`, Gemini image API over plain `fetch` (Node 22 built-in), `sharp` for WebP encode, `node:test` for the tooling package (no vitest config needed), vitest for api/frontend changes.

**Spec:** `docs/superpowers/specs/2026-07-06-workout-logging-redesign-design.md` §5 (imagery pipeline), §4 (setup card), "Phasing" W3.

**Branch:** `feat/w3-exercise-photos` (branch protection: all work lands via PR).

**Split of labor:** Tasks 1–8 are pure code — agent-executable, TDD. Tasks 9–10 are the operator loop: they need the repo-root `.env` `GEMINI_API_KEY` (may have been rotated — Task 9 starts with a smoke test), live API spend (ballpark: `gemini-2.5-flash-image` ≈ $0.04/image → ~$5 for 88 finals + regens; `gemini-3-pro-image-preview` ≈ $0.13–0.25/image → ~$15–25), and the user reviewing images. **Do not start Task 9 without the user present.**

**Model choice (open item from spec, settled empirically in Task 9):** default `gemini-2.5-flash-image`; pilot also runs `gemini-3-pro-image-preview` (better identity consistency + text avoidance) and the user picks. Model id is a `--model` flag everywhere, never hardcoded into results — the staging manifest records which model produced each image.

---

## File structure

```
scripts/exercise-media/
  package.json               # private tooling package: sharp dep, tsx devDep
  .gitignore                 # staging/, node_modules/
  src/
    paths.ts                 # repo-root/staging/media/manifest path constants + .env key loader
    data.ts                  # bridges api seed files → {slug, name, equipment, setupCallout}
    prompt.ts                # STYLE_BLOCK, frame descriptors, buildPrompt()
    promptOverrides.ts       # per-slug position + scene overrides (grows during review loop)
    gemini.ts                # fetch client: retry/backoff, base64 image extraction
    contactSheet.ts          # renders staging/index.html review grid
    generate.ts              # CLI: worklist → Gemini → staging/*.png + manifest.json + contact sheet
    webp.ts                  # sharp PNG→WebP with quality ladder to ≤400 KB
    manifestModule.ts        # renders api/src/seed/exerciseMediaManifest.ts from a file list
    promote.ts               # CLI: staging → frontend/public/exercise-media + manifest regeneration
    *.test.ts                # node:test unit tests colocated per module
  staging/                   # git-ignored: generated PNGs, manifest.json, index.html

api/src/seed/exerciseMediaManifest.ts    # GENERATED, checked in, starts empty
api/src/seed/exerciseGuides.ts           # modified: merge manifest media into export
api/tests/seed/exerciseMediaManifest.test.ts  # new invariant tests

frontend/src/lib/setupFactLabels.ts          # setup_facts → chip strings
frontend/src/lib/setupFactLabels.test.ts
frontend/src/components/programs/logger/SetupCardSheet.tsx       # photo block: img + chips + toggle
frontend/src/components/programs/logger/SetupCardSheet.test.tsx  # extended

frontend/public/exercise-media/          # committed WebP files (Task 10)
```

Path contract (already pinned by W2 schema comments and `SetupCardSheet`): `/exercise-media/<slug>-start.webp` and `/exercise-media/<slug>-end.webp`. Vite copies `public/` into `dist/` verbatim; nginx serves it same-origin, so CSP and the offline story are unchanged. Expect the docker image to grow ~25–35 MB (88 files × ~300 KB) — acceptable, note it in the PR body.

---

### Task 1: Scaffold the tooling package

**Files:**
- Create: `scripts/exercise-media/package.json`
- Create: `scripts/exercise-media/.gitignore`

- [ ] **Step 1: Create the package**

`scripts/exercise-media/package.json`:

```json
{
  "name": "exercise-media-pipeline",
  "private": true,
  "type": "module",
  "description": "Manual Gemini photo pipeline for exercise setup cards (spec 2026-07-06 §5). Never runs in CI.",
  "scripts": {
    "generate": "tsx src/generate.ts",
    "promote": "tsx src/promote.ts",
    "test": "tsx --test src/*.test.ts"
  },
  "dependencies": {
    "sharp": "^0.34.4"
  },
  "devDependencies": {
    "tsx": "^4.22.4"
  }
}
```

(No `typescript` devDep: `tsx` strips types without checking and the package has no tsconfig — a dead dependency otherwise. Type safety here comes from the tests.)

`scripts/exercise-media/.gitignore` — note `staging*/`, not `staging/`: Task 10's pilot creates `staging-flash/`/`staging-pro/` side folders, and a `git add -A` must not commit megabytes of PNGs:

```
node_modules/
staging*/
```

- [ ] **Step 2: Keep the package out of the production image**

`docker/Dockerfile` does `COPY scripts /scripts` — the whole tree, including this package, would ship in every image, and a local `docker build` with a populated staging folder (~100–300 MB of PNGs) would balloon the build context (`.dockerignore` covers `**/node_modules` but not `staging*/`). Append to the repo-root `.dockerignore`:

```
scripts/exercise-media/
```

- [ ] **Step 3: Install and sanity-check**

Run: `cd scripts/exercise-media && npm install && npx tsx --version`
Expected: installs cleanly, prints a tsx version.

- [ ] **Step 4: Commit**

```bash
git add scripts/exercise-media/package.json scripts/exercise-media/.gitignore scripts/exercise-media/package-lock.json .dockerignore
git commit -m "chore(media): scaffold exercise-media tooling package"
```

---

### Task 2: Paths + data bridge

**Files:**
- Create: `scripts/exercise-media/src/paths.ts`
- Create: `scripts/exercise-media/src/data.ts`
- Test: `scripts/exercise-media/src/data.test.ts`

- [ ] **Step 1: Write the failing test**

`scripts/exercise-media/src/data.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listExerciseInfo } from './data.js';

test('every guide maps to an exercise with name, equipment list, and callout', () => {
  const infos = listExerciseInfo();
  assert.ok(infos.length >= 40, `expected ~44 exercises, got ${infos.length}`);
  for (const info of infos) {
    assert.match(info.slug, /^[a-z0-9-]+$/);
    assert.ok(info.name.length > 0, `${info.slug}: empty name`);
    assert.ok(info.setupCallout.length >= 40, `${info.slug}: callout too short`);
    assert.ok(Array.isArray(info.equipment));
    for (const eq of info.equipment) assert.ok(!eq.includes('_'), `${info.slug}: unhumanized equipment "${eq}"`);
  }
});

test('a known exercise resolves with humanized equipment', () => {
  const incline = listExerciseInfo().find((i) => i.slug === 'incline-dumbbell-bench-press');
  assert.ok(incline);
  assert.ok(incline.equipment.some((e) => e.includes('bench')));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scripts/exercise-media && npx tsx --test src/data.test.ts`
Expected: FAIL — cannot find module `./data.js`.

- [ ] **Step 3: Implement**

`scripts/exercise-media/src/paths.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)); // scripts/exercise-media/src
export const REPO_ROOT = path.resolve(HERE, '../../..');
export const STAGING_DIR = path.join(REPO_ROOT, 'scripts/exercise-media/staging');
export const STAGING_MANIFEST = path.join(STAGING_DIR, 'manifest.json');
export const CONTACT_SHEET = path.join(STAGING_DIR, 'index.html');
export const MEDIA_DIR = path.join(REPO_ROOT, 'frontend/public/exercise-media');
export const SEED_MANIFEST = path.join(REPO_ROOT, 'api/src/seed/exerciseMediaManifest.ts');

/**
 * GEMINI_API_KEY comes from the environment or the repo-root .env (git-ignored).
 * Never log or embed the key anywhere (parent CLAUDE.md security rules).
 */
export function readGeminiKey(): string {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  const envPath = path.join(REPO_ROOT, '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^GEMINI_API_KEY=["']?([^"'\r]+?)["']?\s*$/);
      if (m) return m[1];
    }
  }
  throw new Error(
    `GEMINI_API_KEY not set and not found in ${envPath}. ` +
      'Add it to the repo-root .env (it is git-ignored). If a key existed before, it may have been rotated.',
  );
}
```

`scripts/exercise-media/src/data.ts`:

```ts
import { exercises } from '../../../api/src/seed/exercises.js';
import { exerciseGuides } from '../../../api/src/seed/exerciseGuides.js';

export type ExerciseInfo = {
  slug: string;
  name: string;
  equipment: string[]; // humanized, e.g. "adjustable bench"
  setupCallout: string;
};

/** One entry per exercise guide (the guide list is the canonical 44). */
export function listExerciseInfo(): ExerciseInfo[] {
  const bySlug = new Map(exercises.map((e) => [e.slug, e]));
  return exerciseGuides.map((g) => {
    const ex = bySlug.get(g.exercise_slug);
    if (!ex) throw new Error(`guide has no matching exercise: ${g.exercise_slug}`);
    const equipment = (ex.required_equipment?.requires ?? []).map((r: { type: string }) =>
      r.type.replace(/_/g, ' '),
    );
    return { slug: g.exercise_slug, name: ex.name, equipment, setupCallout: g.setup_callout };
  });
}
```

Note: this cross-package import works with zero api dependencies — `exercises.ts` uses only `import type`, and after Task 7 `exerciseGuides.ts` gains one runtime import (`./exerciseMediaManifest.js`), which is itself import-free. `tsx` resolves the api's `.js`-suffixed relative specifiers to the `.ts` sources. **Do not add runtime imports (e.g. zod validation) to these seed files** — that would break this bridge on checkouts without `api/node_modules`; Task 7's merged-export comment carries the same warning.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd scripts/exercise-media && npx tsx --test src/data.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/exercise-media/src/paths.ts scripts/exercise-media/src/data.ts scripts/exercise-media/src/data.test.ts
git commit -m "feat(media): seed-data bridge + path/key helpers for photo pipeline"
```

---

### Task 3: Prompt builder + overrides

**Files:**
- Create: `scripts/exercise-media/src/prompt.ts`
- Create: `scripts/exercise-media/src/promptOverrides.ts`
- Test: `scripts/exercise-media/src/prompt.test.ts`

- [ ] **Step 1: Write the failing test**

`scripts/exercise-media/src/prompt.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, STYLE_BLOCK } from './prompt.js';

const BASE = {
  name: 'Incline Dumbbell Bench Press',
  equipment: ['dumbbells', 'adjustable bench'],
  setupCallout: 'Bench: 30° — usually the 2nd incline notch.',
};

test('prompt contains style block, exercise, equipment, and callout', () => {
  const p = buildPrompt({ ...BASE, frame: 'start' });
  assert.ok(p.includes(STYLE_BLOCK));
  assert.ok(p.includes('Incline Dumbbell Bench Press'));
  assert.ok(p.includes('dumbbells, adjustable bench'));
  assert.ok(p.includes('Bench: 30°'));
});

test('start and end frames produce different position lines', () => {
  const start = buildPrompt({ ...BASE, frame: 'start' });
  const end = buildPrompt({ ...BASE, frame: 'end' });
  assert.notEqual(start, end);
  assert.match(start, /STARTING position/);
  assert.match(end, /END position/);
});

test('position override replaces the callout-derived line', () => {
  const p = buildPrompt({ ...BASE, frame: 'start', positionOverride: 'Lying back on a 30-degree bench, dumbbells resting on thighs.' });
  assert.ok(p.includes('dumbbells resting on thighs'));
  assert.ok(!p.includes('2nd incline notch'));
});

test('scene override replaces the gym style block entirely', () => {
  const p = buildPrompt({ ...BASE, frame: 'start', sceneOverride: 'Outdoor park path, overcast daylight.' });
  assert.ok(!p.includes(STYLE_BLOCK));
  assert.ok(p.includes('Outdoor park path'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scripts/exercise-media && npx tsx --test src/prompt.test.ts`
Expected: FAIL — cannot find module `./prompt.js`.

- [ ] **Step 3: Implement**

`scripts/exercise-media/src/prompt.ts`:

```ts
export type Frame = 'start' | 'end';

// One shared scene so all 44 exercises read as the same athlete in the same
// gym (spec §5). Text/logo bans guard the AI-garbled-text failure mode the
// spec calls out ("3squenie") — annotations are app-rendered, never baked in.
export const STYLE_BLOCK = `Photorealistic photograph shot in a modern commercial gym.
The SAME athlete in every image: a man in his early 30s, average athletic build, short dark hair,
plain heather-gray t-shirt, black shorts, neutral dark training shoes.
Setting: dark rubber gym flooring, matte-black equipment, soft even overhead lighting,
clean uncluttered background, shallow depth of field.
Camera: chest height, three-quarter side angle, the full body and the equipment in frame.
Composition: 4:3 landscape orientation.
Strictly NO text, NO lettering, NO logos, NO watermarks, NO mirrors facing the camera, NO other people.`;

const FRAME_LINE: Record<Frame, string> = {
  start:
    'Show the STARTING position of the exercise: set up and ready, the instant before the first rep begins.',
  end: 'Show the END position of the rep: peak contraction at full range of motion.',
};

export function buildPrompt(input: {
  name: string;
  equipment: string[];
  setupCallout: string;
  frame: Frame;
  positionOverride?: string;
  sceneOverride?: string;
}): string {
  const scene = input.sceneOverride ?? STYLE_BLOCK;
  const equipmentLine =
    input.equipment.length > 0 ? `Equipment in use: ${input.equipment.join(', ')}.` : '';
  const position =
    input.positionOverride ?? `Setup, for reference: ${input.setupCallout}`;
  return [scene, `Exercise: ${input.name}.`, equipmentLine, FRAME_LINE[input.frame], position]
    .filter(Boolean)
    .join('\n\n');
}
```

`scripts/exercise-media/src/promptOverrides.ts`:

```ts
import type { Frame } from './prompt.js';

// The review loop lives here: when the user rejects an image, add/adjust the
// slug's entry and re-run `npm run generate -- --slug <slug> --force`.

/** Replaces the callout-derived position line for one frame of one exercise. */
export const positionOverrides: Record<string, Partial<Record<Frame, string>>> = {};

/**
 * Replaces the entire gym STYLE_BLOCK for exercises that don't happen in a gym
 * (cardio is first-class — memory feedback_cardio_first_class).
 */
export const sceneOverrides: Record<string, string> = {
  'outdoor-walking-z2': `Photorealistic outdoor photograph.
The SAME athlete as the gym set: a man in his early 30s, average athletic build, short dark hair,
plain heather-gray t-shirt, black shorts, neutral dark training shoes.
Setting: a paved park path with trees, soft overcast daylight, no other people visible.
Camera: chest height, three-quarter side angle, full body in frame.
Composition: 4:3 landscape orientation.
Strictly NO text, NO lettering, NO logos, NO watermarks, NO other people.`,
};
```

(If other outdoor/cardio slugs surface during the pilot, they get entries the same way.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd scripts/exercise-media && npx tsx --test src/prompt.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/exercise-media/src/prompt.ts scripts/exercise-media/src/promptOverrides.ts scripts/exercise-media/src/prompt.test.ts
git commit -m "feat(media): shared style block + per-exercise prompt builder"
```

---

### Task 4: Gemini client with retry/backoff

**Files:**
- Create: `scripts/exercise-media/src/gemini.ts`
- Test: `scripts/exercise-media/src/gemini.test.ts`

- [ ] **Step 1: Write the failing test**

`scripts/exercise-media/src/gemini.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractImage, isRetryable, backoffMs } from './gemini.js';

test('extractImage returns decoded inline image data', () => {
  const png = Buffer.from('fake-png-bytes');
  const body = {
    candidates: [
      {
        content: {
          parts: [
            { text: 'Here is your image.' },
            { inlineData: { mimeType: 'image/png', data: png.toString('base64') } },
          ],
        },
      },
    ],
  };
  const out = extractImage(body);
  assert.equal(out.mimeType, 'image/png');
  assert.deepEqual(out.data, png);
});

test('extractImage throws with the text part when no image came back', () => {
  const body = {
    candidates: [{ content: { parts: [{ text: 'I cannot generate that.' }] } }],
  };
  assert.throws(() => extractImage(body), /I cannot generate that/);
});

test('extractImage throws on empty/blocked responses', () => {
  assert.throws(() => extractImage({}), /no candidates/i);
});

test('isRetryable: 429 and 5xx retry, 400/403 do not', () => {
  assert.equal(isRetryable(429), true);
  assert.equal(isRetryable(500), true);
  assert.equal(isRetryable(503), true);
  assert.equal(isRetryable(400), false);
  assert.equal(isRetryable(403), false);
});

test('backoffMs grows exponentially and is capped', () => {
  assert.ok(backoffMs(0) >= 1000 && backoffMs(0) < 2000);
  assert.ok(backoffMs(3) >= 8000 && backoffMs(3) < 9000);
  assert.ok(backoffMs(10) <= 61000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scripts/exercise-media && npx tsx --test src/gemini.test.ts`
Expected: FAIL — cannot find module `./gemini.js`.

- [ ] **Step 3: Implement**

`scripts/exercise-media/src/gemini.ts`:

```ts
// Plain-fetch client for the Gemini image API (generativelanguage.googleapis.com).
// Retries 429/5xx with jittered exponential backoff per the repo's API-reliability
// rule; never puts the API key in error messages.

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export type GeminiImage = { mimeType: string; data: Buffer };

export function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

export function backoffMs(attempt: number): number {
  return Math.min(60_000, 2 ** attempt * 1000) + Math.floor(Math.random() * 1000);
}

export function extractImage(body: unknown): GeminiImage {
  const candidates = (body as { candidates?: unknown[] })?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error(`Gemini returned no candidates (blocked or empty): ${JSON.stringify(body).slice(0, 300)}`);
  }
  const parts =
    (candidates[0] as { content?: { parts?: Array<Record<string, unknown>> } })?.content?.parts ?? [];
  for (const part of parts) {
    const inline = part.inlineData as { mimeType?: string; data?: string } | undefined;
    if (inline?.data) {
      return { mimeType: inline.mimeType ?? 'image/png', data: Buffer.from(inline.data, 'base64') };
    }
  }
  const text = parts.map((p) => p.text).filter(Boolean).join(' ');
  throw new Error(`Gemini returned no image. Text response: ${text || '(none)'}`);
}

export async function generateImage(opts: {
  apiKey: string;
  model: string;
  prompt: string;
  maxAttempts?: number;
}): Promise<GeminiImage> {
  const max = opts.maxAttempts ?? 5;
  for (let attempt = 0; ; attempt++) {
    // Network-level failures (ECONNRESET, DNS blip, TLS reset) are as
    // transient as a 503 — over an 88-image batch one WILL happen. Retry them
    // with the same backoff instead of failing the image.
    let res: Response | undefined;
    try {
      res = await fetch(`${API_BASE}/${opts.model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': opts.apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: opts.prompt }] }],
          generationConfig: {
            // TEXT+IMAGE, not IMAGE-only: image models have a history of
            // rejecting IMAGE-only modality (400), and interleaved models
            // (gemini-3-pro-image-preview) document TEXT+IMAGE as the mode.
            // extractImage() skips text parts, so this costs nothing.
            responseModalities: ['TEXT', 'IMAGE'],
            imageConfig: { aspectRatio: '4:3' },
          },
        }),
      });
    } catch (err) {
      if (attempt + 1 >= max) {
        throw new Error(
          `Gemini network failure after ${max} attempts on ${opts.model}: ${(err as Error).message}`,
        );
      }
    }
    if (res?.ok) return extractImage(await res.json());
    if (res) {
      const detail = (await res.text().catch(() => '')).slice(0, 400);
      if (!isRetryable(res.status) || attempt + 1 >= max) {
        throw new Error(
          `Gemini ${res.status} on ${opts.model} (attempt ${attempt + 1}/${max}): ${detail}. ` +
            'Check the model id (`npm run generate -- --smoke` lists available image models) and the API key.',
        );
      }
    }
    const wait = backoffMs(attempt);
    console.warn(`  retryable failure; waiting ${Math.round(wait / 1000)}s…`);
    await new Promise((r) => setTimeout(r, wait));
  }
}

/** Free call: verifies the key + finds usable image-model ids. */
export async function listImageModels(apiKey: string): Promise<string[]> {
  const res = await fetch(`${API_BASE}?pageSize=200`, { headers: { 'x-goog-api-key': apiKey } });
  if (!res.ok) {
    throw new Error(`Gemini model listing failed: ${res.status} ${(await res.text().catch(() => '')).slice(0, 300)}. The key may be invalid or rotated.`);
  }
  const body = (await res.json()) as {
    models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
  };
  return (body.models ?? [])
    // imagen-* ids are :predict-only — they'd 400 on :generateContent, so
    // don't offer them to the operator.
    .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
    .map((m) => m.name?.replace(/^models\//, '') ?? '')
    .filter((n) => /image/i.test(n));
}
```

Note for the engineer: `gemini-3-pro-image-preview` additionally accepts `imageConfig.imageSize: '1K' | '2K' | '4K'` (leave unset → 1K default). If the first live call in Task 10 rejects the config shape, adjust here — this is the spec's declared empirical open item, and the unit tests above deliberately don't pin the wire shape.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd scripts/exercise-media && npx tsx --test src/gemini.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/exercise-media/src/gemini.ts scripts/exercise-media/src/gemini.test.ts
git commit -m "feat(media): Gemini image client with retry/backoff + model listing"
```

---

### Task 5: Contact sheet + generate CLI

**Files:**
- Create: `scripts/exercise-media/src/contactSheet.ts`
- Create: `scripts/exercise-media/src/generate.ts`
- Test: `scripts/exercise-media/src/contactSheet.test.ts`

- [ ] **Step 1: Write the failing test**

`scripts/exercise-media/src/contactSheet.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderContactSheet } from './contactSheet.js';

test('contact sheet lists each slug with start/end imgs and the prompt', () => {
  const html = renderContactSheet([
    {
      slug: 'barbell-back-squat',
      name: 'Barbell Back Squat',
      frames: { start: 'barbell-back-squat-start.png', end: 'barbell-back-squat-end.png' },
      prompts: { start: 'PROMPT-START', end: 'PROMPT-END' },
    },
    { slug: 'lat-pulldown', name: 'Lat Pulldown', frames: { start: 'lat-pulldown-start.png' }, prompts: { start: 'P' } },
  ]);
  assert.ok(html.includes('barbell-back-squat-start.png'));
  assert.ok(html.includes('barbell-back-squat-end.png'));
  assert.ok(html.includes('Barbell Back Squat'));
  assert.ok(html.includes('PROMPT-START'));
  assert.ok(html.includes('missing'), 'absent end frame is marked missing');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scripts/exercise-media && npx tsx --test src/contactSheet.test.ts`
Expected: FAIL — cannot find module `./contactSheet.js`.

- [ ] **Step 3: Implement the contact sheet**

`scripts/exercise-media/src/contactSheet.ts`:

```ts
export type SheetEntry = {
  slug: string;
  name: string;
  frames: { start?: string; end?: string }; // staging filenames
  prompts: { start?: string; end?: string };
};

/** Static review page written to staging/index.html — open in a browser, no server. */
export function renderContactSheet(entries: SheetEntry[]): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const cell = (file: string | undefined, prompt: string | undefined, label: string) =>
    file
      ? `<figure><img src="${file}" loading="lazy"><figcaption>${label}</figcaption>` +
        (prompt ? `<details><summary>prompt</summary><pre>${esc(prompt)}</pre></details>` : '') +
        `</figure>`
      : `<figure class="missing"><div class="ph">missing</div><figcaption>${label}</figcaption></figure>`;
  const rows = entries
    .map(
      (e) => `<section>
<h2>${esc(e.name)} <code>${e.slug}</code></h2>
<div class="pair">${cell(e.frames.start, e.prompts.start, 'start')}${cell(e.frames.end, e.prompts.end, 'end')}</div>
<p class="hint">regen: <code>npm run generate -- --slug ${e.slug} --force</code></p>
</section>`,
    )
    .join('\n');
  return `<!doctype html><meta charset="utf-8"><title>exercise-media review</title>
<style>
body{background:#0A0D12;color:#e8e8e8;font:14px/1.4 system-ui;margin:24px;max-width:1100px}
h2{font-size:15px}code{color:#4D8DFF;font-size:12px}
.pair{display:flex;gap:12px}figure{margin:0;flex:1}img{width:100%;border-radius:8px}
.ph{aspect-ratio:4/3;border:1px dashed #444;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#888}
figcaption{font-size:11px;color:#999;text-transform:uppercase;letter-spacing:1px;margin-top:4px}
details pre{white-space:pre-wrap;font-size:11px;color:#aaa}
.hint{color:#777;font-size:12px}section{margin-bottom:32px;border-bottom:1px solid #222;padding-bottom:16px}
</style>
<h1>exercise-media staging review (${entries.length} exercises)</h1>
${rows}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd scripts/exercise-media && npx tsx --test src/contactSheet.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the generate CLI**

`scripts/exercise-media/src/generate.ts`:

```ts
// Manual batch generator (spec §5). NEVER runs in CI. Usage:
//   npm run generate                       # all guides, both frames, skip existing
//   npm run generate -- --slug a,b --force # regenerate specific exercises
//   npm run generate -- --frame end        # one frame only
//   npm run generate -- --model gemini-3-pro-image-preview
//   npm run generate -- --dry-run          # print prompts, no API calls
//   npm run generate -- --smoke            # verify key + list image models + 1 test image
import fs from 'node:fs';
import path from 'node:path';
import { STAGING_DIR, STAGING_MANIFEST, CONTACT_SHEET, readGeminiKey } from './paths.js';
import { listExerciseInfo } from './data.js';
import { buildPrompt, type Frame } from './prompt.js';
import { positionOverrides, sceneOverrides } from './promptOverrides.js';
import { generateImage, listImageModels } from './gemini.js';
import { renderContactSheet, type SheetEntry } from './contactSheet.js';

const DEFAULT_MODEL = 'gemini-2.5-flash-image';
const CALL_SPACING_MS = 2000; // stay far from per-minute rate limits

type StagingManifest = Record<
  string, // "<slug>-<frame>"
  { model: string; generatedAt: string; prompt: string; file: string }
>;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const value = process.argv[i + 1];
  if (!value || value.startsWith('--')) throw new Error(`--${name} needs a value`);
  return value;
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function main(): Promise<void> {
  fs.mkdirSync(STAGING_DIR, { recursive: true });
  const model = arg('model') ?? DEFAULT_MODEL;

  if (has('smoke')) {
    const key = readGeminiKey();
    const models = await listImageModels(key);
    console.log(`key OK — image-capable models:\n  ${models.join('\n  ')}`);
    const img = await generateImage({ apiKey: key, model, prompt: 'A single black dumbbell on dark rubber gym flooring, photorealistic, no text.' });
    const out = path.join(STAGING_DIR, '_smoke.png');
    fs.writeFileSync(out, img.data);
    console.log(`smoke image written: ${out} (${img.data.length} bytes, ${img.mimeType})`);
    return;
  }

  const slugFilter = arg('slug')?.split(',').map((s) => s.trim());
  const frames: Frame[] = arg('frame') ? [arg('frame') as Frame] : ['start', 'end'];
  if (frames.some((f) => f !== 'start' && f !== 'end')) throw new Error('--frame must be start|end');

  const all = listExerciseInfo();
  const targets = slugFilter ? all.filter((e) => slugFilter.includes(e.slug)) : all;
  if (slugFilter && targets.length !== slugFilter.length) {
    const known = new Set(all.map((e) => e.slug));
    throw new Error(`unknown slug(s): ${slugFilter.filter((s) => !known.has(s)).join(', ')}`);
  }

  const manifest: StagingManifest = fs.existsSync(STAGING_MANIFEST)
    ? JSON.parse(fs.readFileSync(STAGING_MANIFEST, 'utf8'))
    : {};

  const work: Array<{ slug: string; name: string; frame: Frame; prompt: string; file: string }> = [];
  for (const ex of targets) {
    for (const frame of frames) {
      const file = `${ex.slug}-${frame}.png`;
      if (!has('force') && fs.existsSync(path.join(STAGING_DIR, file))) continue;
      work.push({
        slug: ex.slug,
        name: ex.name,
        frame,
        file,
        prompt: buildPrompt({
          name: ex.name,
          equipment: ex.equipment,
          setupCallout: ex.setupCallout,
          frame,
          positionOverride: positionOverrides[ex.slug]?.[frame],
          sceneOverride: sceneOverrides[ex.slug],
        }),
      });
    }
  }

  console.log(`${work.length} image(s) to generate with ${model} (${targets.length} exercises in scope)`);
  if (has('dry-run')) {
    for (const w of work) console.log(`\n===== ${w.file} =====\n${w.prompt}`);
    return;
  }

  const key = readGeminiKey();
  let done = 0;
  const failures: string[] = [];
  for (const w of work) {
    process.stdout.write(`[${++done}/${work.length}] ${w.file} … `);
    // Under --force, delete the old image BEFORE the attempt: if the regen
    // fails, a stale image lying around would be silently skipped by the next
    // plain re-run. A gap gets refilled; a stale file gets shipped.
    if (has('force')) fs.rmSync(path.join(STAGING_DIR, w.file), { force: true });
    try {
      const img = await generateImage({ apiKey: key, model, prompt: w.prompt });
      fs.writeFileSync(path.join(STAGING_DIR, w.file), img.data);
      manifest[`${w.slug}-${w.frame}`] = {
        model,
        generatedAt: new Date().toISOString(),
        prompt: w.prompt,
        file: w.file,
      };
      fs.writeFileSync(STAGING_MANIFEST, JSON.stringify(manifest, null, 2));
      console.log(`ok (${Math.round(img.data.length / 1024)} KB)`);
    } catch (err) {
      console.log('FAILED');
      console.error(`  ${(err as Error).message}`);
      failures.push(w.file);
    }
    await new Promise((r) => setTimeout(r, CALL_SPACING_MS));
  }

  // Rebuild the review sheet from everything currently staged.
  const entries: SheetEntry[] = all.map((ex) => ({
    slug: ex.slug,
    name: ex.name,
    frames: Object.fromEntries(
      (['start', 'end'] as const)
        .filter((f) => fs.existsSync(path.join(STAGING_DIR, `${ex.slug}-${f}.png`)))
        .map((f) => [f, `${ex.slug}-${f}.png`]),
    ),
    prompts: Object.fromEntries(
      (['start', 'end'] as const)
        .filter((f) => manifest[`${ex.slug}-${f}`])
        .map((f) => [f, manifest[`${ex.slug}-${f}`].prompt]),
    ),
  }));
  fs.writeFileSync(CONTACT_SHEET, renderContactSheet(entries));
  console.log(`\ncontact sheet: ${CONTACT_SHEET}`);
  if (failures.length) {
    console.error(`\n${failures.length} failure(s): ${failures.join(', ')} — re-run with the same flags to retry the gaps.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
```

- [ ] **Step 6: Verify the CLI end-to-end without spending**

Run: `cd scripts/exercise-media && npm run generate -- --dry-run --slug incline-dumbbell-bench-press`
Expected: prints 2 full prompts (start + end) containing the style block and the bench callout; exits 0. No network calls.

Run: `cd scripts/exercise-media && npm run generate -- --dry-run --slug outdoor-walking-z2`
Expected: prompts use the outdoor scene override, not the gym STYLE_BLOCK.

- [ ] **Step 7: Commit**

```bash
git add scripts/exercise-media/src/contactSheet.ts scripts/exercise-media/src/contactSheet.test.ts scripts/exercise-media/src/generate.ts
git commit -m "feat(media): generate CLI with staging manifest + review contact sheet"
```

---

### Task 6: WebP conversion + manifest module + promote CLI

**Files:**
- Create: `scripts/exercise-media/src/webp.ts`
- Create: `scripts/exercise-media/src/manifestModule.ts`
- Create: `scripts/exercise-media/src/promote.ts`
- Test: `scripts/exercise-media/src/webp.test.ts`
- Test: `scripts/exercise-media/src/manifestModule.test.ts`

- [ ] **Step 1: Write the failing tests**

`scripts/exercise-media/src/webp.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { convertToWebp, MAX_BYTES } from './webp.js';

async function makePng(dir: string, name: string, pixels: Buffer): Promise<string> {
  const p = path.join(dir, name);
  await sharp(pixels, { raw: { width: 1600, height: 1200, channels: 3 } }).png().toFile(p);
  return p;
}

test('a compressible image fits at the first quality rung', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webp-'));
  // Structured pattern → compresses well → q82 fits on the first try.
  const pattern = Buffer.alloc(1600 * 1200 * 3);
  for (let i = 0; i < pattern.length; i++) pattern[i] = (i * 2654435761) % 255;
  const src = await makePng(dir, 'in.png', pattern);

  const dest = path.join(dir, 'out.webp');
  const { bytes, quality } = await convertToWebp(src, dest);
  assert.ok(fs.existsSync(dest));
  assert.equal(bytes, fs.statSync(dest).size);
  assert.ok(bytes <= MAX_BYTES, `expected ≤${MAX_BYTES}, got ${bytes}`);
  assert.equal(quality, 82, 'compressible input should not descend the ladder');
  const meta = await sharp(dest).metadata();
  assert.equal(meta.format, 'webp');
  assert.ok((meta.width ?? 0) <= 1280);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('incompressible noise descends to the quality floor and commits with a warning', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webp-'));
  // True random noise never fits the budget even at q42 — exercises the
  // full ladder descent AND the give-up path.
  const src = await makePng(dir, 'noise.png', crypto.randomFillSync(Buffer.alloc(1600 * 1200 * 3)));

  const dest = path.join(dir, 'noise.webp');
  const { bytes, quality } = await convertToWebp(src, dest);
  assert.equal(quality, 42, 'should give up at the ladder floor');
  assert.ok(bytes > MAX_BYTES, 'noise cannot fit the budget — file written anyway');
  assert.ok(fs.existsSync(dest));
  fs.rmSync(dir, { recursive: true, force: true });
});
```

`scripts/exercise-media/src/manifestModule.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderManifestModule } from './manifestModule.js';

test('renders a sorted, always-expanded manifest module from webp filenames', () => {
  const out = renderManifestModule([
    'lat-pulldown-start.webp',
    'barbell-back-squat-end.webp',
    'barbell-back-squat-start.webp',
  ]);
  assert.ok(out.includes('GENERATED'));
  // Always-expanded entries: a one-line form would exceed prettier's
  // printWidth 100 and fail api's format:check on every regeneration.
  assert.ok(
    out.includes(
      "  'barbell-back-squat': {\n" +
        "    start: '/exercise-media/barbell-back-squat-start.webp',\n" +
        "    end: '/exercise-media/barbell-back-squat-end.webp',\n" +
        '  },',
    ),
  );
  assert.ok(
    out.includes(
      "  'lat-pulldown': {\n    start: '/exercise-media/lat-pulldown-start.webp',\n  },",
    ),
  );
  assert.ok(out.indexOf('barbell-back-squat') < out.indexOf('lat-pulldown'), 'sorted by slug');
});

test('rejects filenames that do not match the slug-frame contract', () => {
  assert.throws(() => renderManifestModule(['README.md']), /unexpected file/);
  assert.throws(() => renderManifestModule(['squat-side.webp']), /unexpected file/);
});

test('empty list renders an empty record', () => {
  assert.ok(renderManifestModule([]).includes('= {};'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd scripts/exercise-media && npx tsx --test src/webp.test.ts src/manifestModule.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`scripts/exercise-media/src/webp.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

export const MAX_BYTES = 400 * 1024; // spec §5: ~200–400 KB each
const TARGET_WIDTH = 1280; // 4:3 → 1280×960
const QUALITIES = [82, 72, 62, 52, 42];

/** PNG → WebP, stepping quality down until the file fits the budget. */
export async function convertToWebp(
  srcPath: string,
  destPath: string,
): Promise<{ bytes: number; quality: number }> {
  for (const [i, quality] of QUALITIES.entries()) {
    const buf = await sharp(srcPath)
      .resize({ width: TARGET_WIDTH, withoutEnlargement: true })
      .webp({ quality })
      .toBuffer();
    const isLast = i === QUALITIES.length - 1;
    if (buf.length <= MAX_BYTES || isLast) {
      if (buf.length > MAX_BYTES) {
        console.warn(
          `WARN ${path.basename(destPath)}: ${buf.length} bytes still exceeds ${MAX_BYTES} at q${quality} — committing anyway, consider regenerating a simpler image.`,
        );
      }
      fs.writeFileSync(destPath, buf);
      return { bytes: buf.length, quality };
    }
  }
  throw new Error('unreachable');
}
```

`scripts/exercise-media/src/manifestModule.ts`:

```ts
export const FILE_RE = /^([a-z0-9-]+)-(start|end)\.webp$/;

/**
 * Renders api/src/seed/exerciseMediaManifest.ts from the list of committed
 * webp filenames. The committed files are the source of truth; this module is
 * regenerated (never hand-edited) so the manifest can't drift from disk.
 * Entries are ALWAYS expanded (one field per line): a one-line entry is ~160
 * chars, which fails prettier printWidth 100 in api's format:check on every
 * regeneration. Prettier preserves expanded object literals, so this shape is
 * stable under `prettier --check`.
 */
export function renderManifestModule(webpFiles: string[]): string {
  const bySlug = new Map<string, { start?: string; end?: string }>();
  for (const f of [...webpFiles].sort()) {
    const m = f.match(FILE_RE);
    if (!m) throw new Error(`unexpected file in exercise-media: ${f}`);
    const [, slug, frame] = m;
    const entry = bySlug.get(slug) ?? {};
    entry[frame as 'start' | 'end'] = `/exercise-media/${slug}-${frame}.webp`;
    bySlug.set(slug, entry);
  }
  const body = [...bySlug.entries()]
    .map(([slug, media]) => {
      const fields: string[] = [];
      if (media.start) fields.push(`    start: '${media.start}',`);
      if (media.end) fields.push(`    end: '${media.end}',`);
      return `  '${slug}': {\n${fields.join('\n')}\n  },`;
    })
    .join('\n');
  const record = body ? `{\n${body}\n}` : '{}';
  return `// GENERATED by scripts/exercise-media (promote) — do not edit by hand.
// Source of truth: the committed files in frontend/public/exercise-media/.
// api/tests/seed/exerciseMediaManifest.test.ts enforces both directions.

export const exerciseMedia: Record<string, { start?: string; end?: string }> = ${record};
`;
}
```

`scripts/exercise-media/src/promote.ts`:

```ts
// Promote approved staging images to the repo. Usage:
//   npm run promote -- --slug barbell-back-squat,lat-pulldown
//   npm run promote -- --all
// Converts staging PNGs → frontend/public/exercise-media/*.webp, then rebuilds
// api/src/seed/exerciseMediaManifest.ts by scanning that folder.
import fs from 'node:fs';
import path from 'node:path';
import { STAGING_DIR, MEDIA_DIR, SEED_MANIFEST } from './paths.js';
import { listExerciseInfo } from './data.js';
import { convertToWebp } from './webp.js';
import { renderManifestModule, FILE_RE } from './manifestModule.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const value = process.argv[i + 1];
  if (!value || value.startsWith('--')) throw new Error(`--${name} needs a value`);
  return value;
}

async function main(): Promise<void> {
  const known = new Set(listExerciseInfo().map((e) => e.slug));
  const slugs = process.argv.includes('--all')
    ? [...known].filter((s) =>
        (['start', 'end'] as const).some((f) => fs.existsSync(path.join(STAGING_DIR, `${s}-${f}.png`))),
      )
    : arg('slug')?.split(',').map((s) => s.trim()) ?? [];
  if (slugs.length === 0) throw new Error('nothing to promote: pass --slug a,b or --all');
  const unknown = slugs.filter((s) => !known.has(s));
  if (unknown.length) throw new Error(`unknown slug(s): ${unknown.join(', ')}`);

  // Validate everything BEFORE converting anything: a mid-loop throw would
  // leave orphan WebPs on disk with no manifest regeneration (the api
  // invariant test catches it and a re-run heals, but fail fast instead).
  for (const slug of slugs) {
    const staged = (['start', 'end'] as const).filter((f) =>
      fs.existsSync(path.join(STAGING_DIR, `${slug}-${f}.png`)),
    );
    if (staged.length === 0) throw new Error(`${slug}: nothing staged to promote`);
    if (staged.length === 1) console.warn(`WARN ${slug}: only the ${staged[0]} frame is staged`);
  }

  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  for (const slug of slugs) {
    for (const frame of ['start', 'end'] as const) {
      const src = path.join(STAGING_DIR, `${slug}-${frame}.png`);
      if (!fs.existsSync(src)) continue;
      const dest = path.join(MEDIA_DIR, `${slug}-${frame}.webp`);
      const { bytes, quality } = await convertToWebp(src, dest);
      console.log(`${slug}-${frame}.webp  ${Math.round(bytes / 1024)} KB (q${quality})`);
    }
  }

  const files = fs.readdirSync(MEDIA_DIR).filter((f) => FILE_RE.test(f));
  fs.writeFileSync(SEED_MANIFEST, renderManifestModule(files));
  console.log(`manifest rebuilt: ${SEED_MANIFEST} (${files.length} files)`);
  console.log('next: cd api && npm run format:check   # manifest must satisfy prettier');
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd scripts/exercise-media && npm test`
Expected: PASS — all module tests across Tasks 2–6.

- [ ] **Step 5: Commit**

```bash
git add scripts/exercise-media/src/webp.ts scripts/exercise-media/src/webp.test.ts scripts/exercise-media/src/manifestModule.ts scripts/exercise-media/src/manifestModule.test.ts scripts/exercise-media/src/promote.ts
git commit -m "feat(media): promote CLI — WebP quality ladder + generated seed manifest"
```

---

### Task 7: API seed merge + invariant tests

**Files:**
- Create: `api/src/seed/exerciseMediaManifest.ts`
- Modify: `api/src/seed/exerciseGuides.ts` (the array declaration + a merged export at the very bottom)
- Modify: `api/tests/seed/exerciseGuideContent.test.ts` (the W2 "media stays empty until W3" assertion — it fails the moment real photos promote)
- Test: `api/tests/seed/exerciseMediaManifest.test.ts`

- [ ] **Step 1: Write the failing test**

`api/tests/seed/exerciseMediaManifest.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exerciseMedia } from '../../src/seed/exerciseMediaManifest.js';
import { exercises } from '../../src/seed/exercises.js';
import { exerciseGuides } from '../../src/seed/exerciseGuides.js';

// api/tests/seed → repo root is three levels up
const MEDIA_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../frontend/public/exercise-media',
);

describe('exerciseMediaManifest invariants', () => {
  const slugs = new Set(exercises.map((e) => e.slug));

  it('every manifest key is a known exercise slug', () => {
    for (const key of Object.keys(exerciseMedia)) {
      expect(slugs.has(key), `unknown slug in manifest: ${key}`).toBe(true);
    }
  });

  it('every manifest path follows the /exercise-media/<slug>-<frame>.webp contract and exists on disk', () => {
    for (const [slug, media] of Object.entries(exerciseMedia)) {
      for (const frame of ['start', 'end'] as const) {
        const p = media[frame];
        if (!p) continue;
        expect(p).toBe(`/exercise-media/${slug}-${frame}.webp`);
        const onDisk = path.join(MEDIA_DIR, `${slug}-${frame}.webp`);
        expect(fs.existsSync(onDisk), `missing file for manifest entry: ${onDisk}`).toBe(true);
      }
    }
  });

  it('every committed webp file appears in the manifest (no orphans)', () => {
    const files = fs.existsSync(MEDIA_DIR)
      ? fs.readdirSync(MEDIA_DIR).filter((f) => f.endsWith('.webp'))
      : [];
    for (const f of files) {
      const m = f.match(/^([a-z0-9-]+)-(start|end)\.webp$/);
      expect(m, `unexpected filename in exercise-media: ${f}`).toBeTruthy();
      const [, slug, frame] = m!;
      expect(
        exerciseMedia[slug]?.[frame as 'start' | 'end'],
        `orphan file not in manifest: ${f} — re-run promote`,
      ).toBe(`/exercise-media/${f}`);
    }
  });

  it('the exported guide seed carries exactly the manifest media — {} otherwise', () => {
    // Both directions: manifest entries flow through, and hand-authored media
    // can't sneak into authoredGuides (content diffs stay clean).
    for (const g of exerciseGuides) {
      expect(g.media).toEqual(exerciseMedia[g.exercise_slug] ?? {});
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/seed/exerciseMediaManifest.test.ts`
Expected: FAIL — `exerciseMediaManifest.js` does not exist.

- [ ] **Step 3: Create the empty manifest + merge**

`api/src/seed/exerciseMediaManifest.ts` (initial committed state — regenerated by promote in Task 10):

```ts
// GENERATED by scripts/exercise-media (promote) — do not edit by hand.
// Source of truth: the committed files in frontend/public/exercise-media/.
// api/tests/seed/exerciseMediaManifest.test.ts enforces both directions.

export const exerciseMedia: Record<string, { start?: string; end?: string }> = {};
```

In `api/src/seed/exerciseGuides.ts`, make two edits:

1. Add the import under the existing type import at the top, and rename the exported array to `authoredGuides` (drop `export`):

```ts
import type { ExerciseGuideSeed } from '../schemas/exerciseGuide.js';
import { exerciseMedia } from './exerciseMediaManifest.js';

const authoredGuides: ExerciseGuideSeed[] = [
```

2. At the very bottom of the file, after the closing `];`, add:

```ts
// W3: media comes from the generated manifest (committed photos), not authored
// prose. Authored entries keep `media: {}` so content review diffs stay clean.
// KEEP THIS FILE FREE OF OTHER RUNTIME IMPORTS: scripts/exercise-media imports
// it across the package boundary and must not need api/node_modules.
export const exerciseGuides: ExerciseGuideSeed[] = authoredGuides.map((g) => ({
  ...g,
  media: exerciseMedia[g.exercise_slug] ?? g.media,
}));
```

Also update the header comment's "media stays {} until W3" line to: `// media is merged from ./exerciseMediaManifest.ts (generated by scripts/exercise-media).`

3. In `api/tests/seed/exerciseGuideContent.test.ts`, replace the W2-era assertion (lines ~32–36):

```ts
it('media stays empty until W3 lands photos', () => {
  for (const g of exerciseGuides) {
    expect(g.media).toEqual({});
  }
});
```

with (add `import { exerciseMedia } from '../../src/seed/exerciseMediaManifest.js';` to the imports):

```ts
it('media is {} without a manifest entry, and exactly the manifest entry with one', () => {
  for (const g of exerciseGuides) {
    expect(g.media).toEqual(exerciseMedia[g.exercise_slug] ?? {});
  }
});
```

Without this, the old assertion stays green through Task 7 (the manifest starts empty — a hidden time bomb) and then red-gates the `api-unit` required check the moment Task 11 promotes real photos.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/seed/`
Expected: PASS — new manifest tests green (vacuously, manifest is empty) AND the updated `exerciseGuideContent.test.ts` suite green.

- [ ] **Step 5: Full api gate**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx tsc --noEmit && npm run lint && npm run format:check && npm test`
Expected: all green (CI's typecheck-api job runs lint+prettier too — memory `reference_ci_api_gates_d10_migration`).

- [ ] **Step 6: Commit**

```bash
git add api/src/seed/exerciseMediaManifest.ts api/src/seed/exerciseGuides.ts api/tests/seed/exerciseMediaManifest.test.ts
git commit -m "feat(api): merge generated media manifest into exercise_guides seed"
```

---

### Task 8: Frontend fact-chip formatter

**Files:**
- Create: `frontend/src/lib/setupFactLabels.ts`
- Test: `frontend/src/lib/setupFactLabels.test.ts`

- [ ] **Step 1: Write the failing test**

`frontend/src/lib/setupFactLabels.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatSetupFacts, overlaySetupFactChips } from './setupFactLabels';

describe('formatSetupFacts', () => {
  it('renders degree facts with the ° symbol', () => {
    expect(formatSetupFacts({ bench_angle_deg: 30 })).toEqual(['bench 30°']);
    expect(formatSetupFacts({ toe_angle_deg: 20 })).toEqual(['toe 20°']);
  });

  it('renders string facts as label: value', () => {
    expect(formatSetupFacts({ stance: 'shoulder-width' })).toEqual(['stance: shoulder-width']);
    expect(formatSetupFacts({ grip_width: 'just outside shoulders' })).toEqual([
      'grip width: just outside shoulders',
    ]);
  });

  it('renders plain numeric facts without a unit', () => {
    expect(formatSetupFacts({ notch: 2 })).toEqual(['notch 2']);
  });

  it('preserves authoring order across multiple facts', () => {
    expect(formatSetupFacts({ toe_angle_deg: 20, stance: 'shoulder-width' })).toEqual([
      'toe 20°',
      'stance: shoulder-width',
    ]);
  });

  it('returns [] for no facts', () => {
    expect(formatSetupFacts({})).toEqual([]);
  });

  it('overlay chips keep numeric facts only — prose facts duplicate the callout', () => {
    expect(overlaySetupFactChips({ bench_angle_deg: 30, stance: 'shoulder-width' })).toEqual([
      'bench 30°',
    ]);
  });

  it('overlay chips suppress zero-degree facts ("bench 0°" reads odd — flat is the callout\'s job)', () => {
    expect(overlaySetupFactChips({ bench_angle_deg: 0 })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npx vitest run src/lib/setupFactLabels.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`frontend/src/lib/setupFactLabels.ts`:

```ts
/**
 * setup_facts → annotation chip strings for the setup-card photo overlay
 * (spec §5: annotations are app-rendered, never baked into images).
 * `bench_angle_deg: 30` → "bench 30°"; `stance: 'shoulder-width'` → "stance: shoulder-width".
 * Chips render uppercase via CSS; keep these lowercase and short.
 */
export function formatSetupFacts(facts: Record<string, number | string>): string[] {
  return Object.entries(facts).map(([key, value]) => {
    const isDegrees = /_deg$/.test(key);
    const label = key.replace(/_angle_deg$|_deg$/, '').replace(/_/g, ' ');
    if (typeof value === 'number') return isDegrees ? `${label} ${value}°` : `${label} ${value}`;
    return `${label}: ${value}`;
  });
}

/**
 * Chips suitable for overlaying ON the photo: short numeric facts only.
 * Real seed data has sentence-length string facts ("just above the heels") —
 * as overlay chips those bury the lower third of the photo and duplicate the
 * setup callout rendered directly beneath. Zero-degree facts are suppressed:
 * "bench 0°" is technically true but reads odd; the callout says "flat".
 */
export function overlaySetupFactChips(facts: Record<string, number | string>): string[] {
  const numeric = Object.entries(facts).filter(
    ([key, value]) => typeof value === 'number' && !(value === 0 && /_deg$/.test(key)),
  );
  return formatSetupFacts(Object.fromEntries(numeric));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npx vitest run src/lib/setupFactLabels.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/setupFactLabels.ts frontend/src/lib/setupFactLabels.test.ts
git commit -m "feat(frontend): setup_facts → annotation chip formatter"
```

---

### Task 9: SetupCardSheet photo block — img, chips, Start/End toggle

**Files:**
- Modify: `frontend/src/components/programs/logger/SetupCardSheet.tsx` (photo slot, lines ~145–174, plus imports)
- Test: `frontend/src/components/programs/logger/SetupCardSheet.test.tsx` (extend)

- [ ] **Step 1: Write the failing tests**

Append to `SetupCardSheet.test.tsx` (keep the existing `GUIDE` const; all current tests must stay green — the `media: {}` placeholder behavior is unchanged):

```tsx
const MEDIA_GUIDE: ExerciseGuide = {
  ...GUIDE,
  media: {
    start: '/exercise-media/incline-dumbbell-bench-press-start.webp',
    end: '/exercise-media/incline-dumbbell-bench-press-end.webp',
  },
};

describe('SetupCardSheet photos (W3)', () => {
  it('renders the start photo with annotation chips instead of the placeholder', () => {
    render(
      <SetupCardSheet
        exerciseName="Incline DB Bench Press"
        guide={MEDIA_GUIDE}
        onClose={() => {}}
      />,
    );
    const img = screen.getByRole('img', { name: /start position/i });
    expect(img).toHaveAttribute('src', MEDIA_GUIDE.media.start);
    expect(screen.getByText('bench 30°')).toBeInTheDocument();
    expect(screen.queryByTestId('setup-photo-placeholder')).not.toBeInTheDocument();
  });

  it('toggles between start and end frames', () => {
    render(
      <SetupCardSheet
        exerciseName="Incline DB Bench Press"
        guide={MEDIA_GUIDE}
        onClose={() => {}}
      />,
    );
    const endBtn = screen.getByRole('button', { name: /end/i });
    expect(endBtn).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(endBtn);
    expect(endBtn).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('img', { name: /end position/i })).toHaveAttribute(
      'src',
      MEDIA_GUIDE.media.end,
    );
  });

  it('shows no toggle when only the start frame exists', () => {
    render(
      <SetupCardSheet
        exerciseName="X"
        guide={{ ...GUIDE, media: { start: '/exercise-media/x-start.webp' } }}
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole('img', { name: /start position/i })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /setup photo/i })).not.toBeInTheDocument();
  });

  it('image load failure shows "Photo unavailable" but keeps the toggle usable', () => {
    render(<SetupCardSheet exerciseName="X" guide={MEDIA_GUIDE} onClose={() => {}} />);
    fireEvent.error(screen.getByRole('img', { name: /start position/i }));
    expect(screen.getByText(/photo unavailable/i)).toBeInTheDocument();
    // Recovery path: the toggle stays mounted; picking a frame retries the img.
    const endBtn = screen.getByRole('button', { name: /end/i });
    fireEvent.click(endBtn);
    expect(screen.getByRole('img', { name: /end position/i })).toHaveAttribute(
      'src',
      MEDIA_GUIDE.media.end,
    );
  });

  it('overlays only numeric facts — prose facts stay out of the photo', () => {
    render(
      <SetupCardSheet
        exerciseName="X"
        guide={{ ...MEDIA_GUIDE, setup_facts: { stance: 'shoulder-width' } }}
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole('img', { name: /start position/i })).toBeInTheDocument();
    expect(screen.queryByText('stance: shoulder-width')).not.toBeInTheDocument();
    expect(screen.queryByText('bench 30°')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npx vitest run src/components/programs/logger/SetupCardSheet.test.tsx`
Expected: existing 4 tests PASS, the 5 new ones FAIL (img renders without frame alt text / no chips / no toggle).

- [ ] **Step 3: Implement the photo block**

In `SetupCardSheet.tsx`:

1. Change the react import and add the formatter import:

```tsx
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { TOKENS, FONTS } from '../../../tokens';
import { overlaySetupFactChips } from '../../../lib/setupFactLabels';
import type { ExerciseGuide } from '../../../lib/api/exerciseGuide';
```

2. Add state + derived values at the top of the component body (after the existing refs):

```tsx
const [frame, setFrame] = useState<'start' | 'end'>('start');
const [imgFailed, setImgFailed] = useState(false);
const availableFrames = (['start', 'end'] as const).filter((f) => guide.media[f]);
const activeFrame = availableFrames.includes(frame) ? frame : availableFrames[0];
const photoSrc = activeFrame ? guide.media[activeFrame] : undefined;
const factChips = overlaySetupFactChips(guide.setup_facts);
```

3. Replace the whole existing photo block (the `{guide.media.start ? (…) : (…)}` conditional) with:

```tsx
{/* Photo block — committed WebP + app-rendered annotation chips (spec §5).
    Annotations are never baked into images. On load failure the placeholder
    replaces only the image — the frame toggle stays mounted so picking a
    frame retries — and the copy is honest ("unavailable", not "coming
    soon"). Failure copy is AT-visible; the decorative no-photo placeholder
    stays aria-hidden. */}
<div>
  {photoSrc && !imgFailed ? (
    <div style={{ position: 'relative' }}>
      <img
        src={photoSrc}
        alt={`${exerciseName} — ${activeFrame} position`}
        onError={() => setImgFailed(true)}
        style={{
          width: '100%',
          aspectRatio: '4 / 3',
          objectFit: 'cover',
          borderRadius: 12,
          display: 'block',
        }}
      />
      {factChips.length > 0 && (
        <div
          style={{
            position: 'absolute',
            left: 8,
            bottom: 8,
            right: 8,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
          }}
        >
          {factChips.map((chip) => (
            <span
              key={chip}
              style={{
                background: 'rgba(10,13,18,0.78)',
                border: `1px solid ${TOKENS.line}`,
                borderRadius: 6,
                padding: '3px 8px',
                fontFamily: FONTS.mono,
                fontSize: 10,
                letterSpacing: 1,
                textTransform: 'uppercase',
                color: TOKENS.text,
              }}
            >
              {chip}
            </span>
          ))}
        </div>
      )}
    </div>
  ) : (
    <div
      data-testid="setup-photo-placeholder"
      aria-hidden={imgFailed ? undefined : true}
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
      {imgFailed ? 'Photo unavailable' : 'Photo coming soon'}
    </div>
  )}
  {availableFrames.length === 2 && (
    <div role="group" aria-label="Setup photo" style={{ display: 'flex', gap: 6, marginTop: 8 }}>
      {availableFrames.map((f) => (
        <button
          key={f}
          type="button"
          aria-pressed={activeFrame === f}
          onClick={() => {
            setFrame(f);
            setImgFailed(false);
          }}
          style={{
            flex: 1,
            minHeight: 44,
            borderRadius: 6,
            border: `1px solid ${activeFrame === f ? TOKENS.accent : TOKENS.line}`,
            background: activeFrame === f ? 'rgba(77,141,255,0.12)' : 'transparent',
            color: activeFrame === f ? TOKENS.accent : TOKENS.textDim,
            fontFamily: FONTS.mono,
            fontSize: 10,
            letterSpacing: 1,
            textTransform: 'uppercase',
            cursor: 'pointer',
          }}
        >
          {f === 'start' ? 'Start' : 'End'}
        </button>
      ))}
    </div>
  )}
</div>
```

(Mobile is the live-workout surface — the 44px `minHeight` on the toggle matches the sheet's Close button; 25px targets under a mid-set thumb are a miss. The toggle deliberately lives OUTSIDE the failed/loaded conditional so a 404 on one frame can't strand the user with no recovery path.)

Also update the component's header comment `// W2: media is always {} …` to describe W3 reality (photos + chips + toggle, placeholder as fallback).

- [ ] **Step 4: Run the component tests**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npx vitest run src/components/programs/logger/SetupCardSheet.test.tsx`
Expected: PASS — all 9 (4 existing + 5 new).

- [ ] **Step 5: Full frontend gate**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npm run validate`
Expected: all green (tsc, eslint, prettier, vitest, term-coverage, page-reachability, tz-sync). The chips are plain-language facts, not new terms-of-art, so `check-term-coverage` needs no new tooltip entries; "Start/End" are plain words.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/programs/logger/SetupCardSheet.tsx frontend/src/components/programs/logger/SetupCardSheet.test.tsx
git commit -m "feat(frontend): setup-card photos — annotation chips + start/end toggle"
```

---

### Task 10: Pilot batch — settle model + style block (OPERATOR — user in the loop)

**Prereqs:** Tasks 1–9 merged into the working branch; user present; repo-root `.env` has `GEMINI_API_KEY`.

- [ ] **Step 1: Smoke-test the key and model ids**

Run: `cd scripts/exercise-media && npm run generate -- --smoke`
Expected: prints image-capable model ids and writes `staging/_smoke.png`. If it 401/403s, the key was rotated — stop and ask the user for a fresh key. If the model id differs from `gemini-2.5-flash-image` / `gemini-3-pro-image-preview`, use what the listing shows and update `DEFAULT_MODEL`.

- [ ] **Step 2: Generate the pilot on both candidate models**

Pilot covers the three prompt archetypes: bench-angle equipment (`incline-dumbbell-bench-press`), rack complexity (`barbell-back-squat`), and the outdoor scene override (`outdoor-walking-z2`).

```bash
cd scripts/exercise-media
npm run generate -- --slug incline-dumbbell-bench-press,barbell-back-squat,outdoor-walking-z2
mv staging staging-flash && mkdir staging
npm run generate -- --slug incline-dumbbell-bench-press,barbell-back-squat,outdoor-walking-z2 --model gemini-3-pro-image-preview
mv staging staging-pro && mv staging-flash staging
```

(≈12 images total, < $2.)

- [ ] **Step 3: User reviews both sets**

Open `staging/index.html` and `staging-pro/index.html`. The user judges: athlete consistency across images, anatomical plausibility mid-exercise, absence of garbled text/logos, equipment correctness (is the bench actually at ~30°?).

- [ ] **Step 4: Record the decision**

Update `DEFAULT_MODEL` in `generate.ts` to the winner; delete the loser's staging folder; append the choice + one line of reasoning to the spec's "Open items" section (this closes the spec's empirical open item). Tune `STYLE_BLOCK` wording if the pilot exposed drift (different athlete per image, cluttered background), then regenerate the pilot slugs with `--force` to confirm the fix before scaling to 44.

- [ ] **Step 5: Commit**

```bash
git add scripts/exercise-media/src/generate.ts scripts/exercise-media/src/prompt.ts docs/superpowers/specs/2026-07-06-workout-logging-redesign-design.md
git commit -m "feat(media): pin image model + tuned style block from pilot batch"
```

---

### Task 11: Full batch, review loop, promote, ship (OPERATOR — user in the loop)

- [ ] **Step 1: Generate all 44 exercises**

Run: `cd scripts/exercise-media && npm run generate`
Expected: ~88 images into `staging/` (pilot images already present are skipped), contact sheet rebuilt. Failures are listed at the end; re-running retries only the gaps.

- [ ] **Step 2: Review loop until the user approves**

User works through `staging/index.html`. For each miss: add/adjust the slug's entry in `promptOverrides.ts` (position wording) or `sceneOverrides` (wrong environment), then `npm run generate -- --slug <slug> --force`. Repeat until approved. Track rejected-but-shippable-later slugs — partial coverage is fine, the placeholder remains for anything unpromoted.

- [ ] **Step 3: Promote approved slugs**

```bash
cd scripts/exercise-media
npm run promote -- --all        # or --slug <approved-list> for partial approval
cd ../../api && npm run format:check   # generated manifest must satisfy prettier; `npm run format` if not
```

Expected: WebP files in `frontend/public/exercise-media/` (each logged with size + quality), `api/src/seed/exerciseMediaManifest.ts` rebuilt.

- [ ] **Step 4: Full verification on both sides**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx tsc --noEmit && npm run lint && npm run format:check && npm test
cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npm run validate
cd /Users/jasonmeyer.ict/Projects/RepOS/scripts/exercise-media && npm test
```

Expected: all green. The manifest invariant tests now do real work: every entry has a file, every file has an entry.

- [ ] **Step 5: Eyeball it in the real app (verify skill applies)**

Run the dev stack, open the logger on a mobile viewport, tap ⓘ on an exercise with photos: photo renders, chips read correctly (e.g. `BENCH 30°`), Start/End toggles, an exercise without photos still shows the placeholder. Per memory `reference_test_db_cruft`: if local api tests flaked on programs fixtures, reset the local test DB rather than chasing code.

- [ ] **Step 6: Commit images + manifest, push, PR**

```bash
git add frontend/public/exercise-media api/src/seed/exerciseMediaManifest.ts scripts/exercise-media/src/promptOverrides.ts
git commit -m "feat(media): commit approved exercise photos (WebP) + regenerated manifest"
git push -u origin feat/w3-exercise-photos
gh pr create --title "feat: exercise photos — Gemini pipeline + setup-card wiring (redesign wave 3)" --body "…"
```

PR body must note: docker image grows ~25–35 MB from committed WebP files; the pipeline package never runs in CI; model + style block decision from the pilot. All 8 required checks must pass (branch protection).

- [ ] **Step 7: Reviewer matrix before merge**

Per `feedback_get_plan_reviewed` / ship-clean: dispatch frontend + backend reviewer passes on the PR diff; land every Critical + Important finding before merge (no v1.5 backlog — `feedback_ship_clean`).

- [ ] **Step 8: Merge + deploy + live verify**

After user approval: squash-merge, then `ssh unraid /mnt/user/appdata/repos/repos-redeploy.sh` (memory `reference_unraid_redeploy`; requires LAN). Verify:

1. Outside-in: `curl -sI https://repos.jpmtech.com` → 302 to CF Access.
2. In-container: guide rows carry media. The quoting only survives ONE shell parse — run these as two steps (memory `feedback_command_pasting`), never as a single pasted `ssh unraid docker exec …` line:

   Step 1 — open a shell on the Unraid host:

   ```bash
   ssh unraid
   ```

   Step 2 — on the Unraid host, run:

   ```bash
   docker exec RepOS sh -lc 's6-setuidgid postgres /usr/bin/psql -h /tmp -U postgres -d "$POSTGRES_DB" -tAc "select count(*) from exercise_guides where media::text <> '"'"'{}'"'"' and archived_at is null"'
   ```

   Expected: equals the promoted-slug count.
3. On-phone (user): open ⓘ on TODAY → photo + chips render; also re-verify the W2 pending item (a set log returns 201/locked) if not yet done.

---

## Self-review notes

- **Spec coverage:** §5 generation (Tasks 3–5), review loop (Tasks 5, 10–11), WebP storage + same-origin (Tasks 6, 11), annotations-never-baked (Tasks 8–9), model open-item (Task 10). §4 photo-in-card (Task 9). Phasing W3 "wire into setup card with annotation overlay" (Tasks 7–9).
- **Contracts honored:** path shape `/exercise-media/<slug>-<frame>.webp` matches the W2 schema comment and `ExerciseGuideSeedSchema.media`; seed adapter and `GET /:slug/guide` need zero changes (media already flows through); prod picks the new seed up on container start.
- **Deliberate scope cuts:** no exercise-library surface for guides (spec out-of-scope), no video, no per-image alt-text authoring (frame-position alt is sufficient v1), no service-worker precache of images.
- **Type consistency check:** `Frame`/`'start'|'end'` union used consistently across prompt.ts, generate.ts, manifestModule.ts, SetupCardSheet; `ExerciseGuide.media {start?, end?}` matches api `ExerciseGuideResponse`.

## Plan review log (2026-07-07, pre-execution)

Three specialist reviewers (frontend, backend/seed, pipeline tooling) ran against the draft; every Critical + Important finding is folded into the tasks above:

- **Frontend:** fixed a false-failing test assertion (`/°/` matched the setup callout), moved the Start/End toggle outside the image-failure conditional so a 404'd frame has a recovery path (+ honest "Photo unavailable" copy, AT-visible), 44px toggle touch targets, and overlay chips restricted to numeric facts via `overlaySetupFactChips` (prose facts duplicated the callout and buried the photo; zero-degree facts suppressed).
- **Backend/seed:** Task 7 now updates the W2 `media stays empty until W3` test (it would have red-gated `api-unit` at promote time); the seed↔manifest invariant asserts both directions (`?? {}`); the prod psql verify is a two-step ssh recipe.
- **Pipeline:** manifest module emits always-expanded entries (one-line form failed prettier `printWidth: 100` on every regeneration); `responseModalities: ['TEXT','IMAGE']` (IMAGE-only has a 400 history on image models); network-level fetch failures retry with the same backoff as 429/5xx; `scripts/exercise-media/` added to `.dockerignore` (Dockerfile COPYs all of `scripts/`); `listImageModels` filters out `:predict`-only `imagen-*` ids; promote validates all slugs before converting; forced regens delete the old staging file first; webp tests pin both the first-rung and give-up paths.

Reviewer-verified (no action needed): cross-package tsx import runs with zero api runtime deps; CI jobs can't see the tooling package; api tests reading `frontend/public` work under CI's full checkout; seed hash changes re-apply media on container start; no migration needed (080 already has `media JSONB`); FILE_RE is safe for all 48 slugs; term-coverage needs no new tooltip entries.
