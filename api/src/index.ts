import 'dotenv/config';
import { buildApp } from './app.js';

const app = await buildApp({ logger: true });
const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '127.0.0.1';
await app.listen({ port, host });
