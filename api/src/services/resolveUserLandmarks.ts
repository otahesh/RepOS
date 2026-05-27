import { db } from '../db/client.js';
import { MUSCLE_LANDMARKS } from './_muscleLandmarks.js';
import type { ResolvedLandmarks } from '../schemas/userLandmarks.js';

const VALID_SLUGS = new Set(Object.keys(MUSCLE_LANDMARKS));

// Minimal queryable surface — accepts either the shared pool (`db`) or an
// in-transaction PoolClient. This lets materializeMesocycle resolve landmarks
// on the SAME connection it already holds for its SERIALIZABLE txn, instead of
// checking out a SECOND pool connection (which doubled peak connection demand
// and exhausted the pool under the 50-parallel-starts concurrency guardrail).
type Queryable = { query: typeof db.query };

export async function resolveUserLandmarks(userId: string): Promise<ResolvedLandmarks> {
  return resolveUserLandmarksWith(db, userId);
}

export async function resolveUserLandmarksWith(client: Queryable, userId: string): Promise<ResolvedLandmarks> {
  const { rows } = await client.query<{ ml: { _v: number; overrides?: Record<string, { mev: number; mav: number; mrv: number; mv?: number }> } }>(
    `SELECT muscle_landmarks AS ml FROM users WHERE id=$1`, [userId],
  );
  if (rows.length === 0) throw new Error('user not found');
  const overrides = rows[0].ml.overrides ?? {};
  // [I-LANDMARKS-UNKNOWN-SLUG] Log + skip unknown slugs on read. Write-side
  // already rejects via zod (MuscleSlugEnum), so the only way to land here is
  // a back-channel write (admin tool removed a muscle slug while leaving
  // overrides). Throwing would surface as a 500 on the user's GET; skipping
  // keeps reads working while still flagging the drift in logs for ops.
  for (const slug of Object.keys(overrides)) {
    if (!VALID_SLUGS.has(slug)) {
      console.warn(`[resolveUserLandmarks] unknown muscle '${slug}' in user=${userId}.muscle_landmarks.overrides — skipping`);
    }
  }
  const out: ResolvedLandmarks = {};
  for (const slug of Object.keys(MUSCLE_LANDMARKS)) {
    out[slug] = { ...MUSCLE_LANDMARKS[slug], ...(overrides[slug] ?? {}) };
  }
  return out;
}
