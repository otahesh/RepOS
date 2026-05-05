import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '../../src/db/client.js';
import { resolveUserProgramStructure } from '../../src/services/resolveUserProgramStructure.js';

let userId: string;
let userProgramId: string;
let templateId: string;
let templateVersion: number;
let origFirstSlug: string;

beforeAll(async () => {
  // Insert test user
  const { rows: [u] } = await db.query<{ id: string }>(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [`vitest.resolve-struct.${randomUUID()}@repos.test`],
  );
  userId = u.id;

  // Load full-body-3-day template
  const { rows: [tmpl] } = await db.query<{
    id: string; version: number; name: string; structure: any;
  }>(
    `SELECT id, version, name, structure FROM program_templates WHERE slug='full-body-3-day' AND archived_at IS NULL`,
  );
  if (!tmpl) throw new Error('full-body-3-day seed not found — run seeds first');
  templateId = tmpl.id;
  templateVersion = tmpl.version;
  origFirstSlug = tmpl.structure.days[0].blocks[0].exercise_slug;

  // Fork via direct SQL (this test exercises the service, not the route)
  const { rows: [up] } = await db.query<{ id: string }>(
    `INSERT INTO user_programs (user_id, template_id, template_version, name, customizations, status)
     VALUES ($1, $2, $3, $4, '{}'::jsonb, 'draft') RETURNING id`,
    [userId, tmpl.id, tmpl.version, tmpl.name],
  );
  userProgramId = up.id;
});

afterAll(async () => {
  if (userId) await db.query(`DELETE FROM users WHERE id=$1`, [userId]);
  await db.end();
});

describe('resolveUserProgramStructure', () => {
  it('1. returns null for nonexistent user_program id', async () => {
    const result = await resolveUserProgramStructure(randomUUID(), userId);
    expect(result).toBeNull();
  });

  it('2. returns null for cross-user access (different user_id)', async () => {
    const { rows: [other] } = await db.query<{ id: string }>(
      `INSERT INTO users (email) VALUES ($1) RETURNING id`,
      [`vitest.resolve-struct.other.${randomUUID()}@repos.test`],
    );
    try {
      const result = await resolveUserProgramStructure(userProgramId, other.id);
      expect(result).toBeNull();
    } finally {
      await db.query(`DELETE FROM users WHERE id=$1`, [other.id]);
    }
  });

  it('3. happy path: returns days, effective_name = program name, no latest_run_id', async () => {
    const result = await resolveUserProgramStructure(userProgramId, userId);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(userProgramId);
    expect(result!.effective_structure.days.length).toBe(3);
    expect(result!.effective_name).toBe(result!.name);
    expect(result!.latest_run_id).toBeUndefined();
  });

  it('4. name_override applied: effective_name reflects override', async () => {
    await db.query(
      `UPDATE user_programs SET customizations=$1::jsonb WHERE id=$2`,
      [JSON.stringify({ name_override: 'My Program' }), userProgramId],
    );
    try {
      const result = await resolveUserProgramStructure(userProgramId, userId);
      expect(result).not.toBeNull();
      expect(result!.effective_name).toBe('My Program');
    } finally {
      await db.query(`UPDATE user_programs SET customizations='{}'::jsonb WHERE id=$1`, [userProgramId]);
    }
  });

  it('5. swaps applied for week_idx=1: first block exercise replaced', async () => {
    await db.query(
      `UPDATE user_programs SET customizations=$1::jsonb WHERE id=$2`,
      [
        JSON.stringify({
          swaps: [{ week_idx: 1, day_idx: 0, block_idx: 0, from_slug: origFirstSlug, to_slug: 'barbell-back-squat' }],
        }),
        userProgramId,
      ],
    );
    try {
      const result = await resolveUserProgramStructure(userProgramId, userId);
      expect(result).not.toBeNull();
      expect(result!.effective_structure.days[0].blocks[0].exercise_slug).toBe('barbell-back-squat');
      // set_count_delta defaults to 0 on all blocks
      expect(result!.effective_structure.days[0].blocks[0].set_count_delta).toBe(0);
    } finally {
      await db.query(`UPDATE user_programs SET customizations='{}'::jsonb WHERE id=$1`, [userProgramId]);
    }
  });

  it('6. skipped_days applied: day removed from blueprint', async () => {
    await db.query(
      `UPDATE user_programs SET customizations=$1::jsonb WHERE id=$2`,
      [
        JSON.stringify({ skipped_days: [{ week_idx: 1, day_idx: 1 }] }),
        userProgramId,
      ],
    );
    try {
      const result = await resolveUserProgramStructure(userProgramId, userId);
      expect(result).not.toBeNull();
      expect(result!.effective_structure.days.length).toBe(2);
      // The skipped day (day_idx 1) must not appear
      expect(result!.effective_structure.days.every((d: any) => d.idx !== 1)).toBe(true);
    } finally {
      await db.query(`UPDATE user_programs SET customizations='{}'::jsonb WHERE id=$1`, [userProgramId]);
    }
  });

  it('7. day_offset_override applied: day_offset updated in blueprint', async () => {
    await db.query(
      `UPDATE user_programs SET customizations=$1::jsonb WHERE id=$2`,
      [
        JSON.stringify({ day_offset_overrides: [{ week_idx: 1, day_idx: 0, new_day_offset: 2 }] }),
        userProgramId,
      ],
    );
    try {
      const result = await resolveUserProgramStructure(userProgramId, userId);
      expect(result).not.toBeNull();
      expect(result!.effective_structure.days[0].day_offset).toBe(2);
    } finally {
      await db.query(`UPDATE user_programs SET customizations='{}'::jsonb WHERE id=$1`, [userProgramId]);
    }
  });

  it('8. week_idx != 1 overlays do NOT affect the blueprint', async () => {
    await db.query(
      `UPDATE user_programs SET customizations=$1::jsonb WHERE id=$2`,
      [
        JSON.stringify({
          swaps: [{ week_idx: 2, day_idx: 0, block_idx: 0, from_slug: 'x', to_slug: 'dumbbell-goblet-squat' }],
        }),
        userProgramId,
      ],
    );
    try {
      const result = await resolveUserProgramStructure(userProgramId, userId);
      expect(result).not.toBeNull();
      // The first block should still have the original template exercise
      expect(result!.effective_structure.days[0].blocks[0].exercise_slug).toBe(origFirstSlug);
    } finally {
      await db.query(`UPDATE user_programs SET customizations='{}'::jsonb WHERE id=$1`, [userProgramId]);
    }
  });

  it('9. latest_run_id set when mesocycle_run exists', async () => {
    // Insert a mesocycle_run directly without going through materialization
    const { rows: [run] } = await db.query<{ id: string }>(
      `INSERT INTO mesocycle_runs (user_program_id, user_id, start_date, start_tz, weeks, status)
       VALUES ($1, $2, '2026-05-05'::date, 'America/New_York', 5, 'active')
       RETURNING id`,
      [userProgramId, userId],
    );
    try {
      const result = await resolveUserProgramStructure(userProgramId, userId);
      expect(result).not.toBeNull();
      expect(result!.latest_run_id).toBe(run.id);
    } finally {
      await db.query(`DELETE FROM mesocycle_runs WHERE id=$1`, [run.id]);
    }
  });

  it('10. set_count_overrides stamps set_count_delta on the matching block', async () => {
    await db.query(
      `UPDATE user_programs SET customizations=$1::jsonb WHERE id=$2`,
      [JSON.stringify({
        set_count_overrides: [
          { week_idx: 1, day_idx: 0, block_idx: 0, delta: 1 },
          { week_idx: 1, day_idx: 1, block_idx: 0, delta: -1 },
        ],
      }), userProgramId],
    );
    try {
      const r = await resolveUserProgramStructure(userProgramId, userId);
      expect(r).not.toBeNull();
      expect(r!.effective_structure.days[0].blocks[0].set_count_delta).toBe(1);
      expect(r!.effective_structure.days[1].blocks[0].set_count_delta).toBe(-1);
      // Other blocks default to 0
      expect(r!.effective_structure.days[2].blocks[0].set_count_delta).toBe(0);
    } finally {
      await db.query(`UPDATE user_programs SET customizations='{}'::jsonb WHERE id=$1`, [userProgramId]);
    }
  });

  it('11. swap with stale from_slug (current block no longer matches) is skipped', async () => {
    await db.query(
      `UPDATE user_programs SET customizations=$1::jsonb WHERE id=$2`,
      [JSON.stringify({
        swaps: [
          { week_idx: 1, day_idx: 0, block_idx: 0,
            from_slug: 'never-existed-this-name', to_slug: 'barbell-back-squat' }
        ],
      }), userProgramId],
    );
    try {
      const r = await resolveUserProgramStructure(userProgramId, userId);
      expect(r).not.toBeNull();
      // Swap was stale → block keeps its original exercise_slug
      expect(r!.effective_structure.days[0].blocks[0].exercise_slug).toBe(origFirstSlug);
      expect(r!.effective_structure.days[0].blocks[0].exercise_slug).not.toBe('barbell-back-squat');
    } finally {
      await db.query(`UPDATE user_programs SET customizations='{}'::jsonb WHERE id=$1`, [userProgramId]);
    }
  });

  it('12. rir_overrides stamps target_rir_override on the matching block (week_idx=1 only)', async () => {
    await db.query(
      `UPDATE user_programs SET customizations=$1::jsonb WHERE id=$2`,
      [JSON.stringify({
        rir_overrides: [
          { week_idx: 1, day_idx: 0, block_idx: 0, target_rir: 1 },
          { week_idx: 2, day_idx: 0, block_idx: 0, target_rir: 5 },  // ignored: week 2
        ],
      }), userProgramId],
    );
    try {
      const r = await resolveUserProgramStructure(userProgramId, userId);
      expect(r).not.toBeNull();
      expect(r!.effective_structure.days[0].blocks[0].target_rir_override).toBe(1);
      // Other blocks: undefined (no override)
      expect(r!.effective_structure.days[1].blocks[0].target_rir_override).toBeUndefined();
    } finally {
      await db.query(`UPDATE user_programs SET customizations='{}'::jsonb WHERE id=$1`, [userProgramId]);
    }
  });

  it('13. trim_last_n persisted but does not modify the single-week blueprint (no-op for preview)', async () => {
    await db.query(
      `UPDATE user_programs SET customizations=$1::jsonb WHERE id=$2`,
      [JSON.stringify({ trim_last_n: 2 }), userProgramId],
    );
    try {
      const r = await resolveUserProgramStructure(userProgramId, userId);
      expect(r).not.toBeNull();
      // Trim affects mesocycle weeks, not the single-week blueprint — days length unchanged
      expect(r!.effective_structure.days.length).toBe(3);  // full-body-3-day has 3 days
      // Customization round-trip: trim_last_n is exposed back in customizations for the FE
      expect(r!.customizations.trim_last_n).toBe(2);
    } finally {
      await db.query(`UPDATE user_programs SET customizations='{}'::jsonb WHERE id=$1`, [userProgramId]);
    }
  });
});
