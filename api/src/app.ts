import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import helmet from '@fastify/helmet';
import { db } from './db/client.js';
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
import { parQRoutes } from './routes/parQ.js';
import { onboardingRoutes } from './routes/onboarding.js';
import { mesocyclesDeloadRoutes } from './routes/mesocyclesDeload.js';
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
  await app.register(recoveryFlagRoutes, { prefix: '/api' });
  await app.register(weightRoutes, { prefix: '/api/health' });
  await app.register(workoutsRoutes, { prefix: '/api/health' });
  await app.register(syncRoutes, { prefix: '/api/health' });
  await app.register(setLogsRoutes, { prefix: '/api' });
  await app.register(userInjuriesRoutes, { prefix: '/api' });
  await app.register(accountRoutes, { prefix: '/api' });
  await app.register(authSignoutRoutes, { prefix: '/api' });
  await app.register(parQRoutes, { prefix: '/api' });
  await app.register(onboardingRoutes, { prefix: '/api' });
  await app.register(mesocyclesDeloadRoutes, { prefix: '/api' });

  // Whoami: returns the CF-Access-derived identity. 503 when the feature
  // flag is off (deployable transition state); 401 with WWW-Authenticate
  // when the JWT is missing/invalid.
  //
  // W2: also expose onboarding_completed_at + par_q_version +
  // par_q_advisory_active so the AppShell's derived state machine can decide
  // whether to render the OnboardingOverlay / ParQGate. These three columns
  // aren't on the request (requireCfAccess only stamps identity) so we SELECT
  // them by userId here.
  app.get('/api/me', { preHandler: requireCfAccess }, async (req) => {
    const userId = (req as any).userId as string;
    const { rows: [u] } = await db.query<{
      onboarding_completed_at: string | null;
      par_q_version: number;
      par_q_advisory_active: boolean;
    }>(
      `SELECT
         to_char(onboarding_completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS onboarding_completed_at,
         par_q_version,
         par_q_advisory_active
       FROM users WHERE id = $1`,
      [userId],
    );
    return {
      id: userId,
      email: (req as any).userEmail as string,
      display_name: ((req as any).userDisplayName as string | null) ?? null,
      timezone: (req as any).userTimezone as string,
      onboarding_completed_at: u?.onboarding_completed_at ?? null,
      par_q_version: u?.par_q_version ?? 0,
      par_q_advisory_active: u?.par_q_advisory_active ?? false,
    };
  });

  app.get('/health', async () => ({ status: 'ok' }));
  return app;
}
