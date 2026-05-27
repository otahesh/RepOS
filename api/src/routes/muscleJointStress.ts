import type { FastifyInstance } from 'fastify';
import { requireBearerOrCfAccess } from '../middleware/cfAccess.js';
import { getMuscleJointStressCatalog } from '../services/muscleJointStress.js';

export async function muscleJointStressRoutes(app: FastifyInstance) {
  app.get(
    '/muscles/joint-stress',
    { preHandler: requireBearerOrCfAccess },
    async () => getMuscleJointStressCatalog(),
  );
}
