import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { requireBearerOrCfAccess } from '../middleware/cfAccess.js';
import { requireScope } from '../middleware/scope.js';
import { db } from '../db/client.js';
import { computeStats } from '../services/stats.js';
import {
  WeightSampleSchema,
  WeightBackfillSchema,
  WeightRangeQuerySchema,
  type WeightSampleResponse,
  type WeightBackfillResponse,
  type WeightRangeResponse,
} from '../schemas/healthWeight.js';

const MAX_BACKFILL_SAMPLES = 500;

// ---------------------------------------------------------------------------
// Validation helpers — translate Zod errors into the { error, field } shape
// the existing tests and API spec require.
// ---------------------------------------------------------------------------

function validate(body: unknown): { error: string; field: string } | null {
  const result = WeightSampleSchema.safeParse(body);
  if (result.success) return null;

  // Map the first Zod issue back to { error, field } so the API contract
  // is unchanged and existing tests continue to pass without modification.
  const issue = result.error.issues[0];
  const field = issue.path[0]?.toString() ?? 'unknown';
  return { error: issue.message, field };
}

// client param allows backfill to share its transaction so rate-limit increments roll back on error
async function upsertSample(
  userId: string,
  body: { weight_lbs: number; date: string; time: string; source: string },
  _ip: string,
  client?: PoolClient,
): Promise<{ status: number; body: WeightSampleResponse | { error: string } }> {
  const qr = client ?? db;
  const { weight_lbs, date, time, source } = body;
  const rounded = Math.round(weight_lbs * 10) / 10;

  // Rate limit: >5 writes per (user, date) per calendar day
  const { rows: [logRow] } = await qr.query(
    `INSERT INTO weight_write_log (user_id, log_date, write_count)
     VALUES ($1, $2, 1)
     ON CONFLICT (user_id, log_date) DO UPDATE
       SET write_count = weight_write_log.write_count + 1
     RETURNING write_count`,
    [userId, date],
  );
  if (logRow.write_count > 5) {
    return { status: 409, body: { error: 'rate_limited' } };
  }

  // Dedupe check
  const { rows: existing } = await qr.query(
    `SELECT id, weight_lbs::float AS weight_lbs FROM health_weight_samples
     WHERE user_id = $1 AND sample_date = $2 AND source = $3`,
    [userId, date, source],
  );

  let id: number;
  let deduped = true;

  if (existing.length > 0) {
    const diff = Math.abs(rounded - existing[0].weight_lbs);
    if (diff > 0.05) {
      await qr.query(
        `UPDATE health_weight_samples SET weight_lbs = $1, sample_time = $2, updated_at = now()
         WHERE id = $3`,
        [rounded, time, existing[0].id],
      );
    }
    id = existing[0].id;
  } else {
    const { rows } = await qr.query(
      `INSERT INTO health_weight_samples (user_id, sample_date, sample_time, weight_lbs, source)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [userId, date, time, rounded, source],
    );
    id = rows[0].id;
    deduped = false;
  }

  // Update sync status
  await qr.query(
    `INSERT INTO health_sync_status (user_id, source, last_fired_at, last_success_at, last_error, consecutive_failures)
     VALUES ($1, $2, now(), now(), NULL, 0)
     ON CONFLICT (user_id) DO UPDATE SET
       last_fired_at = now(), last_success_at = now(),
       last_error = NULL, consecutive_failures = 0`,
    [userId, source],
  );

  return { status: deduped ? 200 : 201, body: { id, date, weight_lbs: rounded, deduped } };
}

export async function weightRoutes(app: FastifyInstance) {
  app.post(
    '/weight',
    { preHandler: [requireBearerOrCfAccess, requireScope('health:weight:write')] },
    async (req, reply) => {
      const userId = req.userId;
      if (!userId) return reply.code(500).send({ error: 'auth_state_missing' });

      const err = validate(req.body);
      if (err) return reply.code(400).send(err);

      const parsed = WeightSampleSchema.parse(req.body);
      const { status, body: resBody } = await upsertSample(userId, parsed, req.ip);
      return reply.code(status).send(resBody);
    },
  );

  app.post(
    '/weight/backfill',
    { preHandler: [requireBearerOrCfAccess, requireScope('health:weight:write')] },
    async (req, reply) => {
      const userId = req.userId;
      if (!userId) return reply.code(500).send({ error: 'auth_state_missing' });

      const rawBody = req.body as unknown;
      if (
        typeof rawBody !== 'object' ||
        rawBody === null ||
        !Array.isArray((rawBody as Record<string, unknown>).samples)
      ) {
        return reply.code(400).send({ error: 'samples must be an array' });
      }

      const samples = (rawBody as { samples: unknown[] }).samples;

      if (samples.length > MAX_BACKFILL_SAMPLES) {
        return reply.code(400).send({
          error: `samples array exceeds maximum of ${MAX_BACKFILL_SAMPLES} items`,
        });
      }

      // Validate all items before touching the DB; keep existing { error, field } shape
      for (const sample of samples) {
        const err = validate(sample);
        if (err) return reply.code(400).send(err);
      }

      // Re-parse as typed after validation
      const backfill = WeightBackfillSchema.parse(rawBody);

      // Use an explicit client so the transaction covers rate-limit increments too —
      // a mid-batch error rolls back everything including write_count increments.
      const client = await db.connect();
      let created = 0;
      let deduped = 0;
      try {
        await client.query('BEGIN');
        for (const sample of backfill.samples) {
          const result = await upsertSample(userId, sample, req.ip, client);
          if (result.status === 201) created++;
          else deduped++;
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }

      const response: WeightBackfillResponse = { created, deduped };
      return reply.send(response);
    },
  );

  app.get('/weight', { preHandler: requireBearerOrCfAccess }, async (req, reply) => {
    const userId = req.userId;
    if (!userId) return reply.code(500).send({ error: 'auth_state_missing' });

    const queryResult = WeightRangeQuerySchema.safeParse(req.query);
    const { range } = queryResult.success ? queryResult.data : { range: '90d' as const };

    const rangeMap: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90, '1y': 365, 'all': 36500 };
    const days = rangeMap[range] ?? 90;
    const since = new Date();
    since.setDate(since.getDate() - days);

    const { samples, current, trend7d, trend30d, trend90d, adherencePct, missedDays } =
      await computeStats(userId, since);

    // Sync block
    const { rows: [sync] } = await db.query(
      `SELECT source, last_success_at,
         CASE
           WHEN last_success_at > now() - interval '36 hours' THEN 'fresh'
           WHEN last_success_at > now() - interval '72 hours' THEN 'stale'
           ELSE 'broken'
         END AS state
       FROM health_sync_status WHERE user_id = $1`,
      [userId],
    );

    reply.header('Cache-Control', 'no-store');

    const response: WeightRangeResponse = {
      current: current ?? null,
      samples,
      stats: {
        trend_7d_lbs: trend7d,
        trend_30d_lbs: trend30d,
        trend_90d_lbs: trend90d,
        adherence_pct: adherencePct,
        missed_days: missedDays,
      },
      sync: sync ?? null,
    };

    return response;
  });
}
