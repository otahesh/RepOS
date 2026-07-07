// Pure content test — no DB. Guards the "all 44 exercises get authored
// content" spec requirement and keeps future seed-exercise additions honest:
// adding an exercise without a guide fails here, not in production.
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { exercises } from '../../src/seed/exercises.js';
import { exerciseGuides } from '../../src/seed/exerciseGuides.js';
import { exerciseMedia } from '../../src/seed/exerciseMediaManifest.js';
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

  it('media is {} without a manifest entry, and exactly the manifest entry with one', () => {
    for (const g of exerciseGuides) {
      expect(g.media).toEqual(exerciseMedia[g.exercise_slug] ?? {});
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
