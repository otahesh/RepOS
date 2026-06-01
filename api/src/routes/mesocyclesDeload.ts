// api/src/routes/mesocyclesDeload.ts
// Beta W2.5 — manual mid-meso deload routes.
// Mount path: /api/mesocycles/:id/deload-now + /undo.
// Scope: account:write (panel C-SCOPE).
import type { FastifyInstance } from 'fastify';
import { requireBearerOrCfAccess } from '../middleware/cfAccess.js';
import { requireScope } from '../middleware/scope.js';
import { UuidParamSchema } from '../schemas/idParams.js';
import {
  applyManualDeload,
  undoManualDeload,
  AlreadyDeloadedError,
  RunNotActiveError,
  UndoWindowExpiredError,
} from '../services/manualDeload.js';

export async function mesocyclesDeloadRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string } }>(
    '/mesocycles/:id/deload-now',
    { preHandler: [requireBearerOrCfAccess, requireScope('account:write')] },
    async (req, reply) => {
      if (!UuidParamSchema.safeParse(req.params).success) {
        reply.code(404);
        return { error: 'not_found' };
      }
      const userId = (req as any).userId as string;
      try {
        const r = await applyManualDeload(userId, req.params.id);
        return { run_id: req.params.id, triggered_at: new Date().toISOString(), ...r };
      } catch (e: any) {
        if (e.message === 'not_found') { reply.code(404); return { error: 'not_found' }; }
        if (e instanceof RunNotActiveError) { reply.code(409); return { error: 'run_not_active' }; }
        if (e instanceof AlreadyDeloadedError) { reply.code(409); return { error: 'already_deloaded' }; }
        throw e;
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/mesocycles/:id/deload-now/undo',
    { preHandler: [requireBearerOrCfAccess, requireScope('account:write')] },
    async (req, reply) => {
      if (!UuidParamSchema.safeParse(req.params).success) {
        reply.code(404);
        return { error: 'not_found' };
      }
      const userId = (req as any).userId as string;
      try {
        await undoManualDeload(userId, req.params.id);
        return { run_id: req.params.id, reversed_at: new Date().toISOString() };
      } catch (e: any) {
        if (e.message === 'not_found') { reply.code(404); return { error: 'not_found' }; }
        if (e.message === 'no_manual_deload') { reply.code(409); return { error: 'no_manual_deload' }; }
        if (e instanceof UndoWindowExpiredError) { reply.code(409); return { error: 'undo_window_expired' }; }
        throw e;
      }
    },
  );
}
