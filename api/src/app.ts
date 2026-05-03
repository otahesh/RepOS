import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import helmet from '@fastify/helmet';
import { weightRoutes } from './routes/weight.js';
import { syncRoutes } from './routes/sync.js';
import { tokenRoutes } from './routes/tokens.js';
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
