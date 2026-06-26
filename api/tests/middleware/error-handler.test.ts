import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerErrorHandler } from '../../src/middleware/errorHandler.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  registerErrorHandler(app);

  // Simulates an unguarded db.query throwing raw pg internals.
  app.get('/boom', async () => {
    throw new Error('relation "device_tokens" does not exist at character 42');
  });

  // A deliberate, client-facing 4xx (http-errors/@fastify/sensible set
  // expose=true): message is safe and should be preserved.
  app.get('/bad', async () => {
    const err = new Error('field "weight_lbs" out of range') as Error & {
      statusCode?: number;
      expose?: boolean;
    };
    err.statusCode = 400;
    err.expose = true;
    throw err;
  });

  // A NON-exposed error tagged with a 4xx statusCode (e.g. a caught pg error
  // someone tagged `err.statusCode = 400`): message must be sanitized.
  app.get('/bad-unsafe', async () => {
    const err = new Error(
      'duplicate key value violates unique constraint "users_email_key"',
    ) as Error & { statusCode?: number };
    err.statusCode = 400;
    throw err;
  });

  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('global error handler', () => {
  it('sanitizes 5xx so raw internals never reach the client', async () => {
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error).toBe('Internal Server Error');
    // The raw pg message must NOT leak.
    expect(body.message).not.toContain('device_tokens');
    expect(body.message).not.toContain('relation');
    // ...but the response is still actionable: endpoint + a reference id.
    expect(body.message).toContain('GET /boom');
    expect(body.request_id).toBeTruthy();
  });

  it('preserves the message + shape for deliberate, exposed 4xx errors', async () => {
    const res = await app.inject({ method: 'GET', url: '/bad' });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.statusCode).toBe(400);
    expect(body.error).toBe('Bad Request');
    expect(body.message).toBe('field "weight_lbs" out of range');
  });

  it('sanitizes a non-exposed error even when tagged with a 4xx statusCode', async () => {
    const res = await app.inject({ method: 'GET', url: '/bad-unsafe' });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('Bad Request');
    // Raw pg constraint text must NOT leak through the 4xx path.
    expect(body.message).toBe('Bad Request');
    expect(body.message).not.toContain('users_email_key');
    expect(body.message).not.toContain('duplicate key');
  });
});
