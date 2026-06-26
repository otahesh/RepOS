import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { requireBearerOrCfAccess } from '../middleware/cfAccess.js';
import { parseLandmarksPatch } from '../schemas/userLandmarks.js';
import { resolveUserLandmarks } from '../services/resolveUserLandmarks.js';
import { deriveInjuryConstraints } from '../services/deriveInjuryConstraints.js';

export async function userLandmarksRoutes(app: FastifyInstance) {
  app.get('/users/me/landmarks', { preHandler: requireBearerOrCfAccess }, async (req, reply) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) {
      reply.code(500);
      return { error: 'auth_state_missing' };
    }
    const landmarks = await resolveUserLandmarks(userId);
    // [D2] Surface PAR-Q advisory status so the LandmarksEditor can cap
    // MAV/MRV inputs at 80% of seeded defaults + show clinician copy.
    const {
      rows: [u],
    } = await db.query<{ par_q_advisory_active: boolean }>(
      `SELECT par_q_advisory_active FROM users WHERE id=$1`,
      [userId],
    );
    // [I-INJURY-OVERLAY-COPY] Derive named injury constraints server-side
    // so the editor can render `⚠ left knee (high)` chips. The derivation
    // uses the same JOINT_ROOT / MUSCLE_JOINT_ROOTS that the
    // /api/muscles/joint-stress catalog endpoint exposes (Task 5b).
    const injury_constraints = await deriveInjuryConstraints(userId);
    return {
      landmarks,
      par_q_advisory_active: u?.par_q_advisory_active ?? false,
      injury_constraints,
    };
  });

  app.patch<{ Body: unknown }>(
    '/users/me/landmarks',
    { preHandler: requireBearerOrCfAccess },
    async (req, reply) => {
      const userId = (req as any).userId as string | undefined;
      if (!userId) {
        reply.code(500);
        return { error: 'auth_state_missing' };
      }
      // [C-LANDMARKS-CLINICAL-FLOORS] Per-slug validation with per-row error
      // collection. The PATCH refuses the whole body if any row fails (no
      // partial application — the editor reflects the same all-or-nothing
      // semantics the user sees in the form).
      const parsed = parseLandmarksPatch(req.body);
      if (!parsed.ok) {
        reply.code(400);
        return { fieldErrors: parsed.fieldErrors };
      }
      // Read-modify-write — the only key here is user_id, so a single UPDATE
      // with a merged JSONB is sufficient. No active-run mutation; the merge
      // applies to materialize-time only (active runs read landmarks_snapshot).
      await db.query(
        `UPDATE users
           SET muscle_landmarks = jsonb_set(
             COALESCE(muscle_landmarks, '{"_v":1}'::jsonb),
             '{overrides}',
             $2::jsonb
           )
         WHERE id=$1`,
        [userId, JSON.stringify(parsed.overrides)],
      );
      const landmarks = await resolveUserLandmarks(userId);
      const {
        rows: [u],
      } = await db.query<{ par_q_advisory_active: boolean }>(
        `SELECT par_q_advisory_active FROM users WHERE id=$1`,
        [userId],
      );
      const injury_constraints = await deriveInjuryConstraints(userId);
      return {
        landmarks,
        par_q_advisory_active: u?.par_q_advisory_active ?? false,
        injury_constraints,
      };
    },
  );
}
