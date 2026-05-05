// api/src/services/resolveUserProgramStructure.ts
//
// Loads a user_program and its linked template, then applies week-1
// customization overlays to produce the single-week blueprint preview
// shown on the desktop ProgramPage. Mesocycle_runs (post-/start) become the
// canonical week schedule; this service covers the planning/preview phase.

import { db } from '../db/client.js';

// ── Internal structure types ──────────────────────────────────────────────────

type Block = {
  exercise_slug: string;
  set_count_delta?: number;
  [key: string]: unknown;
};

type DayDef = {
  idx: number;
  day_offset: number;
  kind: 'strength' | 'cardio' | 'hybrid';
  name: string;
  blocks: Block[];
};

type TemplateStructure = {
  _v: 1;
  days: DayDef[];
};

type Customizations = {
  name_override?: string;
  swaps?: Array<{ week_idx: number; day_idx: number; block_idx: number; from_slug: string; to_slug: string }>;
  set_count_overrides?: Array<{ week_idx: number; day_idx: number; block_idx: number; delta: number }>;
  day_offset_overrides?: Array<{ week_idx: number; day_idx: number; new_day_offset: number }>;
  skipped_days?: Array<{ week_idx: number; day_idx: number }>;
};

// ── Public types ──────────────────────────────────────────────────────────────

export type ResolvedUserProgram = {
  id: string;
  template_id: string | null;
  template_version: number | null;
  name: string;
  effective_name: string;
  customizations: Record<string, unknown>;
  status: 'draft' | 'active' | 'completed' | 'archived';
  effective_structure: {
    _v: 1;
    days: Array<{
      idx: number;
      day_offset: number;
      kind: 'strength' | 'cardio' | 'hybrid';
      name: string;
      blocks: unknown[];
    }>;
  };
  latest_run_id?: string;
};

// ── Implementation ────────────────────────────────────────────────────────────

export async function resolveUserProgramStructure(
  userProgramId: string,
  userId: string,
): Promise<ResolvedUserProgram | null> {
  // Load user_program, its template, and the most recent run in one pass.
  // The LEFT JOIN on program_templates covers the case where template_id IS NULL
  // (user-authored programs, future path). We return null in that case per spec §6.
  const { rows: [row] } = await db.query<{
    up_id: string;
    up_name: string;
    template_id: string | null;
    template_version: number | null;
    customizations: Customizations;
    status: string;
    tpl_name: string | null;
    structure: TemplateStructure | null;
    latest_run_id: string | null;
  }>(
    `SELECT
       up.id                      AS up_id,
       up.name                    AS up_name,
       up.template_id             AS template_id,
       up.template_version        AS template_version,
       up.customizations          AS customizations,
       up.status                  AS status,
       pt.name                    AS tpl_name,
       pt.structure               AS structure,
       (SELECT mr.id
          FROM mesocycle_runs mr
         WHERE mr.user_program_id = up.id
         ORDER BY mr.created_at DESC
         LIMIT 1)                 AS latest_run_id
     FROM user_programs up
     LEFT JOIN program_templates pt
       ON pt.id = up.template_id
    WHERE up.id = $1
      AND up.user_id = $2`,
    [userProgramId, userId],
  );

  // Not found or belongs to a different user.
  if (!row) return null;

  // Require a linked template for v1 (user-authored programs defer to v2).
  if (!row.template_id || !row.structure) return null;

  const cust: Customizations = row.customizations ?? {};

  // Deep-copy the template structure before applying overlays so we never
  // mutate the pg-cached JSONB object in place.
  const structure: TemplateStructure = JSON.parse(JSON.stringify(row.structure));

  // ── Apply week-1 overlays ──────────────────────────────────────────────────

  // 0. Initialize set_count_delta on every block (default 0)
  for (const day of structure.days) {
    for (const block of day.blocks) {
      block.set_count_delta = 0;
    }
  }

  // 1. day_offset_overrides (week_idx === 1)
  for (const ov of cust.day_offset_overrides ?? []) {
    if (ov.week_idx !== 1) continue;
    const day = structure.days.find(d => d.idx === ov.day_idx);
    if (day) day.day_offset = ov.new_day_offset;
  }

  // 2. swaps (week_idx === 1) — only apply if from_slug matches current block
  for (const sw of cust.swaps ?? []) {
    if (sw.week_idx !== 1) continue;
    const day = structure.days.find(d => d.idx === sw.day_idx);
    if (!day) continue;
    const block = day.blocks[sw.block_idx];
    if (block && block.exercise_slug === sw.from_slug) {
      block.exercise_slug = sw.to_slug;
    }
  }

  // 3. set_count_overrides: stamp delta onto matching blocks
  for (const ov of cust.set_count_overrides ?? []) {
    if (ov.week_idx !== 1) continue;
    const day = structure.days.find(d => d.idx === ov.day_idx);
    if (!day) continue;
    const block = day.blocks[ov.block_idx];
    if (block) {
      block.set_count_delta = (block.set_count_delta ?? 0) + ov.delta;
    }
  }

  // 4. skipped_days (week_idx === 1): filter out matching days
  const skippedIdxs = new Set(
    (cust.skipped_days ?? [])
      .filter(sd => sd.week_idx === 1)
      .map(sd => sd.day_idx),
  );
  if (skippedIdxs.size > 0) {
    structure.days = structure.days.filter(d => !skippedIdxs.has(d.idx));
  }

  return {
    id: row.up_id,
    template_id: row.template_id,
    template_version: row.template_version,
    name: row.up_name,
    effective_name: (cust.name_override ?? row.up_name),
    customizations: row.customizations as Record<string, unknown>,
    status: row.status as ResolvedUserProgram['status'],
    effective_structure: structure,
    ...(row.latest_run_id ? { latest_run_id: row.latest_run_id } : {}),
  };
}
