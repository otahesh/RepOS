import 'dotenv/config';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { db } from '../../src/db/client.js';
import {
  seedUserProgramAtTemplateVersion,
  cleanupSeeded,
  type SeedHandle,
} from '../helpers/seed-fixtures.js';
import { materializeMesocycle, TemplateOutdatedError } from '../../src/services/materializeMesocycle.js';

const handles: SeedHandle[] = [];
afterEach(async () => { if (handles.length) await cleanupSeeded(handles.splice(0)); });
afterAll(async () => { await db.end(); });

describe('W2 — curated programs include core blocks (new version) but old forks untouched', () => {
  it('latest program_templates version has at least one block with primary_muscle=core', async () => {
    // Scope to the curated lineup by slug — other tests seed throwaway
    // created_by='system' fixture templates (no core block) that would
    // otherwise pollute an "all system templates" query under parallelism.
    const CURATED = ['full-body-3-day', 'upper-lower-4-day', 'strength-cardio-3-2'];
    const { rows: templates } = await db.query<{ slug: string; version: number; structure: any }>(
      `SELECT slug, version, structure FROM program_templates
       WHERE archived_at IS NULL AND created_by = 'system' AND slug = ANY($1::text[])`,
      [CURATED],
    );
    expect(templates.length).toBe(CURATED.length);
    // Walk structure.days[].blocks[].exercise_slug; cross-reference exercises table.
    for (const tpl of templates) {
      const slugs: string[] = [];
      for (const d of tpl.structure?.days ?? []) for (const b of d.blocks ?? []) slugs.push(b.exercise_slug);
      const { rows: ex } = await db.query<{ slug: string; muscle: string }>(
        `SELECT e.slug, m.slug AS muscle FROM exercises e
         JOIN muscles m ON m.id = e.primary_muscle_id
         WHERE e.slug = ANY($1::text[])`,
        [slugs],
      );
      const hasCore = ex.some(r => r.muscle === 'core');
      expect(hasCore, `template ${tpl.slug} should contain a core block`).toBe(true);
    }
  });

  it('an existing alpha user_program forked at version N is NOT silently given core blocks (hard-stops on materialize)', async () => {
    // Per panel I-CURATED-FORK-TEST: real test, no .todo.
    //
    // Deviation from the plan's premise: the seed adapter UPDATES the template
    // row in place rather than keeping per-version rows, so an old structure no
    // longer exists in the DB to materialize from. The actual safety guarantee
    // is STRONGER — an old-version fork is hard-stopped with TemplateOutdatedError
    // (forcing an explicit re-fork) rather than silently materializing core
    // blocks. We assert that hard-stop.
    // Reproduce the stale-fork condition deterministically: a dedicated
    // 'system' template at version 2 (with a core block) and a fork pinned to
    // version 1 (the pre-core version). The curated templates' live version
    // numbers are environment-dependent, so we don't derive from them.
    const seed = await seedUserProgramAtTemplateVersion({
      templateVersion: 1,
      currentTemplateVersion: 2,
    });
    handles.push(seed);

    // Materializing from a stale version must NOT silently emit the new
    // (core-bearing) structure — it throws TemplateOutdatedError.
    await expect(
      materializeMesocycle({
        userProgramId: seed.userProgramId,
        startDate: '2026-06-01',
        startTz: 'UTC',
      }),
    ).rejects.toBeInstanceOf(TemplateOutdatedError);

    // And no run/day_workouts were created for that fork.
    const { rows: runs } = await db.query(
      `SELECT id FROM mesocycle_runs WHERE user_program_id = $1`,
      [seed.userProgramId],
    );
    expect(runs).toHaveLength(0);
  });
});
