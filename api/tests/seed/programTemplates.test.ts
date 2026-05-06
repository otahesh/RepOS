import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/db/client.js';
import { runSeed } from '../../src/seed/runSeed.js';
import { makeProgramTemplateAdapter } from '../../src/seed/adapters/programTemplates.js';
import { programTemplates } from '../../src/seed/programTemplates.js';

async function loadKnownSlugs() {
  const all = (await db.query<{ slug: string }>(`SELECT slug FROM exercises WHERE archived_at IS NULL`)).rows.map(r => r.slug);
  const cardio = (await db.query<{ slug: string }>(`SELECT slug FROM exercises WHERE archived_at IS NULL AND movement_pattern='gait'`)).rows.map(r => r.slug);
  return { all: new Set(all), cardio: new Set(cardio) };
}

beforeAll(async () => {
  await db.query(`DELETE FROM program_templates WHERE seed_key='program_templates'`);
  await db.query(`DELETE FROM _seed_meta WHERE key='program_templates'`);
});
afterAll(async () => { await db.end(); });

describe('program_templates seed (e2e)', () => {
  it('inserts 3 active templates on first run', async () => {
    const { all, cardio } = await loadKnownSlugs();
    const r = await runSeed({
      key: 'program_templates',
      entries: programTemplates,
      adapter: makeProgramTemplateAdapter(all, cardio),
    });
    expect(r.applied).toBe(true);
    if (r.applied) expect(r.upserted).toBe(3);
    const { rows } = await db.query<{ slug: string }>(
      `SELECT slug FROM program_templates WHERE seed_key='program_templates' AND archived_at IS NULL ORDER BY slug`,
    );
    expect(rows.map(r => r.slug)).toEqual(['full-body-3-day', 'strength-cardio-3-2', 'upper-lower-4-day']);
  });

  it('re-run unchanged → applied=false, generation NOT bumped', async () => {
    const { all, cardio } = await loadKnownSlugs();
    const before = (await db.query(`SELECT generation FROM _seed_meta WHERE key='program_templates'`)).rows[0].generation;
    const r = await runSeed({
      key: 'program_templates', entries: programTemplates,
      adapter: makeProgramTemplateAdapter(all, cardio),
    });
    expect(r.applied).toBe(false);
    const after = (await db.query(`SELECT generation FROM _seed_meta WHERE key='program_templates'`)).rows[0].generation;
    expect(after).toBe(before);
  });

  it('editing a template structure bumps that row version (others unchanged)', async () => {
    const { all, cardio } = await loadKnownSlugs();
    const tweaked = programTemplates.map(t =>
      t.slug === 'full-body-3-day'
        ? {
            ...t,
            structure: {
              ...t.structure,
              days: t.structure.days.map((d, i) =>
                i === 0 ? { ...d, blocks: [...d.blocks, { exercise_slug: 'dumbbell-standing-calf-raise',
                  mev: 2, mav: 3, target_reps_low: 10, target_reps_high: 15, target_rir: 1, rest_sec: 60 }] } : d,
              ),
            },
          }
        : t,
    );
    const versionsBefore = await db.query<{ slug: string; version: number }>(
      `SELECT slug, version FROM program_templates WHERE seed_key='program_templates' ORDER BY slug`);
    const r = await runSeed({ key: 'program_templates', entries: tweaked,
      adapter: makeProgramTemplateAdapter(all, cardio) });
    expect(r.applied).toBe(true);

    const versionsAfter = await db.query<{ slug: string; version: number }>(
      `SELECT slug, version FROM program_templates WHERE seed_key='program_templates' ORDER BY slug`);
    const before = Object.fromEntries(versionsBefore.rows.map(r => [r.slug, r.version]));
    const after = Object.fromEntries(versionsAfter.rows.map(r => [r.slug, r.version]));
    expect(after['full-body-3-day']).toBe(before['full-body-3-day'] + 1);
    expect(after['upper-lower-4-day']).toBe(before['upper-lower-4-day']);
    expect(after['strength-cardio-3-2']).toBe(before['strength-cardio-3-2']);
  });

  it('removing a template soft-archives it; the other two stay active', async () => {
    const { all, cardio } = await loadKnownSlugs();
    const minus1 = programTemplates.filter(t => t.slug !== 'strength-cardio-3-2');
    const r = await runSeed({ key: 'program_templates', entries: minus1,
      adapter: makeProgramTemplateAdapter(all, cardio) });
    expect(r.applied).toBe(true);
    if (r.applied) expect(r.archived).toBe(1);
    const { rows } = await db.query<{ slug: string; archived: boolean }>(
      `SELECT slug, archived_at IS NOT NULL AS archived FROM program_templates
       WHERE seed_key='program_templates' ORDER BY slug`);
    expect(rows).toEqual([
      { slug: 'full-body-3-day',     archived: false },
      { slug: 'strength-cardio-3-2', archived: true  },
      { slug: 'upper-lower-4-day',   archived: false },
    ]);
  });

  it('every exercise_slug in every template resolves to a live exercises row', async () => {
    const slugs = new Set<string>();
    for (const t of programTemplates) for (const d of t.structure.days) for (const b of d.blocks) slugs.add(b.exercise_slug);
    const { rows } = await db.query<{ slug: string }>(
      `SELECT slug FROM exercises WHERE archived_at IS NULL AND slug = ANY($1)`,
      [Array.from(slugs)],
    );
    const found = new Set(rows.map(r => r.slug));
    const missing = Array.from(slugs).filter(s => !found.has(s));
    expect(missing).toEqual([]);
  });
});
