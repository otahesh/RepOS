import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/client.js';
import { requireBearerOrCfAccess } from '../middleware/cfAccess.js';
import { resolveUserProgramStructure } from '../services/resolveUserProgramStructure.js';
import { UserProgramPatchSchema } from '../schemas/userProgramPatch.js';
import {
  materializeMesocycle,
  TemplateOutdatedError,
  ActiveRunExistsError,
} from '../services/materializeMesocycle.js';

const StartBodySchema = z.object({
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
  start_tz: z.string().min(1).max(64),
});

export async function userProgramRoutes(app: FastifyInstance) {
  app.get('/user-programs', { preHandler: requireBearerOrCfAccess }, async (req, _reply) => {
    const userId = (req as any).userId as string;
    const { rows } = await db.query(
      `SELECT id, template_id, template_version, name, customizations, status, created_at, updated_at
       FROM user_programs
       WHERE user_id=$1 AND status <> 'archived'
       ORDER BY created_at DESC`,
      [userId],
    );
    return { programs: rows };
  });

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
      return resolved;
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
        return { error: parsed.error.message, field: parsed.error.issues[0]?.path?.join('.') };
      }

      // Ownership check + load current state (status + customizations + template_id)
      const { rows } = await db.query(
        `SELECT customizations, status, template_id FROM user_programs WHERE id=$1 AND user_id=$2`,
        [req.params.id, userId],
      );
      if (rows.length === 0) {
        reply.code(404);
        return { error: 'user_program not found', field: 'id' };
      }
      if (rows[0].status === 'archived') {
        reply.code(409);
        return { error: 'cannot patch archived program' };
      }

      const cust: any = rows[0].customizations ?? {};
      const op = parsed.data;

      // Reducer — translate schema body to persisted shape
      switch (op.op) {
        case 'rename':
          cust.name_override = op.name;
          break;
        case 'swap_exercise': {
          // Look up template's current block exercise_slug for from_slug capture
          const tmplRow = await db.query(
            `SELECT structure FROM program_templates WHERE id=$1`,
            [rows[0].template_id],
          );
          const days = tmplRow.rows[0]?.structure?.days;
          const block = days?.[op.day_idx]?.blocks?.[op.block_idx];
          if (!block || !block.exercise_slug) {
            reply.code(400);
            return { error: 'invalid block coordinates', field: 'block_idx' };
          }
          const fromSlug = block.exercise_slug;
          cust.swaps = (cust.swaps ?? []).filter((s: any) =>
            !(s.week_idx === 1 && s.day_idx === op.day_idx && s.block_idx === op.block_idx)
          );
          cust.swaps.push({
            week_idx: 1, day_idx: op.day_idx, block_idx: op.block_idx,
            from_slug: fromSlug, to_slug: op.to_exercise_slug,
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

      const { rows: [updated] } = await db.query(
        `UPDATE user_programs SET customizations=$1::jsonb, updated_at=now()
         WHERE id=$2 AND user_id=$3
         RETURNING id, template_id, template_version, name, customizations, status, updated_at`,
        [JSON.stringify(cust), req.params.id, userId],
      );
      return updated;
    },
  );

  app.post<{ Params: { id: string }; Body: unknown }>(
    '/user-programs/:id/start',
    { preHandler: requireBearerOrCfAccess },
    async (req, reply) => {
      const userId = (req as any).userId as string;
      const parsed = StartBodySchema.safeParse(req.body);
      if (!parsed.success) {
        reply.code(400);
        return { error: parsed.error.message, field: parsed.error.issues[0]?.path?.join('.') };
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
          `SELECT id, start_date, start_tz, weeks, status, current_week
           FROM mesocycle_runs WHERE id=$1`,
          [run_id],
        );
        reply.code(201);
        // Normalize date column to YYYY-MM-DD string
        const startDateStr = (run.start_date instanceof Date)
          ? run.start_date.toISOString().slice(0, 10)
          : String(run.start_date).slice(0, 10);
        return {
          mesocycle_run_id: run.id,
          start_date: startDateStr,
          start_tz: run.start_tz,
          weeks: run.weeks,
          status: run.status,
          current_week: run.current_week,
        };
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
