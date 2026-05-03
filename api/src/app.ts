import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { weightRoutes } from './routes/weight.js';
import { syncRoutes } from './routes/sync.js';
import { tokenRoutes } from './routes/tokens.js';

export async function buildApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? false });
  await app.register(sensible);
  await app.register(tokenRoutes, { prefix: '/api' });
  await app.register(weightRoutes, { prefix: '/api/health' });
  await app.register(syncRoutes, { prefix: '/api/health' });
  app.get('/health', async () => ({ status: 'ok' }));
  return app;
}
