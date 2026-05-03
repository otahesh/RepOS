import 'dotenv/config';
import { buildApp } from './app.js';

const app = await buildApp({ logger: true });
const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: '0.0.0.0' });
