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
