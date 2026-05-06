// Shared fixture helpers for program-model tests.
//
// Why this exists: prior to F-cleanup #15, every Phase B test file inlined its
// own user/template/user_program inserts, all keyed on `Date.now()`. Two tests
// that hit the same millisecond produced colliding emails/slugs (UNIQUE-violation
// flake). These helpers centralize the inserts and use crypto.randomUUID() for
// guaranteed uniqueness.
//
// Pair every fixture call with the matching cleanup in `afterAll` or in a
// per-test `try/finally` so tests don't leak rows when an assertion throws.

import { randomUUID } from 'node:crypto';
import { db } from '../../src/db/client.js';

export interface MkUserOpts {
  /** Tag included in the email for log readability. Default 'vitest'. */
  prefix?: string;
  /** equipment_profile JSONB. */
  equipment_profile?: object;
  /** users.goal CHECK ∈ (cut|maintain|bulk). */
  goal?: 'cut' | 'maintain' | 'bulk';
}

export async function mkUser(opts: MkUserOpts = {}): Promise<{ id: string; email: string }> {
  const prefix = opts.prefix ?? 'vitest';
  const email = `${prefix}.${randomUUID()}@repos.test`;
  const cols = ['email'];
  const values: unknown[] = [email];
  const placeholders = ['$1'];

  if (opts.equipment_profile !== undefined) {
    cols.push('equipment_profile');
    values.push(JSON.stringify(opts.equipment_profile));
    placeholders.push(`$${values.length}::jsonb`);
  }
  if (opts.goal !== undefined) {
    cols.push('goal');
    values.push(opts.goal);
    placeholders.push(`$${values.length}`);
  }

  const { rows: [u] } = await db.query<{ id: string; email: string }>(
    `INSERT INTO users (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id, email`,
    values,
  );
  return u;
}

export interface MkTemplateOpts {
  /** Slug prefix; default 'vitest-tpl'. Final slug = `${prefix}-${uuid}`. */
  prefix?: string;
  name?: string;
  weeks?: number;
  daysPerWeek?: number;
  /** structure JSONB (required). */
  structure: object;
}

export async function mkTemplate(opts: MkTemplateOpts): Promise<{ id: string; slug: string }> {
  const prefix = opts.prefix ?? 'vitest-tpl';
  const slug = `${prefix}-${randomUUID()}`;
  const { rows: [t] } = await db.query<{ id: string; slug: string }>(
    `INSERT INTO program_templates (slug, name, weeks, days_per_week, structure, version, created_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, 1, 'system') RETURNING id, slug`,
    [
      slug,
      opts.name ?? 'Vitest Template',
      opts.weeks ?? 5,
      opts.daysPerWeek ?? 1,
      JSON.stringify(opts.structure),
    ],
  );
  return t;
}

export interface MkUserProgramOpts {
  userId: string;
  /** Optional — pass null/undefined for a templateless user_program (e.g. jointStress fixtures). */
  templateId?: string | null;
  templateVersion?: number;
  name?: string;
  status?: 'draft' | 'active' | 'paused' | 'completed' | 'archived';
}

export async function mkUserProgram(opts: MkUserProgramOpts): Promise<{ id: string }> {
  const templateId = opts.templateId ?? null;
  const templateVersion = templateId ? (opts.templateVersion ?? 1) : null;
  const { rows: [up] } = await db.query<{ id: string }>(
    `INSERT INTO user_programs (user_id, template_id, template_version, name, status)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      opts.userId,
      templateId,
      templateVersion,
      opts.name ?? 'Vitest run',
      opts.status ?? 'draft',
    ],
  );
  return up;
}

/** Idempotent: ignores undefined ids. Cascades take care of dependent rows. */
export async function cleanupUser(userId: string | undefined): Promise<void> {
  if (userId) await db.query(`DELETE FROM users WHERE id=$1`, [userId]);
}

export async function cleanupTemplate(templateId: string | undefined): Promise<void> {
  if (templateId) await db.query(`DELETE FROM program_templates WHERE id=$1`, [templateId]);
}

/** Bulk delete; tolerant of undefined entries. */
export async function cleanupExercises(ids: Array<string | undefined>): Promise<void> {
  const filtered = ids.filter((x): x is string => !!x);
  if (filtered.length === 0) return;
  await db.query(`DELETE FROM exercises WHERE id = ANY($1::uuid[])`, [filtered]);
}
