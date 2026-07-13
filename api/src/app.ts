import Fastify from 'fastify';
import { requireUserId, requireUserEmail } from './utils/requestIdentity.js';
import sensible from '@fastify/sensible';
import helmet from '@fastify/helmet';
import { db } from './db/client.js';
import { weightRoutes } from './routes/weight.js';
import { workoutsRoutes } from './routes/workouts.js';
import { syncRoutes } from './routes/sync.js';
import { tokenRoutes } from './routes/tokens.js';
import { muscleRoutes } from './routes/muscles.js';
import { muscleJointStressRoutes } from './routes/muscleJointStress.js';
import { exerciseRoutes } from './routes/exercises.js';
import { equipmentRoutes } from './routes/equipment.js';
import { programRoutes } from './routes/programs.js';
import { userProgramRoutes } from './routes/userPrograms.js';
import { userLandmarksRoutes } from './routes/userLandmarks.js';
import { mesocycleRoutes } from './routes/mesocycles.js';
import { plannedSetRoutes } from './routes/plannedSets.js';
import { recoveryFlagRoutes } from './routes/recoveryFlags.js';
import { setLogsRoutes } from './routes/setLogs.js';
import { cardioLogsRoutes } from './routes/cardioLogs.js';
import { dayWorkoutsRoutes } from './routes/dayWorkouts.js';
import { workoutHistoryRoutes } from './routes/workoutHistory.js';
import { userInjuriesRoutes } from './routes/userInjuries.js';
import { accountRoutes } from './routes/account.js';
import { authSignoutRoutes } from './routes/authSignout.js';
import { parQRoutes } from './routes/parQ.js';
import { onboardingRoutes } from './routes/onboarding.js';
import { mesocyclesDeloadRoutes } from './routes/mesocyclesDeload.js';
import { requireCfAccess, isAdminEmail } from './middleware/cfAccess.js';
import { registerErrorHandler } from './middleware/errorHandler.js';
import { registerMaintenanceGate } from './middleware/maintenance.js';
import { backupRoutes } from './routes/backups.js';
import { maintenanceRoutes } from './routes/maintenance.js';
import { feedbackRoutes } from './routes/feedback.js';
import { adminFeedbackRoutes } from './routes/adminFeedback.js';

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
  // Global error handler — sanitize 5xx so raw pg/internal errors never leak.
  registerErrorHandler(app);
  // W5 — maintenance gate. Registers the onRequest 503 hook + /health/user-facing
  // BEFORE any /api/* route plugin so a set flag short-circuits everything
  // except /api/maintenance/* and /health.
  await registerMaintenanceGate(app);
  await app.register(maintenanceRoutes, { prefix: '/api' });
  await app.register(backupRoutes, { prefix: '/api' });
  await app.register(tokenRoutes, { prefix: '/api' });
  await app.register(muscleRoutes, { prefix: '/api' });
  await app.register(muscleJointStressRoutes, { prefix: '/api' });
  await app.register(exerciseRoutes, { prefix: '/api' });
  await app.register(equipmentRoutes, { prefix: '/api' });
  await app.register(programRoutes, { prefix: '/api' });
  await app.register(userProgramRoutes, { prefix: '/api' });
  await app.register(userLandmarksRoutes, { prefix: '/api' });
  await app.register(mesocycleRoutes, { prefix: '/api' });
  await app.register(plannedSetRoutes, { prefix: '/api' });
  await app.register(recoveryFlagRoutes, { prefix: '/api' });
  await app.register(weightRoutes, { prefix: '/api/health' });
  await app.register(workoutsRoutes, { prefix: '/api/health' });
  await app.register(syncRoutes, { prefix: '/api/health' });
  await app.register(setLogsRoutes, { prefix: '/api' });
  await app.register(cardioLogsRoutes, { prefix: '/api' });
  await app.register(dayWorkoutsRoutes, { prefix: '/api' });
  await app.register(workoutHistoryRoutes, { prefix: '/api' });
  await app.register(userInjuriesRoutes, { prefix: '/api' });
  await app.register(accountRoutes, { prefix: '/api' });
  await app.register(authSignoutRoutes, { prefix: '/api' });
  await app.register(parQRoutes, { prefix: '/api' });
  await app.register(onboardingRoutes, { prefix: '/api' });
  await app.register(mesocyclesDeloadRoutes, { prefix: '/api' });
  await app.register(feedbackRoutes, { prefix: '/api' });
  await app.register(adminFeedbackRoutes, { prefix: '/api' });

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
    const userId = requireUserId(req);
    const {
      rows: [u],
    } = await db.query<{
      onboarding_completed_at: string | null;
      par_q_version: number;
      par_q_advisory_active: boolean;
      beta_disclaimer_ack_at: string | null;
    }>(
      `SELECT
         to_char(onboarding_completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS onboarding_completed_at,
         par_q_version,
         par_q_advisory_active,
         to_char(beta_disclaimer_ack_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS beta_disclaimer_ack_at
       FROM users WHERE id = $1`,
      [userId],
    );
    return {
      id: userId,
      email: requireUserEmail(req),
      display_name: req.userDisplayName ?? null,
      timezone: req.userTimezone as string,
      onboarding_completed_at: u?.onboarding_completed_at ?? null,
      par_q_version: u?.par_q_version ?? 0,
      par_q_advisory_active: u?.par_q_advisory_active ?? false,
      beta_disclaimer_ack_at: u?.beta_disclaimer_ack_at ?? null,
      is_admin: isAdminEmail(req.userEmail),
    };
  });

  app.get('/health', async () => ({ status: 'ok' }));
  return app;
}
