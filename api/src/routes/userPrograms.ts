import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { requireBearerOrCfAccess } from '../middleware/cfAccess.js';
import { resolveUserProgramStructure } from '../services/resolveUserProgramStructure.js';
import { UserProgramPatchSchema } from '../schemas/userProgramPatch.js';
import {
  materializeMesocycle,
  TemplateOutdatedError,
  ActiveRunExistsError,
} from '../services/materializeMesocycle.js';
import {
  validateFrequencyLimits,
  validateCardioScheduling,
} from '../services/scheduleRules.js';
import { zodToFieldError } from '../utils/zodToFieldError.js';
import {
  UserProgramStartRequestSchema,
  type UserProgramListResponse,
  type UserProgramDetailResponse,
  type UserProgramPatchResponse,
  type UserProgramWarningsResponse,
  type UserProgramStartResponse,
} from '../schemas/userPrograms.js';

export async function userProgramRoutes(app: FastifyInstance) {
  // ?include=past  → returns active + abandoned + completed (excludes only 'archived')
  // default        → returns active programs only (status IN ('draft','active','paused'))
  app.get<{ Querystring: { include?: string } }>(
    '/user-programs',
    { preHandler: requireBearerOrCfAccess },
    async (req, _reply) => {
      const userId = (req as any).userId as string;
      const includePast = req.query.include === 'past';
      // LEFT JOIN program_templates to carry template_slug through to the client
      // so the fork-wizard "Restart" action can navigate to /programs/:slug
      // without a second round-trip.
      const { rows } = await db.query(
        includePast
          ? `SELECT up.id, up.template_id, pt.slug AS template_slug, up.template_version,
                    up.name, up.customizations, up.status, up.created_at, up.updated_at
             FROM user_programs up
             LEFT JOIN program_templates pt ON pt.id = up.template_id
             WHERE up.user_id=$1 AND up.status <> 'archived'
             ORDER BY up.created_at DESC`
          : `SELECT up.id, up.template_id, pt.slug AS template_slug, up.template_version,
                    up.name, up.customizations, up.status, up.created_at, up.updated_at
             FROM user_programs up
             LEFT JOIN program_templates pt ON pt.id = up.template_id
             WHERE up.user_id=$1 AND up.status IN ('draft','active','paused')
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
      const userId = (req as any).userId as string;
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
      const userId = (req as any).userId as string;
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

        const { rows } = await client.query(
          `SELECT customizations, status, template_id FROM user_programs WHERE id=$1 AND user_id=$2`,
          [req.params.id, userId],
        );
        if (rows.length === 0) {
          notFound = true;
          await client.query('ROLLBACK');
        } else if (rows[0].status === 'archived') {
          archived = true;
          await client.query('ROLLBACK');
        } else {
          const cust: any = rows[0].customizations ?? {};
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
              cust.swaps = (cust.swaps ?? []).filter((s: any) =>
                !(s.week_idx === 1 && s.day_idx === op.day_idx && s.block_idx === op.block_idx)
              );
              cust.swaps.push({
                week_idx: 1, day_idx: op.day_idx, block_idx: op.block_idx,
                from_slug: auditFromSlug, to_slug: op.to_exercise_slug,
              });
              break;
            }
            case 'add_set':
            case 'remove_set': {
              const delta = op.op === 'add_set' ? +1 : -1;
              // Aggregate existing override at the same coords (sum deltas)
              const existing = (cust.set_count_overrides ?? []).find((s: any) =>
                s.week_idx === 1 && s.day_idx === op.day_idx && s.block_idx === op.block_idx
              );
              if (existing) {
                existing.delta += delta;
              } else {
                cust.set_count_overrides = [...(cust.set_count_overrides ?? []), {
                  week_idx: 1, day_idx: op.day_idx, block_idx: op.block_idx, delta,
                }];
              }
              break;
            }
            case 'shift_weekday':
              cust.day_offset_overrides = (cust.day_offset_overrides ?? []).filter((s: any) =>
                !(s.week_idx === 1 && s.day_idx === op.day_idx)
              );
              cust.day_offset_overrides.push({
                week_idx: 1, day_idx: op.day_idx, new_day_offset: op.to_day_offset,
              });
              break;
            case 'skip_day':
              cust.skipped_days = (cust.skipped_days ?? []).filter((s: any) =>
                !(s.week_idx === op.week_idx && s.day_idx === op.day_idx)
              );
              cust.skipped_days.push({ week_idx: op.week_idx, day_idx: op.day_idx });
              break;
            case 'change_rir':
              cust.rir_overrides = (cust.rir_overrides ?? []).filter((s: any) =>
                !(s.week_idx === op.week_idx && s.day_idx === op.day_idx && s.block_idx === op.block_idx)
              );
              cust.rir_overrides.push({
                week_idx: op.week_idx, day_idx: op.day_idx, block_idx: op.block_idx,
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

  app.get<{ Params: { id: string } }>(
    '/user-programs/:id/warnings',
    { preHandler: requireBearerOrCfAccess },
    async (req, reply) => {
      const userId = (req as any).userId as string;
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

  app.post<{ Params: { id: string }; Body: unknown }>(
    '/user-programs/:id/start',
    { preHandler: requireBearerOrCfAccess },
    async (req, reply) => {
      const userId = (req as any).userId as string;
      const parsed = UserProgramStartRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        reply.code(400);
        return zodToFieldError(parsed.error);
      }
      // Ownership check
      const { rows } = await db.query(
        `SELECT id FROM user_programs WHERE id=$1 AND user_id=$2`,
        [req.params.id, userId],
      );
      if (rows.length === 0) {
        reply.code(404);
        return { error: 'user_program not found', field: 'id' };
      }
      try {
        const { run_id } = await materializeMesocycle({
          userProgramId: req.params.id,
          startDate: parsed.data.start_date,
          startTz: parsed.data.start_tz,
        });
        // Enrich response with mesocycle_runs row
        const { rows: [run] } = await db.query(
          `SELECT id, to_char(start_date, 'YYYY-MM-DD') AS start_date, start_tz, weeks, status, current_week
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
