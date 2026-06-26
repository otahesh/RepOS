import type { FastifyInstance } from 'fastify';
import { requireUserId } from '../utils/requestIdentity.js';
import { db } from '../db/client.js';
import { requireBearerOrCfAccess } from '../middleware/cfAccess.js';
import { resolveUserProgramStructure } from '../services/resolveUserProgramStructure.js';
import { UserProgramPatchSchema } from '../schemas/userProgramPatch.js';
import {
  materializeMesocycle,
  TemplateOutdatedError,
  ActiveRunExistsError,
} from '../services/materializeMesocycle.js';
import { validateFrequencyLimits, validateCardioScheduling } from '../services/scheduleRules.js';
import { zodToFieldError } from '../utils/zodToFieldError.js';
import { UuidParamSchema } from '../schemas/idParams.js';
import type { UserProgramCustomizations } from '../schemas/userProgramCustomizations.js';
import {
  UserProgramStartRequestSchema,
  UserProgramStartIntentQuerySchema,
  UserProgramListQuerySchema,
  type UserProgramListResponse,
  type UserProgramDetailResponse,
  type UserProgramPatchResponse,
  type UserProgramWarningsResponse,
  type UserProgramStartResponse,
  type ProgramMesocyclesResponse,
} from '../schemas/userPrograms.js';

export async function userProgramRoutes(app: FastifyInstance) {
  // default          → active programs only: archived_at IS NULL AND status IN (draft,active,paused)
  // ?include=past     → all non-archived (client filters to completed/abandoned)
  // ?include=archived → archived programs only (archived_at IS NOT NULL)
  app.get<{ Querystring: { include?: string } }>(
    '/user-programs',
    { preHandler: requireBearerOrCfAccess },
    async (req, reply) => {
      const userId = requireUserId(req);
      const q = UserProgramListQuerySchema.safeParse(req.query);
      if (!q.success) {
        reply.code(400);
        return zodToFieldError(q.error);
      }
      const include = q.data.include;
      // LEFT JOIN program_templates to carry template_slug through to the client
      // so the fork-wizard "Restart" action can navigate to /programs/:slug.
      const cols = `up.id, up.template_id, pt.slug AS template_slug, up.template_version,
                    up.name, up.customizations, up.status, up.created_at, up.updated_at,
                    EXISTS (
                      SELECT 1 FROM mesocycle_runs mr
                      WHERE mr.user_program_id = up.id AND mr.status IN ('active','paused')
                    ) AS has_live_run`;
      let where: string;
      if (include === 'archived') {
        where = `up.user_id=$1 AND up.archived_at IS NOT NULL`;
      } else if (include === 'past') {
        where = `up.user_id=$1 AND up.archived_at IS NULL`;
      } else {
        where = `up.user_id=$1 AND up.archived_at IS NULL AND up.status IN ('draft','active','paused')`;
      }
      const { rows } = await db.query(
        `SELECT ${cols}
         FROM user_programs up
         LEFT JOIN program_templates pt ON pt.id = up.template_id
         WHERE ${where}
         ORDER BY up.created_at DESC`,
        [userId],
      );
      const listResp: UserProgramListResponse = { programs: rows };
      return listResp;
    },
  );

  app.get<{ Params: { id: string } }>(
    '/user-programs/:id',
    { preHandler: requireBearerOrCfAccess },
    async (req, reply) => {
      if (!UuidParamSchema.safeParse(req.params).success) {
        reply.code(404);
        return { error: 'user_program not found', field: 'id' };
      }
      const userId = requireUserId(req);
      const resolved = await resolveUserProgramStructure(req.params.id, userId);
      if (!resolved) {
        reply.code(404);
        return { error: 'user_program not found', field: 'id' };
      }
      const detail: UserProgramDetailResponse = resolved as unknown as UserProgramDetailResponse;
      return detail;
    },
  );

  app.patch<{ Params: { id: string }; Body: unknown }>(
    '/user-programs/:id',
    { preHandler: requireBearerOrCfAccess },
    async (req, reply) => {
      if (!UuidParamSchema.safeParse(req.params).success) {
        reply.code(404);
        return { error: 'user_program not found', field: 'id' };
      }
      const userId = requireUserId(req);
      const parsed = UserProgramPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        reply.code(400);
        return zodToFieldError(parsed.error);
      }

      // Wrap ownership-load + UPDATE + audit-INSERT in a single transaction so a
      // mid-flight failure can't leave customizations changed without a matching
      // 'customized' audit row when an active/paused run exists. Audit row is
      // skipped for draft programs (no run_id to attach to per FK).
      const client = await db.connect();
      let updated: Record<string, unknown> | null = null;
      let badBlock = false;
      let notFound = false;
      let archived = false;
      let auditFromSlug: string | undefined;

      try {
        await client.query('BEGIN');

        // [I-SWAP-RACE] FOR UPDATE on the user_programs row so a double-click
        // can't lose a write under READ COMMITTED — the second PATCH blocks
        // until the first commits, then reads the already-mutated
        // customizations. Protects BOTH swap_exercise and swap_exercise_all
        // (and every other reducer op that read-modify-writes customizations).
        const { rows } = await client.query(
          `SELECT customizations, status, template_id, archived_at FROM user_programs WHERE id=$1 AND user_id=$2 FOR UPDATE`,
          [req.params.id, userId],
        );
        if (rows.length === 0) {
          notFound = true;
          await client.query('ROLLBACK');
        } else if (rows[0].archived_at !== null) {
          archived = true;
          await client.query('ROLLBACK');
        } else {
          const cust: UserProgramCustomizations = rows[0].customizations ?? {};
          const op = parsed.data;

          // Reducer — translate schema body to persisted shape
          switch (op.op) {
            case 'rename':
              cust.name_override = op.name;
              break;
            case 'swap_exercise': {
              // Look up template's current block exercise_slug for from_slug capture
              const tmplRow = await client.query(
                `SELECT structure FROM program_templates WHERE id=$1`,
                [rows[0].template_id],
              );
              const days = tmplRow.rows[0]?.structure?.days;
              const block = days?.[op.day_idx]?.blocks?.[op.block_idx];
              if (!block || !block.exercise_slug) {
                badBlock = true;
                await client.query('ROLLBACK');
                break;
              }
              auditFromSlug = block.exercise_slug;
              cust.swaps = (cust.swaps ?? []).filter(
                (s) =>
                  !(s.week_idx === 1 && s.day_idx === op.day_idx && s.block_idx === op.block_idx),
              );
              cust.swaps.push({
                week_idx: 1,
                day_idx: op.day_idx,
                block_idx: op.block_idx,
                from_slug: block.exercise_slug,
                to_slug: op.to_exercise_slug,
              });
              break;
            }
            case 'swap_exercise_all': {
              // [I-SWAP-WEEK-IDX] Verified against
              // api/src/services/resolveUserProgramStructure.ts:126-135 — the
              // resolver applies swap entries with week_idx===1 to the
              // single-week effective_structure blueprint, and materialize
              // (api/src/services/materializeMesocycle.ts) loops the SAME
              // template.structure.days for every week. So a week_idx:1 swap
              // entry IS a program-wide swap (outcome (a) in the plan). No
              // resolver change needed.
              //
              // Look up template structure once; locate every (day_idx,
              // block_idx) whose exercise_slug matches from_slug. Ownership is
              // implicit — the row we SELECTed FOR UPDATE at the top of the
              // route is gated by user_id=$2; the multi-entry rewrite is to
              // customizations on that SAME row. Cross-user contamination is
              // impossible here because we never SELECT or UPDATE a row keyed
              // on anything other than (id, user_id). (Master plan §319: the
              // "every-occurrence" guarantee is about every BLOCK, not every
              // USER — one user_programs row, many customizations entries.)
              const tmplRow = await client.query(
                `SELECT structure FROM program_templates WHERE id=$1`,
                [rows[0].template_id],
              );
              const days = tmplRow.rows[0]?.structure?.days ?? [];
              type Match = { day_idx: number; block_idx: number };
              const matches: Match[] = [];
              for (const d of days) {
                (d.blocks ?? []).forEach((b: any, blockIdx: number) => {
                  if (b.exercise_slug === op.from_slug)
                    matches.push({ day_idx: d.idx, block_idx: blockIdx });
                });
              }
              if (matches.length === 0) {
                badBlock = true; // reuses existing 400 response with field=block_idx
                await client.query('ROLLBACK');
                break;
              }
              // Rewrite each match as an individual swap entry — keeps the
              // per-block ownership model intact (a later swap of (day,block)
              // still works); also record a sibling `swaps_all` audit list.
              cust.swaps = (cust.swaps ?? []).filter(
                (s) =>
                  !matches.some(
                    (m) =>
                      s.week_idx === 1 && s.day_idx === m.day_idx && s.block_idx === m.block_idx,
                  ),
              );
              for (const m of matches) {
                cust.swaps.push({
                  week_idx: 1,
                  day_idx: m.day_idx,
                  block_idx: m.block_idx,
                  from_slug: op.from_slug,
                  to_slug: op.to_exercise_slug,
                });
              }
              cust.swaps_all = [
                ...(cust.swaps_all ?? []),
                { from_slug: op.from_slug, to_slug: op.to_exercise_slug },
              ];
              auditFromSlug = op.from_slug;
              break;
            }
            case 'add_set':
            case 'remove_set': {
              const delta = op.op === 'add_set' ? +1 : -1;
              // Aggregate existing override at the same coords (sum deltas)
              const existing = (cust.set_count_overrides ?? []).find(
                (s) => s.week_idx === 1 && s.day_idx === op.day_idx && s.block_idx === op.block_idx,
              );
              if (existing) {
                existing.delta += delta;
              } else {
                cust.set_count_overrides = [
                  ...(cust.set_count_overrides ?? []),
                  {
                    week_idx: 1,
                    day_idx: op.day_idx,
                    block_idx: op.block_idx,
                    delta,
                  },
                ];
              }
              break;
            }
            case 'shift_weekday':
              cust.day_offset_overrides = (cust.day_offset_overrides ?? []).filter(
                (s) => !(s.week_idx === 1 && s.day_idx === op.day_idx),
              );
              cust.day_offset_overrides.push({
                week_idx: 1,
                day_idx: op.day_idx,
                new_day_offset: op.to_day_offset,
              });
              break;
            case 'skip_day':
              cust.skipped_days = (cust.skipped_days ?? []).filter(
                (s) => !(s.week_idx === op.week_idx && s.day_idx === op.day_idx),
              );
              cust.skipped_days.push({ week_idx: op.week_idx, day_idx: op.day_idx });
              break;
            case 'change_rir':
              cust.rir_overrides = (cust.rir_overrides ?? []).filter(
                (s) =>
                  !(
                    s.week_idx === op.week_idx &&
                    s.day_idx === op.day_idx &&
                    s.block_idx === op.block_idx
                  ),
              );
              cust.rir_overrides.push({
                week_idx: op.week_idx,
                day_idx: op.day_idx,
                block_idx: op.block_idx,
                target_rir: op.target_rir,
              });
              break;
            case 'trim_week':
              cust.trim_last_n = op.drop_last_n;
              break;
          }

          if (!badBlock) {
            const upd = await client.query(
              `UPDATE user_programs SET customizations=$1::jsonb, updated_at=now()
               WHERE id=$2 AND user_id=$3
               RETURNING id, template_id, template_version, name, customizations, status, updated_at`,
              [JSON.stringify(cust), req.params.id, userId],
            );
            updated = upd.rows[0];

            // Forensic audit (Q20): record post-/start customizations against the
            // run they affect. Skipped for draft programs (run_id FK is NOT NULL).
            // Most-recent active or paused run for this user_program; completed
            // and abandoned runs are intentionally excluded.
            const { rows: runRows } = await client.query<{ id: string }>(
              `SELECT id FROM mesocycle_runs
               WHERE user_program_id = $1 AND status IN ('active','paused')
               ORDER BY created_at DESC LIMIT 1`,
              [req.params.id],
            );
            if (runRows.length > 0) {
              const auditPayload: Record<string, unknown> = { ...parsed.data };
              if (op.op === 'swap_exercise' && auditFromSlug) {
                auditPayload.from_slug = auditFromSlug;
              }
              await client.query(
                `INSERT INTO mesocycle_run_events (run_id, event_type, payload)
                 VALUES ($1, 'customized', $2::jsonb)`,
                [runRows[0].id, JSON.stringify(auditPayload)],
              );
            }

            await client.query('COMMIT');
          }
        }
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }

      if (notFound) {
        reply.code(404);
        return { error: 'user_program not found', field: 'id' };
      }
      if (archived) {
        reply.code(409);
        return { error: 'cannot patch archived program' };
      }
      if (badBlock) {
        reply.code(400);
        return { error: 'invalid block coordinates', field: 'block_idx' };
      }
      return updated as UserProgramPatchResponse;
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/user-programs/:id',
    { preHandler: requireBearerOrCfAccess },
    async (req, reply) => {
      if (!UuidParamSchema.safeParse(req.params).success) {
        reply.code(404);
        return { error: 'user_program not found', field: 'id' };
      }
      const userId = requireUserId(req);
      // Single DELETE; all children (mesocycle_runs → day_workouts →
      // planned_sets → set_logs / planned_cardio_blocks / run_events) cascade
      // via ON DELETE CASCADE FKs. Ownership scoped in the WHERE clause.
      const { rowCount } = await db.query(
        `DELETE FROM user_programs WHERE id=$1 AND user_id=$2`,
        [req.params.id, userId],
      );
      if (rowCount === 0) {
        reply.code(404);
        return { error: 'user_program not found', field: 'id' };
      }
      return reply.code(204).send();
    },
  );

  app.post<{ Params: { id: string } }>(
    '/user-programs/:id/archive',
    { preHandler: requireBearerOrCfAccess },
    async (req, reply) => {
      if (!UuidParamSchema.safeParse(req.params).success) {
        reply.code(404);
        return { error: 'user_program not found', field: 'id' };
      }
      const userId = requireUserId(req);
      const owned = await db.query(`SELECT 1 FROM user_programs WHERE id=$1 AND user_id=$2`, [
        req.params.id,
        userId,
      ]);
      if (owned.rows.length === 0) {
        reply.code(404);
        return { error: 'user_program not found', field: 'id' };
      }
      // Guard on a live RUN, not user_programs.status: starting a mesocycle does
      // not flip the program's status, so status is an unreliable signal here.
      const live = await db.query(
        `SELECT 1 FROM mesocycle_runs
         WHERE user_program_id=$1 AND status IN ('active','paused') LIMIT 1`,
        [req.params.id],
      );
      if (live.rows.length > 0) {
        reply.code(409);
        return {
          error: 'Finish or abandon the in-progress mesocycle before archiving this program.',
          field: 'status',
        };
      }
      await db.query(
        `UPDATE user_programs SET archived_at=now(), updated_at=now() WHERE id=$1 AND user_id=$2`,
        [req.params.id, userId],
      );
      return { ok: true };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/user-programs/:id/unarchive',
    { preHandler: requireBearerOrCfAccess },
    async (req, reply) => {
      if (!UuidParamSchema.safeParse(req.params).success) {
        reply.code(404);
        return { error: 'user_program not found', field: 'id' };
      }
      const userId = requireUserId(req);
      const { rowCount } = await db.query(
        `UPDATE user_programs SET archived_at=NULL, updated_at=now()
         WHERE id=$1 AND user_id=$2 AND archived_at IS NOT NULL`,
        [req.params.id, userId],
      );
      if (rowCount === 0) {
        reply.code(404);
        return { error: 'archived user_program not found', field: 'id' };
      }
      return { ok: true };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/user-programs/:id/warnings',
    { preHandler: requireBearerOrCfAccess },
    async (req, reply) => {
      if (!UuidParamSchema.safeParse(req.params).success) {
        reply.code(404);
        return { error: 'user_program not found', field: 'id' };
      }
      const userId = requireUserId(req);
      const resolved = await resolveUserProgramStructure(req.params.id, userId);
      if (!resolved) {
        reply.code(404);
        return { error: 'user_program not found', field: 'id' };
      }
      const structure = resolved.effective_structure;
      const warnings = [
        ...validateFrequencyLimits(structure),
        ...validateCardioScheduling(structure),
      ];
      const warningsResp: UserProgramWarningsResponse = { warnings };
      return warningsResp;
    },
  );

  // List this program's mesocycle runs, newest first. Powers the prior-
  // mesocycle-recap entry point on the Past tab (WS6 / D6 / G7). Ownership is
  // enforced by the user_program row's user_id — a non-owner (or unknown id)
  // gets 404, never another user's runs.
  app.get<{ Params: { id: string } }>(
    '/user-programs/:id/mesocycles',
    { preHandler: requireBearerOrCfAccess },
    async (req, reply) => {
      if (!UuidParamSchema.safeParse(req.params).success) {
        reply.code(404);
        return { error: 'user_program not found', field: 'id' };
      }
      const userId = requireUserId(req);
      const { rows: owns } = await db.query(
        `SELECT 1 FROM user_programs WHERE id=$1 AND user_id=$2`,
        [req.params.id, userId],
      );
      if (owns.length === 0) {
        reply.code(404);
        return { error: 'user_program not found', field: 'id' };
      }
      const { rows } = await db.query(
        `SELECT id,
                status,
                to_char(start_date, 'YYYY-MM-DD') AS start_date,
                finished_at,
                is_deload,
                weeks
         FROM mesocycle_runs
         WHERE user_program_id=$1 AND user_id=$2
         ORDER BY created_at DESC`,
        [req.params.id, userId],
      );
      const resp: ProgramMesocyclesResponse = {
        mesocycles: rows as ProgramMesocyclesResponse['mesocycles'],
      };
      return resp;
    },
  );

  app.post<{ Params: { id: string }; Querystring: { intent?: string }; Body: unknown }>(
    '/user-programs/:id/start',
    { preHandler: requireBearerOrCfAccess },
    async (req, reply) => {
      if (!UuidParamSchema.safeParse(req.params).success) {
        reply.code(404);
        return { error: 'user_program not found', field: 'id' };
      }
      const userId = requireUserId(req);
      // [C-RUN-IT-BACK-ROUTE] Parse the ?intent= query guard FIRST so
      // `?intent=garbage` is a clean 400 before any body work.
      const queryParsed = UserProgramStartIntentQuerySchema.safeParse(req.query);
      if (!queryParsed.success) {
        reply.code(400);
        return zodToFieldError(queryParsed.error);
      }
      const parsed = UserProgramStartRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        reply.code(400);
        return zodToFieldError(parsed.error);
      }
      // Query intent wins over body intent; default 'normal'.
      const intent = queryParsed.data.intent ?? parsed.data.intent ?? 'normal';
      // Ownership check
      const { rows } = await db.query(`SELECT id FROM user_programs WHERE id=$1 AND user_id=$2`, [
        req.params.id,
        userId,
      ]);
      if (rows.length === 0) {
        reply.code(404);
        return { error: 'user_program not found', field: 'id' };
      }
      try {
        const { run_id } = await materializeMesocycle({
          userProgramId: req.params.id,
          startDate: parsed.data.start_date,
          startTz: parsed.data.start_tz,
          intent, // [C-RUN-IT-BACK-ROUTE] deload math runs in-txn (materialize service)
        });
        // Enrich response with mesocycle_runs row
        const {
          rows: [run],
        } = await db.query(
          `SELECT id, to_char(start_date, 'YYYY-MM-DD') AS start_date, start_tz, weeks, status, current_week, is_deload
           FROM mesocycle_runs WHERE id=$1`,
          [run_id],
        );
        const startResp: UserProgramStartResponse = {
          mesocycle_run_id: run.id,
          start_date: run.start_date,
          start_tz: run.start_tz,
          weeks: run.weeks,
          status: run.status,
          current_week: run.current_week,
          is_deload: run.is_deload,
        };
        reply.code(201);
        return startResp;
      } catch (err) {
        if (err instanceof TemplateOutdatedError || err instanceof ActiveRunExistsError) {
          reply.code(err.status);
          return err.toJSON();
        }
        throw err;
      }
    },
  );
}
