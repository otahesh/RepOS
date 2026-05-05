import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { db } from '../src/db/client.js';

afterAll(async () => { await db.end(); });

describe('program enum types (migration 014)', () => {
  it('day_workout_kind enum has exactly strength, cardio, hybrid (no rest)', async () => {
    const { rows } = await db.query(
      `SELECT enumlabel FROM pg_enum
        WHERE enumtypid = 'day_workout_kind'::regtype
        ORDER BY enumsortorder`
    );
    expect(rows.map(r => r.enumlabel)).toEqual(['strength','cardio','hybrid']);
  });

  it('program_status enum carries draft|active|paused|completed|archived', async () => {
    const { rows } = await db.query(
      `SELECT enumlabel FROM pg_enum
        WHERE enumtypid = 'program_status'::regtype
        ORDER BY enumsortorder`
    );
    expect(rows.map(r => r.enumlabel)).toEqual(
      ['draft','active','paused','completed','archived']
    );
  });

  it('mesocycle_run_event_type enum carries the 9 v1 events', async () => {
    const { rows } = await db.query(
      `SELECT enumlabel FROM pg_enum
        WHERE enumtypid = 'mesocycle_run_event_type'::regtype
        ORDER BY enumsortorder`
    );
    expect(rows.map(r => r.enumlabel)).toEqual([
      'started','paused','resumed','day_overridden','set_overridden',
      'day_skipped','customized','completed','abandoned',
    ]);
  });
});

describe('program_templates (migration 015)', () => {
  it('rejects non-kebab slug', async () => {
    await expect(
      db.query(
        `INSERT INTO program_templates (slug, name, weeks, days_per_week, structure)
         VALUES ('Bad Slug','x',5,3,'{}'::jsonb)`
      )
    ).rejects.toThrow();
  });

  it('rejects weeks > 16', async () => {
    await expect(
      db.query(
        `INSERT INTO program_templates (slug, name, weeks, days_per_week, structure)
         VALUES ('test-too-many-weeks','x',17,3,'{}'::jsonb)`
      )
    ).rejects.toThrow();
  });

  it('rejects days_per_week > 7', async () => {
    await expect(
      db.query(
        `INSERT INTO program_templates (slug, name, weeks, days_per_week, structure)
         VALUES ('test-too-many-days','x',5,8,'{}'::jsonb)`
      )
    ).rejects.toThrow();
  });

  it('rejects created_by outside system|user', async () => {
    await expect(
      db.query(
        `INSERT INTO program_templates (slug, name, weeks, days_per_week, structure, created_by)
         VALUES ('test-bad-author','x',5,3,'{}'::jsonb,'machine')`
      )
    ).rejects.toThrow();
  });

  it('seed_key partial index exists', async () => {
    const { rows } = await db.query(
      `SELECT indexdef FROM pg_indexes
        WHERE tablename='program_templates' AND indexname='idx_program_templates_seed_key'`
    );
    expect(rows[0]?.indexdef).toMatch(/WHERE \(seed_key IS NOT NULL\)/i);
  });

  it('inserts a valid row with default version=1, customizations defaults applied', async () => {
    const { rows: [t] } = await db.query(
      `INSERT INTO program_templates (slug, name, weeks, days_per_week, structure)
       VALUES ('test-valid-template','Valid', 5, 3, '{"_v":1,"days":[]}'::jsonb)
       RETURNING version, created_by`
    );
    expect(t.version).toBe(1);
    expect(t.created_by).toBe('system');
    await db.query(`DELETE FROM program_templates WHERE slug='test-valid-template'`);
  });
});

describe('user_programs (migration 016)', () => {
  it('cascades on user delete', async () => {
    const { rows: [u] } = await db.query(
      `INSERT INTO users (email) VALUES ($1) RETURNING id`,
      [`vitest.up.${Date.now()}@repos.test`]
    );
    const { rows: [t] } = await db.query(
      `INSERT INTO program_templates (slug, name, weeks, days_per_week, structure)
       VALUES ($1,'X',5,3,'{"_v":1,"days":[]}'::jsonb) RETURNING id`,
      [`tpl-up-${Date.now()}`]
    );
    const { rows: [up] } = await db.query(
      `INSERT INTO user_programs (user_id, template_id, template_version, name)
       VALUES ($1,$2,1,'mine') RETURNING id, customizations, status`,
      [u.id, t.id]
    );
    expect(up.customizations).toEqual({});
    expect(up.status).toBe('draft');

    await db.query(`DELETE FROM users WHERE id=$1`, [u.id]);
    const { rows } = await db.query(
      `SELECT 1 FROM user_programs WHERE id=$1`, [up.id]
    );
    expect(rows.length).toBe(0);
    await db.query(`DELETE FROM program_templates WHERE id=$1`, [t.id]);
  });

  it('rejects status outside enum', async () => {
    const { rows: [u] } = await db.query(
      `INSERT INTO users (email) VALUES ($1) RETURNING id`,
      [`vitest.up2.${Date.now()}@repos.test`]
    );
    await expect(
      db.query(
        `INSERT INTO user_programs (user_id, name, status)
         VALUES ($1,'x','running'::program_status)`,
        [u.id]
      )
    ).rejects.toThrow();
    await db.query(`DELETE FROM users WHERE id=$1`, [u.id]);
  });

  it('partial index excludes archived rows', async () => {
    const { rows } = await db.query(
      `SELECT indexdef FROM pg_indexes
        WHERE tablename='user_programs' AND indexname='idx_user_programs_user'`
    );
    expect(rows[0]?.indexdef).toMatch(/WHERE \(status <> 'archived'/i);
  });
});

describe('mesocycle_runs (migration 017)', () => {
  async function mkUserProgram(): Promise<{ user_id: string; up_id: string }> {
    const { rows: [u] } = await db.query(
      `INSERT INTO users (email) VALUES ($1) RETURNING id`,
      [`vitest.mr.${Date.now()}.${Math.random()}@repos.test`]
    );
    const { rows: [up] } = await db.query(
      `INSERT INTO user_programs (user_id, name) VALUES ($1, 'mine') RETURNING id`,
      [u.id]
    );
    return { user_id: u.id, up_id: up.id };
  }

  it('partial unique index allows multiple non-active rows', async () => {
    const { user_id, up_id } = await mkUserProgram();
    await db.query(
      `INSERT INTO mesocycle_runs (user_program_id, user_id, start_date, start_tz, weeks, status)
       VALUES ($1,$2,'2026-01-01','America/New_York',5,'completed')`,
      [up_id, user_id]
    );
    await db.query(
      `INSERT INTO mesocycle_runs (user_program_id, user_id, start_date, start_tz, weeks, status)
       VALUES ($1,$2,'2026-02-01','America/New_York',5,'completed')`,
      [up_id, user_id]
    );
    await db.query(`DELETE FROM users WHERE id=$1`, [user_id]);
  });

  it('partial unique index allows one active and one paused per user', async () => {
    const { user_id, up_id } = await mkUserProgram();
    await db.query(
      `INSERT INTO mesocycle_runs (user_program_id, user_id, start_date, start_tz, weeks, status)
       VALUES ($1,$2,'2026-01-01','UTC',5,'active')`,
      [up_id, user_id]
    );
    await db.query(
      `INSERT INTO mesocycle_runs (user_program_id, user_id, start_date, start_tz, weeks, status)
       VALUES ($1,$2,'2026-02-01','UTC',5,'paused')`,
      [up_id, user_id]
    );
    await db.query(`DELETE FROM users WHERE id=$1`, [user_id]);
  });

  it('rejects a SECOND active row for same user with 23505', async () => {
    const { user_id, up_id } = await mkUserProgram();
    await db.query(
      `INSERT INTO mesocycle_runs (user_program_id, user_id, start_date, start_tz, weeks, status)
       VALUES ($1,$2,'2026-01-01','UTC',5,'active')`,
      [up_id, user_id]
    );
    let code: string | undefined;
    try {
      await db.query(
        `INSERT INTO mesocycle_runs (user_program_id, user_id, start_date, start_tz, weeks, status)
         VALUES ($1,$2,'2026-02-01','UTC',5,'active')`,
        [up_id, user_id]
      );
    } catch (e: any) { code = e.code; }
    expect(code).toBe('23505');
    await db.query(`DELETE FROM users WHERE id=$1`, [user_id]);
  });

  it('start_tz is NOT NULL', async () => {
    const { user_id, up_id } = await mkUserProgram();
    await expect(
      db.query(
        `INSERT INTO mesocycle_runs (user_program_id, user_id, start_date, weeks)
         VALUES ($1,$2,'2026-01-01',5)`,
        [up_id, user_id]
      )
    ).rejects.toThrow();
    await db.query(`DELETE FROM users WHERE id=$1`, [user_id]);
  });
});

describe('day_workouts (migration 018)', () => {
  async function mkRun(): Promise<{ user_id: string; run_id: string }> {
    const { rows: [u] } = await db.query(
      `INSERT INTO users (email) VALUES ($1) RETURNING id`,
      [`vitest.dw.${Date.now()}.${Math.random()}@repos.test`]
    );
    const { rows: [up] } = await db.query(
      `INSERT INTO user_programs (user_id, name) VALUES ($1, 'p') RETURNING id`,
      [u.id]
    );
    const { rows: [r] } = await db.query(
      `INSERT INTO mesocycle_runs (user_program_id, user_id, start_date, start_tz, weeks)
       VALUES ($1,$2,'2026-01-05','UTC',5) RETURNING id`,
      [up.id, u.id]
    );
    return { user_id: u.id, run_id: r.id };
  }

  it('rejects status outside planned|in_progress|completed|skipped', async () => {
    const { user_id, run_id } = await mkRun();
    await expect(
      db.query(
        `INSERT INTO day_workouts (mesocycle_run_id, week_idx, day_idx, scheduled_date, kind, name, status)
         VALUES ($1,1,0,'2026-01-05','strength','Mon','running')`,
        [run_id]
      )
    ).rejects.toThrow();
    await db.query(`DELETE FROM users WHERE id=$1`, [user_id]);
  });

  it('rejects duplicate (run, week_idx, day_idx)', async () => {
    const { user_id, run_id } = await mkRun();
    await db.query(
      `INSERT INTO day_workouts (mesocycle_run_id, week_idx, day_idx, scheduled_date, kind, name)
       VALUES ($1,1,0,'2026-01-05','strength','Mon')`,
      [run_id]
    );
    let code: string | undefined;
    try {
      await db.query(
        `INSERT INTO day_workouts (mesocycle_run_id, week_idx, day_idx, scheduled_date, kind, name)
         VALUES ($1,1,0,'2026-01-06','strength','Mon dup')`,
        [run_id]
      );
    } catch (e: any) { code = e.code; }
    expect(code).toBe('23505');
    await db.query(`DELETE FROM users WHERE id=$1`, [user_id]);
  });

  it('cardio kind is accepted but rest is NOT a kind (use absent row for rest)', async () => {
    const { user_id, run_id } = await mkRun();
    await db.query(
      `INSERT INTO day_workouts (mesocycle_run_id, week_idx, day_idx, scheduled_date, kind, name)
       VALUES ($1,1,0,'2026-01-05','cardio','Z2')`,
      [run_id]
    );
    await expect(
      db.query(
        `INSERT INTO day_workouts (mesocycle_run_id, week_idx, day_idx, scheduled_date, kind, name)
         VALUES ($1,1,1,'2026-01-06','rest','Off')`,
        [run_id]
      )
    ).rejects.toThrow();
    await db.query(`DELETE FROM users WHERE id=$1`, [user_id]);
  });
});
