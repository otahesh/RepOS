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
  cues: [
    'Pinch your shoulder blades',
    'Lower to the outside of your chest',
    'Press up and slightly in',
  ],
  donts: ['Setting the bench too steep', 'Bouncing the weights off your chest'],
  media: {},
};

beforeAll(async () => {
  // Crash-cruft pre-clean: a killed prior run can leave the fixture exercise
  // behind (shared repos_test DB) — clear it before inserting.
  await db.query(`DELETE FROM exercises WHERE slug=$1`, [SLUG]);
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
  it('rejects a guide referencing an unknown exercise slug', () => {
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
