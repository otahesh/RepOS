import { db } from '../db/client.js';
import type { PoolClient } from 'pg';
import { computeRamp, distributeWeekTargetAcrossBlocks } from './autoRamp.js';

// Per-muscle landmarks (spec §5.1). Read-only constant in v1.
export const MUSCLE_LANDMARKS: Record<string, { mev: number; mav: number; mrv: number }> = {
  chest:       { mev: 10, mav: 14, mrv: 22 },
  lats:        { mev: 10, mav: 16, mrv: 22 },
  upper_back:  { mev: 10, mav: 16, mrv: 24 },
  front_delt:  { mev: 6,  mav: 10, mrv: 16 },
  side_delt:   { mev: 12, mav: 18, mrv: 26 },
  rear_delt:   { mev: 10, mav: 16, mrv: 24 },
  biceps:      { mev: 8,  mav: 14, mrv: 20 },
  triceps:     { mev: 8,  mav: 14, mrv: 22 },
  quads:       { mev: 8,  mav: 14, mrv: 20 },
  hamstrings:  { mev: 6,  mav: 12, mrv: 18 },
  glutes:      { mev: 4,  mav: 12, mrv: 16 },
  calves:      { mev: 10, mav: 14, mrv: 22 },
};

type Block = {
  exercise_slug: string;
  mev: number; mav: number;
  target_reps_low: number; target_reps_high: number;
  target_rir: number; rest_sec: number;
  cardio?: { target_duration_sec?: number; target_distance_m?: number; target_zone?: number };
};

type DayDef = { idx: number; day_offset: number; kind: 'strength'|'cardio'|'hybrid'; name: string; blocks: Block[] };

type Structure = { _v: number; days: DayDef[] };

export type MaterializeInput = {
  userProgramId: string;
  startDate: string;     // YYYY-MM-DD
  startTz: string;       // IANA tz
};
export type MaterializeResult = { run_id: string };

export class TemplateOutdatedError extends Error {
  code = 'template_outdated' as const;
  status = 409;
  constructor(public latest_version: number) { super('template_outdated'); }
  toJSON() { return { error: this.code, latest_version: this.latest_version, must_refork: true }; }
}

export class ActiveRunExistsError extends Error {
  status = 409;
  constructor() { super('active run already exists'); }
  toJSON() { return { error: 'active_run_exists' }; }
}

function addDaysISO(iso: string, days: number): string {
  // Use UTC math on a Z-anchored midnight. Caller has already mapped
  // tz-local "start of day" → this ISO date string, so simple UTC add is safe.
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function materializeMesocycle(input: MaterializeInput): Promise<MaterializeResult> {
  const client = await db.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');

    // Step 2: template version match.
    const { rows: [up] } = await client.query<{
      template_id: string | null; template_version: number | null; customizations: any;
    }>(
      `SELECT template_id, template_version, customizations
       FROM user_programs WHERE id=$1 FOR UPDATE`, [input.userProgramId],
    );
    if (!up) { await client.query('ROLLBACK'); throw new Error('user_program not found'); }

    let structure: Structure;
    let weeks: number;
    if (up.template_id) {
      const { rows: [tpl] } = await client.query<{ structure: Structure; version: number; weeks: number }>(
        `SELECT structure, version, weeks FROM program_templates WHERE id=$1`,
        [up.template_id],
      );
      if (!tpl) { await client.query('ROLLBACK'); throw new Error('template not found'); }
      if (tpl.version !== up.template_version) {
        await client.query('ROLLBACK');
        throw new TemplateOutdatedError(tpl.version);
      }
      structure = tpl.structure;
      weeks = tpl.weeks;
    } else {
      // Future user-authored programs path: customizations carries structure.
      structure = up.customizations?.structure as Structure;
      weeks = up.customizations?.weeks ?? 5;
    }

    // Step 5: insert mesocycle_run. The partial unique index will reject
    // if another active run already exists for this user (23505).
    let runId: string;
    try {
      const { rows: [run] } = await client.query<{ id: string }>(
        `INSERT INTO mesocycle_runs (user_program_id, user_id, start_date, start_tz, weeks, status)
         SELECT $1, user_id, $2::date, $3, $4, 'active'
         FROM user_programs WHERE id=$1
         RETURNING id`,
        [input.userProgramId, input.startDate, input.startTz, weeks],
      );
      runId = run.id;
    } catch (e: any) {
      if (e?.code === '23505') {
        await client.query('ROLLBACK');
        throw new ActiveRunExistsError();
      }
      throw e;
    }

    // Step 6: day_workouts (UNNEST bulk insert).
    const dayRows: { week_idx: number; day_idx: number; scheduled_date: string; kind: string; name: string }[] = [];
    for (let w = 1; w <= weeks; w++) {
      for (const d of structure.days) {
        const offset = (w - 1) * 7 + d.day_offset;
        dayRows.push({
          week_idx: w, day_idx: d.idx,
          scheduled_date: addDaysISO(input.startDate, offset),
          kind: d.kind, name: d.name,
        });
      }
    }
    const dayIdMap = new Map<string, string>(); // (week_idx,day_idx) → day_workout_id
    if (dayRows.length > 0) {
      const { rows: dwInserted } = await client.query<{ id: string; week_idx: number; day_idx: number }>(
        `INSERT INTO day_workouts (mesocycle_run_id, week_idx, day_idx, scheduled_date, kind, name)
         SELECT $1, w, d, sd::date, k, n
         FROM unnest($2::int[], $3::int[], $4::text[], $5::day_workout_kind[], $6::text[])
              AS t(w, d, sd, k, n)
         RETURNING id, week_idx, day_idx`,
        [
          runId,
          dayRows.map(r => r.week_idx),
          dayRows.map(r => r.day_idx),
          dayRows.map(r => r.scheduled_date),
          dayRows.map(r => r.kind),
          dayRows.map(r => r.name),
        ],
      );
      for (const r of dwInserted) dayIdMap.set(`${r.week_idx}|${r.day_idx}`, r.id);
    }

    // Lookup exercise IDs for all referenced slugs in one round-trip.
    const allSlugs = Array.from(new Set(structure.days.flatMap(d => d.blocks.map(b => b.exercise_slug))));
    const { rows: exRows } = await client.query<{ id: string; slug: string; primary_muscle_slug: string }>(
      `SELECT e.id, e.slug, m.slug AS primary_muscle_slug
       FROM exercises e JOIN muscles m ON m.id = e.primary_muscle_id
       WHERE e.slug = ANY($1::text[]) AND e.archived_at IS NULL`,
      [allSlugs],
    );
    const exBySlug = new Map(exRows.map(r => [r.slug, r]));

    // Step 7: planned_sets / planned_cardio_blocks via UNNEST.
    // Group blocks-of-the-week by primary_muscle so the ramp + distributor
    // can split a muscle's weekly target across that muscle's blocks-of-the-week.
    const setRows: {
      day_workout_id: string; block_idx: number; set_idx: number;
      exercise_id: string; reps_low: number; reps_high: number;
      rir: number; rest: number;
    }[] = [];
    const cardioRows: {
      day_workout_id: string; block_idx: number; exercise_id: string;
      duration_sec: number | null; distance_m: number | null; zone: number | null;
    }[] = [];

    for (let w = 1; w <= weeks; w++) {
      // Group blocks across all days in this week by primary_muscle.
      type GroupBlock = { dayIdx: number; blockIdx: number; block: Block; exerciseId: string; mev: number };
      const muscleGroups = new Map<string, GroupBlock[]>();
      for (const d of structure.days) {
        d.blocks.forEach((b, blockIdx) => {
          if (b.cardio) return;
          const ex = exBySlug.get(b.exercise_slug);
          if (!ex) throw new Error(`exercise slug missing: ${b.exercise_slug}`);
          const key = ex.primary_muscle_slug;
          const list = muscleGroups.get(key) ?? [];
          list.push({ dayIdx: d.idx, blockIdx, block: b, exerciseId: ex.id, mev: b.mev });
          muscleGroups.set(key, list);
        });
      }

      // For each muscle, compute week target from landmarks then distribute.
      for (const [muscleSlug, blocks] of muscleGroups) {
        const lm = MUSCLE_LANDMARKS[muscleSlug];
        if (!lm) continue;
        const weekTarget = computeRamp({ mev: lm.mev, mav: lm.mav, mrv: lm.mrv, week: w, totalWeeks: weeks });
        const dist = distributeWeekTargetAcrossBlocks(
          blocks.map(b => ({ blockKey: `${b.dayIdx}|${b.blockIdx}`, mev: b.mev })),
          weekTarget,
        );
        const setsByKey = new Map(dist.map(d => [d.blockKey, d.sets]));
        for (const gb of blocks) {
          const sets = setsByKey.get(`${gb.dayIdx}|${gb.blockIdx}`) ?? 0;
          const dwId = dayIdMap.get(`${w}|${gb.dayIdx}`);
          if (!dwId) continue;
          for (let s = 0; s < sets; s++) {
            setRows.push({
              day_workout_id: dwId, block_idx: gb.blockIdx, set_idx: s,
              exercise_id: gb.exerciseId,
              reps_low: gb.block.target_reps_low,
              reps_high: gb.block.target_reps_high,
              rir: gb.block.target_rir,
              rest: gb.block.rest_sec,
            });
          }
        }
      }

      // Cardio blocks pass through untouched (one row per block per week per day).
      for (const d of structure.days) {
        d.blocks.forEach((b, blockIdx) => {
          if (!b.cardio) return;
          const ex = exBySlug.get(b.exercise_slug);
          if (!ex) throw new Error(`cardio exercise slug missing: ${b.exercise_slug}`);
          const dwId = dayIdMap.get(`${w}|${d.idx}`);
          if (!dwId) return;
          cardioRows.push({
            day_workout_id: dwId, block_idx: blockIdx, exercise_id: ex.id,
            duration_sec: b.cardio.target_duration_sec ?? null,
            distance_m: b.cardio.target_distance_m ?? null,
            zone: b.cardio.target_zone ?? null,
          });
        });
      }
    }

    if (setRows.length > 0) {
      await client.query(
        `INSERT INTO planned_sets
           (day_workout_id, block_idx, set_idx, exercise_id,
            target_reps_low, target_reps_high, target_rir, rest_sec)
         SELECT dw, bi, si, ex, rl, rh, ri, rs
         FROM unnest($1::uuid[], $2::int[], $3::int[], $4::uuid[],
                     $5::int[], $6::int[], $7::int[], $8::int[])
              AS t(dw, bi, si, ex, rl, rh, ri, rs)`,
        [
          setRows.map(r => r.day_workout_id),
          setRows.map(r => r.block_idx),
          setRows.map(r => r.set_idx),
          setRows.map(r => r.exercise_id),
          setRows.map(r => r.reps_low),
          setRows.map(r => r.reps_high),
          setRows.map(r => r.rir),
          setRows.map(r => r.rest),
        ],
      );
    }
    if (cardioRows.length > 0) {
      await client.query(
        `INSERT INTO planned_cardio_blocks
           (day_workout_id, block_idx, exercise_id, target_duration_sec, target_distance_m, target_zone)
         SELECT dw, bi, ex, du, di, zo
         FROM unnest($1::uuid[], $2::int[], $3::uuid[], $4::int[], $5::int[], $6::int[])
              AS t(dw, bi, ex, du, di, zo)`,
        [
          cardioRows.map(r => r.day_workout_id),
          cardioRows.map(r => r.block_idx),
          cardioRows.map(r => r.exercise_id),
          cardioRows.map(r => r.duration_sec),
          cardioRows.map(r => r.distance_m),
          cardioRows.map(r => r.zone),
        ],
      );
    }

    // Step 8: started event.
    await client.query(
      `INSERT INTO mesocycle_run_events (run_id, event_type, payload)
       VALUES ($1, 'started', $2::jsonb)`,
      [runId, JSON.stringify({ user_program_id: input.userProgramId })],
    );

    await client.query('COMMIT');
    return { run_id: runId };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* already rolled back */ }
    throw e;
  } finally {
    client.release();
  }
}
