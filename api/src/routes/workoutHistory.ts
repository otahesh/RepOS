import type { FastifyInstance } from 'fastify';
import { requireBearerOrCfAccess } from '../middleware/cfAccess.js';
import { db } from '../db/client.js';

// ---------------------------------------------------------------------------
// Sequence-workouts Task 4 — GET /workouts/history.
//
// Workout-grain history: the requesting user's terminal (completed/skipped)
// day_workouts across ALL their mesocycle runs (any run status), newest
// first, each carrying its logged sets grouped by exercise.
//
// Auth: requireBearerOrCfAccess only — same posture as dayWorkouts.ts. No
// requireScope: this is a webapp-first read; CF Access gates identity at the
// edge on the cookie path. Ownership is enforced in the JOIN
// (mr.user_id = $userId), so another user's rows are simply invisible.
//
// NULL-safe keyset pagination: skipped rows have NULL completed_at, so a raw
// (completed_at, id) row-comparison cursor would silently drop them (NULL
// comparisons are never true). We order and page on
// sort_ts = COALESCE(completed_at, '-infinity'::timestamptz) — skipped rows
// sort last as one -infinity block, tie-broken by id DESC, and the cursor
// `(<sort_ts>, <id>) < (<cursor_ts>, <cursor_id>)` walks through them
// without overlap or drops.
//
// The cursor string is `<ts>|<id>` where <ts> is either the literal
// '-infinity' or a microsecond-precision UTC ISO stamp. Microseconds matter:
// completed_at is timestamptz (µs precision) and a millisecond-truncated JS
// Date cursor could drop rows landing between the truncated and the real
// stamp — so cursor_ts is rendered by Postgres via to_char(... 'US') and
// passed back verbatim.
//
// N+1 avoidance: one query for the page of day_workouts, then ONE query for
// all their set_logs (ps.day_workout_id = ANY($ids)), grouped in JS.
// ---------------------------------------------------------------------------

const CURSOR_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{1,6}Z$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parse `<ts ISO or '-infinity'>|<uuid>`; null on any malformation. The ts
 *  regex is deliberately strict (what we emit is what we accept) so nothing
 *  un-parseable ever reaches the ::timestamptz cast. */
function parseCursor(raw: string): { ts: string; id: string } | null {
  const sep = raw.indexOf('|');
  if (sep === -1) return null;
  const ts = raw.slice(0, sep);
  const id = raw.slice(sep + 1);
  if (!UUID_RE.test(id)) return null;
  if (ts !== '-infinity' && !CURSOR_TS_RE.test(ts)) return null;
  return { ts, id };
}

/** Clamp ?limit to 1..50; default 20 on absent/non-numeric input. */
function clampLimit(raw: unknown): number {
  const n = Number(raw);
  if (raw === undefined || raw === '' || !Number.isFinite(n)) return 20;
  return Math.min(50, Math.max(1, Math.trunc(n)));
}

type HistoryDayRow = {
  id: string;
  name: string;
  kind: string;
  week_idx: number;
  day_idx: number;
  status: 'completed' | 'skipped';
  completed_at: Date | null;
  scheduled_date: string; // YYYY-MM-DD
  cursor_ts: string | null; // µs-precision UTC ISO; null when completed_at is
};

type HistorySetRow = {
  day_workout_id: string;
  slug: string;
  exercise_name: string;
  weight_lbs: number | null;
  reps: number | null;
  rir: number | null;
  performed_at: Date;
};

type HistoryExercise = {
  slug: string;
  name: string;
  sets: Array<{
    weight_lbs: number | null;
    reps: number | null;
    rir: number | null;
    performed_at: Date;
  }>;
};

export async function workoutHistoryRoutes(app: FastifyInstance) {
  app.get('/workouts/history', { preHandler: [requireBearerOrCfAccess] }, async (req, reply) => {
    const userId = req.userId;
    if (!userId) return reply.code(500).send({ error: 'auth_state_missing' });

    const query = req.query as { limit?: string; cursor?: string };
    const limit = clampLimit(query.limit);

    let cursor: { ts: string; id: string } | null = null;
    if (query.cursor !== undefined) {
      cursor = parseCursor(query.cursor);
      if (!cursor) {
        return reply.code(400).send({ error: 'invalid cursor', field: 'cursor' });
      }
    }

    const params: unknown[] = [userId];
    let cursorPredicate = '';
    if (cursor) {
      params.push(cursor.ts, cursor.id);
      cursorPredicate = `AND (COALESCE(dw.completed_at, '-infinity'::timestamptz), dw.id)
                             < ($2::timestamptz, $3::uuid)`;
    }
    params.push(limit);

    const { rows: days } = await db.query<HistoryDayRow>(
      `SELECT dw.id, dw.name, dw.kind, dw.week_idx, dw.day_idx, dw.status,
                dw.completed_at,
                to_char(dw.scheduled_date, 'YYYY-MM-DD') AS scheduled_date,
                to_char(dw.completed_at AT TIME ZONE 'UTC',
                        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')  AS cursor_ts
         FROM day_workouts dw
         JOIN mesocycle_runs mr ON mr.id = dw.mesocycle_run_id AND mr.user_id = $1
         WHERE dw.status IN ('completed','skipped')
           ${cursorPredicate}
         ORDER BY COALESCE(dw.completed_at, '-infinity'::timestamptz) DESC, dw.id DESC
         LIMIT $${params.length}`,
      params,
    );

    // One query for the whole page's set logs. Exercise identity comes from
    // planned_sets.exercise_id (what the set was performed against, incl.
    // substitutions). Ownership needs no extra filter — the day_workout ids
    // are already the user's own. performed_load_lbs::float because node-pg
    // returns NUMERIC as string (see SELECT_COLUMNS in setLogs.ts).
    const exercisesByDay = new Map<string, Map<string, HistoryExercise>>();
    if (days.length > 0) {
      const { rows: setRows } = await db.query<HistorySetRow>(
        `SELECT ps.day_workout_id,
                  e.slug, e.name AS exercise_name,
                  sl.performed_load_lbs::float AS weight_lbs,
                  sl.performed_reps             AS reps,
                  sl.performed_rir              AS rir,
                  sl.performed_at
           FROM set_logs sl
           JOIN planned_sets ps ON ps.id = sl.planned_set_id
           JOIN exercises    e  ON e.id  = ps.exercise_id
           WHERE ps.day_workout_id = ANY($1::uuid[])
           ORDER BY ps.day_workout_id, ps.block_idx, ps.set_idx, sl.performed_at`,
        [days.map((d) => d.id)],
      );
      for (const r of setRows) {
        let byExercise = exercisesByDay.get(r.day_workout_id);
        if (!byExercise) {
          byExercise = new Map();
          exercisesByDay.set(r.day_workout_id, byExercise);
        }
        let ex = byExercise.get(r.slug);
        if (!ex) {
          ex = { slug: r.slug, name: r.exercise_name, sets: [] };
          byExercise.set(r.slug, ex); // Map preserves block-order insertion
        }
        ex.sets.push({
          weight_lbs: r.weight_lbs,
          reps: r.reps,
          rir: r.rir,
          performed_at: r.performed_at,
        });
      }
    }

    const items = days.map((d) => ({
      id: d.id,
      name: d.name,
      kind: d.kind,
      week_idx: d.week_idx,
      day_idx: d.day_idx,
      status: d.status,
      completed_at: d.completed_at,
      scheduled_date: d.scheduled_date,
      exercises: [...(exercisesByDay.get(d.id)?.values() ?? [])],
    }));

    // Simplest correct next_cursor: a short page means we ran out of rows.
    // A full page may still be the exact end — the follow-up request then
    // returns an empty page with next_cursor: null, which is fine.
    const last = days[days.length - 1];
    const nextCursor = days.length < limit ? null : `${last.cursor_ts ?? '-infinity'}|${last.id}`;

    return reply.code(200).send({ items, next_cursor: nextCursor });
  });
}
