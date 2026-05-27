import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import helmet from '@fastify/helmet';
import { weightRoutes } from './routes/weight.js';
import { workoutsRoutes } from './routes/workouts.js';
import { syncRoutes } from './routes/sync.js';
import { tokenRoutes } from './routes/tokens.js';
import { muscleRoutes } from './routes/muscles.js';
import { exerciseRoutes } from './routes/exercises.js';
import { equipmentRoutes } from './routes/equipment.js';
import { programRoutes } from './routes/programs.js';
import { userProgramRoutes } from './routes/userPrograms.js';
import { mesocycleRoutes } from './routes/mesocycles.js';
import { plannedSetRoutes } from './routes/plannedSets.js';
import { recoveryFlagRoutes } from './routes/recoveryFlags.js';
import { setLogsRoutes } from './routes/setLogs.js';
import { userInjuriesRoutes } from './routes/userInjuries.js';
import { accountRoutes } from './routes/account.js';
import { authSignoutRoutes } from './routes/authSignout.js';
import { requireCfAccess } from './middleware/cfAccess.js';
import { registerMaintenanceGate } from './middleware/maintenance.js';
import { backupRoutes } from './routes/backups.js';
import { maintenanceRoutes } from './routes/maintenance.js';

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
  // W5 — maintenance gate. Registers the onRequest 503 hook + /health/user-facing
  // BEFORE any /api/* route plugin so a set flag short-circuits everything
  // except /api/maintenance/* and /health.
  await registerMaintenanceGate(app);
  await app.register(maintenanceRoutes, { prefix: '/api' });
  await app.register(backupRoutes, { prefix: '/api' });
  await app.register(tokenRoutes, { prefix: '/api' });
  await app.register(muscleRoutes, { prefix: '/api' });
  await app.register(exerciseRoutes, { prefix: '/api' });
  await app.register(equipmentRoutes, { prefix: '/api' });
  await app.register(programRoutes, { prefix: '/api' });
  await app.register(userProgramRoutes, { prefix: '/api' });
  await app.register(mesocycleRoutes, { prefix: '/api' });
  await app.register(plannedSetRoutes, { prefix: '/api' });
  await app.register(recoveryFlagRoutes, { prefix: '/api' });
  await app.register(weightRoutes, { prefix: '/api/health' });
  await app.register(workoutsRoutes, { prefix: '/api/health' });
  await app.register(syncRoutes, { prefix: '/api/health' });
  await app.register(setLogsRoutes, { prefix: '/api' });
  await app.register(userInjuriesRoutes, { prefix: '/api' });
  await app.register(accountRoutes, { prefix: '/api' });
  await app.register(authSignoutRoutes, { prefix: '/api' });

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
