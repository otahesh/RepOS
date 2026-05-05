import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import helmet from '@fastify/helmet';
import { weightRoutes } from './routes/weight.js';
import { syncRoutes } from './routes/sync.js';
import { tokenRoutes } from './routes/tokens.js';
import { muscleRoutes } from './routes/muscles.js';
import { exerciseRoutes } from './routes/exercises.js';
import { equipmentRoutes } from './routes/equipment.js';
import { programRoutes } from './routes/programs.js';
import { userProgramRoutes } from './routes/userPrograms.js';
import { mesocycleRoutes } from './routes/mesocycles.js';
import { plannedSetRoutes } from './routes/plannedSets.js';
import { requireCfAccess } from './middleware/cfAccess.js';

export async function buildApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({
    logger: opts.logger
      ? {
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers["x-admin-key"]',
              'req.headers["cf-access-jwt-assertion"]',
              'req.headers.cookie',
            ],
            remove: true,
          },
        }
      : false,
  });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(sensible);
  await app.register(tokenRoutes, { prefix: '/api' });
  await app.register(muscleRoutes, { prefix: '/api' });
  await app.register(exerciseRoutes, { prefix: '/api' });
  await app.register(equipmentRoutes, { prefix: '/api' });
  await app.register(programRoutes, { prefix: '/api' });
  await app.register(userProgramRoutes, { prefix: '/api' });
  await app.register(mesocycleRoutes, { prefix: '/api' });
  await app.register(plannedSetRoutes, { prefix: '/api' });
  await app.register(weightRoutes, { prefix: '/api/health' });
  await app.register(syncRoutes, { prefix: '/api/health' });

  // Whoami: returns the CF-Access-derived identity. 503 when the feature
  // flag is off (deployable transition state); 401 with WWW-Authenticate
  // when the JWT is missing/invalid.
  app.get('/api/me', { preHandler: requireCfAccess }, async (req) => ({
    id: (req as any).userId as string,
    email: (req as any).userEmail as string,
    display_name: ((req as any).userDisplayName as string | null) ?? null,
    timezone: (req as any).userTimezone as string,
  }));

  app.get('/health', async () => ({ status: 'ok' }));
  return app;
}
