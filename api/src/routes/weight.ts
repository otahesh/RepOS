import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { requireAuth } from '../middleware/auth.js';
import { db } from '../db/client.js';
import { computeStats } from '../services/stats.js';

const MAX_BACKFILL_SAMPLES = 500;

const VALID_SOURCES = ['Apple Health', 'Manual', 'Withings', 'Renpho'] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}:\d{2}$/;

function validate(body: any): { error: string; field: string } | null {
  const { weight_lbs, date, time, source } = body;
  if (weight_lbs == null || typeof weight_lbs !== 'number' || !isFinite(weight_lbs) || weight_lbs < 50.0 || weight_lbs > 600.0)
    return { error: 'weight_lbs must be between 50.0 and 600.0', field: 'weight_lbs' };
  if (!date || !DATE_RE.test(date))
    return { error: 'date must be YYYY-MM-DD', field: 'date' };
  if (!time || !TIME_RE.test(time))
    return { error: 'time must be HH:MM:SS', field: 'time' };
  if (!VALID_SOURCES.includes(source))
    return { error: `source must be one of: ${VALID_SOURCES.join(', ')}`, field: 'source' };
  return null;
}

// client param allows backfill to share its transaction so rate-limit increments roll back on error
async function upsertSample(userId: string, body: any, ip: string, client?: PoolClient) {
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
  app.post('/weight', { preHandler: requireAuth }, async (req, reply) => {
    const body = req.body as any;
    const err = validate(body);
    if (err) return reply.code(400).send(err);

    const { status, body: resBody } = await upsertSample((req as any).userId, body, req.ip);
    return reply.code(status).send(resBody);
  });

  app.post('/weight/backfill', { preHandler: requireAuth }, async (req, reply) => {
    const { samples } = req.body as { samples: any[] };
    if (!Array.isArray(samples)) return reply.code(400).send({ error: 'samples must be an array' });
    if (samples.length > MAX_BACKFILL_SAMPLES)
      return reply.code(400).send({ error: `samples array exceeds maximum of ${MAX_BACKFILL_SAMPLES} items` });

    // Validate all items before touching the DB
    for (const sample of samples) {
      const err = validate(sample);
      if (err) return reply.code(400).send(err);
    }

    // Use an explicit client so the transaction covers rate-limit increments too —
    // a mid-batch error rolls back everything including write_count increments.
    const client = await db.connect();
    let created = 0, deduped = 0;
    try {
      await client.query('BEGIN');
      for (const sample of samples) {
        const result = await upsertSample((req as any).userId, sample, req.ip, client);
        if (result.status === 201) created++; else deduped++;
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    return reply.send({ created, deduped });
  });

  app.get('/weight', { preHandler: requireAuth }, async (req, reply) => {
    const { range = '90d' } = req.query as { range?: string };
    const rangeMap: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90, '1y': 365, 'all': 36500 };
    const days = rangeMap[range] ?? 90;
    const since = new Date();
    since.setDate(since.getDate() - days);

    const { samples, current, trend7d, trend30d, trend90d, adherencePct, missedDays } =
      await computeStats((req as any).userId, since);

    // Sync block
    const { rows: [sync] } = await db.query(
      `SELECT source, last_success_at,
         CASE
           WHEN last_success_at > now() - interval '36 hours' THEN 'fresh'
           WHEN last_success_at > now() - interval '72 hours' THEN 'stale'
           ELSE 'broken'
         END AS state
       FROM health_sync_status WHERE user_id = $1`,
      [(req as any).userId],
    );

    reply.header('Cache-Control', 'no-store');
    return {
      current,
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
  });
}
