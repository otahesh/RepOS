import 'dotenv/config';
import { buildApp } from './app.js';

if (process.env.NODE_ENV === 'production' && !process.env.ADMIN_API_KEY) {
  console.error('FATAL: ADMIN_API_KEY must be set when NODE_ENV=production');
  process.exit(1);
}

const app = await buildApp({ logger: true });
const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '127.0.0.1';
await app.listen({ port, host });
