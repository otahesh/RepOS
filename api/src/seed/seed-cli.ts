// File: api/src/seed/seed-cli.ts
// Production seed entry point. Idempotent — `_seed_meta` hash check skips
// re-runs when entries are unchanged. Exits 0 on apply or skip, non-zero
// on failure (validation error, DB error). Wired into the container init
// chain (s6 oneshot `init-seed` after `init-migrations`).

import { db } from '../db/client.js';
import { runSeed } from './runSeed.js';
import { exercises } from './exercises.js';
import { makeExerciseSeedAdapter } from './adapters/exercises.js';
import { programTemplates } from './programTemplates.js';
import { makeProgramTemplateAdapter } from './adapters/programTemplates.js';

async function main(): Promise<void> {
  const exResult = await runSeed({
    key: 'exercises',
    entries: exercises,
    adapter: makeExerciseSeedAdapter('exercises'),
  });
  console.log('exercises:', JSON.stringify(exResult));

  // Cardio slugs follow the seed authoring convention: movement_pattern === 'gait'.
  // Derive from the seed entries (not the DB) so the CLI is self-consistent
  // regardless of archived rows lingering from prior seed generations.
  const knownSlugs = new Set(exercises.map((e) => e.slug));
  const cardioSlugs = new Set(
    exercises.filter((e) => e.movement_pattern === 'gait').map((e) => e.slug),
  );

  const tplResult = await runSeed({
    key: 'program_templates',
    entries: programTemplates,
    adapter: makeProgramTemplateAdapter(knownSlugs, cardioSlugs),
  });
  console.log('program_templates:', JSON.stringify(tplResult));
}

main()
  .then(() => db.end())
  .catch(async (err) => {
    console.error('seed failed:', err);
    await db.end();
    process.exit(1);
  });
