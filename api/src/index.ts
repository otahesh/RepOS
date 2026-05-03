import 'dotenv/config';
import { buildApp } from './app.js';

if (process.env.NODE_ENV === 'production' && !process.env.ADMIN_API_KEY) {
  console.error('FATAL: ADMIN_API_KEY must be set when NODE_ENV=production');
  process.exit(1);
}

// CF Access: when the feature flag is on, both team domain and AUD must
// be set so JWT verification and JWKS fetch can run. With the flag off
// these are unused — the boot keeps working.
if (process.env.CF_ACCESS_ENABLED === 'true') {
  for (const key of ['CF_ACCESS_AUD', 'CF_ACCESS_TEAM_DOMAIN'] as const) {
    if (!process.env[key]) {
      console.error(`FATAL: ${key} must be set when CF_ACCESS_ENABLED=true`);
      process.exit(1);
    }
  }
}

const app = await buildApp({ logger: true });
const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '127.0.0.1';
await app.listen({ port, host });
