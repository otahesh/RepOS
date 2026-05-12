import 'dotenv/config';
import { validateStartupEnv } from './bootstrap-guards.js';
import { validatePlaceholderPurge, validateMaintenanceFlag } from './bootstrap-runtime.js';
import { buildApp } from './app.js';

const guards = validateStartupEnv(process.env);
for (const msg of guards.fatal) {
  console.error(`FATAL: ${msg}`);
}
if (guards.fatal.length > 0) {
  process.exit(1);
}
for (const entry of guards.info) {
  console.log(`[startup] ${JSON.stringify(entry)}`);
}

await validatePlaceholderPurge(process.env);
await validateMaintenanceFlag(process.env);

const app = await buildApp({ logger: true });
const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '127.0.0.1';
await app.listen({ port, host });
