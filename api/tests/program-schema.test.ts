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
